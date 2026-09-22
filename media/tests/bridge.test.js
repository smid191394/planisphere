"use strict";

// Which tree a class belongs to, when a function is what joins it.
//
// Left to class-to-class edges alone, such a class sits as its own tree, and
// turning functions on draws a line across the whole drawing to reach it. On
// the fixtures that is 70 of FastAPI's 108 classes, 32 of Django's and 681 of
// CPython's — and no other shape in the suite builds it.
//
// The distinction every case here turns on: whether anything joins a class to
// the tree is one question, and how deep the classes themselves lead is
// another. Answering the first through a function must not change the answer
// to the second.

const { loadGraphJs, suite, ok, eq, near } = require("./harness.js");

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

/**
 * Where the layout put a node.
 *
 * Asked of the layout rather than of the drawing: these are questions about
 * arrangement, and a hidden function is arranged without being built. For a
 * node that is drawn the two agree — the drawing's positions come from here.
 */
function pos(L, nodeId) {
  const laid = L.lastLayout && L.lastLayout.positions[nodeId];
  if (laid) return laid;
  const n = L.cy.getElementById(nodeId);
  return n.empty() ? null : n.position();
}

function gap(L, a, b) {
  const p = pos(L, a);
  const q = pos(L, b);
  return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
}

/**
 * A tree with a centre, plus one class joined to it only through a function.
 *
 * `Far` has no class-to-class path to `Root` at all: its only neighbour is
 * `bridge`, and `bridge`'s only other neighbour is a class in the tree.
 *
 * @param {boolean} reversed point both bridge edges the other way
 */
function bridged(reversed) {
  const nodes = [N("root.py", "Root"), N("bridge.py", "bridge", "function"), N("far.py", "Far")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(N(`c${i}.py`, `C${i}`));
    edges.push({ from: id("root.py", "Root"), to: id(`c${i}.py`, `C${i}`), kind: "uses" });
  }
  const fn = id("bridge.py", "bridge", "function");
  const near2 = id("c2.py", "C2");
  const far = id("far.py", "Far");
  if (reversed) {
    edges.push({ from: fn, to: near2, kind: "uses" });
    edges.push({ from: fn, to: far, kind: "uses" });
  } else {
    edges.push({ from: near2, to: fn, kind: "uses" });
    edges.push({ from: far, to: fn, kind: "uses" });
  }
  // `Far` has a class of its own so it is not an fn-only helper — those are
  // seated beside their function by a different rule and are not this.
  nodes.push(N("far2.py", "FarChild"));
  edges.push({ from: far, to: id("far2.py", "FarChild"), kind: "uses" });
  return { nodes, edges };
}

/**
 * Is `Far` in a tree of its own?
 *
 * Asked of the grouping rather than of the distance. A distance threshold is
 * no proxy for it, because the gap between two groups can change: `Far` is
 * 279px from the centre and in the same tree.
 */
function separated(g, L) {
  const groups = L.nodeGroups || {};
  return groups[id("far.py", "Far")] !== groups[id("root.py", "Root")];
}

// ---------------------------------------------------------------------------
suite("a class joined through a function belongs to the same tree");

{
  const g = opened(bridged(false));
  const L = g.live;
  ok(
    !separated(g, L),
    `Far should be in Root's tree, got ${Math.round(gap(L, id("far.py", "Far"), id("root.py", "Root")))}px from the primary centre`
  );
  // And its own child comes with it — a bridged class brings its subtree.
  ok(
    (L.nodeGroups || {})[id("far2.py", "FarChild")] ===
      (L.nodeGroups || {})[id("root.py", "Root")],
    "its own subtree should come along"
  );
}

// ---------------------------------------------------------------------------
suite("the same holds with the bridge reversed");

{
  // The bridge's edges may point either way, and a collector that reads only
  // one direction misses every bridge that points the other.
  const g = opened(bridged(true));
  const L = g.live;
  ok(
    !separated(g, L),
    `with the edge reversed Far should still be in the tree, got ${Math.round(gap(L, id("far.py", "Far"), id("root.py", "Root")))}px`
  );
}

// ---------------------------------------------------------------------------
suite("positions do not change when functions are hidden");

