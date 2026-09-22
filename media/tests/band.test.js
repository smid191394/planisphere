"use strict";

// What happens to a parent's children when its sector cannot hold them.
//
// A vertex owns an angular sector and its children partition it, so a parent
// with a narrow sector and several children gives each of them a sliver — and
// a sliver cannot hold a node. Measured, that is not a rare corner: 252 of
// Django's 519 parents are in this state and 256 of CPython's 613, and it puts
// 5,279 pairs of Django's nodes on top of one another and 1,760 of CPython's.
//
// The ring itself is not the problem. CPython's busiest ring holds 232 nodes
// where 242 fit; the room is there, in the wrong sectors, and no reweighting
// of the sectors can move it — a parent's children have to stay adjacent.
// Widening the rings does not help either: at RING_RADIUS 400 Django's drawing
// grows 2.2x in each axis to buy 9% fewer tight pairs, and since the whole
// drawing must then be shown 2.2x smaller, the gap on screen comes out worse.
//
// So the children that do not fit go outward instead, into the room between
// this ring and the next one.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const C = (id) => ({ id, name: id, kind: "class", file: "/p/" + id + ".py", line: 1 });
const E = (from, to) => ({ from, to, kind: "uses" });

/**
 * A root with `sibs` children, each carrying `leaves` of its own.
 *
 * The siblings split the circle between them, so each one's sector is
 * `2π/sibs` wide — narrow enough, at these numbers, that its own children
 * cannot stand side by side on the next ring.
 */
function narrowSectors(sibs, leaves, carriers) {
  const nodes = [C("Root")];
  const edges = [];
  for (let i = 0; i < sibs; i++) {
    nodes.push(C(`S${i}`));
    edges.push(E("Root", `S${i}`));
    for (let k = 0; k < leaves; k++) {
      nodes.push(C(`S${i}L${k}`));
      edges.push(E(`S${i}`, `S${i}L${k}`));
      // Some of the children carry a subtree of their own.
      if (i === 0 && k < carriers) {
        nodes.push(C(`S${i}L${k}g`));
        edges.push(E(`S${i}L${k}`, `S${i}L${k}g`));
      }
    }
  }
  return { nodes, edges };
}

/**
 * Rows are asked for.
 *
 * These shapes are about what rows do, not about which of the two a reader who
 * has expressed no preference is shown — the drawing opens on the arc. A suite
 * that read the default would be asserting on the default's behalf, and would
 * start failing the day the default moved for a reason that has nothing to do
 * with what is claimed here.
 */
function laidOut(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return pure.computeClassRingPositions(graph, pure.pickTopClass(graph), ids, {
    bandOverflow: true,
  });
}

/** Distance from the group's centre. */
function radii(out, ids) {
  const c = out.positions["Root"];
  return ids.map((id) => {
    const p = out.positions[id];
    return p ? Math.hypot(p.x - c.x, p.y - c.y) : NaN;
  });
}

const kidsOf = (n, leaves) => {
  const a = [];
  for (let k = 0; k < leaves; k++) a.push(`S${n}L${k}`);
  return a;
};

// ---------------------------------------------------------------------------
suite("children that do not fit stack outward rather than crowd onto one ring");

{
  const out = laidOut(narrowSectors(20, 8, 0));
  const rs = radii(out, kidsOf(1, 8));
  ok(rs.every((r) => !Number.isNaN(r)), "all eight children should have positions");

  const onRing = rs.filter((r) => Math.abs(r - 360) < 1).length;
  const outward = rs.filter((r) => r > 361).length;
  ok(onRing >= 1, `expected some to stay on the ring, got ${onRing}`);
  eq(onRing + outward, 8, "each child is either on the ring or outside it, nothing else");
  ok(outward >= 4, `the ones that do not fit should move outward, only ${outward} did`);
}

// ---------------------------------------------------------------------------
suite("outward stacking forms distinct rows, not a scatter");

{
  const out = laidOut(narrowSectors(20, 8, 0));
  const rs = radii(out, kidsOf(1, 8)).filter((r) => r > 361);
  const steps = new Set(rs.map((r) => Math.round(r - 360)));
  ok(steps.size <= 4, `expected only a few distinct radii, got ${[...steps].sort((a, b) => a - b).join("/")}`);
  for (const s of steps) {
    eq(s % 45, 0, `each row should fall on a fixed spacing, got ${s}px outward`);
  }
}

// ---------------------------------------------------------------------------
suite("outward rows never cross the next ring");

