package main

// Reads Go into the artifact document, following go-symbol-graph.
//
// The shape of the problem is Go's, not Python's or TypeScript's: a method is
// declared at the top level of a file and belongs to a type declared somewhere
// else, a package is a directory rather than a file, and a project's
// dependencies are hundreds of modules nobody has downloaded. Name resolution
// is the type checker's, run over the walked module's own source with every
// other import standing in as an empty package — an edge to a dependency is one
// the contract forbids anyway, so there is nothing to fetch.

import (
	"go/ast"
	"go/build/constraint"
	"go/parser"
	"go/token"
	"go/types"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

// Every analyzer skips these (structure-graph-artifact), and Go adds its own
// two. A directory starting with "." or "_" is skipped as the go tool skips it.
var skippedDirs = map[string]bool{
	".git": true, ".hg": true, ".svn": true,
	"node_modules": true, "dist": true, "build": true,
	".idea": true, ".vscode": true,
	"tests": true, "test": true, "__tests__": true, "testing": true,
	"docs": true, "examples": true,
	"vendor": true, "testdata": true,
}

// The artifact's precedence for one ordered pair.
var rank = map[string]int{"references": 1, "uses": 2, "inherits": 3, "contains": 4}

type pkgInfo struct {
	dir        string
	importPath string
	name       string
	files      []string
	asts       []*ast.File
	types      *types.Package
	info       *types.Info
	checking   bool
	nodeID     string
	typeByName map[string]string // first declaration wins, in file name order
}

type analysis struct {
	fset       *token.FileSet
	pkgs       []*pkgInfo
	byPath     map[string]*pkgInfo
	fake       map[string]*types.Package
	nodes      []Node
	nodeIndex  map[string]int
	nodePkg    map[string]string
	objNode    map[types.Object]string
	fieldOwner map[*types.Var]string
	edges      map[[2]string]string
}

func Analyze(roots []string) (*Graph, error) {
	a := &analysis{
		fset:       token.NewFileSet(),
		byPath:     map[string]*pkgInfo{},
		fake:       map[string]*types.Package{},
		nodeIndex:  map[string]int{},
		nodePkg:    map[string]string{},
		objNode:    map[types.Object]string{},
		fieldOwner: map[*types.Var]string{},
		edges:      map[[2]string]string{},
	}
	seen := map[string]bool{}
	for _, r := range roots {
		root, err := filepath.Abs(r)
		if err != nil {
			return nil, err
		}
		a.walk(root, seen)
	}
	sort.Slice(a.pkgs, func(i, j int) bool { return a.pkgs[i].dir < a.pkgs[j].dir })
	for _, p := range a.pkgs {
		a.check(p)
	}
	for _, p := range a.pkgs {
		a.declare(p)
	}
	for _, p := range a.pkgs {
		a.relate(p)
	}
	a.packageEdges()

	g := &Graph{Nodes: a.nodes, Edges: []Edge{}}
	if g.Nodes == nil {
		g.Nodes = []Node{}
	}
	for k, kind := range a.edges {
		g.Edges = append(g.Edges, Edge{From: k[0], To: k[1], Kind: kind})
	}
	sort.Slice(g.Edges, func(i, j int) bool {
		x, y := g.Edges[i], g.Edges[j]
		if x.From != y.From {
			return x.From < y.From
		}
		if x.To != y.To {
			return x.To < y.To
		}
		return x.Kind < y.Kind
	})
	return g, nil
}

// ---------------------------------------------------------------------------
// Walking

func (a *analysis) walk(root string, seen map[string]bool) {
	modRoot, modPath := findModule(root)
	byDir := map[string][]string{}
	dirs := []string{}
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p == root {
				return nil
			}
			name := d.Name()
			if skippedDirs[name] || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
				return filepath.SkipDir
			}
			// Another module: its packages import this one by its published
			// path rather than being part of it.
			if _, err := os.Stat(filepath.Join(p, "go.mod")); err == nil {
				return filepath.SkipDir
			}
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		dir := filepath.Dir(p)
		if _, ok := byDir[dir]; !ok {
			dirs = append(dirs, dir)
		}
		byDir[dir] = append(byDir[dir], p)
		return nil
	})

	for _, dir := range dirs {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		p := a.parseDir(dir, byDir[dir])
		if p == nil {
			continue
		}
		p.importPath = importPathOf(modRoot, modPath, dir)
		a.pkgs = append(a.pkgs, p)
		if p.importPath != "" {
			a.byPath[p.importPath] = p
		}
	}
}

