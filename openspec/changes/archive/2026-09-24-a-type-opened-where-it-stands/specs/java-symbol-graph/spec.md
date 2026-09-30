## MODIFIED Requirements

### Requirement: Methods and constructors are members
The analyzer SHALL record each method and constructor declared in a type as a member of that type's node, carrying its own name, the absolute path of the file it is declared in and the line its name is declared on. A constructor's name SHALL be the type's own simple name, as the source writes it.

A field SHALL NOT be a member, and neither SHALL an enum constant: guava declares 6,405 fields and 5,743 enum constants, which are values rather than the behaviour a reader searches for. The Go analyzer draws the same line.

A method declared in a nested type SHALL belong to that nested type's node, not to the type around it.

A member SHALL record the members of the same type it calls, recognised by what the source writes: a call written `this.name(…)`, or a call written with no receiver at all whose name the type declares a member under. Java writes most of its own calls the second way, and the name is enough — the type's own members are known, and the call reaches one of them whichever overload the compiler picks.

A member SHALL also record what its own signature and body name outside its type, by the node it reaches: every edge the analyzer attributes to the type from a member's signature or body SHALL be recorded against that member as well. What a member names is what stands in a type's position — a return type, a parameter, a declared variable, a type written before a static member — so a call on a field or a parameter names a method rather than a type, and the edge such a field gives the type stays the type's alone. The type keeps the edge; the member says which method it came from. A name reaching the member's own type is recorded by neither, there being no edge from a node to itself.

#### Scenario: A type lists its methods
- **WHEN** a class declares methods and constructors
- **THEN** its node records each as a member, with the file and line where its name is declared

#### Scenario: A nested type's methods are its own
- **WHEN** a nested type declares a method
- **THEN** the member belongs to the nested type's node

#### Scenario: Values are not members
- **WHEN** a type declares fields, and an enum declares constants
- **THEN** none of them is recorded as a member

#### Scenario: A call on this
- **WHEN** a method's body writes `this.other(…)` and the type declares `other`
- **THEN** the member records `other`

#### Scenario: A call with no receiver
- **WHEN** a method's body writes `other(…)` and the type declares a member named `other`
- **THEN** the member records `other`

#### Scenario: A call with no receiver that the type does not declare
- **WHEN** a method's body writes `other(…)` and the type declares nothing of that name
- **THEN** the member records no call for it

#### Scenario: A call on another object
- **WHEN** a method's body calls a method on a field or a parameter
- **THEN** the member records no call for it, and records nothing for it, the name being a method's and not a type's

#### Scenario: A type named inside a body
- **WHEN** a method's body declares a variable of a type that is a node
- **THEN** the member records that node

#### Scenario: A type named in a method's signature
- **WHEN** a method takes an argument, or returns a value, of a type that is a node
- **THEN** the member records that node

#### Scenario: A method naming its own type
- **WHEN** a method's body or signature names the type that declares it
- **THEN** the member records nothing for it
