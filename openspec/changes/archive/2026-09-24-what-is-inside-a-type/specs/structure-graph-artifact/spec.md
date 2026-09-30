## MODIFIED Requirements

### Requirement: A node may record the members that belong to it
A node MAY record the members declared inside it or against it — a method, and nothing else until a language asks for more. Each member SHALL carry its own name, the absolute path of the file it is declared in, and the line its name is declared on, so that a consumer can reach it in the source.

A member SHALL NOT also be a node, where being the same means being declared in the same place — the same file and the same line — and not merely sharing a name. Go puts a method and a package-level function of one name in one file: cobra declares `Command.MarkFlagRequired` and `MarkFlagRequired` side by side, and there are 99 such pairs across the four Go projects. Those are two declarations, and a document recording both is correct. Members do not relax the rule that only top-level symbols become nodes: they are what a node says about what it contains, not a way to carry more of them. Taken as nodes, Go's methods collide 2,376 times across the standard library, which is why they are their receiver's.

A member MAY record the members of its own node that it calls, by name. That is what a type is made of: sqlparser-ranger's parser follows SQLite's railroad diagrams, one method per rule named after the rule, and the 342 calls between its 69 methods are the grammar. Recorded against the node instead, as they are when a member's body is attributed to what owns it, they become a self-loop and are dropped — the artifact holds none of them.

What is recorded SHALL be names, and names of that node's own members only. Names, because that is what a reader of the source sees written; a name may stand for several members where a language overloads one — jackson-databind's `ObjectMapper` declares 172 members under 68 names, `readValue` 31 times — and a consumer reads the call as reaching the name. That node's own, because a call reaching out of the node is what the node itself points at, and the document already says so: recording it twice, once for the node and once for the member, is a second place for it to go out of date.

A call SHALL be recorded once however often it is written. How many times one method calls another is a fact about a body, not about a structure.

A member's file MAY differ from its node's. Go declares a method at the top level of any file in the package, and 2% of the drawn files in hugo hold nothing but methods of a type declared elsewhere.

Recording members is optional, and a consumer MUST NOT require them. A language whose members the analyzer does not record, or which has none, produces a document with none, and every consumer reads it the same way.

#### Scenario: A member names where it is
- **WHEN** a node records a member
- **THEN** that member carries a name, an absolute file path and the line its name is declared on

#### Scenario: A member is not a node
- **WHEN** an artifact records members
- **THEN** no member is declared at the same file and line as a node in the same document

#### Scenario: A member sharing a node's name
- **WHEN** a method and a top-level symbol of the same name are declared in one file
- **THEN** both are recorded, the member against its receiver and the symbol as a node

#### Scenario: A member declared in another file
- **WHEN** a type's method is declared in a different file from the type
- **THEN** the member records the file it is declared in, not the file its node is in

#### Scenario: An artifact that records none
- **WHEN** an analyzer records no members
- **THEN** the document is valid and every consumer reads it as a document without members

#### Scenario: A member records what it calls
- **WHEN** a member's body calls another member of the same node
- **THEN** that member records the called member's name

#### Scenario: A call out of the node is the node's
- **WHEN** a member's body calls a member of another node
- **THEN** the calling member records nothing for it, and the node keeps the edge it has today

#### Scenario: One name, however many overloads
- **WHEN** a member calls a name the node declares several members under
- **THEN** the name is recorded once, standing for all of them

#### Scenario: Called twice, recorded once
- **WHEN** a member calls another member twice in its body
- **THEN** the name is recorded once

#### Scenario: A member that calls nothing of its own node
- **WHEN** a member's body calls no member of the node it belongs to
- **THEN** it records no calls, and the document is valid
