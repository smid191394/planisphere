## MODIFIED Requirements

### Requirement: A type can be opened where it stands
Where a focused node records members that record anything of their own — calls between them, or nodes they point at — the viewer SHALL offer to open that node where it stands, and SHALL then draw one node for each of its members' names in the place the type occupies, with the rest of the drawing around them.

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
- **THEN** one node per member name is drawn in the type's place, and the rest of the drawing is still around them

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

## REMOVED Requirements

### Requirement: A type can be opened to show what it is made of
**Reason**: The view of one type alone draws the tree the type's members make, with the type at its centre, which is the tree an open type's members make where it stands. It is stated once, under its own name, beside that one.
**Migration**: None. The view is entered and left the same way and offers the same things; see "A type can be drawn alone, as the tree its members make".

## ADDED Requirements

### Requirement: A type can be drawn alone, as the tree its members make
Where a focused node records members that call one another, the viewer SHALL offer a view of that node alone, and show in it one node for each of its members' names, joined by the calls they record.

The view SHALL be entered from the focused node and left the way the right button's view is left, saying where the reader is and taking them back. What is drawn outside it is untouched: this is a place the reader goes and returns from, not a change to the drawing.

A member's node SHALL carry that member's name, and activating it twice SHALL open the file and line the member records, as activating a node twice opens a node's. Where a name stands for several members — a language that overloads one — the view SHALL draw one node for the name, and opening it SHALL take the reader to the first of them; a list of the rest belongs to a later change, not to a node drawn twice.

The view SHALL draw the node it was opened on at its centre, and its members as the tree they are arranged as when that node is opened where it stands: the way in on the first level out — a member that no member of that node calls — and what each member calls beyond it. It is the same tree in both places, alone here and with the project around it there, so a reader learns one shape.

The way in is what the tree grows from. Measured on sqlparser-ranger's `Parser`, whose 69 members make 342 calls, the member with the most calls to it is `eat`, a one-line helper every rule uses, and grown from there the grammar the parser follows sits behind it; grown from `sql_stmt_list`, which nothing calls, the same members read as the rules it parses. Where several members are ways in, the criterion that chooses every other centre SHALL choose among them. Where there is none — every member is called by another — the view SHALL fall back to that criterion over all of them rather than refusing to open.

The offer SHALL NOT be made where there is nothing to show: a node whose members record no calls between them has a list, which the panel already gives.

#### Scenario: Opening a type that is made of its members
- **WHEN** the reader focuses a node whose members call one another and asks for what it is made of
- **THEN** the view opens, holding one node per member name and the calls between them

#### Scenario: The node is the centre
- **WHEN** the view opens on a node
- **THEN** that node is the centre, and its members are arranged around it

#### Scenario: The way in is next to the node
- **WHEN** the view opens on a node whose members include one that no other member calls
- **THEN** that member is on the first level out from the node, and what it calls lies beyond it

#### Scenario: Several ways in
- **WHEN** more than one member is called by none
- **THEN** the way in is chosen among them by the criterion that chooses a drawing's centre

#### Scenario: No way in
- **WHEN** every member of the node is called by another
- **THEN** the view still opens, its way in chosen by that same criterion over all of them

#### Scenario: Leaving the view
- **WHEN** the reader leaves the view
- **THEN** the drawing is as it was before they entered, and the strip that says where they are is gone

#### Scenario: A member opens its source
- **WHEN** the reader activates a member's node twice
- **THEN** the file and line that member records are opened

#### Scenario: A name that several members share
- **WHEN** the node declares several members under one name
- **THEN** the view draws that name once

#### Scenario: Nothing to show
- **WHEN** the focused node's members record no calls between them
- **THEN** the view is not offered, and the panel's list is what the reader has

### Requirement: An open type's members are arranged as a tree, and the drawing makes room for it
The viewer SHALL arrange an open type's members as a tree rooted on the type: the way in hangs off the type, the members it calls hang off it, and so on outward. A member no chain of calls reaches SHALL hang off the type beside the way in.

The way in SHALL be chosen as it is for the view of one type alone: a member that no member of that type calls; where there are several, the criterion that chooses a drawing's centre chooses among them; where there is none, that criterion over all of them.

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
