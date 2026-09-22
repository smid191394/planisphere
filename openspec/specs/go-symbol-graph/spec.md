# go-symbol-graph Specification

## Purpose

Defines how Planisphere's Go analyzer reads Go. It covers:

- which files and modules the analyzer walks;
- which declarations become nodes;
- what a method and package-level code belong to;
- how the type checker resolves a name;
- what `inherits` means in a language without inheritance;
- how a package is placed, named and connected.

What the resulting document must look like belongs to
`structure-graph-artifact` and binds every analyzer.

## Requirements

### Requirement: Go sources in one module, tests and other modules excluded
The analyzer SHALL walk `.go` files under the given root(s). It MUST NOT walk
files named `*_test.go`.

Beyond the directories every analyzer skips, it SHALL skip:

- `vendor`;
- `testdata`;
- every directory whose name begins with `.` or `_`, which the Go toolchain
  itself ignores.

A directory below a root that holds its own `go.mod` is another module. It
SHALL NOT be walked, and neither SHALL anything beneath it. Measured, hugo holds
two such modules and prometheus three. Their packages import the root module by
its published path rather than as part of it.

A file whose build constraint no platform satisfies, such as `//go:build
ignore`, SHALL NOT be walked. It is a generator or an example kept beside the
package, not compiled into it. A file constrained to particular platforms SHALL
be walked: the drawing is of the source, and which machine ran the analyzer
must not change the document. prometheus constrains 68 of its 441 files.

A file whose `package` clause names a different package from the other files in
its directory SHALL NOT be walked.

Whatever decides that a root holds Go SHALL agree with what the analyzer walks.

#### Scenario: A test file is not walked
- **WHEN** a package keeps `server_test.go` beside `server.go`
- **THEN** nothing declared in the test file becomes a node or contributes an edge

#### Scenario: Vendored and test-data code is not walked
- **WHEN** a module keeps dependencies under `vendor/` and inputs under `testdata/`
- **THEN** nothing under either directory becomes a node

#### Scenario: A nested module is another module
- **WHEN** a directory below the root holds its own `go.mod`
- **THEN** nothing in that directory or beneath it becomes a node

#### Scenario: An ignored file is not walked
- **WHEN** a file begins with `//go:build ignore`
- **THEN** nothing declared in it becomes a node

#### Scenario: A platform-specific file is walked
- **WHEN** a file is named `poll_windows.go` or is constrained to `linux`
- **THEN** its declarations become nodes, whatever platform the analyzer runs on

#### Scenario: Only test files is not Go source
- **WHEN** a root holds `.go` files that are all named `*_test.go`, and no language is named
- **THEN** the CLI does not report Go as present

### Requirement: Type declarations and top-level functions become nodes
The analyzer SHALL create a node for each type declared at the top level of a
file. The node's `kind` SHALL be:

- `struct` for a struct type;
- `interface` for an interface type;
- `type` for any other declared or alias type.

It SHALL also create a `function` node for each top-level function that is not
a method.

Each declaration in a `type ( … )` group SHALL become a node of its own, as if
declared alone.

`init` functions and functions named `_` SHALL NOT become nodes, for two
reasons. No other code can name either. And a file may declare either one more
than once: hugo declares `init` twice in one file, and the standard library
declares `_` five times. As nodes, they would collide on identity with nothing
to tell them apart.

Package-level variables and constants SHALL NOT become nodes.

Go marks what is not for reaching in two ways, and the analyzer SHALL read both. One is the name; the other is the location.

A type node or a function node whose name begins with anything but an upper-case letter SHALL be recorded as internal. That is what Go's own compiler reads to decide what leaves a package: 40% of hugo's types and 45% of prometheus's carry that mark, and none of them carries an underscore.

A node declared under an `internal/` directory SHALL be recorded as internal whatever its name looks like — that is, where one segment of its path is exactly `internal`. This is the harder of the two marks, because the compiler enforces it: it refuses an import of such a package from anything outside the subtree rooted at the directory holding `internal`. A name says nothing about it. hugo declares 463 nodes in that position, of which 188 are types and functions whose exported-looking names leave them marked as nothing at all.

A directory whose name merely begins with `internal` SHALL NOT count. The rule is Go's, and Go reads a whole path segment.

A package node and a file node SHALL NOT be recorded as internal **by the name test**, whatever their names look like. A Go package name is always lower case and an import path is how a package is reached; a file node's name is a file name. Neither name is a visibility mark, and read literally the case rule would mark every package and every file in every Go drawing, which would take the whole package tree out of the running for a centre.

