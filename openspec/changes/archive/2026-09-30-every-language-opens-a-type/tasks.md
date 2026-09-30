## 1. Python

- [x] 1.1 A class's methods are its members: direct `def`s only, the last of a name kept, not on the class's own line. Tests first, in `analyzers/python/tests`.
- [x] 1.2 What a member calls: on its receiver, not for a `@staticmethod`, kept where the class has that member. Tests first.
- [x] 1.3 What a member points at: the class's edges its body accounts for. Tests first.

## 2. TypeScript

- [x] 2.1 A class's methods, constructor and function-valued properties, and an interface's method signatures, are members; the last of a name kept. Tests first, in `analyzers/typescript/tests`.
- [x] 2.2 What a member calls on `this`, and what it points at. Tests first.

## 3. The corpus and the viewer

- [x] 3.1 Regenerate every Python and TypeScript fixture; the contract check reads them all. Read the numbers: members recorded, calls, points, growth.
- [x] 3.2 The layout suite's recorded hashes for Python and TypeScript are unchanged.
- [x] 3.3 The viewer spec's rule for a type's size no longer says no Python or TypeScript fixture records members; README and CHANGELOG say every language.

## 4. Proof

- [x] 4.1 Open a Python and a TypeScript type in place and alone, and read it.
- [x] 4.2 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
