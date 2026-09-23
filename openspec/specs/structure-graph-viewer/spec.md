# structure-graph-viewer Specification

## Purpose

Defines the in-editor structure graph experience: opening the viewer from VS Code, rendering the symbol graph, adjusting visible dependency layers from a focus node, and jumping from a node to its source definition.
## Requirements
### Requirement: Artifact viewer honours the graph interaction contract
While a `*.planisphere.json` Custom Editor is active, two-step node activation, focus, neighborhood emphasis, and symbol search MUST behave according to the existing structure-graph viewer interaction contract, using locations from the loaded artifact (resolved against the workspace as needed).

#### Scenario: Click jumps from artifact
- **WHEN** the user activates a node twice in an artifact opened via Custom Editor and the node location resolves in the workspace
- **THEN** the first activation applies focus and neighborhood emphasis without navigating, and the second activation opens that file and reveals the definition line

#### Scenario: Search from the artifact viewer
- **WHEN** the user searches for a symbol in an artifact opened via Custom Editor
- **THEN** the camera moves to the matching node and applies emphasis, exactly as it does elsewhere

### Requirement: Ephemeral analyze-only panel is not the primary open path
Opening and using a structure graph MUST be achievable by opening a `*.planisphere.json` artifact. The product MUST NOT require the user to re-run analysis every time they want to view a previously generated graph.

#### Scenario: View without regenerate
- **WHEN** a valid artifact already exists and the user opens it
- **THEN** they can view and interact with the graph without running the Planisphere CLI again first

### Requirement: The artifact is read as a file, not opened as editable text
The viewer SHALL obtain an artifact's contents by reading the file. It SHALL
NOT require the editor to load that file as an editable text document first.

Nothing in the viewer edits an artifact or reads a line of one: the whole file
is parsed as JSON and the text is never looked at again. Loading it as text is
work with no reader — on CPython's 3.77MB artifact it is 89,002 lines into a
text model and a 3.77MB string handed back, about 2,100ms spent before the
viewer is asked for anything. Reading the file takes 9ms.

A change to an artifact on disk SHALL still redraw its open panel. That promise
is about the file, not about a text model, and it holds however the change
arrives — including one written by the analyzer rather than typed.

The artifact SHALL be parsed once per open and sent when the webview asks for
it. Sending it before the webview exists costs a parse and the serialisation of
the whole graph into a message that lands nowhere: 167ms on CPython, on every
cold open.

#### Scenario: Opening does not load the artifact as text
- **WHEN** the reader opens an artifact
- **THEN** the drawing is built from the file's contents, without the editor first building an editable text model of it

#### Scenario: A regenerated artifact still redraws
- **WHEN** the artifact's file changes on disk while its panel is open
- **THEN** the panel redraws from the new contents

#### Scenario: The artifact is parsed once
- **WHEN** an artifact is opened and its panel is being built for the first time
- **THEN** it is parsed once, and the graph is sent when the panel asks for it rather than before it exists

### Requirement: Command opens the structure graph viewer
The extension SHALL provide a command, invocable from the command palette and from a folder in the explorer, that produces a structure graph for a project and opens it. What it produces is an artifact on disk, opened in the editor that draws it — not an ephemeral panel, which the artifact's own requirement rules out as the primary path.

It SHALL write the artifact into the folder it analyzed, under the default name, so that what the command makes is the same thing the CLI makes in the same place. A reader who then commits it, or opens it again a week later, has what they had.

It SHALL ask only what it cannot work out. One folder with one language's source in it is run without a question. Where the workspace holds several folders, or a folder holds more than one language, it SHALL offer what it found and let the reader choose — the CLI declines there, correctly, because one artifact holds one language, and a choice is what a reader can give an editor and cannot give a script.

It SHALL show that it is working and SHALL be cancellable. Producing an artifact is seconds for a small project and half a minute for a large one: 0.2 s for flask, 2.6 s for zod, 8.4 s for jackson-databind and 26 s for guava.

A toolchain the reader has SHALL be found even where the editor's own environment does not show it. The editor may start its extension host without reading the shell files that put `cargo`, `go` or `node` on PATH, so the command SHALL look further than that PATH: the reader's login shell, and the places those toolchains install themselves.

Where an analyzer cannot run because a toolchain is absent, the command SHALL say which one and what to install, in the editor, rather than failing silently or showing a stack trace. The CLI already says it; this says it where the reader is looking.

Where the folder cannot be written to, the command SHALL say so and write nothing, rather than reporting an analyzer's failure: the artifact goes into the folder analyzed, and a read-only checkout is a folder a reader may well point it at.

The command SHALL be proven by running it in a real editor, from the package a reader installs, installed the way a reader installs it. Some faults a reader would meet exist only there: the extension host's environment may not show `cargo`, `go` or `node`, and the editor caches an extension's manifest, so a copy into the extension's folder does not refresh it and a renamed command keeps its old name through a reload. Neither is visible to a test that runs the extension's parts outside an editor rather than installing the package into one and running the command there.

The command MUST NOT be the only way to produce an artifact, and the CLI MUST NOT need the extension: they are two doors to the same analyzers.

#### Scenario: User runs visualize command
- **WHEN** the user runs the Planisphere structure graph command with a workspace folder open
- **THEN** an artifact is produced for that workspace and opened as a graph

#### Scenario: One folder, one language
- **WHEN** the reader runs the command on a workspace holding one folder whose source is one language
- **THEN** an artifact is written in that folder and opened as a graph, with no question asked

#### Scenario: More than one language under one folder
- **WHEN** the folder holds source for two analyzers
- **THEN** the command offers both and produces the artifact for the one chosen

#### Scenario: More than one folder
- **WHEN** the workspace holds several folders
- **THEN** the command offers them and analyzes the one chosen

#### Scenario: A long analysis can be abandoned
- **WHEN** an analysis is running and the reader cancels it
- **THEN** it stops, and no partial artifact is left behind

#### Scenario: A toolchain the editor does not show is still found
- **WHEN** a toolchain is installed where the reader's shell finds it but the editor's environment does not
- **THEN** the command finds it and runs the analyzer

#### Scenario: A missing toolchain is named
- **WHEN** the analyzer for the chosen language needs a toolchain that is not installed
- **THEN** the command says which one, and writes nothing

#### Scenario: A folder that cannot be written
- **WHEN** the reader runs the command on a folder they cannot write to
- **THEN** the command says the folder cannot be written, and no artifact is left anywhere

#### Scenario: Proven in a real editor
- **WHEN** the package is installed into a real editor by that editor's own installer, in a fresh user's home, and the command is run on a TypeScript and on a Go project
- **THEN** each artifact is written and opened as a graph

#### Scenario: The command is not the only producer
- **WHEN** the reader produces an artifact with the CLI instead
- **THEN** the extension opens it exactly as it opens one the command produced

### Requirement: Default display shows every edge kind
When the graph is first shown, the viewer SHALL display every edge kind the artifact carries, and each kind MUST be visually distinguishable from the others by line style or colour. The viewer SHALL NOT hide a kind at open, and SHALL NOT need a change to draw a kind the artifact contract already names.

One edge is the exception, and it is decided by what the edge joins, not by its kind. In the whole drawing, an edge that joins a unit to a node that is not a unit SHALL NOT be drawn. The units are a tree of their own and everything else is another, so every such edge crosses from one tree to the other. In hugo that is 3,187 lines and in prometheus 3,218, and drawn they lay a haze over the whole of a Go drawing. Such an edge is still drawn in the right-button view, whose subject it is when a unit is pressed. The kinds these edges carry are therefore not hidden: `contains` is drawn wherever that view shows it, and `uses` and `references` are drawn everywhere else.

#### Scenario: Initial render with mixed edges
- **WHEN** the analysis result contains `inherits`, `uses` and `references` edges
- **THEN** the initial render shows all three and they are visually distinct

#### Scenario: A kind the reader has not turned off stays on
- **WHEN** the viewer is opened on an artifact without any stored preference
- **THEN** no edge kind is hidden

#### Scenario: An edge between the two trees is not drawn
- **WHEN** an artifact carries units and the whole drawing is shown
- **THEN** no line is drawn for an edge that joins a unit to a node that is not a unit, and every other edge is drawn

### Requirement: Two-step node activation
Activating (clicking) a graph node SHALL NOT navigate to source on the first activation. The first activation on a node MUST make it the focus node and apply neighborhood emphasis. Only a second activation on that same node SHALL cause the extension host to open the node's defining file and reveal its definition range.

A collapsed group has no single definition to open — its members are in as many files as it has members — so a second activation on a group node SHALL NOT navigate. What the reader gets instead is the list of the group's members, from which activating one opens that member's file. This is the only node for which a second activation does not navigate, and it is because there is nothing single to navigate to, not because the interaction differs.

Activating a different node MUST transfer focus to that node and reset the pending-navigation state, so that navigating to the newly focused node also requires a second activation on it.

Activating anything that is not a node MUST clear the focus. Edges are not focusable, so a click on one is not an activation of anything and MUST NOT be silently absorbed.

There MUST NOT be a time limit between the two activations: this is a stateful two-step interaction, not a double-click gesture.

#### Scenario: First activation emphasizes without navigating
- **WHEN** the user activates a node that is not currently the focus node
- **THEN** that node becomes the focus node and neighborhood emphasis is applied, and no editor navigation occurs

#### Scenario: Second activation on the same node navigates
- **WHEN** the focus node was set by a previous activation and the user activates that same node again
- **THEN** the extension host opens the node's defining file and reveals its definition line

#### Scenario: Second activation on a group lists its members instead
- **WHEN** the focus node is a collapsed group and the user activates it again
- **THEN** no editor navigation occurs, and the group's members are listed beside the drawing

#### Scenario: Activating a listed member navigates to it
- **WHEN** the group's members are listed and the user activates one of them
- **THEN** the extension host opens that member's file and reveals its definition line

#### Scenario: Activating a different node resets the step count
- **WHEN** node A is the focus node and the user activates node B
- **THEN** node B becomes the focus node with neighborhood emphasis, no navigation occurs, and a subsequent activation of node B is required to navigate to B

#### Scenario: Long pause between activations still navigates
- **WHEN** the user activates a node, waits longer than a typical double-click interval, and activates the same node again with no intervening activation of another node
- **THEN** navigation occurs

#### Scenario: Activating empty canvas clears focus
- **WHEN** the user activates empty canvas space rather than a node
- **THEN** the focus node is cleared, neighborhood emphasis is removed, and all nodes and edges return to their normal appearance

#### Scenario: Activating an edge clears focus
- **WHEN** a node is focused and the user activates an edge
- **THEN** the focus node is cleared exactly as an empty-canvas click would clear it, and no navigation occurs

#### Scenario: Missing location still fails safely on the second activation
- **WHEN** the second activation targets a node whose location cannot be opened
- **THEN** the extension does not crash and the user receives a non-fatal indication that navigation failed

### Requirement: Adjacent neighborhood emphasis
While a focus node is set, the viewer SHALL visually emphasize the focus node together with every node directly connected to it by an edge of any kind in either direction, and de-emphasize every other node. An edge MUST be emphasized only when both of its endpoints are emphasized.

Adjacency SHALL NOT depend on the kind of the edge. What makes a node a neighbour is that the two are connected; a class named only in an annotation is as adjacent as one that is called.

An edge that touches the focus node SHALL be drawn at full strength, whatever other rule would have faded it. The drawing fades a line that does not explain where either of its ends sits, because those are 60% of the lines on Django and CPython and at full strength they read as the structure. That rule answers a question about the whole picture. A click asks about one node, and the line from it to a neighbour the click has just lit is the answer. Left faded, a lit node and a lit neighbour can have almost nothing drawn between them: on prometheus, 78 of the 169 edges of `Labels` are faded ones, while the nodes at their far ends are emphasised.

Only an edge that touches the focus. An edge between two of its neighbours explains nothing about the node that was clicked, and SHALL be left as it was.

This SHALL be undone whenever the node stops being the focus: when another node takes it, when the reader clears it, and when the drawing is replaced. Like every other part of emphasis it is presentation only, so nothing about what is drawn, built or placed changes with it.

The focus node MUST be distinguishable from its emphasized neighbors.

De-emphasized nodes and edges MUST remain rendered rather than hidden, so the user retains whole-graph context.

Emphasis MUST NOT change which nodes are part of the visible subgraph; it is presentation only and is independent of the layer depth controlled by the Up and Down keys.

#### Scenario: Only direct neighbors are emphasized
- **WHEN** a focus node has both a directly connected neighbor and a neighbor reachable only through one intermediate node
- **THEN** the directly connected neighbor is emphasized and the node behind the intermediate one is de-emphasized

#### Scenario: Focus node is distinguishable from its neighbors
- **WHEN** neighborhood emphasis is applied
- **THEN** the focus node is rendered distinguishably from the emphasized neighbors around it

#### Scenario: Direction is ignored when determining adjacency
- **WHEN** another node is connected to the focus node by an edge pointing toward the focus node
- **THEN** that node is emphasized

#### Scenario: Edge with one de-emphasized endpoint is not emphasized
- **WHEN** an edge connects an emphasized node to a node that is not adjacent to the focus node
- **THEN** that edge is not emphasized

#### Scenario: Remainder of the graph stays visible
- **WHEN** neighborhood emphasis is applied to a graph containing nodes that are not adjacent to the focus node
- **THEN** those nodes and their edges remain rendered in a de-emphasized appearance rather than being removed from the view

#### Scenario: Isolated focus node
- **WHEN** the focus node has no edges
- **THEN** only the focus node is emphasized and the rest of the graph is de-emphasized, without error

#### Scenario: Emphasis does not alter layer depth
- **WHEN** a focus node is set by a first activation and the user then presses Up or Down
- **THEN** the visible layer depth changes as already defined, and emphasis is recomputed against the focus node without the emphasis itself having added or removed nodes from the view

#### Scenario: Kind is ignored when determining adjacency
- **WHEN** another node is connected to the focus node only by a `references` edge
- **THEN** that node is emphasized

#### Scenario: The line to a neighbour is visible
- **WHEN** a focus node is joined to a neighbour by an edge the arrangement did not use, which is therefore drawn faded
- **THEN** that edge is drawn at full strength while the node is the focus

#### Scenario: An edge between two neighbours is not brightened
- **WHEN** two neighbours of the focus are joined to each other by a faded edge
- **THEN** that edge stays faded

#### Scenario: Moving the focus restores the edges it left
- **WHEN** the reader clicks one node and then another
- **THEN** the first node's edges are drawn as they were before it was clicked

#### Scenario: Clearing the focus restores them
- **WHEN** the reader clears the focus
- **THEN** every edge is drawn as it was before any node was clicked

### Requirement: The opening view shows the whole drawing unless that would make it too small
When an artifact is opened, the viewer SHALL frame the whole visible drawing. Where fitting it would render labels below a configured floor, the viewer SHALL stop at that floor and centre on the primary center instead, leaving the rest of the drawing off screen. The primary center MUST be on screen either way.

The floor SHALL be the reader's, offered as a setting and holding a tuned default. How much of a large project a reader wants framed for them is not settled by measurement — it is whether they would rather see the shape of the whole thing or read the names on part of it, and that differs by reader, by project and by what they came to ask. The default, 4.5, is tuned by eye: at 12 the drawing reads as far too magnified, and at 9 as still too magnified.

The setting SHALL govern every framing the viewer performs, not the one on open alone: `Reset view` and a jump from search fit the drawing by the same rule and MUST honour the same floor. It SHALL be named for that rather than for opening, since opening is one of the three occasions and a name saying so would describe the least of them — the reader meets the other two repeatedly while reading.

The setting SHALL be expressed as the smallest a label may be drawn at, not as a zoom. A zoom number means a different amount of drawing on every window size, while what the reader is choosing is whether they can still read it — which is the same question on every window. A stored value outside the range the control offers SHALL be brought into it rather than honoured or refused: a setting outlives the control that wrote it, and a drawing at an unusable magnification is worse than one at the nearest usable one.

#### Scenario: The reader chooses how much is framed for them
- **WHEN** the reader raises the smallest-label setting
- **THEN** the drawing is framed again at once, coming up more magnified with more of it off screen, and it is framed that way for every artifact until they change it

#### Scenario: The choice is not about opening alone
- **WHEN** the reader has raised the setting and later asks for the view to be reset from somewhere else in the drawing
- **THEN** that framing uses their floor too, not the default one

#### Scenario: A stored floor outside the offered range
- **WHEN** the viewer is given a stored floor above or below what the control offers, or one that is not a positive number
- **THEN** the framing uses the nearest offered value, or the default where there is no number at all, and the drawing is still usable

#### Scenario: The whole drawing on open
- **WHEN** an artifact is opened and the drawing can be fitted without labels falling below the floor
- **THEN** every visible node is within the visible area

#### Scenario: A very large drawing stops at the floor
- **WHEN** fitting the drawing would render labels below the floor
- **THEN** the view stops at the floor and centres on the primary center, and part of the drawing is off screen

#### Scenario: The primary center is on screen
- **WHEN** an artifact is opened
- **THEN** the primary center is within the visible area

