## 1. The sample

- [x] 1.1 Write `sample/` — fifteen to twenty TypeScript declarations from one plausible domain, with inheritance, a couple of interfaces, an enum, and a comment above each declaration.
- [x] 1.2 Ship it: `.vscodeignore` keeps `sample/**`, and the packaging suite states that it is there and that nothing else of the project's is.
- [x] 1.3 Draw it by hand once with the CLI, and look at it: a drawing that reads badly is the wrong sample.

## 2. The offer

- [x] 2.1 A function that analyses `sample/` with the TypeScript analyzer into the extension's own storage and opens what it writes, reusing what is there when it is newer than the sample.
- [x] 2.2 Both messages — no folder open, and no analyzable source — take a button that calls it.
- [x] 2.3 Check that nothing new appears in the command palette or the explorer's menu.
- [x] 2.4 Begin drawing when the offer is made, not when it is accepted: the button waits on what is already running.

## 3. The empty drawing

- [x] 3.1 The empty-drawing line names no language.

## 4. Proof

- [x] 4.1 An end-to-end scenario: with no folder open, the offer is made and accepted, and a drawing of the sample opens with the nodes' files where it says they are.
- [x] 4.2 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
