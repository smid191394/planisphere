## Why

A type opened where it stands gets one ring of members, seated in the space
that happened to be left over. Two things follow, and both are wrong for the
reader who opened it.

The ring is the only shape it can take, so the structure among the members is
invisible: sqlparser-ranger's `Parser` follows SQLite's railroad diagrams, and
opened in place its 69 rules come out as a circle in id order with the calls
between them drawn as chords across it. The same members, given a canvas of
their own, come out as the grammar — `sql_stmt_list` at the middle, the
statements under it, the clauses under those.

The ring has to find room among nodes that are already seated, and the room is
not there, so it is pushed outward until it fits: cobra's `Command` seats its
154 methods 700px out, and the type is left alone in the middle of its own
lines.

## What Changes

- **An open type's members are drawn as a tree, rooted on the type.** The way
  in — the member nothing else in the type calls — hangs off the type, what it
  calls hangs off it, and so on outward. It is the arrangement the view of one
  type alone already uses, brought to where the type stands.
- **The rest of the drawing makes room.** Opening a type pushes what is around
  it outward, most where it is nearest and not at all past a few times the
  opened type's own size. Every node keeps its direction from the opened type,
  so the drawing a reader knows is still the drawing they are looking at.
- **Closing a type gives the space back**, exactly as it was.

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: how an open type's members are arranged, and what
  happens to everything around them.

## Impact

- The viewer's layout: where an open type's members are placed, and a pass over
  the placed positions that makes room for them.
- The layout suite, which is where a change to the drawing's arrangement is
  proved.
- Nothing in the artifact, the analyzers or the extension host.