The location test SHALL apply to them. Where a package sits is precisely what decides whether it can be imported from outside, so a package under `internal/` is the clearest case the flag has rather than an exception to it.

#### Scenario: The three type kinds
- **WHEN** a file declares a struct, an interface and `type Celsius float64`
- **THEN** the graph contains three nodes whose kinds are `struct`, `interface` and `type`

#### Scenario: A grouped declaration is several nodes
- **WHEN** a file declares two types inside one `type ( … )` block
- **THEN** the graph contains a node for each

#### Scenario: A function is a node
- **WHEN** a file declares `func Parse(s string) error`
- **THEN** the graph contains a `function` node named `Parse`

#### Scenario: init is not a node, however many there are
- **WHEN** a file declares `func init()` twice
- **THEN** no node is created for either, and no two nodes share an identity

#### Scenario: A constant is not a node
- **WHEN** a file declares `const Limit = 10`
- **THEN** no node is created for it

#### Scenario: An unexported type is internal
- **WHEN** a file declares `type scrapeLoop struct{}`
- **THEN** its node is recorded as internal

#### Scenario: An exported type is not
- **WHEN** a file declares `type Head struct{}`
- **THEN** its node is not recorded as internal

#### Scenario: An exported name under an internal directory is internal
- **WHEN** a file at `internal/store/store.go` declares `type Store struct{}`
- **THEN** its node is recorded as internal, its capital letter notwithstanding

#### Scenario: A package under an internal directory is internal
- **WHEN** a package is declared under `internal/`
- **THEN** its package node is recorded as internal, the location test applying where the name test does not

#### Scenario: A package outside one is not internal by its name
- **WHEN** a package node and a file node are created outside any `internal/` directory, their names being lower case as Go names them
- **THEN** neither is recorded as internal

#### Scenario: A directory that merely starts with the word
- **WHEN** a file sits under a directory named `internals`
- **THEN** nothing in it is recorded as internal on that account

### Requirement: A method belongs to its receiver's type
A method SHALL NOT become a node, even though Go declares it at the top level of
a file. It SHALL be recorded as a member of its receiver's type, with its
name, its file and the line its name is declared on, in the order the source
declares it. That is 725 types in hugo and 818 in prometheus, and members make
up 2% of the artifact. A method is what a Go reader searches for, and nothing
else in the document names one.

A method is its receiver type's, the way a method written inside a class is the
class's, and the artifact draws top-level symbols rather than their members.
Taken as nodes, methods would produce 2,376 colliding identities across 393
files of the standard library, among them `PipeReader.Close` and
`PipeWriter.Close`.

Every edge arising from a method's signature or body SHALL be attributed to the
node of its receiver's type, whichever file the method is declared in. A method
whose receiver type is not a node in the graph SHALL contribute no edges.

A name that resolves to a method or to a struct field SHALL be treated as naming
the type that declares it. Calling `s.Close()` is a use of the type `Close` is
declared on. Where a method or field is promoted through embedding, the type
named SHALL be the one that declares it.

#### Scenario: A method is not a node
- **WHEN** a file declares `func (s *Server) Start()`
- **THEN** no node is created for `Start`

#### Scenario: A method in another file speaks for its type
- **WHEN** `server.go` declares `type Server struct{}` and `server_http.go` declares a method on it whose body calls `NewRouter`
- **THEN** the edge to `NewRouter` runs from the node for `Server`

#### Scenario: Two methods of one name are no collision
- **WHEN** one file declares `Close` on `PipeReader` and `Close` on `PipeWriter`
- **THEN** neither becomes a node, and no two nodes in the graph share an identity

#### Scenario: Calling a method uses the type that declares it
- **WHEN** a function calls `srv.Start()`, and `Start` is declared on `Server`
- **THEN** the function carries a `uses` edge to `Server`

#### Scenario: A promoted method names the type it came from
- **WHEN** `Server` embeds `Logger`, and a function calls `srv.Log()`, which `Logger` declares
- **THEN** the function carries a `uses` edge to `Logger`

#### Scenario: A method is a member of its receiver
- **WHEN** a file declares `func (s *Server) Start()`
- **THEN** the node for `Server` records a member named `Start`, at that file and line

#### Scenario: A method declared in another file is still its receiver's member
- **WHEN** `server.go` declares `type Server struct{}` and `server_http.go` declares a method on it
- **THEN** the member records `server_http.go` and the line of the method's name

