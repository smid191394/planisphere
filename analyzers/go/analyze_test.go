package main

// The rules of go-symbol-graph, each against a module small enough to read in
// the test. A module is written into a fresh directory and analyzed as the CLI
// would analyze it; nothing here reaches the go command, the network or the
// module cache.

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const goMod = "module example.com/m\n\ngo 1.23\n"

func writeModule(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	if _, ok := files["go.mod"]; !ok {
		files["go.mod"] = goMod
	}
	for rel, src := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func module(t *testing.T, files map[string]string) (*Graph, string) {
	t.Helper()
	dir := t.TempDir()
	writeModule(t, dir, files)
	g, err := Analyze([]string{dir})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	return g, dir
}

func nodeID(dir, rel, kind, name string) string {
	return filepath.Join(dir, filepath.FromSlash(rel)) + "::" + kind + "::" + name
}

func node(g *Graph, id string) *Node {
	for i := range g.Nodes {
		if g.Nodes[i].ID == id {
			return &g.Nodes[i]
		}
	}
	return nil
}

func mustNode(t *testing.T, g *Graph, id string) *Node {
	t.Helper()
	n := node(g, id)
	if n == nil {
		t.Fatalf("no node %s\ngot: %v", id, ids(g))
	}
	return n
}

func ids(g *Graph) []string {
	out := []string{}
	for _, n := range g.Nodes {
		out = append(out, n.Kind+" "+n.Name)
	}
	sort.Strings(out)
	return out
}

func named(g *Graph, name string) []Node {
	out := []Node{}
	for _, n := range g.Nodes {
		if n.Name == name {
			out = append(out, n)
		}
	}
	return out
}

func edgeKind(g *Graph, from, to string) string {
	for _, e := range g.Edges {
		if e.From == from && e.To == to {
			return e.Kind
		}
	}
	return ""
}

func edgesFrom(g *Graph, from string) map[string]string {
	out := map[string]string{}
	for _, e := range g.Edges {
		if e.From == from {
			out[e.To] = e.Kind
		}
	}
	return out
}

func expectEdge(t *testing.T, g *Graph, from, to, kind string) {
	t.Helper()
	if got := edgeKind(g, from, to); got != kind {
		t.Errorf("%s -> %s want %q, got %q", from, to, kind, got)
	}
}

func uniqueIDs(t *testing.T, g *Graph) {
	t.Helper()
	seen := map[string]bool{}
	for _, n := range g.Nodes {
		if seen[n.ID] {
			t.Errorf("duplicate node id %s", n.ID)
		}
		seen[n.ID] = true
	}
}

// ---------------------------------------------------------------------------
// Requirement: Go sources in one module, tests and other modules excluded

func TestWalk(t *testing.T) {
	g, _ := module(t, map[string]string{
		"a.go":               "package m\n\ntype Kept struct{}\n",
		"a_test.go":          "package m\n\ntype InTest struct{}\n",
		"vendor/x/x.go":      "package x\n\ntype Vendored struct{}\n",
		"testdata/t.go":      "package t\n\ntype Data struct{}\n",
		".hidden/h.go":       "package h\n\ntype Hidden struct{}\n",
		"_skip/s.go":         "package s\n\ntype Underscore struct{}\n",
		"nested/go.mod":      "module example.com/nested\n\ngo 1.23\n",
		"nested/n.go":        "package nested\n\ntype OtherModule struct{}\n",
		"nested/deeper/d.go": "package deeper\n\ntype Deeper struct{}\n",
		// Same package as its neighbours, so only the constraint can keep it
		// out; as `package main` the package-clause rule would do it instead.
		"gen.go":          "//go:build ignore\n\npackage m\n\ntype Generator struct{}\n",
		"poll_windows.go": "package m\n\ntype WindowsOnly struct{}\n",
		"linux.go":        "//go:build linux\n\npackage m\n\ntype LinuxOnly struct{}\n",
		"notwin.go":       "//go:build !windows\n\npackage m\n\ntype NotWindows struct{}\n",
		"stray.go":        "package other\n\ntype Stray struct{}\n",
	})
	for _, want := range []string{"Kept", "WindowsOnly", "LinuxOnly", "NotWindows"} {
		if len(named(g, want)) != 1 {
			t.Errorf("%s should be a node, got %v", want, ids(g))
		}
	}
	for _, not := range []string{"InTest", "Vendored", "Data", "Hidden", "Underscore", "OtherModule", "Deeper", "Generator", "Stray"} {
		if len(named(g, not)) != 0 {
			t.Errorf("%s should not be walked", not)
		}
	}
}

// ---------------------------------------------------------------------------
// Requirement: Type declarations and top-level functions become nodes

func TestNodes(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go": `package m

type S struct{ A int }
type I interface{ M() }
type Celsius float64
type Alias = S

type (
	G1 struct{}
	G2 int
)

func Parse(s string) error { return nil }

func init() {}
func init() {}
func _()    {}

const Limit = 10

var v = 1
`,
	})
	for _, c := range [][2]string{{"struct", "S"}, {"interface", "I"}, {"type", "Celsius"}, {"type", "Alias"}, {"struct", "G1"}, {"type", "G2"}, {"function", "Parse"}} {
		mustNode(t, g, nodeID(dir, "a.go", c[0], c[1]))
	}
	for _, not := range []string{"init", "_", "Limit", "v"} {
		if len(named(g, not)) != 0 {
			t.Errorf("%s should not be a node", not)
		}
	}
	uniqueIDs(t, g)
}

func TestNodeLinesNameTheDeclaration(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go": "package m\n\n// Doc.\ntype S struct {\n\tA int\n}\n\nfunc F() {\n}\n",
	})
	s := mustNode(t, g, nodeID(dir, "a.go", "struct", "S"))
	if s.Line != 4 || s.EndLine != 6 {
		t.Errorf("S spans %d-%d, want 4-6", s.Line, s.EndLine)
	}
	f := mustNode(t, g, nodeID(dir, "a.go", "function", "F"))
	if f.Line != 8 || f.EndLine != 9 {
		t.Errorf("F spans %d-%d, want 8-9", f.Line, f.EndLine)
	}
}

// ---------------------------------------------------------------------------
// Requirement: A method belongs to its receiver's type

// The calls a member records: the methods it calls on the receiver its own
// declaration names.
func TestMemberCalls(t *testing.T) {
	g, _ := module(t, map[string]string{
		"parser.go": "package m\n\ntype Parser struct{ s *Scanner }\n\n" +
			"func (p *Parser) Statement() { p.Expr(); p.Expr(); Helper() }\n\n" +
			"func (p *Parser) Expr() { p.s.Next() }\n\n" +
			"func (Parser) Nameless() {}\n\n" +
			"func Helper() {}\n",
		"scanner.go": "package m\n\ntype Scanner struct{}\n\nfunc (s *Scanner) Next() {}\n",
	})
	calls := func(typ, member string) []string {
		for _, n := range g.Nodes {
			if n.Name != typ {
				continue
			}
			for _, m := range n.Members {
				if m.Name == member {
					return m.Calls
				}
			}
		}
		t.Fatalf("no member %s.%s", typ, member)
		return nil
	}
	// Written twice, recorded once; a package-level function is not a member.
	if got := calls("Parser", "Statement"); len(got) != 1 || got[0] != "Expr" {
		t.Errorf("Statement should call Expr once, got %v", got)
	}
	// `p.s.Next()` is a call on a field, not on the receiver.
	if got := calls("Parser", "Expr"); len(got) != 0 {
		t.Errorf("Expr should record no calls, got %v", got)
	}
	// A receiver with no name cannot be written in the body.
	if got := calls("Parser", "Nameless"); len(got) != 0 {
		t.Errorf("a nameless receiver should record no calls, got %v", got)
	}
}

func TestMemberPoints(t *testing.T) {
	g, dir := module(t, map[string]string{
		"parser.go": "package m\n\ntype Parser struct{ s *Scanner }\n\n" +
			"func (p *Parser) Statement(t Token) Token { Helper(); Helper(); return t }\n\n" +
			"func (p *Parser) Expr() { p.s.Next() }\n\n" +
			"func (p *Parser) Quiet() {}\n\n" +
			"func (p *Parser) Self() *Parser { return p }\n\n" +
			"func Helper() {}\n",
		"scanner.go": "package m\n\ntype Scanner struct{}\n\nfunc (s *Scanner) Next() {}\n\ntype Token struct{}\n",
	})
	points := func(typ, member string) []string {
		for _, n := range g.Nodes {
			if n.Name != typ {
				continue
			}
			for _, m := range n.Members {
				if m.Name == member {
					return m.Points
				}
			}
		}
		t.Fatalf("no member %s.%s", typ, member)
		return nil
	}
	id := func(file, kind, name string) string {
		return filepath.Join(dir, file) + "::" + kind + "::" + name
	}
	// A signature's type and a function the body calls, each recorded once
	// however often the body writes it.
	want := []string{id("scanner.go", "struct", "Token"), id("parser.go", "function", "Helper")}
	got := points("Parser", "Statement")
	sort.Strings(want)
	sorted := append([]string(nil), got...)
	sort.Strings(sorted)
	if strings.Join(sorted, ",") != strings.Join(want, ",") {
		t.Errorf("Statement should record %v, got %v", want, got)
	}
	// `p.s.Next()` is a call on a field: the type checker resolves it to
	// `Scanner`, and it is the method that wrote it.
	if got := points("Parser", "Expr"); len(got) != 1 || got[0] != id("scanner.go", "struct", "Scanner") {
		t.Errorf("Expr should record Scanner, got %v", got)
	}
	if got := points("Parser", "Quiet"); len(got) != 0 {
		t.Errorf("a method that names nothing outside should record nothing, got %v", got)
	}
	// A node has no edge to itself, so there is nothing for the member to name.
	if got := points("Parser", "Self"); len(got) != 0 {
		t.Errorf("a method naming its own type should record nothing, got %v", got)
	}
	// What a member records is an edge its own node has.
	has := map[string]bool{}
	for _, e := range g.Edges {
		has[e.From+"\x00"+e.To] = true
	}
	for _, n := range g.Nodes {
		for _, m := range n.Members {
			for _, to := range m.Points {
				if !has[n.ID+"\x00"+to] {
					t.Errorf("%s.%s records %s, which its node has no edge to", n.Name, m.Name, to)
				}
			}
		}
	}
}

func TestMethods(t *testing.T) {
	g, dir := module(t, map[string]string{
		"server.go":      "package m\n\ntype Server struct{ log Logger }\n",
		"server_http.go": "package m\n\nfunc (s *Server) Start() { NewRouter() }\n",
		"router.go":      "package m\n\nfunc NewRouter() {}\n",
		"pipe.go":        "package m\n\ntype PipeReader struct{}\ntype PipeWriter struct{}\n\nfunc (r *PipeReader) Close() error { return nil }\nfunc (w *PipeWriter) Close() error { return nil }\n",
		"use.go":         "package m\n\nfunc Run(srv *Server) { srv.Start() }\n\nfunc Peek(s Server) { _ = s.log }\n",
		"embed.go":       "package m\n\ntype Logger struct{}\n\nfunc (l Logger) Log() {}\n\ntype Wrapped struct{ Logger }\n\nfunc Emit(w Wrapped) { w.Log() }\n",
	})
	for _, not := range []string{"Start", "Close", "Log"} {
		if len(named(g, not)) != 0 {
			t.Errorf("method %s should not be a node", not)
		}
	}
	uniqueIDs(t, g)
	server := nodeID(dir, "server.go", "struct", "Server")
	expectEdge(t, g, server, nodeID(dir, "router.go", "function", "NewRouter"), "uses")
	expectEdge(t, g, nodeID(dir, "use.go", "function", "Run"), server, "uses")
	expectEdge(t, g, nodeID(dir, "use.go", "function", "Peek"), server, "uses")
	expectEdge(t, g, nodeID(dir, "embed.go", "function", "Emit"), nodeID(dir, "embed.go", "struct", "Logger"), "uses")
}

func TestGenericReceiver(t *testing.T) {
	g, dir := module(t, map[string]string{
		"list.go": "package m\n\ntype List[T any] struct{ head *T }\n\nfunc (l *List[T]) Push(v T) { Helper() }\n\nfunc Helper() {}\n\nfunc Use() { var l List[int]; l.Push(1); _ = l.head }\n",
		// Each of these reaches List one way only, so a field or a method of an
		// instantiated type that failed to find its declaration would leave it
		// with nothing but the parameter's reference.
		"peek.go": "package m\n\nfunc PeekHead(l List[int]) { _ = l.head }\n\nfunc PushOne(l *List[int]) { l.Push(1) }\n",
		"map.go":  "package m\n\nfunc Map[T any](v T) T { return v }\n\nfunc CallMap() { Map[int](1) }\n",
	})
	list := nodeID(dir, "list.go", "struct", "List")
	expectEdge(t, g, list, nodeID(dir, "list.go", "function", "Helper"), "uses")
	expectEdge(t, g, nodeID(dir, "list.go", "function", "Use"), list, "uses")
	expectEdge(t, g, nodeID(dir, "peek.go", "function", "PeekHead"), list, "uses")
	expectEdge(t, g, nodeID(dir, "peek.go", "function", "PushOne"), list, "uses")
	expectEdge(t, g, nodeID(dir, "map.go", "function", "CallMap"), nodeID(dir, "map.go", "function", "Map"), "uses")
}

// ---------------------------------------------------------------------------
// Requirement: Package-level code belongs to the package

func TestPackageLevelCode(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a/a.go": "package a\n\nimport \"example.com/m/b\"\n\nfunc init() { b.Register() }\n\nvar defaultServer = &b.Server{}\n\nfunc _() { b.Helper() }\n",
		"b/b.go": "package b\n\nfunc Register() {}\n\nfunc Helper() {}\n\ntype Server struct{}\n",
	})
	pkg := nodeID(dir, "a/a.go", "package", "a")
	mustNode(t, g, pkg)
	expectEdge(t, g, pkg, nodeID(dir, "b/b.go", "function", "Register"), "uses")
	expectEdge(t, g, pkg, nodeID(dir, "b/b.go", "struct", "Server"), "uses")
	expectEdge(t, g, pkg, nodeID(dir, "b/b.go", "function", "Helper"), "uses")
}

// ---------------------------------------------------------------------------
// Requirement: A package is a node that contains what is declared in it

func TestPackages(t *testing.T) {
	g, dir := module(t, map[string]string{
		"server/a.go":        "package server\n\ntype A struct{}\n",
		"server/consts.go":   "package server\n\nconst Limit = 1\n",
		"server/doc.go":      "// Package server serves.\npackage server\n",
		"server/z.go":        "package server\n\nfunc Z() {}\n",
		"plain/b.go":         "package plain\n\nfunc B() {}\n",
		"plain/c.go":         "package plain\n\nfunc C() {}\n",
		"cmd/server/main.go": "package main\n\nfunc main() {}\n",
		"cmd/client/main.go": "package main\n\nfunc main() {}\n",
		"dep/user.go":        "package dep\n\nimport \"example.com/m/server\"\n\nfunc Call() { server.Z() }\n",
		"refonly/r.go":       "package refonly\n\nimport \"example.com/m/server\"\n\nfunc Take(a server.A) {}\n",
	})
	uniqueIDs(t, g)
	pkgs := 0
	for _, n := range g.Nodes {
		if n.Kind == "package" {
			pkgs++
		}
	}
	if pkgs != 6 {
		t.Errorf("want 6 package nodes, got %d: %v", pkgs, ids(g))
	}
	server := mustNode(t, g, nodeID(dir, "server/doc.go", "package", "server"))
	if server.Line != 2 {
		t.Errorf("server should sit on doc.go's package clause (line 2), got line %d", server.Line)
	}
	plain := mustNode(t, g, nodeID(dir, "plain/b.go", "package", "plain"))
	if plain.Line != 1 {
		t.Errorf("plain should sit on b.go line 1, got %d", plain.Line)
	}
	mustNode(t, g, nodeID(dir, "cmd/server/main.go", "package", "main"))
	mustNode(t, g, nodeID(dir, "cmd/client/main.go", "package", "main"))

	expectEdge(t, g, server.ID, nodeID(dir, "server/a.go", "struct", "A"), "contains")
	expectEdge(t, g, server.ID, nodeID(dir, "server/z.go", "function", "Z"), "contains")
	expectEdge(t, g, server.ID, nodeID(dir, "server/consts.go", "file", "consts.go"), "contains")
	if node(g, nodeID(dir, "server/doc.go", "file", "doc.go")) != nil {
		t.Errorf("doc.go holds a package node and should not also have a file node")
	}
	expectEdge(t, g, nodeID(dir, "dep/user.go", "package", "dep"), server.ID, "uses")
	expectEdge(t, g, nodeID(dir, "refonly/r.go", "package", "refonly"), server.ID, "references")
}

// ---------------------------------------------------------------------------
// Requirement: Names are resolved by the type checker, within the module

func TestResolution(t *testing.T) {
	t.Setenv("GOPROXY", "off")
	t.Setenv("GOFLAGS", "-mod=mod")
	t.Setenv("GOMODCACHE", t.TempDir())
	g, dir := module(t, map[string]string{
		"go.mod":            goMod + "\nrequire github.com/ext/lib v1.2.3\n",
		"a/a.go":            "package a\n\nimport (\n\t\"fmt\"\n\n\t\"example.com/m/b\"\n\t\"github.com/ext/lib\"\n)\n\nfunc Use() { b.New(); lib.Do(); fmt.Println() }\n",
		"b/b.go":            "package b\n\nfunc New() {}\n",
		"b/call.go":         "package b\n\nfunc Caller() { open() }\n",
		"b/open_unix.go":    "package b\n\nfunc open() {}\n",
		"b/open_windows.go": "package b\n\nfunc open() {}\n",
		"c/broken.go":       "package c\n\nfunc Bad() int { return \"not an int\" }\n\nfunc Good() { Target() }\n\nfunc Target() {}\n",
	})
	use := nodeID(dir, "a/a.go", "function", "Use")
	out := edgesFrom(g, use)
	want := map[string]string{nodeID(dir, "b/b.go", "function", "New"): "uses"}
	if len(out) != 1 || out[nodeID(dir, "b/b.go", "function", "New")] != "uses" {
		t.Errorf("Use should point only to b.New, got %v, want %v", out, want)
	}
	expectEdge(t, g, nodeID(dir, "b/call.go", "function", "Caller"), nodeID(dir, "b/open_unix.go", "function", "open"), "uses")
	if edgeKind(g, nodeID(dir, "b/call.go", "function", "Caller"), nodeID(dir, "b/open_windows.go", "function", "open")) != "" {
		t.Errorf("when two platforms both declare open, only the first by name should be pointed to")
	}
	expectEdge(t, g, nodeID(dir, "c/broken.go", "function", "Good"), nodeID(dir, "c/broken.go", "function", "Target"), "uses")
}

// ---------------------------------------------------------------------------
// Requirement: Embedding is inherits, a type position is a reference, anything else is a use

func TestEdgeKinds(t *testing.T) {
	g, dir := module(t, map[string]string{
		"e.go": `package m

type Logger struct{}
type Reader interface{ Read() }
type Writer interface{ Write() }
type ReadWriter interface {
	Reader
	Writer
}
type Server struct {
	*Logger
}
type Config struct{ Port int }
type Holder struct {
	cfg Config
}
type Both struct {
	Logger
	l Logger
}

func Build() Config { return Config{Port: 80} }

func Parse() { Build() }

type File struct{}

func (File) Read() {}

func init() { _ = Holder{} }
`,
	})
	n := func(kind, name string) string { return nodeID(dir, "e.go", kind, name) }
	expectEdge(t, g, n("struct", "Server"), n("struct", "Logger"), "inherits")
	expectEdge(t, g, n("interface", "ReadWriter"), n("interface", "Reader"), "inherits")
	expectEdge(t, g, n("interface", "ReadWriter"), n("interface", "Writer"), "inherits")
	expectEdge(t, g, n("struct", "Holder"), n("struct", "Config"), "references")
	expectEdge(t, g, n("function", "Build"), n("struct", "Config"), "uses")
	expectEdge(t, g, n("function", "Parse"), n("function", "Build"), "uses")
	expectEdge(t, g, n("struct", "Both"), n("struct", "Logger"), "inherits")
	if k := edgeKind(g, n("struct", "File"), n("interface", "Reader")); k != "" {
		t.Errorf("implementing an interface should draw no edge, got %q", k)
	}
	if k := edgeKind(g, n("interface", "Reader"), n("struct", "File")); k != "" {
		t.Errorf("implementing an interface should draw no edge (reverse direction), got %q", k)
	}
	expectEdge(t, g, nodeID(dir, "e.go", "package", "m"), n("struct", "Holder"), "contains")
	pairs := map[string]bool{}
	for _, e := range g.Edges {
		key := e.From + " " + e.To
		if pairs[key] {
			t.Errorf("two edges for the same node pair: %s", key)
		}
		pairs[key] = true
	}
}

// ---------------------------------------------------------------------------
// Requirement: What this analyzer excludes from becoming a file node

func TestFileNodes(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go":       "package m\n\ntype T struct{}\n",
		"consts.go":  "package m\n\nconst Limit = 10\n",
		"doc.go":     "// Package m.\npackage m\n",
		"methods.go": "package m\n\nfunc (t T) M() {}\n",
	})
	files := []string{}
	for _, n := range g.Nodes {
		if n.Kind == "file" {
			files = append(files, filepath.Base(n.File))
		}
	}
	if strings.Join(files, ",") != "consts.go" {
		t.Errorf("only consts.go should be a file node, got %v", files)
	}
	f := mustNode(t, g, nodeID(dir, "consts.go", "file", "consts.go"))
	if f.Line != 1 || f.EndLine != 1 {
		t.Errorf("the file node should be on line 1, got %d-%d", f.Line, f.EndLine)
	}
}

// ---------------------------------------------------------------------------
// Requirement (artifact): The same document serialises to the same bytes

func TestSerialisation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "x<y&z")
	writeModule(t, dir, map[string]string{
		"a.go": "package m\n\ntype A struct{ b B }\ntype B struct{}\n\nfunc F() { _ = A{} }\n",
	})
	g1, err := Analyze([]string{dir})
	if err != nil {
		t.Fatal(err)
	}
	g2, _ := Analyze([]string{dir})
	b1, _ := Encode(g1)
	b2, _ := Encode(g2)
	if !bytes.Equal(b1, b2) {
		t.Errorf("two analyses gave different bytes")
	}
	text := string(b1)
	if !strings.Contains(text, "x<y&z") || strings.Contains(text, `\u003c`) || strings.Contains(text, `\u0026`) {
		t.Errorf("< and & in a path should be written as they are")
	}
	lines := strings.Split(text, "\n")
	if len(lines) < 2 || lines[1] != `  "nodes": [` {
		t.Errorf("the second line should be nodes indented two spaces, got %q", lines[1])
	}
	if !strings.HasSuffix(text, "}\n") || strings.HasSuffix(text, "\n\n") {
		t.Errorf("should end with a single newline")
	}
	if len(g1.Edges) == 0 {
		t.Fatalf("this module should have edges")
	}
	for i := 1; i < len(g1.Edges); i++ {
		a, b := g1.Edges[i-1], g1.Edges[i]
		if a.From > b.From || (a.From == b.From && (a.To > b.To || (a.To == b.To && a.Kind > b.Kind))) {
			t.Errorf("edges not sorted by from/to/kind: %v before %v", a, b)
		}
	}
	first := strings.Index(text, `"id"`)
	if first < 0 || strings.Index(text[first:], `"kind"`) > strings.Index(text[first:], `"name"`) {
		t.Errorf("node key order should be id, kind, name, file, line, endLine")
	}
}

// Embedding is inherits only where a declared type embeds another. An anonymous
// struct built inside a function, or nested in a field, gives nothing its
// methods that a reader would call a family: read as inherits, hugo's XxHasher
// and prometheus's instantValue would be functions that inherit.
func TestEmbeddingOutsideADeclarationIsAReference(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go": "package m\n\ntype Hasher struct{}\n\nfunc Make() any { return struct{ Hasher }{} }\n\ntype Outer struct {\n\tinner struct{ Hasher }\n}\n\nfunc Local() { type wrap struct{ Hasher }; _ = wrap{} }\n",
	})
	hasher := nodeID(dir, "a.go", "struct", "Hasher")
	expectEdge(t, g, nodeID(dir, "a.go", "function", "Make"), hasher, "uses")
	expectEdge(t, g, nodeID(dir, "a.go", "struct", "Outer"), hasher, "references")
	// A type declared inside a function is a type position like any other.
	expectEdge(t, g, nodeID(dir, "a.go", "function", "Local"), hasher, "references")
	for _, e := range g.Edges {
		if e.Kind == "inherits" {
			t.Errorf("no type declaration here embeds another type, so there should be no inherits: %s -> %s", e.From, e.To)
		}
	}
}

// A file whose every declaration is an import declares nothing of its own, and
// the contract excludes it. Go has no re-export, but it has the blank import:
// prometheus's plugins directory is 26 files that each register one discovery
// plugin, and drawn they would be a ring of file nodes around nothing. A file
// with no declaration at all is still a file node, as it is for TypeScript.
func TestImportOnlyFileIsNotAFileNode(t *testing.T) {
	g, _ := module(t, map[string]string{
		"doc.go":        "// Package m.\npackage m\n",
		"a.go":          "package m\n\ntype T struct{}\n",
		"plugin_aws.go": "package m\n\nimport (\n\t_ \"example.com/m/aws\" // Register aws plugin.\n)\n",
		"plugin_two.go": "package m\n\nimport _ \"example.com/m/aws\"\nimport \"fmt\"\n\nvar _ = fmt.Sprint\n",
		"bare.go":       "package m\n",
		"aws/aws.go":    "package aws\n\nfunc init() {}\n",
	})
	files := []string{}
	for _, n := range g.Nodes {
		if n.Kind == "file" {
			files = append(files, filepath.Base(n.File))
		}
	}
	sort.Strings(files)
	if got := strings.Join(files, ","); got != "bare.go,plugin_two.go" {
		t.Errorf("the file nodes should be bare.go and plugin_two.go, got %q", got)
	}
}

// A method is its receiver's, and the type says so. A Go reader searches for
// `Head.Appender` and `Labels.String`; prometheus declares 4,429 methods over
// 699 types, and a drawing without them finds none of the 36 `Append`, 86
// `Close`, 28 `Run` or 5 `Start` its source holds.

func memberNames(n *Node) string {
	out := []string{}
	for _, m := range n.Members {
		out = append(out, m.Name)
	}
	return strings.Join(out, ",")
}

func TestATypeRecordsItsMethods(t *testing.T) {
	g, dir := module(t, map[string]string{
		"server.go":      "package m\n\ntype Server struct{}\n\nfunc (s *Server) Start() {}\n\nfunc (s Server) Addr() string { return \"\" }\n",
		"server_http.go": "package m\n\nfunc (s *Server) ServeHTTP() {}\n",
		"pipe.go":        "package m\n\ntype PipeReader struct{}\ntype PipeWriter struct{}\n\nfunc (r *PipeReader) Close() error { return nil }\nfunc (w *PipeWriter) Close() error { return nil }\n",
		// A method may be named `_`, and nothing can call it — the same reason
		// `func _` is not a node. It is not a member either.
		"plain.go": "package m\n\ntype Plain struct{}\n\nfunc (p Plain) _() {}\n\nfunc Loose() {}\n\nfunc init() {}\n\nfunc _() {}\n",
	})
	server := mustNode(t, g, nodeID(dir, "server.go", "struct", "Server"))
	// Declaration order within a file, and files in name order.
	if got := memberNames(server); got != "Start,Addr,ServeHTTP" {
		t.Errorf("Server's methods should be recorded in declaration order, got %q", got)
	}
	for _, m := range server.Members {
		if m.Name == "ServeHTTP" {
			if filepath.Base(m.File) != "server_http.go" {
				t.Errorf("a method should record the file that declares it, got %s", m.File)
			}
			if m.Line != 3 {
				t.Errorf("ServeHTTP's line should be 3, got %d", m.Line)
			}
		}
	}
	if got := memberNames(mustNode(t, g, nodeID(dir, "pipe.go", "struct", "PipeReader"))); got != "Close" {
		t.Errorf("PipeReader should have only its own Close, got %q", got)
	}
	if got := memberNames(mustNode(t, g, nodeID(dir, "pipe.go", "struct", "PipeWriter"))); got != "Close" {
		t.Errorf("PipeWriter should also have only its own Close, got %q", got)
	}
	if got := memberNames(mustNode(t, g, nodeID(dir, "plain.go", "struct", "Plain"))); got != "" {
		t.Errorf("Plain should have no methods, got %q", got)
	}
	// init, func _ and a top-level function are nobody's member.
	for _, n := range g.Nodes {
		for _, m := range n.Members {
			if m.Name == "init" || m.Name == "_" || m.Name == "Loose" {
				t.Errorf("%s should not be a member of %s", m.Name, n.Name)
			}
		}
	}
}

func TestAMemberIsNotANode(t *testing.T) {
	g, _ := module(t, map[string]string{
		"a.go": "package m\n\ntype T struct{}\n\nfunc (t T) M() {}\n",
	})
	ids := map[string]bool{}
	for _, n := range g.Nodes {
		ids[n.ID] = true
	}
	for _, n := range g.Nodes {
		for _, m := range n.Members {
			if ids[makeID(m.File, "function", m.Name)] {
				t.Errorf("member %s is also a node", m.Name)
			}
		}
	}
	if len(mustNode(t, g, nodeID(dir(g), "a.go", "struct", "T")).Members) != 1 {
		t.Errorf("T should have one member")
	}
}

/** The directory a graph was written from, taken off any node's path. */
func dir(g *Graph) string {
	for _, n := range g.Nodes {
		return filepath.Dir(n.File)
	}
	return ""
}

// What a codebase marks as not for reaching is the language's to say. Go says it
// with the case of the first letter, which is what its own compiler reads, and
// 40% of hugo's types and 45% of prometheus's carry that mark without an
// underscore anywhere in sight.

func TestAnUnexportedNameIsInternal(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go": "package m\n\ntype Head struct{}\ntype scrapeLoop struct{}\n\ntype Reader interface{ Read() }\ntype reader interface{ Read() }\n\nfunc Parse() {}\nfunc parse() {}\n",
		// Declares nothing, so it is drawn as itself: a file node, whose name is
		// a file name.
		"zz_const.go": "package m\n\nconst limit = 10\n",
	})
	want := map[string]bool{"scrapeLoop": true, "reader": true, "parse": true}
	for _, c := range []struct{ rel, kind, name string }{
		{"a.go", "struct", "Head"}, {"a.go", "struct", "scrapeLoop"},
		{"a.go", "interface", "Reader"}, {"a.go", "interface", "reader"},
		{"a.go", "function", "Parse"}, {"a.go", "function", "parse"},
	} {
		n := mustNode(t, g, nodeID(dir, c.rel, c.kind, c.name))
		if n.Internal != want[c.name] {
			t.Errorf("%s internal should be %v, got %v", c.name, want[c.name], n.Internal)
		}
	}
	// A Go package name is always lower case, and an import path is how a
	// package is reached: it is not a visibility mark. Nor is a file's name.
	// Read literally, the case rule would mark every package and every file in
	// every Go drawing.
	for _, n := range g.Nodes {
		if (n.Kind == "package" || n.Kind == "file") && n.Internal {
			t.Errorf("%s node %s should not be marked internal", n.Kind, n.Name)
		}
	}
}

func TestTheFlagIsWrittenOnlyWhereItHolds(t *testing.T) {
	g, _ := module(t, map[string]string{
		"a.go": "package m\n\ntype hidden struct{}\n\ntype Shown struct{}\n",
	})
	first, err := Encode(g)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	second, err := Encode(g)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Errorf("encoding the same graph twice should give identical bytes")
	}
	out := string(first)
	if !strings.Contains(out, "\"internal\": true") {
		t.Errorf("an unexported type should write internal, got:\n%s", out)
	}
	// `Shown` is not internal, and an artifact that records nothing anywhere is
	// byte-identical to what a producer that never marks anything writes.
	if n := strings.Count(out, "\"internal\""); n != 1 {
		t.Errorf("only hidden should write internal, it appeared %d times", n)
	}
}

// Go marks what is not for reaching twice: with the case of the first letter,
// and with an `internal/` directory, which the compiler enforces. hugo declares
// 463 nodes under one, 188 of them types and functions whose exported-looking
// names say nothing at all.

func TestTheInternalDirectoryIsAlsoInternal(t *testing.T) {
	g, dir := module(t, map[string]string{
		"a.go":                          "package m\n\ntype Head struct{}\n",
		"internal/store/store.go":       "package store\n\ntype Store struct{}\n\nfunc Open() {}\n\ntype Reader interface{ Read() }\n",
		"internals/util/util.go":        "package util\n\ntype Helper struct{}\n",
		"internal/deep/internal/x/x.go": "package x\n\ntype Nested struct{}\n",
		// Declares no symbol and holds no method, so it is drawn as itself: a
		// file node, which the location test reaches like any other node.
		"internal/store/zz.go": "package store\n\nconst limit = 1\n",
	})
	for _, c := range []struct {
		rel, kind, name string
		want            bool
		why             string
	}{
		// The capital letter is the point: the name test says nothing here.
		{"internal/store/store.go", "struct", "Store", true, "a type under internal/"},
		{"internal/store/store.go", "function", "Open", true, "a function under internal/"},
		{"internal/store/store.go", "interface", "Reader", true, "an interface under internal/"},
		{"internal/store/store.go", "package", "store", true, "a package node under internal/"},
		{"internal/deep/internal/x/x.go", "struct", "Nested", true, "nested internal/"},
		{"internal/store/zz.go", "file", "zz.go", true, "a file node under internal/"},
		// A directory that merely begins with the word is an ordinary one.
		{"internals/util/util.go", "struct", "Helper", false, "internals/ is not internal/"},
		{"internals/util/util.go", "package", "util", false, "a package node under internals/"},
		{"a.go", "struct", "Head", false, "an exported type not under internal/"},
	} {
		n := mustNode(t, g, nodeID(dir, c.rel, c.kind, c.name))
		if n.Internal != c.want {
			t.Errorf("%s: %s internal should be %v, got %v", c.why, c.name, c.want, n.Internal)
		}
	}
}
