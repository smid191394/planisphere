# rust-symbol-graph Specification

## Purpose

Defines how Planisphere's Rust analyzer reads Rust. It covers:

- which files and crates the analyzer walks, and what `#[cfg(test)]` excludes;
- which declarations become nodes;
- what an `impl` block's functions belong to;
- how a module and a crate are placed, named and connected;
- what `inherits` means in Rust;
- how names are resolved without a type checker;
- what a macro invocation does and does not contribute;
- what never becomes a file node.
## Requirements
### Requirement: Rust sources in one crate tree, tests and build output excluded
The analyzer SHALL walk `*.rs` files under the roots it is given, and SHALL skip `target/`, the directories every analyzer skips, and any directory holding another crate's vendored source.

It SHALL NOT walk a crate's integration tests (`tests/`) or its benchmarks (`benches/`), which exercise the library rather than being part of it.

**A test in Rust is not a file.** The other analyzers exclude tests by where they live, because their languages put them in files of their own: Python, TypeScript and Go by file name, Java by directory. Rust writes them beside the code they test, in a module marked `#[cfg(test)]`. The analyzer SHALL create no node and contribute no edge for anything declared inside such a module, however deeply nested. Measured over what the analyzer walks, by the lines inside such a module: 11% of the standard library's, 15% of regex-syntax's and 41% of one small crate's. Read as content, two fifths of that crate's drawing would be test code.

Every other `#[cfg(…)]` item SHALL be walked, whatever the condition says. A document that depends on the features or the platform of the machine that wrote it cannot be byte-identical. Go's build constraints are read the same way.

#### Scenario: A test module beside the code it tests
- **WHEN** a file declares a type and, below it, `#[cfg(test)] mod tests` containing functions and types
- **THEN** the type is a node and nothing inside the test module is

#### Scenario: A test module nested deeper
- **WHEN** a `#[cfg(test)]` module contains a further module
- **THEN** nothing declared at any depth inside it becomes a node

#### Scenario: Another condition is not a test
- **WHEN** an item is marked `#[cfg(unix)]` or `#[cfg(feature = "full")]`
- **THEN** it is walked and becomes a node like any other

#### Scenario: Integration tests are not walked
- **WHEN** a crate holds `tests/` and `benches/` beside `src/`
- **THEN** nothing declared in them appears in the graph

#### Scenario: Build output is not walked
- **WHEN** a crate has been compiled and `target/` holds generated sources
- **THEN** none of them is walked

### Requirement: Type declarations and free functions become nodes
The analyzer SHALL create a node for each type declared at the top level of a module. The node's `kind` SHALL be:

- `struct` for a struct;
- `enum` for an enum;
- `trait` for a trait;
- `union` for a union;
- `type` for a type alias.

It SHALL also create a `function` node for each function declared at the top level of a module — that is, one not inside an `impl` block or another function.

A generic parameter SHALL NOT become a node. `impl<T> Trait for T` declares nothing named `T`.

An associated type, an associated constant and a constant or static SHALL NOT become nodes, being nested in another symbol or being values rather than symbols.

A node whose declaration does not carry `pub` SHALL be recorded as internal. Rust states visibility with a keyword, as Java and TypeScript do; Python's mark is an underscore and Go's is the case of a letter, and each of those is a convention rather than a declaration. `pub(crate)`, `pub(super)` and `pub(in …)` are also internal, being reachable only inside the crate that declares them.

#### Scenario: The five type kinds
- **WHEN** a module declares a struct, an enum, a trait, a union and a type alias
- **THEN** the graph contains five nodes whose kinds are `struct`, `enum`, `trait`, `union` and `type`

#### Scenario: A free function is a node
- **WHEN** a module declares `fn parse(s: &str) -> Result<Ast, Error>`
- **THEN** the graph contains a `function` node named `parse`

#### Scenario: A generic parameter is not a type
- **WHEN** a blanket impl is written as `impl<T: Display> Describe for T`
- **THEN** no node named `T` is created

#### Scenario: A constant is not a node
- **WHEN** a module declares `const LIMIT: usize = 10;`
- **THEN** no node is created for it

#### Scenario: A private type is internal
- **WHEN** a module declares `struct Scanner` without `pub`
- **THEN** its node is recorded as internal

#### Scenario: A crate-visible type is internal too
- **WHEN** a module declares `pub(crate) struct Cursor`
- **THEN** its node is recorded as internal

