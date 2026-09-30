## MODIFIED Requirements

### Requirement: A node may record the members that belong to it
A node MAY record the members declared inside it or against it — a method, and nothing else until a language asks for more. Each member SHALL carry its own name, the absolute path of the file it is declared in, and the line its name is declared on, so that a consumer can reach it in the source.

A member SHALL NOT also be a node, where being the same means being declared in the same place — the same file and the same line — and not merely sharing a name. Go puts a method and a package-level function of one name in one file: cobra declares `Command.MarkFlagRequired` and `MarkFlagRequired` side by side, and there are 99 such pairs across the four Go projects. Those are two declarations, and a document recording both is correct. Members do not relax the rule that only top-level symbols become nodes: they are what a node says about what it contains, not a way to carry more of them. Taken as nodes, Go's methods collide 2,376 times across the standard library, which is why they are their receiver's.

A member MAY record the members of its own node that it calls, by name. That is what a type is made of: sqlparser-ranger's parser follows SQLite's railroad diagrams, one method per rule named after the rule, and the 342 calls between its 69 methods are the grammar. Recorded against the node instead, as they are when a member's body is attributed to what owns it, they become a self-loop and are dropped — the artifact holds none of them.

What is recorded as a call SHALL be names, and names of that node's own members only. Names, because that is what a reader of the source sees written; a name may stand for several members where a language overloads one — jackson-databind's `ObjectMapper` declares 172 members under 68 names, `readValue` 31 times — and a consumer reads the call as reaching the name. That node's own, because a name written inside one type means that type's member and nothing further; what a member's body names outside its node is a node anywhere in the project, and is recorded as such.

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
- **THEN** the calling member records no call for it, and the node keeps the edge it has

#### Scenario: One name, however many overloads
- **WHEN** a member calls a name the node declares several members under
- **THEN** the name is recorded once, standing for all of them

#### Scenario: Called twice, recorded once
- **WHEN** a member calls another member twice in its body
- **THEN** the name is recorded once

#### Scenario: A member that calls nothing of its own node
- **WHEN** a member's body calls no member of the node it belongs to
- **THEN** it records no calls, and the document is valid

## ADDED Requirements

### Requirement: A member may record what its body names outside its own node
A member MAY record the nodes its body names, each one by that node's id. That is what tells a reader which method a type's line came from: `Parser` points at `Scanner` because one of its 69 methods calls one of `Scanner`'s, and the type alone cannot say which.

What a member records SHALL be a target its own node already has an edge to: for each one there SHALL be an edge in the document from the member's node to that target. A member says which of its node's edges came from it. It does not add one, and a consumer that reads edges reads the same edges whether members record this or not. A type's edges are not all from method bodies — a field's type, a signature, a supertype — so they are not recoverable from its members.

An id alone SHALL be what is recorded, the kind being the node's own edge's: the document carries at most one edge for any ordered pair of nodes, so naming the target names the edge.

A target SHALL be recorded once per member, however often the body names it.

A member SHALL NOT record its own node. A node has no edge to itself, so there is nothing for such a record to name.

A member SHALL NOT record which member of another node it reaches. Only a node has an identity the document can point at; a member is named within the node that records it, and nowhere else.

Recording this is optional, and a consumer MUST NOT require it. A member that records none is a member whose body names nothing outside its node, or one an analyzer records nothing for, and both read the same way.

#### Scenario: A member records the node it names
- **WHEN** a member's body names another node, and that name is attributed to the member's node as an edge
- **THEN** the member records that node's id

#### Scenario: What a member records is an edge its node has
- **WHEN** a member records a target
- **THEN** the document holds an edge from the member's node to that target

#### Scenario: Named twice, recorded once
- **WHEN** a member's body names one node twice
- **THEN** the member records it once

#### Scenario: A member naming its own node
- **WHEN** a member's body names the node it belongs to
- **THEN** the member records nothing for it

#### Scenario: A member that names nothing outside
- **WHEN** a member's body names no node but its own
- **THEN** it records nothing, and the document is valid

#### Scenario: A document whose members record none
- **WHEN** an analyzer records nothing of what members point at
- **THEN** the document is valid and every consumer reads it the same way