func (a *analysis) parseDir(dir string, paths []string) *pkgInfo {
	sort.Strings(paths)
	type parsed struct {
		path string
		file *ast.File
	}
	all := []parsed{}
	count := map[string]int{}
	for _, path := range paths {
		src, err := os.ReadFile(path)
		if err != nil || !buildable(src) {
			continue
		}
		f, _ := parser.ParseFile(a.fset, path, src, parser.ParseComments|parser.SkipObjectResolution)
		if f == nil || f.Name == nil {
			continue
		}
		all = append(all, parsed{path, f})
		count[f.Name.Name]++
	}
	if len(all) == 0 {
		return nil
	}
	// The directory's package is the one most of its files declare; on a tie,
	// the first file's. A file naming another package is not walked.
	name := all[0].file.Name.Name
	for _, pf := range all {
		if count[pf.file.Name.Name] > count[name] {
			name = pf.file.Name.Name
		}
	}
	p := &pkgInfo{dir: dir, name: name, typeByName: map[string]string{}}
	for _, pf := range all {
		if pf.file.Name.Name == name {
			p.files = append(p.files, pf.path)
			p.asts = append(p.asts, pf.file)
		}
	}
	return p
}

// buildable reports whether some platform compiles the file. Only a constraint
// no assignment of tags can satisfy — `//go:build ignore` — excludes one; a file
// for one platform is walked on every platform, or the document would depend on
// the machine that wrote it.
func buildable(src []byte) bool {
	for _, line := range strings.Split(string(src), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "package ") {
			break
		}
		if constraint.IsGoBuild(t) {
			x, err := constraint.Parse(t)
			if err != nil {
				return true
			}
			return satisfiable(x)
		}
	}
	return true
}

func satisfiable(x constraint.Expr) bool {
	tags := map[string]bool{}
	var collect func(constraint.Expr)
	collect = func(e constraint.Expr) {
		switch v := e.(type) {
		case *constraint.TagExpr:
			tags[v.Tag] = true
		case *constraint.NotExpr:
			collect(v.X)
		case *constraint.AndExpr:
			collect(v.X)
			collect(v.Y)
		case *constraint.OrExpr:
			collect(v.X)
			collect(v.Y)
		}
	}
	collect(x)
	delete(tags, "ignore")
	names := make([]string, 0, len(tags))
	for t := range tags {
		names = append(names, t)
	}
	if len(names) > 16 {
		return true
	}
	for mask := 0; mask < 1<<len(names); mask++ {
		on := map[string]bool{}
		for i, n := range names {
			on[n] = mask&(1<<i) != 0
		}
		if x.Eval(func(tag string) bool { return on[tag] }) {
			return true
		}
	}
	return false
}

func findModule(root string) (string, string) {
	for d := root; ; d = filepath.Dir(d) {
		if b, err := os.ReadFile(filepath.Join(d, "go.mod")); err == nil {
			for _, line := range strings.Split(string(b), "\n") {
				f := strings.Fields(line)
				if len(f) >= 2 && f[0] == "module" {
					return d, strings.Trim(f[1], `"`)
				}
			}
			return d, ""
		}
		if filepath.Dir(d) == d {
			return "", ""
		}
	}
}

func importPathOf(modRoot, modPath, dir string) string {
	if modRoot == "" || modPath == "" {
		return ""
	}
	rel, err := filepath.Rel(modRoot, dir)
	if err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	if rel == "." {
		return modPath
	}
	return modPath + "/" + filepath.ToSlash(rel)
}

