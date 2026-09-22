"use strict";

// A class with nowhere to go when a function is all that holds it.
//
// The layout roots a component on a class, and a component whose only class
// belongs beside a function — `CurvesTurtle` and the `main` that uses it —
// would have that one candidate filtered out and then be judged to have no
// root at all. Dropped, it would never get a position, and everything
// without a position falls through to the cluster of nodes that have no
// connection to anything.
//
// A component that is functions all the way down is not this. It stays in the
// cluster: it is a module's internals, not a piece of the structure the
// drawing is about. Measured, CPython holds 11 of the first kind (42 nodes)
// and 32 of the second (101), Django 1 and 8. FastAPI has neither, which is
// why the fixture the project looks at most says nothing about any of it.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const F = (id, name) => ({ id, name, kind: "function", file: "/p/" + id + ".py", line: 1 });
const C = (id, name) => ({ id, name, kind: "class", file: "/p/" + id + ".py", line: 1 });
const E = (from, to) => ({ from, to, kind: "uses" });

/** A class tree with a centre, so there is a real drawing to be exiled from. */
function withTree(extraNodes, extraEdges) {
  const nodes = [C("Root", "Root")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(C(`K${i}`, `K${i}`));
    edges.push(E("Root", `K${i}`));
  }
  return { nodes: nodes.concat(extraNodes), edges: edges.concat(extraEdges) };
}

function laidOut(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return pure.computeClassRingPositions(graph, pure.pickTopClass(graph), ids);
}

/** In the cluster: placed, but belonging to no group. */
const inCluster = (out, id) => !!out.positions[id] && !out.groupOf[id];

// ---------------------------------------------------------------------------
suite("a component of only functions stays as it is, in the isolated area");

{
  // Five functions calling each other and reaching nothing else — the `dyld`
  // shape. A module's internals; there is no class in it for the drawing to be
  // about, so nothing here is rescued.
  //
  // Drawing them as trees would add 39 blocks on CPython, scatter the
  // arrangement and take the canvas from 44.5M to 68.1M, a 53% rise for 101
  // nodes — and the tiers would come out interleaved anyway, because the
  // arrangement fills the emptiest room rather than laying blocks in a row.
  const extra = [];
  const edges = [];
  for (let i = 0; i < 5; i++) extra.push(F(`d${i}`, `dyld_${i}`));
  for (let i = 1; i < 5; i++) edges.push(E("d0", `d${i}`));

  const graph = withTree(extra, edges);
  const out = laidOut(graph);

  let stranded = 0;
  for (let i = 0; i < 5; i++) if (inCluster(out, `d${i}`)) stranded++;
  eq(stranded, 5, "all five should stay in the isolated area");
  for (let i = 0; i < 5; i++) {
    ok(!out.componentRoots.has(`d${i}`), `d${i} should not be taken as the root of a tree`);
  }
}

// ---------------------------------------------------------------------------
suite("a component rooted at a function with classes in it is a tree");

{
  // The same shape with one class in it. That class is what the drawing is
  // about and it has nowhere else to be.
  const extra = [F("f0", "helper0"), F("f1", "helper1"), C("Held", "Held")];
  const edges = [E("f0", "f1"), E("f0", "Held")];

  const graph = withTree(extra, edges);
  const out = laidOut(graph);

  for (const id of ["f0", "f1", "Held"]) {
    ok(!inCluster(out, id), `${id} should not land in the isolated area`);
  }
  const root = out.groupOf["Held"];
  ok(!!root, "should belong to a group");
  eq(out.groupOf["f0"], root, "all three in the same group");
  eq(out.groupOf["f1"], root, "all three in the same group");
  ok(out.componentRoots.has(root), "should be recorded as a component root");
  ok(out.groupOf["Root"] !== root, "a separate group from the main tree");
}

// ---------------------------------------------------------------------------
suite("a node the tree does not place cannot be a parent");

{
  // A helper class orbits the function that builds it, so the tree placement
  // skips it. Parented there, a node is never reached by the walk that places
  // the tree: it falls through to the satellite pass and arrives as a
  // satellite of a satellite. In `shutil`, `_unpack_zipfile` and
  // `_unpack_tarfile` hang off `ReadError`, which orbits `unpack_archive`.
  const extra = [
    F("fn", "unpack_archive"),
    C("Err", "ReadError"),
    F("z", "_unpack_zipfile"),
    F("t", "_unpack_tarfile"),
  ];
  const edges = [E("fn", "Err"), E("z", "Err"), E("t", "Err")];
  const out = laidOut(withTree(extra, edges));

  // The helper still orbits its function — the exclusion this works around
  // must not be undone by it.
  eq(out.satelliteOwner["Err"], "fn", "the helper class still sits beside the function that creates it");

  for (const id of ["z", "t"]) {
    ok(
      !out.satelliteOwner[id],
      `${id} should be a tree vertex, not a satellite (got ${out.satelliteOwner[id] || "tree vertex"})`
    );
  }
  const d = Math.hypot(
    out.positions["z"].x - out.positions["t"].x,
    out.positions["z"].y - out.positions["t"].y
  );
  ok(
    d >= pure.NODE_DIAMETER * 2,
    `the two should be a ring apart, not packed on the satellite ring: got ${Math.round(d)}px`
  );
}

