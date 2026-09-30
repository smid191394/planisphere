## Why

A type's members are drawn as a tree, and calls between members are a graph: a
rule the grammar uses in twenty places is called from twenty places. Drawn as a
tree, every member has one place, and a reader takes the place for ownership.
Opened, sqlparser-ranger's `Parser` puts `expr` — called by 23 of its rules —
beside `alter_table_stmt`, and a reader who has not seen the code concludes that
expressions belong to ALTER TABLE.

No placement fixes this: a node called from several places has several
equally good parents or none. What can be fixed is what the drawing claims. The
depth rule and what it trades away are chosen, not accidental, and neither is
written down.

## What Changes

- **A member's place means how few calls it is from the way in, and nothing
  about whose it is.** Among callers equally near, the one it is drawn beside is
  chosen by a fixed order, so the same artifact is drawn the same way, and that
  choice claims nothing. Every member that calls it is joined to it by a line.
- **The depth is the shortest distance, and the cost is stated**: a member
  called from everywhere is drawn near the way in, because that is how near it
  is. The longest distance would put every member below everything that calls
  it and make `Parser` sixteen levels deep instead of six.
- The README says what a place means.

## Capabilities

### Modified Capabilities

- `structure-graph-viewer`: what a member's place in its type's tree means, and
  the rule that places it.

## Impact

- The viewer spec and the README. The layout already behaves this way; the
  layout suite gains the scenarios.
