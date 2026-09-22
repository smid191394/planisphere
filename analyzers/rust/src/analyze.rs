//! Reads Rust source into the artifact.
//!
//! One pass builds the module tree — from the crates the manifests name, then
//! from every walked file no crate reached — following `mod` lines and pruning
//! `#[cfg(test)]` before anything else reads it. One pass declares the nodes.
//! One records members and edges, resolving a name by what the source declares
//! and imports. Nothing is type-checked, compiled or fetched.

use crate::graph::{js_cmp, Edge, Graph, Member, Node};
use crate::{manifest, walk};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use syn::ext::IdentExt;
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Item, Token};

/// The artifact's precedence for one ordered pair, weakest first.
const KINDS: [&str; 5] = ["", "references", "uses", "inherits", "contains"];

/// How far a chain of re-exports is followed before it is taken to lead nowhere.
const MAX_DEPTH: usize = 16;

fn rank(kind: &str) -> u8 {
    KINDS.iter().position(|k| *k == kind).unwrap_or(0) as u8
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Ns {
    Type,
    Value,
}

struct Module {
    /// The file this module's items are written in.
    file: PathBuf,
    /// Where a `mod name;` in this module looks for its file.
    child_dir: PathBuf,
    parent: Option<usize>,
    /// The crate root that `crate::` resolves against.
    root: usize,
    /// The unit node standing for this module, where one does.
    unit: Option<String>,
    items: Vec<Item>,
    children: HashMap<String, usize>,
    /// A file's own module, rather than one written inline or not found.
    owns_file: bool,
    /// Every item is a `use`, an `extern crate` or a `mod` declaration.
    wiring: bool,
    /// It had items, and every one of them was `#[cfg(test)]`.
    pruned_all: bool,
}

impl Module {
    fn new(file: PathBuf, child_dir: PathBuf, parent: Option<usize>, root: usize, unit: Option<String>, owns_file: bool) -> Module {
        Module { file, child_dir, parent, root, unit, items: Vec::new(), children: HashMap::new(), owns_file, wiring: false, pruned_all: false }
    }
}

#[derive(Default)]
struct Scope {
    types: HashMap<String, String>,
    values: HashMap<String, String>,
    aliases: HashMap<String, Vec<String>>,
    globs: Vec<Vec<String>>,
}

struct Analysis {
    walked: HashSet<PathBuf>,
    claimed: HashSet<PathBuf>,
    modules: Vec<Module>,
    scopes: Vec<Scope>,
    nodes: Vec<Node>,
    node_index: HashMap<String, usize>,
    /// The unit that contains each node: one entry per node, so no node is
    /// contained twice, and the last declaration wins as it does for the node.
    container: HashMap<String, String>,
    edges: HashMap<(String, String), u8>,
    /// Lookups in progress, so a re-export that leads back to itself ends.
    resolving_items: RefCell<HashSet<(usize, String, Ns)>>,
    resolving_modules: RefCell<HashSet<(usize, String)>>,
}

type Found = Vec<(String, String, &'static str)>;

pub fn analyze(roots: &[PathBuf]) -> Graph {
    let roots: Vec<PathBuf> = roots.iter().map(|r| absolute(r)).collect();
    let walked = walk::walk(&roots);
    let mut a = Analysis {
        walked: walked.sources.iter().cloned().collect(),
        claimed: HashSet::new(),
        modules: Vec::new(),
        scopes: Vec::new(),
        nodes: Vec::new(),
        node_index: HashMap::new(),
        container: HashMap::new(),
        edges: HashMap::new(),
        resolving_items: RefCell::new(HashSet::new()),
        resolving_modules: RefCell::new(HashSet::new()),
    };
    for manifest in &walked.manifests {
        a.crates(manifest);
    }
    // A file no crate reached is a root of its own. Crate-root names go first,
    // so that the tree such a file declares is its own rather than orphans.
    let mut rest: Vec<PathBuf> = walked.sources.iter().filter(|p| !a.claimed.contains(*p)).cloned().collect();
    rest.sort_by(|x, y| (!is_root_name(x), x).cmp(&(!is_root_name(y), y)));
    for path in rest {
        if !a.claimed.contains(&path) {
            let dir = orphan_child_dir(&path);
            a.file_module(path, dir, None, None);
        }
    }
    a.declare();
    a.relate();
    a.file_nodes();
    a.finish()
}

impl Analysis {
    fn available(&self, p: &Path) -> bool {
        self.walked.contains(p) && !self.claimed.contains(p)
    }

    fn add_node(&mut self, node: Node) {
        match self.node_index.get(&node.id) {
            // A name declared twice in one file — under two `cfg`s — keeps the
            // last declaration.
            Some(&i) => {
                let members = std::mem::take(&mut self.nodes[i].members);
                self.nodes[i] = node;
                self.nodes[i].members = members;
            }
            None => {
                self.node_index.insert(node.id.clone(), self.nodes.len());
                self.nodes.push(node);
            }
        }
    }

    fn contain(&mut self, unit: &str, child: &str) {
        self.container.insert(child.to_string(), unit.to_string());
    }

    fn add_edge(&mut self, from: &str, to: &str, kind: &str) {
        if from == to || !self.node_index.contains_key(from) || !self.node_index.contains_key(to) {
            return;
        }
        let r = rank(kind);
        let e = self.edges.entry((from.to_string(), to.to_string())).or_insert(r);
        if r > *e {
            *e = r;
        }
    }

    fn kind_of(&self, id: &str) -> Option<&str> {
        self.node_index.get(id).map(|&i| self.nodes[i].kind.as_str())
    }

    // -- the module tree ------------------------------------------------------

    /// The crates one manifest names: its library under the package's own name,
    /// and each `[[bin]]` that names itself.
    ///
    /// Then the roots Cargo builds without the manifest naming them — an implicit
    /// `src/main.rs`, a `src/bin/` root no `[[bin]]` claimed, and the build
    /// script. No line names any of them, so they join the crate node carrying
    /// the package's name, which lands on the package's `name` line. Left to
    /// the orphan pass they would have no crate above them, and `cargo new` writes
    /// exactly that shape.
    fn crates(&mut self, path: &Path) {
        let Ok(text) = fs::read_to_string(path) else { return };
        let m = manifest::read(&text);
        let dir = dir_of(path);
        let file = path.to_string_lossy().into_owned();

        let lib = clean(&dir.join(m.lib_path.as_deref().unwrap_or("src/lib.rs")));
        if self.available(&lib) {
            let unit = m.package.as_ref().map(|p| self.crate_node(&file, p));
            let cd = dir_of(&lib);
            self.file_module(lib, cd, None, unit);
        }
        for bin in &m.bins {
            let candidates = match &bin.path {
                Some(p) => vec![clean(&dir.join(p))],
                None => {
                    let src = dir.join("src");
                    let mut c = vec![src.join("bin").join(format!("{}.rs", bin.name)), src.join("bin").join(&bin.name).join("main.rs")];
                    if m.package.as_ref().is_some_and(|p| p.name == bin.name) {
                        c.push(src.join("main.rs"));
                    }
                    c
                }
            };
            if let Some(root) = candidates.into_iter().find(|p| self.available(p)) {
                let unit = Some(self.crate_node(&file, bin));
                let cd = dir_of(&root);
                self.file_module(root, cd, None, unit);
            }
        }

        let Some(package) = m.package.as_ref() else { return };
        let src = dir.join("src");
        let mut implicit = vec![src.join("main.rs")];
        let mut bins: Vec<PathBuf> = self
            .walked
            .iter()
            .filter(|p| {
                p.parent() == Some(src.join("bin").as_path())
                    || (p.file_name().is_some_and(|n| n == "main.rs")
                        && p.parent().and_then(|d| d.parent()) == Some(src.join("bin").as_path()))
            })
            .cloned()
            .collect();
        bins.sort();
        implicit.extend(bins);
        if !m.build_off {
            implicit.push(clean(&dir.join(m.build_path.as_deref().unwrap_or("build.rs"))));
        }
        for root in implicit {
            if !self.available(&root) {
                continue;
            }
            // The package's crate node, where one already stands for it — a
            // library, or a `[[bin]]` of the package's own name — and at the
            // package's `name` line otherwise.
            let id = format!("{file}::crate::{}", package.name);
            let unit = if self.node_index.contains_key(&id) { id } else { self.crate_node(&file, package) };
            let cd = dir_of(&root);
            self.file_module(root, cd, None, Some(unit));
        }
    }

    fn crate_node(&mut self, file: &str, named: &manifest::Named) -> String {
        let id = format!("{file}::crate::{}", named.name);
        // One line, no range: a manifest may name several crates, and a range
        // spanning it would contain all of them.
        self.add_node(Node { id: id.clone(), kind: "crate".into(), name: named.name.clone(), file: file.into(), line: named.line, end_line: None, internal: false, members: Vec::new() });
        id
    }

    fn unit_node(&mut self, file: &Path, name: &str, line: usize) -> String {
        let file = file.to_string_lossy().into_owned();
        let id = format!("{file}::mod::{name}");
        // One line, no range: an inline module's items are below its `mod`
        // line, and a range would put every one of them inside another node.
        self.add_node(Node { id: id.clone(), kind: "mod".into(), name: name.into(), file, line, end_line: None, internal: false, members: Vec::new() });
        id
    }

    fn file_module(&mut self, path: PathBuf, child_dir: PathBuf, parent: Option<usize>, unit: Option<String>) -> usize {
        self.claimed.insert(path.clone());
        let items = fs::read_to_string(&path).ok().and_then(|text| syn::parse_file(&text).ok()).map(|f| f.items).unwrap_or_default();
        let idx = self.modules.len();
        let root = parent.map_or(idx, |p| self.modules[p].root);
        self.modules.push(Module::new(path, child_dir, parent, root, unit, true));
        self.fill(idx, items);
        idx
    }

    /// Prune, expand and sort one module's items. `#[cfg(test)]` goes first, so
    /// nothing later ever reads it, and a `mod` becomes a child module.
    fn fill(&mut self, idx: usize, raw: Vec<Item>) {
        let total = raw.len();
        let mut live = Vec::with_capacity(total);
        for item in raw {
            if is_test(attrs(&item)) {
                if let Item::Mod(m) = &item {
                    if m.content.is_none() {
                        self.exclude_mod(idx, m);
                    }
                }
                continue;
            }
            live.push(item);
        }
        self.modules[idx].pruned_all = total > 0 && live.is_empty();
        self.modules[idx].wiring = !live.is_empty()
            && live.iter().all(|i| match i {
                Item::Use(_) | Item::ExternCrate(_) => true,
                Item::Mod(m) => m.content.is_none(),
                _ => false,
            });
        let mut kept = Vec::new();
        for item in expand(live, 0) {
            if is_test(attrs(&item)) {
                continue;
            }
            match item {
                Item::Mod(m) => self.child_module(idx, m),
                other => kept.push(other),
            }
        }
        self.modules[idx].items = kept;
    }

    fn child_module(&mut self, parent: usize, m: syn::ItemMod) {
        let name = ident_name(&m.ident);
        let decl_file = self.modules[parent].file.clone();
        let unit = self.unit_node(&decl_file, &name, m.ident.span().start().line);
        if let Some(p) = self.modules[parent].unit.clone() {
            self.contain(&p, &unit);
        }
        let parent_dir = self.modules[parent].child_dir.clone();
        let root = self.modules[parent].root;
        let idx = match m.content {
            Some((_, items)) => {
                let idx = self.modules.len();
                self.modules.push(Module::new(decl_file, parent_dir.join(&name), Some(parent), root, Some(unit), false));
                self.modules[parent].children.insert(name, idx);
                self.fill(idx, items);
                return;
            }
            None => {
                let via = path_attr(&m.attrs);
                match self.find_mod_file(&decl_file, &parent_dir, &name, via.as_deref()) {
                    Some((file, cd)) => self.file_module(file, cd, Some(parent), Some(unit)),
                    None => {
                        // Declared, but its file is not among what was walked. The
                        // unit is still in the source; it simply holds nothing.
                        let idx = self.modules.len();
                        self.modules.push(Module::new(decl_file, parent_dir.join(&name), Some(parent), root, Some(unit), false));
                        idx
                    }
                }
            }
        };
        self.modules[parent].children.insert(name, idx);
    }

    fn find_mod_file(&self, decl_file: &Path, parent_dir: &Path, name: &str, via: Option<&str>) -> Option<(PathBuf, PathBuf)> {
        if let Some(p) = via {
            let file = clean(&dir_of(decl_file).join(p));
            return self.available(&file).then(|| {
                let cd = dir_of(&file);
                (file, cd)
            });
        }
        let flat = parent_dir.join(format!("{name}.rs"));
        if self.available(&flat) {
            return Some((flat, parent_dir.join(name)));
        }
        let nested = parent_dir.join(name).join("mod.rs");
        if self.available(&nested) {
            return Some((nested, parent_dir.join(name)));
        }
        None
    }

    /// `#[cfg(test)] mod tests;` names a file of tests, and every file that
    /// file's own `mod` lines reach is tests too. They are claimed, so the
    /// orphan pass never takes them for roots, and never read into the drawing.
    fn exclude_mod(&mut self, parent: usize, m: &syn::ItemMod) {
        let decl_file = self.modules[parent].file.clone();
        let parent_dir = self.modules[parent].child_dir.clone();
        let via = path_attr(&m.attrs);
        if let Some((file, cd)) = self.find_mod_file(&decl_file, &parent_dir, &ident_name(&m.ident), via.as_deref()) {
            self.exclude_tree(file, cd);
        }
    }

    fn exclude_tree(&mut self, file: PathBuf, child_dir: PathBuf) {
        self.claimed.insert(file.clone());
        let Some(parsed) = fs::read_to_string(&file).ok().and_then(|t| syn::parse_file(&t).ok()) else { return };
        let mut pending = vec![(parsed.items, child_dir)];
        while let Some((items, dir)) = pending.pop() {
            for item in items {
                let Item::Mod(m) = item else { continue };
                let name = ident_name(&m.ident);
                match m.content {
                    Some((_, inner)) => pending.push((inner, dir.join(&name))),
                    None => {
                        let via = path_attr(&m.attrs);
                        if let Some((f, cd)) = self.find_mod_file(&file, &dir, &name, via.as_deref()) {
                            self.exclude_tree(f, cd);
                        }
                    }
                }
            }
        }
    }

    // -- nodes ----------------------------------------------------------------

    fn declare(&mut self) {
        for idx in 0..self.modules.len() {
            let file = self.modules[idx].file.to_string_lossy().into_owned();
            let unit = self.modules[idx].unit.clone();
            let items = std::mem::take(&mut self.modules[idx].items);
            let mut scope = Scope::default();
            for item in &items {
                let Some((kind, ident, vis)) = declared(item) else { continue };
                let name = ident_name(ident);
                let id = format!("{file}::{kind}::{name}");
                let line = ident.span().start().line;
                self.add_node(Node {
                    id: id.clone(),
                    kind: kind.into(),
                    name: name.clone(),
                    file: file.clone(),
                    line,
                    end_line: Some(item.span().end().line.max(line)),
                    // Rust states visibility with a keyword. `pub(crate)` and
                    // `pub(super)` reach no further than the crate.
                    internal: !matches!(vis, syn::Visibility::Public(_)),
                    members: Vec::new(),
                });
                if let Some(u) = &unit {
                    self.contain(u, &id);
                }
                if kind == "function" {
                    scope.values.insert(name, id);
                } else {
                    scope.types.insert(name, id);
                }
            }
            for item in &items {
                if let Item::Use(u) = item {
                    if u.leading_colon.is_none() {
                        flatten(&u.tree, &mut Vec::new(), &mut scope.aliases, &mut scope.globs);
                    }
                }
            }
            self.modules[idx].items = items;
            self.scopes.push(scope);
        }
    }

    fn file_nodes(&mut self) {
        let holding: HashSet<String> = self.nodes.iter().map(|n| n.file.clone()).collect();
        let member_files: HashSet<String> = self.nodes.iter().flat_map(|n| n.members.iter().map(|m| m.file.clone())).collect();
        let mut pending = Vec::new();
        for module in &self.modules {
            if !module.owns_file || module.wiring || module.pruned_all {
                continue;
            }
            let file = module.file.to_string_lossy().into_owned();
            // Represented by a node placed in it, or by the members it holds of a
            // type declared elsewhere.
            if holding.contains(&file) || member_files.contains(&file) {
                continue;
            }
            let name = module.file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            pending.push((file, name, module.unit.clone()));
        }
        for (file, name, unit) in pending {
            let id = format!("{file}::file::{name}");
            self.add_node(Node { id: id.clone(), kind: "file".into(), name, file, line: 1, end_line: Some(1), internal: false, members: Vec::new() });
            if let Some(u) = unit {
                self.contain(&u, &id);
            }
        }
    }

    // -- members and edges ----------------------------------------------------

    fn relate(&mut self) {
        let mut members: Vec<(String, Member)> = Vec::new();
        let mut found: Found = Vec::new();
        for idx in 0..self.modules.len() {
            let file = self.modules[idx].file.to_string_lossy().into_owned();
            for item in &self.modules[idx].items {
                self.relate_item(idx, &file, item, &mut members, &mut found);
            }
        }
        for (owner, member) in members {
            if let Some(&i) = self.node_index.get(&owner) {
                self.nodes[i].members.push(member);
            }
        }
        for (from, to, kind) in found {
            self.add_edge(&from, &to, kind);
        }
    }

    fn relate_item(&self, idx: usize, file: &str, item: &Item, members: &mut Vec<(String, Member)>, found: &mut Found) {
        let scope = &self.scopes[idx];
        let ty = |ident: &syn::Ident| scope.types.get(&ident_name(ident)).cloned();
        match item {
            Item::Struct(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.derives(idx, &owner, &i.attrs, found);
                self.collect(idx, &owner, Some(&owner), found, |c| c.visit_item_struct(i));
            }
            Item::Enum(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.derives(idx, &owner, &i.attrs, found);
                self.collect(idx, &owner, Some(&owner), found, |c| c.visit_item_enum(i));
            }
            Item::Union(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.derives(idx, &owner, &i.attrs, found);
                self.collect(idx, &owner, Some(&owner), found, |c| c.visit_item_union(i));
            }
            Item::Type(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.collect(idx, &owner, None, found, |c| c.visit_item_type(i));
            }
            Item::TraitAlias(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.supertraits(idx, &owner, i.bounds.iter(), found);
                self.collect(idx, &owner, Some(&owner), found, |c| c.visit_item_trait_alias(i));
            }
            Item::Trait(i) => {
                let Some(owner) = ty(&i.ident) else { return };
                self.supertraits(idx, &owner, i.supertraits.iter(), found);
                // A trait's own methods, signatures and default bodies alike.
                for ti in &i.items {
                    if let syn::TraitItem::Fn(f) = ti {
                        members.push((owner.clone(), member(file, &f.sig.ident)));
                    }
                }
                self.collect(idx, &owner, Some(&owner), found, |c| c.visit_item_trait(i));
            }
            Item::Fn(i) => {
                let Some(owner) = scope.values.get(&ident_name(&i.sig.ident)).cloned() else { return };
                self.collect(idx, &owner, None, found, |c| c.visit_item_fn(i));
            }
            Item::Impl(i) => self.relate_impl(idx, file, i, members, found),
            // Code at module level that no symbol owns is the module's, as Go's
            // package-level code is the package's.
            Item::Const(i) => {
                if let Some(owner) = self.modules[idx].unit.clone() {
                    self.collect(idx, &owner, None, found, |c| c.visit_item_const(i));
                }
            }
            Item::Static(i) => {
                if let Some(owner) = self.modules[idx].unit.clone() {
                    self.collect(idx, &owner, None, found, |c| c.visit_item_static(i));
                }
            }
            _ => {}
        }
    }

    fn relate_impl(&self, idx: usize, file: &str, i: &syn::ItemImpl, members: &mut Vec<(String, Member)>, found: &mut Found) {
        let generics = generic_names(&i.generics);
        let self_id = self_type_path(&i.self_ty).and_then(|p| self.resolve_path(idx, p, Ns::Type, &generics));
        let trait_id = i.trait_.as_ref().and_then(|(_, p, _)| self.resolve_path(idx, p, Ns::Type, &generics)).filter(|id| self.kind_of(id) == Some("trait"));
        let owner = match (&self_id, &trait_id) {
            (Some(t), _) => {
                for ii in &i.items {
                    if let syn::ImplItem::Fn(f) = ii {
                        members.push((t.clone(), member(file, &f.sig.ident)));
                    }
                }
                if let Some(r) = &trait_id {
                    found.push((t.clone(), r.clone(), "inherits"));
                }
                t.clone()
            }
            // The type is not in the document, so its members have nowhere to
            // go; what the body names is the trait's.
            (None, Some(r)) => r.clone(),
            (None, None) => return,
        };
        self.collect(idx, &owner, self_id.as_ref(), found, |c| c.visit_item_impl(i));
    }

    fn supertraits<'b>(&self, idx: usize, owner: &str, bounds: impl Iterator<Item = &'b syn::TypeParamBound>, found: &mut Found) {
        for bound in bounds {
            if let syn::TypeParamBound::Trait(tb) = bound {
                if let Some(t) = self.resolve_path(idx, &tb.path, Ns::Type, &[]) {
                    if self.kind_of(&t) == Some("trait") {
                        found.push((owner.to_string(), t, "inherits"));
                    }
                }
            }
        }
    }

    /// A derive is a trait implementation written as an attribute. It draws an
    /// edge only to a trait the source declares; `Clone` is not a node.
    fn derives(&self, idx: usize, owner: &str, attrs: &[syn::Attribute], found: &mut Found) {
        for attr in attrs {
            if !attr.path().is_ident("derive") {
                continue;
            }
            let Ok(paths) = attr.parse_args_with(Punctuated::<syn::Path, Token![,]>::parse_terminated) else { continue };
            for p in &paths {
                if let Some(t) = self.resolve_path(idx, p, Ns::Type, &[]) {
                    if self.kind_of(&t) == Some("trait") {
                        found.push((owner.to_string(), t, "inherits"));
                    }
                }
            }
        }
    }

    fn collect<F>(&self, idx: usize, owner: &str, self_ty: Option<&String>, found: &mut Found, visit: F)
    where
        F: FnOnce(&mut Collector<'_>),
    {
        let mut c = Collector { a: self, module: idx, self_ty: self_ty.cloned(), generics: Vec::new(), found: Vec::new() };
        visit(&mut c);
        for (to, kind) in c.found {
            found.push((owner.to_string(), to, kind));
        }
    }

    // -- resolution -----------------------------------------------------------

    fn resolve_path(&self, idx: usize, path: &syn::Path, ns: Ns, generics: &[String]) -> Option<String> {
        if path.leading_colon.is_some() {
            return None;
        }
        let segs: Vec<String> = path.segments.iter().map(|s| ident_name(&s.ident)).collect();
        if segs.len() == 1 && generics.contains(&segs[0]) {
            return None;
        }
        self.resolve(idx, &segs, ns, 0)
    }

    /// The node a path names from module `m`, or nothing. The path's leading
    /// segments name a module — `crate`, `self`, `super`, a child, or something
    /// imported — and the last names an item in it.
    fn resolve(&self, m: usize, segs: &[String], ns: Ns, depth: usize) -> Option<String> {
        if depth > MAX_DEPTH {
            return None;
        }
        let (last, path) = segs.split_last()?;
        if matches!(last.as_str(), "crate" | "self" | "super") {
            return None;
        }
        let here = self.module_path(m, path, depth + 1)?;
        self.item_named(here, last, ns, depth + 1)
    }

    fn module_path(&self, m: usize, segs: &[String], depth: usize) -> Option<usize> {
        if depth > MAX_DEPTH {
            return None;
        }
        let mut here = m;
        let mut rest = segs;
        if rest.first().is_some_and(|s| s == "crate") {
            here = self.modules[m].root;
            rest = &rest[1..];
        }
        for seg in rest {
            here = match seg.as_str() {
                "self" => here,
                "super" => self.modules[here].parent?,
                _ => self.module_named(here, seg, depth + 1)?,
            };
        }
        Some(here)
    }

    fn module_named(&self, m: usize, name: &str, depth: usize) -> Option<usize> {
        if depth > MAX_DEPTH {
            return None;
        }
        if let Some(&c) = self.modules[m].children.get(name) {
            return Some(c);
        }
        let key = (m, name.to_string());
        if !self.resolving_modules.borrow_mut().insert(key.clone()) {
            return None;
        }
        let scope = &self.scopes[m];
        let mut out = scope.aliases.get(name).and_then(|path| self.module_path(m, path, depth + 1));
        if out.is_none() {
            for glob in &scope.globs {
                if let Some(g) = self.module_path(m, glob, depth + 1) {
                    if let Some(&c) = self.modules[g].children.get(name) {
                        out = Some(c);
                        break;
                    }
                }
            }
        }
        self.resolving_modules.borrow_mut().remove(&key);
        out
    }

    fn item_named(&self, m: usize, name: &str, ns: Ns, depth: usize) -> Option<String> {
        if depth > MAX_DEPTH {
            return None;
        }
        let scope = &self.scopes[m];
        let table = if ns == Ns::Type { &scope.types } else { &scope.values };
        if let Some(id) = table.get(name) {
            return Some(id.clone());
        }
        let key = (m, name.to_string(), ns);
        if !self.resolving_items.borrow_mut().insert(key.clone()) {
            return None;
        }
        let mut out = scope.aliases.get(name).and_then(|path| self.resolve(m, path, ns, depth + 1));
        if out.is_none() {
            for glob in &scope.globs {
                if let Some(g) = self.module_path(m, glob, depth + 1) {
                    if g != m {
                        if let Some(id) = self.item_named(g, name, ns, depth + 1) {
                            out = Some(id);
                            break;
                        }
                    }
                }
            }
        }
        self.resolving_items.borrow_mut().remove(&key);
        out
    }

    fn finish(mut self) -> Graph {
        let contains: Vec<(String, String)> = self.container.iter().map(|(child, unit)| (unit.clone(), child.clone())).collect();
        for (unit, child) in contains {
            self.add_edge(&unit, &child, "contains");
        }
        let mut edges: Vec<Edge> = self.edges.into_iter().map(|((from, to), r)| Edge { from, to, kind: KINDS[r as usize].to_string() }).collect();
        edges.sort_by(|a, b| js_cmp(&a.from, &b.from).then_with(|| js_cmp(&a.to, &b.to)).then_with(|| js_cmp(&a.kind, &b.kind)));
        Graph { nodes: self.nodes, edges }
    }
}

/// What a body and a signature name. A type position is a reference; an
/// expression or a pattern is a use. A method call on a value names nothing,
/// there being no type to say what it is called on.
struct Collector<'a> {
    a: &'a Analysis,
    module: usize,
    self_ty: Option<String>,
    generics: Vec<String>,
    found: Vec<(String, &'static str)>,
}

impl Collector<'_> {
    fn lookup(&self, path: &syn::Path, ns: Ns) -> Option<String> {
        if path.leading_colon.is_some() {
            return None;
        }
        let segs: Vec<String> = path.segments.iter().map(|s| ident_name(&s.ident)).collect();
        let first = segs.first()?;
        if first == "Self" {
            return self.self_ty.clone();
        }
        if segs.len() == 1 && self.generics.contains(first) {
            return None;
        }
        let (a, m) = (self.a, self.module);
        a.resolve(m, &segs, ns, 0)
            .or_else(|| if ns == Ns::Value { a.resolve(m, &segs, Ns::Type, 0) } else { None })
            // `Token::new`, `Kind::Ident`: the type the path goes through.
            .or_else(|| if segs.len() >= 2 { a.resolve(m, &segs[..segs.len() - 1], Ns::Type, 0) } else { None })
    }

    fn note(&mut self, path: &syn::Path, ns: Ns, kind: &'static str) {
        if let Some(id) = self.lookup(path, ns) {
            self.found.push((id, kind));
        }
    }
}

impl<'ast> Visit<'ast> for Collector<'_> {
    fn visit_generics(&mut self, g: &'ast syn::Generics) {
        self.generics.extend(generic_names(g));
        syn::visit::visit_generics(self, g);
    }

    fn visit_type_path(&mut self, t: &'ast syn::TypePath) {
        if t.qself.is_none() {
            self.note(&t.path, Ns::Type, "references");
        }
        syn::visit::visit_type_path(self, t);
    }

    fn visit_trait_bound(&mut self, t: &'ast syn::TraitBound) {
        self.note(&t.path, Ns::Type, "references");
        syn::visit::visit_trait_bound(self, t);
    }

    fn visit_expr_path(&mut self, e: &'ast syn::ExprPath) {
        if e.qself.is_none() {
            self.note(&e.path, Ns::Value, "uses");
        }
        syn::visit::visit_expr_path(self, e);
    }

    fn visit_expr_struct(&mut self, e: &'ast syn::ExprStruct) {
        if e.qself.is_none() {
            self.note(&e.path, Ns::Type, "uses");
        }
        syn::visit::visit_expr_struct(self, e);
    }

    fn visit_pat_struct(&mut self, p: &'ast syn::PatStruct) {
        if p.qself.is_none() {
            self.note(&p.path, Ns::Type, "uses");
        }
        syn::visit::visit_pat_struct(self, p);
    }

    fn visit_pat_tuple_struct(&mut self, p: &'ast syn::PatTupleStruct) {
        if p.qself.is_none() {
            self.note(&p.path, Ns::Type, "uses");
        }
        syn::visit::visit_pat_tuple_struct(self, p);
    }
}

