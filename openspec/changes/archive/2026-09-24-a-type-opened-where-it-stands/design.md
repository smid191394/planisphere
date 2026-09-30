## Context

See proposal.md for why. Two things shape the approach.

**The drawing already knows how to hang small things off a big one.** A file's
functions are satellites: `satelliteOrbit` sizes a radius from how many there
are, `freeSeat` seats each one where there is room, and the occupancy grid keeps
them off the rings. An opened type's members are that, with a different source.

**The types worth opening are small.** Over the corpus, counting only types
whose members call one another:

| | types worth opening | members: median | 90th | largest |
| --- | --- | --- | --- | --- |
| guava | 1,269 | 10 | 28 | `Maps` 89 |
| jenkins | 720 | 7 | 22 | `Jenkins` 330 |
| jackson-databind | 350 | 13 | 44 | `ObjectMapper` 172 |
| tokio | 191 | 9 | 21 | `UdpSocket` 68 |
| regex | 159 | 10 | 29 | `DFA` 63 |
| gin | 26 | 2 | 23 | `Context` 145 |
| sqlparser-ranger | 2 | 69 | 69 | `Parser` 69 |
| cobra | 1 | 154 | 154 | `Command` 154 |

Ten satellites is what the drawing does every day. The outliers are real, and
they are what the view of one type alone is for.

## Goals / Non-Goals

**Goals:**

- A reader looking at a type's methods can see, at the same time, what the rest
  of the project is and where those methods reach into it.
- The lines a type has are attributed to the method they come from, wherever
  the document knows which one that is.
- Nothing changes for a reader who does not open a type.

**Non-Goals:**

- A member that can be pointed *at*. What a member points to is recorded; a
  line from another type's method to `Parser::expr` is not. That makes members
  addressable, which is the whole identity half of the document.
- Members for TypeScript and Python. Those two record none, and giving them
  members is a change about what those drawings hold.
- Opening a type by default, or a size at which the viewer opens one by itself.
  Opening is the reader's act.

## Decisions

### What a member records

**A member records the nodes its body names, as `points`: a list of node ids,
each one a target its own node already has an edge to.** Ids because a target is
anywhere in the project and an id is what names it there; ids alone because the
document carries at most one edge for an ordered pair of nodes, so the target
names the edge and its kind with it. That makes the record the same shape as
`calls` — a flat list of strings — where jackson-databind would otherwise carry
thousands of three-line objects.

The type keeps its edges. A member's `points` says which member an edge came
from; it does not move it. Two reasons: a type's edges are not all from method
bodies — a field's type, a signature, a supertype — so deriving the type's edges
from its members' would lose them; and every consumer that reads edges today
keeps reading the same edges.

That makes each entry checkable against the document it is in: an edge from the
member's node to that target, of that kind, must exist. A member pointing at its
own node records nothing, because a node has no edge to itself.

Alternatives: names, as `calls` uses them — a name is enough inside one type and
means nothing across a project. An id with the kind beside it — the kind is the
node's edge's, and a second copy of it is a second thing to keep true.

### What is drawn when a type is opened

**The type's members become nodes in the drawn graph, contained by the type, and
the layout seats them as it seats any other satellite.** The type stays where it
is: what points at a type points at the type, not at one of its methods, and a
type that vanished when opened would take its incoming lines with it.

Lines, while it is open:

- member to member, from `calls`, as the view of one type alone draws them;
- member to any other node, from `points`;
- the type's own outgoing edges, drawn from the members that account for them,
  and from the type where no drawn member does — a field's type, a supertype;
- everything pointing at the type, unchanged.

One node per member name, as the view of one type alone does: a name a language
overloads is one thing to a reader, and `ObjectMapper.readValue` is written 31
times.

Alternatives: replacing the type with its members — incoming lines have nowhere
to land; a lobe laid out on its own — a second layout with its own rules for
what the satellite seating already does.

### Several at once, and the ƒ toggle

**Any number of types may be open.** Two types opened side by side are how a
reader sees how they interlock, which is the question that sends them here.

**A member drawn this way is not hidden by the ƒ toggle.** The toggle answers
"do I want this project's functions"; a member is on screen because the reader
opened the type it belongs to.

### How it is opened and closed

The panel's member list carries the two ways of reading a type, at its head:
opening it where it stands, and the view of it alone. The same row closes what
it opened.

**Escape closes one thing at a time, innermost first**: the settings panel, then
the right button's view, then the view of one type alone, then the most recently
opened type. A reader who opened three types presses Escape three times and gets
the drawing back; the key never clears the canvas at once.

## Risks / Trade-offs

- [A target named by many members becomes many lines] → Measured over the
  corpus, an opened type draws a median of 1 to 8 lines and a 90th percentile of
  12 to 45. The extremes are real and rare: 551 for sqlparser-ranger's `Parser`,
  and one target reached by 71 of jackson-databind's
  `JacksonAnnotationIntrospector`'s members. Only a type the reader opened draws
  any of them, and the view of one type alone is what the extremes want.
- [The artifact grows] → Each entry is a target the analyzer already resolved
  for the type's edge. Measured over every Rust, Go and Java fixture: 5% to 21%
  for Go and Rust, 22% to 41% for Java, whose types carry the most members.
- [A 154-member type opened in place is a crowd] → Looked at: sqlparser-ranger's
  `Parser` at 69 members reads — the methods ring the types the parser is built
  from, and each line starts at the method that names it. cobra's `Command` at
  154 does not: the ring that holds them without overlap is so wide that the
  type is left alone in the middle of its own lines. The view of one type alone
  is what that type wants, and it stays. Opening is an act the reader can undo.
- [An older artifact has no `points`] → It opens exactly as it does today: the
  type's edges stay on the type, and the members' own lines are the calls
  between them.
- [Two open types share a target] → Both draw their own line to it. That is the
  answer the reader opened them for.

## Migration Plan

The document gains a field; nothing is removed. Every Rust, Go and Java fixture
is regenerated, and the contract check reads them. An artifact written by an
older analyzer stays valid and opens.

## Open Questions

None.
