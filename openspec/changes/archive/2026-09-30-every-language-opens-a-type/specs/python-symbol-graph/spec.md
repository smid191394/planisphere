## ADDED Requirements

### Requirement: A class's methods are its members
The analyzer SHALL record each `def` and `async def` written directly in the body of a top-level class as a member of that class's node, carrying its name, the absolute path of its file and the line of its `def`. A function nested inside a method, and a method of a class nested inside a class, SHALL NOT be recorded: neither belongs to a node, as neither nested thing is one.

Where a class declares one name more than once, the last declaration SHALL be the member, as the last top-level declaration of a name is the node: it is what the name means once the class body has run, whether the earlier ones are `@overload` signatures or a property's getter under its setter.

A member SHALL record the members of the same class it calls, recognised by what the source writes: a call on the method's receiver, which is its first parameter whatever it is named — `self`, `cls` — and only where the class declares a member of the called name. A `@staticmethod` has no receiver and records no calls.

A member SHALL also record the nodes its own signature and body name that its class carries an edge to, by the node's id. The class keeps the edge; the member says which method it came from.

A member declared on the same line as a node SHALL NOT be recorded, the document holding no member at a node's own place.

#### Scenario: A class lists its methods
- **WHEN** a top-level class defines `def run(self)` and `async def stop(self)`
- **THEN** its node records both as members, with the file and the line of each `def`

#### Scenario: Nested functions are not members
- **WHEN** a method defines a function inside itself, or a class nests a class that has methods
- **THEN** neither the inner function nor the inner class's methods are recorded

#### Scenario: A name declared twice
- **WHEN** a class declares a property's getter and then its setter under the same name
- **THEN** one member is recorded, at the setter's line

#### Scenario: A call on self
- **WHEN** a method writes `self.helper()` and the class declares `helper`
- **THEN** the member records `helper`

#### Scenario: A receiver by another name
- **WHEN** a `@classmethod` takes `cls` and writes `cls.build()`, and the class declares `build`
- **THEN** the member records `build`

#### Scenario: A static method
- **WHEN** a `@staticmethod` writes a call on its first parameter
- **THEN** the member records no call for it

#### Scenario: A method names another class
- **WHEN** a method's body constructs a class that is a node, and the class carries an edge to it
- **THEN** the member records that node
