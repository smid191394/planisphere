## Context

See proposal.md for why. What shapes the approach:

- Both marketplaces render the README that is packaged into the `.vsix`, and
  `vsce` rewrites its relative links and images into URLs on the GitHub
  repository named in `package.json`. Images must be HTTPS and not SVG. The
  repository is private until the first publish.
- `.vscodeignore` ships images from `media/` only, so an image anywhere else
  is on GitHub and not in the package.
- The viewer is one page, built by `buildGraphWebviewHtml` in
  `src/graphDocument.ts`, that receives the graph and the comments from the
  host by `postMessage`. `media/graph.js` is a closure that exports nothing;
  `media/tests/harness.js` reaches its state by inserting an assignment before
  its closing `})();`.
- The fixture corpus is external clones, without their `.git`, and exists only
  where it has been cloned.
- Node is 20 here, which has no built-in WebSocket.

## Goals / Non-Goals

**Goals:**

- Screenshots that are the real viewer, drawn from a real project, and that can
  be made again with one command after the viewer's look changes.
- One README that serves GitHub, both marketplaces and the editor's details
  view.

**Non-Goals:**

- A screenshot of the editor around the viewer.
- Animated images.
- A screenshot per language.

## Decisions

### One README, with development moved to CONTRIBUTING.md

The readers of GitHub and of the marketplaces overlap: Planisphere's users are
developers. One README, written for someone who installs, with a link to
`CONTRIBUTING.md` for building, running an analyzer by hand and testing.

Rejected: a second README for the marketplaces, packaged with
`vsce package --readme-path`. Two files describing one product drift apart,
and the GitHub page would still need the pictures.

### The screenshot is the viewer's own page, driven by a stand-in host

The script builds the page with `buildGraphWebviewHtml`, with local file URLs
for the assets, and a stand-in for `acquireVsCodeApi` that answers the page as
the host does: it sends the settings and the graph, and answers `getComment`
with `leadingComment` over the source file. What is drawn is the shipped
`graph.js`, `graph.css` and star field, so a change to the viewer's look shows
up in the next run.

Rejected: a real VS Code under a virtual display. The editor around the drawing
takes room from it at marketplace width, and a click inside a webview cannot be
scripted from outside the editor without a harness of its own.

### Playwright drives the page

`playwright-core` becomes a development dependency. The script opens the page
in headless Chromium, waits for the drawing and for the comment panel rather
than for a guessed interval, clicks a node where it is drawn, and captures the
drawing's element only, leaving out the rail and the search strip.

Rejected:

- Chromium's `--screenshot` flag. It waits a fixed virtual time, cannot click,
  and captures the whole window with no crop.
- The DevTools protocol by hand. Node 20 has no WebSocket, so it needs a
  dependency anyway.
- Cropping afterwards with an image tool. None is part of the project's
  toolchain, and a fixed crop box is wrong as soon as the layout moves.

### The camera is placed from the drawing, not from pixel coordinates

The script loads `graph.js` with the same insertion the layout suite uses, and
reads `cy` and the layout's group of each node from it. The overview shows the
group the graph starts from, the one holding the primary centre, and hides
everything else: the cluster of unconnected nodes otherwise widens FastAPI's
drawing to twice its height. The largest connected part of what is drawn is not
that group — with functions hidden, types joined only through a function fall
apart from it. The focused shot clicks `Command` at its rendered position,
which is the gesture a reader makes.

### Where the images live and how large they are

`docs/images/overview.png` and `docs/images/focus.png`, rendered at 1600 by 1000
CSS pixels. The marketplaces show a README about 900 pixels wide, so this is
sharp at twice that density without the file growing past a couple of
megabytes.

## Risks / Trade-offs

- [The listing shows broken images while the repository is private] → The
  release checklist makes the repository public before the first publish, and
  the images are checked on the published page.
- [A fixture clone at another commit draws a different picture] → The script
  names the fixtures it uses, and `docs/languages.md` records their commits
  where it has them; the pictures are checked by eye after each run.
- [Headless Chromium renders fonts or colours differently from the editor] →
  The release checklist compares the screenshots with the viewer in an editor
  once per release.
- [A development dependency for two images] → `playwright-core` is not shipped
  and downloads no browser on install; the Chromium it drives is installed once
  with its own command, which `CONTRIBUTING.md` names.
