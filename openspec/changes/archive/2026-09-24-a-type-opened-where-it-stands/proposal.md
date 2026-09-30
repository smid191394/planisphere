## Why

A type whose methods call one another opens as a drawing of its own, and that
drawing is somewhere else: the canvas is given over to the members, and the
project they sit in — the types they take arguments from, the types they return,
the module that holds them — is off screen while the reader reads them. What a
reader asks next about `Parser::expr` is what it touches outside `Parser`, and
that question can only be answered by leaving.

The document cannot answer it either. A member records the members of its own
type that it calls, and nothing else; what its body names outside the type is
attributed to the type as a whole. `Parser::expr` calling `Scanner::next` is a
`Parser` to `Scanner` edge, and which of the 69 methods it came from is not in
the file.

## What Changes

- **A type opens where it stands.** Its members appear in the drawing, in the
  place the type occupies, with everything else still around them. The type
  itself stays: what points *at* it points at the type, not at one of its
  members.
- **A member's line reaches the rest of the drawing.** A member drawn this way
  is joined to the members it calls and to the nodes it points at, so the
  reader sees which method the type's edge came from.
- **BREAKING: the artifact carries what a member points at outside its type.**
  A member's record gains the nodes its body names, each one an edge its own
  node already has. The type keeps its edges: this says which member they came
  from, it does not move them.
- **Rust, Go and Java record it.** The three analyzers that record members
  resolve these targets already, to build the type's edges. TypeScript and
  Python record no members and are unchanged.
- **The view of one type alone stays.** It is what a type of 154 members wants;
  opening in place is what the ordinary type wants. Measured over the corpus,
  the median type whose members call one another has 7 to 13 of them, and the
  90th has 21 to 44.

## Capabilities

### Modified Capabilities

- `structure-graph-artifact`: what a member records about what it points at
  outside its own node, and how that relates to the node's own edges.
- `structure-graph-viewer`: a type opened in place — what is drawn, where, what
  the lines are, and how the reader closes it again.
- `rust-symbol-graph`, `go-symbol-graph`, `java-symbol-graph`: each analyzer's
  rule for which of a member's body's names are recorded against the member.

## Impact

- The artifact document, every Rust, Go and Java fixture, and the contract check
  that reads all 25 of them.
- Artifact size: the same targets the type's edges are built from, written once
  per member that names them. jackson-databind records 9,340 members against 864
  nodes and 6,159 edges.
- The viewer's layout, which seats one node per ring position: an opened type
  needs room for its members where one node stood, and the nodes around it have
  to make that room without the drawing jumping.
- The three analyzers, which resolve a member's targets and currently keep only
  the ones inside the type.
