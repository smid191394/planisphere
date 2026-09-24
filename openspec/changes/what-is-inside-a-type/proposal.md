## Why

A method is recorded as a member of the type it is written against, and members
are listed beside the drawing rather than drawn. For a type with a handful of
methods that is right: the drawing stays about the shapes a reader is looking
for, and the list is one click away.

For a project whose structure *is* its methods, it hides the thing the reader
came for. sqlparser-ranger's parser follows SQLite's railroad diagrams: one
function per rule, named after the rule, calling the functions of the rules it
contains. That is the architecture, and the drawing shows none of it —
`Parser` is one node carrying a list of 69 names, and `Scanner` one node
carrying 13. Of the drawing's 109 nodes, 17 are functions, and every one of
those is a free function outside an `impl`.

Nor is the shape recoverable from the artifact. A member carries a name, a file
and a line, and nothing else; what one member calls is attributed to the type
the member belongs to, so a call from `expr` to `expr_tail` becomes a `Parser`
to `Parser` edge, which is dropped as a self-loop. The artifact records 0 of
them.

## What Changes

- **A member may be drawn, not only listed.** What that looks like — every
  member as a node, a fan around the type it belongs to, or a view of one
  type at a time — is the design's question, not settled here.
- **BREAKING: the artifact carries what a member points to.** Without it there
  is nothing to draw: the relationships between members are not in the document
  at all today, and no viewer can invent them.
- **The analyzers that record members record those relationships**: Rust, Go
  and Java do record members; TypeScript and Python record none, and what they
  should do is part of the design.

## Capabilities

### Modified Capabilities

- `structure-graph-artifact`: what a member records, and where a member's own
  references are attributed.
- `structure-graph-viewer`: what the drawing does with members.
- `rust-symbol-graph`, `go-symbol-graph`, `java-symbol-graph`: each analyzer's
  rule for attributing what a member's body names.

## Impact

- The artifact document, which every fixture is regenerated against, and the
  contract check that reads them.
- Three analyzers at least; five if TypeScript and Python are to record members.
- The viewer's layout, which is built for nodes on rings and knows nothing of
  members as things with positions.
- Drawing size: jackson-databind carries 9,340 members against 864 nodes. What
  is drawn cannot simply become "all of them".