// ---------------------------------------------------------------------------
// Type checking

// Import type-checks a package of the walked module from source, and answers
// anything else with an empty, complete package: every name reached through it
// fails to resolve, the error is collected, and no edge follows.
func (a *analysis) Import(path string) (*types.Package, error) {
	if path == "unsafe" {
		return types.Unsafe, nil
	}
	if p := a.byPath[path]; p != nil {
		a.check(p)
		if p.types != nil {
			return p.types, nil
		}
	}
	if f := a.fake[path]; f != nil {
		return f, nil
	}
	pkg := types.NewPackage(path, guessName(path))
	pkg.MarkComplete()
	a.fake[path] = pkg
	return pkg, nil
}

func guessName(path string) string {
	parts := strings.Split(path, "/")
	name := parts[len(parts)-1]
	if len(parts) > 1 && len(name) > 1 && name[0] == 'v' && strings.Trim(name[1:], "0123456789") == "" {
		name = parts[len(parts)-2]
	}
	return strings.NewReplacer("-", "_", ".", "_").Replace(name)
}

func (a *analysis) check(p *pkgInfo) {
	if p.types != nil || p.checking {
		return
	}
	p.checking = true
	p.info = &types.Info{
		Types: map[ast.Expr]types.TypeAndValue{},
		Defs:  map[*ast.Ident]types.Object{},
		Uses:  map[*ast.Ident]types.Object{},
	}
	conf := types.Config{Importer: a, Error: func(error) {}, FakeImportC: true}
	pkg, _ := conf.Check(p.importPath, a.fset, p.asts, p.info)
	p.types = pkg
	p.checking = false
}

// ---------------------------------------------------------------------------
// Nodes

func (a *analysis) addNode(n Node, pkg string) {
	if i, ok := a.nodeIndex[n.ID]; ok {
		// A name declared twice in one file keeps the last declaration's
		// location, as the contract says.
		a.nodes[i] = n
		return
	}
	a.nodeIndex[n.ID] = len(a.nodes)
	a.nodes = append(a.nodes, n)
	a.nodePkg[n.ID] = pkg
}

func makeID(file, kind, name string) string { return file + "::" + kind + "::" + name }

// addMember records something that belongs to a node without being one. A Go
// method is its receiver's, so the receiver is where a reader looks for it:
// nothing else in the document names a method, and without members, searching
// a drawing of prometheus for `Append`, `Close` or `Start` would find nothing
// while the source holds 36, 86 and 5 of them.
func (a *analysis) addMember(nodeID string, m Member) {
	if i, ok := a.nodeIndex[nodeID]; ok {
		a.nodes[i].Members = append(a.nodes[i].Members, m)
	}
}

