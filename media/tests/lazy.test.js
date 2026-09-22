"use strict";

// What is built, versus what is drawn.
//
// The viewer hides functions by default, and on CPython that is 71% of the
// elements: built, set to `display: none`, and then positioned, labelled,
// classed and emphasised on every pass through the drawing code — all of it
// for nodes nobody can see.
//
// The rule these guard is that an element exists only once there is a reason
// to draw it, and the thing that makes it safe is that positions do not come
// from what is visible. So the assertion that matters is not "there are fewer
// elements" — a build that dumps every function at the origin would pass that
// — but that a function turned on later lands exactly where the layout had
// already put it, with nothing around it moving.

const {
  loadGraphJs,
  suite,
  ok,
  eq,
  near,
} = require("./harness.js");

const id = (kind, sym) => `/p/m.py::${kind}::${sym}`;
const C = (sym) => ({ id: id("class", sym), name: sym, kind: "class", file: "/p/m.py", line: 1, endLine: 40 });
const F = (sym) => ({ id: id("function", sym), name: sym, kind: "function", file: "/p/m.py", line: 1, endLine: 5 });

/** Four classes off a root, each carrying two functions. */
function mixedGraph() {
  const nodes = [C("Root")];
  const edges = [];
  for (let i = 0; i < 4; i++) {
    nodes.push(C(`K${i}`));
    edges.push({ from: id("class", "Root"), to: id("class", `K${i}`), kind: "uses" });
    for (let j = 0; j < 2; j++) {
      nodes.push(F(`f${i}_${j}`));
      edges.push({ from: id("class", `K${i}`), to: id("function", `f${i}_${j}`), kind: "uses" });
    }
  }
  return { nodes, edges };
}

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

const built = (g) => g.live.cy.nodes().map((n) => n.id());
const positionsOf = (g) => {
  const out = {};
  g.live.cy.nodes().forEach((n) => {
    const p = n.position();
    out[n.id()] = { x: p.x, y: p.y };
  });
  return out;
};
const toggle = (g) => g.el("toggle-fns").dispatch("click");

// ---------------------------------------------------------------------------
suite("hidden kinds are not built up front");

{
  const graph = mixedGraph();
  const g = opened(graph);
  const ids = built(g);

  ok(g.live.hideFunctions, "functions are hidden by default");
  eq(ids.length, 5, `expected only 5 classes built at first, got ${ids.length}`);
  ok(
    !ids.some((i) => i.includes("::function::")),
    "no function should be built"
  );
  // The artifact still holds them: nothing was thrown away, only not built.
  eq(g.live.fullGraph.nodes.length, 13, "the artifact itself is still complete");

  // An edge to something that was never built cannot be built either.
  const ends = g.live.cy.edges().map((e) => e.source().id() + " " + e.target().id());
  ok(
    !ends.some((s) => s.includes("::function::")),
    "no edge touching a function should be built either"
  );
}

// ---------------------------------------------------------------------------
suite("once shown, each one lands where the layout already placed it");

{
  const graph = mixedGraph();
  const g = opened(graph);

  // What the layout says, asked for exactly as the viewer asks for it: the
  // whole folded artifact, not the visible part of it.
  const W = g.live.withGroups(graph);
  const layoutIds = new Set(
    W.graph.nodes.filter((n) => !W.groupOf[n.id]).map((n) => n.id)
  );
  const expected = g.computeClassRingPositions(
    W.graph,
    g.live.visibleCenter(),
    layoutIds,
    {}
  ).positions;

  const before = positionsOf(g);
  toggle(g);
  const after = positionsOf(g);

  ok(!g.live.hideFunctions, "functions are visible after the toggle");

  const fns = Object.keys(after).filter((i) => i.includes("::function::"));
  eq(fns.length, 8, `expected all eight functions, got ${fns.length}`);
  for (const i of fns) {
    ok(expected[i] !== undefined, `the layout already gave ${i} a position`);
    near(after[i].x, expected[i].x, 0.01, `${i} x`);
    near(after[i].y, expected[i].y, 0.01, `${i} y`);
  }

  // The point of the whole arrangement: showing a kind moves nothing.
  for (const i of Object.keys(before)) {
    near(after[i].x, before[i].x, 0.01, `${i} should not move (x)`);
    near(after[i].y, before[i].y, 0.01, `${i} should not move (y)`);
  }
}

// ---------------------------------------------------------------------------
suite("hiding and showing again rebuilds nothing");

{
  const g = opened(mixedGraph());
  toggle(g);
  const first = positionsOf(g);
  const n1 = g.live.cy.nodes().length;
  const e1 = g.live.cy.edges().length;

  toggle(g);
  eq(g.live.cy.nodes().length, n1, "hiding should not remove elements");

  toggle(g);
  eq(g.live.cy.nodes().length, n1, "showing again should not build more nodes");
  eq(g.live.cy.edges().length, e1, "nor more edges");

  const second = positionsOf(g);
  for (const i of Object.keys(first)) {
    near(second[i].x, first[i].x, 0.01, `${i} should not move between the two (x)`);
    near(second[i].y, first[i].y, 0.01, `${i} should not move between the two (y)`);
  }
}

// ---------------------------------------------------------------------------
suite("when the whole graph is functions, none may be left out");

{
  // Hiding a kind that is everything would leave an empty drawing, so
  // `visibleIdSet` keeps them all — and building from the visible set has to
  // inherit that rather than rediscover it. A build that filtered on `kind`
  // instead would draw nothing at all here.
  const nodes = ["a", "b", "c", "d"].map(F);
  const edges = [
    { from: id("function", "a"), to: id("function", "b"), kind: "uses" },
    { from: id("function", "a"), to: id("function", "c"), kind: "uses" },
  ];
  const g = opened({ nodes, edges });

  ok(g.live.hideFunctions, "the setting still hides functions");
  eq(built(g).length, 4, "but in an all-function graph all four are drawn");
  eq(g.live.cy.edges().length, 2, "so are the edges");
}

module.exports = {};