{
  // The band lives in the room between two rings. If it reached the next one
  // the ring would have to move, and moving a ring moves every ring outside
  // it: letting the band push the rings out takes Django's drawing from
  // 6,454x3,421 to 11,707x6,570 and its magnification from 0.186 to 0.102 —
  // a bigger drawing shown smaller.
  const out = laidOut(narrowSectors(20, 12, 0));
  const rs = radii(out, kidsOf(1, 12));
  const furthest = Math.max(...rs);
  ok(
    furthest < 360 + pure.RING_RADIUS,
    `the outermost row ${Math.round(furthest)} should stay inside the next ring ${360 + pure.RING_RADIUS}`
  );
}

// ---------------------------------------------------------------------------
suite("nodes with children stay on the ring");

{
  // A banded node's slot is reused by the row outside it, which is harmless
  // for a leaf and not for anything else: a subtree hanging off a banded node
  // would land on top of the subtree of the node in the same slot one row in.
  const out = laidOut(narrowSectors(20, 8, 3));
  const carriers = ["S0L0", "S0L1", "S0L2"];
  const rs = radii(out, carriers);
  for (let i = 0; i < carriers.length; i++) {
    ok(Math.abs(rs[i] - 360) < 1, `${carriers[i]} has children of its own and should stay on the ring, got r=${Math.round(rs[i])}`);
  }
  // And the leaves beside them are the ones that moved.
  const leafRs = radii(out, ["S0L5", "S0L6", "S0L7"]);
  ok(leafRs.some((r) => r > 361), "only the childless leaves are the ones moved outward");
}

// ---------------------------------------------------------------------------
suite("after stacking outward nodes no longer overlap");

{
  const graph = narrowSectors(20, 8, 0);
  const out = laidOut(graph);
  const ids = kidsOf(1, 8);
  let touching = 0;
  let closest = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = out.positions[ids[i]];
      const b = out.positions[ids[j]];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      closest = Math.min(closest, d);
      if (d < pure.NODE_DIAMETER) touching++;
    }
  }
  eq(touching, 0, `children of one parent should not overlap, the closest pair is ${Math.round(closest)}px apart`);
}

// ---------------------------------------------------------------------------
suite("a roomy sector is unaffected");

{
  // The band is a response to not fitting. Where there is room, nothing moves.
  const out = laidOut(narrowSectors(3, 4, 0));
  const rs = radii(out, kidsOf(1, 4));
  for (const r of rs) {
    ok(Math.abs(r - 360) < 1, `when they fit, all children should stay on the ring, got r=${Math.round(r)}`);
  }
}

// ---------------------------------------------------------------------------
suite("outward rows get no ring");

{
  // A ring marks a level of the tree, and its radii are the ones the tree
  // placement used. A band is a row inside a level, not a level of its own:
  // drawing a circle at each would turn one level into five.
  // Through the viewer, so the rings asserted on are the ones it draws — and
  // therefore rows have to be turned on, the drawing opening on the arc.
  const g = loadGraphJs({ headless: true });
  const graph = narrowSectors(20, 8, 0);
  g.send({ command: "setSettings", settings: { bandOverflow: true } });
  g.send({ command: "setGraph", graph });

  // Rows are actually happening, or the rest of this proves nothing: with
  // every node on its ring, "no ring at a row's radius" is true of a drawing
  // that has no rows.
  const c = g.live.cy.getElementById("Root").position();
  let banded = 0;
  g.live.cy.nodes().forEach((n) => {
    const p = n.position();
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    if (r > 1 && Math.abs(r / pure.RING_RADIUS - Math.round(r / pure.RING_RADIUS)) > 1e-6) banded++;
  });
  ok(banded > 0, `expected this shape to actually produce outward-stacked nodes, got ${banded}`);

  const drawn = (g.live.ringGroups || []).flatMap((x) => x.radii).map((r) => Math.round(r));
  ok(drawn.length > 0, "and expected rings to be drawn");
  for (const r of drawn) {
    eq(r % pure.RING_RADIUS, 0, `drawn rings should still be the original levels, got r=${r}`);
  }
}

// ---------------------------------------------------------------------------
suite("two layouts come out identical");

{
  const graph = narrowSectors(20, 8, 2);
  const a = laidOut(graph);
  const b = laidOut(graph);
  let moved = 0;
  for (const [id, p] of Object.entries(a.positions)) {
    const q = b.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
  }
  eq(moved, 0, "laying out the same graph twice puts every node in the same place");
}

module.exports = {};
