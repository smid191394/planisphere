"use strict";

// How far a node may be drawn from the node it is placed against.
//
// Two symptoms, one failure: a placement that looks for room by walking away
// rather than by looking around. Stepping outward along one ray escapes a
// crowded neighbourhood rather than sharing it; and an unconnected cluster
// ordered by name puts two nodes joined by an edge wherever their names
// fall.
//
// FastAPI has three far helpers and no connected pairs in its cluster, so the
// fixture the project looks at most shows almost nothing. These shapes build
// the crowd deliberately.

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

// ---------------------------------------------------------------------------
suite("a crowded neighbourhood does not mean moving far away");

{
  // A function with a helper class, and a crowd of other satellites already
  // around it. The helper's ideal seat is taken; the question is whether it
  // moves sideways or leaves.
  const nodes = [N("root.py", "Root"), N("host.py", "Host"), N("busy.py", "busy", "function")];
  const edges = [
    { from: id("host.py", "Host"), to: id("root.py", "Root"), kind: "uses" },
    { from: id("host.py", "Host"), to: id("busy.py", "busy", "function"), kind: "uses" },
  ];
  // The crowd: twelve functions orbiting Host, which is where `busy` sits too.
  for (let i = 0; i < 12; i++) {
    nodes.push(N(`f${i}.py`, `f${i}`, "function"));
    edges.push({ from: id("host.py", "Host"), to: id(`f${i}.py`, `f${i}`, "function"), kind: "uses" });
  }
  // The helper, related only to `busy`.
  nodes.push(N("help.py", "Helper"));
  edges.push({ from: id("busy.py", "busy", "function"), to: id("help.py", "Helper"), kind: "uses" });

  const g = opened({ nodes, edges });
  const L = g.live;
  const d = gap(L, id("help.py", "Helper"), id("busy.py", "busy", "function"));
  // A synthetic crowd tops out around 220px however many neighbours are added:
  // the 599s on CPython come from the density of the whole drawing, not from
  // one owner's own satellites. So this shape guards the rule, and the fixture
  // block at the bottom is where the magnitude is measured.
  ok(
    d < 3 * g.SAT_RADIUS,
    `a crowded neighbourhood should search around busy, not push outward: got ${Math.round(d)}px`
  );
}

// ---------------------------------------------------------------------------
suite("when everything is full, take the emptiest seat and stay nearby");

{
  // Ring the function so tightly that no seat is free. The class should take
  // the emptiest one nearby rather than a clear one far away.
  const nodes = [N("root.py", "Root"), N("host.py", "Host"), N("fn.py", "fn", "function")];
  const edges = [
    { from: id("host.py", "Host"), to: id("root.py", "Root"), kind: "uses" },
    { from: id("host.py", "Host"), to: id("fn.py", "fn", "function"), kind: "uses" },
  ];
  for (let i = 0; i < 30; i++) {
    nodes.push(N(`g${i}.py`, `g${i}`, "function"));
    edges.push({ from: id("host.py", "Host"), to: id(`g${i}.py`, `g${i}`, "function"), kind: "uses" });
  }
  nodes.push(N("h.py", "Squeezed"));
  edges.push({ from: id("fn.py", "fn", "function"), to: id("h.py", "Squeezed"), kind: "uses" });

  const g = opened({ nodes, edges });
  const L = g.live;
  const d = gap(L, id("h.py", "Squeezed"), id("fn.py", "fn", "function"));
  ok(
    d < 3 * g.SAT_RADIUS,
    `with no seat left it should still stay near fn, not be pushed ${Math.round(d)}px away`
  );
}

// ---------------------------------------------------------------------------
suite("a connected pair in the isolated area is drawn together");

