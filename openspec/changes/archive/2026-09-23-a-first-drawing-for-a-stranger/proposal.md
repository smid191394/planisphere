## Why

Someone who has just installed Planisphere has no drawing. To get one they must
open a project of one of five languages, find the command, and wait for an
analysis — and for three of the five languages they must first have the
toolchain. The two places where that goes wrong say so and stop:

- with no folder open: "Planisphere: open a folder first."
- with a folder holding no analyzable source: "Planisphere found no analyzable
  source under X."

A reader who meets either of those has installed a drawing tool and seen no
drawing. The second one is what a reader with a C, Ruby or PHP project meets,
and for them it is the whole first impression.

The empty drawing says something wrong on top of that: "No Python symbols found
in this graph", in a product that reads five languages.

## What Changes

- **A sample project ships with the extension**, and where the command can do
  nothing it offers to draw it. Both messages gain a button; pressing it
  analyses the sample and opens the drawing.
- **The sample is TypeScript**, so it needs no toolchain at all: the compiler
  ships with the extension and runs on the editor's own Node. The drawing is
  made on the reader's machine, so its paths are theirs and clicking a node
  opens the file, as it does for their own projects.
- **The empty drawing stops naming Python.**

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: a new requirement that a reader with nothing of
  their own to draw is offered one, and that what the viewer says about an
  empty drawing names no language.

## Impact

- `src/extension.ts`: the two messages, and what a button does.
- A `sample/` directory that ships with the extension, and `.vscodeignore`.
- `media/graph.js` or `src/graphDocument.ts`: the empty-drawing line.
- The packaging suite, which states what ships.
