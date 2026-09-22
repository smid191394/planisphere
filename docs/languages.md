# Which languages, and how they get in

Which languages Planisphere reads, what each one forces the artifact to say,
and what each measures on its sample projects. For languages not yet read, the
ordering below is a direction, not a commitment.

## The sample projects

`fixtures/<language>/<name>/planisphere.json`, generated from an
external clone in the same directory and gitignored. The artifact is always
generated from the **package directory**, not from the clone's root:

```
django     fixtures/python/django/django              1,881 classes
cpython    fixtures/python/cpython/Lib                2,363
fastapi    fixtures/python/fastapi/fastapi              112
flask      fixtures/python/flask/src/flask               46
pydantic   fixtures/python/pydantic/pydantic            358
requests   fixtures/python/requests/src/requests         46
scrapy     fixtures/python/scrapy/scrapy                299

zod        fixtures/typescript/zod/packages/zod/src      52 classes, 622 interfaces
nest       fixtures/typescript/nest/packages           291 classes, 293 interfaces
typeorm    fixtures/typescript/typeorm/src             368 classes, 326 interfaces
angular    fixtures/typescript/angular/packages      8,832 nodes, 28,324 edges

cobra      fixtures/go/cobra        adbc881      127 nodes,    362 edges
gin        fixtures/go/gin          dcaa429      250 nodes,    672 edges
hugo       fixtures/go/hugo         a374b86    3,079 nodes, 13,256 edges
prometheus fixtures/go/prometheus   46ef370    3,244 nodes, 14,294 edges

syn        fixtures/rust/syn        2ebf5f9    1,273 nodes,  6,053 edges
tokio      fixtures/rust/tokio      66e1387    1,788 nodes,  4,015 edges
regex      fixtures/rust/regex      72d650c    1,108 nodes,  4,428 edges
ripgrep    fixtures/rust/ripgrep    3fce3b5      634 nodes,  2,031 edges
sqlparser-ranger fixtures/rust/sqlparser-ranger 03c1dfb  109 nodes,    390 edges

guava      fixtures/java/guava            5a7407d  3,313 nodes, 14,980 edges
jenkins    fixtures/java/jenkins          81dc9a3  2,323 nodes, 11,959 edges
junit5     fixtures/java/junit5           d67c7bc  1,348 nodes,  5,963 edges
jackson-databind fixtures/java/jackson-databind 2a428d9  864 nodes,  6,159 edges
```

A Go fixture is generated from the **module root** with `--lang go`, because a Go
module's root is its package tree. prometheus also holds TypeScript under
`web/ui`, so the language has to be named. The four were chosen to disagree:
cobra is two packages and 14% types with no embedding at all; gin is a small
framework; hugo is a large application with 193 packages; prometheus has 251
dependencies and constrains 15% of its files to particular platforms. The Go
standard library was measured and is not kept: at about 33,000 nodes it would
be what VS Code is.

A Rust fixture is generated from the **repository root** with `--lang rust`, so a
workspace is drawn whole. The four were chosen to disagree. syn declares its own
types inside macros, which is the worst case for the one thing the analyzer
cannot do; tokio is a workspace of crates gated by `#[cfg(feature)]` on nearly
everything; regex writes its tests inside its source and ships as a family of
crates; ripgrep is an application rather than a library, binaries beside a
library and few traits. sqlparser-ranger, a small crate of the reader's own, is kept beside
them as the extreme on two axes: 88% of its impls sit in another file from their
type, and 41% of its lines are test code. The Rust standard library was measured and is not kept,
for the reason the Go one was not.

The four TypeScript projects were chosen to disagree with each other. zod is
type-and-function-heavy with almost no classes; NestJS and Angular are
monorepos whose packages genuinely do not depend on one another; TypeORM is one
large package. Angular is the ceiling: at 8,832 nodes and 28,324 edges it is
larger than CPython, and its layout alone is 6.2s against CPython's 0.8s.

VS Code is measured but deliberately not kept. At 6,543 files it
produces 35,235 nodes and 170,107 edges — a 67MB artifact that lays out in 156
seconds. The drawing is not the problem: 96% of it lands in one tree, the most
complete of any project measured. The wait is, and a corpus whose largest
member is unusable makes every measurement about that member. What it shows is
under **What a very large drawing costs** below.

Scanning the clone instead takes in its tests, examples and docs — FastAPI
goes from 112 classes to 366 — and every fixture-based number in the test
suite is measured against the narrower one.

## What is language-agnostic

The viewer reads `*.planisphere.json` and knows only this much:

```
node.kind   function and file orbit; everything else is a type
edge.kind   contains | inherits | uses | references
node        id, name, file, line
```

