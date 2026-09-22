# structure-graph-artifact Specification

## Purpose

Defines the on-disk `planisphere.json` structure-graph artifact (or any `*.planisphere.json` a reader names): how it is generated, what it must contain, how regeneration updates it so users can reopen the same snapshot without re-analyzing, and what an analyzer that produces one is required to be.
## Requirements
### Requirement: Default artifact path and overwrite
Unless the user chooses a different destination (`-o` / `--output`), the CLI SHALL write to `planisphere.json` under the current working directory (or as otherwise documented) and MUST overwrite that file when regenerating.

#### Scenario: First generate creates default file
- **WHEN** the user runs `planisphere` and the default artifact path does not yet exist
- **THEN** the file is created at the default path

#### Scenario: Regenerate overwrites default file
- **WHEN** the user runs `planisphere` again with the default path already present
- **THEN** the existing file is overwritten with a newly analyzed graph

### Requirement: Artifact document shape
A valid `*.planisphere.json` document MUST be JSON containing a graph with `nodes` and `edges` arrays that the structure graph viewer can read: node fields include identity, kind, name, file and line; edge fields are from, to and kind.

This requirement fixes the document's outline. What goes in it is settled by the requirements that follow — how an identity is built, that paths are absolute, which kinds an edge may carry, and how the whole thing is serialised. It MUST NOT enumerate any of those, because a list kept in two places goes out of date in one of them.

#### Scenario: Viewer can parse generated file
- **WHEN** a successfully generated artifact is opened by the structure graph viewer
- **THEN** the viewer can load `nodes` and `edges` without requiring a re-run of the analyzer

### Requirement: An analyzer is self-contained and named by its language
Everything needed to produce a `*.planisphere.json` artifact for one language SHALL live under a single directory named for that language. Analyzers MAY be written in different languages and MAY have different runtimes, dependencies and test runners; nothing about one analyzer's implementation SHALL constrain another's.

An analyzer SHALL run from where it is installed, with what is installed beside it, and without reaching the network. What ships with the product is what it has: a dependency the analyzer loads at run time SHALL ship with it, and a dependency it builds from source SHALL ship as source. A development dependency does not ship, so a compiler an analyzer parses with is a runtime dependency; and a crate the Rust analyzer builds from, such as `syn`, ships as source because cargo would otherwise fetch it from the network.

A reader SHALL NOT need a language's toolchain to read that language, wherever its analyzer can be made ready ahead of time at a cost the product can carry. The TypeScript analyzer SHALL run on the Node the editor already carries. The Go analyzer SHALL ship compiled for every platform the marketplace serves, in the one package: all five cost 7.0 MB compressed, and the analyzer otherwise requires Go 1.23, which a reader on an older Go would fail even with Go installed. The editor starts its extension host without reading the shell files that put `cargo`, `go` and `node` on the PATH, so an analyzer that needs a toolchain can fail there even for a reader who has one installed.

The Rust analyzer MAY require `cargo`, the Python analyzer `python3`, and the Java analyzer a Java runtime carrying its compiler. A reader of those languages almost always has them, and shipping any of them compiled costs more than it returns: a Rust executable is built on the platform it runs on, and bundling Python or a Java runtime costs 10 MB to 60 MB per platform. Where one is absent, what is missing SHALL be named, with what to install.

Where an analyzer builds something before it runs, it SHALL build into a directory the product may write to, and never into its own installed directory. An installed extension's directory belongs to the editor that installed it: it may be read-only, and it is replaced on every update, which would throw the build away and do it again.

Nothing outside an analyzer's own directory SHALL depend on a path inside it. The viewer, the extension host, and every other analyzer read the artifact document — that document is the whole interface between a producer and everything downstream. Sample projects analyzers are measured against are the project's, not one analyzer's, and SHALL be reachable without a path through any analyzer.

#### Scenario: The viewer does not reach into an analyzer
- **WHEN** the viewer or the viewer's tests need a graph to work on
- **THEN** they read a generated artifact or the shared corpus, and no path under an analyzer's directory

#### Scenario: A second analyzer costs the first one nothing
- **WHEN** an analyzer for another language is added beside an existing one
- **THEN** no file under the existing analyzer's directory has to change

#### Scenario: An analyzer runs from what ships with it
- **WHEN** an analyzer is run from an installed copy of the product, with no development install beside it and no network
- **THEN** it produces its document