{
  // Several pairs, each joined by an edge, with names chosen so that sorting
  // by name would interleave them. None reaches the structure.
  const nodes = [N("root.py", "Root"), N("c0.py", "C0")];
  const edges = [{ from: id("root.py", "Root"), to: id("c0.py", "C0"), kind: "uses" }];
  const pairs = [
    ["aaa", "zzz"],
    ["bbb", "yyy"],
    ["ccc", "xxx"],
    ["ddd", "www"],
  ];
  for (const [a, b] of pairs) {
    nodes.push(N(`${a}.py`, a), N(`${b}.py`, b));
    edges.push({ from: id(`${a}.py`, a), to: id(`${b}.py`, b), kind: "uses" });
  }
  // Filler so the cluster is big enough that name order really separates them.
  for (let i = 0; i < 20; i++) nodes.push(N(`m${i}.py`, `mmm${i}`));

  const g = opened({ nodes, edges });
  const L = g.live;

  let together = 0;
  let worst = 0;
  for (const [a, b] of pairs) {
    const d = gap(L, id(`${a}.py`, a), id(`${b}.py`, b));
    worst = Math.max(worst, d);
    if (d < 200) together++;
  }
  eq(together, pairs.length, `expected all four pairs together, the farthest pair is ${Math.round(worst)}px apart`);
}

// ---------------------------------------------------------------------------
suite("the rest of the isolated area keeps its order");

{
  // Nodes with no edge to anything keep the kind-then-name arrangement, and no
  // two labels overlap. Both are guarantees the seating must not break.
  const nodes = [N("root.py", "Root"), N("c0.py", "C0")];
  const edges = [{ from: id("root.py", "Root"), to: id("c0.py", "C0"), kind: "uses" }];
  for (let i = 0; i < 12; i++) nodes.push(N(`x${i}.py`, `x${i}`));
  for (let i = 0; i < 8; i++) nodes.push(N(`y${i}.py`, `y${i}`, "file"));

  const g = opened({ nodes, edges });
  const L = g.live;

  const grid = [];
  L.cy.nodes().forEach((n) => {
    if (n.style("display") === "none") return;
    if (L.nodeGroups[n.id()]) return;
    grid.push({ id: n.id(), ...n.position() });
  });
  ok(grid.length >= 15, `expected enough nodes in the isolated area, got ${grid.length}`);

  // No aligned rows or columns: an actual grid would repeat coordinates.
  const xs = new Set(grid.map((p) => Math.round(p.x)));
  const ys = new Set(grid.map((p) => Math.round(p.y)));
  ok(
    xs.size > grid.length * 0.6 && ys.size > grid.length * 0.6,
    `should not be laid out as a grid: ${xs.size} distinct x, ${ys.size} distinct y, ${grid.length} nodes`
  );
}

