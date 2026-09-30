## Context

See proposal.md for why. Three things about the layout shape the approach.

**A function is a satellite only because there are types in the drawing.**
`isTreeVertex` makes a type a vertex of the tree always, and anything else a
vertex only where the drawing has no types at all. That is the whole difference
between the two views of a type's members: given a canvas of their own the
members are all there is, so they are vertices and the tree layout arranges
them; dropped into the project's drawing they are functions among types, so
they are satellites, and satellites of one owner sit on one ring.

**The ring is capped by what is around it.** A ring stops short of the nearest
other type, so that "which type is this lot attached to" stays readable. An
open type's ring is exempt — nothing else is joined to those members — which is
why it grows instead: 704px for cobra's `Command`.

**The layout is polar.** Every node is placed at a radius and an angle from its
component's origin, which is what makes it possible to move a node outward
without asking what it is joined to.

## Goals / Non-Goals

**Goals:**

- The reader sees, in one drawing, what a type is made of and where that type
  sits in the project.
- What is around the opened type stays recognisable: the same nodes in the same
  directions, further out.
- Closing gives back the drawing that was there.

**Non-Goals:**

- Making a 154-member type readable in place. Room for its tree is room the
  rest of the drawing has to give up, and at that size there is not enough
  drawing to give. The view of one type alone is what that type wants.
- A new layout. Both halves of this are the layout the drawing already has,
  applied to a smaller set and then to the result.

## Decisions

### The members are a tree, rooted on the type

The tree the view of one type alone draws, with the type itself as the root:
the way in hangs off the type, what it calls hangs off it, and a member no
chain reaches hangs off the type beside the way in. The criterion for the way
in is the one that view already uses — a member that no member calls, the
drawing's own centre criterion choosing among several, and over all of them
where there is none.

Rooting it on the type, rather than on the way in with the type beside it,
keeps one thing true: the type is where it always was, and everything the
member tree holds is inside the space that belongs to it.

The levels are laid out by the rule the class tree uses — a level at a time,
each node owning a slice of its parent's slice in proportion to the leaves
below it — at a step sized for members (`MEMBER_STEP`, 64px) rather than for
types. One thing differs, and it is what makes the tree readable where the
class tree accepts crowding: a level is never nearer the type than `L · step /
2π`, where `L` is the leaves of the whole tree. Every slice is a share of those
leaves, so the narrowest slice anywhere is one leaf's, and at that radius one
leaf's slice holds one member. Sized per parent instead, a parent with eight
members in a twentieth of the circle asks for a radius of four thousand pixels.

The view of one type alone draws this same tree, with the type at its centre.
It is one shape in two places — alone, and with the project around it — and a
reader learns it once.

Alternatives: a fan in the direction the type faces — narrower, and a tree four
levels deep in a 120° sector overlaps itself; the class tree's own component
layout with a smaller step — it chooses parents and orders siblings by rules
written for types, and a force layout is a second arrangement with none of the
guarantees the layout suite is written against.

### The project's tree is the one it was

The project around an open type is laid out from the drawing without the
members: their nodes and their lines are left out of what the class tree is
built from. And a type's own edges stay in the drawing while it is open, marked
as accounted for by a member, so that the layout still sees `Parser → Scanner`
while the line is drawn from the method that names `Scanner`. Without either,
opening a type would rebuild the tree around it — its neighbours would change rings and
the whole drawing would shift by the width they take.

### The rest of the drawing moves outward

One pass over the placed positions, per open type, in the order they were
opened. Each node is moved along the ray from that type, from `d` to
`d + R · max(0, 1 − d / (SPREAD · R))`, where `R` is the radius the type's
member tree needs and `SPREAD` is 3.

What that buys:

- **The bubble is cleared.** A node that sat on the type lands at `R`.
- **Nothing reorders.** The move is increasing in `d` for `SPREAD > 1`, so two
  nodes on one ray keep their order, and angles are untouched, so two nodes on
  different rays keep theirs. Radial gaps shrink by at most `1/SPREAD`.
- **The drawing past `SPREAD · R` does not move at all.** A reader who knows
  where a package sits still finds it there.

Alternatives: moving everything out by `R` — every gap kept exactly, but the
whole drawing inflates for a change in one corner of it; a hard shell, pushing
only what falls inside `R` out to `R` — that piles a ring of displaced nodes
against the bubble's edge, which reads as a wall.

The opened type's own members are not moved by its own bubble; they are what
the bubble is for.

## Risks / Trade-offs

- [Distance stops meaning what it meant, near an open type] → It never meant a
  measured distance, and the drawing says so; what it does mean — which nodes
  are near this one — survives, because the direction of every node is kept.
- [Two open types close together fight over the same space] → Each bubble is
  applied in turn, so the second is applied to a drawing the first has already
  spread. The order is the order the reader opened them, which is the order
  they will expect.
- [A very large type's bubble swallows the drawing] → It does, and that is what
  the numbers say it must: 154 members need a tree four levels deep. The other
  view is the answer, and the offer to open in place is still made — a reader
  who opens it can close it.
- [The layout runs twice as often] → The member tree is laid out over a handful
  of nodes and the bubble is one pass over the positions. Both are linear in
  what is drawn.

## Open Questions

None.
