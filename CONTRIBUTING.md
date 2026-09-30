# Contributing

## Building and installing from source

You need Node.js and npm. Packaging builds the Go analyzer for every platform,
so it needs Go 1.23 or later too.

```bash
npm install
npm run package                       # planisphere-<version>.vsix at the repository's root
cursor --install-extension ./planisphere-0.1.0.vsix --force   # or: code --install-extension …
```

Then reload the editor's window. Install with the editor's own CLI rather than
by copying files into its extensions folder: the editor caches an extension's
manifest, and a copy does not refresh it.

## The command line

`bin/planisphere` picks the analyzer from the source it finds and writes the
artifact. To have it on your `PATH`:

```bash
chmod +x /path/to/planisphere/bin/planisphere
ln -sf /path/to/planisphere/bin/planisphere ~/.local/bin/planisphere
```

Each analyzer also runs on its own:

```bash
python3 analyzers/python/planisphere.py "$PWD"
node    analyzers/typescript/planisphere.js "$PWD"
go -C   analyzers/go run . "$PWD"
cargo run --release --manifest-path analyzers/rust/Cargo.toml -- "$PWD"
java    analyzers/java/Analyzer.java "$PWD"
```

## Tests

```bash
npm test            # every analyzer, the CLI, the viewer's layout, the artifact contract and the package
npm run test:e2e    # installs the packaged .vsix into a real VS Code and runs the command there
```

`npm test` needs the five toolchains: `node`, `python3`, `go`, `cargo` and a
JDK. Each part also has a script of its own, such as `npm run test:go` or
`npm run test:layout`.

Parts of the layout suite and the contract check read the fixture corpus: real
projects cloned under `fixtures/<language>/`, which is not in the repository.
[docs/languages.md](docs/languages.md) lists each fixture, the directory its
artifact is made from, and the commit it was measured at where it records one.

## Screenshots

The README's images are the viewer's own page, drawn from four fixtures:
`fixtures/python/fastapi`, `fixtures/go/cobra`, `fixtures/rust/ripgrep` and
`fixtures/rust/sqlparser-ranger`, each with its `planisphere.json` generated.
Playwright drives a headless Chromium, installed once:

```bash
npx playwright-core install chromium
npm run screenshots                  # writes overview.jpg, focus.jpg, reach.jpg and expand.jpg
```

Run it again when the drawing's look changes, and look at the images before
committing them. The first one presses the rail's `Show functions` button before
it is taken; the last clicks `Parser` and presses the button beside its name that
expands its members; the other two leave the drawing as it opens.

The banner at the top of the README is made from the mascot with the five
languages ringed around it, and the name beside it, laid out in the same
headless Chromium. Its fonts are in `docs/fonts/` under the Open Font License,
so the banner comes out the same wherever it is made:

```bash
npm run banner                       # writes docs/images/banner.jpg
```

`docs/images/sirius.png` is the mascot as the banner uses him, cut from
`docs/images/sirius-source.png`:

```bash
node -e 'require("sharp")("docs/images/sirius-source.png").trim({threshold:1}).resize({width:320}).png({palette:true}).toFile("docs/images/sirius.png")'
```

## How the product is described

[openspec/specs/](openspec/specs/) holds what the product does, one capability
per directory. A change starts as a proposal under `openspec/changes/`, and its
requirements are merged into the specs when it is archived.

How to behave here is [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); what to do with
something that should not be public is [SECURITY.md](SECURITY.md).

Before publishing, go through [docs/release-checklist.md](docs/release-checklist.md).
