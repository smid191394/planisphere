## 1. Screenshots

- [x] 1.1 Add `playwright-core` and `sharp` as development dependencies, and check that the package's file list is unchanged by them.
- [x] 1.2 Write `scripts/screenshots.js`: build the viewer's page with `buildGraphWebviewHtml` and a stand-in host that sends settings and graph and answers `getComment` with `leadingComment`; load `graph.js` with the layout suite's insertion to reach `cy`.
- [x] 1.3 Overview: FastAPI's artifact, framed on the group the graph starts from, with everything outside it hidden, captured as the drawing's element only, into `docs/images/overview.jpg`.
- [x] 1.4 Focus: cobra's artifact, `Command` clicked at its rendered position, waiting for the comment panel, into `docs/images/focus.jpg`.
- [x] 1.5 Add `npm run screenshots`, and check the images by eye: labels readable at 900 pixels wide, nothing cut off, the comment panel filled.
- [x] 1.6 Right-click view: ripgrep's artifact, `SearcherBuilder` right-clicked, framed on what is left, into `docs/images/reach.jpg`.

- [x] 1.7 Trim the mascot's picture, size it for the README, and put it in `docs/images/sirius.png`.
- [x] 1.8 Compose `docs/images/banner.jpg` from the mascot, the star field and the name, with `npm run banner`, and open the README with it under a title carrying 🌠 and a badge row.

## 2. The README and what moves out of it

- [x] 2.1 Rewrite `README.md` for a reader who installs: what it is, the overview image, the languages and what each needs installed, producing and opening a graph, the focus image, using it, and a link to `CONTRIBUTING.md`.
- [x] 2.2 Write `CONTRIBUTING.md` from what the README carries today: building and installing from source, putting the CLI on PATH, running an analyzer by hand, the test suites, and making the screenshots again (including installing Chromium for Playwright).
- [x] 2.3 Write `CHANGELOG.md` with 0.1.0.
- [x] 2.4 Check that every relative link and image in the README resolves in the repository, and that `vsce ls` lists `README.md`, `CHANGELOG.md` and `LICENSE` and no image from `docs/`.

## 3. Publishing

- [x] 3.1 Add to `docs/release-checklist.md`: make the repository public before the first publish; publish to both the Visual Studio Marketplace and Open VSX; check the README's images on both published pages; compare the screenshots with the viewer in an editor.

## 4. Proof

- [x] 4.1 `npm run package`, `npm test` and `npm run test:e2e` pass, and the package is installed into Cursor with its own CLI.
