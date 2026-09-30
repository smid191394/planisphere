## MODIFIED Requirements

### Requirement: Radial type tree rooted at the primary center
The viewer SHALL lay out visible nodes as a radial tree rooted at the graph's primary center — the type nearest to everything else where the graph has types, otherwise the most-connected function or file: the center node at the origin; every other visible type placed at a radius that increases with its hop distance from that center; and visible function nodes as satellites around the type they attach to—not as vertices of the tree.

A type is any node whose kind is neither `function` nor `file`. The viewer MUST NOT decide this by matching a list of kind names, and every rule below that says "type" means that and not `class` in particular: on three TypeScript projects, between 52% and 60% of top-level declarations are type-shaped and not classes.

The centre SHALL be the reader's when they have named one. A node they have pointed at is the centre of the drawing until they say otherwise, and the choice persists the way every other setting does; naming none returns the automatic one.

It SHALL be asked for on the focused node, from the keyboard, and the same key on the node that is already the centre SHALL hand the choice back. The press SHALL then let the node go, clearing the focus it acted on: it is the end of what the reader was doing with that node, and a node left lit says it is still the subject of the next keystroke when what it has become is the subject of the drawing. Handing the choice back is therefore the same gesture as naming it — point at the node, press the key — rather than a second press on a node the reader can no longer see they are holding. Naming it is an act performed on a node, so it is reached from the node rather than from a list — a list of every type in the panel would be a search field, and there is a search field. It MUST NOT be bound to the right button, which names the reachable-set view instead. A key can be shown in the legend as the key it is, where a gesture can only be described there in words; the key MUST be listed there with the others.

The way back MUST be reachable on the node itself and not only from the control that returns every setting to its default. Undoing one keypress is not a reason to lose a palette.

It SHALL NOT have a row in the settings panel. It is chosen by pointing at a node, so a row there could only report it, and a row that reports one node's name is a wide piece of the panel spent on the one setting the reader cannot set from it. The control that returns every setting to its default SHALL still reach it, which is why that control walks the settings rather than the panel's own rows.

The centre a drawing chooses for itself SHALL be the type nearest to everything else, weighted by how much of that type there is, and taken from those the codebase presents as its own rather than as its plumbing — private names and exceptions are neither the subject of anything nor where a reader would start.

What counts as the codebase's plumbing SHALL be the artifact's answer where the artifact gives one: a node the analyzer has recorded as internal is out of the running. Where no node in an artifact carries that, the viewer SHALL fall back to the name. The viewer MUST NOT read a naming convention of its own onto a language: an underscore is Python's mark and a lower-case initial is Go's, and each is wrong about the other — 40% of hugo's types are unexported without an underscore, while 85% of Django's functions and 95% of Angular's begin with a lower-case letter and are not internal at all. Unexported Go types already rank among the candidates: three of cobra's top ten, two of prometheus's.

Each part answers a way a simpler criterion goes wrong. Ranking by how much of the graph a node can reach along directed edges measures the end of the deepest dependency chain: on six projects with an agreed subject it names two of them, and calls Flask's centre its CLI command group, Pydantic's a private helper, Scrapy's an HTTP download handler and Django's an admin class. Nearness rather than reach, because a centre should be near the thing it is the centre of. Weighted by size because a subject is a substantial class and not a two-line helper, and weighted by its logarithm so that size settles a tie between comparably central classes rather than deciding against a much more central one. It is a product and a large enough ratio wins eventually; the ratios that arise between real candidates do not reach it — Pydantic's two contenders differ by 1.4. Excluding private names because Pydantic's answer is otherwise `_Pipeline`, and exceptions because Django's `ImproperlyConfigured` otherwise outranks `Model`.

How much of a type there is SHALL be the lines of its declaration and one for each member the artifact records outside those lines. Where a language writes a type's methods apart from its declaration, the declaration is not the type: sqlparser-ranger's `Parser` is declared in 6 lines and has 69 methods in `impl` blocks, while `TokenKind` is 205 lines of variants, and measured by lines alone the drawing would be centred on `TokenKind`. A member written inside the declaration — a Rust trait's methods, 590 of syn's and 125 of tokio's — is already counted by its lines and SHALL NOT be counted again. A member counts one and not its own lines, because the size enters as a logarithm to settle ties and a count is enough for that; counting a method's lines as well chooses the same primary centre on all nine Go and Rust fixtures. An artifact that records no members is sized by its lines alone, and so, in effect, is one whose every member is written inside its declaration: a Python or TypeScript method is always inside its class, and counting members moves none of the eight Python and four TypeScript centres. On Go and Rust, counting members decides the primary centre on four of nine: sqlparser-ranger's is `Parser`, hugo's `HugoSites`, prometheus's `Head`, and gin's `Context` rather than `Engine`.