#### Scenario: Two languages need no toolchain
- **WHEN** a reader with no `node` and no `go` reachable at all produces an artifact for a TypeScript or a Go project, on any platform the marketplace serves
- **THEN** it is produced

#### Scenario: Three languages name what they need
- **WHEN** a reader without `cargo`, without `python3`, or without a Java runtime carrying its compiler, produces an artifact for that language
- **THEN** what is missing is named, and what to install

#### Scenario: A build does not write into the install
- **WHEN** an analyzer must build a dependency before it can run
- **THEN** what it builds is written outside the installed directory

#### Scenario: An analyzer brings its own runtime
- **WHEN** an analyzer is not written in the same language as its siblings
- **THEN** it is not required to share their interpreter, their dependencies or their test runner, and it is still run by the same CLI

### Requirement: A node's identity is its file, its kind and its name
Every node's `id` SHALL be its `file`, its `kind` and its `name`, joined by `::` in that order — `<file>::<kind>::<name>`. Because `file` is absolute and a file cannot hold two top-level symbols of the same kind and name, this is unique without a counter, is derivable from the node's own fields, and is the same string every analyzer would compute for the same symbol.

Consumers SHALL treat an id as opaque: compare it, index by it, never take it apart. A producer that needed a different identity scheme would break every consumer silently, because a wrong-but-unique id draws a graph that looks correct.

#### Scenario: Two files define a symbol with the same name
- **WHEN** two source files each define a class named `User`
- **THEN** the graph contains two nodes with different ids, because the file component differs

#### Scenario: The identity is derivable, not stored twice
- **WHEN** a consumer holds a node
- **THEN** the node's own `file`, `kind` and `name` are enough to reconstruct its id exactly

### Requirement: Persisted node file paths are absolute
When the structure graph is written to a `*.planisphere.json` artifact for reopen use, each node's `file` path MUST be stored as an absolute filesystem path. The extension host MUST open that path when performing jump-to-source. A relative path MAY be resolved against the current workspace as a fallback.

#### Scenario: Artifact paths are absolute
- **WHEN** a graph artifact is generated for a workspace
- **THEN** node `file` values in the written JSON are absolute filesystem paths

#### Scenario: Jump opens absolute path
- **WHEN** the user jumps to a node whose `file` is an absolute path that exists on disk
- **THEN** the extension opens that file and reveals the definition line

#### Scenario: Missing absolute target fails safely
- **WHEN** the user jumps to a node whose absolute `file` cannot be opened
- **THEN** the extension does not crash and indicates that navigation failed

### Requirement: Only top-level symbols become nodes
A node SHALL be created for a symbol declared at the top level of a source file, and MUST NOT be created for one nested inside a method or a function — a method itself, a function inside a function, a class declared in a method body. The drawing arranges the symbols a reader navigates between; a graph that also carried every method would be a different drawing, not a denser one.

A type declared directly inside another type MAY be a node, where its language declares a substantial part of its structure that way. In Java, 58% of guava's named types and 43% of jenkins's are declared inside another type, and `Map.Entry` and `ImmutableList.Builder` are what a reader looks for rather than an implementation detail of the type around them. A language that nests only helpers is not obliged to record them.

Such a node's `name` SHALL carry the types it is declared in, innermost last, joined by `.` — `Maps.KeySet`. A nested type's own name is not unique within its file: guava declares two different `KeySet` types in `Maps.java`, 13 such pairs in all, and jenkins 10, and a node's identity is its file, its kind and its name. The definition-line rule reads such a name as it is: the line must contain the name's last segment, which is what the declaration writes.

A nested type's line range MAY fall inside the range of the type it is declared in, and its name is what says so — `Maps.KeySet` inside `Maps`. For every other pair of nodes in one file, a range falling inside another SHALL still be a failure: that is how a document is caught recording a method, a local class or an anonymous one as a node, and it keeps that job for everything the nesting rule does not name.

A nested type SHALL NOT be contained by the type it is declared in. `contains` says a unit holds what is declared in it, and a consumer reads every node of a containing node's kind as a unit; a type that contained another would make every type in the document a unit and leave the arrangement nothing to draw as a type. What holds a nested type is the unit that holds its outermost type.

