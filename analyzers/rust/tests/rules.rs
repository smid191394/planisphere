//! The rules of rust-symbol-graph, each against a crate small enough to read in
//! the test. A crate is written into a fresh directory and analyzed as the CLI
//! would analyze it; nothing here reaches cargo, the network or the registry.
//!
//! Every test that says something is *not* in the graph first requires something
//! that *is*. An analyzer that produced nothing would otherwise pass every
//! negative rule, and a suite that passes against an empty analyzer tests
//! nothing.

use planisphere_rust::{analyze, encode, Graph, Node};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

const MANIFEST: &str = "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n";

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    fn new(files: &[(&str, &str)]) -> Scratch {
        let dir = std::env::temp_dir().join(format!(
            "planisphere-rust-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        for (rel, src) in files {
            let p = dir.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, src).unwrap();
        }
        Scratch { dir }
    }

    /// A crate with the default manifest and these sources.
    fn krate(files: &[(&str, &str)]) -> Scratch {
        let mut all = vec![("Cargo.toml", MANIFEST)];
        all.extend_from_slice(files);
        Scratch::new(&all)
    }

    fn path(&self, rel: &str) -> String {
        self.dir.join(rel).to_string_lossy().into_owned()
    }

    fn id(&self, rel: &str, kind: &str, name: &str) -> String {
        format!("{}::{}::{}", self.path(rel), kind, name)
    }

    fn graph(&self) -> Graph {
        analyze(&[self.dir.clone()])
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn ids(g: &Graph) -> Vec<String> {
    g.nodes.iter().map(|n| n.id.clone()).collect()
}

fn must<'a>(g: &'a Graph, id: &str) -> &'a Node {
    g.nodes
        .iter()
        .find(|n| n.id == id)
        .unwrap_or_else(|| panic!("no node {id}\ngot: {:#?}", ids(g)))
}

fn named(g: &Graph, name: &str) -> Vec<String> {
    g.nodes.iter().filter(|n| n.name == name).map(|n| n.id.clone()).collect()
}

fn edge(g: &Graph, from: &str, to: &str) -> Option<String> {
    g.edges
        .iter()
        .find(|e| e.from == from && e.to == to)
        .map(|e| e.kind.clone())
}

fn containers(g: &Graph, to: &str) -> Vec<String> {
    g.edges
        .iter()
        .filter(|e| e.kind == "contains" && e.to == to)
        .map(|e| e.from.clone())
        .collect()
}

fn members(n: &Node) -> Vec<String> {
    n.members.iter().map(|m| m.name.clone()).collect()
}

// ---------------------------------------------------------------------------
// Walking

#[test]
fn target_tests_benches_and_the_shared_directories_are_not_walked() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub struct Kept;\n"),
        ("target/debug/build/gen/out.rs", "pub struct Built;\n"),
        ("tests/it.rs", "pub struct Integration;\n"),
        ("benches/b.rs", "pub struct Bench;\n"),
        ("examples/e.rs", "pub struct Example;\n"),
        ("docs/d.rs", "pub struct Doc;\n"),
        ("build/x.rs", "pub struct BuildDir;\n"),
        ("vendor/dep/src/lib.rs", "pub struct Vendored;\n"),
    ]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Kept"));
    for name in ["Built", "Integration", "Bench", "Example", "Doc", "BuildDir", "Vendored"] {
        assert!(named(&g, name).is_empty(), "{name} should not be walked: {:?}", named(&g, name));
    }
}

#[test]
fn a_nested_crate_is_another_crate() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"outer\"\nversion = \"0.1.0\"\n"),
        ("src/lib.rs", "pub struct Outer;\n"),
        ("inner/Cargo.toml", "[package]\nname = \"inner\"\nversion = \"0.1.0\"\n"),
        ("inner/src/lib.rs", "pub struct Inner;\n"),
    ]);
    let g = s.graph();
    let outer = s.id("Cargo.toml", "crate", "outer");
    let inner = s.id("inner/Cargo.toml", "crate", "inner");
    must(&g, &outer);
    must(&g, &inner);
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "Outer")), vec![outer]);
    assert_eq!(containers(&g, &s.id("inner/src/lib.rs", "struct", "Inner")), vec![inner]);
}

