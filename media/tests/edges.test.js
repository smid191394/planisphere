"use strict";

// Which lines the drawing draws at full strength.
//
// The arrangement is a tree: every node was put where it is because one
// neighbour was chosen as its parent, and every satellite because one class
// was chosen as its owner. But the edges drawn over that arrangement are all
// of them — on Django 7,119 lines across a tree built from 2,864 of them, on
// CPython 9,435 over 4,011. The other 60% run between nodes the placement
// never related, at whatever angle the two positions happen to make, and at
// full strength they read as if they were the structure.
//
// So the lines that explain the arrangement are drawn at full strength, and the
// rest are dimmed. Nothing is hidden: a dimmed line is still there to be
// followed, and clicking either end brings it back — the emphasis rules are
// declared after this one for that reason.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const id = (sym, kind) => `/p/${sym}.py::${kind || "class"}::${sym}`;
const N = (sym, kind) => ({
  id: id(sym, kind),
  name: sym,
  kind: kind || "class",
  file: `/p/${sym}.py`,
  line: 1,
});
const E = (a, b, ka, kb) => ({ from: id(a, ka), to: id(b, kb), kind: "uses" });

/**
 * A tree with one edge that cannot be part of it.
 *
 * `B` and `C` are both children of `A`, so the `B->C` edge relates two nodes
 * the placement put on the same ring — it is not why either of them is where
 * it is. `f` orbits `A`, which is a placement decision and so is drawn.
 */
function treeWithACrossEdge() {
  return {
    nodes: [N("Root"), N("A"), N("B"), N("C"), N("D"), N("f", "function")],
    edges: [
      E("Root", "A"),
      E("Root", "D"),
      E("A", "B"),
      E("A", "C"),
      E("B", "C"), // the cross edge
      E("A", "f", "class", "function"), // the satellite's own edge
    ],
  };
}

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

/** Every drawn edge as `source|target|dimmed`. */
function drawn(g) {
  const out = new Map();
  g.live.cy.edges().forEach((e) => {
    out.set(e.source().id() + "|" + e.target().id(), e.hasClass("crossing"));
  });
  return out;
}

const dimmed = (m, a, b, ka, kb) => m.get(id(a, ka) + "|" + id(b, kb));

// ---------------------------------------------------------------------------
suite("edges used to lay out the tree are drawn as they are");

{
  const g = opened(treeWithACrossEdge());
  const m = drawn(g);

  eq(dimmed(m, "Root", "A"), false, "a parent-child edge is not faded");
  eq(dimmed(m, "Root", "D"), false, "another parent-child edge is not faded either");
  eq(dimmed(m, "A", "B"), false, "a parent-child edge one level deeper is not faded either");
  eq(dimmed(m, "A", "C"), false, "nor is the other child on the same level");
}

// ---------------------------------------------------------------------------
suite("edges that took no part in the layout are faded");

{
  const g = opened(treeWithACrossEdge());
  const m = drawn(g);
  eq(dimmed(m, "B", "C"), true, "B and C are both children of A, this edge is not why either of them sits there");
}

// ---------------------------------------------------------------------------
suite("a satellite's edge back to its own star is drawn as it is too");

{
  // A satellite is placed by its owner, so that edge is a placement decision
  // exactly as a parent link is — and it is the shortest line in the drawing,
  // so dimming it would make the tightest relationship the faintest.
  const g = opened(treeWithACrossEdge());
  g.el("toggle-fns").dispatch("click"); // the satellite is a function
  const m = drawn(g);
  eq(dimmed(m, "A", "f", "class", "function"), false, "the edge from satellite to owner is not faded");
}

// ---------------------------------------------------------------------------
suite("edge direction does not matter");

{
  // The graph records a direction; the placement does not. A parent link
  // written child-to-parent is the same relationship and must read the same.
  const graph = treeWithACrossEdge();
  for (const e of graph.edges) {
    if (e.from === id("A") && e.to === id("B")) {
      e.from = id("B");
      e.to = id("A");
    }
  }
  const g = opened(graph);
  const m = drawn(g);
  eq(dimmed(m, "B", "A"), false, "a parent-child edge written the other way is not faded either");
}

