## Why

The two ways of reading a type — its members drawn where it stands, and drawn
alone — are offered in the panel, and where in the panel decides whether a
reader finds them. Under the type's comment they move with the comment's
length: a type with a paragraph of documentation has them below the fold. And a
reader who has already chosen the node with the mouse should not have to go to
the panel at all, as they do not for making it the centre.

## What Changes

- **Beside the type's name.** The two ways are two buttons at the right of the
  panel's title, where they act on the thing named and take no height. Expanding
  is a toggle, pressed while the type is open.
- **On a key.** `E` expands the focused type's members where it stands, or puts
  them away; `M` draws them alone. Both are named in the legend with the other
  keys.
- **Coming back is a fresh start.** After leaving a view, the first press on a
  node focuses it, as a first press does, rather than opening its file.

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: where the two ways of reading a type are offered,
  the keys that reach them, and what a press means after a view is left.

## Impact

- The viewer's panel, its keys and its legend; the layout suite.
