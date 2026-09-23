## REMOVED Requirements

### Requirement: Focusing a node shows the comment above it, or a group's members

Replaced by the requirement below. Its rule was that what is shown is the run of
comment lines above a definition and nothing else, which leaves the panel empty
on almost every node of a Python project and shows Java's documentation with its
markup intact.

## ADDED Requirements

### Requirement: Focusing a node shows what was written about it, or a group's members
While a class or function node is the focus node, the viewer SHALL show what was written about it, beside the drawing: the comment immediately above its definition, or, where there is none, the quoted block that opens it.

What counts is positional and deliberately narrow: the unbroken run of comment lines directly above the definition line, with any decorator or attribute lines among them stepped over. A comment separated from the definition by a blank line or by other code is not above it, a comment on the definition's own line is not above it, and text inside the definition is not above it. None of those is shown.

A comment line SHALL be recognised by its marker, and the markers SHALL be every one the languages read here use: `#`, `//`, and a `/* … */` block whose closing marker is on the line directly above the definition or in the run above it. Within a block, a leading `*` on a continuation line SHALL be removed with the marker, which is how a documentation comment is written. A Rust documentation comment SHALL have its whole marker removed: `///`, followed by a space or ending the line, is a marker as `//` is, and removing only two of the three slashes would leave a `/` at the start of 2,108 of the Rust fixtures' comments. A run of slashes used as a banner — `////////`, `//// Types` — is not that marker and SHALL be read by the `//` rule alone: TypeScript's fixtures write 476 lines beginning `///` above definitions, and the Rust marker applies to only one of them.

A Rust attribute — a line that is `#[…]` or `#![…]`, or one written over several lines from a `#[` to its closing `]` — SHALL be stepped over as a decorator is, wherever it sits in the run above a definition. Read by its first character it is Python's comment marker, and 2,536 of the Rust fixtures' nodes have `#[derive(Debug)]` or its like above their definition. A line counts as an attribute only when it is one whole: a Python comment such as `#[69,99] is in the century 1900` does not close its bracket at the end of the line, and stays a comment.

`#` alone would cover only Python: 1,728 of Angular's nodes, 1,639 of hugo's and 1,892 of prometheus's have a comment directly above the definition, none of them written with `#`, against Python's 197.

Where the rule cannot tell what a line is, it SHALL show less rather than something that is not the definition's comment. It is a positional reading, not a parser, and a panel showing another item's text or the tail of an example misleads where an empty panel does not.

A line that begins with a line-comment marker SHALL be read as a line comment whatever it ends with. Read by its end, `///     /* handle the message */` inside an example would close a block that was never opened and stop the walk there, showing the last lines of an example instead of the documentation. 19 Rust nodes and members carry such a line, tokio's `pipe::Receiver` among them.

A module's own documentation — `//!`, or a block opened by `/*!` — SHALL end the run rather than be shown: it describes the module it is written in, and where it touches the first definition it is not that definition's comment. In the Rust fixtures 5 nodes sit directly under their file's documentation, sqlparser-ranger's `TokenKind` among them.

Which markers count SHALL NOT be decided by the file's name. The artifact records no language, so the viewer does not know one, and an extension list kept beside the analyzers is one more place to go out of step — one missing extension is enough to tell a package written in `.mts` that it holds no analyzable source.

The text SHALL be what the file says when it is asked for, not a copy taken when the graph was analyzed. Where the file is open in an editor with unsaved changes, those are what is shown. Where the file cannot be read, nothing is shown; the viewer MUST remain usable, since the drawing does not depend on the source being present.

Where nothing is written above the definition, the viewer SHALL show a quoted block that opens it: the run of lines from the line below the definition, where the first of them begins with a quote marker, up to and including the line that closes it. This stays a positional reading — what is read is where it sits, not what language the file is in — and it is where a whole language writes what a class is for. Measured over the Python corpus, the share of a project's types the panel has something for goes from almost none to between a third and nine tenths: requests 89%, flask 85%, scrapy 53%, pydantic 46%, django 34%, FastAPI 29%, against 2 of FastAPI's 116 before. What is left is projects that document their functions and not their types.

