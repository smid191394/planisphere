# python-symbol-graph Specification

## Purpose

Defines how Planisphere's Python analyzer reads Python: which `.py` files it walks, which definitions become nodes, and how a name in one module is resolved to a symbol in another. What the resulting document must look like — identity, paths, edge kinds, serialisation — belongs to `structure-graph-artifact` and binds every analyzer, not only this one.

## Requirements

### Requirement: Python-only workspace analysis
The system SHALL analyze only `.py` files under the opened workspace folder(s) when building the structure graph. Non-Python files MUST NOT appear as graph nodes.

Beyond the directories every analyzer skips, this analyzer SHALL also skip Python's tool caches — `.venv`, `venv`, `__pycache__`, `.mypy_cache`, `.pytest_cache`, `.tox`, `.eggs` — and SHALL treat `conftest.py` and the usual `test_*` / `*_test` module names as test files.

Where a `.py` file declares no top-level symbol, this analyzer's named exclusion set is `__init__.py`, `version.py` and `_version.py`: those are package structure rather than content, and they SHALL NOT become file nodes.

It SHALL also exclude a symbol-less module whose every statement is an `import`, a leading docstring aside. `fastapi/requests.py` is one line — `from starlette.requests import HTTPConnection as HTTPConnection` — and `cElementTree.py` is a deprecated alias for another module: re-export shims called by their own names, which no list of names can anticipate.

Every other symbol-less module SHALL become a file node. A module holding one assignment is content, however little.

#### Scenario: Mixed-language workspace
- **WHEN** the workspace contains Python files and files of other languages
- **THEN** the produced graph includes nodes only for symbols derived from `.py` files

#### Scenario: No Python files
- **WHEN** the workspace contains no `.py` files
- **THEN** the analysis result is an empty graph (zero nodes and zero edges)

#### Scenario: A package marker is not a lone node
- **WHEN** an `__init__.py` re-exports names but declares no class or top-level function of its own
- **THEN** no file node is created for it

#### Scenario: A constants module is a node
- **WHEN** a `.py` file that is not in the exclusion set declares only module-level constants
- **THEN** the graph contains one file node for it

#### Scenario: A re-export shim is not a node
- **WHEN** a module's only statement is `from other import Thing as Thing`
- **THEN** no file node is created for it

#### Scenario: A docstring above the imports does not make it content
- **WHEN** a module holds a docstring and then only imports
- **THEN** no file node is created for it

#### Scenario: A constants module is content
- **WHEN** a symbol-less module holds an assignment rather than an import
- **THEN** the graph contains one file node for it

### Requirement: Class and top-level function nodes
The system SHALL create a node for each top-level `class` definition and each top-level `def` / `async def` function definition found in analyzed Python modules. Nested methods and nested functions inside classes or functions MUST NOT be separate nodes in the MVP graph.

Where one module declares the same name more than once at the top level, the system SHALL produce a single node for it, and that node SHALL carry the location of the **last** declaration. A name means what the module leaves it meaning once it has run, and where the repetition is `@overload`, the last declaration is the function while the earlier ones are signatures for a type checker.

A node's identity is its file, its kind and its name, so repeated declarations cannot be distinguished by any consumer: cytoscape drops an element whose id it already holds, and the analyzer's own index is a mapping. Emitting one node per declaration therefore does not add information — it adds nodes that are counted and then discarded.

#### Scenario: Module with classes and functions
- **WHEN** a module defines two top-level classes and one top-level function
- **THEN** the graph contains exactly three nodes for that module corresponding to those definitions

#### Scenario: Methods are not nodes
- **WHEN** a class defines instance methods
- **THEN** those methods do not appear as independent graph nodes

#### Scenario: An overloaded function is one node
- **WHEN** a module declares `def Field` several times under `@overload` and once as the implementation
- **THEN** the graph contains one node for `Field`, spanning the implementation rather than a signature stub

#### Scenario: A redeclared name keeps the last location
- **WHEN** a module defines a top-level name twice
- **THEN** the node's `line` and `endLine` are the second definition's

### Requirement: Inherits edges
The system SHALL emit an `inherits` edge from a class node to each resolvable base class that also exists as a node in the graph. Unresolvable bases (e.g. unknown external types) MUST NOT create dangling target nodes solely for inheritance.

#### Scenario: Simple inheritance within workspace
- **WHEN** `class Admin(User):` is defined and `User` is a class node in the same workspace graph
- **THEN** an `inherits` edge exists from `Admin` to `User`

#### Scenario: Unknown base omitted
- **WHEN** a class inherits from a name that does not correspond to any graph node
- **THEN** no `inherits` edge is created for that base

### Requirement: Uses edges are approximate
The system SHALL emit `uses` edges when a symbol body (class body including methods, or top-level function body and signature) lexically refers to another graph node's name in a way the analyzer recognizes (including type annotations and simple name references). The system MUST NOT claim that `uses` edges are a complete or sound runtime call graph; missing or spurious `uses` edges are permitted within that approximate contract.

