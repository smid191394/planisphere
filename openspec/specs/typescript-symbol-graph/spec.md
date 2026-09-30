# typescript-symbol-graph Specification

## Purpose

Defines how Planisphere's TypeScript analyzer reads TypeScript: which files it walks, which declarations become nodes, how the compiler's own resolution is used to link a name in one module to a symbol in another, and the honesty bounds on what those links mean. What the resulting document must look like belongs to `structure-graph-artifact` and binds every analyzer.
## Requirements
### Requirement: TypeScript sources only, tests and build output excluded
The analyzer SHALL walk `.ts`, `.tsx`, `.mts` and `.cts` files under the given root(s). The last two are how TypeScript writes a file whose module system is stated in its name; they are TypeScript, and a package written in them is not a package written in nothing. It MUST NOT walk declaration files (`.d.ts`, `.d.mts`, `.d.cts`), which describe an interface to code rather than being it, nor files named as tests (`*.test.*`, `*.spec.*` in any of those extensions).

Whatever decides that a root holds TypeScript SHALL agree with what the analyzer walks. A dispatcher that looks for fewer extensions than the analyzer reads declines work the analyzer would have done; one that looks for more announces a language whose analyzer then finds nothing.

Beyond the directories every analyzer skips, it SHALL also skip TypeScript's build and dependency conventions: `node_modules`, `dist`, `lib`, `out`, `coverage`.

#### Scenario: A declaration file is not walked
- **WHEN** a package ships `index.d.ts` beside its sources
- **THEN** no node is created for anything declared in it

#### Scenario: A package written in `.mts` is TypeScript
- **WHEN** a root holds only `.mts` or `.cts` sources and no language is named
- **THEN** the TypeScript analyzer runs and their declarations become nodes

#### Scenario: A declaration file in either module extension is not walked
- **WHEN** a package ships `api.d.mts` beside a real `.mts` source
- **THEN** nodes are created for the source and for nothing declared in the declaration file

#### Scenario: Build output is not walked
- **WHEN** a package has been compiled into `dist/`
- **THEN** the compiled copies do not appear as nodes beside their sources

### Requirement: Every top-level declaration that names a symbol becomes a node
The analyzer SHALL create a node for each `class`, `interface`, `type`, `enum` and `function` declared at the top level of a scope, with `kind` naming the declaration as TypeScript names it. A file is a scope, and so is a `namespace` or `module` block: a namespace is a naming scope rather than a symbol, and the types inside it are not nested in anything the artifact contract excludes — that rule forbids a node for a method, a function inside a function, or a type inside a type.

A node declared inside a namespace SHALL carry the scope in its name, joined by dots — `Shapes.Circle` rather than `Circle`, at whatever depth the namespaces nest. Names collide otherwise: zod declares seven names both at a file's top level and inside one of its namespaces, and an identity is `<file>::<kind>::<name>`, so without the qualifier the second declaration would replace the first under the rule for overload signatures and swallow a different symbol.

A namespace SHALL NOT itself become a node. Whether the document carries a unit above the file is a separate question and this requirement does not answer it.

It SHALL also create a `function` node for a top-level `const`, `let` or `var` whose initialiser is an arrow function or a function expression. Such a declaration is a function to every reader and a variable only to the syntax: zod declares 678 functions with the keyword and 154 more this way, so taking only the keyword misses 18% of its functions.

Where one scope declares the same name more than once — TypeScript's overload signatures, which are the same shape as Python's `@overload` — the analyzer SHALL produce a single node carrying the last declaration's location.

#### Scenario: The five declaration kinds
- **WHEN** a file declares a class, an interface, a type alias, an enum and a function
- **THEN** the graph contains five nodes whose kinds are `class`, `interface`, `type`, `enum` and `function`

#### Scenario: A type inside a namespace is a node
- **WHEN** a file declares `export namespace Shapes { export class Circle {} }`
- **THEN** the graph contains a `class` node named `Shapes.Circle`

#### Scenario: Nested namespaces stack in the name
- **WHEN** a namespace declares a namespace which declares a class
- **THEN** the node's name is the two scope names and the class name, joined by dots

#### Scenario: The namespace itself is not a node
- **WHEN** a file declares a namespace holding two types
- **THEN** the graph contains two nodes and none for the namespace

#### Scenario: A name declared inside and outside one namespace stays two nodes
- **WHEN** a file declares `class Foo` at its top level and `namespace N { export class Foo {} }`
- **THEN** the graph contains two nodes, named `Foo` and `N.Foo`

#### Scenario: An arrow constant is a function
- **WHEN** a file declares `export const parse = (x: string) => x.trim()`
- **THEN** the graph contains a `function` node named `parse`

