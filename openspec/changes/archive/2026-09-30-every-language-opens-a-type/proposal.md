## Why

A type can be opened — its methods drawn as the tree their calls make — in Rust,
Go and Java, and not in Python or TypeScript. The viewer is the same for all
five; the difference is the document. The Python and TypeScript analyzers record
no members: a class's methods are walked to find the class's edges and then
forgotten, so a reader of a Python or TypeScript drawing gets no list of a
class's methods in the panel, no search that finds a method, and nothing to open.

Those two languages are most of what people will point the tool at, and most of
the corpus: eight Python projects and four TypeScript ones against thirteen for
the other three together.

## What Changes

- **Python records a class's methods as its members**: each `def` and
  `async def` written directly in a top-level class, with the file and the line
  of its `def`.
- **TypeScript records a class's and an interface's methods as members**: each
  method, constructor and method signature, and each property whose value is a
  function — the member form of `export const f = () => …`, which is already a
  function at the top level.
- **Both record what a member calls of its own class** — `self.x()` or `cls.x()`
  in Python, `this.x()` in TypeScript — **and what its body names outside the
  class**, as the other three do. Opening a type then works in every language
  without the viewer changing.
- The artifact's rules for members are unchanged; every Python and TypeScript
  fixture is regenerated and the contract check reads them.

## Capabilities

### Modified Capabilities

- `python-symbol-graph`: a class's methods are recorded as members, with their
  calls and what they point at.
- `typescript-symbol-graph`: a class's and an interface's methods are recorded
  as members, with their calls and what they point at.
- `structure-graph-viewer`: the statement that no Python or TypeScript fixture
  records members, in the rule for how large a type is, is no longer true.

## Impact

- Two analyzers and their tests; every Python and TypeScript fixture.
- The panel, search and both ways of opening a type now reach Python and
  TypeScript classes. The layout does not change: a member written inside its
  class's declaration is already counted by the declaration's lines.
- Artifact size for Python and TypeScript, measured when the fixtures are
  regenerated.