#[test]
fn a_feature_gated_item_is_walked() {
    let s = Scratch::krate(&[("src/lib.rs", "#[cfg(feature = \"full\")]\npub struct Full;\n")]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Full"));
}

// ---------------------------------------------------------------------------
// #[cfg(test)]

#[test]
fn a_test_module_beside_the_code_it_tests_contributes_nothing() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Scanner;\n\n#[cfg(test)]\nmod tests {\n    pub struct Fixture;\n    fn helper() {}\n}\n",
    )]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Scanner"));
    for name in ["Fixture", "helper", "tests"] {
        assert!(named(&g, name).is_empty(), "{name} in a test module should not be a node");
    }
}

#[test]
fn a_module_nested_inside_a_test_module_contributes_nothing() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Real;\n\n#[cfg(test)]\nmod tests {\n    mod deeper {\n        pub struct Deep;\n    }\n}\n",
    )]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Real"));
    for name in ["Deep", "deeper", "tests"] {
        assert!(named(&g, name).is_empty(), "{name} should not be a node");
    }
}

#[test]
fn cfg_test_on_a_single_item_excludes_that_item() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Real;\n\n#[cfg(test)]\npub struct OnlyInTests;\n\n#[cfg(test)]\nfn only_in_tests() {}\n",
    )]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Real"));
    assert!(named(&g, "OnlyInTests").is_empty());
    assert!(named(&g, "only_in_tests").is_empty());
}

#[test]
fn cfg_unix_is_walked() {
    let s = Scratch::krate(&[("src/lib.rs", "#[cfg(unix)]\npub struct Unix;\n\npub struct Real;\n")]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Unix"));
    must(&g, &s.id("src/lib.rs", "struct", "Real"));
}

#[test]
fn a_test_module_in_a_file_of_its_own_contributes_nothing() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub struct Real;\n\n#[cfg(test)]\nmod tests;\n"),
        ("src/tests.rs", "pub struct InFile;\n"),
    ]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Real"));
    assert!(named(&g, "InFile").is_empty(), "a type in a test file should not be a node");
    assert!(
        g.nodes.iter().all(|n| n.file != s.path("src/tests.rs")),
        "tests.rs should have no nodes, not even a file node"
    );
}

// ---------------------------------------------------------------------------
// Nodes

#[test]
fn the_five_type_kinds_and_a_free_function() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct S;\npub enum E {\n    A,\n}\npub trait T {}\npub union U {\n    a: u32,\n}\npub type Alias = S;\npub fn parse() {}\n",
    )]);
    let g = s.graph();
    for (kind, name) in [
        ("struct", "S"),
        ("enum", "E"),
        ("trait", "T"),
        ("union", "U"),
        ("type", "Alias"),
        ("function", "parse"),
    ] {
        must(&g, &s.id("src/lib.rs", kind, name));
    }
}

#[test]
fn no_node_for_a_generic_parameter_an_associated_item_a_constant_or_a_macro_definition() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Describe {\n    type Output;\n    const N: usize;\n}\n\nimpl<T: Clone> Describe for T {\n    type Output = u8;\n    const N: usize = 1;\n}\n\npub const LIMIT: usize = 10;\npub static NAME: &str = \"x\";\n\nmacro_rules! make {\n    () => {};\n}\n",
    )]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "trait", "Describe"));
    for name in ["T", "Output", "N", "LIMIT", "NAME", "make"] {
        assert!(named(&g, name).is_empty(), "{name} should not be a node: {:?}", named(&g, name));
    }
}

// ---------------------------------------------------------------------------
// Visibility

#[test]
fn visibility_is_the_internal_flag() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "struct Bare;\npub(crate) struct CrateVisible;\npub struct Public;\nfn private_fn() {}\npub fn public_fn() {}\n\npub mod inner {\n    pub(super) struct SuperVisible;\n}\n",
    )]);
    let g = s.graph();
    for (kind, name, want) in [
        ("struct", "Bare", true),
        ("struct", "CrateVisible", true),
        ("struct", "Public", false),
        ("function", "private_fn", true),
        ("function", "public_fn", false),
        ("struct", "SuperVisible", true),
    ] {
        let n = must(&g, &s.id("src/lib.rs", kind, name));
        assert_eq!(n.internal, want, "{name} internal should be {want}");
    }
}

// ---------------------------------------------------------------------------
// Members

