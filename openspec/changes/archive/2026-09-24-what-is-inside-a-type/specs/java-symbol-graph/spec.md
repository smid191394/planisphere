## MODIFIED Requirements

### Requirement: Methods and constructors are members
The analyzer SHALL record each method and constructor declared in a type as a member of that type's node, carrying its own name, the absolute path of the file it is declared in and the line its name is declared on. A constructor's name SHALL be the type's own simple name, as the source writes it.

A field SHALL NOT be a member, and neither SHALL an enum constant: guava declares 6,405 fields and 5,743 enum constants, which are values rather than the behaviour a reader searches for. The Go analyzer draws the same line.

A method declared in a nested type SHALL belong to that nested type's node, not to the type around it.

A member SHALL record the members of the same type it calls, recognised by what the source writes: a call written `this.name(…)`, or a call written with no receiver at all whose name the type declares a member under. Java writes most of its own calls the second way, and the name is enough — the type's own members are known, and the call reaches one of them whichever overload the compiler picks.

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
- **THEN** the member records nothing for it

#### Scenario: A call on another object
- **WHEN** a method's body calls a method on a field or a parameter
- **THEN** the member records nothing for it