// ---------------------------------------------------------------------------
suite("hiding functions and showing them again fades the same edges");

{
  // The classes are set from the arrangement, and the arrangement is recomputed
  // on every view change. A line that came back bright after a toggle would be
  // a line the reader had already learnt to skip.
  const graph = treeWithACrossEdge();
  const g = opened(graph);
  const before = drawn(g);
  const toggle = g.el("toggle-fns");
  toggle.dispatch("click"); // functions shown
  const shown = drawn(g);
  toggle.dispatch("click"); // and hidden again
  const after = drawn(g);
  toggle.dispatch("click"); // and shown a second time
  const again = drawn(g);

  // The toggle really did something, or the rest of this suite proves nothing.
  ok(shown.size > 0, "there are still edges to look at after toggling");
  eq(shown.get(id("B") + "|" + id("C")), true, "after showing functions, that diagonal edge is still faded");

  let moved = 0;
  for (const [k, v] of before) if (after.get(k) !== v) moved++;
  eq(moved, 0, "toggling there and back leaves every edge's shade unchanged");

  // The drawing grows and never shrinks: the lines the functions brought stay
  // built once they have been asked for. So the count to compare is not the
  // opening one — it is the same state twice.
  ok(after.size >= before.size, `hiding should not remove edges: ${before.size} → ${after.size}`);
  eq(again.size, shown.size, "showing a second time creates no extra edges");
  let differed = 0;
  for (const [k, v] of shown) if (again.get(k) !== v) differed++;
  eq(differed, 0, "and every edge has the same shade as the first time");
}

module.exports = {};

// ---------------------------------------------------------------------------
// What a click does to the lines that touch the node clicked.
//
// Without this, clicking prometheus's `Labels`, which has 169 edges, would
// leave many of them at the faded weight while the nodes at their far ends
// were emphasised: a lit node, a lit neighbour, and almost nothing drawn
// between them.

/** A tree with faded edges both touching one node and running between two of its neighbours. */
function treeWithFadedEdgesAround() {
  return {
    nodes: [N("Root"), N("A"), N("B"), N("C"), N("D")],
    edges: [
      E("Root", "A"),
      E("Root", "D"),
      E("A", "B"),
      E("A", "C"),
      E("B", "C"),
      E("B", "D"),
      E("C", "D"),
    ],
  };
}

/** Every edge as `source|target` -> { faded, opacity }, read from the drawing. */
function look(g) {
  const out = new Map();
  g.live.cy.edges().forEach((e) => {
    out.set(e.source().id() + "|" + e.target().id(), {
      faded: e.hasClass("crossing"),
      opacity: Number(e.style("opacity")),
      touches: (id) => e.source().id() === id || e.target().id() === id,
    });
  });
  return out;
}

const touching = (m, node) => [...m.entries()].filter(([k]) => k.split("|").includes(node));
const away = (m, node) => [...m.entries()].filter(([k]) => !k.split("|").includes(node));
const tap = (g, nodeId) => g.live.cy.getElementById(nodeId).emit("tap");
const tapSpace = (g) => g.live.cy.emit("tap");
const opacities = (list) => [...new Set(list.map(([, v]) => v.opacity))].join(", ");

// ---------------------------------------------------------------------------
suite("clicking a node makes the faded edges on it visible");

{
  const g = opened(treeWithFadedEdgesAround());
  const before = look(g);
  const fadedOnIt = touching(before, id("B")).filter(([, v]) => v.faded);
  ok(fadedOnIt.length > 0, `this graph should have faded edges on B, got ${fadedOnIt.length}`);

  tap(g, id("B"));
  const after = look(g);
  for (const [key] of fadedOnIt) {
    eq(after.get(key).opacity, 1, `with B clicked, the edge ${key.split("|").map((x) => x.split("::").pop()).join(" → ")} should be fully shown`);
  }
}

// ---------------------------------------------------------------------------
suite("faded edges between neighbours are unaffected");