// ---------------------------------------------------------------------------
suite("a clump in the isolated area does not share one position");

{
  // A clump given one seat between them, and fanned around it at a fixed
  // radius whatever it held, would overlap as soon as it held more than a
  // few. Each member needs a seat of its own.
  const nodes = [C("Root", "Root")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(C(`K${i}`, `K${i}`));
    edges.push(E("Root", `K${i}`));
  }
  // Eight functions joined to each other and to nothing else: a clump in the
  // cluster, and too big for one seat.
  for (let i = 0; i < 8; i++) nodes.push(F(`c${i}`, `clump${i}`));
  for (let i = 1; i < 8; i++) edges.push(E("c0", `c${i}`));
  // And single nodes, which must not take the clump's seats first.
  for (let i = 0; i < 20; i++) nodes.push(F(`s${i}`, `solo${i}`));

  const out = pure.computeClassRingPositions(
    { nodes, edges },
    pure.pickTopClass({ nodes, edges }),
    new Set(nodes.map((n) => n.id))
  );

  const clump = [];
  for (let i = 0; i < 8; i++) clump.push(out.positions[`c${i}`]);
  ok(clump.every(Boolean), "the whole clump should be placed");

  let clash = 0;
  let closest = Infinity;
  for (let i = 0; i < clump.length; i++) {
    for (let j = i + 1; j < clump.length; j++) {
      const d = Math.hypot(clump[i].x - clump[j].x, clump[i].y - clump[j].y);
      if (d < closest) closest = d;
      if (d < pure.NODE_DIAMETER) clash++;
    }
  }
  eq(clash, 0, `no nodes in the clump should overlap: ${clash} pairs, closest ${Math.round(closest)}px`);

  // And still together: the clump's own spread is a fraction of the cluster's.
  const all = [];
  for (const [id, p] of Object.entries(out.positions)) {
    if (!out.groupOf[id]) all.push(p);
  }
  const clusterW =
    Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x));
  const clumpW =
    Math.max(...clump.map((p) => p.x)) - Math.min(...clump.map((p) => p.x));
  ok(
    clumpW < clusterW / 2,
    `the clump should still sit together: clump width ${Math.round(clumpW)}px, isolated area width ${Math.round(clusterW)}px`
  );
}

// ---------------------------------------------------------------------------
suite("a tree rooted at a function draws no rings");

{
  // A ring marks a level of a class tree. This tree has none, and its root is
  // hidden in the default view, so a ring there would be a circle around
  // nothing. The test is the root's kind, not what is shown, so the ring set
  // does not change when functions are toggled.
  const extra = [F("f0", "helper0"), F("f1", "helper1"), C("Held", "Held")];
  const edges = [E("f0", "f1"), E("f0", "Held")];
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: withTree(extra, edges) });
  const L = g.live;

  const posOf = (id) => {
    const n = L.cy.getElementById(id);
    return n.empty() ? null : n.position();
  };
  const ringsAt = (p) =>
    (L.ringGroups || []).filter(
      (r) => p && Math.abs(r.cx - p.x) < 1e-6 && Math.abs(r.cy - p.y) < 1e-6
    ).length;

  const fnRoot = L.nodeGroups["Held"];
  ok(fnRoot === "f0" || fnRoot === "f1", `this tree should be rooted at a function, got ${fnRoot}`);
  const before = (L.ringGroups || []).length;
  eq(ringsAt(posOf(fnRoot)), 0, "no ring should be drawn on its centre");
  ok(ringsAt(posOf("Root")) > 0, "the main tree still has its rings");

  // And the set does not move when functions are shown.
  g.el("toggle-fns").dispatch("click");
  eq((L.ringGroups || []).length, before, "showing functions leaves the ring count unchanged");
}

// ---------------------------------------------------------------------------
suite("trees rooted at a function come after every class tree");