A name the file binds itself is not a reference to anything. A parameter, a loop variable, a comprehension target, a `with ... as`, an `except ... as`, an assignment, and a nested function or class definition all bind a name, and a name any of them binds denotes that binding rather than a symbol elsewhere that happens to share its spelling. `uuid1` takes a parameter called `node` and `platform.py` defines a function called `node`; those are two different things and the graph MUST NOT join them.

This matters because of what the resolver does when its first two steps fail. Neither the module's own symbols nor its imports explain a local name, so resolution falls to the last step — the only project-wide symbol with that spelling — and answers confidently. A loop variable called `f` in `idlelib/multicall.py` would otherwise join it to `turtledemo/chaos.py`.

An import is not one of these bindings, wherever it appears. A name bound by `import` or `from ... import` denotes the imported symbol, which is exactly what a reference to it means — and an import inside a function body binds just as an import at the top of the file does. `multiprocessing/context.py` writes `class BaseContext:` with a method named `Pipe` that opens `from .connection import Pipe`: the method's name MUST NOT hide the import two lines below it.

A string literal SHALL count as a reference only where a type is expected. `def f(x: "Foo")` names a class and `{"media": obj.media}` names a dict key, and the difference between them is where the string sits, not what it spells. Treating every identifier-shaped string as a forward reference would make `if name != "ByteString"`, `if sectName in {"temp", "cdata", "ignore"}` and `getattr(candidate, "default", True)` into dependencies, on a name that appears in its file only as a string and never as a name.

A forward reference written outside an annotation — `cast("Foo", x)`, `TypeVar("T", bound="Foo")` — is a real reference that this rule drops. On all four sample projects no edge is lost that way, because such names resolve through the module's own symbols or its imports before uniqueness is ever consulted.

The test is whether the file binds the name anywhere, not whether the binding is in scope at the point of use. That will drop a real reference where one file both binds a name locally and genuinely refers to a symbol of the same name elsewhere. The trade is deliberate: the edge given up cannot be told apart from the far more numerous false ones the rule prevents.

#### Scenario: Type annotation creates uses
- **WHEN** class `TokenService` annotates a field or parameter with class `UserRepo` that exists as a node
- **THEN** a `uses` edge exists from `TokenService` to `UserRepo`

#### Scenario: Top-level function body creates uses
- **WHEN** a top-level function body lexically refers to another graph node (for example calling `where` or returning `Query()[key]`)
- **THEN** a `uses` edge may be emitted from that function to the referenced node

#### Scenario: Honesty of approximation
- **WHEN** a dynamic attribute access would call another class at runtime but no lexical name reference is present
- **THEN** the analyzer may omit a `uses` edge without violating this capability

#### Scenario: A loop variable is not a reference
- **WHEN** a method iterates with `for f in items` and exactly one module-level `f` exists anywhere in the project
- **THEN** no edge is created to it

#### Scenario: A parameter is not a reference
- **WHEN** a function takes a parameter named `node` and some other module defines a function called `node`
- **THEN** no edge is created to it

#### Scenario: An assigned name is not a reference
- **WHEN** a body assigns to `path` before using it, and another module defines `path`
- **THEN** no edge is created to it

#### Scenario: A name the file does not bind is still resolved
- **WHEN** a body refers to a name it does not bind, and exactly one project symbol has that name
- **THEN** the edge is created

#### Scenario: An imported name is unaffected
- **WHEN** a body refers to a name the file imports
- **THEN** the edge is created from the import, whatever else the file binds

#### Scenario: An import inside a function still wins
- **WHEN** a method is named `Pipe` and its body opens `from .connection import Pipe` before calling it
- **THEN** the edge goes to the imported `Pipe`, not nowhere

#### Scenario: A name defined at module level still reaches its own file
- **WHEN** a class defined in a file is used by another symbol in that same file
- **THEN** the edge is created, since a module-level definition is what the first resolution step answers with

#### Scenario: A string in an annotation is a reference
- **WHEN** a parameter is annotated `"Foo"` as a string and a class `Foo` exists
- **THEN** a `references` edge is created to it

#### Scenario: A dict key is not a reference
- **WHEN** a body writes `{"media": something}` and some module defines a function called `media`
- **THEN** no edge is created to it

#### Scenario: A compared string is not a reference
- **WHEN** a body writes `if name != "ByteString"` and a class `ByteString` exists elsewhere
- **THEN** no edge is created to it

#### Scenario: A looked-up attribute name is not a reference
- **WHEN** a body writes `getattr(obj, "default", True)` and some module defines `default`
- **THEN** no edge is created to it

### Requirement: An import resolves by path component, never by string coincidence
When the analyzer maps an imported module to a scanned file, it SHALL match whole path components. A module named `time` matches a file named `time.py`, or one at `a/b/time.py`, or the package `a/b/time/__init__.py`. It MUST NOT match `_pydatetime.py`, whose name merely ends with those characters.

Where no scanned file matches, the import SHALL be treated as external and no node SHALL be linked. Choosing the closest-looking file is worse than declining: an edge the reader cannot distinguish from a real one is a claim the analyzer has no basis for.

