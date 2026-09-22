"use strict";

// What the right button's set looks like: the pressed node at the foot, and
// what it points to fanned out above it through the opening the viewer ships,
// `REACH_FAN` — read from the viewer rather than copied, so these hold for the
// angle the reader actually sees.
//
// The fan is the full drawing's layout with one thing changed — the angular
// budget the root is given. Everything below the root already partitions the
// sector it is handed, so a narrower seed confines the whole tree to it. These
// tests hold the fan to that: it must be below, and it must be the same rules.

const { loadGraphJs, suite, ok, eq, near, balancedTree, classTree, allVisible } = require("./harness.js");

const g = loadGraphJs();

/** Upward: -90° is up on screen, since y grows downward. */
const FAN = g.REACH_FAN;
/** The same opening, given with no room to widen. */
const FIXED = { start: FAN.start, width: FAN.width };

const angleFrom = (apex, p) => Math.atan2(p.y - apex.y, p.x - apex.x);
const radiusFrom = (apex, p) => Math.hypot(p.x - apex.x, p.y - apex.y);

suite("fan: the pressed node is at the bottom, the types all above it");

{
  // Deep enough to have levels, wide enough that a full circle would put
  // children below the root.
  const graph = balancedTree(3, 3);
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  const apex = out.positions.r;
  ok(!!apex, "expected the apex to have a position");
  let above = 0;
  let inside = 0;
  let others = 0;
  for (const [id, p] of Object.entries(out.positions)) {
    if (id === "r") continue;
    others++;
    if (p.y < apex.y) above++;
    const a = angleFrom(apex, p);
    if (a >= FAN.start - 1e-9 && a <= FAN.start + FAN.width + 1e-9) inside++;
  }
  eq(others, 39, "three levels of three children each gives 39 besides the apex");
  eq(above, others, "every type is above it");
  eq(inside, others, "and all fall within the opening");
}

suite("a crowded fan level is handled by the full drawing's rule");

{
  // A ring's radius is its depth's alone, in the fan as in the full drawing.
  // Thirty children in less than half a circle do not fit side by side; the ring
  // must stay where depth puts it and let them crowd, not flee outward.
  const kids = [];
  for (let i = 0; i < 30; i++) kids.push("k" + i);
  const graph = classTree({ r: kids });

  // A fixed sector, so what is tested is the crowded-level rule itself, not
  // the widening that stands in front of it in the viewer's fan.
  const fan = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FIXED });
  const full = g.computeClassRingPositions(graph, "r", allVisible(graph), {});
  const apexF = fan.positions.r;
  const apexW = full.positions.r;
  for (const id of kids) {
    near(radiusFrom(apexF, fan.positions[id]), g.RING_RADIUS, 1e-6, `in the fan, ${id} is at the first-level radius`);
    near(radiusFrom(apexW, full.positions[id]), g.RING_RADIUS, 1e-6, `in the full drawing, ${id} is at the same radius`);
  }

  // Where the reader chose rows, the childless move outward into them — the
  // full drawing's rule for a crowded level, applied here unchanged.
  const rows = g.computeClassRingPositions(graph, "r", allVisible(graph), {
    rootSector: FIXED,
    bandOverflow: true,
  });
  const apexR = rows.positions.r;
  const moved = kids.filter((id) => radiusFrom(apexR, rows.positions[id]) > g.RING_RADIUS + 1e-6);
  ok(moved.length > 0, `with rows chosen, leaves that do not fit should move to outer rows, got ${moved.length} moved`);
  ok(
    moved.every((id) => rows.positions[id].y < apexR.y),
    "the moved ones are still above it"
  );
}

suite("without an opening it is the original full drawing");

{
  // The default must be the full circle itself, not merely something that
  // happens to look like it: passing the whole circle explicitly has to lay the
  // drawing out exactly as passing nothing does. Two roots of different weight
  // on each side, so that the balancing a full circle gets actually moves
  // something — a condition written as "was a sector passed?" rather than "is
  // it a slice?" skips the balancing and fails here.
  const graph = classTree({
    r: ["a", "b", "c", "d"],
    b: ["b1", "b2", "b3", "b4", "b5", "b6"],
    d: ["d1", "d2", "d3", "d4", "d5", "d6"],
  });
  const plain = g.computeClassRingPositions(graph, "r", allVisible(graph), {});
  const whole = g.computeClassRingPositions(graph, "r", allVisible(graph), {
    rootSector: { start: -Math.PI / 2, width: 2 * Math.PI },
  });
  const flat = (out) =>
    JSON.stringify(Object.keys(out.positions).sort().map((k) => [k, out.positions[k].x, out.positions[k].y]));
  eq(flat(whole), flat(plain), "passing a full circle and passing nothing should give identical coordinates");
}