Nothing under `src/` mentions `.py`. The whole Python coupling is
`analyzers/python/` and the `python-symbol-graph` capability. Each other
language is another producer of the same document, not a change to the viewer —
a sibling directory under `analyzers/`, free to be written in its own language,
with its own runtime, dependencies and test runner.

`analyzers/typescript/`, for one, is a Node program using the compiler API; it
shares no code with the Python analyzer and brings its own test runner
(`node --test`). The same `contract/conformance.js` passes over every artifact
every producer writes — several producers, several languages, one document.

## What a very large drawing costs

Each language is also its own set of sizes.

```
project   files with symbols   nodes    edges   layout
cpython                  647    5395     9164     0.8s
angular                1,744    8832    28324     6.2s
vscode                 6,543   35235   170107        —
```

**Layout time follows edges, not nodes, and faster than either.** Angular has
1.6 times CPython's nodes and 3.1 times its edges — 2.5 times the total — and
takes 7.6 times as long. Layout time does not grow linearly in nodes plus
edges, so `Every graph shape produces a layout` bounds the time on the largest
target instead of bounding the growth rate. Opening
Angular takes about six seconds and the reader has judged that acceptable for a
drawing they then read for an hour — which is the question a growth rate cannot
answer either way.
The column above is the layout alone; the 156s given for VS Code is a whole
harness pass including building cytoscape elements in a stubbed DOM, and is not
an open time. VS Code's layout is not measured on its own and its artifact is
not kept, so that cell is empty rather than estimated.

**Edge density is a property of the language, and it is not the analyzer being
loose.** Per hundred lines of function body, `uses` edges come out at 7.4 for
CPython and 7.2 for Django against 8.1 for VS Code, 8.6 for Angular and 6.8 for
TypeORM. The Python and TypeScript analyzers agree. What differs is above that:

- A TypeScript class is three times the size of a Python one — median 49 lines
  against 14 — so it emits more of everything.
- TypeScript annotates and Python mostly does not. A VS Code class emits 4.2
  `references` edges; a CPython class emits 0.0, and 2,363 CPython classes
  produce 61 `references` edges between them.

**An artifact is mostly path text.** 73% of VS Code's 67MB is paths, and 42.6MB
of that sits inside edges, because an edge stores two full
`<file>::<kind>::<name>` ids and VS Code's paths run to 105 characters. This is
not what makes the drawing slow — parsing 67MB takes 487ms against 156 seconds
of layout — but it is what makes it large.

## The vocabulary sorts languages before popularity does

| | |
| --- | --- |
| **Fitted** | Python, TypeScript; Go, Rust and Java, each with a *settled* section below |
| **Fits as it stands** | Kotlin, C#, Swift, Scala, Dart, PHP, Ruby |
| **Breaks the drawing** | C — no classes at all, so the layout's premise (a class tree with functions in orbit) has nothing to stand on |

## What a second language asks of the contract

Three of these are shared by nearly every language on the list, so they are not
per-language work. They are contract questions, answered once for the whole list.

### 1. `kind` is an open set

`function` and `file` orbit, everything else is a type, and a viewer that has
never heard of a language arranges its types correctly. A closed set costs more
than "an interface can never be drawn differently from a class": the tree has
nothing to root on. zod declares 52 classes among 1,816 symbols, so a
class-rooted tree would be rooted on 3% of the drawing. A viewer that tested
for `class` would read it like this:

```js
function isTreeVertex(graph, node, alsoVertex) {
  if (node.kind === "class") return true;   // and nothing else
  ...
}
```

With that test, an analyzer that emits `kind: "interface"` breaks nothing and
reports nothing. It gets three wrong answers quietly: the node is not a tree
vertex, so every interface is demoted to a satellite or falls into the cluster
of unconnected nodes; `node[kind != "class"][kind != "function"]` catches it,
so it is drawn in the file colour; and the settings panel has no row for it, so
the reader cannot recolour it.

Every language below needs at least one type kind that is not `class`:
`interface`, `trait`, `struct`, `enum`, `protocol`, `record`. Collapsing them
all to `class` would leave the viewer untouched and mean an interface can never
be drawn differently from a class. With `kind` open, `isTreeVertex` asks "is
this kind a type" rather than "is this kind class", and the palette grows with
the list.

### 2. `inherits` conflates two different relations — deferred with numbers

Measured on TypeScript, `implements` is 1 of 673 heritage edges in zod, 31 of
166 in NestJS and 32 of 368 in TypeORM — real, and about one in ten. Both are
emitted as `inherits` until a language asks louder. The reasoning below holds
for Java and C#.


```java
class UserAdmin extends ModelAdmin implements Serializable, Comparable
                ^^^^^^^ inherits code        ^^^^^^^^^^ promises a shape
```

Python does not raise this — an ABC is a class — and it is the one addition that
can be predicted with confidence, because TypeScript, Java, C#, Kotlin, Swift,
PHP and Rust all draw the distinction and their readers care about it. Either a
fourth edge kind, or an attribute on the edge.

