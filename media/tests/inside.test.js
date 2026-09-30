"use strict";

// What a type is made of, as a drawing of its own.
//
// A method is not a node, so the structure a project builds out of methods is
// nowhere in the drawing: sqlparser-ranger's `Parser` follows SQLite's railroad
// diagrams one method per rule, and all 69 of them sit in a list beside one
// circle. This view gives the canvas over to them.
//
// The centre is a way in — a member nothing else in the type calls. Centred on
// the most-called member instead, the view of that parser is centred on `eat`,
// a one-line helper every rule uses, and the grammar sits behind it.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g0 = loadGraphJs();

const TYPE = "/p/parser.rs::struct::Parser";
const M = (name, line, calls) => ({
  name,
  file: "/p/parser.rs",
  line,
  ...(calls ? { calls } : {}),
});

/** The parser, small enough to read: one way in, one helper everything calls. */
const parser = () => ({
  id: TYPE,
  name: "Parser",
  kind: "struct",
  file: "/p/parser.rs",
  line: 1,
  members: [
    M("sql_stmt_list", 10, ["select_stmt", "create_table_stmt"]),
    M("select_stmt", 20, ["expr", "eat"]),
    M("create_table_stmt", 30, ["eat"]),
    M("expr", 40, ["expr_tail", "eat"]),
    M("expr_tail", 50, ["eat", "eat"]),
    M("eat", 60),
  ],
});

/** A node in a drawing: `Parser` and whatever else the case needs. */
function graphOf(nodes, edges) {
  return { nodes, edges: edges || [] };
}

const plain = (sym) => ({
  id: `/p/${sym}.rs::struct::${sym}`,
  name: sym,
  kind: "struct",
  file: `/p/${sym}.rs`,
  line: 1,
});

const memberId = (name) => `${TYPE}::member::${name}`;
/** The member nodes of a drawing: everything but the type it is of. */
const membersOf = (drawing) => drawing.nodes.filter((n) => n.member);
/** The calls in a drawing: the lines between two members. */
const callsOf = (drawing) =>
  drawing.edges.filter((e) => e.from.includes("::member::") && e.to.includes("::member::"));
const names = (drawing) => membersOf(drawing).map((n) => n.name).sort().join(",");
const lines = (drawing) =>
  callsOf(drawing)
    .map((e) => `${e.from.split("::member::")[1]}->${e.to.split("::member::")[1]}`)
    .sort()
    .join(",");
/** The way in, asked of a drawing the way the layout asks it. */
const wayIn = (drawing) => g0.wayIn(membersOf(drawing), callsOf(drawing));

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

const drawn = (g) =>
  g.live.cy
    .nodes()
    .map((n) => n.id())
    .sort();
const jumps = (g) => g.posted.filter((m) => m.command === "jumpTo");
/** Press the button beside the panel's title that draws the members alone. */
function membersOnly(g) {
  g.el("comment-only").dispatch("click");
}
const press = (g, key) => g.sandbox.__listeners.keydown.forEach((fn) => fn({ key }));

// ---------------------------------------------------------------------------
suite("the drawing a type is turned into");

{
  const d = g0.membersDrawing(parser());
  eq(
    names(d),
    "create_table_stmt,eat,expr,expr_tail,select_stmt,sql_stmt_list",
    "one node per member"
  );
  eq(
    lines(d),
    "create_table_stmt->eat,expr->eat,expr->expr_tail,expr_tail->eat," +
      "select_stmt->eat,select_stmt->expr,sql_stmt_list->create_table_stmt," +
      "sql_stmt_list->select_stmt",
    "one line per call, and `expr_tail` calling `eat` twice is one line"
  );
  ok(d.nodes.some((n) => n.id === TYPE), "the type itself is in the drawing, as the root of it");
  const node = d.nodes.find((n) => n.name === "expr");
  eq(node.id, memberId("expr"), "a member's id is its name under its type's");
  eq(node.file, "/p/parser.rs", "it carries the file it is declared in");
  eq(node.line, 40, "and the line");
}

{
  // A language that overloads writes several members under one name —
  // jackson-databind's `ObjectMapper` declares 172 members under 68 — and a
  // reader thinks of `readValue` as one thing.
  const overloaded = {
    ...parser(),
    members: [
      M("read", 5, ["value"]),
      M("value", 10),
      M("value", 20),
      M("value", 30),
    ],
  };
  const d = g0.membersDrawing(overloaded);
  eq(names(d), "read,value", "three members under one name are one node");
  eq(lines(d), "read->value", "and one line reaches all of them");
  eq(membersOf(d).find((n) => n.name === "value").line, 10, "opening it goes to the first");
}

{
  // Recursion is a fact about a body. Drawn, it is a circle pointing at
  // itself, which says nothing about what the type is made of.
  const recursive = {
    ...parser(),
    members: [M("expr", 5, ["expr", "eat"]), M("eat", 9)],
  };
  eq(lines(g0.membersDrawing(recursive)), "expr->eat", "a member calling itself draws no line");
}

