## MODIFIED Requirements

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

Every such edge SHALL also be recorded against the member for that method, by
the node it reaches. The type keeps the edge; the member says which method it
came from. A name reaching the receiver's own type is recorded by neither,
there being no edge from a node to itself.

A name that resolves to a method or to a struct field SHALL be treated as naming
the type that declares it. Calling `s.Close()` is a use of the type `Close` is
declared on. Where a method or field is promoted through embedding, the type
named SHALL be the one that declares it.

A member SHALL record the members of the same type it calls, recognised by what the source writes: a call on the receiver the method declares. The receiver's name is whatever the method gave it — `c`, `cmd`, `f` — and it is written at the top of the method, so no type is inferred. A call on anything else is the type's, as the rest of a method body is.

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

#### Scenario: A method calling another on its receiver
- **WHEN** a method declares receiver `c` and its body writes `c.Other(…)`, where `Other` is a method of the same type
- **THEN** the member records `Other`

#### Scenario: A receiver that is not named
- **WHEN** a method declares its receiver without a name
- **THEN** it records no calls, since nothing in the body can name it

#### Scenario: A call on another value of the same type
- **WHEN** a method's body calls a method on a parameter of its own type rather than on the receiver
- **THEN** the member records nothing for it

#### Scenario: A method that names another type
- **WHEN** a method's body calls `NewRouter`, which is a node
- **THEN** the edge runs from the receiver's type, and the member for that method records that node

#### Scenario: A type named in a method's signature
- **WHEN** a method takes an argument of a type that is a node
- **THEN** the member records that node

#### Scenario: A method of a type that is not a node
- **WHEN** a method's receiver type is not a node in the graph
- **THEN** no member and nothing it points at are recorded
