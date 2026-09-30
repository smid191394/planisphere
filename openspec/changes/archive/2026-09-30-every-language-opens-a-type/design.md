## Context

See proposal.md. The artifact already says what a member is, what it may
record, and how both are checked; Rust, Go and Java write it. This change is two
more producers of the same thing.

Both analyzers already walk a class's methods — to find the class's own edges —
and throw the method away. The member is the method they already have.

## Decisions

### What becomes a member

**Python**: every `def` and `async def` written directly in the body of a
top-level class. Not a function nested in a method, and not the methods of a
class nested in a class: neither is a node's own, and the rule against nodes
inside nodes is the reason those classes are not nodes either.

**TypeScript**: in a class, every method, the constructor (named `constructor`,
as the source writes it), and every property whose value is an arrow function or
a function expression; in an interface, every method signature. The property is
the member form of `export const f = () => …`, which the analyzer already takes
as a function at the top level; leaving it out would drop the methods of every
class written that way. Accessors are left out: `get x()` is read as a
property, not called.

### A name declared more than once

The last declaration of a name wins, as it does for a top-level name in both
analyzers. In Python that is `@overload`'s implementation and a property's
setter; in TypeScript the implementation after its overload signatures. It is
what the name means once the class has been read.

### What a member calls

Recognised by what the source writes, as in the other three. Python: a call on
the method's receiver — its first parameter, whatever it is named, `self` or
`cls` — unless the method is a `@staticmethod`, which has none. TypeScript: a
call on `this`. Kept only where the class has a member of that name.

### What a member points at

The same walk that finds the class's edges, run over the one method, and kept
only where the class ends up with an edge to the target — the check the other
three make.

### A member on its class's line

A member SHALL NOT be declared at a node's file and line, and a one-line class
— `class A { f() {} }` — puts both on one. Such a member is not recorded. The
alternative is to change what the artifact means by the same declaration, which
three other analyzers rely on, for a shape the corpus measures in single digits.

## Risks / Trade-offs

- [Python's receiver is a convention] → A method whose first parameter is not
  its receiver is a `@staticmethod`, which is excluded; anything else that
  renames it still writes calls on it.
- [Artifacts grow] → By more than the other three did: a Python or TypeScript
  artifact recorded almost nothing but nodes and edges, so its members are
  most of what is new. Measured on regeneration, 8% for zod to 100% for typeorm;
  CPython goes from 3.7 MB to 6.4 MB, Django from 2.7 MB to 4.7 MB, Angular
  from 12.2 MB to 15.6 MB. Nodes and edges are byte for byte what they were in
  all twelve, and the layout suite's open-time guard passes on them.
- [The drawing changes under a reader] → It does not: the layout counts a
  member written inside its type's declaration by the declaration's lines, and
  every Python and TypeScript member is written there. The recorded layout
  hashes for those fixtures are the proof.
