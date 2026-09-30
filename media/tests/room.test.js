"use strict";

// An open type's members, drawn as the tree they make, where the type stands —
// and the rest of the drawing moving outward to leave room for it.
//
// Opened in place, sqlparser-ranger's `Parser` should read as its grammar: the
// way in beside the type, the statements beyond it, the clauses beyond those.
// And everything that was around `Parser` should still be around it, in the
// same directions, further out.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g0 = loadGraphJs();

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
const PARSER = id("Parser");
const member = (sym, name) => `${id(sym)}::member::${name}`;

/**
 * A parser in a small project: one way in, a chain of rules below it, a
 * helper every rule calls, and a member nothing reaches. Around it, types it
 * points at and a type far off that points at nothing near.
 */
function project() {
  const nodes = [
    N("Parser", "struct", [
      M("statement", 10, ["select", "create"], [id("Ast")]),
      M("select", 20, ["expr", "eat"]),
      M("create", 30, ["eat"]),
      M("expr", 40, ["tail", "eat"]),
      M("tail", 50, ["eat"]),
      M("eat", 60, null, [id("Token")]),
      M("unused", 70),
    ]),
    N("Ast"),
    N("Token"),
    N("Scanner", "struct", [M("next", 5, ["peek"], [id("Token")]), M("peek", 6)]),
    N("Driver"),
  ];
  const edges = [
    E("Parser", "Ast"),
    E("Parser", "Token"),
    E("Parser", "Scanner"),
    E("Scanner", "Token"),
    E("Driver", "Parser"),
  ];
  // A ring of types around the parser, so there is something to move out of
  // the way.
  for (let i = 0; i < 12; i++) {
    nodes.push(N(`Near${i}`));
    edges.push(E("Parser", `Near${i}`));
  }
  return { nodes, edges };
}

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: graph || project() });
  return g;
}

const where = (g) => {
  const out = {};
  g.live.cy.nodes().forEach((n) => (out[n.id()] = { ...n.position() }));
  return out;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);
const turned = (a, b) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

// ---------------------------------------------------------------------------
suite("the tree an open type's members make");

{
  const g = opened();
  g.live.openHere(PARSER);
  const tree = g0.memberTreeOf(g.live.fullGraph, PARSER);
  ok(!!tree, "an open type has a tree");
  const kids = (x) => (tree.children[x] || []).slice().sort().join(",");
  eq(
    kids(PARSER),
    [member("Parser", "statement"), member("Parser", "unused")].sort().join(","),
    "the way in hangs off the type, and so does the member nothing reaches"
  );
  eq(
    kids(member("Parser", "statement")),
    [member("Parser", "create"), member("Parser", "select")].sort().join(","),
    "what the way in calls hangs off it"
  );
  // `eat` is called by `select`, `create`, `expr` and `tail`. The first two
  // are one level out and the others deeper, so it hangs off one of the first
  // two — `create`, which sorts first — and not off anything deeper.
  eq(kids(member("Parser", "create")), member("Parser", "eat"), "a member called from several places hangs off the shallowest");
  eq(kids(member("Parser", "select")), member("Parser", "expr"), "and is not drawn a second time under another");
  eq(kids(member("Parser", "expr")), member("Parser", "tail"), "and so on outward");
}

// ---------------------------------------------------------------------------
suite("where the tree is drawn");

{
  const g = opened();
  g.live.openHere(PARSER);
  const at = where(g);
  const from = (name) => dist(at[member("Parser", name)], at[PARSER]);
  ok(from("statement") < from("select"), "the way in is nearer the type than what it calls");
  ok(from("select") < from("expr"), "and each rule lies beyond the one that calls it");
  ok(from("expr") < from("tail"), "all the way out");
  // `statement` leads to most of the tree, so it is drawn beside the type and
  // what it calls makes the first level around both.
  ok(from("statement") < from("create"), "the way in that holds most of the tree sits beside the type");
  ok(
    Math.abs(from("unused") - from("create")) < 1 && Math.abs(from("select") - from("create")) < 1,
    "and a member nothing reaches is on the first level, with what the way in calls"
  );

  const members = Object.keys(at).filter((x) => x.includes("::member::") && x.startsWith(PARSER));
  let closest = Infinity;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      closest = Math.min(closest, dist(at[members[i]], at[members[j]]));
    }
  }
  ok(closest >= g.SAT_DIAMETER, `no two members overlap; the closest are ${closest.toFixed(1)}px apart`);
}

{
  // The tree is what is drawn, not a line from the type to every member: the
  // type is joined to the first level, and each member further out to what
  // calls it.
  const g = opened();
  g.live.openHere(PARSER);
  const lines = new Set();
  g.live.cy.edges().forEach((e) => lines.add(`${e.data("source")}->${e.data("target")}`));
  const joined = (name) => lines.has(`${PARSER}->${member("Parser", name)}`);
  ok(joined("statement"), "the type is joined to the way in");
  ok(joined("unused"), "and to the member nothing reaches");
  for (const name of ["select", "create", "expr", "tail", "eat"]) {
    ok(!joined(name), `and not to ${name}, which is further out`);
  }
  ok(
    lines.has(`${member("Parser", "expr")}->${member("Parser", "tail")}`),
    "a member further out is joined to what calls it"
  );
}

{
  // Beside the type only when one member holds more than half the tree.
  // Where the ways in are balanced, each sits on the first level in its own
  // slice.
  const graph = project();
  graph.nodes[0].members = [
    M("left", 10, ["a"]),
    M("a", 11, ["b"]),
    M("b", 12),
    M("right", 20, ["c"]),
    M("c", 21, ["d"]),
    M("d", 22),
  ];
  const g = opened(graph);
  g.live.openHere(PARSER);
  const at = where(g);
  const from = (name) => dist(at[member("Parser", name)], at[PARSER]);
  ok(
    Math.abs(from("left") - from("right")) < 1,
    "two ways in holding half each are both on the first level"
  );
  ok(from("left") > g.NODE_DIAMETER * 2, "and neither is drawn beside the type");
}