#### Scenario: A tiny drawing is not blown up to fill the screen
- **WHEN** a drawing is small enough that fitting it would magnify it past the zoom ceiling
- **THEN** the zoom stops at the ceiling and the whole drawing stays visible

#### Scenario: Reopening the same artifact lands in the same place
- **WHEN** the same artifact is opened twice in the same viewport
- **THEN** the framing is identical both times

### Requirement: Reset view returns to the current group's center
`Reset view` SHALL frame the drawing the same way the opening view does. Where the reader has named a centre, that is where it returns to: saying what the drawing is about and then being taken to whichever tree the camera happened to be nearest is the viewer disagreeing with them about the thing they just settled.

Otherwise it takes the center of the group the view is currently over as the node to return to, and which group that is MUST be derived from what is on screen rather than from a setting the reader has to maintain. Nobody having said otherwise, the tree being looked at is the one to return to. When it cannot be determined, the primary center is used. Where the whole drawing fits on screen there is nowhere to return to, and Reset shows all of it.

#### Scenario: Returning to the centre the reader named
- **WHEN** the reader has named a centre and presses Reset view from anywhere in the drawing
- **THEN** the camera returns to that centre, whichever group the view was over

#### Scenario: Returning to the group being read
- **WHEN** the drawing is too large to fit, the view is over a group whose center is not the graph's primary center, and the user presses Reset view
- **THEN** the camera returns to that group's center, not to the primary center

#### Scenario: Nothing to return to when everything fits
- **WHEN** the whole drawing fits on screen and the user presses Reset view
- **THEN** the whole drawing is shown, whichever group the view was over

#### Scenario: Nothing on screen to go by
- **WHEN** the view is over empty canvas and the user presses Reset view
- **THEN** the camera returns to the primary center

#### Scenario: The group's center is not drawn
- **WHEN** the nearest group's center is hidden
- **THEN** the camera returns to the primary center rather than to a node that is not drawn

#### Scenario: Every drawn node knows its group
- **WHEN** the layout is computed
- **THEN** every node placed in a group's tree, and every satellite attached to one, reports that group; only nodes with no visible connection are left without one

#### Scenario: A single group resets to the primary center
- **WHEN** the graph has only one group
- **THEN** Reset view returns to the primary center from anywhere

#### Scenario: Reset is framed like opening
- **WHEN** the user presses Reset view
- **THEN** the framing follows the same rule the opening view follows

### Requirement: Fit the whole drawing
The viewer SHALL offer a way to frame the entire visible drawing, reachable from the keyboard, whatever that costs in label size. It MUST be discoverable without reading documentation outside the viewer.

#### Scenario: Everything visible is inside the frame
- **WHEN** the user invokes fit
- **THEN** every visible node is within the visible area

#### Scenario: Hidden nodes are not framed
- **WHEN** a node kind is hidden and the user invokes fit
- **THEN** the framing covers only the nodes that are drawn

#### Scenario: The shortcut is discoverable
- **WHEN** the user opens the legend
- **THEN** the fit shortcut is listed there

### Requirement: Symbol search
The viewer SHALL provide a search field that locates a node by name among the nodes currently visible. It MUST be reachable from the keyboard without using the mouse. Choosing a result moves the camera to that node and applies the same emphasis a first activation would, so the node's neighborhood is visible in one step. Repeating the choosing action with the same query SHALL advance to the next match rather than repeating the same one, wrapping back to the first match after the last.

A group SHALL be reachable by the name its members share, and MUST be offered once rather than once per member. A group's own members are not offered, because they all carry that one name and a search could not tell them apart if it did. What the reader is taken to is the node that stands for them, from which the list names each one.

A member a node records SHALL be offered by its own name. That a member is not drawn is the reason it must be offered rather than a reason to leave it out: nothing else in the document names it, and the list beside the drawing is the only other way to reach one. Prometheus records 4,429 methods over 699 types; its source holds 36 methods named `Append`, 86 named `Close`, 28 named `Run` and 5 named `Start`, and none of them is a node.

Choosing a member SHALL take the reader to the node that records it, framed as choosing that node would frame it, and SHALL mark that member in the list beside the drawing. It MUST NOT open a file: the same key press is how the reader walks the matches, and a key that moves a camera on one press and opens an editor on the next is two gestures on one key. Every member has a node to move to, the one that records it, and many members name that node themselves: Java's constructors are 10% to 12% of the members its analyzer records, 2,493 of guava's alone.

Opening a member SHALL remain the list's own gesture: the row is where the reader opens it. Choosing a node SHALL move the camera to it and emphasize it as described above.

A node whose name is written in segments SHALL be matched by its last segment as well as by the whole name, and matched as exactly as if that segment were its name. It is what the label shows and what a reader types: guava's node is `LocalCache.ManualSerializationProxy`, and a reader looking for it types `ManualSerializationProxy`.

Where a node and a member match a query equally well, the node SHALL be offered first. A member is offered because nothing else in the document names it; a node of that name, on screen, is what the reader was looking for. Java makes the two collide by construction — a constructor is a member named after its type — and in guava all 18 members matching `SerializationProxy` are constructors.

#### Scenario: Choosing a member moves the camera to its node
- **WHEN** the user chooses a member from the search results
- **THEN** the camera moves to the node that records it, no file is opened, and that member is marked in the list beside the drawing

#### Scenario: Walking the matches opens nothing
- **WHEN** the user presses the search key repeatedly over matches that include members
- **THEN** no editor is opened by any of those presses

#### Scenario: A segmented name is found by its last segment
- **WHEN** the user types a name that is the last segment of a visible node's segmented name
- **THEN** that node is offered as an exact match

#### Scenario: A node outranks a member of the same name
- **WHEN** a query matches both a visible node and a member equally well
- **THEN** the node is offered first, and choosing it moves the camera rather than opening a file

#### Scenario: Finding a symbol by name
- **WHEN** the user types a name that matches a visible node and chooses it
- **THEN** the camera moves to that node, framed on its visible neighborhood rather than on the whole drawing, and its direct neighbors are emphasized

#### Scenario: A collapsed group is found by its shared name
- **WHEN** the user types the name that a collapsed group's members share
- **THEN** the group is offered as a single match, and choosing it moves the camera to the group node

#### Scenario: A sparse neighborhood does not fill the screen
- **WHEN** the chosen node has only one or two visible neighbors
- **THEN** the zoom stops at a ceiling tighter than the one Open and Reset use, expressed as a minimum area of the drawing rather than as a fixed zoom number, so it holds regardless of viewport size

#### Scenario: The whole neighborhood stays centered, not just the chosen node
- **WHEN** the camera frames a chosen node together with its visible neighbors
- **THEN** the framing is centered on that whole group, so a node whose neighbors sit unevenly around it does not itself sit dead center

#### Scenario: Repeating the choice advances to the next match
- **WHEN** the user chooses again without changing the typed text
- **THEN** the camera moves to the next match in ranked order rather than the one just shown

#### Scenario: Choosing wraps around after the last match
- **WHEN** the user has just been shown the last match and chooses again without changing the typed text
- **THEN** the camera returns to the first match

#### Scenario: Changing the query restarts from the first match
- **WHEN** the user edits the typed text and then chooses
- **THEN** the camera moves to the first match of the new query, not to wherever the previous query's cycle had reached

#### Scenario: Search is reachable from the keyboard
- **WHEN** the user presses the search shortcut
- **THEN** the search field takes keyboard focus

#### Scenario: Matching is forgiving
- **WHEN** the user types part of a name, in any letter case
- **THEN** visible nodes whose names contain that text are offered

#### Scenario: No match
- **WHEN** nothing matches what was typed
- **THEN** the viewer says so and leaves the current view untouched

#### Scenario: A hidden node's name does not match
- **WHEN** a node whose kind is currently hidden has a name that would otherwise match
- **THEN** that node is not offered, and typing its full name reports no match

#### Scenario: The same name matches once its kind is shown again
- **WHEN** the user reveals a hidden kind and repeats a search that found nothing while it was hidden
- **THEN** nodes of that kind are now offered

#### Scenario: Leaving search
- **WHEN** the user dismisses the search field
- **THEN** keyboard interaction returns to the graph and the current framing is kept

#### Scenario: A member is offered by its own name
- **WHEN** the user types the name of a method a node records
- **THEN** that member is offered as a match

#### Scenario: A group's members are still not offered
- **WHEN** the user types the name a collapsed group's members share
- **THEN** the group is offered once, and its members are not offered individually

### Requirement: Search highlights matches as the user types
While the search field holds at least a configured minimum number of characters, the viewer SHALL highlight every currently matching node and de-emphasize everything else, without waiting for the query to be chosen. The set highlighted MUST update on every keystroke, narrowing as the query narrows.

#### Scenario: Below the minimum, nothing is highlighted
- **WHEN** the search field holds fewer characters than the minimum
- **THEN** no node is highlighted or de-emphasized because of search

#### Scenario: At or above the minimum, matches light up live
- **WHEN** the search field holds at least the minimum number of characters
- **THEN** every currently matching node is highlighted and every other visible node is de-emphasized, with no separate action required

#### Scenario: Narrowing the query narrows the highlight
- **WHEN** the user types an additional character that narrows the set of matches
- **THEN** the highlighted set shrinks to match, never grows

#### Scenario: No live matches de-emphasizes everything
- **WHEN** the query is at or above the minimum length and matches nothing
- **THEN** every visible node is de-emphasized and none is highlighted

#### Scenario: Choosing a result replaces the live highlight
- **WHEN** the user commits to a result, by Enter or otherwise
- **THEN** the live search highlight is replaced by the normal focus emphasis on the chosen node, not shown alongside it

#### Scenario: Leaving search clears the live highlight
- **WHEN** the user leaves the search field without choosing a result
- **THEN** the live highlight is cleared and whatever emphasis existed before search began is what remains visible

#### Scenario: Visibility changes do not leave a stale highlight
- **WHEN** a node kind is hidden or shown while a live search highlight is active
- **THEN** the highlight is recomputed against the newly visible set rather than continuing to reflect the old one

### Requirement: Webview cannot navigate the editor alone
Source navigation MUST be performed by the extension host in response to messages from the Webview. The Webview MUST NOT be required to call editor APIs directly.

#### Scenario: Message bridge for jump
- **WHEN** the user clicks a node in the Webview
- **THEN** the Webview posts a jump request message and the extension host performs `showTextDocument` / reveal based on that message

### Requirement: Satellite attachment for functions in ego class ring mode
While ego class ring layout is active, each visible function MUST be positioned relative to exactly one already-positioned node it shares an edge with, chosen deterministically.

Preference is by edge, then by distance. A function that shares an edge with a visible type is attached to such a type, preferring the one closest in hops to the focus. A function that shares an edge with no visible class is attached to the nearest visible function that is itself attached to a class, following function-to-function edges outward from all such functions at once, so that the shortest chain of edges wins.

A function MUST NOT be positioned as a satellite of a node it shares no edge with. Placing it beside an unrelated node draws a relationship the graph does not contain, and the reader has no way to tell that relationship from a real one.

A function with no path to any visible type through function edges is not part of the type structure and MUST NOT be placed as though it were. It is treated as an isolated node and placed with them.

#### Scenario: Function linked to a ring class sits by that class
- **WHEN** ego class ring layout is active and a visible function has an edge to exactly one visible class on a ring (or the focus)
- **THEN** that function is positioned as a satellite of that class

#### Scenario: Multi-class function attaches nearer the focus
- **WHEN** ego class ring layout is active and a visible function has edges to multiple visible classes
- **THEN** it is attached for layout to a visible class among those neighbors that is closest in hops to the focus

#### Scenario: Function reached only through other functions
- **WHEN** a visible function has no edge to any visible class, but has an edge to a function that is attached to one
- **THEN** it is positioned as a satellite of that function, not of any class

#### Scenario: The shortest chain of edges wins
- **WHEN** a visible function can reach class-attached functions through chains of function edges of differing lengths
- **THEN** it is attached along the shortest such chain, and ties are broken deterministically so that reopening the artifact produces the same drawing

#### Scenario: Functions are not gathered beside a node they have no edge to
- **WHEN** several visible functions have no edge to any visible class
- **THEN** none of them is positioned beside a node it shares no edge with, and in particular they are not collected around one node in common

#### Scenario: Function with no path to the class structure
- **WHEN** a visible function has no path to any visible class, whether directly or through other functions
- **THEN** it is placed with the isolated nodes rather than beside part of the class structure

### Requirement: Sibling subtrees partition their parent's sector, and one too narrow grows a row
In the tree layout, every parent SHALL divide its own angular sector among its children so that each child receives a sector proportional to the number of leaves in that child's subtree, and no two sibling sectors overlap. A subtree placed inside its allotted sector MUST stay within that sector at every depth below it. The guarantee applies to nodes placed as tree vertices; satellite nodes orbiting a vertex are governed by their own separation from other satellites of the same vertex.

A sector too narrow to seat its children a node diameter apart SHALL by default seat them all on the ring their depth gives them, closer together than a node diameter. The reader MAY instead choose to have the childless ones seated outward, in rows within the room between their ring and the next one.

The arc is the default although it measures worse, because the drawing's whole vocabulary is circles — a ring marks a level, and a reader counts rings to see how far a node sits from its centre. Rows turn each arc into a run of small rectangular blocks hanging off it, and what a reader opens on is then a grid rather than a star system. The overlapping is real, and the other choice is what it is for. Neither answer is better than the other and no measurement settles it: what differs is what the picture looks like, so the choice is the reader's. On the ring, 5,279 pairs of Django's tree vertices overlap and 1,760 of CPython's, with 93% of Django's labels colliding with another label; in rows, 1,975 and 567.

Only a child with no children of its own SHALL be moved. A row reuses the angular slots of the row inside it, which is harmless for a leaf and not for anything else — a subtree hanging off a moved node would land on the subtree of the node in the same slot one row in. 86% of Django's overflow is leaves and 89% of CPython's, so the restriction costs little.

The rows SHALL NOT reach the next ring, and no ring SHALL move for them. Moving a ring moves every ring outside it: letting the rows push outward freely would take Django's drawing from 6,454x3,421 to 11,707x6,570 and its magnification from 0.186 to 0.102, a bigger drawing shown smaller. Held inside the room that is already there, the same relief costs nothing — Django's drawing stays 6,499x3,418 and its overlapping pairs fall to 1,975, CPython's to 567.

Widening the rings SHALL NOT be used for this. At a ring step of 400 rather than 180 Django's drawing grows 2.2x in each axis to buy 9% fewer tight pairs, and since the whole drawing must then be shown 2.2x smaller the gap on screen comes out worse: 0.37px at a step of 180, 0.34px at 400.

A level that still does not fit SHALL stay crowded. Sectors stay disjoint whether or not they are full, so what crowding remains is shared among nodes of one level and never reaches a sibling's sector or another depth.

#### Scenario: Wide subtree gets a wider sector
- **WHEN** a class has two child classes whose subtrees contain 20 and 2 descendant classes
- **THEN** the first child's angular sector is wider than the second child's, in proportion to their leaf counts

#### Scenario: Descendants stay inside the ancestor sector
- **WHEN** a class subtree is allotted an angular sector
- **THEN** every class positioned within that subtree has an angle inside that sector

#### Scenario: Crowding stays on one ring
- **WHEN** the layout is computed for any graph
- **THEN** no two nodes placed as tree vertices at different depths are positioned closer than one node diameter apart

#### Scenario: A crowded level opens as one arc
- **WHEN** a sector is too narrow to seat all of a node's children a node diameter apart and the reader has expressed no preference
- **THEN** they are all seated on the ring, closer together than a node diameter, and nothing is placed at a larger radius

#### Scenario: Narrow sector grows a second row
- **WHEN** a sector is too narrow to seat all of a node's children a node diameter apart and the reader has chosen rows
- **THEN** the childless ones are seated in rows outside that ring rather than jammed onto it

#### Scenario: A child that carries a subtree keeps its place
- **WHEN** a sector overflows and some of the children have children of their own
- **THEN** those stay on the ring, and only the childless ones are moved outward

#### Scenario: No ring moves for a row
- **WHEN** a sector overflows by more than the room between its ring and the next can hold
- **THEN** the rows stop short of the next ring and the remaining children stay crowded, rather than any ring being pushed outward

#### Scenario: A row is not a level
- **WHEN** children are seated in rows outside their ring
- **THEN** no ring is drawn at a row's radius, the rings still marking the levels of the tree

#### Scenario: The reader can keep the level on one ring
- **WHEN** the reader chooses to seat a crowded level on its ring
- **THEN** every child of an overflowing sector sits on the ring its depth gives it, closer together than a node diameter, and nothing is placed at a larger radius

#### Scenario: A sector with room is untouched
- **WHEN** a sector is wide enough for all of its children
- **THEN** every one of them sits on the ring its depth gives it

#### Scenario: Layout is stable across reopens
- **WHEN** the same artifact is laid out twice
- **THEN** every node receives the same position both times

### Requirement: Every graph shape produces a layout
The viewer SHALL produce positions for every node of any graph it is given, whatever that graph's shape. In particular it MUST NOT depend on the graph containing type nodes, on any node having more than one neighbour, or on the graph being connected.

