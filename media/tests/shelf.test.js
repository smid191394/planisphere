"use strict";

// Where a group goes when another group is much bigger.
//
// Packed into rows, groups pay for the height of each row's tallest member:
// on CPython, small trees would sit on rows of their own, mostly empty, while
// the whole height beside the primary tree's block stood empty too.
//
// What is asserted here is the property, not the algorithm: a group small
// enough to fit beside a taller one is drawn beside it, and the drawing is no
// taller than its tallest group needs.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const C = (id) => ({ id, name: id, kind: "class", file: "/p/" + id + ".py", line: 1 });
const E = (from, to) => ({ from, to, kind: "uses" });

/**
 * One deep tree, and `small` little ones of two classes each.
 *
 * Depth is what makes the first one tall: each class-to-class hop is a ring
 * step, so a chain of `depth` classes is a block about `2 * depth * RING_RADIUS`
 * across in both axes once its rings are reserved.
 */
function tallAndSmall(depth, small) {
  const nodes = [C("Root")];
  const edges = [];
  let prev = "Root";
  for (let i = 0; i < depth; i++) {
    nodes.push(C(`D${i}`));
    edges.push(E(prev, `D${i}`));
    // A second child at each level, so the tree is a tree and not a line.
    nodes.push(C(`E${i}`));
    edges.push(E(prev, `E${i}`));
    prev = `D${i}`;
  }
  for (let i = 0; i < small; i++) {
    nodes.push(C(`S${i}a`), C(`S${i}b`));
    edges.push(E(`S${i}a`, `S${i}b`));
  }
  return { nodes, edges };
}

/**
 * Every group's box the way the packer reserves it: the nodes, plus the full
 * circle its outermost ring draws. Comparing node extents alone would compare
 * against something the arrangement never used.
 */
function reserved(out) {
  const bs = boxes(out);
  for (const b of bs) {
    const rp = out.positions[b.root];
    if (!rp) continue;
    let maxR = 0;
    for (const [id, root] of Object.entries(out.groupOf)) {
      if (root !== b.root) continue;
      const p = out.positions[id];
      if (p) maxR = Math.max(maxR, Math.hypot(p.x - rp.x, p.y - rp.y));
    }
    if (maxR >= 2) {
      b.minX = Math.min(b.minX, rp.x - maxR);
      b.maxX = Math.max(b.maxX, rp.x + maxR);
      b.minY = Math.min(b.minY, rp.y - maxR);
      b.maxY = Math.max(b.maxY, rp.y + maxR);
    }
  }
  return bs;
}

/** Every group's bounding box, from the laid-out positions. */
function boxes(out) {
  const byRoot = new Map();
  for (const [id, root] of Object.entries(out.groupOf)) {
    const p = out.positions[id];
    if (!p) continue;
    if (!byRoot.has(root)) {
      byRoot.set(root, { root, minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, n: 0 });
    }
    const b = byRoot.get(root);
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxY = Math.max(b.maxY, p.y);
    b.n++;
  }
  return [...byRoot.values()];
}

/**
 * The centre is named, not chosen.
 *
 * These shapes are about where groups go, and `Root` is where they were built
 * to be rooted — the tall tree is tall because it hangs off it. Reading the
 * centre from the criterion instead makes the subject of every assertion here
 * depend on a decision made somewhere else: a criterion about nearness puts
 * the centre in the middle of a chain, as it should, and then the tall tree is
 * not tall and half of these fail for a reason that has nothing to do with
 * packing.
 */
const ROOT = "Root";

function laidOut(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return pure.computeClassRingPositions(graph, ROOT, ids);
}

// ---------------------------------------------------------------------------
suite("small trees go beside a big tree, not below it");

{
  const out = laidOut(tallAndSmall(6, 10));
  const bs = reserved(out);
  ok(bs.length >= 6, `need enough groups for the test to mean anything, got ${bs.length}`);
  bs.sort((a, b) => b.maxY - b.minY - (a.maxY - a.minY));
  const tall = bs[0];
  const rest = bs.slice(1);
  const tallH = tall.maxY - tall.minY;
  ok(tallH > 600, `the tallest group should be tall enough, got ${Math.round(tallH)}px`);

  // The claim: everything else fits within the tall one's own vertical band.
  let below = 0;
  let worst = 0;
  for (const b of rest) {
    const over = b.maxY - tall.maxY;
    if (over > pure.COMPONENT_GAP) below++;
    worst = Math.max(worst, over);
  }
  eq(below, 0, `small groups should fit within the big group's height, ${below} fell below (worst by ${Math.round(worst)}px)`);

  // And the drawing as a whole is no taller than that band plus a gap.
  const all = Object.values(out.positions);
  const H = Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y));
  ok(
    H <= tallH + pure.COMPONENT_GAP,
    `the graph should not be much taller than its tallest group: ${Math.round(H)} vs ${Math.round(tallH)}`
  );
}