#[test]
fn an_impl_blocks_functions_are_the_types_members() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Scanner;\n\nimpl Scanner {\n    pub fn new() -> Self {\n        Scanner\n    }\n\n    pub fn next_token(&mut self) {}\n}\n",
    )]);
    let g = s.graph();
    let sc = must(&g, &s.id("src/lib.rs", "struct", "Scanner"));
    assert_eq!(members(sc), vec!["new", "next_token"]);
    assert_eq!((sc.members[0].line, sc.members[1].line), (4, 8));
    assert!(
        named(&g, "new").is_empty() && named(&g, "next_token").is_empty(),
        "methods should not be nodes"
    );
}

#[test]
fn an_impl_in_another_file_records_that_file_and_gives_it_no_file_node() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub mod scanner;\nmod reprint;\n"),
        ("src/scanner.rs", "pub struct Scanner;\n"),
        (
            "src/reprint.rs",
            "use crate::scanner::Scanner;\n\nimpl Scanner {\n    pub fn reprint(&self) {}\n}\n",
        ),
    ]);
    let g = s.graph();
    let sc = must(&g, &s.id("src/scanner.rs", "struct", "Scanner"));
    assert_eq!(members(sc), vec!["reprint"]);
    assert_eq!(sc.members[0].file, s.path("src/reprint.rs"));
    assert_eq!(sc.members[0].line, 4);
    assert!(
        g.nodes
            .iter()
            .all(|n| !(n.kind == "file" && n.file == s.path("src/reprint.rs"))),
        "a file with only an impl should have no file node"
    );
}

#[test]
fn two_types_with_a_method_of_one_name_do_not_collide() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct A;\npub struct B;\n\nimpl A {\n    pub fn len(&self) -> usize {\n        0\n    }\n}\n\nimpl B {\n    pub fn len(&self) -> usize {\n        0\n    }\n}\n",
    )]);
    let g = s.graph();
    assert_eq!(members(must(&g, &s.id("src/lib.rs", "struct", "A"))), vec!["len"]);
    assert_eq!(members(must(&g, &s.id("src/lib.rs", "struct", "B"))), vec!["len"]);
    let mut seen = HashSet::new();
    for n in &g.nodes {
        assert!(seen.insert(n.id.clone()), "duplicate id: {}", n.id);
    }
}

#[test]
fn a_trait_lists_its_own_methods() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Parser {\n    fn parse(&self) -> u32;\n    fn peek(&self) -> u32 {\n        0\n    }\n}\n",
    )]);
    let g = s.graph();
    let p = must(&g, &s.id("src/lib.rs", "trait", "Parser"));
    assert_eq!(members(p), vec!["parse", "peek"]);
    assert_eq!((p.members[0].line, p.members[1].line), (2, 3));
}

#[test]
fn an_impl_for_a_type_not_in_the_document_records_no_member_and_attributes_to_the_trait() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Local {\n    fn go(&self);\n}\n\npub struct Helper;\n\nimpl Local for Vec<u8> {\n    fn go(&self) {\n        let _ = Helper;\n    }\n}\n",
    )]);
    let g = s.graph();
    let local = s.id("src/lib.rs", "trait", "Local");
    assert_eq!(members(must(&g, &local)), vec!["go"], "there should be no member beyond the trait body's go");
    assert_eq!(g.nodes.iter().map(|n| n.members.len()).sum::<usize>(), 1);
    assert_eq!(
        edge(&g, &local, &s.id("src/lib.rs", "struct", "Helper")).as_deref(),
        Some("uses")
    );
}

#[test]
fn an_impl_with_neither_end_in_the_document_records_nothing() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Helper;\n\nimpl std::fmt::Display for Vec<u8> {\n    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {\n        let _ = Helper;\n        Ok(())\n    }\n}\n",
    )]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Helper"));
    assert!(g.nodes.iter().all(|n| n.members.is_empty()), "there should be no members");
    assert!(
        g.edges.iter().all(|e| e.kind == "contains"),
        "there should be no edges besides contains: {:?}",
        g.edges
    );
}

// ---------------------------------------------------------------------------
// Modules

#[test]
fn a_module_is_placed_at_its_mod_line() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "//! The crate.\n\npub mod scanner;\n"),
        ("src/scanner.rs", "pub struct Scanner;\n"),
    ]);
    let g = s.graph();
    let m = must(&g, &s.id("src/lib.rs", "mod", "scanner"));
    assert_eq!(m.line, 3);
    assert!(m.end_line.is_none() || m.end_line == Some(3), "a module node spans only its own line");
    assert_eq!(
        containers(&g, &s.id("src/scanner.rs", "struct", "Scanner")),
        vec![m.id.clone()]
    );
}