Layout SHALL stay within a few seconds on the largest project the viewer targets — Angular, at 8,763 nodes and 28,324 edges, which opens in six to seven seconds. It is NOT required to grow linearly, and it does not: Angular is 2.5 times CPython's nodes plus edges and takes 7.6 times as long.

The bound is absolute and set on the largest target because that is what the reader experiences. A growth rate would also catch a regression, but it is not true of this layout and it is not about the wait. Six seconds to open a drawing that is then read for an hour is a cost the reader has weighed and accepted — a bound expressed as a growth rate cannot tell that from six milliseconds or six minutes.

The bound SHALL be checked by a guard that does not depend on how fast the machine running it is. An absolute time budget is not about the code: laying that graph out in the test harness also builds every element in a stubbed DOM, which takes anywhere from 9.6 to 23.6 seconds on a quiet machine and 34 to 35 with two runs at once, so a twenty-second budget sits inside the noise and fails on a busy machine rather than on a regression. What SHALL be guarded instead is the shape of the cost — the largest project against a smaller one, laid out in the same process at the same moment. That ratio stays between 2.6 and 4.2 while the times themselves move by two and a half times, and the bound is twice the worst of it. Where an artifact has not been generated the check is skipped rather than passed.

A component that holds a type SHALL be drawn as a tree even when no type in it can be its root. Where its only types are ones that belong beside a function, the type sits beside its function and the function is what the tree is rooted on — `CurvesTurtle` and the `main` that uses it are one such component, and leaving them among the nodes that have no connection to anything would say the opposite of what their edge says. The root is then chosen from the component's own members by the same criterion the whole graph uses.

A component with no type in it SHALL stay among the unconnected nodes. `ctypes/macholib/dyld.py` is thirteen functions that call each other; that is a module's internals rather than a piece of the structure the drawing is about, and drawing it as a tree of its own would spend a place in the arrangement on it. What the tree exists to place is a type.

A tree whose root is not a type SHALL be arranged after every tree whose root is one, rather than among them by size. It is a different kind of thing from a type tree, not a smaller one, and reading the type trees first and the rest afterwards is what says so.

A tree whose root is not a type SHALL NOT be coloured as the graph's entry point. That colour says where the graph starts and there is one such place; a tree rooted on a function exists because its component had no type to root on, and painting it the entry colour puts that mark on a module's internals. It is still that tree's centre and is marked as one; it keeps the colour its kind has. The graph's own centre keeps the entry colour whatever its kind, since on a graph with no types at all it is a function or a file and it is still where the graph starts.

A tree whose root is not a type SHALL draw no rings. A ring marks a level of a type tree; a tree rooted on a function has no such levels to mark, and its root is not drawn in the default view, so a ring there would be a faint circle around nothing — 46 of them on CPython, the largest 558px across. The test is the root's kind and not what is currently shown, so the rings remain the same set whether functions are visible or not.

#### Scenario: Graph with no types
- **WHEN** a graph contains only function and file nodes
- **THEN** a root is chosen from the most-connected node and every node receives a position

#### Scenario: A component whose only type belongs beside a function
- **WHEN** a component holds one type and the function that uses it, and nothing else reaches either
- **THEN** the component is drawn as a tree rooted on the function, with the type beside it

#### Scenario: A component of only functions stays in the cluster
- **WHEN** a graph contains types, and also a group of functions connected only to each other and holding no type
- **THEN** that group stays among the unconnected nodes and none of its members becomes the root of a tree

#### Scenario: Function-rooted trees read after the type trees
- **WHEN** the drawing holds trees rooted on a type and trees rooted on a function
- **THEN** every type-rooted tree is arranged before every function-rooted one, whatever their sizes

#### Scenario: A function-rooted tree is not painted as the entry point
- **WHEN** a tree is rooted on a function because its component held no type to root on
- **THEN** that root is drawn in the colour its kind has, not in the colour that marks where the graph starts

#### Scenario: A graph with no types still marks its entry point
- **WHEN** a graph contains only functions and files, so its own centre is a function
- **THEN** that centre is drawn in the entry colour

#### Scenario: A function-rooted tree draws no rings
- **WHEN** a tree is rooted on a function
- **THEN** no ring is drawn around it, whether function nodes are shown or hidden

#### Scenario: A node with no edges stays in the cluster
- **WHEN** a node has no edge to anything
- **THEN** it is placed among the unconnected nodes

#### Scenario: Star-shaped graph
- **WHEN** one node has several hundred direct children
- **THEN** those children are placed on the one ring their depth gives them, at distinct positions, crowding together where the ring cannot seat them a node diameter apart

#### Scenario: Deep chain
- **WHEN** a chain of nodes descends many levels, each with exactly one child
- **THEN** the radius step along the chain is compressed so the drawing does not grow without bound, while radius still increases at every step

#### Scenario: Large graph stays responsive
- **WHEN** a graph contains several thousand nodes
- **THEN** the layout completes fast enough to re-run when node visibility changes, and no two nodes share a position

#### Scenario: Empty graph
- **WHEN** a graph contains no nodes
- **THEN** the viewer reports an empty graph rather than failing

### Requirement: Disconnected groups fill the space beside one another
The viewer SHALL arrange disconnected groups so that the bounding box of the whole drawing is closer to the viewport aspect ratio than to a single row. The group holding the graph's primary center SHALL read first. Groups MUST NOT overlap one another.

A group SHALL be placed where there is room for it, taking the lowest space it fits into rather than continuing a row. A row is as tall as the tallest group in it, so twenty small groups beside one large one leave the whole height of the large one empty beside them: packed in rows, CPython's three rows fill 55%, 16% and 15% of themselves, and 58% of the canvas holds nothing.

Groups SHALL be placed in descending size order, so the largest take the lowest and leftmost room and the drawing still broadly runs large to small. That is an order of placement and not of reading: a small group may sit above and to the right of a larger one, which is the price of the space it fills.

No group SHALL be placed above the first group's own topmost node. A group's reserved room holds the whole circle its outermost ring draws, and that circle reaches above every node on it — 387px above CPython's topmost class and 299px above Django's. A group placed flush with the top of that room sits in a band the drawing has nothing in, and reads as floating over the picture rather than beside it. The room the rings need above the first group's content is left empty.

The cluster of unconnected nodes SHALL be placed in the room that shows the whole drawing largest, and MAY run past the width the arrangement aims at. That width is a shape to aim at, not an edge the canvas has: held to it, a cluster 5,701px wide against a target of about 8,900 cannot stand beside the primary tree and falls to the only place left, underneath everything — leaving the region right of the primary tree and below the small ones empty, 4,234x2,683 of nothing against the 5,701x1,572 that is looking for somewhere to go. It MUST NOT simply take the lowest room, which is the far right where nothing has been placed; put there, CPython's canvas grows to 14,465px wide for it.

How large the drawing can be shown is not how small it is. A drawing is read at whatever magnification fits it into a viewport, so the cost of a placement SHALL be what a viewport of the arrangement's target proportion has to divide by — the greater of its width over that proportion and its height — and not the area it covers. The two disagree exactly where one tree stands alone: on FastAPI the cluster underneath makes 1,715x2,276 against 3,000x1,530 beside, 18% less area and a fifth less magnification, and the smaller drawing puts the block in the bottom-right corner rather than beside the tree the reader is looking at.

Where two placements show the drawing at the same size, the further right SHALL be taken: this is the block with nothing to say about the structure, so it belongs away from the corner the reader starts in.

The unconnected nodes SHALL be arranged as two discs, one above the other: the nodes that functions orbit, and the functions. A single disc comes out 3.6 times wider than it is tall, because the arrangement inside it is isotropic and the exclusion its labels need is that shape — and at that width it cannot stand beside a tree at all, so it falls underneath and *where* it falls stops being the same answer from one graph to the next. Two stacked discs are about 1.9 to 1 and stand beside the trees on every sample project that has room for them. The split SHALL be on kind and not merely in half, because kind is what decides where a node sits: cut in half, the first disc's middle would hold a function.

It SHALL clear what is drawn rather than what the groups reserve. A group's room holds the whole circle its outermost ring draws, and that circle reaches 442px below CPython's lowest class; clearing the reservation would put the cluster 624px below anything visible and 1,217px from the nearest node of any tree, which reads as adrift rather than as part of the drawing. A ring passing behind this cluster costs nothing that the rule about rings exists to protect: these are nodes with no edge to anything, so there is no tree here for one of them to be read as part of.

The gap between two groups SHALL be what it takes to read them apart, and not what it takes to keep their rings apart. Room reserved for a group already contains its outermost circle, so two groups placed without overlapping already have circles that do not overlap; a gap sized as though it did not is a second reservation on top of the first, and at 360px it is almost three times the width of the small groups it separates.

What a group occupies SHALL include the rings drawn around it, not only the nodes it holds. A ring is a full circle at the radius of the tree vertices on it, and a ring's outermost radius is often carried by one or two nodes — so the rectangle around a group's nodes stops where those nodes are while the circle continues all the way round, by as much as 721px on CPython. Reserving the nodes alone lets one group's orbits enclose another group entirely.

No ring SHALL cross into another group: not over its nodes, and not across its rings. This is a promise about the drawing, so it holds for every graph rather than for the ones that happen to pack loosely.

#### Scenario: A small group fills the space beside a large one
- **WHEN** one group is far taller than the others
- **THEN** the smaller groups are placed beside it, in the space its height leaves, rather than below it

#### Scenario: The center's group reads first
- **WHEN** the graph's primary center lies in a group that is not the largest
- **THEN** that group is still placed first, so the eye lands on the marked center

#### Scenario: Bigger groups are placed first
- **WHEN** disconnected groups are arranged
- **THEN** they are placed in descending size order, so a larger group never has to fit around a smaller one that was placed before it

#### Scenario: Group size counts the same thing for every group
- **WHEN** groups are ordered by size
- **THEN** each group's size counts its tree vertices, not its total node count

#### Scenario: Groups do not overlap
- **WHEN** two disconnected groups are placed
- **THEN** the regions they occupy are separated by at least the configured group gap

#### Scenario: A group's rings stay inside the room it reserves
- **WHEN** a group's outermost ring is carried by fewer nodes than would span the circle
- **THEN** the room reserved for that group still contains the whole circle, not just the nodes on it

#### Scenario: One group's rings never enclose another group
- **WHEN** a large group is packed beside a small one
- **THEN** no node of the small group lies inside any ring of the large one

#### Scenario: Two groups' rings never cross
- **WHEN** any two groups are placed
- **THEN** no ring of one intersects any ring of the other

#### Scenario: Nothing floats above the first group's content
- **WHEN** a group is placed beside the group holding the primary centre
- **THEN** it is not drawn above that group's topmost node, however much empty room its rings reserve up there

#### Scenario: The unconnected nodes fill the emptiest room
- **WHEN** a tall group leaves a region beside it that the unconnected nodes fit into, even though they are wider than the arrangement's target width
- **THEN** they are placed there rather than below everything, and the drawing does not grow a column of its own for them

#### Scenario: The unconnected nodes do not take the lowest room
- **WHEN** the room furthest right has nothing placed in it and is therefore the lowest
- **THEN** the unconnected nodes are not put there, because it would make the drawing far wider than leaving them where they fit

#### Scenario: The unconnected nodes are two discs
- **WHEN** the unconnected nodes include both functions and the kinds functions orbit
- **THEN** they are drawn as two discs one above the other, the functions in the lower one

#### Scenario: A tie goes away from the reader
- **WHEN** two placements show the drawing at the same size
- **THEN** the further right of them is taken

#### Scenario: The lone tree still gets the cluster beside it
- **WHEN** the drawing holds one group and nothing else for the unconnected nodes to stand under
- **THEN** they are placed to the right of that group, within its vertical band, rather than below it in the corner

#### Scenario: A wider drawing is preferred to a taller one of the same content
- **WHEN** one placement makes the drawing wider and another makes it taller by a comparable amount
- **THEN** the wider one is taken while the drawing is still no wider than its target proportion asks for, that being the one a viewport can show at greater magnification

#### Scenario: The unconnected nodes sit close under the drawing
- **WHEN** a group's outermost ring reaches well below its lowest node
- **THEN** the unconnected nodes are placed just under what is drawn rather than under that ring's reach, and the ring passes behind them

#### Scenario: The gap does not dwarf what it separates
- **WHEN** several small groups are placed beside one another
- **THEN** the space between two of them is not several times their own width

### Requirement: The layout is computed once; visibility only hides
The viewer SHALL compute node positions once, when an artifact is opened, from the whole artifact. Changing which node kinds are shown SHALL change only what is drawn: the hidden nodes and the edges that touch them disappear, and every node that remains stays exactly where it was.

Positions are therefore not derived from what is visible. A drawing does reserve room where a hidden node would be, and that is the trade, and it costs nothing, because the space spent placing a class far from everything it relates to — merely because the relationship runs through a hidden function — is larger than the gaps hidden satellites leave. CPython's default view comes out 7,971×5,638 rather than 9,459×7,869, and its median nearest-neighbour distance is 10px either way.

A class whose only relationships run through functions is therefore placed beside what it relates to from the start. It carries no line while those functions are hidden, because there is nothing drawn for a line to reach.

Because relationships through functions count, parts of the graph that reach each other only through functions SHALL NOT be drawn as separate groups merely because the connection is not on screen. CPython draws 10 groups rather than 42 and leaves 95 nodes unconnected rather than 210.

A group is still rooted in class-to-class structure: a class that reaches the main tree only through a function keeps a group of its own rather than being absorbed into it, and is placed beside the function it reaches through. Islands that a function joins are not counted separately from each other.

#### Scenario: Hiding a kind moves nothing
- **WHEN** the reader turns functions off
- **THEN** the functions and the edges touching them are no longer drawn, and every other node is exactly where it was

#### Scenario: Showing a kind moves nothing either
- **WHEN** the reader turns functions back on
- **THEN** they appear beside the nodes they belong to, and nothing that was already drawn moves

#### Scenario: A class related only through functions is already in place
- **WHEN** the viewer opens with functions hidden and a class's only neighbours are functions
- **THEN** it is drawn beside one of those functions, with no line

#### Scenario: The line appears where the node already is
- **WHEN** the reader then shows the functions
- **THEN** the line is drawn through them and neither class moves

#### Scenario: Islands joined by a hidden function are one island
- **WHEN** two parts of the graph, neither of them the main tree, reach each other only through functions, and functions are hidden
- **THEN** they are drawn as one group rather than as two

#### Scenario: A group is still rooted in class structure
- **WHEN** a class reaches the main tree only through a function
- **THEN** it keeps a group of its own rather than joining the tree's, and is drawn beside the function it reaches through

#### Scenario: The camera holds its place across a toggle
- **WHEN** the function visibility toggle is flipped in either direction
- **THEN** zoom is unchanged and the node that was nearest the middle of the viewport is still under the same pixel, provided it is still visible

#### Scenario: Hiding a kind that would empty the canvas is refused
- **WHEN** hiding a node kind would leave nothing to draw, as in a project written entirely as functions
- **THEN** those nodes stay visible

#### Scenario: Reopening the same artifact gives the same drawing
- **WHEN** the same artifact is opened twice
- **THEN** every node is in the same place both times, whatever kinds were shown in between

### Requirement: Every drawn node carries a label that is its alone
No two nodes drawn at the same time SHALL carry the same label. Where a name is shared, the viewer SHALL add the least that tells the sharers apart, and add nothing to a node whose name is already its own.

Where a name is written in segments — a type declared inside a type, `Maps.KeySet` — the label SHALL be the shortest trailing run of those segments that no other drawn *name* can be written as. Two nodes of one name are one symbol seen twice — guava declares every class again under `android/` — and a path tells those apart; counted as two claimants, each twin would block the other and nothing in that drawing could shorten at all. The whole chain is what identifies the node in the document; on screen it is the last segment or two that is read, and Java writes chains three deep: `WorkerThreadPoolHierarchicalTestExecutorService.WorkQueue.Entry`. Showing the shortest run that stays unique takes junit5's labels over 40 characters from 215 to 73, jenkins's from 143 to 33 and jackson's from 76 to 11.

For an ordinary node, what is added is the path components where the sharers' paths part — the components at which they differ, in path order, and no others — written as a path before the name: `models/Header` beside `params/Header`, `asyncio/Queue` beside `multiprocessing/Queue`. The fewest of those components SHALL be taken, chosen for what they separate rather than in order: guava holds `ForwardingBlockingDeque` in two packages and mirrors both, and the depth that tells the packages apart says nothing about the mirrors, so taking depths in order would write every depth between them into the label — seven components. Where two components separate equally, the one nearer the file is taken, being the more specific. "As many" is decided per group of same-named nodes, so a name needing one component does not get two.

A unit's node SHALL be told apart by its directory rather than by the file its declaration sits in. Which of a package's files carries the node is an accident of which sorts first, and guava's two source roots pick different ones: told apart by file, its two `com.google.common.util.concurrent` nodes would carry a benchmark's file name, which describes neither of them.

Taking instead every component from the parting to the end makes a label as long as the path. guava mirrors its sources under `android/`, so each of its classes exists twice under paths that agree everywhere but their second component: taken that way, 3,232 of that drawing's 3,313 labels would carry a path, the longest 166 characters, and a label has no width limit in the drawing.

