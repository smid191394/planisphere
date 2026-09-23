# Planisphere 🌠 — Read a codebase as one drawing

![Planisphere](docs/images/banner.jpg)

<p align="center">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="https://code.visualstudio.com/"><img alt="VS Code 1.85+" src="https://img.shields.io/badge/VS%20Code-1.85%2B-blue" /></a>
</p>

Planisphere draws a project's types as a radial map. Click one to open its source.

![FastAPI's types, drawn by Planisphere](docs/images/overview.jpg)

<sub>FastAPI, from its own source. The red node is where the drawing starts;
solid lines are inheritance, dashed ones are uses.</sub>

## Getting started

1. Install **Planisphere** from the Extensions view of VS Code or Cursor.
2. Right-click a folder in the Explorer and choose **Planisphere: Analyze Folder**.
3. It writes `planisphere.json` there and opens it as a drawing. A folder with
   more than one language asks which.

Open that file any time and it draws without analysing again; run the command
again when the code has moved on. Its paths are absolute, so a drawing made
elsewhere opens, but jumps to source only where the project sits at the same
path.

## What each language needs

Opening a drawing needs nothing. Making one needs nothing for TypeScript or Go,
and the toolchain you already have for the other three. Nothing is downloaded.

| Language | Needs | Why |
| --- | --- | --- |
| TypeScript | nothing | the compiler ships with the extension |
| Go | nothing | the analyzer ships compiled for Linux, macOS and Windows |
| Rust | `cargo` | `syn` ships as source and is built once, offline |
| Python | `python3`, or `python` (`py` on Windows) | the standard library's `ast` |
| Java | `java` 21 or later, from a JDK | the runtime's own `jdk.compiler` |

A toolchain your shell finds but the editor does not is still found, and a
missing one is named.

## Reading the drawing

![cobra's Command, focused, with its comment and methods beside it](docs/images/focus.jpg)

<sub>cobra's `Command`, clicked once.</sub>

- **Click** a node: what it touches stays lit, and the panel shows the comment
  above it and its members. **Click again** to jump to the source.
- **Right-click** a node: only what it points to, two steps out. **Escape**
  comes back. Clicking empty canvas clears the focus.
- **/** searches, members included, and **Enter** moves to the next match.
  **F** fits the drawing; **C** makes the focused node the centre.
- The rail on the left hides functions, resets the view, opens the settings and
  the legend, and exports the drawing as a PNG beside the artifact.

![ripgrep's SearcherBuilder, with only what it points to, two steps out](docs/images/reach.jpg)

<sub>ripgrep's `SearcherBuilder`, right-clicked: what it points to grows above
it, and the strip at the top left takes you back.</sub>

Edges are `contains`, `inherits`, `uses` and `references`; the legend shows how
each is drawn.

## Without the editor

The `planisphere` command line writes the same file, for a script or a CI job:

```bash
planisphere                              # ./planisphere.json for the current directory
planisphere -o go.planisphere.json       # any *.planisphere.json opens as a drawing
planisphere --lang go /path/to/module    # when a repository holds more than one
planisphere --stdout
```

[CONTRIBUTING.md](CONTRIBUTING.md) says how to put it on your `PATH`.

## The name

A planisphere is a star chart that flattens the sky onto one rotating disc, to
show what is overhead. This does the same for a codebase.

The dog is Sirius: the brightest star on any planisphere, and the one every
stargazer finds first.

## Contributing

Building from source, running an analyzer by hand and the test suites are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
