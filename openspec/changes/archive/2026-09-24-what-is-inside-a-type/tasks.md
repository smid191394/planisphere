## 1. What the document holds

- [x] 1.1 The contract check reads a member's calls: each one names a member of the same node, each name once. Watch it pass on documents that have none.
- [x] 1.2 Rust: a member records the methods it calls on `self`. Tests first, in `analyzers/rust/tests/rules.rs`.
- [x] 1.3 Go: a member records the methods it calls on the receiver the method names. Tests first.
- [x] 1.4 Java: a member records what it calls as `this.name(…)` or with no receiver where the type declares that name. Tests first.
- [x] 1.5 Regenerate every Rust, Go and Java fixture — the document's shape changed, so the corpus is stale — and read the numbers: how many calls each project's largest type records.

## 2. The view

- [x] 2.1 A way in: a control at the head of the panel's member list, shown only where those members call one another.
- [x] 2.2 The view itself: one node per member name, the calls between them, the strip that says where the reader is and takes them back.
- [x] 2.3 The centre is a member no member calls; where there are several, the drawing's own criterion chooses; where there is none, it chooses over all of them.
- [x] 2.4 Activating a member's node twice opens the file and line it records.
- [x] 2.5 Layout tests in `media/tests` for the three centre cases and for leaving the view.

## 3. Proof

- [x] 3.1 Open sqlparser-ranger's drawing, enter `Parser`, and read it: the centre is `sql_stmt_list`, and the rules it parses are around it.
- [x] 3.2 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