// -- small readers of syntax ----------------------------------------------------

/// A name as the reader writes it: `r#type` is the name `type`.
fn ident_name(ident: &syn::Ident) -> String {
    ident.unraw().to_string()
}

fn declared(item: &Item) -> Option<(&'static str, &syn::Ident, &syn::Visibility)> {
    Some(match item {
        Item::Struct(i) => ("struct", &i.ident, &i.vis),
        Item::Enum(i) => ("enum", &i.ident, &i.vis),
        Item::Union(i) => ("union", &i.ident, &i.vis),
        Item::Trait(i) => ("trait", &i.ident, &i.vis),
        Item::TraitAlias(i) => ("trait", &i.ident, &i.vis),
        Item::Type(i) => ("type", &i.ident, &i.vis),
        Item::Fn(i) => ("function", &i.sig.ident, &i.vis),
        _ => return None,
    })
}

fn member(file: &str, ident: &syn::Ident) -> Member {
    Member { name: ident_name(ident), file: file.to_string(), line: ident.span().start().line }
}

fn attrs(item: &Item) -> &[syn::Attribute] {
    match item {
        Item::Const(i) => &i.attrs,
        Item::Enum(i) => &i.attrs,
        Item::ExternCrate(i) => &i.attrs,
        Item::Fn(i) => &i.attrs,
        Item::ForeignMod(i) => &i.attrs,
        Item::Impl(i) => &i.attrs,
        Item::Macro(i) => &i.attrs,
        Item::Mod(i) => &i.attrs,
        Item::Static(i) => &i.attrs,
        Item::Struct(i) => &i.attrs,
        Item::Trait(i) => &i.attrs,
        Item::TraitAlias(i) => &i.attrs,
        Item::Type(i) => &i.attrs,
        Item::Union(i) => &i.attrs,
        Item::Use(i) => &i.attrs,
        _ => &[],
    }
}