// ---------------------------------------------------------------------------
suite("the way in");

{
  const d = g0.membersDrawing(parser());
  eq(wayIn(d), memberId("sql_stmt_list"), "the one member nothing calls");
  ok(
    wayIn(d) !== memberId("eat"),
    "and not the helper every rule calls, which is what the drawing would pick"
  );
}

{
  // Two ways in: the criterion that chooses every other drawing's centre
  // chooses between them, rather than whichever was written first.
  const two = {
    ...parser(),
    members: [
      M("parse", 5, ["stmt", "expr", "eat"]),
      M("dump", 8, ["eat"]),
      M("stmt", 10, ["expr"]),
      M("expr", 20, ["eat"]),
      M("eat", 30),
    ],
  };
  const d = g0.membersDrawing(two);
  const ways = ["parse", "dump"].map(memberId).sort().join(",");
  eq(ways, [memberId("dump"), memberId("parse")].sort().join(","), "two members nothing calls");
  const only = { nodes: membersOf(d), edges: callsOf(d) };
  eq(
    wayIn(d),
    g0.pickCenterAmong(
      [memberId("parse"), memberId("dump")],
      only,
      new Set(only.nodes.map((n) => n.id))
    ),
    "the drawing's own criterion chooses among them"
  );
  eq(wayIn(d), memberId("parse"), "which here is the one the other five hang from");
}

{
  // Everything is called, so nothing is a way in — a type whose members form a
  // ring. The criterion then chooses over all of them, as it does for a
  // drawing with no obvious root.
  const ring = {
    ...parser(),
    members: [M("a", 1, ["b"]), M("b", 2, ["c"]), M("c", 3, ["a"])],
  };
  const d = g0.membersDrawing(ring);
  const only = { nodes: membersOf(d), edges: callsOf(d) };
  eq(
    wayIn(d),
    g0.pickCenterAmong(
      only.nodes.map((n) => n.id),
      only,
      new Set(only.nodes.map((n) => n.id))
    ),
    "with no way in, the criterion chooses over all of them"
  );
  ok(!!wayIn(d), "and it chooses something");
}

// ---------------------------------------------------------------------------
suite("whether there is anything to show");

{
  ok(g0.isMadeOfMembers(parser().members), "members that call one another");
  ok(
    !g0.isMadeOfMembers([M("a", 1), M("b", 2)]),
    "members that call nothing of their own type are not a structure"
  );
  ok(
    !g0.isMadeOfMembers([M("a", 1, ["b"])]),
    "a call to a name the type does not declare is not one either"
  );
  ok(!g0.isMadeOfMembers([M("a", 1, ["a"])]), "nor is a member calling itself");
  ok(!g0.isMadeOfMembers(undefined), "and a node with no members has nothing to show");
}

// ---------------------------------------------------------------------------
suite("the way in is offered beside the type's name");

{
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  const list = g.el("comment-members");
  ok(!g.el("comment-only").classList.contains("hidden"), "the button to draw the members alone is shown");
  eq(list.children.length, 6, "and the list is one row per member");
  eq(list.children[0].textContent, "sql_stmt_list", "in the order the document gives");
}

{
  // The key does what the button does, on the focused node.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  press(g, "m");
  eq(g.live.insideOf, TYPE, "M draws the focused type's members alone");
  ok(g.el("comment-expand").classList.contains("hidden") || !g.live.focusId, "and expanding is not offered from inside that view");
}

{
  // A type whose methods never mention each other has no structure to show,
  // and a control offering one would open a view of loose circles.
  const alone = { ...parser(), members: [M("a", 1), M("b", 2)] };
  const g = opened(graphOf([alone, plain("Scanner")]));
  g.live.activateFocus(TYPE);
  const list = g.el("comment-members");
  eq(list.children.length, 2, "two rows");
  ok(g.el("comment-only").classList.contains("hidden"), "and no button to draw them alone");
}

// ---------------------------------------------------------------------------
suite("inside the type");

{
  const g = opened(graphOf([parser(), plain("Scanner")], []));
  g.live.activateFocus(TYPE);
  membersOnly(g);

  eq(g.live.insideOf, TYPE, "the viewer is inside that type");
  eq(
    drawn(g).join(","),
    [TYPE]
      .concat(
        ["sql_stmt_list", "select_stmt", "create_table_stmt", "expr", "expr_tail", "eat"].map(memberId)
      )
      .sort()
      .join(","),
    "the canvas holds the type and its members, and nothing else"
  );
  eq(g.live.centerClassId, TYPE, "centred on the type, as the same tree is when opened in place");
  const at = (x) => g.live.cy.getElementById(x).position();
  const from = (x) => Math.hypot(at(x).x - at(TYPE).x, at(x).y - at(TYPE).y);
  ok(
    from(memberId("sql_stmt_list")) < from(memberId("select_stmt")) &&
      from(memberId("select_stmt")) < from(memberId("expr")) &&
      from(memberId("expr")) < from(memberId("expr_tail")),
    "the way in is nearest the type, and each rule lies beyond the one that calls it"
  );
  ok(
    g.live.cy.edges().length >= 8,
    `the calls are drawn, got ${g.live.cy.edges().length} lines`
  );
  eq(g.el("reach-name").textContent, "Parser", "the strip says whose members these are");
  eq(g.el("reach-count").textContent, "6 members", "and how many");
  ok(!g.el("reach-strip").classList.contains("hidden"), "the strip is up");
}

