"use strict";

// Hiding a kind hides that kind. Nothing else.
//
// The assertion is deliberately unqualified: every node drawn before and after
// must be in the same place — no category of node is excluded as one the
// layout "makes no promise about", whether satellites that leave the tree,
// nodes in the grid or groups the packer moves. With one layout there is
// nothing to exclude, and a test that needs exclusions is testing a weaker
// rule than the one being made.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const id = (file, sym, kind) => `/p/${file}::${kind || "class"}::${sym}`;
const N = (file, sym, kind) => ({
  id: id(file, sym, kind),
  name: sym,
  kind: kind || "class",
  file: `/p/${file}`,
  line: 1,
});

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

function snapshot(L) {
  const out = {};
  L.cy.nodes().forEach((n) => {
    if (n.style("display") === "none") return;
    const p = n.position();
    out[n.id()] = { x: p.x, y: p.y };
  });
  return out;
}

/** Every node in both snapshots that moved, and the furthest. */
function drift(a, b) {
  let moved = 0;
  let worst = 0;
  let shared = 0;
  for (const [nodeId, p] of Object.entries(a)) {
    const q = b[nodeId];
    if (!q) continue;
    shared++;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d > 0.5) moved++;
    worst = Math.max(worst, d);
  }
  return { moved, worst, shared };
}

