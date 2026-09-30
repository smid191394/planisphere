## ADDED Requirements

### Requirement: A member's place says how near the way in it is, not whose it is
A member of an open type SHALL be placed at the fewest calls it is from the way in: a member the way in calls is on the level after it, a member only those call on the level after that, and so on. Calls between members are a graph and a member called from several places has no one owner, so a place in the tree SHALL NOT be taken to say which member it belongs to, and every member that calls it SHALL be joined to it by a line.

Among the callers equally near the way in, the one a member is placed beside SHALL be chosen by a fixed order, so that the same artifact is drawn the same way every time. The choice claims nothing: `expr` is called by 23 of sqlparser-ranger's `Parser`'s rules, and whichever of them it is drawn beside, the other twenty-two lines are drawn.

The shortest distance is chosen over the longest, and what it costs is accepted: a member called from everywhere is drawn near the way in, because that is how near it is. The longest distance would put every member below everything that calls it, at the price of the whole tree — `Parser` sixteen levels deep instead of six — and of breaking recursion at a point the code does not choose. It is also the rule the type tree follows, so the drawing has one meaning of depth.

The placement SHALL NOT read a project's habits: no share of callers that sets a member apart, no preference among callers by name. Those work for one project and not for the next.

#### Scenario: A member called from several places
- **WHEN** a member of an open type is called by several members at different distances from the way in
- **THEN** it is placed one level beyond the nearest of them, and a line joins it to every one of them

#### Scenario: Callers equally near
- **WHEN** a member is called by two members on the same level
- **THEN** it is placed beside one of them, chosen by a fixed order, and the same artifact places it beside the same one every time