#[test]
fn several_inline_modules_in_one_file_are_several_units() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub mod a {\n    pub struct A;\n}\n\npub mod b {\n    pub struct B;\n}\n",
    )]);
    let g = s.graph();
    let a = must(&g, &s.id("src/lib.rs", "mod", "a"));
    let b = must(&g, &s.id("src/lib.rs", "mod", "b"));
    assert_eq!((a.line, b.line), (1, 5));
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "A")), vec![a.id.clone()]);
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "B")), vec![b.id.clone()]);
}

#[test]
fn a_nested_module_owns_its_members_and_nothing_is_contained_twice() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub mod a {\n    pub mod b {\n        pub struct Deep;\n    }\n}\n",
    )]);
    let g = s.graph();
    let b = s.id("src/lib.rs", "mod", "b");
    must(&g, &b);
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "Deep")), vec![b.clone()]);
    assert_eq!(containers(&g, &b), vec![s.id("src/lib.rs", "mod", "a")]);
    for n in &g.nodes {
        assert!(containers(&g, &n.id).len() <= 1, "{} is contained more than once", n.id);
    }
}

// ---------------------------------------------------------------------------
// Crates

#[test]
fn a_crate_lands_on_the_manifest_line_that_names_it_as_written() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"sqlparser-ranger\"\nversion = \"0.1.0\"\n"),
        ("src/lib.rs", "pub struct Token;\n"),
    ]);
    let g = s.graph();
    let c = must(&g, &s.id("Cargo.toml", "crate", "sqlparser-ranger"));
    assert_eq!(c.line, 2);
    assert!(c.end_line.is_none() || c.end_line == Some(2), "a crate node spans only the line that names it");
    assert_eq!(
        containers(&g, &s.id("src/lib.rs", "struct", "Token")),
        vec![c.id.clone()]
    );
}

#[test]
fn a_workspace_of_crates_gives_one_node_each() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[workspace]\nmembers = [\"a\", \"b\"]\n"),
        ("a/Cargo.toml", "[package]\nname = \"a\"\nversion = \"0.1.0\"\n"),
        ("a/src/lib.rs", "pub struct A;\n"),
        ("b/Cargo.toml", "[package]\nname = \"b\"\nversion = \"0.1.0\"\n"),
        ("b/src/lib.rs", "pub struct B;\n"),
    ]);
    let g = s.graph();
    let crates: Vec<_> = g.nodes.iter().filter(|n| n.kind == "crate").map(|n| n.id.clone()).collect();
    assert_eq!(crates.len(), 2, "one node for each of the two crates, none for the workspace itself: {crates:?}");
    assert_eq!(
        containers(&g, &s.id("a/src/lib.rs", "struct", "A")),
        vec![s.id("a/Cargo.toml", "crate", "a")]
    );
    assert_eq!(
        containers(&g, &s.id("b/src/lib.rs", "struct", "B")),
        vec![s.id("b/Cargo.toml", "crate", "b")]
    );
}

#[test]
fn a_crate_contains_its_root_modules_items_and_not_an_inner_modules() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub struct Top;\npub mod inner;\n"),
        ("src/inner.rs", "pub struct Inside;\n"),
    ]);
    let g = s.graph();
    let c = s.id("Cargo.toml", "crate", "demo");
    let inner = s.id("src/lib.rs", "mod", "inner");
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "Top")), vec![c.clone()]);
    assert_eq!(containers(&g, &inner), vec![c]);
    assert_eq!(containers(&g, &s.id("src/inner.rs", "struct", "Inside")), vec![inner]);
}

#[test]
fn an_implicit_main_rs_alone_is_contained_by_the_packages_crate() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"tool\"\nversion = \"0.1.0\"\n"),
        ("src/main.rs", "pub struct Cli;\nmod args;\n\nfn main() {}\n"),
        ("src/args.rs", "pub struct Args;\n"),
    ]);
    let g = s.graph();
    let c = must(&g, &s.id("Cargo.toml", "crate", "tool"));
    assert_eq!(c.line, 2, "the crate node sits on the package's name line");
    let args = s.id("src/main.rs", "mod", "args");
    assert_eq!(containers(&g, &s.id("src/main.rs", "struct", "Cli")), vec![c.id.clone()]);
    assert_eq!(containers(&g, &args), vec![c.id.clone()]);
    assert_eq!(containers(&g, &s.id("src/args.rs", "struct", "Args")), vec![args]);
}