### 3. Several languages have a unit above the file — TypeScript does not force it

A TypeScript module is a file, so this stays Java's, Go's and Rust's question.

Types declared inside a `namespace` are counted by the `ModuleBlock` they sit
in: the parent of a class inside `namespace X { }` is the block, not the
`ModuleDeclaration`.

```
          files with a namespace   declarations inside   same-name pairs in one file
zod                            6                    59                             7
angular                       15                    19
nest                           1                     8
typeorm                        1                     0
```

Those declarations are nodes, named for the scope they are in —
`Shapes.Circle` — because seven of zod's collide with a name at the file's top
level otherwise. The namespace itself is not a node, which is what would answer
this section's question.

Python, TypeScript, JavaScript, PHP and Ruby are fine: a module is a file, and
`node.file` already carries it. Java, Kotlin, C#, Go and Rust are not — a Go or
Java package is a directory, a C# namespace is declared, and a Rust `mod` is
neither, one file being free to declare several.

This can be an attribute or a node, and the two are different drawings:

- **As an attribute**, every node carries its package. It costs the viewer
  almost nothing and it repairs a real loss: `orderRingClasses` groups siblings
  on a ring by inherit-connected component, which degenerates to alphabetical
  order in a language with no inheritance edges, and package is the natural
  thing to group by instead.
- **As a node**, `kind: "package"` with types hanging off it, which draws the
  dependency graph between packages. That is the drawing a Go reader most wants
  — and not only Go: Django's apps and CPython's `Lib` subdirectories are the
  same request.

Both, probably, but they are two features.

### 4. Containment between types

Nested classes, inner types, `mod` inside `mod`. A type is never contained by
another type. Java draws a nested type as a node of its own, named by the types
it is declared in (`Maps.KeySet`) and placed in its outermost type's package;
Rust's inner modules are units that `contain` what they declare.

## What each language needs

| | kinds | implements vs extends | unit above the file | other |
| --- | --- | --- | --- | --- |
| Python | — | no (an ABC is a class) | module = file | done |
| TypeScript | `interface` `type` `enum` | yes | module = file | much of the code is functions, not classes |
| Java, Kotlin | `interface` `enum` `record` | yes | package = directory | done for Java; see *Java, settled*. Nested classes are most of a codebase |
| C# | `interface` `enum` `record` `struct` | yes | namespace | as above |
| Go | `struct` `interface` | embedding in a type declaration is `inherits` | package = directory | done; see *Go, settled* |
| Rust | `struct` `enum` `trait` `union` | yes (`impl Trait for T`) | `mod` is not a file | done; see *Rust, settled* |
| Swift | `protocol` `struct` `enum` | yes | module | `extension T: P` declares conformance far from `T` |
| PHP | `interface` `trait` | yes | namespace | closest to the model as it stands |
| Ruby | `module` | `include`, arguably | module = file | more dynamic than Python; resolution is harder |

Reading down the columns: seven languages need the `implements` distinction,
eight need open kinds, five need a unit above the file. One language needs
something only it needs.

## Go, specifically

Go has no inheritance, and the two things that resemble it are not it:

```go
type Server struct { *Logger }   // embedding: Logger's methods are promoted,
                                 // but a Server is not a Logger

type Reader interface { Read(p []byte) (int, error) }
func (f *MyFile) Read(...) ...   // MyFile satisfies Reader, and no line of
                                 // code anywhere says so
```

So `inherits` needs a meaning chosen for it:

- **embedding only** — cheap and honest, but it is composition, not inheritance
- **interface satisfaction** — the real "is-a", and it must be computed by
  comparing method sets for every type against every interface. It also
  explodes: `error` is satisfied by hundreds of types and `any` by all of them,
  so it would need filtering rules of its own
- **none** — `uses` alone

**`uses` alone is viable.** Measured on the Python fixtures by filtering the
graph to `uses` edges: Django keeps 2,519 of 2,851 nodes in its primary tree,
CPython 4,218 against 3,943, FastAPI 192 of 254. The tree still forms, because
`classOnlyAdj` does not look at edge kinds — it walks every class-to-class edge.
Fragmentation rises (Django 5 groups to 28, 208 unconnected to 577) but the
drawing does not collapse.

And the rings change meaning in a way that suits Go: with inheritance, depth is
roughly specialisation; with `uses` alone it is dependency distance, and Go
codebases are layered by dependency rather than by hierarchy.

What is lost is smaller than it looks and worth naming: `orderRingClasses`
groups a ring's classes by inherit-connected component and would fall back to
alphabetical order, so families stop sitting together; `pickCenterAmong` loses
one of its tie-breaks; and the legend teaches three edge kinds where there
would be one.

