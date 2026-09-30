# java-symbol-graph Specification

## Purpose

Defines how Planisphere's Java analyzer reads Java: which files and source roots it
walks, which declarations become nodes and how a nested type is named, what a
method belongs to, how a package is placed and named, what `inherits` means, how
names are resolved by the compiler, and what never becomes a node.
## Requirements
### Requirement: Java sources are read one source root at a time
The analyzer SHALL walk the roots it is given for `.java` files, skipping the shared skipped directories and, in addition, `target/`, `build/` and `out/`, which is where Maven and Gradle write compiled output and generated source.

It SHALL group the files it walks into source roots, a source root being a file's directory with its package path removed: `…/guava/src/com/google/common/collect/Maps.java` declaring `package com.google.common.collect` has the source root `…/guava/src`. A file with no package declaration has its own directory as its root. The analyzer MUST NOT read `pom.xml`, `build.gradle` or any other build file to find them, and MUST NOT run a build tool: a repository that has never been built is analyzed exactly as one that has.

Each source root SHALL be read as its own compilation. A repository is not one program: guava keeps an `android/` mirror of its sources, and read as a single compilation it reports 93 duplicate classes and fails to resolve 70% of its type references. Read one root at a time it fails on 2.7%. A mirrored root is analyzed like any other, and its declarations appear alongside the originals, each in its own file.

Nothing SHALL be downloaded and no dependency SHALL be resolved from a repository. A name that belongs to a library the project depends on is an unresolved name, as an external Go module or an external Rust crate is.

#### Scenario: A source root is the directory the package sits under
- **WHEN** a file declaring `package a.b` is at `<root>/a/b/C.java`
- **THEN** its source root is `<root>`, whatever build files exist

#### Scenario: Two roots declaring the same classes
- **WHEN** a repository holds two source roots that declare classes of the same fully qualified names
- **THEN** each root is analyzed on its own and every declaration appears as a node in its own file

#### Scenario: Build output is not walked
- **WHEN** a repository has been built and `target/`, `build/` or `out/` hold `.java` files
- **THEN** none of them is read

#### Scenario: Nothing is fetched
- **WHEN** a project's imports name libraries that are not present
- **THEN** the analyzer resolves what the source declares, fetches nothing, and reports no error

### Requirement: Type declarations become nodes, nested ones included
The analyzer SHALL create a node for each class, interface, enum, record and annotation type declared in a walked file, with `kind` `class`, `interface`, `enum`, `record` or `annotation` accordingly. Java has no top-level function, so a Java document is a document of types.

A type declared directly inside another type SHALL be a node, and its `name` SHALL carry the types it is declared in, innermost last, joined by `.` — `Maps.KeySet`, `ImmutableList.Builder`. Nested types are most of a Java codebase: 1,885 of guava's 3,265 and 950 of jenkins's 2,205. Their names repeat — guava declares 57 types called `Builder` and two different `KeySet` types in one file — so the outer type's name is what makes the node identifiable and its id unique.

A type declared inside a method, a constructor or an initializer SHALL NOT be a node, and neither SHALL an anonymous class: guava has 43 of the first and 953 of the second. They are not reachable by name from anywhere else, which is what the node is for.

A nested type SHALL NOT be contained by the type it is declared in. Its containing unit is the package that holds its outermost type.

The analyzer SHALL record a node as `internal` when the declaration is neither `public` nor `protected`. `protected` is part of what a subclass outside the package may use, and package-private and `private` are not: 1,143 of guava's nested types are `private` and 554 are package-private.

#### Scenario: The five kinds
- **WHEN** a file declares a class, an interface, an enum, a record and an annotation type
- **THEN** each becomes a node of its own kind

#### Scenario: A nested type carries its outer type's name
- **WHEN** `class Maps { static class KeySet {} }` is read
- **THEN** the node is named `Maps.KeySet`, and its line is the line declaring `KeySet`

#### Scenario: Two nested types of one name in one file
- **WHEN** one file declares `class A { class KeySet {} }` and `class B { class KeySet {} }`
- **THEN** both are nodes, named `A.KeySet` and `B.KeySet`

#### Scenario: A class in a method body
- **WHEN** a method declares a class in its body, or uses an anonymous class
- **THEN** neither becomes a node

#### Scenario: Visibility is the internal flag
- **WHEN** a type is declared without `public` or `protected`
- **THEN** its node is marked internal, and a `public` or `protected` one is not

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

### Requirement: A package is a unit that contains what its files declare
The analyzer SHALL create a node of kind `package` for each package that declares at least one node, and a `contains` edge from it to every top-level type declared in its files and to every type nested inside those, so that no node is contained twice.

A package node SHALL be placed on a `package` line that names it: the line in that package's `package-info.java` where it has one — guava has 32, junit5 78, jackson 24 and jenkins 25 — and otherwise the same line in the first of its files, ordered by path. The line contains the package's dotted name, which is the node's name.