func (a *analysis) declare(p *pkgInfo) {
	place := 0
	for i, f := range p.asts {
		if f.Doc != nil {
			place = i
			break
		}
	}
	placeFile := p.files[place]
	p.nodeID = makeID(placeFile, "package", p.name)
	a.addNode(Node{
		ID: p.nodeID, Kind: "package", Name: p.name, File: placeFile,
		Line:     a.fset.Position(p.asts[place].Package).Line,
		Internal: underInternal(placeFile),
	}, p.nodeID)
	a.nodePkg[p.nodeID] = p.nodeID

	for i, f := range p.asts {
		file := p.files[i]
		// Where the file sits answers for everything declared in it.
		inInternal := underInternal(file)
		symbols, methods := 0, false
		for _, decl := range f.Decls {
			switch d := decl.(type) {
			case *ast.GenDecl:
				if d.Tok != token.TYPE {
					continue
				}
				for _, spec := range d.Specs {
					ts := spec.(*ast.TypeSpec)
					if ts.Name.Name == "_" {
						continue
					}
					id := makeID(file, typeKind(ts), ts.Name.Name)
					a.addNode(Node{
						ID: id, Kind: typeKind(ts), Name: ts.Name.Name, File: file,
						Line:    a.fset.Position(ts.Name.Pos()).Line,
						EndLine: a.fset.Position(ts.End()).Line,
						// What leaves the package is what the compiler reads
						// the first letter for, and it is the only mark Go has.
						Internal: !token.IsExported(ts.Name.Name) || inInternal,
					}, p.nodeID)
					symbols++
					if _, ok := p.typeByName[ts.Name.Name]; !ok {
						p.typeByName[ts.Name.Name] = id
					}
					if obj, ok := p.info.Defs[ts.Name].(*types.TypeName); ok {
						a.objNode[obj] = id
						if st, ok := obj.Type().Underlying().(*types.Struct); ok && !obj.IsAlias() {
							for k := 0; k < st.NumFields(); k++ {
								a.fieldOwner[st.Field(k)] = id
							}
						}
					}
				}
			case *ast.FuncDecl:
				if d.Recv != nil {
					methods = true
					continue
				}
				if d.Name.Name == "init" || d.Name.Name == "_" {
					continue
				}
				id := makeID(file, "function", d.Name.Name)
				a.addNode(Node{
					ID: id, Kind: "function", Name: d.Name.Name, File: file,
					Line:     a.fset.Position(d.Name.Pos()).Line,
					EndLine:  a.fset.Position(d.End()).Line,
					Internal: !token.IsExported(d.Name.Name) || inInternal,
				}, p.nodeID)
				symbols++
				if obj := p.info.Defs[d.Name]; obj != nil {
					a.objNode[obj] = id
				}
			}
		}
		// Represented by the package placed in it, or by the types its methods
		// belong to; declaring nothing but imports, it is not content at all.
		// Otherwise the file is content and is drawn as itself.
		if symbols == 0 && !methods && i != place && !onlyImports(f) {
			base := filepath.Base(file)
			a.addNode(Node{
				ID: makeID(file, "file", base), Kind: "file", Name: base, File: file,
				Line: 1, EndLine: 1, Internal: inInternal,
			}, p.nodeID)
		}
	}

	for _, n := range a.nodes {
		if a.nodePkg[n.ID] == p.nodeID && n.ID != p.nodeID {
			a.addEdge(p.nodeID, n.ID, "contains")
		}
	}
}

// onlyImports reports whether every declaration in the file is an import. Go has
// no re-export, but a file of blank imports registers plugins and declares
// nothing of its own — prometheus's plugins directory is 26 of them. A file with
// no declaration at all is not one: it is still drawn, as TypeScript draws an
// empty file.
func onlyImports(f *ast.File) bool {
	if len(f.Decls) == 0 {
		return false
	}
	for _, decl := range f.Decls {
		if d, ok := decl.(*ast.GenDecl); !ok || d.Tok != token.IMPORT {
			return false
		}
	}
	return true
}

// underInternal reports whether the path sits under a directory named exactly
// `internal`. That is Go's other mark for what is not for reaching, and the
// harder of the two: the compiler refuses an import of such a package from
// anything outside the subtree rooted at the directory holding it, and no name
// says so — hugo declares 188 exported-looking types and functions in that
// position. A directory named `internals` is an ordinary one, which is why this
// reads whole segments rather than a prefix.
func underInternal(path string) bool {
	for dir := filepath.Dir(path); ; {
		if filepath.Base(dir) == "internal" {
			return true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return false
		}
		dir = parent
	}
}

func typeKind(ts *ast.TypeSpec) string {
	if ts.Assign.IsValid() {
		return "type"
	}
	switch ts.Type.(type) {
	case *ast.StructType:
		return "struct"
	case *ast.InterfaceType:
		return "interface"
	}
	return "type"
}

// ---------------------------------------------------------------------------
// Edges

func (a *analysis) addEdge(from, to, kind string) {
	if from == "" || to == "" || from == to {
		return
	}
	k := [2]string{from, to}
	if old, ok := a.edges[k]; !ok || rank[kind] > rank[old] {
		a.edges[k] = kind
	}
}

