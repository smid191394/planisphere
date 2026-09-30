## Context

See proposal.md. The panel is title, comment, member list; the rail on the left
holds the drawing-wide toggles as icons with tooltips.

## Decisions

- **Buttons in the title row, not rows in the list.** The title names the node
  both act on. Rows at the head of the list sit under the comment and move with
  it; the title row does not move, and the name is what gives way when the panel
  is narrow.
- **Drawn icons, one figure in both.** Two symbols from a font come from
  whichever font has them and never match in size or weight. Both icons share a
  node-and-members figure at one size; a ring around it for expanding in place,
  focus corners for drawing it alone.
- **A toggle, not changing words.** Expanding shows its state as pressed, as the
  rail's function toggle does, rather than a label that swaps between two verbs.
- **`E` and `M`, on the focused node.** As `C` acts on the focused node. Neither
  is taken, and neither is a letter a reader types into the drawing.
- **The pending second press is forgotten with the drawing.** Taking a new graph
  already forgets the focus; the node waiting for its second press is part of
  that focus.

## Risks / Trade-offs

- [Icons are less discoverable than words] → Both carry a tooltip naming what
  they do and their key, and the legend lists the keys.