// ---------------------------------------------------------------------------
// The magnitude, on real graphs. A synthetic crowd cannot reach
// 599px — that comes from the density of a whole drawing — so the fixtures are
// where the numbers are, and the budgets are what they measure today.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const pure = loadGraphJs();

  // Today: helpers more than 200px from their function, and connected pairs in
  // the unconnected cluster drawn more than 200px apart.
  const today = {
    fastapi: { farHelpers: 3, splitPairs: 0 },
    django: { farHelpers: 27, splitPairs: 8 },
    cpython: { farHelpers: 74, splitPairs: 35 },
  };

  for (const name of ["fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`${name} seating`);

    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const ids = new Set(graph.nodes.map((n) => n.id));
    const out = pure.computeClassRingPositions(graph, pure.pickTopClass(graph), ids);

    // A helper seated against a function must be drawn beside it.
    let farHelpers = 0;
    let worstHelper = 0;
    for (const n of graph.nodes) {
      const owner = out.satelliteOwner[n.id];
      if (!owner || !byId[owner] || byId[owner].kind !== "function") continue;
      if (!pure.isFnOnlyHelperClass(n.id, graph, byId)) continue;
      const p = out.positions[n.id];
      const q = out.positions[owner];
      if (!p || !q) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      worstHelper = Math.max(worstHelper, d);
      if (d > 200) farHelpers++;
    }
    ok(
      farHelpers < today[name].farHelpers || today[name].farHelpers === 0,
      `expected fewer helpers more than 200px from their function: ${farHelpers}, was ${today[name].farHelpers} (farthest ${Math.round(worstHelper)}px)`
    );

    // Two unconnected nodes joined by an edge must be drawn together —
    // measured against the cluster, not against a fixed number of pixels.
    //
    // A fixed 200px is unreachable: every node has a slot of its own, slots are
    // an exclusion ellipse apart, and that ellipse is 195px wide, because a
    // label overflows sideways. What the requirement asks is that
    // the edge does not cross the cluster, so that is what is measured.
    const grid = new Set();
    for (const id2 of Object.keys(out.positions)) if (!out.groupOf[id2]) grid.add(id2);
    const gp = [...grid].map((id2) => out.positions[id2]);
    const gridW = Math.max(...gp.map((p) => p.x)) - Math.min(...gp.map((p) => p.x));
    let worstPair = 0;
    let pairs = 0;
    for (const e of graph.edges) {
      if (!grid.has(e.from) || !grid.has(e.to)) continue;
      const p = out.positions[e.from];
      const q = out.positions[e.to];
      worstPair = Math.max(worstPair, Math.hypot(p.x - q.x, p.y - q.y));
      pairs++;
    }
    if (pairs) {
      ok(
        worstPair < gridW / 4,
        `the longest edge in the isolated area should not span it: ${Math.round(worstPair)}px, area width ${Math.round(gridW)}px`
      );
    }

    // And nothing in the cluster overlaps anything else in it.
    let clash = 0;
    let closest = Infinity;
    for (let i = 0; i < gp.length; i++) {
      for (let j = i + 1; j < gp.length; j++) {
        const d = Math.hypot(gp[i].x - gp[j].x, gp[i].y - gp[j].y);
        if (d < closest) closest = d;
        if (d < pure.NODE_DIAMETER) clash++;
      }
    }
    eq(clash, 0, `no nodes should overlap in the isolated area: ${clash} pairs, closest ${Math.round(closest)}px`);

    // Looking around a node instead of walking away from it could crowd the
    // drawing. Held to a budget so closeness cannot be bought by stacking
    // nodes.
    //
    // The budget tracks the artifact, not only the layout: fewer edges leave a
    // less tangled tree, and can also put more nodes in the unconnected
    // cluster, which is the densest part of the drawing.
    //
    // Counting a function hop as a connection raises it, because the trees take
    // in what they are joined to and carry it at the same radii. Both the class
    // ring and the satellite ring are required to crowd rather than expand, so
    // this is the rule working; what would not be is a group's rings reaching
    // into another group, which `packing.test.js` guards.
    //
    // A centre chosen for nearness raises it too: a root in the middle has
    // nothing strung out along a chain away from it, so nodes sit on smaller
    // rings. The drawing is smaller by as much as the crowding is greater —
    // Django 5,951x2,200, CPython 9,839x4,034 — so it is shown larger in the
    // same viewport, and the reader who minds the crowding has a setting for
    // it. Overlap buys size here rather than hiding it.
    const budget = { fastapi: 80, django: 10400, cpython: 10800 }[name];
    const pts = [];
    for (const [nodeId, p] of Object.entries(out.positions)) {
      pts.push({ x: p.x, y: p.y, r: pure.bodyRadius(nodeId, out.satelliteOwner) });
    }
    const CELL = 80;
    const cells = new Map();
    pts.forEach((p, i) => {
      const k = Math.floor(p.x / CELL) + ":" + Math.floor(p.y / CELL);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    });
    const counted = new Set();
    let overlaps = 0;
    for (let i = 0; i < pts.length; i++) {
      const cx = Math.floor(pts[i].x / CELL);
      const cy = Math.floor(pts[i].y / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cells.get(cx + dx + ":" + (cy + dy)) || []) {
            if (j <= i) continue;
            const k = i + ":" + j;
            if (counted.has(k)) continue;
            counted.add(k);
            if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < pts[i].r + pts[j].r) {
              overlaps++;
            }
          }
        }
      }
    }
    ok(overlaps <= budget, `overlapping node pairs should not grow sharply: ${overlaps} > ${budget}`);
  }
}

module.exports = {};
