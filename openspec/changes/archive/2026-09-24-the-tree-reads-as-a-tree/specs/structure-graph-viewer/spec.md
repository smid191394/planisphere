## MODIFIED Requirements

### Requirement: An open type's members are arranged as a tree, and the drawing makes room for it
The viewer SHALL arrange an open type's members as a tree rooted on the type: the way in hangs off the type, the members it calls hang off it, and so on outward. A member no chain of calls reaches SHALL hang off the type beside the way in.

The way in SHALL be chosen as it is for the view of one type alone: a member that no member of that type calls; where there are several, the criterion that chooses a drawing's centre chooses among them; where there is none, that criterion over all of them.

The type SHALL be drawn joined to the first level of its tree and to nothing further out; a member further out SHALL be joined to the members that call it. Every member belongs to its type, and the layout knows it, but drawn, those joins are a line from the type to every member — sixty-nine out of `Parser` — and the tree is under them.

A member whose subtree holds more than half of the tree SHALL be drawn beside the type rather than on the first level, and the members it calls SHALL make the first level around both. A tree drawn round a centre puts each node in the middle of its slice, and the middle of a slice wider than half the circle is on the far side from half of what it holds: `sql_stmt_list`, which reaches 63 of `Parser`'s 69 members, would sit at one edge of the drawing with every line out of it crossing to the other.

That is what a reader opens a type for. Seated in a circle instead, sqlparser-ranger's `Parser` shows its 69 rules in the order their ids sort, with the calls between them drawn as chords across the circle — the same lines, saying nothing about which rule contains which.

The viewer SHALL make room for that tree by moving what is around the type outward. Each node SHALL keep its direction from the opened type and SHALL move further the nearer it is, by an amount that reaches zero at a bounded multiple of the room the tree needs. Two nodes SHALL NOT change places with one another: what was nearer the opened type stays nearer, and what was on one side stays on that side. Beyond that multiple nothing SHALL move, so that a reader who knows where something sits still finds it there.

An open type's own members SHALL NOT be moved by the room made for them.

Closing a type SHALL give back the positions the drawing had before it was opened.

#### Scenario: The members are arranged by what they call
- **WHEN** a type is open and one of its members calls another
- **THEN** the called member is placed further from the type than the member that calls it

#### Scenario: The way in is next to the type
- **WHEN** a type whose members include one that no member calls is opened
- **THEN** that member is placed on the first level out from the type

#### Scenario: A member nothing reaches
- **WHEN** an open type has a member that no chain of calls from the way in reaches
- **THEN** it is placed on the first level out from the type as well

#### Scenario: Room is made
- **WHEN** a type is opened
- **THEN** no node that is not one of its members stands within the room its member tree takes

#### Scenario: Directions are kept
- **WHEN** a type is opened
- **THEN** every other node lies in the same direction from that type as it did before

#### Scenario: Nothing changes places
- **WHEN** a type is opened
- **THEN** for any two nodes in the same direction from it, the nearer one is still the nearer one

#### Scenario: The far drawing stays put
- **WHEN** a type is opened
- **THEN** a node far enough from it is exactly where it was

#### Scenario: Closing gives the space back
- **WHEN** an open type is closed
- **THEN** every node is where it was before it was opened

#### Scenario: The type is joined to its first level
- **WHEN** a type is open
- **THEN** a line runs from the type to each member on the first level of its tree, and to no member further out

#### Scenario: A member further out is joined to what calls it
- **WHEN** a member of an open type is beyond the first level
- **THEN** the line that reaches it comes from a member that calls it

#### Scenario: One member holds most of the tree
- **WHEN** one member's subtree holds more than half of an open type's members
- **THEN** that member is drawn beside the type, and what it calls is on the first level around them

#### Scenario: No member holds most of it
- **WHEN** no member's subtree holds more than half of an open type's members
- **THEN** every way in is on the first level, each in its own slice
