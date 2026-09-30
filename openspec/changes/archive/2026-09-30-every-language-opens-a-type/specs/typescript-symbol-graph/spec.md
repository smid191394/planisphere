## ADDED Requirements

### Requirement: A class's and an interface's methods are its members
The analyzer SHALL record, as members of a class's node, each method it declares, its constructor under the name `constructor`, and each property whose value is an arrow function or a function expression; and, as members of an interface's node, each method signature it declares. Each member SHALL carry its name, the absolute path of its file and the line of its name. A property holding a function is the member form of `export const f = () => …`, which is a function at the top level, and a class written that way has its methods there. An accessor SHALL NOT be recorded: `get x()` is read as a property, not called.

Where a class or an interface declares one name more than once, the last declaration SHALL be the member, as the last declaration of a top-level name is the node: after overload signatures, the last is the implementation.

A member SHALL record the members of the same class it calls, recognised by what the source writes: a call on `this`, and only where the class declares a member of the called name.

A member SHALL also record the nodes its own signature and body name that its node carries an edge to, by the node's id. The node keeps the edge; the member says which method it came from.

A member declared on the same line as a node SHALL NOT be recorded, the document holding no member at a node's own place.

#### Scenario: A class lists its methods
- **WHEN** a class declares a constructor, a method and a property holding an arrow function
- **THEN** its node records all three as members, the constructor under the name `constructor`

#### Scenario: An interface lists its methods
- **WHEN** an interface declares a method signature
- **THEN** its node records it as a member

#### Scenario: Accessors are not members
- **WHEN** a class declares `get size()`
- **THEN** no member is recorded for it

#### Scenario: Overloads are one member
- **WHEN** a class declares two overload signatures of `parse` and then its implementation
- **THEN** one member named `parse` is recorded, at the implementation's line

#### Scenario: A call on this
- **WHEN** a method writes `this.helper()` and the class declares `helper`
- **THEN** the member records `helper`

#### Scenario: A method names another node
- **WHEN** a method's body constructs a class that is a node, and the class carries an edge to it
- **THEN** the member records that node