#[test]
fn a_library_and_an_implicit_main_rs_share_one_crate() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub struct Lib;\n"),
        ("src/main.rs", "pub struct Cli;\n\nfn main() {}\n"),
    ]);
    let g = s.graph();
    let crates: Vec<_> = g.nodes.iter().filter(|n| n.kind == "crate").map(|n| n.id.clone()).collect();
    let c = s.id("Cargo.toml", "crate", "demo");
    assert_eq!(crates, vec![c.clone()], "one package has only one crate node");
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "Lib")), vec![c.clone()]);
    assert_eq!(containers(&g, &s.id("src/main.rs", "struct", "Cli")), vec![c]);
}

#[test]
fn an_unclaimed_src_bin_root_joins_the_package_and_a_claimed_one_keeps_its_crate() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n\n[[bin]]\nname = \"named\"\n"),
        ("src/lib.rs", "pub struct Lib;\n"),
        ("src/bin/named.rs", "pub struct Named;\n\nfn main() {}\n"),
        ("src/bin/tool.rs", "pub struct Tool;\n\nfn main() {}\n"),
        ("src/bin/multi/main.rs", "pub struct Multi;\nmod part;\n\nfn main() {}\n"),
        ("src/bin/multi/part.rs", "pub struct Part;\n"),
    ]);
    let g = s.graph();
    let pkg = s.id("Cargo.toml", "crate", "demo");
    let named = s.id("Cargo.toml", "crate", "named");
    assert_eq!(containers(&g, &s.id("src/bin/named.rs", "struct", "Named")), vec![named]);
    assert_eq!(containers(&g, &s.id("src/bin/tool.rs", "struct", "Tool")), vec![pkg.clone()]);
    assert_eq!(containers(&g, &s.id("src/bin/multi/main.rs", "struct", "Multi")), vec![pkg]);
    assert_eq!(
        containers(&g, &s.id("src/bin/multi/part.rs", "struct", "Part")),
        vec![s.id("src/bin/multi/main.rs", "mod", "part")]
    );
}

#[test]
fn a_build_script_joins_the_package_even_when_its_only_crate_is_another_binary() {
    let s = Scratch::new(&[
        (
            "Cargo.toml",
            "[package]\nname = \"ripgrep\"\nversion = \"0.1.0\"\n\n[[bin]]\nname = \"rg\"\npath = \"crates/core/main.rs\"\n",
        ),
        ("crates/core/main.rs", "pub struct Core;\n\nfn main() {}\n"),
        ("build.rs", "struct Gen;\n\nfn main() {}\n"),
    ]);
    let g = s.graph();
    let pkg = must(&g, &s.id("Cargo.toml", "crate", "ripgrep"));
    assert_eq!(pkg.line, 2);
    assert_eq!(containers(&g, &s.id("build.rs", "struct", "Gen")), vec![pkg.id.clone()]);
    assert_eq!(
        containers(&g, &s.id("crates/core/main.rs", "struct", "Core")),
        vec![s.id("Cargo.toml", "crate", "rg")]
    );
}

#[test]
fn a_build_line_names_the_script_and_build_false_names_none() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nbuild = \"tools/gen.rs\"\n"),
        ("src/lib.rs", "pub struct Lib;\n"),
        ("tools/gen.rs", "struct Gen;\n\nfn main() {}\n"),
        ("build.rs", "struct NotTheScript;\n\nfn main() {}\n"),
    ]);
    let g = s.graph();
    let pkg = s.id("Cargo.toml", "crate", "demo");
    assert_eq!(containers(&g, &s.id("tools/gen.rs", "struct", "Gen")), vec![pkg]);
    assert!(
        containers(&g, &s.id("build.rs", "struct", "NotTheScript")).is_empty(),
        "when build points to another file, build.rs is not the build script"
    );

    let off = Scratch::new(&[
        ("Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nbuild = false\n"),
        ("src/lib.rs", "pub struct Lib;\n"),
        ("build.rs", "struct Gen;\n\nfn main() {}\n"),
    ]);
    let g = off.graph();
    must(&g, &off.id("build.rs", "struct", "Gen"));
    assert!(containers(&g, &off.id("build.rs", "struct", "Gen")).is_empty(), "with build = false there is no build script");
}