**The real Go question is not `inherits` — it is the package.** A drawing of Go
types that ignores packages misses the unit Go programmers navigate by, and
that matters more than the missing edge kind.

## Go, settled

What the Go analyzer does, and why.

**Go answers for Java and Rust.** The package forces a unit above the file,
which Java and Rust also need, and the lack of inheritance forces an answer about
what `inherits` means. Settled against the language that forces them hardest,
both leave the other two a finished contract. `go/types` is in the standard library,
so, as with TypeScript, a hand-written analyzer is not a compromise.

**A method is its receiver's.** Go declares a method at the top level of a file,
so taken as nodes, methods collide: 2,376 identities across 393 files of the
standard library, `PipeReader.Close` beside `PipeWriter.Close`. Folded into their
types, as a Python method belongs to its class, the only names left colliding
are `init` and `func _`, and neither can be named, so neither is a node. Types
then make up 40% to 48% of gin, hugo and prometheus, inside the range the corpus
already draws.

**A type carries its methods.** A method is not a node, and nothing else in the
document names one: without members, searching prometheus's drawing for `Append`
matches 62 nodes while the source declares 226 things by that name, and
`ServeHTTP` matches nothing at all. So a node records the members that belong to it — each method's
name, the file it is declared in, and its line. The panel lists them when the
type is focused, and search offers them; choosing one opens the source instead
of moving the camera, because there is no node to move to. hugo records 3,934
methods over 723 types and prometheus 4,429 over 804. `Head` lists 108 and
`OpenAPIBuilder` 111. `SDConfig` lists 6: that name belongs to 26 types, one per
discovery package, and a type is shown its own.

Members cost 15.9% of hugo's artifact (4.08MB without them, 4.72MB with) and
16.6% of prometheus's (4.47MB to 5.21MB); cobra and gin grow 22.2% and 25.7%,
their artifacts being small enough that a few hundred methods weigh. Opening
prometheus takes 4,382ms with them against 3,764ms without, and search timing
does not move. Members are 9.6% of the prometheus document, and 5.5% of it
is the absolute file path repeated on every one, because 4,047 of the 4,429
methods are declared in their own type's file. Recording that path only when it
differs would return most of the cost; it makes the field conditional, so it is
left to be argued on its own.

**A package is a node, and `contains` is the fourth edge kind.** Every node
declared in a package gets a `contains` edge from it, and a package points at
every package its code names. That is not the same as every package it imports.
hugo's `commands` never imports `cache/filecache`, but it calls `Prune` on what
`FileCaches.ModulesCache()` returns, and 127 of hugo's 1,151 package edges are
reached this way. Drawn in one tree with the types, containment does not make
the drawing packages with their members in rings: every drawing centres on a
struct, and 33% to 48% of the tree's types hang off their package. It holds that
drawing together, with 98% of hugo's nodes in one group and 99% of
prometheus's. It also collapses it, which is why packages are a tree of their
own.

**Packages and types are two trees, joined by a click.** Drawn on the same
rings, the package-to-package edges and every type's `contains` edge act as
shortcuts: hugo's drawing is 6 rings deep, and its worst ring holds 757 nodes at
4.5px of arc each. Hanging each type off its package makes that worse. So an
edge that joins a unit to something that is not a unit is neither arranged by
nor drawn in the whole drawing. A unit is a node that `contains` others, or anything of the same kind,
so an empty package still counts. The right-button view keeps those edges:
pressed on a package, it fans out what the package contains. A click joins the
two trees, because emphasis reads adjacency from the artifact rather than from
the lines on screen. Each `→` below reads one shared tree → two trees:

```
            bounds                 groups                               type tree                       package tree                    edges built on open  open (median of three)
hugo        3438×1646 → 5848×3475  4 → 14 (packages 1 group, no types)  depth 7, worst 350@360px 6.5px  depth 3, worst 79@180px 14.3px  7,235 → 5,614        4,493 → 3,884ms
prometheus  3653×1680 → 5016×2267  5 → 7 (packages 1 group, no types)   depth 9, worst 478@540px 7.1px  depth 3, worst 69@360px 32.8px  5,825 → 4,433        4,514 → 3,947ms
```

The costs are measured and accepted:

- **The drawing is larger.** The two trees stand side by side, so it opens at a
  smaller magnification.
- **Some functions are unconnected.** A function held only by its package has no
  edge in the arrangement. 44 of hugo's drawn functions and 11 of prometheus's
  are among the unconnected nodes. In prometheus, 59 more such functions are
  folded into same-named groups.
- **Membership takes a click.** Which package a type belongs to is visible when
  it is clicked, not before.

Python and TypeScript drawings carry no `contains` edge, and their ten recorded
layout hashes do not depend on any of this.

