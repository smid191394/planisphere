## MODIFIED Requirements

### Requirement: An impl block's functions belong to the type
A function declared inside an `impl` block SHALL NOT become a node. It SHALL be recorded as a member of the node for the type the block implements, carrying its own name, the absolute path of the file it is declared in, and the line its name is declared on.

An `impl` block need not sit in its type's file, and often does not: measured by name over what the analyzer walks, 11% of the standard library's impls are written elsewhere and 88% of one small crate's. A member therefore records where it is, not where its type is.

A function declared in a trait's own body SHALL be recorded as a member of that trait, whether it is a signature alone or carries a default body. It is the same argument the impl case makes: it is reachable in the source, nothing else in the document names it, and a reader looking at a trait is looking for its methods. A default body is code a reader jumps to; a signature is the declaration they are looking for.

What an impl's body names SHALL be attributed to the type the block implements, as a Go method's uses are its receiver's.

Where the implemented type is not a node — `impl LocalTrait for Vec<u8>`, which the orphan rule makes ordinary — the block SHALL record no member, there being no node to record it against. Its body's uses SHALL be attributed to the trait being implemented where that trait is a node, and to nothing where neither end is. An edge is kept where something in the document owns it, and dropped rather than invented where nothing does.

A file whose every item is an `impl` of a type declared in another file SHALL NOT become a file node, being represented by the nodes its members belong to.

A member SHALL record the members of the same type it calls, recognised by what the source writes: a method call on `self`. No type is inferred for it — `self` is the type the block implements, and a call on it names one of that type's own methods or none. A call written any other way is what it already is: the type's, attributed to the type as the rest of an impl body is.

A member SHALL also record what its own signature and body name outside the type, by the node it reaches: every edge the analyzer attributes to the type from a member's signature or body SHALL be recorded against that member as well. What a member's body names is what this analyzer resolves without a type checker — a path — so a method call on a field or a parameter names nothing here, and the edge such a field gives the type stays the type's alone. The type keeps the edge; the member says which method it came from. A name that reaches the type itself is recorded by neither, there being no edge from a node to itself.

#### Scenario: A method is its type's member
- **WHEN** `impl Scanner { pub fn next_token(&mut self) -> Token }` is declared
- **THEN** no node is created for `next_token`, and `Scanner` records it as a member

#### Scenario: An impl in another file
- **WHEN** `Scanner` is declared in `scanner.rs` and an `impl Scanner` block is written in `reprint.rs`
- **THEN** the member records `reprint.rs` and the line it is declared on

#### Scenario: Two types with a method of one name
- **WHEN** two types each implement a method called `len`
- **THEN** each is a member of its own type and no identity collides

#### Scenario: A file of impls is represented by what they belong to
- **WHEN** a file declares nothing but `impl` blocks for types declared elsewhere
- **THEN** no `file` node is created for it

#### Scenario: A trait lists its own methods
- **WHEN** `trait Parser { fn parse(&self) -> Ast; fn peek(&self) -> Token { … } }` is declared
- **THEN** the trait node records both as members, the signature and the one with a default body alike

#### Scenario: An impl for a type that is not in the document
- **WHEN** a local trait is implemented for a type from a dependency
- **THEN** no member is recorded, and what the body names is attributed to the trait

#### Scenario: An impl with neither end in the document
- **WHEN** an external trait is implemented for an external type
- **THEN** no member and no edge are recorded

#### Scenario: A method calling another on self
- **WHEN** a method's body writes `self.other(…)` and `other` is a method of the same type
- **THEN** the member records `other`

#### Scenario: A call on something else
- **WHEN** a method's body calls a method on a value that is not `self`
- **THEN** the member records no call for it, and the type keeps the edge it has

#### Scenario: A type a field names is the type's alone
- **WHEN** a field's type is a node, and a method's body calls a method on that field
- **THEN** the type carries the edge the field gives it, and no member records it, no type being inferred for a receiver

#### Scenario: A free function is not a member's call
- **WHEN** a method's body calls a free function
- **THEN** the member records no call for it, and records the node for that function as something it points at

#### Scenario: A type named in a method's signature
- **WHEN** a method takes an argument of a type that is a node
- **THEN** the member records that node

#### Scenario: A method naming its own type
- **WHEN** a method's body or signature names the type the impl block implements
- **THEN** the member records nothing for it