/// `#[cfg(test)]`, or an `all(…)` that requires it. `any(test, …)` and
/// `not(test)` do not require it, and are walked.
fn is_test(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| a.path().is_ident("cfg") && a.parse_args::<syn::Meta>().is_ok_and(|m| requires_test(&m)))
}

fn requires_test(meta: &syn::Meta) -> bool {
    match meta {
        syn::Meta::Path(p) => p.is_ident("test"),
        syn::Meta::List(l) if l.path.is_ident("all") => l.parse_args_with(Punctuated::<syn::Meta, Token![,]>::parse_terminated).is_ok_and(|ms| ms.iter().any(requires_test)),
        _ => false,
    }
}

fn path_attr(attrs: &[syn::Attribute]) -> Option<String> {
    attrs.iter().find_map(|a| {
        if !a.path().is_ident("path") {
            return None;
        }
        match &a.meta {
            syn::Meta::NameValue(nv) => match &nv.value {
                syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) => Some(s.value()),
                _ => None,
            },
            _ => None,
        }
    })
}

/// A macro invocation whose body parses as items is taken as those items, at
/// the lines they are written on. One whose body does not parse contributes
/// nothing, and a `macro_rules!` definition is not a symbol.
fn expand(items: Vec<Item>, depth: usize) -> Vec<Item> {
    let mut out = Vec::new();
    for item in items {
        match item {
            Item::Macro(m) => {
                if m.ident.is_some() || m.mac.path.is_ident("macro_rules") || depth >= 4 {
                    continue;
                }
                if let Ok(file) = syn::parse2::<syn::File>(m.mac.tokens) {
                    out.extend(expand(file.items, depth + 1));
                }
            }
            other => out.push(other),
        }
    }
    out
}