The quote markers SHALL be removed with the same hand the comment markers are removed with, and a block that opens and closes on one line SHALL be shown as that one line. Where the run above the definition holds a comment, that comment is what is shown and the body is not read at all: what a writer put above the definition is what they meant the reader to find first.

Documentation markup SHALL be removed before the text is shown. A braced tag such as `{@link Thing}` SHALL be shown as `Thing`, and the handful of tags a paragraph is marked up with SHALL be dropped: they are punctuation for a generator, not for a reader looking at a drawing, and jackson-databind's `ObjectMapper` carries eleven of them. The text SHALL keep its own lines: removing markup MUST NOT reflow it.

Nothing SHALL be shown when there is no such comment — not an empty panel, and not the previous node's comment.

The panel SHALL scroll under the wheel when it holds more than it has room for, and a wheel over it MUST NOT zoom the drawing. The drawing's wheel handler runs first for everything inside the viewer, and left to it these events, like the legend's and the settings panel's, would zoom the drawing: a type listing its members — sqlparser-ranger's `Parser` has 69 — could not be read past the panel's height. Where the panel is hidden, the wheel over that corner is the drawing's.

A node that records members SHALL have them listed in that same panel, each one activatable, beside whatever comment the node itself has. A method is not a node and can be reached no other way, and it is what a Go reader looks for first: prometheus records 4,429 of them over 699 types, among them 36 methods named `Append`, 86 named `Close`, 28 named `Run` and 5 named `Start`.

Search SHALL match a member's name as it matches a node's, and choosing one SHALL take the reader to the node that records it, with that member marked in this list and the list scrolled to it. A type may record scores of members — sqlparser-ranger's `Parser` records 69 — and a reader taken to the type without being shown which row was found has been given a haystack. A node that records no members is shown with its comment alone.

A group has as many comments as it has members and no reason to prefer one, so no comment is shown for it. The same panel SHALL show the group's members instead — where each one is, so the reader can tell what the count is made of — and each listed member SHALL be activatable. Since a member is never drawn as a node, this list is the only route from the drawing to any one of them.

#### Scenario: The comment above a definition is shown
- **WHEN** the user focuses a class or function whose definition is directly preceded by comment lines
- **THEN** those lines are shown beside the drawing, with their comment markers removed, in the order they appear in the file

#### Scenario: A decorated definition still finds its comment
- **WHEN** the focused node's definition is preceded by decorators, and comment lines sit above those
- **THEN** those comment lines are shown

#### Scenario: A detached comment is not shown
- **WHEN** the focused node's definition is preceded by a blank line, or by other code, above which there are comments
- **THEN** nothing is shown

#### Scenario: A trailing comment is not shown
- **WHEN** the focused node's definition line carries a comment after the code on that same line
- **THEN** nothing is shown

#### Scenario: A quoted block that opens the definition is shown
- **WHEN** the focused node has a quoted block as the first thing in its body and nothing written above its definition
- **THEN** that block is shown, without its quote markers

#### Scenario: What is above the definition wins
- **WHEN** the focused node has both a comment above its definition and a quoted block opening its body
- **THEN** the comment above it is what is shown

#### Scenario: A one-line quoted block
- **WHEN** the block opening the definition begins and ends on one line
- **THEN** that line is shown, without its markers

#### Scenario: A quoted block that does not open the definition
- **WHEN** the definition's body begins with code, and a quoted block appears after it
- **THEN** nothing is shown

#### Scenario: A braced tag is shown as what it names
- **WHEN** the comment holds `{@link Thing}`
- **THEN** `Thing` is shown, and the braces and the tag are not

#### Scenario: Paragraph markup is dropped
- **WHEN** the comment holds the tags a documentation paragraph is marked up with
- **THEN** they are not shown, and the text keeps the lines it was written on

#### Scenario: The listed members are the only way to reach one
- **WHEN** the reader wants the source of one class a group stands for
- **THEN** the list beside the drawing is where they find it, that member never appearing as a node