#[test]
fn a_binary_of_the_packages_own_name_keeps_its_line_when_a_build_script_joins_it() {
    let s = Scratch::new(&[
        (
            "Cargo.toml",
            "[package]\nname = \"tool\"\nversion = \"0.1.0\"\n\n[[bin]]\nname = \"tool\"\npath = \"cli/main.rs\"\n",
        ),
        ("cli/main.rs", "pub struct Cli;\n\nfn main() {}\n"),
        ("build.rs", "struct Gen;\n\nfn main() {}\n"),
    ]);
    let g = s.graph();
    let c = must(&g, &s.id("Cargo.toml", "crate", "tool"));
    assert_eq!(c.line, 6, "an existing crate node does not move when a build script is added");
    assert_eq!(containers(&g, &s.id("cli/main.rs", "struct", "Cli")), vec![c.id.clone()]);
    assert_eq!(containers(&g, &s.id("build.rs", "struct", "Gen")), vec![c.id.clone()]);
}

#[test]
fn a_workspace_only_manifest_contributes_no_crate() {
    let s = Scratch::new(&[
        ("Cargo.toml", "[workspace]\nmembers = [\"a\"]\n"),
        ("build.rs", "struct Stray;\n\nfn main() {}\n"),
        ("src/main.rs", "struct AlsoStray;\n\nfn main() {}\n"),
        ("a/Cargo.toml", "[package]\nname = \"a\"\nversion = \"0.1.0\"\n"),
        ("a/src/lib.rs", "pub struct A;\n"),
    ]);
    let g = s.graph();
    must(&g, &s.id("build.rs", "struct", "Stray"));
    let crates: Vec<_> = g.nodes.iter().filter(|n| n.kind == "crate").map(|n| n.name.clone()).collect();
    assert_eq!(crates, vec!["a".to_string()], "a manifest with only [workspace] produces no crate");
}

#[test]
fn several_crates_in_one_manifest_do_not_overlap() {
    let s = Scratch::new(&[
        (
            "Cargo.toml",
            "[package]\nname = \"rg\"\nversion = \"0.1.0\"\n\n[[bin]]\nname = \"rg-a\"\npath = \"src/a.rs\"\n\n[[bin]]\nname = \"rg-b\"\npath = \"src/b.rs\"\n",
        ),
        ("src/lib.rs", "pub struct Lib;\n"),
        ("src/a.rs", "pub struct A;\n\nfn main() {}\n"),
        ("src/b.rs", "pub struct B;\n\nfn main() {}\n"),
    ]);
    let g = s.graph();
    let lib = must(&g, &s.id("Cargo.toml", "crate", "rg"));
    let a = must(&g, &s.id("Cargo.toml", "crate", "rg-a"));
    let b = must(&g, &s.id("Cargo.toml", "crate", "rg-b"));
    assert_eq!((lib.line, a.line, b.line), (2, 6, 10));
    for c in [lib, a, b] {
        assert!(
            c.end_line.is_none() || c.end_line == Some(c.line),
            "{} should span only that line",
            c.name
        );
    }
    assert_eq!(containers(&g, &s.id("src/a.rs", "struct", "A")), vec![a.id.clone()]);
    assert_eq!(containers(&g, &s.id("src/b.rs", "struct", "B")), vec![b.id.clone()]);
    assert_eq!(containers(&g, &s.id("src/lib.rs", "struct", "Lib")), vec![lib.id.clone()]);
}

// ---------------------------------------------------------------------------
// Edges

#[test]
fn implementing_a_trait_and_a_supertrait_are_inherits() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Show {}\npub trait Parser: Show {}\npub struct Token;\n\nimpl Show for Token {}\n",
    )]);
    let g = s.graph();
    let show = s.id("src/lib.rs", "trait", "Show");
    assert_eq!(
        edge(&g, &s.id("src/lib.rs", "struct", "Token"), &show).as_deref(),
        Some("inherits")
    );
    assert_eq!(
        edge(&g, &s.id("src/lib.rs", "trait", "Parser"), &show).as_deref(),
        Some("inherits")
    );
}

