## Why

Focusing a node shows the comment written above its definition. That rule was
made positional on purpose — it reads the lines above a definition and nothing
else — and it works for Go, Rust and TypeScript, whose writers put their
documentation there.

Python's writers do not. A Python docstring is the first statement *inside* the
definition, and it is where every Python project puts what a class is for.
Measured on the FastAPI fixture: of 116 types, 2 have a comment above them. For
a Python reader the panel is empty on almost every node they click, and
"click a node to read what it is" is the second thing the product promises.

Java's writers do put their documentation above the definition, but they write
it with markup: `{@link JsonNode}`, `<p>`, `<code>`. The panel shows those
verbatim, so jackson-databind's `ObjectMapper` reads as a page of tags.

## What Changes

- **A quoted block that opens a definition is shown** where nothing is written
  above it. This stays positional: what is read is the run of lines from the
  definition down, not a language named by a file's extension.
- **Documentation markup is removed from what is shown**: `{@link X}` and its
  like become `X`, and the small set of tags documentation is written with are
  dropped. The text keeps its lines.
- Neither changes what the artifact holds: the comment is read from the source
  when the reader asks for it, as it is now.

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: `Focusing a node shows the comment above it, or a
  group's members` — what counts as the text to show, when nothing is written
  above the definition, and what markup is removed before it is shown.

## Impact

- `src/leadingComment.ts` and its tests.
- `src/tests/leadingComment.test.ts`, which holds fixture source in several
  languages for exactly this.
- No analyzer, and no change to the artifact.