func (a *analysis) relate(p *pkgInfo) {
	for _, f := range p.asts {
		for _, decl := range f.Decls {
			switch d := decl.(type) {
			case *ast.GenDecl:
				switch d.Tok {
				case token.TYPE:
					for _, spec := range d.Specs {
						ts := spec.(*ast.TypeSpec)
						obj, _ := p.info.Defs[ts.Name].(*types.TypeName)
						owner := a.objNode[obj]
						if obj == nil || owner == "" {
							continue
						}
						w := &walker{a: a, p: p, owner: owner}
						w.walk(ts.TypeParams, "references")
						// Only here, where a declared type embeds another, is an
						// embedding inherits. Anywhere else it is read by its
						// position, like any other name.
						switch t := ts.Type.(type) {
						case *ast.StructType:
							w.structType(t, "inherits")
						case *ast.InterfaceType:
							w.interfaceType(t, "inherits")
						default:
							w.walk(ts.Type, "references")
						}
					}
				case token.VAR, token.CONST:
					w := &walker{a: a, p: p, owner: p.nodeID}
					for _, spec := range d.Specs {
						w.walk(spec, "uses")
					}
				}
			case *ast.FuncDecl:
				owner := ""
				switch {
				case d.Recv != nil:
					owner = p.typeByName[receiverName(d.Recv)]
				case d.Name.Name == "init" || d.Name.Name == "_":
					owner = p.nodeID
				default:
					owner = a.objNode[p.info.Defs[d.Name]]
				}
				if owner == "" {
					continue
				}
				// Recorded here rather than in the node pass, because a method
				// can be declared before its receiver's type: the owner is
				// known once every package has been declared, which is what
				// this pass waits for. Packages are walked in path order and
				// files in name order, so a type's methods come out in the
				// order the source declares them. A method named `_` can be
				// called by nothing and is left out, as `func _` is.
				if d.Recv != nil && d.Name.Name != "_" {
					pos := a.fset.Position(d.Name.Pos())
					a.addMember(owner, Member{Name: d.Name.Name, File: pos.Filename, Line: pos.Line})
				}
				w := &walker{a: a, p: p, owner: owner}
				w.walk(d.Type, "references")
				w.walk(d.Body, "uses")
			}
		}
	}
}

