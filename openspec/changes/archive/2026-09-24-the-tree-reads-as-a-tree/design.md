## Context

See proposal.md for why. An open type's members are placed by one pass: a tree
rooted on the type, levels outward, each node a slice of its parent's slice in
proportion to the leaves below it.

## Decisions

### The joins stay in the drawing, and most are not drawn

The layout reads a type's `contains` line to each member to know which members
are whose. Those lines stay in the drawing's graph and are marked quiet beyond
the first level of the tree; the renderer does not draw a quiet line. The first
level keeps its lines, so a reader can see what hangs off the type directly.

Alternative: remove the joins and tell the layout by other means — a second
source of truth for one fact.

### A member holding most of the tree sits beside the type

Where one child of the type holds more than half of the tree's leaves, it is
taken out of the levels: its children become the type's, and it is placed
touching the type, in the direction the type faces. Half, because that is the
point past which the middle of a slice is further from half of what it holds
than the centre is.

Alternative: root the tree on the way in and draw the type beside it — the
tree's centre would no longer be the type the reader opened, and opening in
place would move the type off its own position.

### How far apart the levels are

`MEMBER_STEP` is 150px: at 64px, six levels of a 69-member tree read as one
thick ring. Each level is also never nearer than the radius at which its own
narrowest slice holds one member; asked once for the whole tree, that bound put
every level at the radius the outermost one needs.

## Risks / Trade-offs

- [A 150px step makes a deep tree large] → sqlparser-ranger's `Parser` reaches
  805px, and the room made for it moves the drawing that far. Its six levels are
  what the reader opened it to see.
- [The member beside the type hides behind its label] → It touches the type, and
  both are labelled; at the zoom a tree is read at, both labels are clear.
