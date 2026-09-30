"use strict";

// A type opened where it stands: its members drawn in its own place, with the
// rest of the drawing around them.
//
// What a reader asks next about a method is what it touches outside its type,
// and the answer is only an answer beside the project it is asked in. So the
// type stays, everything pointing at it keeps pointing at it, and the lines it
// has are drawn from the methods that account for them.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const id = (sym, kind) => `/p/${sym}.rs::${kind || "struct"}::${sym}`;
const M = (name, line, calls, points) => ({
  name,
  file: "/p/parser.rs",
  line,
  ...(calls ? { calls } : {}),
  ...(points ? { points } : {}),
});
const N = (sym, kind, members) => ({
  id: id(sym, kind),
  name: sym,
  kind: kind || "struct",
  file: `/p/${sym}.rs`,
  line: 1,
  ...(members ? { members } : {}),
});
const E = (from, to, kind) => ({ from: id(from), to: id(to), kind: kind || "uses" });

/**
 * `Parser` is made of methods that call one another and reach two other types;
 * `Ast` is what its own declaration names, which no method accounts for.
 */
function project() {
  return {
    nodes: [
      N("Parser", "struct", [
        M("statement", 10, ["expr"], [id("Scanner")]),
        M("expr", 20, ["eat"], [id("Token")]),
        M("eat", 30, null, [id("Token")]),
      ]),
      N("Scanner", "struct", [M("next", 5, null, [id("Token")])]),
      N("Token"),
      N("Ast"),
      N("Driver"),
    ],
    edges: [
      E("Parser", "Scanner"),
      E("Parser", "Token"),
      E("Parser", "Ast", "references"),
      E("Scanner", "Token"),
      E("Driver", "Parser"),
    ],
  };
}

const PARSER = id("Parser");
const member = (sym, name) => `${id(sym)}::member::${name}`;

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: graph || project() });
  return g;
}

const drawn = (g) =>
  g.live.cy
    .nodes()
    .map((n) => n.id())
    .sort();
const lines = (g) =>
  g.live.cy
    .edges()
    .map((e) => `${e.data("source")}->${e.data("target")}`)
    .sort();
const has = (g, from, to) => lines(g).includes(`${from}->${to}`);
const jumps = (g) => g.posted.filter((m) => m.command === "jumpTo");
const press = (g, key) => g.sandbox.__listeners.keydown.forEach((fn) => fn({ key }));

/** The button beside the panel's title that expands a type's members. */
const expand = (g) => g.el("comment-expand");
const shown = (el) => !el.classList.contains("hidden");

// ---------------------------------------------------------------------------
suite("the offer, beside the type's name");

{
  const g = opened();
  g.live.activateFocus(PARSER);
  ok(shown(expand(g)), "the button to expand members is shown");
  eq(expand(g).attributes["aria-pressed"], "false", "and not pressed, nothing being open");
  ok(shown(g.el("comment-only")), "the view of the members alone is offered beside it");
  eq(g.el("comment-members").children.length, 3, "and the list is the members, nothing else");
}

{
  // A type whose members record nothing has no structure to show.
  const graph = project();
  graph.nodes[0].members = [M("statement", 10), M("expr", 20)];
  const g = opened(graph);
  g.live.activateFocus(PARSER);
  ok(!shown(expand(g)), "no button to expand");
  ok(!shown(g.el("comment-only")), "nor to draw them alone");
  eq(g.el("comment-members").children.length, 2, "and the members are listed as they always are");
}

{
  // Clicking something else takes the buttons down with the list they head.
  const g = opened();
  g.live.activateFocus(PARSER);
  g.live.activateFocus(id("Token"));
  ok(!shown(expand(g)), "a type without members has no buttons");
}

{
  // The key does what the button does, on the focused node.
  const g = opened();
  g.live.activateFocus(PARSER);
  press(g, "e");
  eq(g.live.openTypes.join(","), PARSER, "E opens the focused type");
  eq(expand(g).attributes["aria-pressed"], "true", "and the button shows it pressed");
  press(g, "e");
  eq(g.live.openTypes.length, 0, "and E again puts it away");
}

// ---------------------------------------------------------------------------
suite("what is drawn when a type is opened");

{
  const g = opened();
  const before = drawn(g);
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");

  eq(g.live.openTypes.join(","), PARSER, "the type is open");
  for (const was of before) ok(drawn(g).includes(was), `${was} is still drawn`);
  for (const name of ["statement", "expr", "eat"]) {
    ok(drawn(g).includes(member("Parser", name)), `${name} is drawn`);
  }
  eq(drawn(g).length, before.length + 3, "one node per member name, and nothing else new");
  ok(has(g, PARSER, member("Parser", "statement")), "the type contains its members");
}