#[test]
fn deriving_a_local_trait_is_inherits_and_deriving_clone_draws_nothing() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Walk {}\n\n#[derive(Clone, Walk)]\npub struct Node;\n",
    )]);
    let g = s.graph();
    let node = s.id("src/lib.rs", "struct", "Node");
    assert_eq!(
        edge(&g, &node, &s.id("src/lib.rs", "trait", "Walk")).as_deref(),
        Some("inherits")
    );
    let from_node: Vec<_> = g.edges.iter().filter(|e| e.from == node).collect();
    assert_eq!(from_node.len(), 1, "Clone is not a node, so there should be no edge: {from_node:?}");
}

#[test]
fn a_blanket_impl_draws_an_edge_only_where_both_ends_are_nodes() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Describe {}\n\nimpl<T: Clone> Describe for T {}\n\npub struct Real;\n\nimpl Describe for Real {}\n",
    )]);
    let g = s.graph();
    assert_eq!(
        edge(
            &g,
            &s.id("src/lib.rs", "struct", "Real"),
            &s.id("src/lib.rs", "trait", "Describe")
        )
        .as_deref(),
        Some("inherits")
    );
    assert!(named(&g, "T").is_empty());
    let all: HashSet<_> = g.nodes.iter().map(|n| n.id.clone()).collect();
    for e in &g.edges {
        assert!(all.contains(&e.from) && all.contains(&e.to), "both ends of an edge must be nodes: {e:?}");
    }
}

// ---------------------------------------------------------------------------
// Resolution

#[test]
fn a_use_declaration_is_followed() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub mod token;\npub mod scanner;\n"),
        ("src/token.rs", "pub struct Token;\n"),
        (
            "src/scanner.rs",
            "use crate::token::Token;\n\npub struct Scanner {\n    current: Token,\n}\n",
        ),
    ]);
    let g = s.graph();
    assert_eq!(
        edge(
            &g,
            &s.id("src/scanner.rs", "struct", "Scanner"),
            &s.id("src/token.rs", "struct", "Token")
        )
        .as_deref(),
        Some("references")
    );
}

#[test]
fn a_name_in_scope_resolves_and_a_use_in_a_body_outranks_a_reference() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub struct Token;\n\npub fn make() -> Token {\n    Token\n}\n",
    )]);
    let g = s.graph();
    assert_eq!(
        edge(
            &g,
            &s.id("src/lib.rs", "function", "make"),
            &s.id("src/lib.rs", "struct", "Token")
        )
        .as_deref(),
        Some("uses")
    );
}

#[test]
fn an_external_name_draws_nothing_and_nothing_is_fetched() {
    // The dependency does not exist anywhere. An analyzer that asked cargo, or
    // the registry, would fail here; one that reads source does not notice.
    let s = Scratch::new(&[
        (
            "Cargo.toml",
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n\n[dependencies]\nplanisphere-no-such-crate = \"99\"\n",
        ),
        (
            "src/lib.rs",
            "use planisphere_no_such_crate::Thing;\n\npub struct Holder {\n    thing: Thing,\n}\n",
        ),
    ]);
    let g = s.graph();
    let holder = s.id("src/lib.rs", "struct", "Holder");
    must(&g, &holder);
    assert!(g.edges.iter().all(|e| e.from != holder), "an external name should have no edge: {:?}", g.edges);
}

#[test]
fn an_unresolvable_name_draws_nothing() {
    let s = Scratch::krate(&[("src/lib.rs", "pub struct Holder {\n    thing: Missing,\n}\n")]);
    let g = s.graph();
    let holder = s.id("src/lib.rs", "struct", "Holder");
    must(&g, &holder);
    assert!(g.edges.iter().all(|e| e.from != holder));
}

// ---------------------------------------------------------------------------
// Macros

#[test]
fn a_macro_body_that_is_items_declares_them_at_their_own_lines() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "macro_rules! ast_struct {\n    ($($t:tt)*) => { $($t)* };\n}\n\nast_struct! {\n    /// A braced block.\n    pub struct Block {\n        pub stmts: Vec<u8>,\n    }\n}\n",
    )]);
    let g = s.graph();
    let b = must(&g, &s.id("src/lib.rs", "struct", "Block"));
    assert_eq!(b.line, 7);
    assert!(named(&g, "ast_struct").is_empty(), "a macro definition should not be a node");
}