// ---------------------------------------------------------------------------
suite("what a member's place means");

{
  // `eat` is called by `select` and `create` on the first level, and by `expr`
  // and `tail` further out. It sits one level beyond the nearest of them — the
  // level `expr` is on — and a line joins it to all four: its place says how
  // near the way in it is, and nothing about whose it is.
  const g = opened();
  g.live.openHere(PARSER);
  const at = where(g);
  const from = (name) => dist(at[member("Parser", name)], at[PARSER]);
  ok(Math.abs(from("eat") - from("expr")) < 1, "a member called from several places is at its shortest distance");
  ok(from("eat") < from("tail"), "not beyond a caller that is further out");
  const lines = new Set();
  g.live.cy.edges().forEach((e) => lines.add(`${e.data("source")}->${e.data("target")}`));
  for (const caller of ["select", "create", "expr", "tail"]) {
    ok(lines.has(`${member("Parser", caller)}->${member("Parser", "eat")}`), `${caller} is joined to it`);
  }
}

{
  // Among callers equally near, a fixed order: the same artifact, drawn twice,
  // puts it in the same place.
  const a = opened();
  a.live.openHere(PARSER);
  const b = opened();
  b.live.openHere(PARSER);
  const pa = where(a)[member("Parser", "eat")];
  const pb = where(b)[member("Parser", "eat")];
  eq(`${pa.x.toFixed(6)},${pa.y.toFixed(6)}`, `${pb.x.toFixed(6)},${pb.y.toFixed(6)}`, "the same place both times");
}

// ---------------------------------------------------------------------------
suite("the room made for it");

{
  const g = opened();
  const before = where(g);
  g.live.openHere(PARSER);
  const after = where(g);
  const origin = after[PARSER];
  eq(JSON.stringify(origin), JSON.stringify(before[PARSER]), "the type is where it stood");

  const mine = new Set(Object.keys(after).filter((x) => x.startsWith(PARSER + "::member::")));
  let reach = 0;
  for (const x of mine) reach = Math.max(reach, dist(after[x], origin));

  const others = Object.keys(before).filter((x) => x !== PARSER && after[x]);
  for (const x of others) {
    ok(
      dist(after[x], origin) > reach,
      `${x.split("::").pop()} stands outside the room the tree takes`
    );
  }
  for (const x of others) {
    const was = dist(before[x], origin);
    if (was < 1e-6) continue;
    ok(
      turned(angle(origin, before[x]), angle(origin, after[x])) < 1e-6,
      `${x.split("::").pop()} is in the same direction from the type as it was`
    );
  }
}

{
  // The pass by itself, on positions laid out along one ray: nothing
  // reorders, the room is cleared, and past the bound nothing moves.
  const typeId = "T";
  const graph = {
    nodes: [
      { id: "T", kind: "struct" },
      { id: "T::member::m", kind: "function", member: true },
    ],
    edges: [{ from: "T", to: "T::member::m", kind: "contains" }],
  };
  const room = 100;
  const positions = { T: { x: 0, y: 0 }, "T::member::m": { x: 40, y: 0 } };
  const along = [0.5, 10, 60, 99, 150, 250, 299, 300, 450];
  for (const d of along) positions[`n${d}`] = { x: d, y: 0 };
  g0.makeRoomForMembers(graph, positions, new Map([[typeId, room]]));

  eq(positions["T::member::m"].x, 40, "the type's own member is not moved by its own room");
  let last = 0;
  for (const d of along) {
    const now = positions[`n${d}`].x;
    ok(now >= room || d >= g0.MEMBER_SPREAD * room, `a node that sat at ${d} is out of the room (now ${now.toFixed(1)})`);
    ok(now > last, `a node that sat at ${d} is still beyond the one that sat nearer`);
    last = now;
  }
  for (const d of along.filter((x) => x >= g0.MEMBER_SPREAD * room)) {
    eq(positions[`n${d}`].x, d, `a node at ${d}, past the bound, has not moved`);
  }
}

// ---------------------------------------------------------------------------
suite("two open at once");

{
  const g = opened();
  g.live.openHere(PARSER);
  g.live.openHere(id("Scanner"));
  const at = where(g);
  eq(g.live.openTypes.length, 2, "both are open");
  // The first tree is moved as one body by the second one's room, so it is
  // still the tree it was: every member at the same offset from its type.
  const first = opened();
  first.live.openHere(PARSER);
  const alone = where(first);
  const offset = (pos, x) => ({ x: pos[x].x - pos[PARSER].x, y: pos[x].y - pos[PARSER].y });
  for (const name of ["statement", "select", "expr", "tail", "eat", "unused"]) {
    const a = offset(alone, member("Parser", name));
    const b = offset(at, member("Parser", name));
    ok(dist(a, b) < 1e-6, `${name} keeps its place in its tree when a second type is opened`);
  }
}

// ---------------------------------------------------------------------------
suite("closing gives the space back");

{
  const g = opened();
  const before = where(g);
  g.live.openHere(PARSER);
  g.live.closeHere(PARSER);
  const after = where(g);
  eq(Object.keys(after).sort().join(","), Object.keys(before).sort().join(","), "the same nodes");
  let moved = 0;
  for (const x of Object.keys(before)) if (dist(before[x], after[x]) > 1e-9) moved++;
  eq(moved, 0, "and every one of them where it was");
}