#### Scenario: A type inside a type may be a node
- **WHEN** an analyzer records a type declared directly inside another type
- **THEN** its name carries the outer type's, its line contains the name's last segment, and the unit that holds the outer type holds it

#### Scenario: A nested type's range sits inside its outer type's
- **WHEN** a document records a type declared inside another, both with ranges
- **THEN** the inner range falling inside the outer is not a failure, its name naming the outer

#### Scenario: An unrelated range inside another is still a failure
- **WHEN** two nodes in one file have ranges one inside the other and neither name names the other
- **THEN** the document is rejected

#### Scenario: A type inside a type is not contained by it
- **WHEN** a document records a nested type as a node
- **THEN** no `contains` edge runs from the type it is declared in

#### Scenario: A class declared in a method body is not a node
- **WHEN** a type is declared inside a method or a function
- **THEN** the graph contains no node for it

#### Scenario: A nested definition is not a node
- **WHEN** a top-level symbol declares a method, or a function declares a function inside itself
- **THEN** the graph contains a node for the outer symbol only

#### Scenario: A reference from inside a nested definition still belongs to its owner
- **WHEN** a nested definition refers to another node
- **THEN** the edge is attributed to the top-level symbol that contains it

### Requirement: A file with no top-level symbols is still represented
When a source file declares no top-level symbol and is not represented by
another node, the analyzer SHALL represent it with a single node of kind `file`,
whose `name` is the file's base name, so that the file is not missing from the
drawing. A file that already has at least one symbol node MUST NOT also get a
file node.

A file is represented by another node, and SHALL NOT get a file node, in two
cases:

- a unit's node is placed in it;
- it declares members that belong to a node declared in another file, as Go's
  methods belong to their receiver's type.

That is not an exclusion. The file is in the drawing, through the node its code
belongs to.

An analyzer MAY exclude a symbol-less file from becoming a node in exactly two
ways, and no others:

- It MAY name a small set of such files whose role is structure rather than
  content, such as a package marker or a generated version stub. That set SHALL
  be named in the analyzer's own capability.
- It MAY exclude a file whose every statement is an import or a re-export,
  declaring nothing of its own.

The second is not the ad-hoc judgement the first exists to forbid. It is a
property of the file, the same answer for every reader, and readable from the
source. A named set reaches a convention that has a name, such as `__init__.py`
or `index.ts`, and nothing else. Angular's barrels are called `browser.ts`,
`di.ts` and `compiler.ts`, and no list would hold its forty-five of them. Both rules are needed, because a file holding
one assignment and nothing else is symbol-less and is not a re-export.

Anything beyond those two SHALL NOT be excluded. A file the analyzer merely
judges uninteresting is a file the reader cannot know is missing.

#### Scenario: A file with nothing in it
- **WHEN** a source file declares no top-level symbol, is not represented by another node, is not in the analyzer's named set, and is not only imports and re-exports
- **THEN** the graph contains exactly one node for it, of kind `file`

#### Scenario: A file with symbols gets no file node
- **WHEN** a source file has at least one symbol node
- **THEN** no file node is created for that same file

#### Scenario: A barrel is not content
- **WHEN** a source file's every statement is an import or a re-export
- **THEN** no node is created for it, whatever the file is called

#### Scenario: A constants file is content
- **WHEN** a symbol-less file holds an assignment rather than a re-export, is not in the named set, and is not represented by another node
- **THEN** a file node is created for it

#### Scenario: A file holding a unit's declaration is represented by the unit
- **WHEN** a unit node is placed in a file that declares no symbol
- **THEN** no file node is created for that file

#### Scenario: A file of members is represented by what they belong to
- **WHEN** a file declares only members of a node declared in another file
- **THEN** no file node is created for that file

### Requirement: An edge never invents a node
An edge SHALL be emitted only when both of its endpoints already exist as nodes in the graph. Where a relationship's target cannot be resolved to a node — an external base class, a symbol from a dependency, a name the analyzer cannot follow — the analyzer SHALL emit no edge rather than create a node to point at.

Declining is the honest answer. A node conjured to be an edge's target is indistinguishable, in the drawing, from a symbol the reader's project actually contains.

#### Scenario: An unresolvable target
- **WHEN** a symbol relates to a name that is not a node in the graph
- **THEN** no edge is created, and no node is created for that name