For a group of collapsed siblings, the count is already part of the label, and where that is enough nothing more is added. Where it is not — two groups of the same name holding the same number of classes — what is added is the base class the group is keyed on. Path cannot serve here: Django's two `Deserializer` groups have every member in one directory, and CPython's two `IncrementalDecoder` groups likewise, so the only thing that differs is the base that defined them.

The rule SHALL be applied to the nodes currently drawn, not to the artifact. Showing a hidden kind can put a second `Error` on screen, and both gain a path at that moment; hiding it again takes the path away. A node MUST NOT carry a path because of a node the reader cannot see — which is why labels follow visibility although positions do not: a path is there to be read, and there is nothing to tell apart from something that is not on screen.

Search SHALL continue to match the plain name. The path is what a reader sees, not what they type: a reader who types `Error` must be offered every `Error` on screen, whatever each one is labelled.

#### Scenario: A repeated name gains the path that tells it apart
- **WHEN** two visible nodes share a name and their files differ in the last path component
- **THEN** each is labelled with that component followed by the name

#### Scenario: Only the components that separate
- **WHEN** four visible nodes share a name, two telling apart by an early component and two by a later one
- **THEN** each label carries those two components and nothing between them

#### Scenario: A unit is told apart by its directory
- **WHEN** two visible unit nodes share a name and their declarations sit in files of different names in mirrored directories
- **THEN** neither label carries a file name

#### Scenario: Paths that part near their front
- **WHEN** two visible nodes share a name and their paths differ only in an early component, agreeing everywhere after it
- **THEN** each is labelled with that component followed by the name, and not with everything between it and the file

#### Scenario: A segmented name is shortened to what is its own
- **WHEN** a drawn node's name is written in segments and no other drawn node's name ends with its last segment
- **THEN** its label is that last segment alone

#### Scenario: A segmented name keeps what it needs
- **WHEN** two drawn nodes' names end with the same segment
- **THEN** each label carries as many further segments as it takes to tell them apart, and a path only if the segments cannot

#### Scenario: A unique name is left alone
- **WHEN** a visible node's name is carried by no other visible node
- **THEN** its label is the name, with no path

#### Scenario: Only as much path as the ambiguity needs
- **WHEN** one repeated name is told apart by one path component and another needs two
- **THEN** the first gets one and the second gets two

#### Scenario: Files are disambiguated too
- **WHEN** several visible file nodes share a filename
- **THEN** each is labelled with the directory that tells it apart, followed by the filename

#### Scenario: A group whose count already tells it apart gains nothing
- **WHEN** two groups share a name and hold different numbers of classes
- **THEN** each is labelled with its name and its count, and neither gains a base

#### Scenario: Two groups of the same name and size are told apart by their base
- **WHEN** two groups share a name and hold the same number of classes
- **THEN** each label also names the base class its group is keyed on

#### Scenario: Ambiguity follows what is drawn
- **WHEN** a node's name is unique while a kind is hidden, and a node of that kind shares the name
- **THEN** the label carries no path while the kind is hidden, and gains one when it is shown

#### Scenario: Searching uses the name, not the label
- **WHEN** the reader types a name shared by several visible nodes
- **THEN** every one of them is offered, and the typed text does not have to include any path

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

How much of a type there is SHALL be the lines of its declaration and one for each member the artifact records outside those lines. Where a language writes a type's methods apart from its declaration, the declaration is not the type: sqlparser-ranger's `Parser` is declared in 6 lines and has 69 methods in `impl` blocks, while `TokenKind` is 205 lines of variants, and measured by lines alone the drawing would be centred on `TokenKind`. A member written inside the declaration — a Rust trait's methods, 590 of syn's and 125 of tokio's — is already counted by its lines and SHALL NOT be counted again. A member counts one and not its own lines, because the size enters as a logarithm to settle ties and a count is enough for that; counting a method's lines as well chooses the same primary centre on all nine Go and Rust fixtures. An artifact that records no members is sized by its lines alone: none of the eight Python and four TypeScript fixtures carries one. On Go and Rust, counting members decides the primary centre on four of nine: sqlparser-ranger's is `Parser`, hugo's `HugoSites`, prometheus's `Head`, and gin's `Context` rather than `Engine`.

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

### Requirement: The right button shows what a node points to, two steps out
The viewer SHALL, on the right button over a node, draw only that node, the nodes it points to, and the nodes those point to — two steps out along edges in their own direction, and no further. An edge pointing at the node MUST NOT be followed. Where `A` uses `B` uses `C` and `D` uses `A`, the right button on `A` shows `A`, `B` and `C`, and not `D`; where `A` inherits `B` inherits `C` inherits `D`, the right button on `B` shows `B`, `C` and `D`.

It SHALL follow every edge kind, and SHALL leave nothing out on any other ground: a node the pressed one points to is in the set even where it also points back, being by definition one of the nodes the pressed one points to. A node's distance SHALL be its nearest — a node one step out along one path and three along another is one step out.

This is the reader's definition, and the other readings do not serve it. Everything reachable runs to 149 nodes for Angular's `FieldTree`, whose own definition names five types, and puts the median view at 42 types on Django and 110 at the 90th percentile on Angular. Ancestors alone show a node by itself on 71% of Angular's types. Two steps is `FieldTree`'s five and what they name — eight nodes — with a median view of 3 types on Angular and 4 on Django.

It SHALL pass through nodes that are not currently drawn, counting each as a step like any other, so that the set does not depend on what is being shown.

A node that points at nothing SHALL be shown alone rather than refused, and the viewer MUST make that read as an answer — see the strip below.

#### Scenario: The reader's example
- **WHEN** `A` uses `B` uses `C`, `D` uses `A`, and the reader presses the right button on `A`
- **THEN** the drawing shows `A`, `B` and `C`, and not `D`

#### Scenario: A lineage
- **WHEN** `A` inherits `B` inherits `C` inherits `D`, and the reader presses the right button on `B`
- **THEN** the drawing shows `B`, `C` and `D`, and not `A`

#### Scenario: Two steps and no further
- **WHEN** a chain runs three steps out from the pressed node
- **THEN** the node three steps out is not in the set

#### Scenario: Counted at the nearest distance
- **WHEN** a node is two steps out along one path and three along another
- **THEN** it is in the set

#### Scenario: Every edge kind is followed
- **WHEN** the pressed node inherits one type, uses another and annotates a third
- **THEN** all three are in the set

#### Scenario: A node that points back is still pointed to
- **WHEN** the pressed node points to a node that also points back at it
- **THEN** that node is in the set

#### Scenario: A hidden function is a step
- **WHEN** the pressed node reaches a type only through a function, and functions are hidden
- **THEN** the type is in the set as two steps out, and showing or hiding functions does not change the set

#### Scenario: A cycle
- **WHEN** two nodes point at each other and the reader presses the right button on one
- **THEN** each appears once

#### Scenario: A node that points at nothing
- **WHEN** the reader presses the right button on a node with no outgoing edges
- **THEN** that node is shown alone, and the view reports a set of one

### Requirement: What a node points to is drawn as a fan above it
The viewer SHALL lay the set out with the pressed node at the foot and every type in the set rising above it, through an opening narrower than a full circle. A full ring says the others surround the node; this set is directional, and the drawing must say so. Which way the fan opens is the reader's call, and it opens upward.

The fan SHALL open 120° where that seats its first ring side by side, and SHALL otherwise widen, about the same upward centre, only as far as that ring needs, up to a full circle. Widening SHALL NOT be triggered by the set failing to fit the screen: a circle is twice as tall as a fan of the same radius, so it fits less.

Widening SHALL answer to the first ring alone. The nearer a ring is to the pressed node the less it may overlap: the first is what the node points to directly, and what everything further out hangs off. An outer ring is left to crowd, as the full drawing's rings are, rather than the fan giving up its shape for it.

The cost is real and is accepted. Over every view with something to show, answering to the first ring alone leaves the outer ring crowded in 12.3% of Angular's views, 8.7% of Django's and 26.1% of TypeORM's, where answering to whichever ring is most crowded leaves 2.3%, 0.1% and 12.7%. What it buys is the reader's opening: the fan keeps 120° in 91% of Angular's views against 81%, and 97% of Django's against 89%. The first ring reads the same under either rule — it overlaps only where the pressed node points straight at more members than a full circle seats, which no opening fixes, and that is 1.4% of Angular's views and 3.6% of TypeORM's.

The opening SHALL be the same layout as the whole drawing's, differing only in the angular budget the root is given — not a second arrangement to be kept in step with the first. The pressed node SHALL be the centre of that layout, and MUST be visible. Its satellites orbit it as any node's do, so its own functions may sit beside or below it; what the fan places above it is every type in the set.

The view SHALL be shown at the magnification the whole drawing's default view uses — the zoom that opening the artifact or Reset view gives the whole drawing under the reader's default view setting — rather than fitted to the set. Fitted, a set of a few nodes would come out at the zoom ceiling, several times the size the reader reads the drawing at, so every press would change the size of everything as well as what was shown. Where the set fits the screen at that magnification it SHALL be centred; where it does not, the pressed node SHALL stay on screen — at the foot, the far levels running off the top, while the fan opens no more than half a circle, and at the centre once it opens wider, some of the set then lying below it. Reset view inside the view SHALL return to this framing, and changing the default view setting inside it SHALL reframe it.

Narrowing the opening SHALL NOT move the rings: a ring's radius is decided by its depth alone, in the fan as in the full drawing. What a narrower angle costs is room on each ring, so a level that fits around a full circle may be crowded in the fan, and the fan widens for it. A level still crowded at the widest the fan opens SHALL be treated exactly as the full drawing treats one — its members overlap on the ring, or, where the reader has chosen rows, the childless move to rows outside it — and not by a rule of the fan's own.

#### Scenario: The node is at the foot
- **WHEN** the set is drawn
- **THEN** the pressed node is at the bottom of the arrangement and every type in the set is placed above it, its own satellites orbiting it as any node's do

#### Scenario: The view keeps the default magnification
- **WHEN** the reader presses the right button on a node whose set is a few nodes, in a drawing whose default view is zoomed out to fit it
- **THEN** the view is shown at that same zoom, centred on the set, rather than magnified to fill the screen

#### Scenario: A set larger than the screen
- **WHEN** the set does not fit the screen at the default magnification
- **THEN** the pressed node is on screen: at the foot, with the far levels running off the top, while the fan opens no more than half a circle, and centred once it opens wider

#### Scenario: A crowded first ring widens it, only as far as it needs
- **WHEN** the first ring of the set holds more members than 120° seats side by side, and fewer than a full circle does
- **THEN** the fan opens to what that ring needs, centred on straight up, and no wider

#### Scenario: An outer ring does not widen it
- **WHEN** the ring beyond the first is the crowded one, and the first fits the opening
- **THEN** the fan keeps its opening, and that outer ring crowds as the full drawing's rings do

#### Scenario: A fan crowded past a full circle stops at one
- **WHEN** the first ring holds more members than a full circle seats side by side
- **THEN** the fan opens to a full circle, and that level is treated as the full drawing treats a crowded level

#### Scenario: An uncrowded fan keeps its opening
- **WHEN** the first ring of the set fits 120° side by side
- **THEN** the fan opens 120°, whatever the size of the screen

#### Scenario: The default view setting decides it here too
- **WHEN** the reader changes the default view setting while the view is open, or presses Reset view inside it
- **THEN** the view is framed at the magnification the setting now gives

#### Scenario: The fan is the same layout
- **WHEN** a set is laid out
- **THEN** its levels, its separation and its overflow behave as the full drawing's do, and nothing about it is computed by a second arrangement

#### Scenario: A crowded level is crowded the way the full drawing's is
- **WHEN** one level of the set holds more members than a full circle can seat side by side
- **THEN** its ring sits at the radius its depth gives, and its members are placed by the rule the full drawing uses for a crowded level

### Requirement: The reachable-set view says where it is and how to leave
The viewer SHALL show, while this view is open, a strip naming the node the set was taken from and counting the set against the whole drawing. The count is what makes a nearly empty screen an answer: one circle under a count of one is what the reader asked for, and one circle under nothing is a viewer that looks broken.

The strip SHALL carry a control that returns to the whole drawing, and `Escape` SHALL do the same, as it already leaves search and the settings panel. There SHALL be exactly one destination: the whole drawing as it was. That includes the functions toggle, which leaving SHALL return to what it was when the view opened: showing functions inside the view is a way of reading that view, and left on it would change the drawing the reader goes back to. It SHALL be restored rather than forced off, so functions the reader had on before the view are on after it.

The strip MUST NOT be placed where the legend, the comment box or the search field is drawn, and MUST stay clear of the command rail at its expanded width, the rail being drawn over the drawing rather than beside it. It SHALL sit flush against the drawing's left edge while the rail is collapsed, the collapsed rail having a reserved strip of its own, and step past the rail only while it is expanded.

While this view is open, the right button on another node SHALL switch the view to that node, and the centre key SHALL do nothing. Switching is not stacking: there is still one way out and one destination, and what leaving restores — the camera, the functions toggle — is what was true before the first of the views was opened, not before the switch. The right button on the node the view is already about SHALL do nothing, not even re-frame it. A right button inert throughout would read as the viewer ignoring the press: pressing a node while inside another node's view would look like the centre being wrong.

The view SHALL be forgotten when it is left. It is a question the reader asked once, not a preference: it MUST NOT be stored, MUST NOT outlive the artifact being closed, and MUST NOT be restored when the artifact is opened again.

#### Scenario: The strip names the subject and the size
- **WHEN** the view is open
- **THEN** the strip shows the node's name and how many nodes are shown against how many the whole drawing has

#### Scenario: Leaving from the strip
- **WHEN** the reader activates the strip's control
- **THEN** the whole drawing returns

#### Scenario: Leaving with the keyboard
- **WHEN** the reader presses Escape while the view is open
- **THEN** the whole drawing returns

#### Scenario: Functions shown inside the view are put back on leaving
- **WHEN** functions were hidden when the view opened, and the reader shows them inside it and then leaves
- **THEN** the whole drawing returns with functions hidden, and a reader who had them shown before the view finds them shown after it

#### Scenario: The strip steps past the expanded rail
- **WHEN** the reader expands the command rail while the view is open
- **THEN** the strip moves clear of it, and returns flush left when the rail collapses

#### Scenario: The right button switches the subject
- **WHEN** the reader presses the right button on another node while this view is open
- **THEN** the view becomes that node's, and the way out still returns to the whole drawing rather than to the view switched from

#### Scenario: Switching does not move the way back
- **WHEN** the reader opens a view, switches to another node, and then leaves
- **THEN** the camera and the functions toggle are as they were before the first view was opened

#### Scenario: The right button on the view's own node
- **WHEN** the reader presses the right button on the node the view is already about
- **THEN** nothing changes, the camera included

#### Scenario: The centre key is inert here
- **WHEN** the reader presses the centre key while this view is open
- **THEN** the apex does not move and no centre is named

#### Scenario: The view is not remembered
- **WHEN** the reader leaves the view, or closes and reopens the artifact
- **THEN** the whole drawing is what they get, and nothing about the view was stored

#### Scenario: Searching searches the set
- **WHEN** the reader searches by name while this view is open
- **THEN** the matches are among the nodes the view is showing, the field locating a node among those currently visible

### Requirement: Viewer commands are reached from a collapsible rail, and every setting shows itself
The viewer SHALL offer a single rail as the place its commands are reached from, occupying a column of its own rather than a row across the top. The rail MUST be collapsible to icons alone and expandable to icons with labels, and that choice MUST persist for the reader rather than resetting. Expanding it MUST NOT change what is drawn, how it is framed, or which node is focused — only the resting width is reserved, and anything wider overlays the drawing. The legend MUST be reached from the rail rather than from a control of its own, and the rail MUST show whether the legend is currently open. The rail MUST NOT take the keyboard from the graph.

The rail SHALL also reach a settings panel, holding the choices the reader makes about how the drawing is built rather than the actions they take on it. Every other control on the rail is a verb — show functions, reset the view, export — and a preference is not one.

The panel SHALL take the whole drawing surface rather than a corner of it, and SHALL scroll when it outgrows the height available. A corner box is the shape of a reference card, and it is the wrong shape for this: at 260px one setting already spends most of the width there is, and every further setting is another row squeezed into a corner while the drawing it is not about holds the rest of the screen. A reader who has opened settings is not reading the drawing.

It SHALL be organised into named sections, so that a setting is added to a part of the panel rather than appended to the end of it, and SHALL carry a control that closes it and one that resets it. It SHALL NOT spend a band across its top on a title: the reader arrived by pressing a button marked Settings and the panel is the only thing on screen, so a heading saying so costs room that the settings themselves need. The rail SHALL stay reachable while it is open, being how the reader got here.

Opening the panel SHALL close the legend and the comment box. It covers where both are drawn, and a toggle left lit for a panel nobody can see says something untrue. The two of them keep the one-corner rule between themselves.

The panel SHALL be dismissable with Escape as well as from its own control and the rail, that being what Escape already does to search.

