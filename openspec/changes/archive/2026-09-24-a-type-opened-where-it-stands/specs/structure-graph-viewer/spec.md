## ADDED Requirements

### Requirement: A type can be opened where it stands
Where a focused node records members that record anything of their own — calls between them, or nodes they point at — the viewer SHALL offer to open that node where it stands, and SHALL then draw one node for each of its members' names in the place the type occupies, with the rest of the drawing unchanged around them.

The type's own node SHALL stay, and everything that points at it SHALL keep pointing at it. A member is not something another node points at, and a type that disappeared when opened would take every line into it off the drawing.

While a type is open, the viewer SHALL draw:

- a line from a member to each member of the same type it calls;
- a line from a member to each node it records as pointing at, drawn as the type's own edge to that node is drawn;
- the type's own outgoing edges from the members that record them, and from the type itself where no member does — a field's type, a signature, a supertype.

That is what a reader opens a type for: `Parser` points at `Scanner`, and the line now starts at the method that names it.

A member drawn this way SHALL carry that member's name, and activating it twice SHALL open the file and line the member records. Where a name stands for several members, the viewer SHALL draw one node for the name and open the first of them.

A member drawn this way SHALL NOT be hidden by the control that hides functions. That control answers whether the reader wants the project's functions drawn; a member is on screen because the reader opened the type that holds it.

Any number of types MAY be open at once, and each SHALL be drawn the same way. Two types opened together are how a reader sees how they interlock.

The reader SHALL be able to close an opened type and get the drawing back as it was. Where the viewer closes one thing at a time, an opened type SHALL be closed after the views that cover the drawing, most recently opened first, so that a reader who opened three types closes them one at a time rather than losing all of them at once.

The offer SHALL NOT be made for a node that stands for several types, there being no single type to open, nor where the node's members record nothing between them and nothing outside.

#### Scenario: Opening a type in place
- **WHEN** the reader focuses a node whose members record calls or targets and asks to open it where it stands
- **THEN** one node per member name is drawn in the type's place, and the rest of the drawing is unchanged

#### Scenario: The type is still there
- **WHEN** a type is open and another node points at it
- **THEN** that line still runs to the type's own node

#### Scenario: A line that comes from a method
- **WHEN** a member of an open type records a node it points at
- **THEN** a line is drawn from that member to that node

#### Scenario: A line no member accounts for
- **WHEN** an open type has an outgoing edge that none of its drawn members records
- **THEN** that line is drawn from the type itself

#### Scenario: The calls inside the type
- **WHEN** a member of an open type calls another member of it
- **THEN** a line is drawn between those two members

#### Scenario: A member opens its source
- **WHEN** the reader activates a drawn member twice
- **THEN** the file and line that member records are opened

#### Scenario: Functions hidden, members drawn
- **WHEN** a type is open and the reader has the project's functions hidden
- **THEN** the type's members stay on the drawing

#### Scenario: Two types open at once
- **WHEN** the reader opens a second type while one is open
- **THEN** both are drawn with their members, and neither closes the other

#### Scenario: Closing gives the drawing back
- **WHEN** the reader closes an open type
- **THEN** its members are gone, the type's own edges are drawn from the type again, and the drawing is as it was

#### Scenario: Closing one at a time
- **WHEN** the reader has opened more than one type and closes with the key that leaves a view
- **THEN** the most recently opened type closes, and the others stay open

#### Scenario: A folded group is not opened
- **WHEN** the focused node stands for several types
- **THEN** the offer is not made

#### Scenario: Nothing to show
- **WHEN** a node's members record no calls between them and no nodes they point at
- **THEN** the offer is not made, and the panel's list is what the reader has
