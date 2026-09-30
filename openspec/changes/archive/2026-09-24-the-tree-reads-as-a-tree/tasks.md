## 1. The tree, drawn as one

- [x] 1.1 The type's joins beyond the first level of its tree are kept for the layout and not drawn. Test: the type is joined to its first level and to nothing further out.
- [x] 1.2 A member holding more than half of the tree is placed beside the type, its children on the first level. Tests: with one such member, and with two ways in holding half each.
- [x] 1.3 Levels 150px apart, each only as far out as its own narrowest slice needs.

## 2. Proof

- [x] 2.1 Open sqlparser-ranger's `Parser`, alone and in place, and compare with the view of one type alone as it read before: the way in at the middle, the statements round it, the clauses beyond.
- [x] 2.2 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