The panel SHALL offer the drawing's palette: a colour for each kind of node, for the graph's centre and for the focus border; and for each kind of edge a colour, a width, a line style and an arrow shape of its own. It SHALL also offer the choices about how the drawing is laid out and framed: how a crowded level is drawn, and how much of a large drawing is framed for the reader. Sharing one arrow shape across the kinds would put the control on a row that shows none of them, and leave a reader unable to say that `inherits` carries a head and `references` does not. None of these is settled by measurement — they are tastes, and they are the settings a reader is most likely to want, a drawing they look at for hours being in colours somebody else chose.

A chosen value SHALL be written where everything that draws already reads it, so that the stylesheet, the legend's swatches and the panel's own marks cannot disagree about what colour a class is. A palette shown in one place and drawn in another is worse than no palette.

**Every row that sets an appearance SHALL show that appearance on itself**, beside the control that sets it. A node row shows a mark filled and rimmed the way the drawing does it; an edge row shows a line at the colour, width, style and arrow shape it sets — that row's values, not another row's.

A default SHALL be written once and read by both. Written twice, once in the stylesheet per kind and once in the row for all kinds, the two copies can disagree, and a row then shows a line the drawing does not draw. A colour picker shows a flat square, a number shows a number, and the drawing draws neither.

The panel SHALL NOT hold a rendered sample of the drawing. The case for one is that the panel covers the canvas, so a reader tunes blind without something to look at. But a sample that fits the panel is a radial layout seating a few children of a centre, one per node kind, while the number of kinds grows with every language read, so it cannot keep showing one of each. With each row carrying its own mark, what a sample adds is the star background alone, and that is not worth a second renderer to be kept in step with the first.

A reader judging a colour against the star field SHALL do so on the drawing, which is one keypress away. This is a real cost and the panel pays it: a colour legible on the panel's flat background is not certain to be legible on the drawing's.

The panel SHALL offer a control that returns every setting to its default, and SHALL mark any row that differs from what was last kept with a way to put that row back. The mark answers "what have I not kept yet?", which is the per-row breakdown of what the keeping control and the unkept notice already say once for the whole panel; keeping SHALL clear every mark at once. It does not answer "what is not the default": a row the reader kept deliberately has nothing outstanding, and a mark left standing beside it says otherwise.

Returning every setting to its default SHALL reach a setting that has no row of its own, by walking the settings rather than the controls on screen. That is what makes it the way back for a choice made elsewhere in the viewer, and it is the only way back for one.

Within a setting, the default SHALL be listed first. A reader scanning the panel to find out what a setting does starts at the top, and what they find there should be the thing they are already looking at.

A setting SHALL take effect in the drawing when it is chosen, without the reader confirming or reopening anything. A setting that changes where nodes go SHALL re-run the layout.

What the panel holds SHALL be a draft, kept for the reader only when they say so. Showing a change at once and storing it at once are different things: a panel that writes every value as it is touched gives the reader no moment at which they have finished and no way to try something and walk away from it. So the panel SHALL carry a control that keeps what is in it, SHALL say when there is something unkept, and SHALL put back what was last kept if it is closed with a draft outstanding. Returning every setting to its default is an edit like any other and SHALL itself be kept only when the reader says so.

A setting SHALL be remembered for the reader rather than for the panel it was set in: it SHALL outlive the editor tab, the window, and the workspace, and SHALL hold across every artifact the reader opens. A colour or a layout chosen once is a statement about how this reader wants drawings to look, not about the tab it was typed into. The rail's own collapsed state is the counter-example and SHALL stay with its panel: whether this tab's rail is open is not a preference about every artifact.

The viewer SHALL draw correctly when nothing has been stored and when the host never answers. A setting with no stored value holds its default; a viewer that is asked for its drawing before any answer arrives shows the defaults and takes the stored values when they come.

#### Scenario: Collapsed by default
- **WHEN** an artifact is opened and the reader has expressed no preference
- **THEN** the rail is collapsed, showing icons alone, and each icon names itself on hover

#### Scenario: Expanding names the commands
- **WHEN** the reader expands the rail
- **THEN** every command shows its label, and the row each icon sits on does not change height or position

#### Scenario: Expanding does not disturb the drawing
- **WHEN** the reader expands or collapses the rail
- **THEN** the zoom, the pan and every node's position are unchanged, and the wider rail lies over the drawing rather than narrowing it

#### Scenario: The rail's resting state does not cover the drawing
- **WHEN** the rail is collapsed
- **THEN** the space it occupies is reserved for it, so no part of the drawing is hidden beneath it

#### Scenario: The choice is remembered
- **WHEN** the reader expands the rail and the panel is later hidden and shown again
- **THEN** the rail is still expanded, and a reader who has never chosen still gets the collapsed default

#### Scenario: The legend opens from the rail
- **WHEN** the reader chooses the legend from the rail
- **THEN** the legend is shown, and the rail shows it as currently on

#### Scenario: The rail does not hold the keyboard
- **WHEN** the rail is in either state and the reader presses a key bound to a graph action
- **THEN** that action runs, since the rail is always present and could not give the keyboard back

#### Scenario: The settings panel opens from the rail
- **WHEN** the reader chooses settings from the rail
- **THEN** the settings panel is shown over the drawing, the rail shows it as currently on, and any legend or comment box is closed

#### Scenario: Settings covers the drawing, not the rail
- **WHEN** the settings panel is open
- **THEN** it occupies the whole surface the drawing was on, and the rail is still there to close it from

#### Scenario: Escape leaves settings
- **WHEN** the settings panel is open and the reader presses Escape
- **THEN** the panel closes and the drawing is as they left it

#### Scenario: The default reads first
- **WHEN** a setting offers a choice between named values
- **THEN** the one a reader who has never chosen is given is listed before the others

#### Scenario: A chosen colour reaches the drawing
- **WHEN** the reader picks a colour for a kind of node
- **THEN** every node of that kind is drawn in it, without the drawing being rebuilt from the document and without any node moving

#### Scenario: The legend agrees with the drawing
- **WHEN** the reader changes a colour
- **THEN** the legend's swatch for that role shows the same colour the drawing now uses

#### Scenario: An edge row shows the line it sets
- **WHEN** the panel offers a colour, a width and a line style for an edge kind
- **THEN** that row shows a line drawn at all three

#### Scenario: The arrow setting is visible where it is set
- **WHEN** the reader turns arrowheads on or off
- **THEN** the lines on the edge rows gain or lose a head

#### Scenario: A row follows the choice
- **WHEN** the reader changes any part of the palette
- **THEN** the mark on that row shows it immediately

#### Scenario: The panel holds no rendered sample
- **WHEN** the settings panel is open
- **THEN** it holds rows and no drawing of the graph

#### Scenario: Everything goes back
- **WHEN** the reader chooses to reset
- **THEN** every setting returns to its default, including any the reader has forgotten changing, whether or not its control is on screen

#### Scenario: A changed value says so
- **WHEN** a setting is not at its default
- **THEN** the panel marks it and offers to return that one value

#### Scenario: A setting belongs to a section
- **WHEN** the settings panel is shown
- **THEN** its settings are grouped under named sections rather than listed one after another

#### Scenario: Choosing a setting takes effect at once
- **WHEN** the reader picks a different value for a setting
- **THEN** the drawing is rebuilt with it immediately, with nothing to confirm and nothing to reopen

#### Scenario: Nothing is kept until the reader says so
- **WHEN** the reader changes a setting and has not yet asked for it to be kept
- **THEN** the drawing shows it and nothing has been stored, and the panel says there is something unkept

#### Scenario: Closing without keeping puts it back
- **WHEN** the reader closes the panel with a draft outstanding
- **THEN** the drawing returns to the settings that were last kept

#### Scenario: Reset is a draft too
- **WHEN** the reader returns every setting to its default
- **THEN** that is shown like any other change and is stored only when they ask for it to be kept

#### Scenario: A setting is remembered
- **WHEN** the reader changes a setting and the panel is later hidden and shown again
- **THEN** the setting still holds the value they chose, and a reader who has never chosen gets the default

#### Scenario: A setting outlives the tab it was set in
- **WHEN** the reader changes a setting, closes the editor tab, and opens an artifact again
- **THEN** the setting still holds the value they chose

#### Scenario: A setting follows the reader to another artifact
- **WHEN** the reader changes a setting and then opens a different artifact
- **THEN** that artifact is drawn with the same setting

#### Scenario: The rail's own state stays with its panel
- **WHEN** the reader expands the rail in one tab and opens a second artifact
- **THEN** the second one opens with the rail in its own default state, the rail being about the panel rather than about the reader

#### Scenario: Nothing stored is not an error
- **WHEN** the viewer opens and the host has nothing stored, or answers with nothing at all
- **THEN** every setting holds its default and the drawing is complete

#### Scenario: Empty-canvas clicks keep their meaning
- **WHEN** the reader clicks empty canvas
- **THEN** the focus node is cleared: the rail changes nothing about what a click on the drawing means

#### Scenario: A row draws its own kind
- **WHEN** two edge kinds differ in width or line style
- **THEN** their rows differ in the same way

#### Scenario: An arrow shape belongs to one kind
- **WHEN** the reader gives one edge kind a head and another none
- **THEN** the drawing and the two rows show each kind as it was set

#### Scenario: A default is written once
- **WHEN** an edge kind has no value set for a width, a style or an arrow
- **THEN** the row and the drawing fall back to the same value

### Requirement: The legend names every mark the drawing makes
The legend SHALL name each mark a reader can see in the drawing and cannot deduce: every kind of node, every kind of edge, and the marks that are not a kind — the centre, the rim on the node the reader clicked, and the doubled rim of several symbols drawn as one.

A mark earns a row by passing both halves of that test, and SHALL lose it on failing either. A mark the reader can work out from another mark is repetition: a node drawn smaller is a satellite, a satellite is a `function` or a `file` in 96% of cases across the sample corpus, and both already carry a colour of their own — so the size says again what the colour said. The 4% that are types are the only case the size informs, and it is the case a row for the size would describe wrongly: such a node is seated beside the function that uses it, functions are hidden by default, and so it sits beside nothing. A row that repeats a colour where it is common and misleads where it is not has stopped teaching.

A mark the loaded artifact cannot produce SHALL NOT be named. The legend describes the drawing in front of the reader, not the drawing the viewer is capable of: tinydb folds no group, so naming the doubled rim offers a key to a mark no click will reveal. The test is the artifact rather than what is on screen at this instant — functions are hidden by default and can be shown, so what they are drawn as is still worth naming.

Every colour the reader can set SHALL be a mark the legend names. The settings panel offers a colour for the focused node's rim, so the legend names that rim: a mark the viewer lets you change is by definition one you can see.

Where a name says what the thing is, it SHALL stand alone. A gloss exists where the name is not enough — that a function node is a top-level one, that a file node is a module with neither — and a gloss longer than the thing it explains has stopped being one.

What the legend says about a mark SHALL be what the drawing does. The legend is the one place a reader has no way to check, so a description of a rule that the drawing does not follow misleads without being noticed.

The legend SHALL also say what a reader can do — with a click, with a right-click, with a key — and SHALL say it in one place. Sorting those by the device they are performed with answers a question nobody asked; "what can I do here" is one question.

It SHALL carry the caveat that the edges are lexical rather than a runtime call graph, as a sentence rather than as a section. It is one line and it is read once.

#### Scenario: Every mark is named
- **WHEN** the reader opens the legend
- **THEN** it names each kind of node and edge the artifact carries, and the centre and the folded node besides

#### Scenario: A mark this artifact cannot make is not named
- **WHEN** an artifact folds no group at all
- **THEN** the legend has no row for the doubled rim

#### Scenario: A mark a colour already gives is not named
- **WHEN** a node is drawn smaller because it orbits another
- **THEN** the legend does not carry a row for the size, the kinds that orbit being named by their own colours

#### Scenario: Hidden by default is still worth naming
- **WHEN** an artifact carries function nodes and the reader has not shown them yet
- **THEN** the legend still names what a function is drawn as

#### Scenario: The centre is described as it is chosen
- **WHEN** the legend describes the marked centre
- **THEN** what it says matches how the drawing chooses one

#### Scenario: Doing is one section
- **WHEN** the reader looks for what a click or a key does
- **THEN** both are in the same part of the legend

#### Scenario: A colour that can be set is a mark that is named
- **WHEN** the settings panel offers a colour for a mark
- **THEN** the legend names that mark

#### Scenario: The legend fits a window it is taller than
- **WHEN** the window is shorter than the legend
- **THEN** the rest of it can be reached by scrolling, and scrolling it does not zoom the drawing

#### Scenario: A name that says enough is left alone
- **WHEN** a mark's name already says what it is
- **THEN** the legend does not gloss it

### Requirement: Export the drawing as an image file
The viewer SHALL be able to write the current drawing to an image file beside the artifact it was opened from, without requiring the user to choose a location. The image MUST cover the whole drawing rather than only the visible portion, MUST contain only the node kinds currently shown, and MUST NOT carry the focus or search emphasis that happens to be applied when the export is requested. Requesting an export MUST leave the view exactly as it was. Where the drawing is too large for the renderer to produce at full size, the viewer SHALL reduce the image's resolution rather than fail. The user MUST be told where the file was written, and told when the image was reduced or when it replaced an existing file.

#### Scenario: Exporting writes an image beside the artifact
- **WHEN** the user exports the drawing
- **THEN** an image file is written into the same directory as the `*.planisphere.json` it was opened from, without a location prompt

#### Scenario: The whole drawing is exported, not the visible part
- **WHEN** the user has panned or zoomed so that part of the drawing is off screen, and exports
- **THEN** the exported image contains every drawn node, including those that were off screen

#### Scenario: Hidden kinds do not appear in the exported image
- **WHEN** a node kind is hidden and the user exports
- **THEN** nodes of that kind are absent from the exported image

#### Scenario: Emphasis does not reach the exported image
- **WHEN** a node is focused, or a search has de-emphasized part of the drawing, and the user exports
- **THEN** the exported image shows every drawn node at its normal appearance, with nothing de-emphasized

#### Scenario: The view survives the export unchanged
- **WHEN** the user exports while a node is focused
- **THEN** after the export that node is still focused with the same emphasis, and the camera has not moved

#### Scenario: Exporting again replaces the previous image
- **WHEN** the user exports the same artifact a second time
- **THEN** the previously written image is replaced rather than a second file accumulating, and the user is told it was replaced

#### Scenario: An oversized drawing is reduced rather than refused
- **WHEN** the drawing is larger than the renderer can produce at full size
- **THEN** an image is still written at a reduced resolution, and the user is told it was reduced

#### Scenario: The user learns where the image went
- **WHEN** an export completes
- **THEN** the viewer reports the location of the written file

### Requirement: The drawing is rendered as a star system
The viewer SHALL render the drawing against a star field, with nodes drawn as illuminated bodies and a faint ring drawn at each radius the layout places tree vertices on. The star field MUST move with the drawing rather than sitting behind it as a fixed backdrop, and MUST do so in layers at differing depths, since a background that moves exactly with the drawing reports no motion at all. A node MUST remain distinguishable from the background at every zoom the viewer allows, and de-emphasized nodes MUST remain visible against the background rather than disappearing into it. The colours themselves are the reader's, so what the viewer guarantees is that the palette's own defaults hold it and that each settings row's swatch shows its chosen colour on that same background, where the reader can see for themselves. The background MUST appear in an exported image, though it need not be pixel-for-pixel what the screen shows: layered depth is a motion cue, and a still image has no motion to carry it. The rendering MUST NOT introduce anything that moves on its own.

A ring marks a level of the tree. Its radii SHALL be the ones the tree placement used, and a node placed by any other rule SHALL contribute none: a satellite sits where its owner is, a helper class sits beside the function that produces it, and a node in the grid of unconnected nodes sits where the packing put it. None of those distances is a level, and drawing a circle at each would turn CPython's outer edge into a band of 112 rings — 89 of them under 30px apart, reaching 7042px where the tree ends at 1899.

A node that is placed as a satellite MUST be drawn smaller than the nodes that carry satellites, and labelled at a proportionate size. Drawn at the same size, a class carrying twenty functions and a class carrying none read as the same kind of thing, and what a reader is looking at when functions are shown is which parts of the structure are heavy.

#### Scenario: The drawing sits on a star field
- **WHEN** an artifact is opened
- **THEN** the canvas behind the drawing shows a star field rather than a flat colour

#### Scenario: The palette is the reader's
- **WHEN** the reader has chosen colours of their own
- **THEN** the drawing uses them, and the legend explains the drawing in the same colours

#### Scenario: A node is not mistaken for a background star
- **WHEN** the view is zoomed out far enough that a node renders at a size comparable to the background's stars
- **THEN** the node is still distinguishable from them, by colour rather than by size or brightness alone, the background being effectively monochrome

#### Scenario: The star field reports the reader's own motion
- **WHEN** the reader pans the drawing
- **THEN** the star field moves with it, each layer by an amount set by its depth, and no layer either stands still or matches the drawing exactly

#### Scenario: Rings mark the layout's radii
- **WHEN** the layout places tree vertices at increasing radii from a group's center
- **THEN** a faint ring is drawn at each of those radii, so how many hops a node sits from its center can be read off the picture