#### Scenario: A plain constant is not a function
- **WHEN** a file declares `export const LIMIT = 10`
- **THEN** no node is created for it

#### Scenario: Overload signatures are one node
- **WHEN** a file declares a function twice as overload signatures and once as the implementation
- **THEN** the graph contains one node for it, at the implementation

### Requirement: Names are resolved by the compiler, not by matching text
The analyzer SHALL resolve a name to a declaration using the TypeScript compiler's own symbol resolution, following aliases to what an import finally names. It MUST NOT resolve a name by matching it against the set of symbols the project happens to define, which is the step Python's analyzer needs and TypeScript's does not.

Where a resolved symbol has declarations of more than one kind — TypeScript merges an interface and a value of the same name into one symbol — the analyzer SHALL choose deterministically, so that the same source produces the same document.

Where a name resolves outside the walked files, the analyzer SHALL emit no edge. This is the same rule every analyzer follows: declining is honest, and an edge to a dependency's symbol is a claim about code the drawing does not contain.

#### Scenario: An import is followed to what it names
- **WHEN** a file writes `import { Thing } from "./other"` and uses `Thing`
- **THEN** the edge points at the node for `Thing` in `other.ts`

#### Scenario: A re-export is followed through
- **WHEN** a package's `index.ts` re-exports `Thing` and a third file imports it from the package
- **THEN** the edge points at the declaration of `Thing`, not at the re-export

#### Scenario: A dependency's symbol is not linked
- **WHEN** a file imports a symbol from a package under `node_modules`
- **THEN** no edge is created for uses of that symbol

#### Scenario: A merged name resolves the same way twice
- **WHEN** a name is declared both as an interface and as a value, and something refers to it
- **THEN** the same declaration is chosen on every run

### Requirement: A type position is a reference, anything else is a use
The analyzer SHALL emit `references` where a name appears in a type position — an annotation, a type argument, a heritage constraint, the body of an interface or a type alias — and `uses` where it appears anywhere a value is expected. `extends` and `implements` clauses SHALL both emit `inherits`.

Two thirds of a TypeScript drawing being `references` is the language rather than a fault in the analyzer: measured, zod is 69% and TypeORM 65% against Django's 0% and CPython's 1%, while edges per node are 2.8 and 3.5 against 2.1 and 1.7. An interface's whole body is type references; Python's annotations are optional and usually absent.

`implements` is emitted as `inherits` rather than as a kind of its own. Measured, it is 1 of 673 heritage edges in zod, 31 of 166 in NestJS and 32 of 368 in TypeORM — real, and about one in ten. Distinguishing it is a change to the artifact contract, and a contract change made for one language before a second has asked for it is a guess.

#### Scenario: An annotation is a reference
- **WHEN** a function's parameter is annotated with a type declared in the project
- **THEN** a `references` edge is created to it

#### Scenario: A call is a use
- **WHEN** a function's body calls another function declared in the project
- **THEN** a `uses` edge is created to it

#### Scenario: Both heritage keywords are inherits
- **WHEN** a class extends a base class and implements an interface, both declared in the project
- **THEN** both edges are `inherits`

#### Scenario: The stronger kind wins
- **WHEN** a symbol both extends another and names it in an annotation
- **THEN** the pair carries one `inherits` edge

### Requirement: What this analyzer excludes from becoming a file node
The analyzer SHALL exclude two kinds of symbol-less file from becoming a `file` node, and no others.

Its named set is `index.ts`, `index.tsx`, `index.mts` and `index.cts` — TypeScript's convention for a package's entry, which re-exports what the package holds.

And it SHALL exclude any file whose every statement is an `import`, an `export … from` or an `export *`. Angular's barrels carry names a list cannot anticipate: `browser.ts`, `di.ts`, `compiler.ts`, `core_reactivity_export.ts`, forty-five of them.

A file holding constants, a lone assignment, or anything else it declares itself SHALL still become a file node. It is content, however little.

#### Scenario: A named entry file is excluded
- **WHEN** a package's `index.ts` re-exports what its siblings declare
- **THEN** no node is created for it

#### Scenario: A barrel under any other name is excluded
- **WHEN** a file named `browser.ts` contains only `export * from` statements
- **THEN** no node is created for it

#### Scenario: A constants file is kept
- **WHEN** a file declares only `export const LIMIT = 10`
- **THEN** the graph contains one `file` node for it

#### Scenario: A file mixing a re-export and a declaration is kept
- **WHEN** a file re-exports one name and declares a constant of its own
- **THEN** the graph contains one `file` node for it

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

