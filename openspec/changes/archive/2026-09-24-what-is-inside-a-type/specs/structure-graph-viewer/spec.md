## ADDED Requirements

### Requirement: A type can be opened to show what it is made of
Where a focused node records members that call one another, the viewer SHALL offer a view of that node alone, and show in it one node for each of its members' names, joined by the calls they record.

The view SHALL be entered from the focused node and left the way the right button's view is left, saying where the reader is and taking them back. What is drawn outside it is untouched: this is a place the reader goes and returns from, not a change to the drawing.

A member's node SHALL carry that member's name, and activating it twice SHALL open the file and line the member records, as activating a node twice opens a node's. Where a name stands for several members — a language that overloads one — the view SHALL draw one node for the name, and opening it SHALL take the reader to the first of them; a list of the rest belongs to a later change, not to a node drawn twice.

The view SHALL be centred on a way in: a member that no member of that node calls. Measured on sqlparser-ranger's `Parser`, whose 69 members make 342 calls, the member with the most calls to it is `eat`, a one-line helper every rule uses, and centred there the grammar the parser follows sits behind it; centred on `sql_stmt_list`, which nothing calls, the same drawing reads as the rules it parses. Where several members are ways in, the criterion that chooses every other centre SHALL choose among them. Where there is none — every member is called by another — the view SHALL fall back to that criterion over all of them rather than refusing to open.

The offer SHALL NOT be made where there is nothing to show: a node whose members record no calls between them has a list, which the panel already gives.

#### Scenario: Opening a type that is made of its members
- **WHEN** the reader focuses a node whose members call one another and asks for what it is made of
- **THEN** the view opens, holding one node per member name and the calls between them

#### Scenario: The way in is the centre
- **WHEN** the view opens on a node whose members include one that no other member calls
- **THEN** that member is the centre

#### Scenario: Several ways in
- **WHEN** more than one member is called by none
- **THEN** the centre is chosen among them by the criterion that chooses a drawing's centre

#### Scenario: No way in
- **WHEN** every member of the node is called by another
- **THEN** the view still opens, centred by that same criterion over all of them

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