#### Scenario: A satellite draws no ring
- **WHEN** functions are shown and satellites are placed around the classes they belong to
- **THEN** no ring is drawn at a satellite's distance from its group's center

#### Scenario: A node the tree did not place draws no ring
- **WHEN** a class is placed beside the function that produces it, or sits in the grid of unconnected nodes
- **THEN** its distance from whatever group it is counted in draws no ring

#### Scenario: Showing functions does not multiply the rings
- **WHEN** the reader turns functions on
- **THEN** the rings are the ones that were there before, because the tree's levels did not change

#### Scenario: De-emphasized nodes remain visible against the background
- **WHEN** neighborhood emphasis or a search de-emphasizes part of the drawing
- **THEN** the de-emphasized nodes are still discernible against the star field, preserving whole-graph context

#### Scenario: The exported image carries the background
- **WHEN** the user exports the drawing
- **THEN** the exported image shows a star field of comparable density to the one on screen, not a flat colour

#### Scenario: The exported image is small enough to send
- **WHEN** the drawing is exported
- **THEN** the file is small enough to attach to a message, the background costing a fraction of the image rather than the great majority of it

#### Scenario: Nodes with no connections read as a cluster, not as a grid
- **WHEN** the graph contains nodes that have no visible connection to anything
- **THEN** they are arranged as a cluster with no aligned rows or columns, and no two of their labels overlap

#### Scenario: The cluster is ordered by kind and name
- **WHEN** unconnected nodes of more than one kind are arranged
- **THEN** kind still determines where a node sits — which disc it is in, and how far from that disc's centre — and nodes of the same kind stay in name order

#### Scenario: Satellites read as smaller bodies
- **WHEN** functions are shown and some are drawn orbiting a class
- **THEN** they are drawn smaller than that class and labelled proportionately, so a heavily-orbited node is distinguishable at a glance from a bare one

#### Scenario: Nothing moves on its own
- **WHEN** the viewer is left idle with an artifact open
- **THEN** nothing in the rendering animates

### Requirement: The lines that explain the arrangement are drawn over the ones that do not
The viewer SHALL draw at full strength those edges that carry a placement decision, and SHALL dim the rest.

An edge carries a placement decision when it joins a node to the neighbour the layout chose as its parent, or a satellite to the class it orbits. Those are the reasons things are where they are: the drawing is a tree, and the tree was built from one edge per node. Every other edge relates two nodes the arrangement never related to each other, and is drawn at whatever angle their two positions happen to make.

Drawn all alike, the second kind outnumbers the first three to two — 388 of 639 on FastAPI, 4,255 of 7,119 on Django, 5,424 of 9,435 on CPython — and crosses the picture at every angle, so a reader tracing a ring cannot tell which line explains why anything sits on it.

A dimmed edge SHALL still be drawn and SHALL still be followable. Nothing is removed: these are real relationships, and they are the reason a reader opens a second view. Emphasis SHALL override the dimming, so selecting either endpoint brings the edge back to full strength.

The direction the graph records SHALL NOT matter. The placement chose a parent; which way round the analyzer wrote that relationship is not something the reader can see, and an edge written child-to-parent is the same relationship.

Which edges are dimmed SHALL NOT change when the reader turns functions on or off. The classes follow from the arrangement, and the arrangement does not move for a visibility change; an edge that came back at full strength after a toggle would be one the reader had already learnt to skip.

#### Scenario: A parent link is drawn at full strength
- **WHEN** the layout places a node by choosing one of its neighbours as its parent
- **THEN** the edge between them is drawn at full strength

#### Scenario: A satellite's own edge is drawn at full strength
- **WHEN** a function is placed in orbit around the class it belongs to
- **THEN** the edge between them is drawn at full strength, being the shortest line in the drawing and the tightest relationship it shows

#### Scenario: An edge between two nodes on the same ring is dimmed
- **WHEN** two nodes were both placed by a third, and an edge joins them to each other
- **THEN** that edge is dimmed, because it is not the reason either of them is where it is

#### Scenario: Following a dimmed line still works
- **WHEN** a reader selects a node at either end of a dimmed edge
- **THEN** that edge is drawn at full strength for as long as the selection lasts

#### Scenario: The recorded direction does not decide
- **WHEN** the analyzer recorded a relationship from child to parent rather than parent to child
- **THEN** the edge is still drawn at full strength, the placement having used it either way

#### Scenario: The same lines stay dimmed across a toggle
- **WHEN** the reader turns functions on and off again
- **THEN** every edge has the strength it had before, none having moved between the two kinds

### Requirement: Labels stay legible over the background
Every drawn label SHALL be rendered so that it remains readable against whatever is behind it, not only the labels of emphasized nodes. Emphasized labels MUST still be distinguishable from ordinary ones.

#### Scenario: Every label is legible, not only the emphasized ones
- **WHEN** labels are drawn over a dense region of the background
- **THEN** every label is separated from the background behind it, whether or not its node is emphasized

#### Scenario: Emphasis is still visible in the labels
- **WHEN** a node is focused and its neighbours emphasized
- **THEN** their labels remain distinguishable from the labels of nodes that are neither

### Requirement: A node's satellites stay in one ring beside it
This requirement governs the first ring only — the satellites of a tree vertex. What hangs below them is a chain, and is governed by the requirement after it.

The satellites of one node SHALL all be placed on a single ring around it, and that ring SHALL stay within its owner's own space. A ring says one thing — these belong to that node — and it stops saying it as soon as it reaches across to a different tree vertex, because a body drawn there is as near one as the other. So the radius is bounded by the distance to the nearest other tree vertex, and a satellite MUST NOT be drawn overlapping a tree vertex that is not its owner.

The ring is never enlarged to make its contents fit, and a satellite MUST NOT be moved to a second ring at a different radius. Two concentric rings around one node read as two tiers of something, and the graph draws no such distinction.

Where the ring cannot hold everything, the satellites overlap. This is the accepted cost: overlapping bodies are still recognisably one ring around one node, where a ring that grows or splits to fit is not. The drawing SHOULD place a satellite that has no free seat where there is most room, preferring to overlap another satellite over a tree vertex, so that no two bodies are drawn exactly on top of each other.

#### Scenario: A sparse orbit stays close
- **WHEN** a node carries few enough satellites to fit on an outward-facing arc
- **THEN** they stay near it, on that arc, rather than being pushed out to a radius sized for a crowd

#### Scenario: A crowded orbit closes into a circle rather than splitting
- **WHEN** a node carries more satellites than an outward-facing arc can hold
- **THEN** the arc opens toward a full circle, and every one of that node's satellites is still the same distance from it

#### Scenario: A ring does not reach the next class
- **WHEN** a node carrying satellites has another tree vertex nearby
- **THEN** none of its satellites is drawn overlapping that vertex, and the ring stops short of it rather than growing to fit its contents

#### Scenario: A full ring crowds rather than growing
- **WHEN** a node's ring cannot hold all of its satellites
- **THEN** they overlap on that same ring, rather than the ring being enlarged or a second one being added

#### Scenario: The bound is on the first ring, not on what hangs below it
- **WHEN** a satellite on a tree vertex's ring carries satellites of its own
- **THEN** those are not held inside the ring's bound, because the ring's bound exists to say which vertex the ring belongs to and that has already been said

#### Scenario: Crowding lands on siblings, not on classes
- **WHEN** a satellite has no free seat anywhere on its ring
- **THEN** it takes the seat with the most room, preferring to overlap another satellite rather than a tree vertex, so it is not read as belonging to the wrong node

### Requirement: A chain of satellites walks outward
Where a satellite carries satellites of its own, they SHALL be placed outward from it — further from the tree vertex the chain hangs off than the node they hang off is — one step per link. A link MUST NOT be placed such that it turns back toward the node its own owner hangs off, which is what a full circle around an owner allows and what makes a chain unreadable as a chain.

Each link SHALL be given an angular sector of its owner's own sector, sized in proportion to the number of leaves below it, and MUST stay within it. Sibling chains therefore cannot cross.

A link MAY be shifted within its sector, or stepped further out, to avoid being drawn over a tree vertex. It MUST NOT leave its sector to do so.

#### Scenario: Each link is further out than the one before
- **WHEN** a satellite carries a satellite of its own
- **THEN** the carried one is further from the tree vertex the chain hangs off than its owner is

#### Scenario: A chain does not double back
- **WHEN** a chain of satellites is placed
- **THEN** no link turns more than a right angle from the direction its owner was reached by

#### Scenario: Sibling chains keep to their own sectors
- **WHEN** one satellite carries more than one chain
- **THEN** each gets a share of its owner's sector in proportion to what hangs below it, and no two shares overlap

#### Scenario: A link slides rather than lands on a class
- **WHEN** a link's place would put it over a tree vertex
- **THEN** it is moved within its own sector, or stepped further out, rather than being drawn over it

### Requirement: The viewer reads source only when asked
The viewer SHALL NOT read source files as part of drawing the graph. It MAY ask the extension host to read one in response to something the reader did, and MUST continue to work when the answer is that it could not be read.

#### Scenario: Opening an artifact reads no source
- **WHEN** an artifact is opened and drawn
- **THEN** no source file is read

#### Scenario: Source is read in response to the reader
- **WHEN** the reader focuses a node
- **THEN** at most that node's own file is read

### Requirement: Repeated symbols with a shared name and a shared relationship are drawn as one node
Where two or more visible symbols repeat the same pattern, the viewer SHALL draw them as a single node standing for the group, labelled with the shared name and how many members it has. A group is not openable: its members are never drawn, and the way to reach one is the list beside the drawing.

Repetition is a shared name plus one shared relationship. For a type that relationship is a base it inherits; for a module-level function it is a node it has an edge to or from. CPython's codec modules write `class StreamReader(Codec, codecs.StreamReader)` and also define `def getregentry()` returning a `CodecInfo`, 121 times over — the classes and the functions are the same pattern repeated per codec, and both SHALL fold.

One shared relationship is the test, not all of them. Those 123 `StreamReader` classes have 113 distinct base *sets* and agree on nothing if agreement must be total, while 121 of them plainly derive from one `codecs.StreamReader`. What must not happen is the opposite error: FastAPI's `Header`, `HTTPBearer` and `SecurityBase` pairs share only a word, have no base in common, and stay apart.

A symbol with no such relationship has nothing to agree on and is never grouped, however many others share its name: a class with no base, and a function with no edges.

A function's shared neighbour SHALL be read after the types are folded, so that functions pointing at the several members of one group count as pointing at one thing.

Grouping MUST NOT be transitive. A symbol belongs to exactly one group — the largest it qualifies for, and among equals the one whose shared relationship sorts first — so that two symbols with nothing in common are never drawn together because some third one happens to link them. CPython's `main` accordingly forms separate groups around `getopt`, around `Turtle` and around `Screen`, rather than one group of every `main` in the project.

Grouping SHALL NOT apply to files. A file node stands for a place in the source rather than for a repeated pattern, and its edges are whatever its module happens to contain, so a shared name between two files says nothing about them being one thing.

A group node SHALL carry the union of its members' edges to nodes outside the group, with duplicates merged and edges between members of the same group dropped. Grouping happens before positions are computed, so a group occupies one place in the tree rather than its members' several. A group SHALL be drawn as the kind its members are.

#### Scenario: Repeated subclasses become one node
- **WHEN** many visible classes share a name and all derive from the same base class
- **THEN** one node is drawn for them, labelled with that name and the number of classes it stands for

#### Scenario: Repeated functions become one node
- **WHEN** many visible module-level functions share a name and all have an edge to or from the same node
- **THEN** one node is drawn for them, labelled with that name and the number of functions it stands for

#### Scenario: A shared name alone does not group
- **WHEN** two visible classes share a name but have no base class in common
- **THEN** they remain two nodes

#### Scenario: Functions that share only a name stay apart
- **WHEN** two visible functions share a name and have no neighbour in common
- **THEN** they remain two nodes

#### Scenario: Bases that differ apart from the shared one still group
- **WHEN** same-named classes each derive from one common base and additionally from a base of their own
- **THEN** they are one group, keyed on the base they share

#### Scenario: A chain of shared bases does not merge unrelated classes
- **WHEN** class A and class B share a base, and class B and class C share a different base, and A and C share none
- **THEN** A and C are not drawn as one node

#### Scenario: A class with no base is never grouped
- **WHEN** several visible classes share a name and none of them declares a base class
- **THEN** they remain separate nodes

#### Scenario: A function with no edges is never grouped
- **WHEN** several visible functions share a name and none of them has an edge to anything
- **THEN** they remain separate nodes

#### Scenario: Functions fold onto a folded class
- **WHEN** same-named functions each have an edge to a different member of one class group
- **THEN** they are one group, because after folding those members are one node

#### Scenario: Files are not grouped
- **WHEN** several visible files share a name
- **THEN** they remain separate nodes

#### Scenario: A group's edges are its members' edges
- **WHEN** a group's members are connected to nodes outside the group
- **THEN** the group node carries one edge to each such node, and edges that ran between two members of the group are not drawn

#### Scenario: A group takes one place in the tree
- **WHEN** positions are computed with a group collapsed
- **THEN** the group occupies a single position, and its members reserve no space of their own

#### Scenario: A group's members are never drawn
- **WHEN** an artifact holding a group is open, whatever the reader does
- **THEN** the group's members do not appear as nodes, and the group node is what stands for them

#### Scenario: A group of one is not a group
- **WHEN** a name and shared relationship is held by exactly one visible symbol
- **THEN** that symbol is drawn as an ordinary node with no count

#### Scenario: A group of functions is drawn as a function
- **WHEN** a group's members are functions and function nodes are hidden
- **THEN** the group node is hidden with them, and shown when they are shown

### Requirement: The drawing builds only what it shows
The viewer SHALL create a drawing element only for a node it is about to draw.
A node hidden by a kind toggle SHALL NOT exist in the drawing until the reader
turns that kind on.

This is safe only because positions do not come from what is visible — see *The
layout is computed once; visibility only hides*. Every node has a place before
anything is built, so a node built later is put where the layout already said it
goes, and nothing that was already drawn moves to make room.

The trade is that turning a hidden kind on for the first time costs what
building those elements costs, instead of that cost being paid at open. It is
paid once: elements are never removed, so hiding and showing the same kind again
costs nothing. Opening is what every reader does and turning functions on is
what some readers do sometimes, so the cost belongs on the second one.

The whole open takes 4,091ms on CPython, 3,782ms on Django and 276ms on
FastAPI, against 8,446ms, 5,502ms and 611ms when every element is built at
open. The layout's own time is the same either way, which is what says the
saving is elements nobody saw. The first toggle pays for it once — CPython's
takes 2,543ms rather than 1,700ms — and every one after that builds nothing, a
folded-away member never being built at all.

#### Scenario: A hidden kind is not built at open
- **WHEN** an artifact opens with functions hidden
- **THEN** the drawing contains the classes and the edges between them, and contains no function

#### Scenario: Turning a kind on puts it where the layout said
- **WHEN** the reader turns functions on
- **THEN** each function appears at the position the layout computed for it from the whole artifact, and every node that was already drawn is exactly where it was

#### Scenario: The second time costs nothing
- **WHEN** the reader turns functions off and on again
- **THEN** nothing is built, and the drawing is the same as it was the first time they were on

#### Scenario: A drawing with no classes is whole
- **WHEN** an artifact has no classes at all and falls back to a plain circle
- **THEN** every node in it is drawn

### Requirement: A class whose relationships all run through functions sits beside one of them
Where every node a type is joined to is a function, the viewer SHALL place that type beside one of those functions.

Which functions count SHALL NOT depend on the direction of the edge or on its kind. `IsoCalendarDate` uses `weekday` and `_ThemeSyntax` is named by `_theme_style` in an annotation; reading only the edges *into* the class, and only those the analyzer recorded as `uses`, misses 24 of CPython's 31 such classes on direction alone and one more on kind. What decides the seat is that the two are connected, not which of them was written first.

The seat SHALL be measured from the function itself, not from whatever type that function is drawn beside. Measuring from the function's own owner introduces a cycle — a class waits for a function whose owner is computed as that same class — and it is less accurate besides: CPython's `filename` is used by 85 classes, so its owner is one of them arbitrarily and has nothing to do with the class being seated.

The seat SHALL be looked for around the function, not only further out along one line from it. Stepping outward at a fixed angle finds room by leaving the neighbourhood: the ideal spot beside CPython's `filename` has 29 other nodes within 40px, so twelve outward steps would put `_Utils` 599px away — clear of everything, including the function it belongs to. Stepping outward that way, 74 of CPython's 117 helper classes would be drawn more than 200px from theirs.

Where the neighbourhood is genuinely full the type SHALL take the emptiest seat near the function rather than a clear one far from it. Crowding is the settled trade everywhere else in this drawing, and a class touching a neighbour 40px from its function reads better than one touching nothing 599px away.

Where no related function has a position, the type SHALL join the unconnected nodes. It MUST NOT be seated against the drawing's centre: "where this belongs could not be worked out" and "this belongs at the middle" are different statements and only the first is true. Seated against the centre, CPython's 31 such classes would sit at exactly one satellite radius from its primary centre, a median of 743px from the function each is actually related to.