#### Scenario: Neither init nor a blank function is a member
- **WHEN** a package declares `func init()` and `func _()`
- **THEN** neither is recorded as a member of anything

### Requirement: Package-level code belongs to the package
What package-level code names SHALL be attributed to the node of the package
that declares it. Package-level code is:

- `init` functions;
- functions named `_`;
- the initialisers of package-level variables and constants.

That code runs and names things, and no symbol owns it. Attributing it to
nothing would drop from the drawing a registry built in a `var` block.

#### Scenario: An init speaks for its package
- **WHEN** a package's `init` calls `Register`, declared in another package of the module
- **THEN** the package's node carries an edge to `Register`

#### Scenario: A variable's initialiser speaks for its package
- **WHEN** a package declares `var defaultServer = &Server{}`
- **THEN** the package's node relates to `Server`

### Requirement: A package is a node that contains what is declared in it
The analyzer SHALL create one node of kind `package` for each directory of
walked files.

Its `name` SHALL be the name that the files' `package` clause gives. A
package's name is not unique to it: 44 of hugo's directories share their
package name with another, with `main` and `internal` four times each. They are
told apart by file, as any two nodes are.

Its `file` and `line` SHALL be the `package` clause of one of its files. That
file SHALL be the first in name order whose clause carries a documentation
comment. Where no clause carries one, it SHALL be the first file in name order.

The package node SHALL carry a `contains` edge to every node declared in its
files: types, functions and file nodes.

Where any node in one package has an edge to a node in another package, the
first package's node SHALL carry an edge to the second's. Its kind SHALL be:

- `uses` when any of those edges is `inherits` or `uses`;
- `references` when every one of them is `references`.

A package's dependencies are therefore the ones its code actually names. An
`inherits` edge between packages would say one package is a kind of another,
which nothing in Go means. A blank import names nothing, so it draws no edge.

#### Scenario: One node per package
- **WHEN** a directory holds three walked files of `package server`
- **THEN** the graph contains one `package` node named `server`

#### Scenario: The package is placed at its documented clause
- **WHEN** a package's files are `a.go`, `doc.go` and `z.go`, and only `doc.go` carries a comment directly above its `package` clause
- **THEN** the package node's `file` is `doc.go` and its `line` is that clause's

#### Scenario: Undocumented, the package is placed at its first file
- **WHEN** no file of a package carries a comment above its `package` clause
- **THEN** the package node is placed at the `package` clause of the first file in name order

#### Scenario: A package contains its declarations
- **WHEN** a package declares a struct, a function, and a file holding only constants
- **THEN** the package node carries a `contains` edge to each of the three nodes

#### Scenario: A package depends on what its code names
- **WHEN** a function in package `a` calls a function in package `b`
- **THEN** the node for `a` carries a `uses` edge to the node for `b`

#### Scenario: A dependency named only in types is a reference
- **WHEN** every edge from package `a`'s nodes to package `b`'s nodes is `references`
- **THEN** the edge between the two packages is `references`

#### Scenario: Two packages called main are two nodes
- **WHEN** `cmd/server` and `cmd/client` both declare `package main`
- **THEN** the graph contains two `package` nodes named `main`, with different identities

### Requirement: Names are resolved by the type checker, within the module
The analyzer SHALL resolve a name using the Go type checker, with the packages
of the walked module type-checked from their source. It MUST NOT resolve a name
by matching it against the symbols the project defines.

An import from outside the walked module SHALL resolve to nothing, and every
name reached through it SHALL produce no edge.

The analyzer SHALL NOT require a project's dependencies to be downloaded or
built. hugo requires 180 modules and prometheus 251, and every edge to one of
them is an edge the artifact contract forbids.

Where two walked files of one package declare the same name, as two platforms'
versions of one function do, the edge SHALL resolve to the declaration in the
first of those files in name order. The same source then produces the same
document.

A type error in the source SHALL NOT stop the analysis. Names that still resolve
SHALL still produce edges.

#### Scenario: An import is followed to another package of the module
- **WHEN** package `a` imports package `b` of the same module and calls `b.New`
- **THEN** the edge points at the node for `New` in `b`

#### Scenario: A dependency's symbol is not linked
- **WHEN** a file imports a package from another module and calls a function in it
- **THEN** no edge is created for that call

#### Scenario: Nothing is downloaded
- **WHEN** the module's dependencies are absent from the module cache and the network is unavailable
- **THEN** the analyzer still writes the artifact, with every edge between the module's own packages