#### Scenario: Every edge endpoint resolves
- **WHEN** an artifact is read
- **THEN** every edge's `from` and `to` name nodes present in the same document

### Requirement: Every edge carries one of the artifact's kinds
An edge's `kind` SHALL be one of `contains`, `inherits`, `uses` or `references`.

- `contains` runs from a unit node to a node declared in that unit.
- `inherits` is a declared type relationship.
- `uses` is a name in an executable position.
- `references` is a name that appears only in a type annotation.

For any ordered pair of nodes the artifact SHALL carry at most one edge: the
most specific that applies, in the order `contains` > `inherits` > `uses` >
`references`. Consumers may style and filter each kind separately, and a
consumer SHALL be able to enumerate the kinds it may encounter from this
requirement alone.

`contains` ranks first because membership is a fact about where a node is
declared, and it holds whatever the unit's own code also says about the node.
Only a language with a unit above the file produces `contains` edges.

#### Scenario: One pair, one edge
- **WHEN** a symbol both inherits from another and names it in a body
- **THEN** the artifact carries a single `inherits` edge between them, not two edges

#### Scenario: A weaker relationship survives on its own
- **WHEN** a symbol names another only inside a type annotation
- **THEN** the artifact carries a `references` edge between them

#### Scenario: Membership outranks what the unit's code says
- **WHEN** a unit's own package-level code names a type declared in that unit
- **THEN** the artifact carries a single `contains` edge from the unit to the type

### Requirement: Relationship edges are lexical, not a runtime call graph
`uses` and `references` edges SHALL be understood as an approximation drawn from what the source text names, and the artifact MUST NOT be presented as a complete or sound record of what calls what at runtime. Missing edges and spurious edges are both permitted within that bound.

Every analyzer inherits this bound, whatever resolution machinery it has behind it. A language server's answer is better than a hand-written resolver's and is still not a runtime trace.

#### Scenario: A dynamic call is not drawn
- **WHEN** a symbol reaches another only through a computed attribute or a dispatch table
- **THEN** the analyzer may omit the edge without violating this capability

#### Scenario: The reader is told
- **WHEN** the viewer explains the edge kinds
- **THEN** it says that edges are lexical rather than a runtime call graph

### Requirement: The same document serialises to the same bytes
An artifact SHALL be UTF-8 JSON with a top-level object carrying `nodes` then `edges`, indented by two spaces, with non-ASCII characters written as themselves rather than escaped, and ending in a single newline. Edges SHALL be sorted by `from`, then `to`, then `kind`. Node order SHALL be determined by the source tree, not by a hash or a set iteration.

Analyzing unchanged source SHALL produce a byte-identical artifact, and any two analyzers producing the same graph SHALL write the same bytes for it. An artifact is a file people keep, diff and commit; a document whose serialisation varies by producer turns every comparison between them into noise, and this project verifies its own work by comparing bytes.

#### Scenario: Two runs agree
- **WHEN** the same source tree is analyzed twice by the same analyzer
- **THEN** the two artifacts are byte-identical

#### Scenario: A real change is visible
- **WHEN** source changes in a way that adds or removes one edge, and the artifact is regenerated
- **THEN** the difference between the two artifacts is that edge, and not a reordering of the rest

#### Scenario: A non-ASCII name is written as itself
- **WHEN** a symbol's name contains a non-ASCII character
- **THEN** the artifact contains that character, not a `\u` escape

### Requirement: Every analyzer skips the same kinds of directory
An analyzer SHALL skip version-control metadata, dependency directories, build output and editor configuration, and SHALL also skip the project's own tests, documentation and examples. An analyzer MAY add directories specific to its language's tooling, and SHALL NOT drop any of the categories above.

The drawing is of a library's structure. Scanning a project's tests and docs adds a hub of names that exist to exercise the library rather than to be part of it — measured on the sample corpus, FastAPI goes from 112 classes to 366 — and every number this project measures is taken against the narrower tree.

#### Scenario: A test tree is not in the drawing
- **WHEN** a project keeps its tests in a directory beside its package
- **THEN** no symbol declared under that directory becomes a node

#### Scenario: A dependency directory is not walked
- **WHEN** a project has its dependencies vendored in a directory under the scanned root
- **THEN** the analyzer does not walk into it