// ---------------------------------------------------------------------------
suite("big ones placed first, small ones fill the gaps");

{
  // Placement order, not reading order. A larger group must never be made to
  // fit around a smaller one that went down before it, which is what keeps the
  // arrangement broadly large-to-small.
  const out = laidOut(tallAndSmall(5, 8));
  const bs = reserved(out);
  bs.sort((a, b) => b.n - a.n);
  const biggest = bs[0];
  // The biggest group holds the left edge: it went down first, so nothing was
  // there to push it right.
  let leftOfBiggest = 0;
  for (const b of bs.slice(1)) if (b.minX < biggest.minX - 1) leftOfBiggest++;
  eq(leftOfBiggest, 0, "no group is placed left of the biggest one");
}

// ---------------------------------------------------------------------------
suite("the centre's group still comes first");

{
  // The centre's group reads first even when it is not the largest — a
  // separate promise from the size ordering, and the one the eye depends on.
  const graph = tallAndSmall(2, 6);
  const out = laidOut(graph);
  const centre = ROOT;
  const bs = reserved(out);
  const mine = bs.find((b) => b.root === centre);
  ok(!!mine, "the centre should have its own group");
  let earlier = 0;
  for (const b of bs) {
    if (b === mine) continue;
    if (b.minY < mine.minY - 1 || (Math.abs(b.minY - mine.minY) <= 1 && b.minX < mine.minX - 1)) {
      earlier++;
    }
  }
  eq(earlier, 0, "no group is placed before the centre's group");
}

// ---------------------------------------------------------------------------
suite("nothing sits higher than the main tree's first node");

{
  // A group's box holds the whole circle its outermost ring draws, and that
  // circle reaches above every node on it — 387px above CPython's topmost
  // class. A small group placed flush with the top of that box sits in a band
  // the drawing has nothing in, and reads as floating over the picture rather
  // than beside it.
  const graph = tallAndSmall(6, 10);
  const out = laidOut(graph);
  const centre = ROOT;
  const bs = boxes(out);
  const prim = bs.find((b) => b.root === centre);
  ok(!!prim, "the main tree should have its own group");
  let above = 0;
  let worst = 0;
  for (const b of bs) {
    if (b === prim) continue;
    if (b.minY < prim.minY - 1) above++;
    worst = Math.max(worst, prim.minY - b.minY);
  }
  eq(above, 0, `no small group should sit above the main tree's first node, ${above} did (worst by ${Math.round(worst)}px)`);
}

// ---------------------------------------------------------------------------
suite("isolated nodes go to the emptiest spot");

{
  // The cluster is the one block with nothing to say about the structure, and
  // it is wide: on CPython 5,701px against a target width of about 8,900. Held
  // to that target it could not stand beside the primary tree and would fall
  // to the only place left, underneath everything — leaving the whole region
  // right of the primary tree and below the small ones empty.
  //
  // So it may run past the target width, and it takes the slot that leaves the
  // drawing smallest rather than the lowest one — the lowest is the far right,
  // where nothing has been placed, and would stretch CPython's canvas far wider
  // for it.
  const graph = tallAndSmall(6, 10);
  for (let i = 0; i < 40; i++) graph.nodes.push(C(`Z${i}`));
  const out = laidOut(graph);
  const centre = ROOT;

  const cluster = [];
  const grouped = [];
  for (const [id, p] of Object.entries(out.positions)) {
    (out.groupOf[id] ? grouped : cluster).push({ id, ...p });
  }
  ok(cluster.length >= 40, `need enough isolated nodes, got ${cluster.length}`);

  const prim = grouped.filter((p) => out.groupOf[p.id] === centre);
  const primX1 = Math.max(...prim.map((p) => p.x));
  const primY0 = Math.min(...prim.map((p) => p.y));
  const primY1 = Math.max(...prim.map((p) => p.y));
  const cx0 = Math.min(...cluster.map((p) => p.x));
  const cy0 = Math.min(...cluster.map((p) => p.y));

  ok(cx0 > primX1, `should be right of the main tree: isolated area starts at ${Math.round(cx0)}, main tree ends at ${Math.round(primX1)}`);
  ok(
    cy0 < primY1,
    `and not dropped below the whole graph: isolated area starts at y ${Math.round(cy0)}, main tree ends at y ${Math.round(primY1)}`
  );
  ok(cy0 > primY0, `nor pushed to the very top: isolated area y ${Math.round(cy0)}, main tree from ${Math.round(primY0)}`);

  // And it is in free space, not on top of anything.
  let onTop = 0;
  for (const c of cluster) {
    for (const t of grouped) {
      if (Math.hypot(c.x - t.x, c.y - t.y) < pure.NODE_DIAMETER) onTop++;
    }
  }
  eq(onTop, 0, "no isolated node overlaps a tree node");
}