#[test]
fn a_macro_body_that_is_not_items_contributes_nothing() {
    let s = Scratch::krate(&[("src/lib.rs", "pub struct Real;\n\nsome_macro! { 1 + 2 * }\n")]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "struct", "Real"));
    let names: Vec<_> = g
        .nodes
        .iter()
        .filter(|n| n.kind != "crate")
        .map(|n| n.name.clone())
        .collect();
    assert_eq!(names, vec!["Real"]);
}

// ---------------------------------------------------------------------------
// File nodes

#[test]
fn a_crate_root_of_nothing_but_mod_and_pub_use_gets_no_file_node() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "mod scanner;\npub use scanner::Scanner;\n"),
        ("src/scanner.rs", "pub struct Scanner;\n"),
    ]);
    let g = s.graph();
    must(&g, &s.id("src/lib.rs", "mod", "scanner"));
    assert!(
        g.nodes.iter().all(|n| n.kind != "file"),
        "a crate root that only wires modules should have no file node: {:?}",
        ids(&g)
    );
}

#[test]
fn a_file_of_constants_is_content() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub mod limits;\n"),
        ("src/limits.rs", "pub const MAX: usize = 1;\n"),
    ]);
    let g = s.graph();
    let f = must(&g, &s.id("src/limits.rs", "file", "limits.rs"));
    assert_eq!(containers(&g, &f.id), vec![s.id("src/lib.rs", "mod", "limits")]);
}

// ---------------------------------------------------------------------------
// Serialisation

#[test]
fn the_document_serialises_the_same_twice_and_as_json_stringify_writes_it() {
    let s = Scratch::krate(&[(
        "src/lib.rs",
        "pub trait Show {}\n\npub struct Café {\n    inner: Token,\n}\n\npub struct Token;\n\nimpl Show for Café {}\n",
    )]);
    let first = encode(&s.graph());
    let second = encode(&s.graph());
    assert!(!first.is_empty(), "the document should not be empty");
    assert_eq!(first, second, "serializing twice should give identical bytes");
    assert!(
        first.starts_with("{\n  \"nodes\": [\n    {\n      \"id\": "),
        "two-space indent, nodes first: {}",
        &first[..first.len().min(80)]
    );
    assert!(first.ends_with("\n}\n") && !first.ends_with("\n\n"), "exactly one trailing newline");
    assert!(first.contains("Café") && !first.contains("\\u"), "non-ASCII is written as is, not escaped");
    assert!(first.find("\"nodes\"").unwrap() < first.find("\"edges\"").expect("edges should be present"));
    // Key order and indentation inside a node, as every producer writes them.
    let want = format!(
        "\"id\": \"{}\",\n      \"kind\": \"struct\",\n      \"name\": \"Token\",\n      \"file\": \"{}\",\n      \"line\": 7,\n      \"endLine\": 7\n    }}",
        s.id("src/lib.rs", "struct", "Token"),
        s.path("src/lib.rs")
    );
    assert!(first.contains(&want), "node key order and indent:\n{want}\ngot:\n{first}");
}

#[test]
fn edges_are_sorted_by_from_to_and_kind() {
    let s = Scratch::krate(&[
        ("src/lib.rs", "pub mod b;\npub mod a;\n"),
        ("src/a.rs", "pub struct Zed;\npub struct Alpha {\n    z: Zed,\n}\n"),
        ("src/b.rs", "use crate::a::Alpha;\npub struct Beta {\n    a: Alpha,\n}\n"),
    ]);
    let g = s.graph();
    assert!(g.edges.len() >= 4, "there must be enough edges to check the order: {:?}", g.edges);
    let order: Vec<_> = g
        .edges
        .iter()
        .map(|e| (e.from.clone(), e.to.clone(), e.kind.clone()))
        .collect();
    let mut sorted = order.clone();
    sorted.sort();
    assert_eq!(order, sorted, "edges should be sorted by from, to, kind");
}

#[test]
fn a_string_is_escaped_only_where_json_stringify_escapes_it() {
    let s = Scratch::new(&[
        ("q\"a<b&c/Cargo.toml", MANIFEST),
        ("q\"a<b&c/src/lib.rs", "pub struct Odd;\n"),
    ]);
    let text = encode(&s.graph());
    assert!(
        text.contains("q\\\"a<b&c/src/lib.rs"),
        "quotes escaped, < and & as is: {text}"
    );
    assert!(!text.contains("\\u"), "there should be no \\u escapes");
}