### Requirement: An impl block's functions belong to the type
A function declared inside an `impl` block SHALL NOT become a node. It SHALL be recorded as a member of the node for the type the block implements, carrying its own name, the absolute path of the file it is declared in, and the line its name is declared on.

An `impl` block need not sit in its type's file, and often does not: measured by name over what the analyzer walks, 11% of the standard library's impls are written elsewhere and 88% of one small crate's. A member therefore records where it is, not where its type is.

A function declared in a trait's own body SHALL be recorded as a member of that trait, whether it is a signature alone or carries a default body. It is the same argument the impl case makes: it is reachable in the source, nothing else in the document names it, and a reader looking at a trait is looking for its methods. A default body is code a reader jumps to; a signature is the declaration they are looking for.

What an impl's body names SHALL be attributed to the type the block implements, as a Go method's uses are its receiver's.

Where the implemented type is not a node — `impl LocalTrait for Vec<u8>`, which the orphan rule makes ordinary — the block SHALL record no member, there being no node to record it against. Its body's uses SHALL be attributed to the trait being implemented where that trait is a node, and to nothing where neither end is. An edge is kept where something in the document owns it, and dropped rather than invented where nothing does.

A file whose every item is an `impl` of a type declared in another file SHALL NOT become a file node, being represented by the nodes its members belong to.

A member SHALL record the members of the same type it calls, recognised by what the source writes: a method call on `self`. No type is inferred for it — `self` is the type the block implements, and a call on it names one of that type's own methods or none. A call written any other way is what it already is: the type's, attributed to the type as the rest of an impl body is.

A member SHALL also record what its own signature and body name outside the type, by the node it reaches: every edge the analyzer attributes to the type from a member's signature or body SHALL be recorded against that member as well. What a member's body names is what this analyzer resolves without a type checker — a path — so a method call on a field or a parameter names nothing here, and the edge such a field gives the type stays the type's alone. The type keeps the edge; the member says which method it came from. A name that reaches the type itself is recorded by neither, there being no edge from a node to itself.

#### Scenario: A method is its type's member
- **WHEN** `impl Scanner { pub fn next_token(&mut self) -> Token }` is declared
- **THEN** no node is created for `next_token`, and `Scanner` records it as a member

#### Scenario: An impl in another file
- **WHEN** `Scanner` is declared in `scanner.rs` and an `impl Scanner` block is written in `reprint.rs`
- **THEN** the member records `reprint.rs` and the line it is declared on

#### Scenario: Two types with a method of one name
- **WHEN** two types each implement a method called `len`
- **THEN** each is a member of its own type and no identity collides

#### Scenario: A file of impls is represented by what they belong to
- **WHEN** a file declares nothing but `impl` blocks for types declared elsewhere
- **THEN** no `file` node is created for it

#### Scenario: A trait lists its own methods
- **WHEN** `trait Parser { fn parse(&self) -> Ast; fn peek(&self) -> Token { … } }` is declared
- **THEN** the trait node records both as members, the signature and the one with a default body alike

#### Scenario: An impl for a type that is not in the document
- **WHEN** a local trait is implemented for a type from a dependency
- **THEN** no member is recorded, and what the body names is attributed to the trait

#### Scenario: An impl with neither end in the document
- **WHEN** an external trait is implemented for an external type
- **THEN** no member and no edge are recorded

#### Scenario: A method calling another on self
- **WHEN** a method's body writes `self.other(…)` and `other` is a method of the same type
- **THEN** the member records `other`

#### Scenario: A call on something else
- **WHEN** a method's body calls a method on a value that is not `self`
- **THEN** the member records no call for it, and the type keeps the edge it has

#### Scenario: A type a field names is the type's alone
- **WHEN** a field's type is a node, and a method's body calls a method on that field
- **THEN** the type carries the edge the field gives it, and no member records it, no type being inferred for a receiver

#### Scenario: A free function is not a member's call
- **WHEN** a method's body calls a free function
- **THEN** the member records no call for it, and records the node for that function as something it points at

#### Scenario: A type named in a method's signature
- **WHEN** a method takes an argument of a type that is a node
- **THEN** the member records that node

#### Scenario: A method naming its own type
- **WHEN** a method's body or signature names the type the impl block implements
- **THEN** the member records nothing for it

### Requirement: A module is a unit that contains what is declared in it
The analyzer SHALL create a node of kind `mod` for each module, and a `contains` edge from it to every node declared directly in it. A node nested in an inner module SHALL be contained by that inner module and by no other, so that no node is the target of more than one `contains` edge.