// ---------------------------------------------------------------------------
suite("the isolated area is laid out in two trays: things that are used in one, functions in the other");

{
  // One disc comes out 3.6 times wider than it is tall, and at that width it
  // cannot stand beside a tree — so it would fall underneath, and where it
  // fell would not be the same answer from one graph to the next. Two stacked
  // discs are about 1.9:1 and fit beside.
  //
  // Split on kind, not in half: kind decides where a node sits, from the
  // centre outward, and cutting in half would put a function in the first
  // disc's middle.
  // Deliberately lopsided. Each disc is drawn about its own centre, so a
  // stacking that advances by one disc's height puts the next disc's *centre*
  // there and half of it lands back inside the one above. With the two discs
  // the same size that error is invisible; CPython's are 728 and 1,363 tall,
  // which is enough for them to overlap.
  const graph = tallAndSmall(6, 10);
  for (let i = 0; i < 10; i++) graph.nodes.push(C(`Z${i}`));
  for (let i = 0; i < 50; i++) {
    graph.nodes.push({
      id: `Y${i}`, name: `Y${i}`, kind: "function", file: `/p/Y${i}.py`, line: 1,
    });
  }
  const out = laidOut(graph);
  const cluster = [];
  for (const [id, p] of Object.entries(out.positions)) {
    if (!out.groupOf[id]) cluster.push({ id, ...p, fn: id.startsWith("Y") });
  }
  eq(cluster.length, 60, "isolated nodes of both kinds should be in the isolated area");

  const fns = cluster.filter((p) => p.fn);
  const rest = cluster.filter((p) => !p.fn);
  const band = (a) => ({ y0: Math.min(...a.map((p) => p.y)), y1: Math.max(...a.map((p) => p.y)) });
  const B = band(rest);
  const F = band(fns);
  ok(
    F.y0 > B.y1,
    `the function tray should sit wholly below the other: class ends at ${Math.round(B.y1)}, function starts at ${Math.round(F.y0)}`
  );
  ok(
    F.y1 - F.y0 > (B.y1 - B.y0) * 1.5,
    `the trays need to be lopsided enough to catch this bug: ${Math.round(B.y1 - B.y0)} vs ${Math.round(F.y1 - F.y0)}`
  );

  // Two discs, not one: each is much wider than tall, and together they are
  // nearer square than either.
  const w = Math.max(...cluster.map((p) => p.x)) - Math.min(...cluster.map((p) => p.x));
  const h = Math.max(...cluster.map((p) => p.y)) - Math.min(...cluster.map((p) => p.y));
  ok(w / h < 3, `the whole clump should be squarer than one tray, got ${(w / h).toFixed(2)}:1`);
}

// ---------------------------------------------------------------------------
suite("with only one tree, the isolated area goes beside it, not below it");