#### Scenario: A class that uses a function sits beside it
- **WHEN** a class's only neighbour is a function it uses, so the edge points away from the class
- **THEN** it is placed beside that function

#### Scenario: A class a function uses sits beside it
- **WHEN** a class's only neighbour is a function that uses it, so the edge points at the class
- **THEN** it is placed beside that function

#### Scenario: An annotation-only relationship counts
- **WHEN** the only edge between a class and a function is one the analyzer recorded as a reference rather than a use
- **THEN** the class is still placed beside that function

#### Scenario: The seat does not wait on the function's own owner
- **WHEN** a function's nearest class is the very class being seated beside it
- **THEN** that class is still placed beside the function, rather than neither being placed

#### Scenario: A busy function still seats its class beside itself
- **WHEN** a function is related to many classes
- **THEN** a class seated against it is placed beside the function, not beside whichever of the many the function is drawn next to

#### Scenario: Nowhere to put it means unconnected, not the centre
- **WHEN** no function a class is related to has a position
- **THEN** it is drawn among the unconnected nodes and not at a satellite's distance from the drawing's centre
#### Scenario: A crowded neighbourhood does not push the class out of it
- **WHEN** the space immediately beside a class's function is occupied
- **THEN** the class is placed elsewhere around that function rather than further out along one line from it

#### Scenario: Nowhere free means the emptiest nearby seat
- **WHEN** every seat around the function is occupied
- **THEN** the class takes the least crowded of them and stays beside the function

### Requirement: A node belongs to the group of what it was hung off
A node that is not a tree vertex — a function satellite, a helper class — SHALL
take the group of the node it was placed against, following that chain of owners
until it reaches one that has a group of its own. Its group SHALL NOT be decided
by which grouped node happens to be nearest it.

A group is the answer to "which tree is this part of", which is a fact about how
the node was placed and not about where it ended up. The two agree almost
always, because a satellite is placed within `SAT_RADIUS` of its owner and the
gap between groups is far larger — which is why deciding it by distance
looks correct. It stops agreeing where the drawing is crowded: on CPython six
nodes are nearer an unrelated module than the tree they belong to, one of them
nearer an island in `shutil` while the node it hangs off is in the main tree.

Distance would also be measured against a drawing that is not finished. The
nodes that go in the grid are placed after this decision, so the geometry it
would read is missing them.

#### Scenario: A satellite joins its owner's tree, not the nearest one
- **WHEN** a function is placed beside a class in one tree, and a node of another tree is nearer to it than that class is
- **THEN** it is grouped with its owner's tree

#### Scenario: A chain of satellites reaches the same tree
- **WHEN** a satellite is placed against another satellite, which is itself placed against a class
- **THEN** it takes that class's group

#### Scenario: Nothing in the grid gains a group
- **WHEN** a node is connected to nothing and is placed in the grid
- **THEN** it stays ungrouped

### Requirement: Unconnected nodes that are connected to each other are drawn together
The cluster of nodes that have no connection to the drawing SHALL keep any two of its own members that are joined by an edge near one another.

A node reaches that cluster by having nothing that ties it to the structure. That says nothing about whether it is tied to another node in the same position: CPython's cluster holds 36 pairs joined by an edge; seated by kind and name alone, exactly one of them lands within 200px, with a median separation of 1,835px, and `CurvesTurtle` and the `main` that uses it land 1,943px apart, in the same cluster, with a line between them crossing everything in between.

Each of them SHALL have a place of its own. The cluster seats its nodes an exclusion ellipse apart so that no two labels overlap; a group of them sharing one seat and fanned around it defeats that. A fan sized for a pair is a fixed 21px radius whatever the group holds, so CPython's twenty-member group — `re/_properties.py`, a module of functions calling each other and nothing else — would come out 6.6px apart with bodies 28px across, and the cluster would hold 159 overlapping pairs. So a group takes one seat per member, and its members take the seats nearest the first: the seats keep them from overlapping and nearest keeps them together.

Near one another is measured against the cluster and not in pixels. A seat is as wide as the exclusion a label needs, which is 195px, so two nodes on their own seats are never closer than that; what the requirement asks is that the edge between them does not cross the cluster.

The cluster's ordering — by kind, then by name — holds where it does not conflict. Keeping a connected pair together is a constraint added to that arrangement, not a replacement for it. A group with more than one member takes its seats before the single nodes do: claimed in name order, a large group finds only what the single nodes left scattered across the disc, and a single node has nothing it needs to be near.

#### Scenario: A connected pair in the cluster is drawn as a pair
- **WHEN** two nodes with an edge between them both end up among the unconnected nodes
- **THEN** they are drawn near one another rather than at whatever distance their names would give them

#### Scenario: The line between them is short enough to follow
- **WHEN** such a pair is drawn and both are visible
- **THEN** the edge between them does not cross the whole cluster

#### Scenario: No two nodes in the cluster overlap
- **WHEN** several nodes in the cluster are joined to each other
- **THEN** each is drawn in a seat of its own and none overlaps another

#### Scenario: Unrelated nodes keep the ordering they had
- **WHEN** nodes in the cluster have no edge to any other node in it
- **THEN** kind still decides where each sits — which disc, and how far from that disc's centre — and nodes of the same kind stay in name order

### Requirement: A turn of the wheel zooms by the same amount every time
The viewer SHALL zoom by an amount that depends only on how far the reader scrolled. The same scroll SHALL produce the same zoom on the first turn after an artifact is opened as on the fiftieth, and the same again after the artifact is closed and reopened.

It MUST NOT vary with anything the viewer has inferred about the reader's hardware. Sampling the first few turns to guess between a trackpad and a wheel means the reader learns the gesture on one rate and is then given another — and because the sample is held on the renderer, which is rebuilt whenever an artifact is opened, the guess is made again every time. Run over a sequence of events, the library's own handler takes a wheel five notches to a doubling for four turns and 8.4 from the fifth.

The same distance scrolled SHALL zoom the same amount whatever the device reported it as. A device whose scrolling is measured in lines or pages SHALL have it converted to pixels before the rate is applied, rather than corrected afterwards. On the same handler, a trackpad and a wheel on Firefox for Linux both zoom about fifteen times per notch where a wheel elsewhere zooms 1.15.

The rate SHALL be stated as how far the reader must scroll to double the zoom, so that it can be read and changed on its own. A multiplier applied on top of a library's internal step, which three other factors also multiply, one of them the notch size the library has measured, turns one number into four different rates.

Zooming SHALL keep the point under the pointer under the pointer, and SHALL respect the zoom floor and ceiling the viewer sets elsewhere.

#### Scenario: The first turn matches the fiftieth
- **WHEN** the reader scrolls the same amount on the first turn after opening an artifact and again much later
- **THEN** the zoom changes by the same factor both times

#### Scenario: Reopening does not change the rate
- **WHEN** an artifact is closed and opened again and the reader scrolls the same amount
- **THEN** the zoom changes by the same factor as before it was closed

#### Scenario: A larger scroll zooms further
- **WHEN** one scroll event carries twice the delta of another
- **THEN** it zooms by the square of the smaller one's factor, so a continuous device and a notched one both feel proportionate

#### Scenario: Lines and pixels mean the same thing
- **WHEN** a browser reports one notch as three lines and another reports it as ninety-nine pixels
- **THEN** both zoom by the same factor

#### Scenario: The point under the pointer stays there
- **WHEN** the reader zooms with the pointer over a node
- **THEN** that node is under the pointer afterwards

#### Scenario: The floor and ceiling still hold
- **WHEN** the reader keeps scrolling in one direction
- **THEN** the zoom stops at the limits the viewer sets rather than passing them

### Requirement: The tree is rooted on types, not only on classes
A node SHALL be a vertex of the radial tree when its kind is neither `function` nor `file`. The viewer MUST NOT decide this by matching a list of kind names it was taught, because the list is the artifact's to grow.

Every rule that asks whether the drawing has anything to root on, whether a node belongs on a ring rather than in orbit, or whether repeated symbols fold together, SHALL ask the same question the same way.

On three TypeScript projects, between 52% and 60% of top-level declarations are type-shaped and not classes: zod declares 52 classes among 1,816 symbols. A viewer that roots only on classes would arrange such a drawing around 3% of it and hang the rest in orbit — not a worse drawing, an unusable one.

#### Scenario: A drawing whose types are mostly not classes
- **WHEN** an artifact declares far more `interface` and `type` nodes than `class` nodes
- **THEN** all of them are candidates for the tree, and the arrangement is rooted on the type nearest to everything else regardless of which kind it is

#### Scenario: Functions still orbit
- **WHEN** an artifact carries both types and functions
- **THEN** functions are attached to the types they relate to rather than placed on rings of their own

#### Scenario: A kind the viewer was never taught
- **WHEN** an artifact carries nodes of a kind the viewer does not name anywhere
- **THEN** those nodes are treated as types, and no code change is needed to arrange them

### Requirement: The palette and the legend cover the kinds the artifact carries
The settings panel SHALL offer a colour for every node kind and every edge kind
present in the loaded artifact, and the legend SHALL name every one of them.
Neither SHALL show a row for a kind the drawing does not contain.

Edge rows fixed at three and always shown would be harmless only if every
artifact could carry every kind. Only a language with a unit above the file
produces `contains`, and a fixed row for it would sit on every Python and
TypeScript drawing, naming a line that is nowhere in them.

A kind the viewer has a colour for SHALL use it. A kind it does not have a
colour for SHALL be drawn as a type is drawn, not as a file: the viewer knows
such a node anchors rather than orbits, even when it has no name for it.

**Every node-colour row SHALL show what that colour looks like on a node**: the
fill, and the lighter rim the drawing computes from it, beside the control that
sets it. A colour picker shows a flat square, and the drawing does not draw flat
squares.

There SHALL be no sample drawing beside the rows. A sample carrying a node per
kind seats children of a centre far enough apart that no two labels meet — three
a third of a circle apart fits exactly Python's three node kinds — and the number
of kinds grows with every language read. Marks on the rows are what let the panel
grow in the one direction that has room.

Fixing both lists at three node kinds is wrong in both directions. It would have
no row for an `interface`, and it would offer a `file` row whether or not the drawing
contains one. Across the eight Python sample projects there are 189 file nodes
against 10,439 symbols, under 2%, and one project has none at all.

#### Scenario: An artifact with kinds beyond the first three
- **WHEN** an artifact carries `interface` and `enum` nodes
- **THEN** the settings panel offers a colour for each and the legend names each

#### Scenario: A kind absent from the drawing is absent from both lists
- **WHEN** an artifact contains no node of kind `file`
- **THEN** neither the legend nor the settings panel shows a `file` row

#### Scenario: An unnamed kind is still drawn as a type
- **WHEN** an artifact carries a kind the viewer has no colour for
- **THEN** that node is drawn in the colour types are drawn in, not the colour files are drawn in

#### Scenario: A row shows the colour it sets
- **WHEN** the settings panel offers a colour for a node kind
- **THEN** that row shows a mark filled with the colour and rimmed the way the drawing rims it

#### Scenario: A new kind costs a row and nothing else
- **WHEN** an artifact carries a node kind beyond the ones the sample drawing contains
- **THEN** the panel shows that kind's colour on its own row, and the sample drawing is unchanged

#### Scenario: The sample is not a catalogue of kinds
- **WHEN** an artifact carries a node kind nothing anticipated
- **THEN** the panel shows it on a row, and holds no sample drawing that would have to be taught about it

#### Scenario: Go's kinds each have a row
- **WHEN** an artifact carries `struct` and `package` nodes and `contains` edges
- **THEN** the settings panel offers a colour for each, and the legend names each

#### Scenario: An edge kind absent from the drawing is absent from both lists
- **WHEN** a Python artifact carries no `contains` edge
- **THEN** neither the legend nor the settings panel shows a `contains` row

#### Scenario: An edge kind a language never uses is not named either
- **WHEN** an artifact carries `inherits` and `uses` edges and no `references` edge
- **THEN** neither list shows a `references` row

### Requirement: Units are drawn as a tree of their own
Where an artifact carries units, the viewer SHALL arrange the units by the edges between them, and everything else by the edges between everything else. In the whole drawing, an edge that joins a unit to a node that is not a unit SHALL take no part in the arrangement.

A unit SHALL be a node that carries `contains` edges, or a node whose kind is the kind of such a node. The viewer SHALL compare the kind of one node with the kind of another and SHALL NOT match a kind's name. Recognised by its edges alone, a package with no members would be arranged as a type: hugo has 8 such packages and prometheus 2, and some carry edges from package-level code.

Drawn on the same rings, the two structures collapse into each other. A package-to-package edge summarises every edge between two packages' members, and each type's `contains` edge joins it to that summary. On hugo the deepest ring would be the fourth and the most crowded would hold 859 nodes at 2.6px of arc each. Arranged apart, the packages form one group with no type in it: 193 packages in three rings for hugo, 111 for prometheus. The types form a tree 7 rings deep for hugo and 10 for prometheus. Its crowding is in line with Django's and Angular's: 88% and 72% of its tree nodes sit on rings tighter than a node's width, against their 93% and 73%.

What joins the two trees SHALL be the reader's click. Neighbourhood emphasis SHALL read adjacency from the artifact, so a unit's members are its neighbours whether or not a line is drawn between them. A reader who clicks a package sees its members lit in the other tree, and one who clicks a type sees its package lit.

The right-button view SHALL arrange and draw what it shows with every edge among it, these included. Pressed on a unit, it shows what that unit contains, fanned out from it.

A node joined to nothing but units has no edge in the arrangement, and SHALL be placed with the unconnected nodes. This is accepted: 129 of hugo's nodes and 100 of prometheus's, most of them functions and file nodes.

A group of units SHALL be centred on the unit that contains the others: a unit in the group that no unit contains and that contains at least one unit. Nearness cannot find it — every unit has the same size, and a module that many others use is nearer to them than the crate that holds them all. By nearness, sqlparser-ranger's one unit group would be centred on `mod parser` and not on the crate, regex's on `mod cmd` and not on `regex-cli`, ripgrep's on `mod flags` and not on `rg`. Where a group holds several such units, the criterion that chooses every other centre SHALL choose among them. Where it holds none — Go packages do not contain one another — the group SHALL be centred by that same criterion.

Every artifact that carries units SHALL draw its unit tree, however few units there are.

Nothing in this requirement SHALL change how a drawing with no units is arranged or drawn.

#### Scenario: Units and everything else are separate groups
- **WHEN** an artifact carries units joined to one another and to the types they contain
- **THEN** the units are laid out in groups holding only units, and no unit is in a group with a type

#### Scenario: A package with no members is still a unit
- **WHEN** a node of the same kind as the units carries no `contains` edge
- **THEN** it is arranged with the units, not with the types

#### Scenario: A unit kind the viewer has never seen
- **WHEN** an artifact's units have the kind `module`
- **THEN** they are drawn as a tree of their own exactly as `package` units are

#### Scenario: A click lights the other tree
- **WHEN** the reader clicks a unit
- **THEN** every node it contains is emphasised, although no line joins them

#### Scenario: A click on a type lights its unit
- **WHEN** the reader clicks a type contained by a unit
- **THEN** that unit is emphasised

#### Scenario: The right-button view on a unit shows what it contains
- **WHEN** the reader presses the right button on a unit
- **THEN** the view shows the unit and what it contains, with the `contains` lines between them drawn

#### Scenario: Leaving the view hides those lines again
- **WHEN** the reader leaves the right-button view on a unit
- **THEN** the whole drawing shows no line between a unit and a node that is not one

#### Scenario: A node held only by its unit is unconnected
- **WHEN** a function's only edge is the `contains` edge from its unit
- **THEN** it is placed among the unconnected nodes

#### Scenario: A crate is the centre of its modules
- **WHEN** a unit group holds a unit that contains the others, and one of the contained units is nearer to the rest
- **THEN** the containing unit is the group's centre

#### Scenario: Several containing units
- **WHEN** a unit group holds more than one unit that nothing contains and that contains another unit
- **THEN** the centre is one of them, chosen by the same criterion as every other centre

#### Scenario: Units that contain nothing
- **WHEN** no unit in a group contains another unit
- **THEN** the group is centred by the criterion that chooses every other centre

#### Scenario: A drawing without units is not affected
- **WHEN** an artifact carries no `contains` edge
- **THEN** nothing in this requirement changes where a node is placed or how an edge is drawn

### Requirement: Custom Editor opens planisphere.json as the structure graph
The extension SHALL contribute a Custom Editor for `planisphere.json`, the default name, and for any `*.planisphere.json` a reader names, such that opening that file in VS Code/Cursor displays the interactive structure graph loaded from the document contents, without running workspace analysis as part of open.

The graph MUST reach the panel whether or not the webview was ready to receive it when the editor was resolved, and MUST reach it again whenever the webview reloads, which happens without the editor being resolved a second time.

The panel MUST appear as one thing. Its parts become ready at different times, and showing each as it arrives reads as the panel assembling itself rather than opening; until it can show all of them it SHALL show none of them, in a colour that does not itself register as a step.