{
  // Where a name stands for several members, the circles are fewer than the
  // panel's rows, and the strip says both numbers rather than leaving one of
  // them looking wrong.
  const overloaded = {
    ...parser(),
    members: [M("read", 5, ["value"]), M("value", 10), M("value", 20), M("value", 30)],
  };
  const g = opened(graphOf([overloaded, plain("Scanner")]));
  g.live.activateFocus(TYPE);
  membersOnly(g);
  eq(drawn(g).length, 3, "two circles, and the type they are of");
  eq(g.el("reach-count").textContent, "2 of 4 members", "and the strip says so");
}

{
  // Members are drawn as functions are. A reader who had functions hidden
  // would otherwise be given an empty canvas.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  ok(g.live.hideFunctions, "functions are hidden to begin with");
  g.live.activateFocus(TYPE);
  membersOnly(g);
  ok(!g.live.hideFunctions, "inside the type they are shown");
  eq(drawn(g).length, 7, "so all six members are on the canvas, with their type");

  g.live.closeInside();
  ok(g.live.hideFunctions, "and hidden again on the way out, as they were");
}

// ---------------------------------------------------------------------------
suite("opening a member from inside the view");

{
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  membersOnly(g);
  const node = g.live.cy.getElementById(memberId("expr"));
  node.emit("tap");
  eq(jumps(g).length, 0, "the first press focuses");
  node.emit("tap");
  const last = jumps(g)[jumps(g).length - 1] || {};
  eq(last.file, "/p/parser.rs", "the second opens the file the member is declared in");
  eq(last.line, 40, "at the line it is declared on");
}

// ---------------------------------------------------------------------------
suite("coming back, and pressing the same node");

{
  // The node was pressed once before the view was entered. Back in the
  // drawing, pressing it is a first press again: it focuses, it does not open
  // the file.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.cy.getElementById(TYPE).emit("tap");
  membersOnly(g);
  press(g, "Escape");
  const before = jumps(g).length;
  g.live.cy.getElementById(TYPE).emit("tap");
  eq(jumps(g).length, before, "the first press after coming back does not open the file");
  eq(g.live.focusId, TYPE, "it focuses the node");
  g.live.cy.getElementById(TYPE).emit("tap");
  eq(jumps(g).length, before + 1, "and the second one does");
}

// ---------------------------------------------------------------------------
suite("leaving it");

{
  const g = opened(graphOf([parser(), plain("Scanner"), plain("Token")]));
  const before = {
    ids: drawn(g).join(","),
    view: [g.live.cy.zoom(), g.live.cy.pan().x, g.live.cy.pan().y].join(","),
  };
  g.live.activateFocus(TYPE);
  membersOnly(g);
  press(g, "Escape");

  eq(g.live.insideOf, null, "the viewer is out");
  eq(drawn(g).join(","), before.ids, "the drawing is the one it was entered from");
  eq(
    [g.live.cy.zoom(), g.live.cy.pan().x, g.live.cy.pan().y].join(","),
    before.view,
    "and the camera is where the reader left it"
  );
  ok(g.el("reach-strip").classList.contains("hidden"), "the strip is down");
  eq(g.live.centerClassId, opened(graphOf([parser(), plain("Scanner"), plain("Token")])).live.centerClassId, "and the centre is the drawing's own again");
}

{
  // The strip's one button, whichever view is up.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  membersOnly(g);
  g.el("reach-back").dispatch("click");
  eq(g.live.insideOf, null, "the button takes the reader out");
}

{
  // A view of what a member points to, taken from inside the type: leaving it
  // goes back to the type, not two steps out to the whole drawing.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  membersOnly(g);
  g.live.cy.getElementById(memberId("select_stmt")).emit("cxttap");
  press(g, "Escape");
  eq(g.live.insideOf, TYPE, "still inside the type");
  eq(drawn(g).length, 7, "with all of its members back");
  press(g, "Escape");
  eq(g.live.insideOf, null, "and the next press leaves it");
}

{
  // A new artifact is a new drawing, and nothing of the old view survives it.
  const g = opened(graphOf([parser(), plain("Scanner")]));
  g.live.activateFocus(TYPE);
  membersOnly(g);
  g.send({ command: "setGraph", graph: graphOf([plain("Other")]) });
  eq(g.live.insideOf, null, "the view is forgotten");
  ok(g.el("reach-strip").classList.contains("hidden"), "and its strip with it");
}
