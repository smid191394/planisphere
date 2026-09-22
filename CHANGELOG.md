# Changelog

## 0.1.0

The first release.

- Draws the types of a Python, TypeScript, Go, Rust or Java project as a radial
  map, from a `planisphere.json` artifact, in VS Code and Cursor.
- **Planisphere: Analyze Folder** writes the artifact for a folder and opens it.
- A click focuses a node and shows its comment and members; a second click jumps
  to its source. A right-click shows what a node points to.
- Search by name, members included; export the drawing as a PNG; choose which
  kinds are drawn and their colours.
- TypeScript and Go need no toolchain installed; Rust, Python and Java use the
  one on the machine.
- The `planisphere` command line writes the same artifact without the editor.
