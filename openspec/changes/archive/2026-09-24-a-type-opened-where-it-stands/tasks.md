## 1. What the document holds

- [x] 1.1 The contract check reads what a member points at: each entry names a node of the same document, matches an edge of the member's own node with that kind, never names that node itself, and is recorded once. Watch it pass on documents that record none.
- [x] 1.2 Rust: every edge an impl's signature or body gives the type is recorded against the member it came from. Tests first, in `analyzers/rust/tests/rules.rs`.
- [x] 1.3 Go: the same for a method's signature and body, against the member of its receiver's type. Tests first.
- [x] 1.4 Java: the same for a method's or constructor's signature and body. Tests first.
- [x] 1.5 Regenerate every Rust, Go and Java fixture and read the numbers: how much each artifact grows, and — for the types worth opening — how many members name one target, which is how many lines an opened type draws to it.

## 2. The drawing

- [x] 2.1 A second way in, at the head of the panel's member list: open the type where it stands, beside the view of it alone. The same row closes what it opened.
- [x] 2.2 An open type's members are nodes of the drawing, contained by the type and seated as satellites of it, with the type still in its place.
- [x] 2.3 The lines: member to member from what they call, member to node from what they point at, and the type's own edges drawn from the members that account for them and from the type where none does.
- [x] 2.4 Activating a member twice opens its file and line; the control that hides functions leaves an open type's members alone.
- [x] 2.5 Several types open at once, and Escape closing the most recently opened one after the views that cover the drawing.
- [x] 2.6 Layout tests in `media/tests`: what is drawn and where, the three kinds of line, two types open together, closing one and closing all of them.

## 3. Proof

- [x] 3.1 Open sqlparser-ranger's drawing, open `Parser` where it stands, and read it: the rules are around the type, and the lines to `Scanner` and to the AST types start at the methods that name them.
- [x] 3.2 Open the worst case the corpus offers — cobra's `Command`, jackson-databind's `ObjectMapper` — and say plainly whether it reads.
- [x] 3.3 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