**Embedding is `inherits`, but only in a type declaration.** An anonymous struct
built inside a function also embeds, and taking that as `inherits` would draw
functions that inherit, hugo's `XxHasher` and prometheus's `instantValue` among
them. Confined to declarations, hugo has 374 `inherits` edges rather than 385
and prometheus 164 rather than 167. Types joined by embedding sit on one ring or one step apart 71%
of the time in hugo and 83% in prometheus, against 74% for Django's inheritance
and 71% for Angular's.

**What is private is the language's to say.** The centre a drawing chooses for
itself passes over what the codebase presents as its plumbing. For Python that
test is one line: the name begins with `_`. That is Python's mark and only Python's. Go
marks it with the case of the first letter, which is what its own compiler reads
to decide what leaves a package — measured, 67 of cobra's 127 nodes, 117 of
gin's 250, 1,250 of hugo's 3,079 and 1,755 of prometheus's 3,244 carry that mark
and not one carries an underscore.

So the analyzer says it and the viewer reads it: where any node in an artifact is
recorded as internal, that is what private means for that drawing; where none
is, the viewer falls back to the `_` rule, which is how every Python and
TypeScript artifact reads. The viewer MUST NOT apply one language's
convention to another — reading a lower-case initial as private would rule out
85% of Django's functions, 95% of Angular's and 81% of zod's.

A package node and a file node are never marked, whatever they are called. A Go
package name is always lower case and an import path is how a package is
reached; a file node's name is a file name. Read literally, the case rule would
mark every package and every file in every Go drawing and take the whole package
tree out of the running.

The four drawings open on `Command`, `Engine`, `RootConfig` and `Options`, all
exported, and the flag keeps unexported types out of the running behind them:
prometheus's top five candidates are `Options`, `Head`, `ScrapeConfig`, `DB`,
`Options`, where the `_` rule alone would rank `scrapeLoop` and `memSeries`
fourth and fifth. The flag costs between 0.6% and 1.2% of the artifact, and the
ten recorded Python and TypeScript layout hashes do not depend on it.

**Go marks it twice, and both are read.** The case of the first letter is one
mark. The other is the `internal/` directory, and it is the harder of the two,
because the compiler enforces it: it refuses an import of a package under
`internal/` from anything outside the subtree rooted at the directory holding
it. A name says nothing about that: read by case alone, 188 of hugo's types and
functions — capitalised, and unreachable from outside their own subtree — would
be marked as nothing at all.

The two tests differ in what they can speak about. The case of a letter says
nothing about a package, since a Go package name is always lower case, so the
name test skips package and file nodes; the location test applies to them,
because where a package sits is exactly what decides whether it can be imported.
A directory named `internals` is an ordinary directory: the rule reads whole
path segments, as Go does.

Measured, the location marks 209 nodes in hugo that the case does not (188
types and functions, 18 packages, 3 files) and 5 in gin; cobra and prometheus
have no `internal/` directory. It moves no centre — not the primary centre of
any of the four drawings, and not one of hugo's fourteen group centres, two of
which sit under `internal/` because those groups are internal the whole way down
and a group must centre on something. What it buys is that hugo's
`ExternalOptions`, which the case alone ranks tenth of 1,562 candidates, and
gin's `FileSystem`, forty-eighth of 105, are not candidates at all.

**Nothing is downloaded.** Dependencies resolve to empty packages. hugo requires
180 modules and prometheus 251, and an edge to any of them is one the contract
forbids anyway. Every platform's files are walked, because a document that
depends on the machine that wrote it cannot be byte-identical.

**A file of blank imports is not a node.** The contract excludes a file whose
every statement is an import, and Go having no re-export does not make that rule
idle: prometheus's `plugins` directory is 26 files, each holding one
`import _ "…/discovery/aws"` and joined only to a package placed elsewhere, and
drawn they would be a ring of file nodes. prometheus draws 7 file nodes rather
than 33. A package whose remaining members are
all file nodes still draws oddly: the viewer files the package among the
unconnected nodes and gives the file a group of its own. `tsdb/goversion` and
`web/ui` do this, and it is a viewer question rather than an analyzer one.

## Rust, settled

Rust keeps Go's two decisions — a module is a unit, and the inheritance-shaped
edge is the trait a type is given — and answers two things no other language
here forces.

**The tests are inside the source, so the rule is `#[cfg(test)]`, not a file
name.** Anything declared in a module attributed `#[cfg(test)]` is not walked, at
any depth, and a `#[cfg(test)] mod tests;` claims its file so that no later pass
reads it as an orphan. Every other `#[cfg]` is walked, as Go walks every platform.
Measured over what the analyzer walks, test code is 11% of the standard library's
lines, 15% of regex-syntax's and 41% of one small crate's.