#### Scenario: A focused group lists its members
- **WHEN** the user focuses a collapsed group
- **THEN** the panel shows where the group's members are rather than any comment, and each is activatable

#### Scenario: Nothing to show leaves nothing behind
- **WHEN** the user focuses a node with a comment and then focuses one without
- **THEN** the first node's comment is no longer shown

#### Scenario: Losing focus clears it
- **WHEN** the focus is cleared
- **THEN** nothing is shown

#### Scenario: The source being unreadable is not a failure
- **WHEN** the focused node's file cannot be read
- **THEN** nothing is shown, no error interrupts the reader, and the drawing continues to work

#### Scenario: The panel and the legend share one corner
- **WHEN** the legend is open and a comment is to be shown, or the reverse
- **THEN** only one of them is visible at a time

#### Scenario: A focused type lists its methods
- **WHEN** the user focuses a type whose node records members
- **THEN** the panel lists them beside the drawing, each activatable, together with the type's own comment if it has one

#### Scenario: A member is reachable only from the list
- **WHEN** the reader wants the source of one method
- **THEN** the list beside the drawing is where they find it, that method never appearing as a node

#### Scenario: The member the search found is marked
- **WHEN** the reader is taken to a node by choosing one of its members
- **THEN** that member's row is marked in the list and the list is scrolled to it

#### Scenario: Search finds a member
- **WHEN** the reader types a method's name
- **THEN** that member is offered, and choosing it takes them to it

#### Scenario: A node with no members shows its comment alone
- **WHEN** the user focuses a node whose artifact records no members
- **THEN** the panel shows the comment above its definition, with no member list

#### Scenario: A comment written with slashes is shown
- **WHEN** the focused node's definition is directly preceded by lines beginning `//`
- **THEN** those lines are shown, with the marker removed

#### Scenario: A block comment above a definition is shown
- **WHEN** the focused node's definition is directly preceded by a `/* … */` block
- **THEN** its lines are shown, with the markers and any leading `*` removed

#### Scenario: A detached comment in any language is not shown
- **WHEN** a `//` comment is separated from the definition by a blank line
- **THEN** nothing is shown

#### Scenario: A Rust documentation comment is shown without its marker
- **WHEN** the focused node's definition is directly preceded by lines beginning `///`
- **THEN** those lines are shown with all three slashes removed

#### Scenario: A banner of slashes is read by the `//` rule
- **WHEN** a line above a definition is `////////` or `//// Types`
- **THEN** it is read by the `//` rule alone, not as a Rust documentation comment

#### Scenario: An attribute is not documentation
- **WHEN** a `///` comment sits above `#[derive(Debug)]`, which sits above the definition
- **THEN** the comment is shown, and the attribute is not

#### Scenario: An attribute written over several lines
- **WHEN** an attribute opened by `#[` closes on a later line directly above the definition, and a comment sits above it
- **THEN** the comment is shown, and no line of the attribute is

#### Scenario: A Python comment that begins with a bracket
- **WHEN** a Python comment line begins `#[` and does not end with `]`
- **THEN** it is shown as a comment

#### Scenario: A long panel scrolls, and the drawing does not zoom
- **WHEN** the panel is shown and the reader turns the wheel over it
- **THEN** the drawing's zoom is unchanged, the wheel being left to the panel

#### Scenario: The wheel over the drawing still zooms while the panel is open
- **WHEN** the panel is shown and the reader turns the wheel over the drawing
- **THEN** the drawing zooms

#### Scenario: An example ending in a block marker does not cut the comment short
- **WHEN** a `///` line inside a comment's example ends with `*/`
- **THEN** the whole comment is shown from its first line, that line included

#### Scenario: A module's documentation is not the first item's
- **WHEN** `//!` lines sit directly above a definition, with no blank line between
- **THEN** they are not shown for it, and a `///` comment between them and the definition still is

#### Scenario: The file's name decides nothing
- **WHEN** the same comment and definition are read from files with different extensions
- **THEN** the same lines are shown for each