The criterion SHALL be judged on the drawing it produces as well as the name it returns. Out-reach roots the tree at a leaf of one subsystem: Pydantic comes out as twelve children with 97% of the drawing hanging off one of them, CPython as two with 97%, Flask as four with 90% — the first rings empty and the picture starting somewhere out at the fourth.

Finding it SHALL cost a bounded walk of the graph rather than one walk per candidate. Nearness is defined for every type and only the nearest is wanted, and computing the definition for all of them to find one takes 3,179 ms on CPython, spent on 1,909 answers nobody reads.

An estimate MAY stand in for the definition while candidates are being narrowed, provided the candidates that remain are then measured by the definition itself, and provided the estimate does not depend on chance: the same project SHALL choose the same centre every time it is opened.

No automatic criterion is right for every project, which is why the choice exists rather than a better formula. On the three sample projects: by how much of the graph a node reaches, Django's top eight are all admin classes and CPython's are all IDLE, so those drawings would be centred on `UserAdmin` and on a file browser while `Model` ranks 812th; reversing the direction picks the utilities everything touches, `cached_property` and `MessageDefect`; closeness on the undirected class graph puts Django's `Field` 2nd and `Model` 6th and CPython's `Thread` and `ABCMeta` at the top, and cannot see FastAPI's `FastAPI` at all. An automatic centre is a guess about what the reader came to ask.

A centre naming a node that is not in the graph being drawn SHALL be ignored rather than honoured or treated as an error: settings follow the reader from one artifact to the next, and most nodes are in only one of them.

Which tree a type belongs to SHALL count a hop through a function. A function is a node in the graph and an edge to it is a relationship, so a type joined to the tree only through a function is joined to it. Placing such a type in a tree of its own is wrong twice over: with functions hidden it reads as related to nothing, and with them shown an edge appears that crosses the whole drawing to reach it.

A node SHALL NOT be given a parent that the placement will skip. A type whose relationships all run through functions is not a vertex of the tree — it sits beside the function that builds it — so nothing can hang off it. Parented there, a node is never reached by the walk that places the tree at all: it falls through to the pass that places satellites and arrives as a satellite of a satellite, a satellite step from its siblings rather than a ring step. `shutil`'s `_unpack_zipfile` and `_unpack_tarfile` are such nodes: their nearest candidate parent is `ReadError`, which orbits `unpack_archive`.

How deep a type sits SHALL still be measured over type nodes only, so that a shared helper function cannot shorten the path between two types. These are two different questions and they take two different answers: membership asks whether anything joins this type to the tree, depth asks how far the types themselves lead. Where no type-to-type path reaches a type at all, it has no type-to-type depth, and it SHALL be placed at the depth of the path that does reach it.

A ring's radius SHALL be determined by its depth alone. It MUST NOT be derived from what the ring inside it grew to, because a sector narrows geometrically with depth while the arc a node needs does not — so a radius that inherits the previous ring's inflation compounds it, and the drawing's extent grows with depth exponentially rather than linearly.

Where a ring cannot hold what is placed on it, its contents SHALL overlap rather than the ring growing to fit them. A crowded ring reads as crowded; a ring that flees outward to make room takes the whole drawing with it, and at that size nothing on any ring can be read at all. This holds when a tree gains members: a tree that takes in what a function joins to it carries more at the same radii, and it crowds rather than expanding.

#### Scenario: Center node sits at the middle of its own group
- **WHEN** an artifact is opened
- **THEN** the primary center is placed at the centre of its group's tree and is visually marked as a center

#### Scenario: A type reached only through a function is in the same tree
- **WHEN** a type has no path of type-to-type edges to the center, but a path reaches it through a function
- **THEN** it is laid out in the center's tree rather than as a tree of its own

#### Scenario: Hiding functions does not strand it
- **WHEN** function nodes are hidden and a type reached only through a function is drawn
- **THEN** it is still in the tree it belongs to, in the same place it occupies when functions are shown

#### Scenario: Nothing hangs off a node the tree does not place
- **WHEN** a node's nearest candidate parent is a type that belongs beside a function
- **THEN** it is given a parent the tree does place, and is drawn as a vertex of the tree rather than as a satellite of that class

#### Scenario: Finding the centre does not walk from every type
- **WHEN** a drawing with thousands of types chooses its own centre
- **THEN** the work is bounded by a number of walks that does not grow with the number of candidates

#### Scenario: Finding it faster does not change it
- **WHEN** the centre is found by narrowing candidates before measuring them
- **THEN** the node chosen is the one the definition alone would have chosen

#### Scenario: The same project opens on the same centre
- **WHEN** the same artifact is opened twice
- **THEN** the centre is the same node, the narrowing depending on the graph rather than on chance