suite("a fan does not reorder the root's children");

{
  // A full circle spreads its heaviest subtrees to opposite sides; a fan has no
  // opposite sides, and reordering it only scrambles the grouping the ring
  // order already has. With no inheritance among them the ring order is
  // alphabetical, and the fan must keep it, where balancing would give b,a,c,d.
  const graph = classTree({
    r: ["a", "b", "c", "d"],
    b: ["b1", "b2", "b3", "b4", "b5", "b6"],
    d: ["d1", "d2", "d3", "d4", "d5", "d6"],
  });
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  const apex = out.positions.r;
  const order = ["a", "b", "c", "d"]
    .map((id) => [id, angleFrom(apex, out.positions[id])])
    .sort((x, y) => x[1] - y[1])
    .map((x) => x[0])
    .join(",");
  eq(order, "a,b,c,d", "children on a fan keep their original order, without the balancing only a full circle needs");
}

suite("a fan widens only when crowded, only as far as needed, at most a full circle");

/** The angular floor a ring at radius `r` gives each node. */
const floorAt = (r) => 2 * Math.asin(Math.min(1, (g.NODE_DIAMETER * 1.5) / (2 * r)));
/** An angle measured from straight up, in (-π, π]. */
const fromUp = (apex, p) => {
  let x = angleFrom(apex, p) + Math.PI / 2;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
};
const kidsOf = (n) => Array.from({ length: n }, (_, i) => "k" + i);

{
  const graph = classTree({ r: ["a", "b", "c"] });
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  near(out.rootWidth, FAN.width, 1e-9, "three children do not fill it, so the opening is unchanged");
}

{
  // Fifteen on the first ring need more than 150° and less than a circle: the
  // fan opens to what they need, about straight up, and no wider.
  const kids = kidsOf(15);
  const graph = classTree({ r: kids });
  const need = 15 * floorAt(g.RING_RADIUS);
  ok(need > FAN.width && need < 2 * Math.PI, `fifteen need ${((need * 180) / Math.PI).toFixed(0)}°, between the opening and a full circle`);
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  near(out.rootWidth, need, 1e-9, "it opens to just the angle needed");
  const angles = kids.map((k) => fromUp(out.positions.r, out.positions[k]));
  near((Math.min(...angles) + Math.max(...angles)) / 2, 0, 1e-6, "it still widens centred on straight up");
}

{
  // The first ring alone decides. Thirty on the second ring would need far more
  // than the opening, but the two on the first fit it, so the fan keeps its
  // shape and the outer ring crowds — the reader's rule: the nearer a ring is
  // to the pressed node, the less it may overlap.
  const graph = classTree({
    r: ["a", "b"],
    a: kidsOf(15).map((k) => "a" + k),
    b: kidsOf(15).map((k) => "b" + k),
  });
  const need = 30 * floorAt(2 * g.RING_RADIUS);
  ok(need > FAN.width, `thirty on the outer ring need ${((need * 180) / Math.PI).toFixed(0)}°, wider than the opening`);
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  near(out.rootWidth, FAN.width, 1e-9, "a crowded outer ring does not widen the fan; only the innermost ring counts");
}

{
  const kids = kidsOf(30);
  const graph = classTree({ r: kids });
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FAN });
  near(out.rootWidth, 2 * Math.PI, 1e-9, "thirty would need more than a full circle, so it stops at a full circle");
}

{
  // Room to widen is the caller's to give. Without it, a sector stays as given
  // however crowded — which is what lets the crowded-level suite above test the
  // rule on its own.
  const kids = kidsOf(30);
  const graph = classTree({ r: kids });
  const out = g.computeClassRingPositions(graph, "r", allVisible(graph), { rootSector: FIXED });
  near(out.rootWidth, FIXED.width, 1e-9, "an opening not allowed to widen stays put however crowded");
}

module.exports = {};
