"use strict";

// The tree layout, asserted on shapes rather than on projects.
//
// A shape is a graph whose structure is chosen to reach a particular part of
// the code. A project is a graph that happens to exist. Both are useful, but
// only the first can be aimed: ring-radius compounding, for one, does not
// show on a fixture too shallow to reach it.

const {
  loadGraphJs,
  suite,
  ok,
  eq,
  near,
  classTree,
  balancedTree,
  allVisible,
} = require("./harness.js");

const g = loadGraphJs();

/** Radius of each node from its group's centre, keyed by id. */
function radii(graph, center) {
  const out = g.computeClassRingPositions(graph, center, allVisible(graph));
  const origin = out.positions[center];
  const r = {};
  for (const [id, p] of Object.entries(out.positions)) {
    r[id] = Math.hypot(p.x - origin.x, p.y - origin.y);
  }
  return { r, out };
}

/** Class-to-class depth of every node, from the centre. */
function depths(graph, center) {
  const byId = {};
  for (const n of graph.nodes) byId[n.id] = n;
  const adj = {};
  for (const e of graph.edges) {
    (adj[e.from] = adj[e.from] || []).push(e.to);
    (adj[e.to] = adj[e.to] || []).push(e.from);
  }
  const d = { [center]: 0 };
  let frontier = [center];
  while (frontier.length) {
    const next = [];
    for (const id of frontier)
      for (const nb of adj[id] || [])
        if (d[nb] === undefined) {
          d[nb] = d[id] + 1;
          next.push(nb);
        }
    frontier = next;
  }
  return d;
}

/** The rows an overflowing sector is allowed, and how far the outermost sits. */
const MAX_ROWS = 1 + Math.max(0, Math.floor((g.RING_RADIUS - g.MIN_SEPARATION) / g.BAND_STEP));
const BAND_REACH = (MAX_ROWS - 1) * g.BAND_STEP;

// ---------------------------------------------------------------------------
suite("one depth has one ring, and rows stacked outward stay within it");

// The rule itself. Every other assertion here is downstream of this one.
for (const [branch, depth] of [
  [3, 6],
  [2, 8],
  [4, 4],
  [5, 3],
]) {
  const graph = balancedTree(branch, depth);
  const { r } = radii(graph, "r");
  const d = depths(graph, "r");
  const byDepth = new Map();
  for (const [id, depthOf] of Object.entries(d)) {
    if (r[id] === undefined) continue;
    if (!byDepth.has(depthOf)) byDepth.set(depthOf, []);
    byDepth.get(depthOf).push(r[id]);
  }
  // Depth decides one ring. A sector too narrow for its children seats
  // the childless ones in rows outside it, so a depth may hold more than one
  // radius — but the rows are a fixed step apart and stop short of the next
  // ring, which is what keeps the ring readable as the level.
  let worst = 0;
  let offStep = 0;
  for (const list of byDepth.values()) {
    const ring = Math.min(...list);
    for (const r of list) {
      const over = r - ring;
      worst = Math.max(worst, over);
      const k = over / g.BAND_STEP;
      if (Math.abs(k - Math.round(k)) > 1e-6) offStep++;
    }
  }
  eq(offStep, 0, `branch ${branch} depth ${depth}: radii at one depth should fall on the ${g.BAND_STEP} grid`);
  ok(
    worst <= BAND_REACH + 1e-6,
    `branch ${branch} depth ${depth}: expected outward rows to reach at most ${BAND_REACH}px, got ${worst.toFixed(1)}`
  );
}

// A balanced tree cannot show this property failing: every sibling carries the
// same leaf count, so radii inflated by leaf count would all inflate by the
// same amount and still come out equal. It takes lopsided siblings — one
// branch heavy, one light — for the two radii at one depth to separate.
{
  const children = {
    r: ["heavy", "light"],
    heavy: ["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7"],
    light: ["l0"],
  };
  for (const h of children.heavy) children[h] = [`${h}a`, `${h}b`, `${h}c`];
  children.l0 = ["l0a"];
  const graph = classTree(children);
  const { r } = radii(graph, "r");
  const d = depths(graph, "r");
  for (const level of [1, 2, 3]) {
    const at = Object.keys(r).filter((id) => d[id] === level && r[id] !== undefined);
    const spread = Math.max(...at.map((id) => r[id])) - Math.min(...at.map((id) => r[id]));
    near(spread, 0, 1e-6, `heavy and light siblings: radius spread of the ${at.length} nodes at depth ${level}`);
  }
}

// ---------------------------------------------------------------------------
suite("depth costs one step, not a multiple");

// The property stated as a bound: a drawing cannot be wider than its depth times
// the step. That is true of any graph, so it does not need a project to hold
// it up — and it is exactly what geometric growth breaks.
for (const [branch, depth] of [
  [3, 4],
  [3, 5],
  [3, 6],
  [3, 7],
  [2, 9],
]) {
  const graph = balancedTree(branch, depth);
  const { r } = radii(graph, "r");
  const max = Math.max(...Object.values(r));
  // The deepest level may grow rows outward, but never as far as the ring it
  // does not have — so the bound stays linear in the depth.
  const bound = depth * g.RING_RADIUS + BAND_REACH;
  ok(max <= bound + 1e-6, `branch ${branch} depth ${depth}: expected max radius ${max.toFixed(1)} ≤ ${bound}`);
  ok(
    max < (depth + 1) * g.RING_RADIUS,
    `branch ${branch} depth ${depth}: should not reach the next ring ${(depth + 1) * g.RING_RADIUS} either`
  );
}

// ---------------------------------------------------------------------------
suite("extent grows linearly, not faster");