{
  const g = opened(treeWithFadedEdgesAround());
  const before = look(g);
  const elsewhere = away(before, id("B")).filter(([, v]) => v.faded);
  ok(elsewhere.length > 0, `this graph should have faded edges not on B, got ${elsewhere.length}`);

  tap(g, id("B"));
  const after = look(g);
  for (const [key] of elsewhere) {
    ok(after.get(key).opacity < 1, `${key.split("|").map((x) => x.split("::").pop()).join(" → ")} is not on B and should stay as it was, got ${after.get(key).opacity}`);
  }
}

// ---------------------------------------------------------------------------
suite("restored once the node is no longer clicked");

{
  // Each way back, walked rather than asserted about a function call: another
  // node takes the focus, the reader taps empty space, the centre key lets the
  // node go, and the right button's view opens and closes.
  const start = () => {
    const g = opened(treeWithFadedEdgesAround());
    const before = look(g);
    const faded = touching(before, id("B")).filter(([, v]) => v.faded).map(([k]) => k);
    tap(g, id("B"));
    return { g, faded };
  };
  /**
   * The way back, as an invariant rather than as a list of edges.
   *
   * Naming a centre re-lays the drawing, and an edge that was faded can become
   * part of the new arrangement and be drawn at full strength for a reason that
   * has nothing to do with the click. What must hold on every path is that no
   * faded line is left lit.
   */
  const nothingLeftLit = (g, how) => {
    // Except the edges of whatever is the focus now: a node that takes the
    // focus lights its own lines, which is the whole point. What must not
    // survive is the mark left by the node that had it.
    const now = g.live.focusId;
    const lit = [...look(g).entries()].filter(
      ([k, v]) => v.faded && v.opacity === 1 && !(now && k.split("|").includes(now))
    );
    eq(lit.length, 0, `${how}: no faded edge should be left fully lit, got ${lit.map(([k]) => k.split("|").map((x) => x.split("::").pop()).join(" → ")).join(", ")}`);
  };
  /** Where the drawing is not re-laid, the same lines are faint again. */
  const backToFaded = (g, faded, how) => {
    nothingLeftLit(g, how);
    const m = look(g);
    for (const key of faded) {
      ok(m.get(key).opacity < 1, `${how}: ${key.split("|").map((x) => x.split("::").pop()).join(" → ")} should fade again, got ${m.get(key).opacity}`);
    }
  };

  {
    const { g, faded } = start();
    tap(g, id("Root"));
    backToFaded(g, faded, "clicking Root instead");
  }
  {
    // A neighbour of B takes the focus, so B's lines are still inside the
    // emphasised neighbourhood and nothing dims them. A mark left behind by the
    // previous focus shows here and nowhere else: moving to a node further off
    // hides it, because the line is dimmed for being far away instead.
    const { g, faded } = start();
    tap(g, id("A"));
    backToFaded(g, faded, "clicking the neighbouring A instead");
  }
  {
    const { g, faded } = start();
    tapSpace(g);
    backToFaded(g, faded, "clicking empty space");
  }
  {
    const { g, faded } = start();
    g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "c" }));
    // Naming a centre re-lays the drawing, so only the invariant holds here.
    nothingLeftLit(g, "pressing c to name a centre");
  }
  {
    const { g, faded } = start();
    g.live.cy.getElementById(id("Root")).emit("cxttap");
    nothingLeftLit(g, "entering the right-click view");
    g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "Escape" }));
    backToFaded(g, faded, "leaving the right-click view");
  }
}

// ---------------------------------------------------------------------------
suite("with no node clicked, the same edges are faded");

{
  const g = opened(treeWithFadedEdgesAround());
  const before = look(g);
  tap(g, id("B"));
  tapSpace(g);
  const after = look(g);
  const fadedBefore = [...before.entries()].filter(([, v]) => v.faded).map(([k]) => k).sort().join(",");
  const fadedAfter = [...after.entries()].filter(([, v]) => v.faded).map(([k]) => k).sort().join(",");
  eq(fadedAfter, fadedBefore, "after clicking and clearing, the faded edges match the start");
  eq(opacities([...after.entries()].filter(([, v]) => v.faded)), "0.18", "and they are faded by the same amount");
}