Resolving one import MUST NOT cost work proportional to the number of scanned files. A project's imports and its file count both grow with the project, and multiplying them makes a large codebase impossible to analyze rather than merely slow.

#### Scenario: A module name is not a filename suffix
- **WHEN** a module imports `time`, no scanned file is named `time.py`, and a scanned file is named `_pydatetime.py`
- **THEN** the import resolves to nothing and no edge is created to anything in `_pydatetime.py`

#### Scenario: A module in a subdirectory still resolves
- **WHEN** a module imports `pkg.sub.thing` and a scanned file exists at some path ending in the components `pkg/sub/thing.py`
- **THEN** the import resolves to that file

#### Scenario: A package resolves through its __init__
- **WHEN** a module imports `pkg.sub` and a scanned file exists at some path ending in the components `pkg/sub/__init__.py`
- **THEN** the import resolves to that file

#### Scenario: An external module stays external
- **WHEN** a module imports something no scanned file provides
- **THEN** no edge is created, rather than an edge to the best-matching name

#### Scenario: Resolution cost does not grow with the project
- **WHEN** a project with many thousands of files is analyzed
- **THEN** the time spent resolving imports grows with the number of imports, not with their number multiplied by the number of files

### Requirement: A name is resolved to what a module exports, not only to what it defines
Where the source names an attribute on an imported module — `pkg.Thing` after `from a import pkg`, or after `import a.pkg` — the analyzer SHALL resolve `Thing` to what `pkg` exports. A module exports what it defines, and also what it imports under that name: `from .thing import Thing` in a package's `__init__.py` makes `Thing` reachable as `pkg.Thing`, and the analyzer MUST reach it.

Resolution SHALL follow such a binding to the module it names and look again there, repeating for as long as each step is a name the source actually writes. It MUST stop when a module is reached twice, so a cycle of modules importing from one another cannot loop.

This SHALL NOT make resolution more speculative. Only bindings the source states are followed; where the chain leaves the analyzed project, or names something no module provides, the reference stays external and no edge is created. Following re-exports MUST NOT change the symbol a name resolves to where it resolves without them.

Star imports are not followed. What `from .x import *` binds depends on `__all__` and on what the module defines rather than on a name the source writes, and inferring it is a different question from following a stated re-export.

#### Scenario: A class inherits through a package re-export
- **WHEN** a module writes `from a.b import pkg` and then `class X(pkg.Base)`, where `a/b/pkg/__init__.py` contains `from .core import Base` and `a/b/pkg/core.py` defines `Base`
- **THEN** an `inherits` edge is created from `X` to the `Base` defined in `a/b/pkg/core.py`

#### Scenario: A use through a package re-export
- **WHEN** a module refers to `pkg.Helper` in an executable position and `pkg`'s `__init__.py` re-exports `Helper` from elsewhere in the project
- **THEN** a `uses` edge is created to the module that defines `Helper`

#### Scenario: A re-export of a re-export
- **WHEN** `pkg` re-exports a name from `inner`, and `inner` re-exports the same name from `deep`, which defines it
- **THEN** the reference resolves to the definition in `deep`

#### Scenario: A cycle of re-exports terminates
- **WHEN** two modules each re-export a name from the other and neither defines it
- **THEN** the analyzer produces no edge for that name and completes rather than looping

#### Scenario: A re-export leading outside the project stays external
- **WHEN** a package's `__init__.py` re-exports a name from a module that is not part of the analyzed source
- **THEN** no edge is created, rather than an edge to a project symbol that happens to share the name

#### Scenario: A star import is not followed
- **WHEN** a package's `__init__.py` binds a name only through `from .other import *`
- **THEN** an attribute reference to that name resolves to nothing

#### Scenario: What already resolved still resolves
- **WHEN** an attribute names a symbol the target module defines itself
- **THEN** it resolves to that symbol, unchanged by the presence of any re-export

### Requirement: A pair of nodes carries one edge, the most specific one
For any ordered pair of nodes the analysis result SHALL contain at most one edge, whichever of `inherits`, `uses` and `references` is the most specific that applies, in that order.

This SHALL hold however many times the analyzer visits the pair. A file that declares a symbol several times is linked once per declaration, and the declarations disagree: an `@overload` signature names a class in an annotation and yields `references` while the implementation calls it and yields `uses`. The rule is a property of the pair, not of the order in which the analyzer reaches it.

#### Scenario: A stronger kind replaces a weaker one found first
- **WHEN** the analyzer finds a `references` relationship between two nodes and later finds a `uses` relationship between the same two, in that order
- **THEN** the result contains one `uses` edge between them and no `references` edge

#### Scenario: A weaker kind does not displace a stronger one
- **WHEN** the analyzer finds an `inherits` relationship and later a `uses` relationship between the same ordered pair
- **THEN** the result contains one `inherits` edge between them

#### Scenario: The reverse direction is a different pair
- **WHEN** two nodes refer to each other
- **THEN** each direction may carry its own edge