// Depth n and depth n+1 differ by one step. If the growth compounded, the
// differences would themselves grow.
{
  const extents = [];
  for (let depth = 2; depth <= 7; depth++) {
    const { r } = radii(balancedTree(3, depth), "r");
    extents.push(Math.max(...Object.values(r)));
  }
  const steps = [];
  for (let i = 1; i < extents.length; i++) steps.push(extents[i] - extents[i - 1]);
  // Not identical — the deepest level's rows move the outer edge by up to the
  // band's reach — but bounded, which is what says the growth is not
  // compounding. Geometric growth shows itself as increments that themselves
  // grow.
  const shown = steps.map((s) => s.toFixed(1)).join(", ");
  for (const st of steps) {
    ok(
      st <= g.RING_RADIUS + BAND_REACH + 1e-6 && st >= g.RING_RADIUS - BAND_REACH - 1e-6,
      `each added level should still add about one step, got ${shown}`
    );
  }
  let growing = true;
  for (let i = 1; i < steps.length; i++) if (steps[i] <= steps[i - 1] + 1e-6) growing = false;
  ok(!growing, `the increments should not keep growing, got ${shown}`);
}

// ---------------------------------------------------------------------------
suite("crowding happens only within one ring");

// The trade the layout makes: a ring that cannot hold its contents lets them
// overlap. What must not happen is nodes of *different* depths landing on top
// of each other — that is when rings stop reading as rings.
{
  const graph = balancedTree(4, 5);
  const { r, out } = radii(graph, "r");
  const d = depths(graph, "r");
  let crossDepth = 0;
  const ids = Object.keys(out.positions).filter((id) => d[id] !== undefined);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (d[ids[i]] === d[ids[j]]) continue;
      const a = out.positions[ids[i]];
      const b = out.positions[ids[j]];
      if (Math.hypot(a.x - b.x, a.y - b.y) < g.NODE_DIAMETER) crossDepth++;
    }
  }
  eq(crossDepth, 0, "nodes at different depths should not overlap");
  ok(Math.max(...Object.values(r)) > 0, "the layout was actually produced");
}

// ---------------------------------------------------------------------------
suite("single-child chains are still compressed");

// Unrelated to compounding and deliberate: a chain of one-child
// links decays its step, which is why a 50-deep chain fits on a page.
{
  const children = {};
  let prev = "r";
  for (let i = 0; i < 50; i++) {
    const id = `n${i}`;
    children[prev] = [id];
    prev = id;
  }
  const graph = classTree(children);
  const { r } = radii(graph, "r");
  const max = Math.max(...Object.values(r));
  ok(max < 50 * g.RING_RADIUS, `expected a 50-link chain's extent ${max.toFixed(0)} to be far below ${50 * g.RING_RADIUS}`);
  ok(max > 0, "the chain does move outward");

  // Still strictly increasing — compression is not collapse.
  let increasing = true;
  for (let i = 1; i < 50; i++) if (!(r[`n${i}`] > r[`n${i - 1}`])) increasing = false;
  ok(increasing, "each link's radius strictly increases along the chain");
}

// ---------------------------------------------------------------------------
suite("every radius is a whole number of steps, plus zero to three rows");

// What compounding would destroy, and the cheapest way to see it holds.
{
  const { r } = radii(balancedTree(3, 6), "r");
  const d = depths(balancedTree(3, 6), "r");
  const nonzero = Object.entries(r).filter(([id]) => d[id] > 0);
  let offGrid = 0;
  for (const [, radius] of nonzero) {
    // The epsilon is not cosmetic: 1080 / 180 lands a hair under 6 in binary,
    // and without it every node on an exact ring is read as a band 180px deep.
    const ring = Math.floor(radius / g.RING_RADIUS + 1e-9) * g.RING_RADIUS;
    const over = radius - ring;
    const k = over / g.BAND_STEP;
    if (Math.abs(k - Math.round(k)) > 1e-6 || over > BAND_REACH + 1e-6) offGrid++;
  }
  eq(
    offGrid,
    0,
    `the radii of ${nonzero.length} nodes should be multiples of ${g.RING_RADIUS}, plus at most ${MAX_ROWS - 1} rows of ${g.BAND_STEP}px`
  );
}

// ---------------------------------------------------------------------------
suite("a subtree stays within its own sector");

// Sectors stay disjoint even where the ring is over-full — crowding shares a
// ring, it does not let a subtree wander into a sibling's sector.
{
  const graph = classTree({
    r: ["a", "b"],
    a: ["a0", "a1", "a2", "a3", "a4", "a5"],
    b: ["b0"],
    a0: ["a00", "a01", "a02"],
    a1: ["a10", "a11", "a12"],
    b0: ["b00"],
  });
  const { out } = radii(graph, "r");
  const origin = out.positions.r;
  const ang = (id) =>
    Math.atan2(out.positions[id].y - origin.y, out.positions[id].x - origin.x);
  const aSide = ["a", "a0", "a1", "a2", "a3", "a4", "a5", "a00", "a01", "a02", "a10", "a11", "a12"];
  const bSide = ["b", "b0", "b00"];
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const aAngles = aSide.map((id) => norm(ang(id)));
  const bAngles = bSide.map((id) => norm(ang(id)));
  // Two disjoint sectors: no b-angle may fall between the a-extremes, once the
  // seam is accounted for by testing both orderings.
  const aMin = Math.min(...aAngles);
  const aMax = Math.max(...aAngles);
  const inside = bAngles.filter((t) => t > aMin && t < aMax).length;
  const outside = bAngles.length - inside;
  ok(inside === 0 || outside === 0, "b's subtree should not be scattered on both sides of a's sector");
}

module.exports = {};
