# Release checklist

`npm run test:e2e` installs the package into a real VS Code and runs the
command there, on Linux. What it cannot see is below: another editor, another
operating system, and whether the drawing looks right. Go through it by hand
before publishing a version.

Build the package with `npm run package`, and install that `.vsix` — never a
copy of the working tree — with each editor's own installer:
`code --install-extension planisphere-<version>.vsix` or
`cursor --install-extension planisphere-<version>.vsix`, then reload the window.

## In each editor: VS Code and Cursor

- [ ] The Extensions view shows Planisphere at the new version, with its icon.
- [ ] Right-clicking a folder in the Explorer shows **Planisphere: Analyze
      Folder**, near the bottom of the menu. Right-clicking a file does not.
- [ ] The Command Palette finds **Planisphere: Analyze Folder**.
- [ ] Run it on a small project of each language. Each opens a graph, and
      `planisphere.json` appears in the folder.
- [ ] Look at the drawing of one real project, e.g. a fixture: modules in
      their boxes, labels readable, edges between the right boxes; clicking a
      node shows its members; search finds a node and Enter moves to the next.
- [ ] A folder holding two languages asks which one.
- [ ] Cancelling a long run (a large project) stops it and leaves no file.

## On each operating system available: Linux, macOS, Windows

The package carries the Go analyzer for linux-x64, linux-arm64, darwin-x64,
darwin-arm64 and win32-x64.

- [ ] TypeScript and Go run with no toolchain installed.
- [ ] Rust with `cargo` installed runs, the first time after a build of about
      half a minute; without it, the message names cargo and rustup.
- [ ] macOS: an editor opened from the Dock, not from a terminal, still finds
      `cargo`, `python3` and `java`.
- [ ] Windows: Python installed from python.org is found as `python` or `py`.
- [ ] A machine whose Python is named only `python` is found.
- [ ] Windows: with only the Microsoft Store's `python.exe` stub, the message
      says to install Python 3.

## Publishing

The listing on both marketplaces is the README inside the package, and its
images load from this repository on GitHub.

- [ ] The repository is public. While it is private, the listing's images and
      its links into the repository are broken.
- [ ] `CHANGELOG.md` has an entry for this version.
- [ ] `npm run screenshots` has been run since the drawing's look last changed,
      and the two images match what the viewer draws in an editor.
- [ ] Published to the Visual Studio Marketplace with `vsce publish`, and to
      Open VSX, which Cursor installs from, with `ovsx publish`.
- [ ] On both published pages the README's images show, and its links work.