#### Scenario: Two platforms' declarations resolve the same way twice
- **WHEN** `open_unix.go` and `open_windows.go` both declare `func open()`, and a third file calls it
- **THEN** the edge points at the declaration in `open_unix.go` on every run

#### Scenario: A type error does not stop the analysis
- **WHEN** one file of a package fails to type-check
- **THEN** the artifact is written, and names elsewhere in that package that resolve still produce edges

### Requirement: Embedding is inherits, a type position is a reference, anything else is a use
The analyzer SHALL emit edges by where a name appears:

- `inherits` for a type embedded in a struct or an interface that is itself a
  declared type;
- `references` where a name appears only in a type position: a field's type, a
  parameter or result type, a variable's declared type, a type argument, or a
  constraint;
- `uses` everywhere a value is expected, including a composite literal of a type
  and a conversion to one.

Interface satisfaction SHALL NOT be drawn. Go never states it. Computing it would
make a claim that no line of source makes, and the claim would say that hundreds
of types are an `error` and that every type is an `any`.

An embedding anywhere else SHALL be read by its position, like any other name.
That covers an anonymous struct built in a function, a struct type nested in a
field, and a type declared inside a function. None of these is a family a
reader navigates by, and taking them as `inherits` would draw functions that
inherit: hugo's `XxHasher` and `newPageOutput`, and prometheus's `instantValue`.

Embedding is composition, not inheritance: the embedding type gains the embedded
type's methods and is not a kind of it. It is drawn as `inherits` because it is
the one relationship between Go types that is declared as a relationship between
types, and the drawing arranges families by it. cobra embeds nothing; hugo
embeds 428 times.

#### Scenario: A struct embedding is inherits
- **WHEN** `type Server struct { *Logger }`
- **THEN** a single `inherits` edge runs from `Server` to `Logger`

#### Scenario: An interface embedding is inherits
- **WHEN** `type ReadWriter interface { Reader; Writer }`
- **THEN** `ReadWriter` carries an `inherits` edge to each

#### Scenario: An embedding outside a declaration is not inherits
- **WHEN** a function returns `struct{ Hasher }{}`, and a declared struct has a field of type `struct{ Hasher }`
- **THEN** the function carries a `uses` edge to `Hasher`, the struct a `references` edge, and neither edge is `inherits`

#### Scenario: A field's type is a reference
- **WHEN** a struct declares a field `cfg Config`
- **THEN** the struct carries a `references` edge to `Config`

#### Scenario: Building a value is a use
- **WHEN** a function writes `Config{Port: 80}`
- **THEN** the function carries a `uses` edge to `Config`

#### Scenario: Satisfying an interface draws nothing
- **WHEN** a struct has every method an interface declares and nothing in the source names the interface beside it
- **THEN** no edge joins the two

#### Scenario: The stronger kind wins
- **WHEN** a struct both embeds a type and declares a field of that type
- **THEN** the pair carries one `inherits` edge

### Requirement: What this analyzer excludes from becoming a file node
A file SHALL be represented by the package node placed in it, and by the type of
every method it declares. Neither kind of file is symbol-less, and neither SHALL
get a file node.

The analyzer's named set of excluded files is empty. Go has no convention for a
file that is package structure rather than content.

The second exclusion does apply: a file whose every declaration is an import
SHALL NOT become a node. Go has no re-export, but it has the blank import. A file
holding only `import _ "…/discovery/aws"` registers a plugin and declares nothing
of its own. prometheus's `plugins` directory holds 26 such files, none of which
is content. As file nodes they would form a ring joined only to a package placed
elsewhere. A file with no declaration at all, not even an import, is still
a file node, as it is for TypeScript.

A file whose only declarations are constants, variables or `init` SHALL become a
file node. It is content, however little.

#### Scenario: A constants file is kept
- **WHEN** a file declares only `const Limit = 10` and is not where its package node is placed
- **THEN** the graph contains one `file` node for it

#### Scenario: A file of blank imports is not a node
- **WHEN** a file holds only `import _ "example.com/m/aws"` and is not where its package node is placed
- **THEN** no node is created for it

#### Scenario: A file of methods is its type's
- **WHEN** a file declares only methods on a type declared in another file
- **THEN** no `file` node is created for it

#### Scenario: A file holding the package's documentation is the package's
- **WHEN** `doc.go` holds only a comment and the `package` clause, and the package node is placed there
- **THEN** no `file` node is created for it