{
  // FastAPI has one tree and nothing else, and there the block can go
  // underneath, 1,715x2,276, or beside, 3,000x1,530. Underneath is 18% less
  // area, so a rule of "the slot that leaves the drawing smallest" would put it
  // underneath.
  //
  // Area is the wrong thing to minimise. A drawing is read at whatever
  // magnification fits it into a viewport, and a tall narrow one wastes the
  // width: FastAPI's stacked form can only be shown at 0.35 in 1200x800,
  // beside at 0.38. Scoring by what the viewport has to divide by puts it
  // beside — and the score is the same one TARGET_ASPECT already states.
  const graph = tallAndSmall(6, 0);
  for (let i = 0; i < 40; i++) graph.nodes.push(C(`Z${i}`));
  const out = laidOut(graph);
  const centre = ROOT;

  const cluster = [];
  const prim = [];
  for (const [id, p] of Object.entries(out.positions)) {
    if (!out.groupOf[id]) cluster.push({ id, ...p });
    else if (out.groupOf[id] === centre) prim.push({ id, ...p });
  }
  ok(cluster.length >= 40, `need enough isolated nodes, got ${cluster.length}`);

  const groups = new Set(Object.values(out.groupOf));
  eq(groups.size, 1, "this shape has only one tree, with no small trees to lean on");

  const primX1 = Math.max(...prim.map((p) => p.x));
  const primY0 = Math.min(...prim.map((p) => p.y));
  const primY1 = Math.max(...prim.map((p) => p.y));
  const cx0 = Math.min(...cluster.map((p) => p.x));
  const cy0 = Math.min(...cluster.map((p) => p.y));
  const cy1 = Math.max(...cluster.map((p) => p.y));

  ok(cx0 > primX1, `should be right of the main tree: isolated area starts at x ${Math.round(cx0)}, main tree ends at ${Math.round(primX1)}`);
  const overlap = Math.min(primY1, cy1) - Math.max(primY0, cy0);
  ok(
    overlap > 0,
    `and level with the main tree, not dropped to the bottom right: vertical overlap ${Math.round(overlap)}px` +
      ` (isolated area y ${Math.round(cy0)}..${Math.round(cy1)}, main tree ${Math.round(primY0)}..${Math.round(primY1)})`
  );
}

// ---------------------------------------------------------------------------
suite("a spot is picked by how much fits, not by how small the area is");

{
  // The two are not the same objective, and the shape here separates them: a
  // block that makes the drawing wider costs area but not magnification, up
  // until the drawing is wider than the viewport's own proportion.
  const graph = tallAndSmall(6, 0);
  for (let i = 0; i < 40; i++) graph.nodes.push(C(`Z${i}`));
  const out = laidOut(graph);
  const all = Object.values(out.positions);
  const w = Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x));
  const h = Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y));

  // Wider than tall, and no wider than the target proportion asks for. Both
  // halves matter: the first is what stacking gets wrong, the second is what
  // "put everything in one row" would get wrong.
  ok(w > h, `the graph should be wide, got ${Math.round(w)}x${Math.round(h)}`);
  ok(
    w / h <= pure.TARGET_ASPECT * 1.5,
    `nor stretched into a long strip to avoid overlap: ${(w / h).toFixed(2)}:1, target ${pure.TARGET_ASPECT.toFixed(2)}:1`
  );
}

// ---------------------------------------------------------------------------
suite("two layouts come out identical");

{
  const graph = tallAndSmall(4, 9);
  const a = laidOut(graph);
  const b = laidOut(graph);
  let moved = 0;
  for (const [id, p] of Object.entries(a.positions)) {
    const q = b.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
  }
  eq(moved, 0, "laying out the same graph twice puts every node in the same position");
}

// ---------------------------------------------------------------------------
suite("every ring guarantee still holds");

{
  // Asserted on a shape rather than only on the fixtures: filling the space
  // beside a group is exactly the move that could let one group's rings reach
  // into another.
  const out = laidOut(tallAndSmall(6, 12));
  const bs = boxes(out);
  const radii = new Map();
  for (const b of bs) {
    const rp = out.positions[b.root];
    let maxR = 0;
    for (const [id, root] of Object.entries(out.groupOf)) {
      if (root !== b.root) continue;
      const p = out.positions[id];
      if (p && rp) maxR = Math.max(maxR, Math.hypot(p.x - rp.x, p.y - rp.y));
    }
    radii.set(b.root, maxR);
  }
  let enclosed = 0;
  let crossing = 0;
  for (const b of bs) {
    const rp = out.positions[b.root];
    const R = radii.get(b.root);
    if (!rp || R <= 0) continue;
    for (const [id, root] of Object.entries(out.groupOf)) {
      if (root === b.root) continue;
      const p = out.positions[id];
      if (p && Math.hypot(p.x - rp.x, p.y - rp.y) < R) enclosed++;
    }
    for (const other of bs) {
      if (other === b) continue;
      const op = out.positions[other.root];
      const oR = radii.get(other.root);
      if (!op || oR <= 0) continue;
      const d = Math.hypot(op.x - rp.x, op.y - rp.y);
      if (d < R + oR && d > Math.abs(R - oR)) crossing++;
    }
  }
  eq(enclosed, 0, "no node lands inside another group's ring");
  eq(crossing, 0, "no two groups' rings intersect");
}

module.exports = {};