#### Scenario: The centre is near what it centres
- **WHEN** a drawing chooses its own centre
- **THEN** it is a type close to the rest of the graph rather than one that can reach a great deal of it along a single chain

#### Scenario: Methods written apart from a type count toward it
- **WHEN** two types are equally near everything else, one declared in a few lines with many members recorded elsewhere and the other declared in more lines with none
- **THEN** the type with the members is the centre when its lines and members together outnumber the other's lines

#### Scenario: A member inside its declaration is not counted twice
- **WHEN** a type's recorded members all sit within its declaration's lines
- **THEN** its size is its declaration's lines, as if it recorded no members

#### Scenario: An artifact without members keeps its centre
- **WHEN** no node in an artifact records a member
- **THEN** each type's size is the lines of its declaration, and the centre is chosen on that

#### Scenario: A private type is not a subject
- **WHEN** the best-scoring type by nearness and size has a name the codebase marks as private
- **THEN** it is passed over

#### Scenario: An exception is not a subject
- **WHEN** the best-scoring type is an exception, by its own name or by what it inherits
- **THEN** it is passed over

#### Scenario: The centre does not root the drawing at a leaf
- **WHEN** a drawing chooses its own centre
- **THEN** the tree it produces does not put nearly all of itself behind one of the centre's children

#### Scenario: The reader names the centre
- **WHEN** the reader focuses a drawn node and presses the centre key
- **THEN** the drawing is rebuilt around it, and it is marked as the centre is marked

#### Scenario: The centre key is not a gesture on the right button
- **WHEN** the reader presses the right button on a node
- **THEN** the centre does not move, that gesture naming the reachable-set view instead

#### Scenario: The centre key does not fire while a name is being typed
- **WHEN** the search field has the keyboard and the reader types a name containing the centre key's letter
- **THEN** the letter goes into the field and the centre does not move

#### Scenario: The centre key with nothing focused
- **WHEN** the reader presses the centre key while no node is focused
- **THEN** the drawing is left as it is, the key having named nothing

#### Scenario: The named centre outlives the drawing it was named in
- **WHEN** the reader names a centre and later reopens that artifact
- **THEN** the drawing opens on the centre they named

#### Scenario: A centre from another artifact is ignored
- **WHEN** the reader opens an artifact that does not contain the node they named as a centre
- **THEN** that drawing uses its automatic centre, without error

#### Scenario: Naming a centre lets the node go
- **WHEN** the reader focuses a node and presses the centre key
- **THEN** no node is left focused, and a further press names nothing

#### Scenario: The reader can hand the choice back
- **WHEN** the reader focuses the node that is already the centre and presses the centre key
- **THEN** the drawing returns to the centre it would have chosen for itself, and no other setting is touched

#### Scenario: Returning every setting also returns the centre
- **WHEN** the reader returns every setting to its default
- **THEN** the centre they named goes with them, the control walking the settings rather than the panel's rows

#### Scenario: Radius increases with type depth
- **WHEN** a chain of types leads away from the center, each reached only through the previous one
- **THEN** each type in the chain is placed at a strictly larger radius than the class before it

#### Scenario: Radius depends on depth and nothing else
- **WHEN** two types sit at the same type-to-type depth from their group's center
- **THEN** they are on the same ring, whatever the shape or population of the branches leading to them, differing at most by which row of that ring an overflowing sector put them in

#### Scenario: Depth costs a step, not a multiple
- **WHEN** a tree is deep enough that some ring cannot hold its contents
- **THEN** the rings beyond it are no further out than their own depth requires, and the drawing's extent stays proportional to the tree's depth rather than growing with each level that overflowed

#### Scenario: A full ring crowds rather than expanding
- **WHEN** a ring carries more nodes than it has room for at its depth's radius
- **THEN** neither that ring nor any ring beyond it moves outward to make room, the overflow being seated in rows inside the room already there before the next ring, or left overlapping on the ring, according to the reader's choice

#### Scenario: A shared helper function does not shorten type depth
- **WHEN** two types at different type-to-type depths both use the same helper function
- **THEN** their radii still reflect their type-to-type depths, not the shorter path through the shared function

#### Scenario: Functions are satellites not tree vertices
- **WHEN** function nodes are visible
- **THEN** those functions are positioned as short-radius satellites around an attached visible type and do not occupy a position in the type tree

#### Scenario: Each disconnected group has its own center
- **WHEN** the graph contains nodes that no path reaches from the primary center, through types or through functions
- **THEN** each disconnected group is laid out as its own radial tree with its own marked center

#### Scenario: The artifact says what is internal
- **WHEN** an artifact records some of its nodes as internal
- **THEN** none of those is chosen as the drawing's centre, whatever its name looks like

#### Scenario: An artifact that says nothing keeps the name rule
- **WHEN** no node in an artifact is recorded as internal
- **THEN** a name beginning with an underscore is out of the running
