## Why

The README is the page a reader meets first, in three places: GitHub, the
Visual Studio Marketplace, and Open VSX, where Cursor installs from. Both
marketplaces show the README packaged into the `.vsix`, and the editor shows
the same file when a reader opens the extension's details. Today it is written
for someone building from source: it opens with `npm install` and a `.vsix`
path, and a reader who would press Install learns neither what the drawing
looks like nor what one click on a node gives them — the page has no picture
of a product whose whole point is a picture.

## What Changes

- **Three screenshots in the README**, made from the fixture corpus:
  - FastAPI's whole drawing as it opens, cropped to the main tree: what
    Planisphere is.
  - cobra's `Command` focused: its neighbours lit, the rest dimmed, and the
    panel showing its doc comment and its methods: what one click gives.
  - ripgrep's `SearcherBuilder` right-clicked: everything else put away, and
    what it points to two steps out growing above it as a tree.
- **A script that makes the screenshots again**, so they follow the viewer when
  its look changes rather than going stale.
- **The README rewritten for a reader who installs**: what it is, the
  pictures, which languages it reads and what each needs installed, how to
  produce and open a graph, and how to use it. Building from source, running
  the analyzers by hand, and the test suites move to `CONTRIBUTING.md`, linked
  from the README.
- **A `CHANGELOG.md`**, which both marketplaces show as a tab of its own.
- **The release checklist covers publishing**: the repository is public before
  the first publish, since the listing loads the README's images from it, and
  the package goes to both the Visual Studio Marketplace and Open VSX.

Also here: the mascot's picture, which the author made, in a banner over the
star field the viewer draws, under a title that carries the product's mark.

Not in this change: the viewer shortcomings the
screenshots surfaced — a Python type's docstring is not shown in the comment
panel, Javadoc markup is shown raw, a heavily connected type's neighbours pile
their labels on one another, and some drawings open framed on part of
themselves. Each is a change of its own.

## Capabilities

### New Capabilities

None. This changes what the documentation says, not what the product does.

### Modified Capabilities

None.

## Impact

- `README.md`, new `CONTRIBUTING.md` and `CHANGELOG.md`.
- New `docs/images/` holding the screenshots. They stay out of the package:
  `.vscodeignore` ships images from `media/` only, and the marketplaces load
  the README's images from the repository.
- A screenshot script under `scripts/`, which renders the viewer's page in a
  headless Chromium from a fixture artifact; it reads the fixture corpus, so it
  runs where the fixtures are cloned.
- `docs/release-checklist.md`.