### Requirement: A node's kind says whether it is a type or something that orbits one
`kind` is an open set. An analyzer MAY emit a kind this document does not name — `interface`, `trait`, `struct`, `enum`, `protocol`, `record` — and a consumer MUST NOT reject a document for carrying one.

Two kinds are reserved and closed, because every consumer's arrangement depends on them:

- `function` — a callable declared at the top level of a file. It orbits a type rather than anchoring anything.
- `file` — the whole file, standing in for a file that declares no top-level symbol at all.

**Every other kind is a type**: something a consumer may root its arrangement on. `class` is one; so is any kind an analyzer invents for a language whose types are not called classes. A consumer decides what is a type by asking what is *not* one of the two reserved kinds, never by matching a list of names it was taught.

The set is open in one direction only. Adding a kind is additive; a document that renames `function` or `file`, or that uses either for something that is not what they say, breaks every consumer silently — the drawing still appears, arranged around the wrong things.

#### Scenario: A kind the consumer has never seen
- **WHEN** an artifact carries nodes of a kind the consumer does not recognise
- **THEN** the consumer treats them as types, draws them, and does not reject the document

#### Scenario: The two reserved kinds mean what they say
- **WHEN** an artifact carries `function` and `file` nodes
- **THEN** they are the only kinds a consumer treats as orbiting rather than anchoring

#### Scenario: A language whose types are not classes
- **WHEN** an analyzer for a language with no `class` keyword emits `struct` and `interface` nodes and no `class` nodes
- **THEN** the document is valid, and a consumer has types to arrange

### Requirement: A node's line is where its name is declared
A node's `line` SHALL be the line carrying the declared name, and MUST NOT be the line of anything that merely precedes the declaration — a decorator, an attribute, a documentation comment. `endLine`, where present, SHALL be the last line the declaration spans, and MAY include what precedes the name.

This is what a jump lands on, and every producer must land on the same thing. Parsers disagree on where a declaration starts: Python's `ast` reports the `class` or `def` line, while TypeScript's `getStart` includes decorators, which would put a decorated Angular class on the `@Injectable()` line above it.

#### Scenario: A decorated declaration points at the declaration
- **WHEN** a symbol is preceded by one or more decorators or attributes
- **THEN** its `line` is the line the symbol is named on, not the first decorator's

#### Scenario: The line names the symbol
- **WHEN** a node's `line` is read out of its `file`
- **THEN** that line contains the symbol's own name

### Requirement: A unit above the file may be a node
An analyzer for a language whose code is organised in a unit above the file MAY
represent each unit as a node. Examples of such a unit are a Go package, a Java
package and a Rust module.

The unit's `kind` SHALL be named by the language, and SHALL NOT be `function` or
`file`. A consumer therefore treats a unit as a type, something the arrangement
may be rooted on. A language's unit is where its readers navigate from.

A unit node SHALL carry a `file` and a `line` that are a real declaration of the
unit in one of its files, so that a jump to it lands on source. Its identity is
built from those fields, as every node's identity is.

A unit node SHALL carry a `contains` edge to every node declared in the unit. No
node SHALL be the target of `contains` edges from more than one unit.

#### Scenario: A unit is something to root on
- **WHEN** an artifact carries `package` nodes
- **THEN** a consumer treats them as types, not as what orbits one

#### Scenario: A unit lands on source
- **WHEN** a unit node's `line` is read out of its `file`
- **THEN** that line declares the unit and contains its name

#### Scenario: Each member belongs to one unit
- **WHEN** an artifact carries `contains` edges
- **THEN** no node is the target of more than one of them

#### Scenario: A language with no unit carries no unit
- **WHEN** an analyzer's language has no unit above the file, as in Python and TypeScript
- **THEN** its artifacts carry no unit nodes and no `contains` edges

### Requirement: A node may record the members that belong to it
A node MAY record the members declared inside it or against it — a method, and nothing else until a language asks for more. Each member SHALL carry its own name, the absolute path of the file it is declared in, and the line its name is declared on, so that a consumer can reach it in the source.

A member SHALL NOT also be a node, where being the same means being declared in the same place — the same file and the same line — and not merely sharing a name. Go puts a method and a package-level function of one name in one file: cobra declares `Command.MarkFlagRequired` and `MarkFlagRequired` side by side, and there are 99 such pairs across the four Go projects. Those are two declarations, and a document recording both is correct. Members do not relax the rule that only top-level symbols become nodes: they are what a node says about what it contains, not a way to carry more of them. Taken as nodes, Go's methods collide 2,376 times across the standard library, which is why they are their receiver's.