**A module is a unit placed at its `mod` line, and a crate is a unit placed at its
manifest.** A module node carries no range: an inline module's items sit below its
`mod` line, and a range would put each of them inside another node. A crate root is
named in no `.rs` file, so its node lands on the line of `Cargo.toml` that names it,
spelled as the manifest spells it and one line long — a manifest may name a library
and several `[[bin]]` crates, and a longer range would contain them all. A root
Cargo builds without the manifest naming it — `src/main.rs`, a `src/bin/` file no
`[[bin]]` claims, the build script — is contained by the crate node carrying the
package's name, which lands on the package's `name` line. Nothing names those roots,
and without a crate above them `cargo new`'s default shape would draw a unit tree
with no top: syn's `codegen/` would hang 20 nodes from nothing.

**Methods are members, a trait's own included.** An `impl` block's functions are
its type's members wherever the block is written, and 11% of the standard library's
impls and 88% of one small crate's sit in another file from their type. A trait
lists its own methods, signatures and default bodies alike. An `impl` for a type
the document does not hold records no member, and what its body names is the
trait's.

**`inherits` is `impl Trait for Type`, a supertrait, or a derive of a local
trait.** A derive of `Clone` draws nothing, `Clone` not being a node. Blanket impls
do not explode the edge count: they are 2%.

**Names resolve within the crate, by what the source declares and imports.** `use`
declarations, globs, `crate`, `self` and `super` are followed. That is Python's
level of resolution rather than Go's, and it was sampled: twenty edges drawn at
random from the four fixtures were all right. The sample measures what is drawn,
not what is missed.

**A macro invocation is read as far as its body parses as items.**
`ast_struct! { pub struct Block { … } }` declares `Block`. In syn, 176 invocations
parse that way and 65 do not.

**`syn` is a dependency.** Rust has no parser outside its compiler. The lockfile is
committed, building the analyzer fetches `syn` once where cargo's cache does not
hold it, and nothing the analyzed project depends on is ever fetched.

```
         commit   nodes   edges  unit tree  type tree  worst ring (unit / type)  primary group    open
syn      2ebf5f9  1,272   6,030        102        285            24.1px / 7.0px            89%  7639ms
tokio    66e1387  1,788   4,015        502        767           15.1px / 41.2px            64%  2096ms
regex    72d650c  1,108   4,428        183        562           46.2px / 15.2px            43%  1535ms
ripgrep  3fce3b5    633   2,028         85        379          102.8px / 47.1px            40%   865ms
hugo     a374b86  3,079  13,256        186      1,343            14.3px / 6.5px            90%  3329ms
```

The unit tree is where the risk is: a Rust crate has roughly one module for every
two types, where hugo has one package for every sixteen nodes. It is larger —
tokio's unit tree is 65% the size of its type tree — and it is not more crowded.
Its worst ring gives each node 15.1px, beside hugo's 14.3px, because it grows five
rings deep instead of three. Nothing in the viewer is specific to Rust.

syn opens in 7.6 seconds, the slowest drawing measured, with fewer nodes and edges
than hugo. The cause has not been measured.

### What it cannot see

- **A macro body that does not parse.** In syn, `define_keywords!` and
  `define_punctuation!` hide about a hundred token types — the whole of
  `syn::token` — and 25 `ast_struct!` bodies carry a `#full` marker that is not
  Rust. In the standard library, measured and not kept, `cfg_select!` chooses the
  platform layer and hides 277 modules. tokio's `mock!` hides 33 declarations;
  regex and ripgrep lose nothing this way.
- **A file `syn` cannot parse**, which is skipped whole and without a word. No file
  in the four fixtures or the local crate; 28 of the standard library's 1,557,
  which are written in nightly syntax.
- **An edge between the crates of one workspace.** Names resolve within a crate, so
  a workspace draws as islands: 40% of ripgrep's nodes are in its primary group and
  43% of regex's, against 90% for hugo.
- **A method call's target**, there being no type to say what it is called on.

Two things are drawn that a reader may not expect. A `build.rs` is walked like any
source, and sits under its package's crate: three nodes each in syn and ripgrep,
four in sqlparser-ranger, and ripgrep gains a crate node, `ripgrep`, holding
nothing else, because its only named crate is the binary `rg`. And so are test-support
crates whose directories are not named `tests` — tokio's `tests-build`,
`tests-integration` and `stress-test`, regex's `regex-test`, and every `fuzz/`.
The contract skips a directory by its exact name, and none of these names is on
that list.

**The scan was checked against the analyzer on the same source.** Where the two
differ, the scan counted something the drawing rightly leaves out: associated types
inside `impl` blocks taken for aliases (1,277 of the standard library's 1,787),
clap's example programs under `examples/` (every one of the 62 declarations the
analyzer lacks there), declarations under `#[cfg(test)]` or nested in a function
body, and syn's 25 `#full` bodies. regex-syntax agreed exactly on types, traits and
modules.