/** A class tree, plus the three shapes that decide this rule. */
function mixed() {
  const nodes = [N("root.py", "Root")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(N(`c${i}.py`, `C${i}`));
    edges.push({ from: id("root.py", "Root"), to: id(`c${i}.py`, `C${i}`), kind: "uses" });
  }

  // (a) a class whose only neighbours are functions
  nodes.push(N("stray.py", "Stray"), N("mk.py", "make", "function"));
  edges.push(
    { from: id("c2.py", "C2"), to: id("mk.py", "make", "function"), kind: "uses" },
    { from: id("mk.py", "make", "function"), to: id("stray.py", "Stray"), kind: "uses" }
  );

  // (b) two parts joined only through a function
  nodes.push(N("isle.py", "Isle"), N("isle2.py", "Isle2"), N("bridge.py", "bridge", "function"));
  edges.push(
    { from: id("isle.py", "Isle"), to: id("isle2.py", "Isle2"), kind: "uses" },
    { from: id("isle.py", "Isle"), to: id("bridge.py", "bridge", "function"), kind: "uses" },
    { from: id("bridge.py", "bridge", "function"), to: id("root.py", "Root"), kind: "uses" }
  );

  // (c) a hub function many classes reach the drawing through
  nodes.push(N("util.py", "util", "function"));
  edges.push({ from: id("util.py", "util", "function"), to: id("root.py", "Root"), kind: "uses" });
  for (let i = 0; i < 8; i++) {
    nodes.push(N(`k${i}.py`, `K${i}`));
    edges.push({ from: id(`k${i}.py`, `K${i}`), to: id("util.py", "util", "function"), kind: "uses" });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
suite("toggling kinds moves nothing");

{
  const g = opened(mixed());
  const L = g.live;

  const start = snapshot(L);
  g.el("toggle-fns").dispatch("click");
  const shown = snapshot(L);
  const out = drift(start, shown);
  ok(out.shared > 10, `expected enough nodes to compare, got ${out.shared}`);
  eq(out.moved, 0, `showing functions: ${out.moved} of ${out.shared} shared nodes moved, farthest ${out.worst.toFixed(0)}px`);

  g.el("toggle-fns").dispatch("click");
  const back = snapshot(L);
  const inn = drift(start, back);
  eq(inn.moved, 0, `hiding them again: ${inn.moved} moved, farthest ${inn.worst.toFixed(0)}px`);

  // And the toggle did something, so this is not vacuous.
  const fns = Object.keys(shown).filter((k) => k.indexOf("::function::") !== -1).length;
  ok(fns >= 3, `expected functions to actually be drawn, got ${fns}`);
  eq(
    Object.keys(back).filter((k) => k.indexOf("::function::") !== -1).length,
    0,
    "functions are gone once hidden"
  );
}

// ---------------------------------------------------------------------------
suite("a class related only through a function starts in place");

{
  const g = opened(mixed());
  const L = g.live;
  const P = (x) => {
    const n = L.cy.getElementById(x);
    return n.empty() || n.style("display") === "none" ? null : n.position();
  };
  const stray = P(id("stray.py", "Stray"));
  const c2 = P(id("c2.py", "C2"));
  ok(stray && c2, "both are drawn");
  const d = Math.hypot(stray.x - c2.x, stray.y - c2.y);
  ok(
    d < g.RING_RADIUS,
    `with functions hidden Stray should be beside C2, got ${Math.round(d)}px`
  );

  // No edge is drawn to it while its function is hidden. cytoscape does not set
  // an edge's own `display` when an endpoint goes; it simply does not render
  // it. So the question is whether both ends are on screen, which is also the
  // question a reader is asking.
  const drawnEdge = (e) => {
    const a = L.cy.getElementById(e.data("source"));
    const b = L.cy.getElementById(e.data("target"));
    return a.nonempty() && b.nonempty() &&
      a.style("display") !== "none" && b.style("display") !== "none";
  };
  const touching = L.cy
    .edges()
    .filter((e) => e.data("source") === id("stray.py", "Stray") || e.data("target") === id("stray.py", "Stray"))
    .filter(drawnEdge)
    .length;
  eq(touching, 0, "it has no edges while functions are hidden");
}

// ---------------------------------------------------------------------------
suite("a connection through a hidden function still counts");

{
  const g = opened(mixed());
  const L = g.live;
  const groupOf = L.nodeGroups || {};
  // A group is still rooted in class-to-class structure: an island that reaches
  // the main tree only through a function keeps a group of its own. What it
  // does not do is sit somewhere unrelated — it is placed beside the function
  // it reaches through, which is right beside the tree.
  // The layout, not the drawing: `bridge` is a function and functions are not
  // built while they are hidden. Where it was placed is still the question.
  const P = (x) =>
    (L.lastLayout && L.lastLayout.positions[x]) || L.cy.getElementById(x).position();
  const isle = P(id("isle.py", "Isle"));
  const bridge = P(id("bridge.py", "bridge", "function"));
  ok(
    Math.hypot(isle.x - bridge.x, isle.y - bridge.y) < g.RING_RADIUS,
    "the island should sit beside the function it connects through"
  );
  eq(
    groupOf[id("isle2.py", "Isle2")],
    groupOf[id("isle.py", "Isle")],
    "the island's two classes share a group"
  );

  const groupsHidden = new Set(Object.values(groupOf)).size;
  g.el("toggle-fns").dispatch("click");
  const groupsShown = new Set(Object.values(L.nodeGroups)).size;
  eq(groupsShown, groupsHidden, `the group count should not change with the toggle: ${groupsHidden} → ${groupsShown}`);
}

// ---------------------------------------------------------------------------
suite("groups cannot be expanded");

{
  const nodes = [N("base.py", "Base"), N("hub.py", "Hub")];
  const edges = [{ from: id("base.py", "Base"), to: id("hub.py", "Hub"), kind: "uses" }];
  for (let i = 0; i < 4; i++) {
    nodes.push(N(`m${i}.py`, "Reader"));
    edges.push({ from: id(`m${i}.py`, "Reader"), to: id("base.py", "Base"), kind: "inherits" });
  }
  const g = opened({ nodes, edges });
  const L = g.live;
  const groupId = Object.keys(L.groupsById)[0];
  ok(!!groupId, "a group is found");

  const drawnCount = () => L.cy.nodes().filter((n) => n.style("display") !== "none").length;
  const before = drawnCount();

  L.activateFocus(groupId);
  g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "e" }));
  eq(drawnCount(), before, "pressing e should not reveal members");

  for (let i = 0; i < 4; i++) {
    const m = L.cy.getElementById(id(`m${i}.py`, "Reader"));
    ok(
      m.empty() || m.style("display") === "none",
      `member ${i} should never be drawn`
    );
  }
}

module.exports = {};