{
  // This is the whole requirement in one assertion: with functions hidden
  // there is no visible reason for where the class sits, so it must already
  // sit somewhere that makes sense.
  const g = opened(bridged(false));
  const L = g.live;
  const before = { ...pos(L, id("far.py", "Far")) };
  g.el("toggle-fns").dispatch("click"); // show
  const shown = { ...pos(L, id("far.py", "Far")) };
  g.el("toggle-fns").dispatch("click"); // hide again
  const after = { ...pos(L, id("far.py", "Far")) };
  near(
    Math.hypot(shown.x - before.x, shown.y - before.y),
    0,
    0.5,
    "showing functions should not move it"
  );
  near(
    Math.hypot(after.x - before.x, after.y - before.y),
    0,
    0.5,
    "hiding them again should not move it either"
  );
}

// ---------------------------------------------------------------------------
suite("placed beside the class at the other end of the function");

{
  // Not merely somewhere in the tree. `pickClassParent`'s last fallback walks
  // the BFS parent chain past the function to the class on its far side, and
  // that is the class the reader expects to find it beside.
  const g = opened(bridged(false));
  const L = g.live;
  const toC2 = gap(L, id("far.py", "Far"), id("c2.py", "C2"));
  let nearestOther = Infinity;
  for (let i = 0; i < 5; i++) {
    if (i === 2) continue;
    nearestOther = Math.min(nearestOther, gap(L, id("far.py", "Far"), id(`c${i}.py`, `C${i}`)));
  }
  ok(
    toC2 < nearestOther,
    `expected it closer to C2 (the other end of the bridge) than to any other C: C2 ${Math.round(toC2)}px, nearest other ${Math.round(nearestOther)}px`
  );
  // Nearer than the others is not enough on its own — a class in a tree of its
  // own can satisfy that by where the packer happened to put its tree. Being
  // within a ring step of C2 is the claim.
  ok(
    toC2 <= g.RING_RADIUS,
    `expected it within one ring of C2, got ${Math.round(toC2)}px`
  );
}

// ---------------------------------------------------------------------------
suite("depth still counts only class-to-class steps");

{
  // The requirement a bridge is most likely to break. `Deep` is three
  // classes from the centre and `Shallow` is one; both call `helper`. Walking
  // through `helper` would make `Deep` look two hops closer than it is.
  const nodes = [N("root.py", "Root"), N("help.py", "helper", "function")];
  const edges = [];
  let prev = id("root.py", "Root");
  for (let i = 1; i <= 3; i++) {
    nodes.push(N(`d${i}.py`, `D${i}`));
    edges.push({ from: prev, to: id(`d${i}.py`, `D${i}`), kind: "uses" });
    prev = id(`d${i}.py`, `D${i}`);
  }
  nodes.push(N("sh.py", "Shallow"));
  edges.push({ from: id("root.py", "Root"), to: id("sh.py", "Shallow"), kind: "uses" });
  const fn = id("help.py", "helper", "function");
  edges.push({ from: id("d3.py", "D3"), to: fn, kind: "uses" });
  edges.push({ from: id("sh.py", "Shallow"), to: fn, kind: "uses" });

  const g = opened({ nodes, edges });
  const L = g.live;
  const rDeep = gap(L, id("d3.py", "D3"), id("root.py", "Root"));
  const rShallow = gap(L, id("sh.py", "Shallow"), id("root.py", "Root"));
  ok(
    rDeep > rShallow,
    `a shared helper should not pull D3 as shallow as Shallow: D3 ${Math.round(rDeep)}px, Shallow ${Math.round(rShallow)}px`
  );
  // Each class-to-class step is its own ring, and the shared function is not
  // a step: three class hops means the third ring.
  const r1 = gap(L, id("d1.py", "D1"), id("root.py", "Root"));
  const r2 = gap(L, id("d2.py", "D2"), id("root.py", "Root"));
  ok(r1 < r2 && r2 < rDeep, `each hop should move one ring outward: ${Math.round(r1)} < ${Math.round(r2)} < ${Math.round(rDeep)}`);
}

// ---------------------------------------------------------------------------
suite("a class with truly no path is still its own tree");

