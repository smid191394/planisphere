## Why

An open type's members are placed as the tree their calls make, but the drawing
does not read as one. Two things hide it.

Every member is drawn joined to its type. The layout needs each of those joins
to know whose member a node is; drawn, they are sixty-nine lines out of
`Parser`, and the tree — the way in beside the type, each rule beyond the rule
that calls it — is under them. A reader sees a star, not layers.

And one member can hold nearly the whole tree. `sql_stmt_list` reaches 63 of
`Parser`'s 69 members, so its slice is nearly the whole circle, and a tree drawn
round a centre puts it in the middle of that slice — at one edge of the drawing,
with its thirty children spread round the whole of the next level and every line
out of it crossing the drawing.

## What Changes

- **The type is joined to the first level of its tree only.** A member further
  out is joined to what calls it, which is what places it.
- **A member that holds more than half of the tree is drawn beside the type.**
  What it calls is the first level around both: the way in at the middle, the
  rules round it.
- **The levels are further apart**, and each level is only as far out as its own
  narrowest slice needs, so the levels near the type stay near it.

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: which lines an open type's tree is drawn with, and
  where a member holding most of the tree is placed.

## Impact

- The viewer's layout of an open type's members, and which of its lines are
  drawn. The layout suite proves both.