{
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");

  // The three kinds of line.
  ok(
    has(g, member("Parser", "statement"), member("Parser", "expr")),
    "a member calls another member"
  );
  ok(
    has(g, member("Parser", "statement"), id("Scanner")),
    "a member reaches the node it records"
  );
  ok(
    has(g, member("Parser", "expr"), id("Token")) && has(g, member("Parser", "eat"), id("Token")),
    "both members that name `Token` reach it"
  );
  ok(!has(g, PARSER, id("Scanner")), "the type no longer draws what a member accounts for");
  ok(!has(g, PARSER, id("Token")), "nor the other one");
  ok(has(g, PARSER, id("Ast")), "what no member accounts for is still the type's");
  ok(has(g, id("Driver"), PARSER), "and what points at the type still points at the type");

  const kind = g.live.cy
    .edges()
    .filter((e) => e.data("source") === member("Parser", "statement") && e.data("target") === id("Scanner"))
    .map((e) => e.data("kind"));
  eq(kind.join(","), "uses", "a member's line is drawn as the type's line to that node was");
}

// ---------------------------------------------------------------------------
suite("a member drawn in place");

{
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  const node = g.live.cy.getElementById(member("Parser", "expr"));
  node.emit("tap");
  eq(jumps(g).length, 0, "the first press focuses");
  node.emit("tap");
  const last = jumps(g)[jumps(g).length - 1] || {};
  eq(last.file, "/p/parser.rs", "the second opens the file it is declared in");
  eq(last.line, 20, "at its line");
}

{
  // The ƒ toggle answers whether the reader wants the project's functions.
  const g = opened();
  ok(g.live.hideFunctions, "functions are hidden to begin with");
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  eq(
    drawn(g).filter((x) => x.includes("::member::")).length,
    3,
    "an open type's members are drawn while functions are hidden"
  );
}

// ---------------------------------------------------------------------------
suite("where the members are put");

{
  // A member belongs beside the type it is a method of. Seated by what it
  // points at instead, `Parser`'s methods would ring `Scanner`, and two types'
  // methods would land in one another's places.
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  const at = (x) => g.live.cy.getElementById(x).position();
  const gap = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
  for (const name of ["statement", "expr", "eat"]) {
    const mine = gap(member("Parser", name), PARSER);
    for (const other of [id("Scanner"), id("Token"), id("Ast")]) {
      ok(
        mine < gap(member("Parser", name), other),
        `${name} sits nearer the type it belongs to than to ${other}`
      );
    }
  }
}

{
  // Room is made for the ring, rather than its contents piling up inside a gap
  // sized for one node.
  const graph = project();
  graph.nodes[0].members = [];
  for (let i = 0; i < 12; i++) {
    graph.nodes[0].members.push(M(`m${i}`, 10 + i, i ? [`m${i - 1}`] : null, [id("Token")]));
  }
  const g = opened(graph);
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  const ids = drawn(g).filter((x) => x.includes("::member::"));
  eq(ids.length, 12, "twelve members drawn");
  const at = (x) => g.live.cy.getElementById(x).position();
  let closest = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      closest = Math.min(closest, Math.hypot(at(ids[i]).x - at(ids[j]).x, at(ids[i]).y - at(ids[j]).y));
    }
  }
  ok(
    closest >= g.SAT_DIAMETER,
    `no two members overlap; the closest pair is ${closest.toFixed(1)}px apart`
  );
}

// ---------------------------------------------------------------------------
suite("more than one at a time");

{
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  g.live.activateFocus(id("Scanner"));
  expand(g).dispatch("click");

  eq(g.live.openTypes.length, 2, "both are open");
  ok(drawn(g).includes(member("Scanner", "next")), "the second type's member is drawn");
  ok(drawn(g).includes(member("Parser", "expr")), "and the first type's members are still there");
  ok(has(g, member("Scanner", "next"), id("Token")), "each draws its own lines");
  ok(has(g, member("Parser", "eat"), id("Token")), "to the same node, from both");
}

// ---------------------------------------------------------------------------
suite("closing");

{
  const g = opened();
  const before = { ids: drawn(g).join(","), lines: lines(g).join(",") };
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  eq(expand(g).attributes["aria-pressed"], "true", "the button is pressed while the type is open");
  expand(g).dispatch("click");

  eq(g.live.openTypes.length, 0, "nothing is open");
  eq(drawn(g).join(","), before.ids, "the drawing is the one it was opened from");
  eq(lines(g).join(","), before.lines, "and the type draws its own lines again");
}

{
  // One press, one thing: the most recently opened.
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  g.live.activateFocus(id("Scanner"));
  expand(g).dispatch("click");

  press(g, "Escape");
  eq(g.live.openTypes.join(","), PARSER, "the second one closed");
  ok(drawn(g).includes(member("Parser", "expr")), "the first is still open");
  press(g, "Escape");
  eq(g.live.openTypes.length, 0, "and the next press closes that one");
}

{
  // The views that cover the drawing are left first.
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  g.live.cy.getElementById(id("Driver")).emit("cxttap");
  press(g, "Escape");
  eq(g.live.openTypes.join(","), PARSER, "leaving the right button's view leaves the type open");
  press(g, "Escape");
  eq(g.live.openTypes.length, 0, "and the press after it closes the type");
}

{
  // A new artifact is a new drawing.
  const g = opened();
  g.live.activateFocus(PARSER);
  expand(g).dispatch("click");
  g.send({ command: "setGraph", graph: { nodes: [N("Other")], edges: [] } });
  eq(g.live.openTypes.length, 0, "nothing is open in the drawing that arrived");
  eq(drawn(g).join(","), id("Other"), "and nothing of the old one is drawn");
}
