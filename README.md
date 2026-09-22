# Planisphere

Visualize symbol structure — types, top-level functions and the relationships between them — as an interactive graph in Cursor/VS Code, with click-to-jump. **Python**, **TypeScript**, **Go**, **Rust** and **Java**.

## The name

A planisphere is a star chart that flattens the sky onto one rotating disc, so
that you can see at a glance what is overhead. Planisphere does the same for a
codebase: it flattens a tangle of modules and types into one drawing, laid over
the starfield the viewer draws behind it.

Its mascot is a dog named Sirius, after the Dog Star — the brightest star on
any planisphere.

## Prerequisites

**Opening a graph needs nothing at all.** The extension draws a `planisphere.json`
somebody has already produced — a colleague's, or one from a repository — with no
toolchain installed.

**Producing one from the editor needs nothing for TypeScript or Go**, and the
toolchain of the language for the other three. Each analyzer reads the project's
own source and never downloads its dependencies.

| Reading | Needs | Why |
| --- | --- | --- |
| TypeScript | nothing | the compiler ships with the extension and runs on the editor's own Node |
| Go | nothing | the analyzer ships compiled for Linux, macOS and Windows |
| Rust | `cargo` | `syn`'s source ships with the extension and is built once, offline, on first use |
| Python | Python 3, as `python3` or `python` (`py` on Windows) | the standard library's `ast` |
| Java | `java` 21+ from a JDK | the runtime's own compiler module, `jdk.compiler` |

A toolchain installed where the editor does not look — `~/.cargo/bin` when the
editor was started without your shell's profile — is still found.

A `java` from a JRE without that module is told apart from a missing `java`, and
says so. To **build** the `.vsix` yourself: Node.js + npm.

## Install extension (for viewing graphs)

```bash
cd /path/to/planisphere
npm install
npm run package
cursor --install-extension ./planisphere-0.1.0.vsix --force
```

Reload Window afterwards.

Optional — put CLI on PATH:

```bash
chmod +x /path/to/planisphere/bin/planisphere
ln -sf /path/to/planisphere/bin/planisphere ~/.local/bin/planisphere   # ensure ~/.local/bin is on PATH
```

## Usage

### 1. Generate the graph file

**From the editor:** right-click a folder in the Explorer and choose
**Planisphere: Analyze Folder**, or run the same command from the Command Palette
(`Ctrl+Shift+P`). It writes `planisphere.json` into that folder and opens
it as a graph. Where the folder holds more than one language, it asks which.

**From a terminal**, in the project you want to analyze:

```bash
planisphere
```

Writes **`./planisphere.json`**. Options:

```bash
planisphere /path/to/project
planisphere -o graph.planisphere.json
planisphere --stdout
planisphere --lang go /path/to/module   # name the language when a repo holds more than one
planisphere --lang rust /path/to/workspace
planisphere --lang java /path/to/repo
```

Without PATH:

```bash
/path/to/planisphere/bin/planisphere
# or
python3 /path/to/planisphere/analyzers/python/planisphere.py     # or --lang python
node    /path/to/planisphere/analyzers/typescript/planisphere.js  # or --lang typescript
go -C /path/to/planisphere/analyzers/go run . "$PWD"          # or --lang go
cargo run --release --manifest-path /path/to/planisphere/analyzers/rust/Cargo.toml -- "$PWD"   # or --lang rust
java    /path/to/planisphere/analyzers/java/Analyzer.java "$PWD"        # or --lang java
```

### 2. Open the file in Cursor

Open `planisphere.json` (double-click / Open). The Custom Editor shows the graph — no re-analysis on open.

To see raw JSON: right-click → **Open With…** → **Text Editor**.

### 3. Interact

- **Click** a node to focus it: what it touches stays lit, the rest dims, and the
  panel shows the comment above its definition, or a group's members.
  **Click it again** to jump to its source.
- **Click** empty canvas or an edge to clear the focus.
- **Right-click** a node to see only what it points to, two steps out.
  **Escape**, or the **←** button above the drawing, returns to the whole drawing.
- **/** searches by name, members included; **Enter** moves to the next match.
- **F** fits the whole drawing. **C** makes the focused node the centre; press
  it again on the centre to hand the choice back.
- The rail on the left shows or hides functions, resets the view, opens the
  settings (which kinds are drawn, and their colours), exports the drawing as a
  PNG beside the artifact, and opens the legend, which names every mark the
  drawing makes.

Edges are `contains`, `inherits`, `uses` and `references`; the legend shows how
each is drawn.

Paths in the artifact are **absolute**. After code changes, run `planisphere` again to refresh the file.

## Tests

```bash
npm test            # every analyzer, the CLI, the viewer's layout, the artifact contract and the package
npm run test:e2e    # installs the packaged .vsix into a real VS Code and runs the command there
```

`npm test` needs the five toolchains (`node`, `python3`, `go`, `cargo`, a JDK);
each language also has its own script, such as `npm run test:go`.