## Java, settled

Java takes the package as its unit, as Go does, and forces one thing no other
language here does: **a type declared inside a type**. The artifact allows such
a node, and says how.

**The JDK's own compiler reads the source, so the analyzer has no dependency.**
`ToolProvider.getSystemJavaCompiler()` is in any runtime carrying
`jdk.compiler`, with or without a `javac` binary beside it, and `java
Analyzer.java` runs the analyzer from source with no build step. What Rust gave
up when it took `syn`, Java gets back. The cost is that Java 21 runs one file
from source, so the analyzer is one file.

**The compiler must be told to carry on after an error.** Nothing is
downloaded, so every project is compiled without its dependencies. Left alone,
javac finishes the attribution of 0 of jackson-databind's 575 files and returns
nothing at all; with `-XDshould-stop.ifError=GENERATE` it finishes all 575 and
resolves 42,683 type references. That option is internal to javac and is the one
place this analyzer depends on something unsupported.

**A source root is a directory minus a package path.** `…/src/a/b/C.java`
declaring `package a.b` has the source root `…/src`, and each root is compiled on
its own. No build file is read: a repository that has never been built is
analyzed like one that has. Compiled as a single program instead, guava reports
93 duplicate classes — it keeps an `android/` mirror of its sources — and 70% of
its type references fail to resolve; per root it is 2.7%.

**A nested type is a node named for the type around it** — `Maps.KeySet` — and
it is contained by its package, never by that type. 1,873 of guava's 3,247 types
and 949 of jenkins's 2,204 are nested, and a file declares two types of one
simple name often enough to matter: 13 pairs in guava, 10 in jenkins. Naming a
node for the type it sits in is also what tells `Maps.KeySet` from the 56 other
types called `KeySet` or `Builder` in the same project. Containment goes to the
package because a consumer reads every node of a containing node's kind as a
unit; a type containing a type would make every type a unit and empty the type
tree.

**A reference across source roots is joined by name.** The compiler resolves
within a root; beyond it, it hands back the simple name it saw, and the file's
imports say which type that was. It is 42.7% of junit5's drawn relationships,
which is the difference between one drawing and thirty-three islands, and under
1% of guava's, jenkins's and jackson's.

**Methods and constructors are members**, as Go's methods are: 25,363 of them in
guava. Fields and enum constants are not — guava alone declares 5,743 enum
constants, and they are values.

**`internal` is neither `public` nor `protected`.** `protected` is part of what
a subclass outside the package may use. Measured: 66% of guava's nodes are
internal, 38% of junit5's, 16% of jenkins's and 14% of jackson's — guava's number
is what a library of nested helpers looks like.

### What it cannot see

- **A type a library declares.** Nothing is downloaded, so a name from a
  dependency resolves to nothing and draws nothing: 1.2% to 3.3% of type
  references across the fixtures.
- **A class declared in a method, and an anonymous class**: 43 and 953 in guava.
  What they name is attributed to the type that declares the method.
- **A class the compiler makes.** Java 25's compact source files declare no
  class; the compiler names one after the file, and no line of the source names
  it, so there is no node and the file speaks for itself. junit5 has two.
- **Which module a class is in.** `module-info.java` contributes nothing; the
  unit is the package.

Two things are drawn that a reader may not expect. A mirrored source root is
drawn twice — guava's `android/` tree declares the same classes as its main one,
and both are in the document, each in its own file. And a package that two
source roots declare is two nodes, one per root, because the two roots are two
compilations.

## The list

### Supported

**TypeScript / JavaScript**, **Java**, **Go**, **Rust**, beside Python. Java and
Rust keep Go's decision about a unit above the file, and Java forces one of its
own: a type inside a type.

Chosen because between them they force every decision above, one language
each:

| | what it makes you decide |
| --- | --- |
| TypeScript | open `kind` (`interface`, `type`, `enum`) and `implements` against `extends` |
| Java | nested classes, package as a directory, and a drawing with no top-level functions in it |
| Go | the package as a unit, and what `inherits` means where there is no inheritance |
| Rust | `mod` is not a file, `impl Trait for T` as an inheritance edge, and what to do about tests written inside the source and types declared by macros |

TypeScript is also the largest population and the one language where a
hand-written analyzer is not a compromise — the TypeScript compiler API
resolves names in-process. Java is the best fit for the drawing itself: every
symbol is a class, inheritance is explicit, one file holds one public class, so
`function` and `file` barely appear and what is left is a pure class tree.

**What Rust actually forces, measured.** Read as text over the Rust on the
development machine: the standard library's own source, four crates
from the cargo cache, and one small local crate. Counted over what an analyzer
would walk — `target/`, `tests/` and `benches/` skipped — because that is the
code a drawing would contain. Every figure is a lower bound: a multi-line
`impl` header and anything a macro generates are invisible to this method.

