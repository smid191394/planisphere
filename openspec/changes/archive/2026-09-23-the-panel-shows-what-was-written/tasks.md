## 1. What is read

- [x] 1.1 Tests first, in `src/tests/leadingComment.test.ts`: a quoted block opening a definition is shown without its markers; a comment above wins over it; a one-line block; a quoted block that is not the first thing in the body is not shown.
- [x] 1.2 `src/leadingComment.ts` reads the run below the definition when the run above it is empty.

## 2. What is removed

- [x] 2.1 Tests: `{@link Thing}` is shown as `Thing`; the tags a paragraph is marked up with are dropped; the text keeps its lines.
- [x] 2.2 `src/leadingComment.ts` removes documentation markup from what it returns.

## 3. Proof

- [x] 3.1 Look at it and measure it: how much of each Python fixture's types the panel now has something for, against what it had; and jackson-databind's `ObjectMapper`, whose panel reads as prose.
- [x] 3.2 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