fn flatten(tree: &syn::UseTree, prefix: &mut Vec<String>, aliases: &mut HashMap<String, Vec<String>>, globs: &mut Vec<Vec<String>>) {
    match tree {
        syn::UseTree::Path(p) => {
            prefix.push(ident_name(&p.ident));
            flatten(&p.tree, prefix, aliases, globs);
            prefix.pop();
        }
        syn::UseTree::Name(n) => {
            let name = ident_name(&n.ident);
            if name == "self" {
                if let Some(last) = prefix.last() {
                    aliases.insert(last.clone(), prefix.clone());
                }
            } else {
                let mut full = prefix.clone();
                full.push(name.clone());
                aliases.insert(name, full);
            }
        }
        syn::UseTree::Rename(r) => {
            let alias = ident_name(&r.rename);
            if alias == "_" {
                return;
            }
            let mut full = prefix.clone();
            let name = ident_name(&r.ident);
            if name != "self" {
                full.push(name);
            }
            aliases.insert(alias, full);
        }
        syn::UseTree::Glob(_) => globs.push(prefix.clone()),
        syn::UseTree::Group(g) => {
            for t in &g.items {
                flatten(t, prefix, aliases, globs);
            }
        }
    }
}

fn generic_names(g: &syn::Generics) -> Vec<String> {
    g.params
        .iter()
        .filter_map(|p| match p {
            syn::GenericParam::Type(t) => Some(ident_name(&t.ident)),
            syn::GenericParam::Const(c) => Some(ident_name(&c.ident)),
            syn::GenericParam::Lifetime(_) => None,
        })
        .collect()
}