```
corpus               .rs   impl…for   blanket   cross-file impl   #[cfg(test)]   test lines
std                1,609      4,652    84  2%               11%            328          11%
syn 3.0.3             55      1,508     8  1%                3%              1           0%
tokio-util            58        172     5  3%                0%              4           1%
regex-syntax          33         70     0  0%                0%             11          15%
clap 4.6.4            85         18     0  0%                0%              0           0%
sqlparser-ranger      14         56     0  0%               88%             15          41%
```

- **Blanket impls do not explode the edge count.** They are 2% of the standard library's impls
  and none at all in three of the six. That is not the shape of the risk that
  ruled out interface satisfaction for Go, where `error` is satisfied by
  hundreds of types and `any` by all of them — that was a question of orders of
  magnitude, and this is not one.
- **The tests are inside the source files.** Python, TypeScript and Go each
  exclude tests by file name. Rust writes `#[cfg(test)] mod tests { … }` beside
  the code it tests, so no file-name rule reaches them: 11% of the standard
  library's lines, 15% of regex-syntax's, and 41% of one small crate's. No other
  analyzer here needs this rule.
- **Macros declare types.** syn's own `Block` and `Local` are written inside
  `ast_struct! { … }`, and that crate has 196 such invocations. A parser that
  does not expand macros cannot see them, and the crate everyone parses Rust
  with is the worst case for it. Note that syn is not also an example of the
  point above — it has one `#[cfg(test)]` attribute and no test module. The two
  findings come from different projects.
- **An impl need not sit with its type.** 11% of the standard library's are
  written in another file and 88% of the local crate's. Go's rule that a method
  belongs to its receiver wherever it is written is required here, not optional.

What text scanning cannot settle is the ratio of free functions to types,
which decides whether a Rust drawing is function-heavy like Python's or a type
tree like Java's. Text scanning gives 0.2:1 for the local crate and 8.5:1 for
the standard library, and neither is trustworthy: the standard library is
inflated by SIMD intrinsics and `compiler-builtins`, while macro-declared types
are invisible to the same pass — syn counts 344 types by one method and 66 by
the other. It needs a real parse.

Those counts are a text scan, not the analyzer's. The analyzer's own, and each
place they part from the scan, are under *Rust, settled*.

### Second wave

**C#**, **Kotlin**, **Swift**, **PHP** — through the language servers, once
that mechanism exists, at which point each is close to free.

C# is the interesting exclusion from the supported list. Its vocabulary is
Java's, so it teaches almost nothing the supported four do not, and the two
things it does teach are narrow:

```csharp
// One symbol, several files. Nothing else on the list does this, and
// node.file / node.line both assume a symbol has one location.
public partial class User { public string Name; }
public partial class User { public void Save() { } }

// The base list is syntactically ambiguous. Java separates the two keywords;
// here, telling implements from extends needs type resolution.
class A : B, C
```

Both are real and neither is decisive. Against them: a hand-written C# analyzer
wants the .NET SDK on PATH, which is a far heavier dependency than `python3`,
while nearly every C# developer already has a language server installed — so
the mechanism that makes C# cheap is exactly the one this list defers.

If the readers turn out to be Unity or enterprise .NET, that is a reason to
move C# up. It is a question about who is using this, not about the language.

### Not planned

**Ruby** — fits the vocabulary, and is more dynamic than Python:
`define_method`, `method_missing`, monkey-patching. Name resolution is where
this project spends most of its effort, and Ruby would cost more of it
for fewer readers.

**C** — no classes, so the layout has nothing to root on.

**C++** — see below.

## How a language gets in

Three ways, and the choice matters more than the order above.

**One analyzer per language.** What every supported language has. Full control, and the
resolution quality is whatever you build. Expensive per language.

**tree-sitter for everything.** Looks cheapest and is the trap. This project's
largest and most-measured investment is *name resolution*, not parsing: reading
a name its own file binds as a reference gives Django 8,191 edges and CPython
11,515, and with those names and identifier-shaped strings left out they have
6,784 and 9,164. None of that is a syntax question. tree-sitter gives syntax and no
import semantics, so every new language would restart that debt from a worse
starting point than Python did.

**The editor's language servers.** `executeWorkspaceSymbolProvider` and
`executeReferenceProvider` hand the resolution to pyright, tsserver,
rust-analyzer, gopls, jdtls — a decade of somebody else's work on exactly the
problem that was hard here, in every language the reader already has installed.
The costs are real: a reference query per symbol against thousands of symbols,
a workspace that must be open and indexed, results that vary with what the
reader has installed, and no headless run, which is the CLI gone.

**The approach**: each supported language has an analyzer of its own, and the
artifact contract is checked against every one of them. Breadth beyond them goes
through the language servers.