{
  // TinyDB's `Query` is exactly this shape: nothing
  // reaches it from `TinyDB`, through classes or through functions. Joining
  // everything would be as wrong as joining nothing.
  const nodes = [N("root.py", "Root"), N("other.py", "Other"), N("otherc.py", "OtherChild")];
  const edges = [{ from: id("other.py", "Other"), to: id("otherc.py", "OtherChild"), kind: "uses" }];
  for (let i = 0; i < 5; i++) {
    nodes.push(N(`c${i}.py`, `C${i}`));
    edges.push({ from: id("root.py", "Root"), to: id(`c${i}.py`, `C${i}`), kind: "uses" });
  }
  const g = opened({ nodes, edges });
  const L = g.live;
  ok(
    gap(L, id("other.py", "Other"), id("root.py", "Root")) > g.COMPONENT_GAP,
    "a class with no path to the centre should form its own tree"
  );
}

// ---------------------------------------------------------------------------
// The magnitude, on real graphs. A synthetic shape can say whether the rule
// holds; only the fixtures say how much of the drawing it decides.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const pure = loadGraphJs();

  // Classes with no class-to-class path to the centre but a path through a
  // function, excluding the fn-only helpers seated beside their function.
  const today = {
    fastapi: { exiled: 70, groups: 2, longest: 2888 },
    django: { exiled: 32, groups: 5, longest: 5207 },
    cpython: { exiled: 681, groups: 20, longest: 8088 },
  };

  for (const name of ["fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`${name} function bridges`);

    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const ids = new Set(graph.nodes.map((n) => n.id));
    const centre = pure.pickTopClass(graph);
    const fullAdj = pure.undirectedAdj(graph);

    const linked = new Set();
    for (const e of graph.edges) {
      linked.add(e.from);
      linked.add(e.to);
    }
    const linkedVisible = new Set([...ids].filter((i) => linked.has(i) || i === centre));
    const classIds = new Set(
      [...linkedVisible].filter((i) => pure.isTreeVertex(graph, byId[i]))
    );
    const classReach = pure.bfsParents(pure.classOnlyAdj(classIds, fullAdj), centre).dist;
    const fullReach = pure.bfsParents(fullAdj, centre).dist;

    const out = pure.computeClassRingPositions(graph, centre, ids);

    // Every class a function joins to the centre is in the centre's group.
    let exiled = 0;
    for (const cid of classIds) {
      if (classReach[cid] !== undefined) continue;
      if (fullReach[cid] === undefined) continue;
      if (pure.isFnOnlyHelperClass(cid, graph, byId)) continue;
      if (out.groupOf[cid] !== centre) exiled++;
    }
    eq(
      exiled,
      0,
      `every class joined to the centre through a function should be in the centre's group: ${exiled} are not, was ${today[name].exiled}`
    );

    // Fewer trees, and the edges between them stop crossing the canvas.
    //
    // Counted on the trees rooted on a class. A component with no class to
    // root on is a tree too, and drawing those instead of leaving them in the
    // cluster of unconnected nodes raises the total on purpose — CPython draws
    // 43 of them and Django 9. What this guards is a class that would have a
    // tree of its own because a function is all that joins it to the drawing,
    // and that is what a class-rooted count says.
    const roots = new Set(Object.values(out.groupOf));
    let classRooted = 0;
    for (const r of roots) if (pure.isTreeVertex(graph, byId[r])) classRooted++;
    ok(
      classRooted <= today[name].groups,
      `class-rooted trees should not increase: ${classRooted}, was ${today[name].groups}`
    );
    let longest = 0;
    for (const e of graph.edges) {
      const p = out.positions[e.from];
      const q = out.positions[e.to];
      if (p && q) longest = Math.max(longest, Math.hypot(p.x - q.x, p.y - q.y));
    }
    // Rounded on both sides: the recorded figures are rounded, and comparing a
    // raw 2887.6 against a recorded 2888 passes without anything improving.
    ok(
      Math.round(longest) < today[name].longest,
      `the longest edge should get shorter: ${Math.round(longest)}px, was ${today[name].longest}px`
    );
  }
}

module.exports = {};