A member's file MAY differ from its node's. Go declares a method at the top level of any file in the package, and 2% of the drawn files in hugo hold nothing but methods of a type declared elsewhere.

Recording members is optional, and a consumer MUST NOT require them. A language whose members the analyzer does not record, or which has none, produces a document with none, and every consumer reads it the same way.

#### Scenario: A member names where it is
- **WHEN** a node records a member
- **THEN** that member carries a name, an absolute file path and the line its name is declared on

#### Scenario: A member is not a node
- **WHEN** an artifact records members
- **THEN** no member is declared at the same file and line as a node in the same document

#### Scenario: A member sharing a node's name
- **WHEN** a method and a top-level symbol of the same name are declared in one file
- **THEN** both are recorded, the member against its receiver and the symbol as a node

#### Scenario: A member declared in another file
- **WHEN** a type's method is declared in a different file from the type
- **THEN** the member records the file it is declared in, not the file its node is in

#### Scenario: An artifact that records none
- **WHEN** an analyzer records no members
- **THEN** the document is valid and every consumer reads it as a document without members

### Requirement: A node may say that its language marks it as internal
A node MAY record that the language it is written in marks it as not for reaching outside the code that declares it. The analyzer SHALL decide this in its own language's terms, and a consumer SHALL NOT infer it from the name.

No convention travels. Python marks it with a leading underscore, Go with the case of the first letter, and each is wrong about the other: 40% of hugo's types and 45% of prometheus's are unexported and carry no underscore, while 85% of Django's functions, 95% of Angular's and 81% of zod's begin with a lower-case letter and are the opposite of internal.

Recording it is optional, and a consumer MUST NOT require it. An artifact that records it nowhere is valid, and nothing in it is read differently.

#### Scenario: The analyzer decides, in its own terms
- **WHEN** an analyzer for a language whose mark is not an underscore records an internal symbol
- **THEN** the node carries the flag, whatever its name looks like

#### Scenario: An artifact that says nothing
- **WHEN** an analyzer records the flag on no node
- **THEN** the document is valid and every consumer reads it as a document without the flag

### Requirement: CLI writes a planisphere.json artifact
The primary way to produce a structure graph artifact SHALL be the Planisphere CLI (`planisphere`), which runs an analyzer over the given root(s) and writes a `planisphere.json` file, or the `*.planisphere.json` the reader names. The VS Code/Cursor extension MUST NOT be required to generate the artifact.

The CLI SHALL choose the analyzer from the source it finds under the roots, and the reader SHALL be able to name one instead. Where source for more than one analyzer is present and none was named, it SHALL say which it found and decline rather than choose — one artifact per language is a decision the reader makes, and merging them is not a producer's decision.

#### Scenario: Successful CLI generate with Python sources
- **WHEN** the user runs the Planisphere CLI on a directory that contains analyzable Python files
- **THEN** a `planisphere.json` file is written and its contents represent the analysis graph for those sources

#### Scenario: A named analyzer with nothing to read
- **WHEN** the user names an analyzer and runs it on a directory holding none of its source
- **THEN** it still writes a valid artifact whose graph has zero nodes and zero edges (or an equivalent empty graph document)

#### Scenario: Nothing to dispatch to
- **WHEN** the roots hold source for no analyzer at all and the user named none
- **THEN** the CLI reports that and exits without writing an artifact

#### Scenario: Analysis failure surfaces clearly
- **WHEN** generation fails because analysis cannot complete
- **THEN** the CLI does not silently write a partial artifact as success, and exits with a non-zero status or a clear error on stderr

#### Scenario: The analyzer follows from the source
- **WHEN** the user runs the CLI on a directory holding source for exactly one analyzer
- **THEN** that analyzer runs, without the reader naming it

#### Scenario: The reader names the analyzer
- **WHEN** the user names a language on the command line
- **THEN** that analyzer runs, whatever else is under the roots

#### Scenario: More than one language, none named
- **WHEN** the roots hold source for more than one analyzer and the user named none
- **THEN** the CLI reports which languages it found and exits without writing a partial artifact