func receiverName(recv *ast.FieldList) string {
	if recv == nil || len(recv.List) == 0 {
		return ""
	}
	e := recv.List[0].Type
	for {
		switch x := e.(type) {
		case *ast.StarExpr:
			e = x.X
		case *ast.ParenExpr:
			e = x.X
		case *ast.IndexExpr:
			e = x.X
		case *ast.IndexListExpr:
			e = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

// packageEdges joins each package to every other package its nodes point at,
// weakened to what a dependency between packages can mean: an inherits between
// packages would say one package is a kind of another.
func (a *analysis) packageEdges() {
	agg := map[[2]string]string{}
	for k, kind := range a.edges {
		if kind == "contains" {
			continue
		}
		pf, pt := a.nodePkg[k[0]], a.nodePkg[k[1]]
		if pf == "" || pt == "" || pf == pt {
			continue
		}
		want := "references"
		if kind == "uses" || kind == "inherits" {
			want = "uses"
		}
		kk := [2]string{pf, pt}
		if rank[want] > rank[agg[kk]] {
			agg[kk] = want
		}
	}
	for k, kind := range agg {
		a.addEdge(k[0], k[1], kind)
	}
}

// target is the node a resolved name stands for: a type or function declared at
// package scope, the type a method or field is declared on, or nothing.
func (a *analysis) target(obj types.Object) string {
	switch o := obj.(type) {
	case *types.TypeName:
		return a.objNode[o]
	case *types.Func:
		if sig, ok := o.Type().(*types.Signature); ok && sig.Recv() != nil {
			return a.typeNode(sig.Recv().Type())
		}
		return a.objNode[o]
	case *types.Var:
		if o.IsField() {
			return a.fieldOwner[o.Origin()]
		}
	}
	return ""
}

func (a *analysis) typeNode(t types.Type) string {
	t = types.Unalias(t)
	if ptr, ok := t.(*types.Pointer); ok {
		t = types.Unalias(ptr.Elem())
	}
	if named, ok := t.(*types.Named); ok {
		return a.objNode[named.Origin().Obj()]
	}
	return ""
}

type walker struct {
	a     *analysis
	p     *pkgInfo
	owner string
}

func (w *walker) ref(id *ast.Ident, kind string) {
	obj := w.p.info.Uses[id]
	if obj == nil {
		return
	}
	w.a.addEdge(w.owner, w.a.target(obj), kind)
}

func isNil(n ast.Node) bool {
	if n == nil {
		return true
	}
	v := reflect.ValueOf(n)
	return v.Kind() == reflect.Pointer && v.IsNil()
}

// walk visits n, taking every name in it as the given kind of position except
// where the syntax says otherwise: an embedded type is inherits, a type written
// inside code — a declared variable's type, a function literal's signature, a
// type argument — is a reference.
func (w *walker) walk(n ast.Node, mode string) {
	if isNil(n) {
		return
	}
	ast.Inspect(n, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.Ident:
			w.ref(x, mode)
			return false
		case *ast.SelectorExpr:
			w.walk(x.X, mode)
			w.ref(x.Sel, mode)
			return false
		case *ast.StructType:
			w.structType(x, mode)
			return false
		case *ast.InterfaceType:
			w.interfaceType(x, mode)
			return false
		case *ast.FuncType:
			w.walk(x.TypeParams, "references")
			w.walk(x.Params, "references")
			w.walk(x.Results, "references")
			return false
		case *ast.FuncLit:
			w.walk(x.Type, "references")
			w.walk(x.Body, "uses")
			return false
		case *ast.ValueSpec:
			w.walk(x.Type, "references")
			for _, v := range x.Values {
				w.walk(v, "uses")
			}
			return false
		case *ast.TypeSpec:
			w.walk(x.TypeParams, "references")
			w.walk(x.Type, "references")
			return false
		case *ast.IndexExpr:
			w.walk(x.X, mode)
			if tv, ok := w.p.info.Types[x.Index]; ok && tv.IsType() {
				w.walk(x.Index, "references")
			} else {
				w.walk(x.Index, mode)
			}
			return false
		case *ast.IndexListExpr:
			w.walk(x.X, mode)
			for _, idx := range x.Indices {
				w.walk(idx, "references")
			}
			return false
		}
		return true
	})
}

// structType reads a struct's fields: a named field's type is a type
// position, and an embedded one is given embedKind — inherits in a type
// declaration, and the position's own kind in an anonymous struct.
func (w *walker) structType(x *ast.StructType, embedKind string) {
	for _, f := range x.Fields.List {
		if len(f.Names) == 0 {
			w.embedded(f.Type, embedKind)
		} else {
			w.walk(f.Type, "references")
		}
	}
}

func (w *walker) interfaceType(x *ast.InterfaceType, embedKind string) {
	for _, f := range x.Methods.List {
		switch f.Type.(type) {
		case *ast.Ident, *ast.SelectorExpr, *ast.IndexExpr, *ast.IndexListExpr:
			if len(f.Names) == 0 {
				w.embedded(f.Type, embedKind)
				continue
			}
		}
		w.walk(f.Type, "references")
	}
}

func (w *walker) embedded(e ast.Expr, kind string) {
	for {
		switch x := e.(type) {
		case *ast.StarExpr:
			e = x.X
			continue
		case *ast.ParenExpr:
			e = x.X
			continue
		case *ast.IndexExpr:
			w.walk(x.Index, "references")
			e = x.X
			continue
		case *ast.IndexListExpr:
			for _, idx := range x.Indices {
				w.walk(idx, "references")
			}
			e = x.X
			continue
		case *ast.SelectorExpr:
			w.ref(x.Sel, kind)
		case *ast.Ident:
			w.ref(x, kind)
		}
		return
	}
}