Packages SHALL NOT contain one another. `com.google.common` and `com.google.common.collect` are two packages whose names share a prefix, and Java gives the first no claim over the second. The Go analyzer treats packages the same way. The Rust analyzer nests units along its `mod` tree, which Java has no equivalent of.

A package appearing in two source roots SHALL be two nodes, one in each root's file, because the two roots are two compilations and their declarations are different declarations.

#### Scenario: A package lands on a line that names it
- **WHEN** a package's node is read
- **THEN** its file is a `.java` file of that package and its line is a `package` declaration containing the package's name

#### Scenario: package-info is preferred
- **WHEN** a package has a `package-info.java`
- **THEN** its node is placed there

#### Scenario: A package contains nested types too
- **WHEN** a package's file declares a type with a type inside it
- **THEN** the package contains both, and neither is contained twice

#### Scenario: Packages of shared prefix are unrelated
- **WHEN** a project declares `a.b` and `a.b.c`
- **THEN** neither contains the other

### Requirement: Inheritance in Java is what a type extends and implements
The analyzer SHALL create an `inherits` edge from a type to each type it names in its `extends` and `implements` clauses, where that type is a node in the document. An interface extending several interfaces gives one edge each.

A `permits` clause SHALL draw no edge of its own: a sealed type's subtypes name it in their own `extends` or `implements`, and the edge is already there.

`java.lang.Object`, and any other type the document does not hold, SHALL draw nothing, as the contract requires of an edge whose end is not a node.

#### Scenario: Extends and implements are both inheritance
- **WHEN** a class extends a class in the document and implements two interfaces in it
- **THEN** it has an `inherits` edge to each of the three

#### Scenario: An external supertype draws nothing
- **WHEN** a class extends a type the document does not hold
- **THEN** no edge is created

#### Scenario: A sealed hierarchy is not drawn twice
- **WHEN** a sealed interface permits two classes that implement it
- **THEN** there are two `inherits` edges, from each class to the interface

### Requirement: Names are resolved by the compiler, and across source roots by name
The analyzer SHALL resolve the names in a source root with the Java compiler's own resolution, so that a `uses` or `references` edge names the type the compiler resolved rather than a guess. Measured over the fixtures, 1.2% to 3.3% of type references fail to resolve, and those name the project's external dependencies.

The compiler SHALL be told to continue after a resolution error, because every project analyzed without its dependencies has them. Left to stop, it finishes the attribution of 0 of jackson-databind's 575 files and returns nothing; told to continue, it finishes all 575 and resolves 42,683 type references.

A reference to a type in another source root of the same repository SHALL be resolved by its fully qualified name against the nodes the other roots declare. It is 15.8% of junit5's in-project type references and 11.1% of guava's, and without it a repository of modules draws as a set of islands.

An edge SHALL be attributed to the node whose declaration encloses the reference — for a reference inside a method, the type that declares it; for one inside a type declared in a method, the type that encloses that.

#### Scenario: A reference inside a method belongs to its type
- **WHEN** a method body names another type
- **THEN** the edge runs from the type declaring the method

#### Scenario: A reference from an anonymous class
- **WHEN** an anonymous class inside a method names another type
- **THEN** the edge runs from the type declaring the method, that class being no node

#### Scenario: A reference across source roots
- **WHEN** a type in one source root names, by import, a type declared in another root of the same repository
- **THEN** an edge joins them

#### Scenario: An unresolved name draws nothing
- **WHEN** a type names a class from a library that is not present
- **THEN** no edge is created and no node is invented

### Requirement: The analyzer runs on a Java runtime that carries the compiler
The analyzer SHALL be run by the Java runtime directly from its source, requiring no build step, no dependency and no lockfile. The JDK's compiler is the parser and the resolver, so unlike the Rust analyzer this one declares nothing.

Where `java` is absent, or where the runtime carries no compiler module, the CLI SHALL say which of the two is wrong rather than failing with a class-not-found error. A runtime can carry `jdk.compiler` without a `javac` binary, so the presence of `javac` SHALL NOT be what the check looks for.

#### Scenario: No Java at all
- **WHEN** `java` is not on `PATH`
- **THEN** the CLI says so and names what to install

#### Scenario: A runtime without a compiler
- **WHEN** `java` runs but its runtime has no compiler module
- **THEN** the CLI says that, rather than reporting a missing class

### Requirement: What this analyzer excludes from becoming a file node
A Java file declaring at least one type SHALL NOT also get a file node, as the contract requires. A `package-info.java` holding a package node SHALL NOT get one either: it is represented by the unit placed in it.

A `module-info.java` SHALL get no node of its own. It names a module rather than declaring a type, and the analyzer records no module.

#### Scenario: package-info is represented by its package
- **WHEN** a `package-info.java` carries the package's node
- **THEN** it gets no file node

#### Scenario: module-info declares nothing
- **WHEN** a source root holds a `module-info.java`
- **THEN** it contributes no node

