## Context

See proposal.md for why. What the corpus says, measured:

| | nodes | nodes with members | members | the largest |
| --- | --- | --- | --- | --- |
| sqlparser-ranger | 109 | 55 | 140 | `Parser` 69 |
| cobra | 127 | 6 | 163 | `Command` 154 |
| jackson-databind | 864 | 801 | 9,340 | `ObjectMapper` 172 |
| zod | 1,991 | 0 | 0 | — |
| flask | 117 | 0 | 0 | — |

Three things follow from it:

- **Members outnumber nodes where they are recorded at all.** Drawing all of
  them is drawing a different, larger picture: jackson-databind would go from
  864 nodes to over ten thousand.
- **Two analyzers record none.** TypeScript and Python put a method nowhere: it
  is neither a node nor a member. Whatever is decided here, those two answer a
  question of their own first.
- **A member carries a name, a file and a line.** Nothing about what it points
  to. A call from one member to another is attributed to the type both belong
  to, which makes it a self-loop, which is dropped: sqlparser-ranger's artifact
  records 0 edges from `Parser` to `Parser` although 69 methods call one
  another constantly.

So nothing can be drawn from the document as it stands. This change is first
about what the document records, and only then about what the drawing does.

## Goals / Non-Goals

**Goals:**

- A reader can see the structure a project builds out of methods, where that is
  the structure — a parser whose functions are its grammar's rules.
- The default drawing stays the size it is now.

**Non-Goals:**

- A call graph of everything. Every function calling every function is the
  low view this product exists not to be.
- Making TypeScript and Python record members. It is a real gap, and it is
  bigger than this: it changes what those drawings hold.

## Decisions

Two questions, and the first one settles what the second can do.

### What the artifact records

**(i) A member records what it points to, within its own type.**
`{ name, file, line, calls: ["expr_tail", …] }`, naming members of the same
type. Small, local, and it is exactly the parser case: a rule calls the rules
it contains. What a member points to outside its type stays attributed to the
type, as it is now.

**(ii) A member becomes a node in its own right**, with an identity and
ordinary edges. Every rule about identity, paths and edges then has to answer
for members, every analyzer has to emit them, and the drawing has ten thousand
nodes to decide about. This is the general answer, and it is a different
product.

Recommended: **(i)**. It is the smallest thing that can answer "what is this
type made of", it leaves the document's shape alone, and it does not close the
door on (ii).

### What the drawing does with it

**(A) Every member drawn, as a toggle.** Like showing functions: a switch, and
the drawing grows. On jackson-databind that is ten thousand nodes on the rings,
which the layout is not built for and the reader cannot read.

**(B) A type's members drawn around it, on demand.** Focus a type, press
something, and its members appear as satellites of it with the lines between
them. Bounded by the type's own size — 69, 154, 172 — and it reuses the
satellite machinery the drawing already has.

**(C) A view of one type, as the right button gives a view of one node.** The
canvas is given over to that type: its members, the lines between them, nothing
else. `statement` at the top, `select_stmt` and `expr` under it, `expr_tail`
under that — the railroad diagram, drawn from the code that follows it.

**Decided: (C)**, entered from the way in.

Both were mocked from real data — the 69 members of sqlparser-ranger's `Parser`
and the 349 calls between them — and the pair settles two things at once.

Drawn whole, the view is centred on `eat`, a one-line helper every rule calls,
and the structure the parser is built from sits behind it. Entered at
`sql_stmt_list` and read outward, the same data reads as what it is: the entry,
and under it `create_table_stmt`, `select_stmt`, `update_stmt_body`, each named
after the rule it parses.

So the view SHALL be centred on a way in — a member that nothing else in the
type calls — and not on the member with the most lines running to it. Inside a
type the most-called member is a utility, and a utility is what a reader is
looking past.

(B) is not kept as a step towards it. Satellites around a type are what a
drawing already does with functions, and at 69 members it is the crowded ring
cobra's `Command` shows at 154.

## Risks / Trade-offs

- [The artifact changes shape, and every fixture is regenerated] → The contract
  check reads 25 of them, so the cost is known and bounded.
- [Three analyzers must keep member-level detail they currently discard] → They
  already resolve the name; what changes is where the result is put.
- [A type with 172 members is a crowded view] → The same crowding the drawing
  already has for a node with many neighbours, and the same answers apply.
- [Two languages record no members at all] → A reader of TypeScript or Python
  gets nothing from this change. Saying so plainly is better than half-doing it
  here.

## Settled

1. **The view is (C)**, centred on a way in.
2. **Within a type only.** `Parser::expr` calling `Scanner::next` stays
   attributed to the type, as it is now. Recording it is most of the way to
   making a member a node, which is a different product.
3. **TypeScript and Python are left as they are**, recording no members. A
   reader of those two gets nothing from this change, and saying so is better
   than half-doing it here. Whether they should record members at all is a
   change of its own.

## Open Questions

None left for the design. What the delta specs must still pin down is the shape
of the `calls` a member records, and how the view is entered and left.
