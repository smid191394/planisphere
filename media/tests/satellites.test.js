"use strict";

// Function nodes: how they attach, how they sit around their owner, and the
// order they are drawn in.
//
// Every property here is settled by looking at a drawing and then measuring;
// the numbers in the comments are what the measurement says. They
// are recorded so a regression reads as a regression rather than as a taste.

const { loadGraphJs, suite, ok, eq, near, allVisible } = require("./harness.js");

const g = loadGraphJs();

/** Classes named `c*`, functions named `f*`, edges as given. */
function mixed(edges, extra) {
  const ids = new Set();
  for (const [a, b] of edges) {
    ids.add(a);
    ids.add(b);
  }
  for (const id of extra || []) ids.add(id);
  return {
    nodes: [...ids].map((id) => ({
      id,
      name: id,
      kind: id.startsWith("c") ? "class" : "function",
      file: "m.py",
      line: 1,
    })),
    edges: edges.map(([from, to]) => ({ from, to, kind: "uses" })),
  };
}

function layout(graph, center) {
  return g.computeClassRingPositions(graph, center, allVisible(graph));
}

// ---------------------------------------------------------------------------
suite("a satellite hangs on the class that actually uses it");

// A function used by exactly one class must orbit that class. The failure this
// guards is a fallback owner: an unplaced function handed to the primary
// centre *looks* placed while it sits far from the class it belongs to.
{
  const graph = mixed([
    ["c0", "c1"],
    ["c1", "c2"],
    ["c2", "f0"],
    ["c2", "f1"],
    ["c1", "f2"],
  ]);
  const out = layout(graph, "c0");
  eq(out.satelliteOwner.f0, "c2", "f0 should orbit c2");
  eq(out.satelliteOwner.f1, "c2", "f1 should orbit c2");
  eq(out.satelliteOwner.f2, "c1", "f2 should orbit c1");

  for (const [fn, owner] of [["f0", "c2"], ["f1", "c2"], ["f2", "c1"]]) {
    const d = Math.hypot(
      out.positions[fn].x - out.positions[owner].x,
      out.positions[fn].y - out.positions[owner].y
    );
    ok(d < g.RING_RADIUS, `expected the distance from ${fn} to ${owner} ${d.toFixed(0)} to be under one ring step`);
  }
}

// ---------------------------------------------------------------------------
suite("satellites form a single ring");

// A second ring is less readable than an overlap, so a full ring crowds
// instead of growing.
for (const count of [3, 8, 14, 22, 40]) {
  const edges = [["c0", "c1"]];
  for (let i = 0; i < count; i++) edges.push(["c1", `f${i}`]);
  const out = layout(mixed(edges), "c0");
  const owner = out.positions.c1;
  const rs = [];
  for (let i = 0; i < count; i++) {
    const p = out.positions[`f${i}`];
    if (!p) continue;
    rs.push(Math.hypot(p.x - owner.x, p.y - owner.y));
  }
  eq(rs.length, count, `expected all ${count} satellites to have positions`);
  const spread = Math.max(...rs) - Math.min(...rs);
  ok(spread < g.SAT_DIAMETER, `expected the radius spread ${spread.toFixed(1)} of ${count} satellites within one node diameter (a single ring)`);
}

// ---------------------------------------------------------------------------
suite("satellites do not spill onto other classes");

// One ring right around the class, not reaching out to another class node:
// the ring is capped so it cannot reach a neighbouring vertex.
{
  const edges = [["c0", "c1"], ["c0", "c2"], ["c0", "c3"]];
  for (let i = 0; i < 16; i++) edges.push(["c1", `f${i}`]);
  const out = layout(mixed(edges), "c0");
  const classIds = ["c0", "c1", "c2", "c3"];
  let intrusions = 0;
  for (let i = 0; i < 16; i++) {
    const p = out.positions[`f${i}`];
    for (const c of classIds) {
      if (c === "c1") continue;
      const q = out.positions[c];
      if (Math.hypot(p.x - q.x, p.y - q.y) < (g.NODE_DIAMETER + g.SAT_DIAMETER) / 2) intrusions++;
    }
  }
  eq(intrusions, 0, "c1's satellites should not cover another class node");
}

// ---------------------------------------------------------------------------
suite("draw order is monotonic in angle");

// Drawn clockwise or counter-clockwise, overlapping satellites read as a
// fan only if the stacking follows the angle. What must not happen is the
// order jumping about, which it does unless z is assigned by angle.
{
  const edges = [["c0", "c1"]];
  for (let i = 0; i < 20; i++) edges.push(["c1", `f${i}`]);
  const out = layout(mixed(edges), "c0");
  const z = g.satelliteDrawOrder(out.positions, out.satelliteOwner);

  const owner = out.positions.c1;
  const sats = [];
  for (let i = 0; i < 20; i++) {
    const p = out.positions[`f${i}`];
    sats.push({ id: `f${i}`, angle: Math.atan2(p.y - owner.y, p.x - owner.x), z: z[`f${i}`] });
  }
  sats.sort((a, b) => a.angle - b.angle);

  // One seam is expected — the fan is a circle and z is not — but only one.
  let drops = 0;
  for (let i = 1; i < sats.length; i++) if (sats[i].z < sats[i - 1].z) drops++;
  ok(drops <= 1, `sorted by angle, z should have only one seam, got ${drops}`);

  // And the class itself is never the thing that gets covered.
  ok(z.c1 > Math.max(...sats.map((s) => s.z)), "a class's z should be above all its satellites");
}

// ---------------------------------------------------------------------------
suite("fn-to-fn chains go outward and do not fold back");

// Chains of functions extend outward inside their owner's sector rather than
// curling back over the tree — the same outward logic as for classes.
{
  const edges = [["c0", "c1"], ["c1", "f0"]];
  for (let i = 1; i < 8; i++) edges.push([`f${i - 1}`, `f${i}`]);
  const out = layout(mixed(edges), "c0");
  const owner = out.positions.c1;
  const rs = [];
  for (let i = 0; i < 8; i++) {
    const p = out.positions[`f${i}`];
    ok(!!p, `expected f${i} to have a position`);
    if (p) rs.push(Math.hypot(p.x - owner.x, p.y - owner.y));
  }
  let foldbacks = 0;
  for (let i = 1; i < rs.length; i++) if (rs[i] <= rs[i - 1]) foldbacks++;
  eq(foldbacks, 0, `each link in the chain should be farther from the owner, got ${rs.map((r) => r.toFixed(0)).join(" → ")}`);
}

// ---------------------------------------------------------------------------
suite("a graph without classes can still be drawn");

// Nothing depends on the graph containing class nodes: a graph of only
// functions still gets a centre and positions for everything.
{
  const graph = mixed([
    ["f0", "f1"],
    ["f0", "f2"],
    ["f1", "f3"],
  ]);
  eq(g.graphHasTypes(graph), false, "this graph really has no types");
  const center = g.pickTopClass(graph);
  ok(!!center, "a centre should still be picked with no classes");
  const out = g.computeClassRingPositions(graph, center, allVisible(graph));
  for (const n of graph.nodes) ok(!!out.positions[n.id], `expected ${n.id} to have a position`);
}

module.exports = {};