fn self_type_path(ty: &syn::Type) -> Option<&syn::Path> {
    match ty {
        syn::Type::Path(tp) if tp.qself.is_none() => Some(&tp.path),
        syn::Type::Reference(r) => self_type_path(&r.elem),
        syn::Type::Paren(p) => self_type_path(&p.elem),
        syn::Type::Group(g) => self_type_path(&g.elem),
        _ => None,
    }
}

// -- paths ----------------------------------------------------------------------

/// Lexically: `.` dropped and `..` taken back, so a node's file is the same
/// string however its root was written.
fn clean(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn absolute(p: &Path) -> PathBuf {
    if p.is_absolute() {
        clean(p)
    } else {
        clean(&std::env::current_dir().unwrap_or_default().join(p))
    }
}

fn dir_of(p: &Path) -> PathBuf {
    p.parent().map(Path::to_path_buf).unwrap_or_default()
}

fn is_root_name(p: &Path) -> bool {
    matches!(p.file_name().and_then(|n| n.to_str()), Some("lib.rs" | "main.rs"))
}

/// Where a root no manifest named looks for its `mod` files: beside itself if it
/// is named as a crate root or a `mod.rs`, and in a directory of its own name
/// otherwise, as Rust resolves a module file.
fn orphan_child_dir(p: &Path) -> PathBuf {
    let dir = dir_of(p);
    match p.file_name().and_then(|n| n.to_str()) {
        Some("lib.rs" | "main.rs" | "mod.rs" | "build.rs") | None => dir,
        _ => dir.join(p.file_stem().unwrap_or_default()),
    }
}
