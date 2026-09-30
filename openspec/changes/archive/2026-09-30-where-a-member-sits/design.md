## Context

See proposal.md. The tree is built breadth first from the way in, and among
callers equally near, the first by id is the parent.

## Decisions

### Shortest distance, not longest

Measured on four types:

| | shortest (kept) | longest |
| --- | --- | --- |
| sqlparser-ranger `Parser` | 6 levels | 16 levels |
| `eat`, `expect` | level 2 | level 14 |
| gin `Context` | 3 levels | 5 levels |
| jackson-databind `ObjectMapper` | 3 levels | 4 levels |

The longest distance is the purer top-down reading — everything a rule uses is
below it — and its cost is the whole tree: sixteen levels where six hold the
same members, and, to compute it at all, recursion (`expr` calling `primary`
calling `select_stmt` calling `expr`) has to be broken at a point the code does
not choose. The shortest distance costs locally: only a member called from many
places is drawn nearer than its role suggests. It is also the rule the type tree
already uses, so the drawing has one meaning of depth.

### No placement that reads the project

Rules that would put `expr` somewhere better — a member called by more than some
share of the type set apart, a shared member placed beside the caller whose name
is nearest its own — work for one project's habits and not for the next. The
parent among equally near callers stays a fixed order, which is arbitrary and
says so.