That promise SHALL hold from the document's first paint, and not only from the moment its stylesheet applies. The rules that keep the panel closed live in a file the webview fetches, and a paint before it arrives shows the markup with the browser's own styling — the rail is six `<button>` elements, which are the only things on the page the browser gives a border and a fill, so what the reader sees is a strip of grey buttons on white. Worse, the rule that hides the legend, the comment box and the settings panel is in that file too, so until it lands those are laid out as well.

So the document SHALL carry, in its own head, the few rules the closed panel is made of, and its content policy SHALL admit them. What is inlined is the closed state and nothing else: the background, the parts held back, and hidden meaning hidden. Every rule about how the drawing looks stays in the one file, so that there is one place a colour or a size is decided.

Waiting has a limit. A part that neither arrives nor fails MUST NOT hold the panel closed indefinitely — the drawing without it beats a panel that never opens.

#### Scenario: Open existing artifact
- **WHEN** the user opens a valid `*.planisphere.json` file in the workspace
- **THEN** the Custom Editor shows the graph from that file and does not spawn the Python analyzer solely because the file was opened

#### Scenario: A named artifact opens too
- **WHEN** the user opens an artifact written with `-o go.planisphere.json`
- **THEN** the Custom Editor shows its graph, exactly as it does for `planisphere.json`

#### Scenario: First open of the session
- **WHEN** the user opens a valid artifact and the panel is being built for the first time, so it is not yet listening when the editor is resolved
- **THEN** the graph is still shown, without the user having to close the editor and open the file again

#### Scenario: Reopen same artifact
- **WHEN** the user closes the Custom Editor for an artifact and later opens the same file again
- **THEN** the graph shown is loaded again from the current file contents (still without re-analyzing the Python workspace on open)

#### Scenario: Editor tab hidden and shown again
- **WHEN** the user switches away from the artifact's editor tab and later switches back, and the panel was discarded and reloaded in between
- **THEN** the graph is shown again, without the file being closed and reopened

#### Scenario: Redundant delivery does not redraw
- **WHEN** the graph reaches a panel that is already showing that same graph
- **THEN** the drawing is left as it is, rather than being rebuilt where the user would watch it appear a second time

#### Scenario: Editing the artifact still redraws
- **WHEN** the artifact's contents change while its editor is open
- **THEN** the panel redraws from the new contents

#### Scenario: A paint before the stylesheet shows nothing either
- **WHEN** the document is painted before its stylesheet has been applied
- **THEN** the reader sees the same closed panel they would see after it — a background and nothing on it — rather than the markup in the browser's own styling

#### Scenario: The panel opens as one thing
- **WHEN** the panel is opened and its controls, its background and its drawing become ready at different moments
- **THEN** none of them is shown until all of them can be, and they appear together

#### Scenario: A part that never arrives does not hold the panel closed
- **WHEN** part of the background cannot be fetched, or its request neither succeeds nor fails
- **THEN** the panel still opens within a bounded time, showing what it does have

#### Scenario: Invalid JSON fails safely
- **WHEN** the user opens a `*.planisphere.json` file that is not valid graph JSON
- **THEN** the extension does not crash and the user receives a clear indication that the document could not be loaded, rather than a panel that stays closed

### Requirement: A reader with nothing to draw is offered a drawing
Where the command cannot produce a drawing — no folder is open, or the folder holds no analyzable source — the viewer SHALL offer a sample project that ships with the product, and produce a drawing of it when the reader accepts.

The sample SHALL be analysed on the reader's machine rather than shipped already drawn. An artifact records absolute paths, so one made elsewhere names files that are not there and every jump from it fails; the gesture the product is for must work in the first drawing a reader sees. Analysing it also says that the install works, which is the first thing to establish when something else does not.

The sample SHALL be of a language that needs nothing installed, so that the offer holds for a reader who has no toolchain at all.

The drawing SHALL be begun when the offer is made rather than when it is accepted. Drawing the sample costs about a second and a half, almost all of it the compiler being loaded, and the reader spends longer than that reading the message it is offered on; begun then, it is waiting by the time they answer. Where they never answer, a second of work is thrown away, which is what the offer is worth.

What a reader waits for after accepting SHALL be the panel opening and nothing else, and where the drawing is already made — the same reader, later — nothing SHALL be drawn again.

The offer SHALL NOT add anything to the command palette or to the explorer's menu. A reader who draws their own projects never meets these messages, and a way in that is used once should not be carried for ever by everyone.

#### Scenario: Nothing is open
- **WHEN** the reader runs the command with no folder open
- **THEN** they are told to open a folder, and offered the sample in the same message

#### Scenario: The folder holds nothing this product reads
- **WHEN** the reader runs the command on a folder holding no analyzable source
- **THEN** they are told so, and offered the sample in the same message

#### Scenario: The sample is drawn without a toolchain
- **WHEN** a reader with no language toolchain installed accepts the offer
- **THEN** a drawing of the sample is produced and opened

#### Scenario: The drawing is waiting when the offer is answered
- **WHEN** the reader accepts the offer after reading the message
- **THEN** the drawing opens without the sample being analysed then

#### Scenario: The same reader, later
- **WHEN** the reader is offered the sample again, and it has been drawn already
- **THEN** it is not drawn again

#### Scenario: The sample's nodes open their source
- **WHEN** the reader activates a node of the sample drawing twice
- **THEN** the file it names is opened, as it would be for a drawing of their own project

#### Scenario: The offer is not a command
- **WHEN** the reader searches the command palette
- **THEN** the sample is not among the commands

### Requirement: What the viewer says about an empty drawing names no language
Where a drawing holds nothing to show, what the viewer says SHALL NOT name one of the languages the product reads. The artifact records no language, and a reader of a Go project told that no Python symbols were found learns only that the product is confused.

#### Scenario: An empty drawing is opened
- **WHEN** a drawing with no nodes is opened
- **THEN** the viewer says it is empty without naming a language

### Requirement: Focusing a node shows what was written about it, or a group's members
While a class or function node is the focus node, the viewer SHALL show what was written about it, beside the drawing: the comment immediately above its definition, or, where there is none, the quoted block that opens it.

What counts is positional and deliberately narrow: the unbroken run of comment lines directly above the definition line, with any decorator or attribute lines among them stepped over. A comment separated from the definition by a blank line or by other code is not above it, a comment on the definition's own line is not above it, and text inside the definition is not above it. None of those is shown.

A comment line SHALL be recognised by its marker, and the markers SHALL be every one the languages read here use: `#`, `//`, and a `/* … */` block whose closing marker is on the line directly above the definition or in the run above it. Within a block, a leading `*` on a continuation line SHALL be removed with the marker, which is how a documentation comment is written. A Rust documentation comment SHALL have its whole marker removed: `///`, followed by a space or ending the line, is a marker as `//` is, and removing only two of the three slashes would leave a `/` at the start of 2,108 of the Rust fixtures' comments. A run of slashes used as a banner — `////////`, `//// Types` — is not that marker and SHALL be read by the `//` rule alone: TypeScript's fixtures write 476 lines beginning `///` above definitions, and the Rust marker applies to only one of them.

A Rust attribute — a line that is `#[…]` or `#![…]`, or one written over several lines from a `#[` to its closing `]` — SHALL be stepped over as a decorator is, wherever it sits in the run above a definition. Read by its first character it is Python's comment marker, and 2,536 of the Rust fixtures' nodes have `#[derive(Debug)]` or its like above their definition. A line counts as an attribute only when it is one whole: a Python comment such as `#[69,99] is in the century 1900` does not close its bracket at the end of the line, and stays a comment.

`#` alone would cover only Python: 1,728 of Angular's nodes, 1,639 of hugo's and 1,892 of prometheus's have a comment directly above the definition, none of them written with `#`, against Python's 197.

Where the rule cannot tell what a line is, it SHALL show less rather than something that is not the definition's comment. It is a positional reading, not a parser, and a panel showing another item's text or the tail of an example misleads where an empty panel does not.

A line that begins with a line-comment marker SHALL be read as a line comment whatever it ends with. Read by its end, `///     /* handle the message */` inside an example would close a block that was never opened and stop the walk there, showing the last lines of an example instead of the documentation. 19 Rust nodes and members carry such a line, tokio's `pipe::Receiver` among them.

A module's own documentation — `//!`, or a block opened by `/*!` — SHALL end the run rather than be shown: it describes the module it is written in, and where it touches the first definition it is not that definition's comment. In the Rust fixtures 5 nodes sit directly under their file's documentation, sqlparser-ranger's `TokenKind` among them.

Which markers count SHALL NOT be decided by the file's name. The artifact records no language, so the viewer does not know one, and an extension list kept beside the analyzers is one more place to go out of step — one missing extension is enough to tell a package written in `.mts` that it holds no analyzable source.

The text SHALL be what the file says when it is asked for, not a copy taken when the graph was analyzed. Where the file is open in an editor with unsaved changes, those are what is shown. Where the file cannot be read, nothing is shown; the viewer MUST remain usable, since the drawing does not depend on the source being present.

Where nothing is written above the definition, the viewer SHALL show a quoted block that opens it: the run of lines from the line below the definition, where the first of them begins with a quote marker, up to and including the line that closes it. This stays a positional reading — what is read is where it sits, not what language the file is in — and it is where a whole language writes what a class is for. Measured over the Python corpus, the share of a project's types the panel has something for goes from almost none to between a third and nine tenths: requests 89%, flask 85%, scrapy 53%, pydantic 46%, django 34%, FastAPI 29%, against 2 of FastAPI's 116 before. What is left is projects that document their functions and not their types.

The quote markers SHALL be removed with the same hand the comment markers are removed with, and a block that opens and closes on one line SHALL be shown as that one line. Where the run above the definition holds a comment, that comment is what is shown and the body is not read at all: what a writer put above the definition is what they meant the reader to find first.

Documentation markup SHALL be removed before the text is shown. A braced tag such as `{@link Thing}` SHALL be shown as `Thing`, and the handful of tags a paragraph is marked up with SHALL be dropped: they are punctuation for a generator, not for a reader looking at a drawing, and jackson-databind's `ObjectMapper` carries eleven of them. The text SHALL keep its own lines: removing markup MUST NOT reflow it.

Nothing SHALL be shown when there is no such comment — not an empty panel, and not the previous node's comment.

The panel SHALL scroll under the wheel when it holds more than it has room for, and a wheel over it MUST NOT zoom the drawing. The drawing's wheel handler runs first for everything inside the viewer, and left to it these events, like the legend's and the settings panel's, would zoom the drawing: a type listing its members — sqlparser-ranger's `Parser` has 69 — could not be read past the panel's height. Where the panel is hidden, the wheel over that corner is the drawing's.

A node that records members SHALL have them listed in that same panel, each one activatable, beside whatever comment the node itself has. A method is not a node and can be reached no other way, and it is what a Go reader looks for first: prometheus records 4,429 of them over 699 types, among them 36 methods named `Append`, 86 named `Close`, 28 named `Run` and 5 named `Start`.

Search SHALL match a member's name as it matches a node's, and choosing one SHALL take the reader to the node that records it, with that member marked in this list and the list scrolled to it. A type may record scores of members — sqlparser-ranger's `Parser` records 69 — and a reader taken to the type without being shown which row was found has been given a haystack. A node that records no members is shown with its comment alone.

A group has as many comments as it has members and no reason to prefer one, so no comment is shown for it. The same panel SHALL show the group's members instead — where each one is, so the reader can tell what the count is made of — and each listed member SHALL be activatable. Since a member is never drawn as a node, this list is the only route from the drawing to any one of them.

#### Scenario: The comment above a definition is shown
- **WHEN** the user focuses a class or function whose definition is directly preceded by comment lines
- **THEN** those lines are shown beside the drawing, with their comment markers removed, in the order they appear in the file

#### Scenario: A decorated definition still finds its comment
- **WHEN** the focused node's definition is preceded by decorators, and comment lines sit above those
- **THEN** those comment lines are shown

#### Scenario: A detached comment is not shown
- **WHEN** the focused node's definition is preceded by a blank line, or by other code, above which there are comments
- **THEN** nothing is shown

#### Scenario: A trailing comment is not shown
- **WHEN** the focused node's definition line carries a comment after the code on that same line
- **THEN** nothing is shown

#### Scenario: A quoted block that opens the definition is shown
- **WHEN** the focused node has a quoted block as the first thing in its body and nothing written above its definition
- **THEN** that block is shown, without its quote markers

#### Scenario: What is above the definition wins
- **WHEN** the focused node has both a comment above its definition and a quoted block opening its body
- **THEN** the comment above it is what is shown

#### Scenario: A one-line quoted block
- **WHEN** the block opening the definition begins and ends on one line
- **THEN** that line is shown, without its markers

#### Scenario: A quoted block that does not open the definition
- **WHEN** the definition's body begins with code, and a quoted block appears after it
- **THEN** nothing is shown

#### Scenario: A braced tag is shown as what it names
- **WHEN** the comment holds `{@link Thing}`
- **THEN** `Thing` is shown, and the braces and the tag are not

#### Scenario: Paragraph markup is dropped
- **WHEN** the comment holds the tags a documentation paragraph is marked up with
- **THEN** they are not shown, and the text keeps the lines it was written on

#### Scenario: The listed members are the only way to reach one
- **WHEN** the reader wants the source of one class a group stands for
- **THEN** the list beside the drawing is where they find it, that member never appearing as a node

#### Scenario: A focused group lists its members
- **WHEN** the user focuses a collapsed group
- **THEN** the panel shows where the group's members are rather than any comment, and each is activatable

#### Scenario: Nothing to show leaves nothing behind
- **WHEN** the user focuses a node with a comment and then focuses one without
- **THEN** the first node's comment is no longer shown

#### Scenario: Losing focus clears it
- **WHEN** the focus is cleared
- **THEN** nothing is shown

#### Scenario: The source being unreadable is not a failure
- **WHEN** the focused node's file cannot be read
- **THEN** nothing is shown, no error interrupts the reader, and the drawing continues to work

#### Scenario: The panel and the legend share one corner
- **WHEN** the legend is open and a comment is to be shown, or the reverse
- **THEN** only one of them is visible at a time

#### Scenario: A focused type lists its methods
- **WHEN** the user focuses a type whose node records members
- **THEN** the panel lists them beside the drawing, each activatable, together with the type's own comment if it has one

#### Scenario: A member is reachable only from the list
- **WHEN** the reader wants the source of one method
- **THEN** the list beside the drawing is where they find it, that method never appearing as a node

#### Scenario: The member the search found is marked
- **WHEN** the reader is taken to a node by choosing one of its members
- **THEN** that member's row is marked in the list and the list is scrolled to it

#### Scenario: Search finds a member
- **WHEN** the reader types a method's name
- **THEN** that member is offered, and choosing it takes them to it

#### Scenario: A node with no members shows its comment alone
- **WHEN** the user focuses a node whose artifact records no members
- **THEN** the panel shows the comment above its definition, with no member list

#### Scenario: A comment written with slashes is shown
- **WHEN** the focused node's definition is directly preceded by lines beginning `//`
- **THEN** those lines are shown, with the marker removed

#### Scenario: A block comment above a definition is shown
- **WHEN** the focused node's definition is directly preceded by a `/* … */` block
- **THEN** its lines are shown, with the markers and any leading `*` removed

#### Scenario: A detached comment in any language is not shown
- **WHEN** a `//` comment is separated from the definition by a blank line
- **THEN** nothing is shown

#### Scenario: A Rust documentation comment is shown without its marker
- **WHEN** the focused node's definition is directly preceded by lines beginning `///`
- **THEN** those lines are shown with all three slashes removed

#### Scenario: A banner of slashes is read by the `//` rule
- **WHEN** a line above a definition is `////////` or `//// Types`
- **THEN** it is read by the `//` rule alone, not as a Rust documentation comment

#### Scenario: An attribute is not documentation
- **WHEN** a `///` comment sits above `#[derive(Debug)]`, which sits above the definition
- **THEN** the comment is shown, and the attribute is not

#### Scenario: An attribute written over several lines
- **WHEN** an attribute opened by `#[` closes on a later line directly above the definition, and a comment sits above it
- **THEN** the comment is shown, and no line of the attribute is

#### Scenario: A Python comment that begins with a bracket
- **WHEN** a Python comment line begins `#[` and does not end with `]`
- **THEN** it is shown as a comment

#### Scenario: A long panel scrolls, and the drawing does not zoom
- **WHEN** the panel is shown and the reader turns the wheel over it
- **THEN** the drawing's zoom is unchanged, the wheel being left to the panel

#### Scenario: The wheel over the drawing still zooms while the panel is open
- **WHEN** the panel is shown and the reader turns the wheel over the drawing
- **THEN** the drawing zooms

#### Scenario: An example ending in a block marker does not cut the comment short
- **WHEN** a `///` line inside a comment's example ends with `*/`
- **THEN** the whole comment is shown from its first line, that line included

#### Scenario: A module's documentation is not the first item's
- **WHEN** `//!` lines sit directly above a definition, with no blank line between
- **THEN** they are not shown for it, and a `///` comment between them and the definition still is

#### Scenario: The file's name decides nothing
- **WHEN** the same comment and definition are read from files with different extensions
- **THEN** the same lines are shown for each