A module node SHALL be placed at the line that declares it — `mod name;` or `mod name { … }` — which names it, wherever that line is written. One file MAY declare several modules: the standard library writes 378 inline modules outside its test modules, and 562 counting them. The shape is real but not the common case: in one small crate 11 of 13 modules are inline, and those are the `#[cfg(test)] mod tests` blocks this analyzer does not walk.

The analyzer SHALL create a node of kind `crate` for each crate, and place it at the line of `Cargo.toml` that names the crate. A crate root is declared nowhere in Rust source: every other module is introduced by a `mod` line, and `lib.rs` is named only in its manifest. Placing the crate there is the only placement that lands a reader on a line that declares it.

A package may hold more than one crate root: a library at `src/lib.rs`, a binary at `src/main.rs`, and one per file under `src/bin/`. A crate node SHALL be created for each crate the manifest names — the package's own `name`, and each `[[bin]]` entry that declares one.

A root the package builds without the manifest naming it — `src/main.rs`, a file or directory under `src/bin/` that no `[[bin]]` claims, and the build script — SHALL be contained by the crate node that carries the package's own name, which SHALL exist whenever the package builds any root. No line names such a root, and a unit node must land on one; the package's `name` line is the nearest line that does, and Cargo gives an implicit `src/main.rs` exactly that name. Without a crate, these roots would have nothing above them: 20 nodes of syn's `codegen/`, which is a `src/main.rs` alone, and the 10 nodes in the build scripts of syn, ripgrep and sqlparser-ranger. And the unit tree, which is centred on the unit containing the others, would have nothing to centre on in the shape `cargo new` writes by default.

A crate node's `name` SHALL be the name as its manifest writes it — `sqlparser-ranger`, not the `sqlparser_ranger` that Rust code uses to refer to it — and its range SHALL be that one line. The contract reads a node's line and requires that it contain the node's name, so a normalised name would fail it; and it requires that no two nodes in one file overlap, so a crate whose range spanned its manifest would swallow every other crate that manifest names.

A crate node SHALL carry `contains` edges to what its root module declares, and to nothing that an inner module declares.

#### Scenario: A module is placed where it is declared
- **WHEN** `mod scanner;` appears in `lib.rs`
- **THEN** the module node's file and line are that line of `lib.rs`, which contains its name

#### Scenario: Several modules in one file
- **WHEN** a file declares `mod a { … }` and `mod b { … }`
- **THEN** each is its own unit node, placed at its own line

#### Scenario: A nested module owns its members
- **WHEN** a type is declared inside `mod a { mod b { … } }`
- **THEN** it is contained by `b` alone

#### Scenario: A crate lands on its manifest
- **WHEN** a crate's node is read
- **THEN** its file is that crate's `Cargo.toml` and its line names the crate

#### Scenario: A workspace of crates
- **WHEN** roots hold several crates
- **THEN** each is its own unit node and no node is contained by two of them

#### Scenario: A binary the manifest does not name
- **WHEN** a package holds `src/main.rs` alone and the manifest declares no `[[bin]]`
- **THEN** a crate node carrying the package's name is placed at the package's `name` line, and it contains what `src/main.rs` declares

#### Scenario: A library and an implicit binary in one package
- **WHEN** a package holds both `src/lib.rs` and `src/main.rs`, and no `[[bin]]`
- **THEN** one crate node carries the package's name, it contains what each of the two roots declares, and no node is contained twice

#### Scenario: A file under src/bin that no entry claims
- **WHEN** `src/bin/tool.rs` exists and no `[[bin]]` names or points at it
- **THEN** what it declares is contained by the package's crate node

#### Scenario: A build script
- **WHEN** a package has `build.rs`, and its only named crate is a `[[bin]]` with another name
- **THEN** a crate node carrying the package's name is placed at its `name` line, and contains what `build.rs` declares

#### Scenario: A manifest with no package
- **WHEN** a manifest declares only a `[workspace]`
- **THEN** it contributes no crate node

#### Scenario: A crate is named as its manifest writes it
- **WHEN** a manifest names a crate `sqlparser-ranger`
- **THEN** its node is named `sqlparser-ranger`, and the line it is placed on contains that name

#### Scenario: Several crates in one manifest do not overlap
- **WHEN** one manifest names a library and two `[[bin]]` crates
- **THEN** each crate node's range is its own naming line, and none contains another

### Requirement: Inheritance in Rust is the trait a type is given
The analyzer SHALL create an `inherits` edge:

- from a type to a trait it implements, for `impl Trait for Type`;
- from a trait to each of its supertraits, for `trait A: B`;
- from a type to a trait it derives, for `#[derive(Trait)]`, where that trait is declared in the analyzed source.

A derive of a trait the analyzed source does not declare SHALL draw nothing, as an edge to a node that is not in the document is one the contract forbids. Most derives name standard-library traits, so most draw nothing, and that is the same silence an import of an external crate produces.

A blanket impl SHALL be recorded like any other, from the generic parameter's bound rather than from a node that does not exist — that is, it contributes an edge only where both ends are nodes. Blanket impls are few, so they do not swell the edge count: they are 84 of the standard library's 4,652 impls and none at all in three of the six corpora read.

#### Scenario: Implementing a trait
- **WHEN** `impl Display for Token` is declared and both are nodes
- **THEN** an `inherits` edge runs from `Token` to `Display`

#### Scenario: A supertrait
- **WHEN** `trait Parser: Iterator` is declared and both are nodes
- **THEN** an `inherits` edge runs from `Parser` to `Iterator`

#### Scenario: Deriving a local trait
- **WHEN** a type derives a trait declared in the same source
- **THEN** an `inherits` edge runs from the type to that trait

#### Scenario: Deriving an external trait
- **WHEN** a type derives `Clone`
- **THEN** no edge is created, `Clone` not being a node

### Requirement: Names are resolved within the crate, without a type checker
The analyzer SHALL resolve a name to a node by matching it against what the analyzed source declares, following `use` declarations and module paths, and SHALL NOT type-check.

Rust has no resolver outside its compiler, and the parser this analyzer uses reads syntax alone. Resolution is therefore at the level Python's is rather than Go's or TypeScript's: a name that two modules declare may be attributed to the wrong one, and a method call on a value of unknown type names nothing. Where a name cannot be resolved to a node, the analyzer SHALL draw no edge rather than guess.

Nothing SHALL be downloaded, and an external crate SHALL resolve to nothing.

#### Scenario: A use declaration is followed
- **WHEN** a module writes `use crate::token::Token;` and names `Token`
- **THEN** the edge runs to the node declared in `token`

#### Scenario: An external name draws nothing
- **WHEN** a file names a type from a dependency
- **THEN** no edge is created and no source is fetched

#### Scenario: An unresolvable name draws nothing
- **WHEN** a name matches no declaration the analyzed source makes
- **THEN** no edge is created

### Requirement: A macro invocation contributes what can be read without expanding it
The analyzer SHALL NOT expand macros, which needs a compiler rather than a parser.

Where a macro is invoked with a body that parses as Rust items, the analyzer SHALL read those items as if they were written in its place: `ast_struct! { pub struct Block { … } }` declares `Block`. syn declares 196 of its own types this way, and a reader of that crate would otherwise find almost none of its vocabulary in the drawing.

Where a macro's body does not parse as items, the analyzer SHALL contribute nothing for it, and the symbols it generates SHALL be absent. This is a known hole, and it is stated rather than hidden: a drawing of a macro-generated API is incomplete in a way the reader cannot see.

A `macro_rules!` definition SHALL NOT become a node.

#### Scenario: A macro body that is items
- **WHEN** a type is declared inside a macro invocation whose body parses as items
- **THEN** that type is a node, placed at the line it is declared on

#### Scenario: A macro body that is not items
- **WHEN** a macro invocation's body does not parse as Rust items
- **THEN** nothing is contributed for it

#### Scenario: A macro definition is not a symbol
- **WHEN** a module declares `macro_rules! ast_struct`
- **THEN** no node is created for it

### Requirement: What this analyzer excludes from becoming a file node
A file declaring no symbol SHALL become a `file` node, except where the contract already says it is represented by another node — a unit placed in it, or members of a type declared elsewhere.

A file whose every item is a `use`, a `pub use` or a `mod` declaration SHALL NOT become a file node. A `mod` line declares a unit, and that unit's node represents the file it is written in; a `use` line is an import and a `pub use` is a re-export, which the contract already excludes. Measured, 110 of the standard library's 1,964 files are nothing but these.

#### Scenario: A crate root of nothing but wiring
- **WHEN** `lib.rs` holds only `mod` declarations and `pub use` re-exports
- **THEN** no `file` node is created for it

#### Scenario: A file of constants is content
- **WHEN** a file declares only constants and no symbol
- **THEN** a `file` node is created for it