{
  // The function-rooted tree is deliberately the bigger one: ordering by size
  // alone would put it first.
  const extra = [];
  const edges = [];
  for (let i = 0; i < 4; i++) extra.push(C(`S${i}`, `S${i}`));
  for (let i = 1; i < 4; i++) edges.push(E("S0", `S${i}`));
  extra.push(F("bigfn", "bigfn"), C("Held", "Held"));
  edges.push(E("bigfn", "Held"));
  for (let i = 0; i < 8; i++) {
    extra.push(F(`b${i}`, `b${i}`));
    edges.push(E("bigfn", `b${i}`));
  }

  const out = laidOut(withTree(extra, edges));
  const centre = (id) => out.positions[out.groupOf[id]];
  const cls = centre("S0");
  const fn = centre("Held");
  ok(!!cls && !!fn, "both trees should be placed");
  ok(out.groupOf["S0"] !== out.groupOf["Held"], "and they should be two different trees");
  // Reading order: earlier row first, then left to right.
  const earlier = cls.y < fn.y - 1 || (Math.abs(cls.y - fn.y) <= 1 && cls.x < fn.x);
  ok(
    earlier,
    `the class tree should come before the function tree: class (${Math.round(cls.x)}, ${Math.round(cls.y)}), fn (${Math.round(fn.x)}, ${Math.round(fn.y)})`
  );
}

// ---------------------------------------------------------------------------
suite("a tree rooted at a function is not coloured as the entry point");

{
  // The red says "the graph starts here" and there is one of those. A tree
  // rooted on a function exists because its component had no class to root on,
  // so painting it the entry colour puts a red dot on a module's internals.
  const extra = [F("f0", "helper0"), F("f1", "helper1"), C("Held", "Held")];
  const edges = [E("f0", "f1"), E("f0", "Held")];
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: withTree(extra, edges) });
  const L = g.live;
  g.el("toggle-fns").dispatch("click"); // show functions, so the root is drawn

  const root = L.nodeGroups["Held"];
  ok(root === "f0" || root === "f1", `this tree should be rooted at a function, got ${root}`);
  const node = L.cy.getElementById(root);
  ok(node.hasClass("center"), "it is still the centre of its group");
  ok(!node.hasClass("primary"), "but not the entry point of the whole graph");
  eq(
    node.style("background-color"),
    L.cy.getElementById(root === "f0" ? "f1" : "f0").style("background-color"),
    "its colour should match an ordinary function, not the entry-point red"
  );

  // And the graph's own centre keeps the entry colour.
  const prim = L.cy.getElementById("Root");
  ok(prim.hasClass("primary"), "the main centre is the entry point");
  ok(
    prim.style("background-color") !== node.style("background-color"),
    "the entry-point colour differs from it"
  );
}

// ---------------------------------------------------------------------------
suite("a node with no edges at all stays in the isolated area");

{
  // What the cluster is for. Emptying it of this would be the opposite error.
  const graph = withTree([F("lonely", "lonely"), C("Alone", "Alone")], []);
  const out = laidOut(graph);
  ok(inCluster(out, "lonely"), "a function with no edges should be in the isolated area");
  ok(inCluster(out, "Alone"), "a class with no edges should be in the isolated area too");
}

// ---------------------------------------------------------------------------
suite("a function in the main tree is still a satellite");

{
  // The predicate this rule narrows is asked from many places. Widening it
  // everywhere would put every function in the class ring.
  const graph = withTree([F("helper", "helper")], [E("K2", "helper")]);
  const out = laidOut(graph);
  eq(out.groupOf["helper"], "Root", "it is in the main tree");
  ok(!!out.satelliteOwner["helper"], "and it is a satellite of some node, not a tree vertex");
  ok(!out.componentRoots.has("helper"), "should not be taken as a component root");
}

// ---------------------------------------------------------------------------
// The magnitude, on real graphs.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const h = loadGraphJs();

  // A component that has edges and holds a class must not land entirely in the
  // cluster. A component with no class in it belongs there and is not counted.

  for (const name of ["fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`islands in ${name}`);

    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const W = h.live.withGroups(raw);
    const graph = W.graph;
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const ids = new Set(graph.nodes.filter((n) => !W.groupOf[n.id]).map((n) => n.id));
    const out = h.computeClassRingPositions(graph, h.pickTopClass(graph), ids);
    const adj = h.undirectedAdj(graph);

    const seen = new Set();
    let stranded = 0;
    let strandedNodes = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const stack = [id];
      seen.add(id);
      const comp = [];
      while (stack.length) {
        const x = stack.pop();
        comp.push(x);
        for (const nb of adj[x] || []) {
          if (ids.has(nb) && !seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      const holdsClass = comp.some((x) => h.isTreeVertex(graph, byId[x]));
      if (comp.length > 1 && holdsClass && comp.every((x) => inCluster(out, x))) {
        stranded++;
        strandedNodes += comp.length;
      }
    }
    eq(
      stranded,
      0,
      `a component with edges should not land whole in the isolated area: ${stranded} components / ${strandedNodes} nodes`
    );
  }
}

module.exports = {};
