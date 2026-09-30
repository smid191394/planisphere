## ADDED Requirements

### Requirement: The two ways of reading a type are beside its name, and on a key
Where the panel lists a type's members, the viewer SHALL offer the two ways of reading that type — its members drawn where it stands, and drawn alone — as controls beside the type's name at the head of the panel, and not among the members or under the comment. A control under the comment moves with the comment's length, and a type with a paragraph of documentation would have it out of sight. Each control SHALL be shown only where the way it offers is available for that type, and SHALL say what it does and which key does the same.

The control for drawing members where the type stands SHALL be a toggle: pressed while that type is open, and pressing it again SHALL put the members away.

The viewer SHALL bind a key to each, acting on the focused node as the key that makes a node the centre does: `E` SHALL open the focused type where it stands, or put it away if it is open, and `M` SHALL draw its members alone. Where nothing is focused, or the focused node has nothing to draw, the key SHALL do nothing. Both keys SHALL be named in the legend.

A press SHALL be counted against the drawing it is made on. When the drawing is replaced — leaving a view, entering one, or a new artifact — the first press on a node SHALL focus it, as a first press does, and SHALL NOT open its file as though it were the second.

#### Scenario: Beside the name
- **WHEN** the reader focuses a type whose members record something to draw
- **THEN** the two controls are shown beside its name, and the member list holds only its members

#### Scenario: Nothing to draw
- **WHEN** the reader focuses a node whose members record nothing to draw, or a node that stands for several types
- **THEN** neither control is shown

#### Scenario: The toggle shows what is open
- **WHEN** the reader opens the focused type where it stands
- **THEN** its control is shown pressed, and pressing it again puts the members away

#### Scenario: The keys
- **WHEN** a type is focused and the reader presses `E`, then `E` again
- **THEN** the type opens where it stands, and then closes

#### Scenario: Drawn alone by key
- **WHEN** a type is focused and the reader presses `M`
- **THEN** its members are drawn alone

#### Scenario: The legend names them
- **WHEN** the reader opens the legend
- **THEN** `E` and `M` are listed with the other keys

#### Scenario: Back from a view
- **WHEN** the reader pressed a node once, entered a view, and left it
- **THEN** pressing that node focuses it, and only a second press opens its file
