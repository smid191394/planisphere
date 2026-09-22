"use strict";

// Where disconnected groups are placed relative to one another.
//
// The property is about the rings, so it is checked against `ringGroups` — the
// list the renderer actually draws from — rather than against a reconstruction
// from positions. A reservation that agrees with a reconstruction and disagrees
// with the renderer would guarantee something other than what the reader sees.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

/**
 * One large group beside several two-node ones — Django's shape and CPython's.
 * The large group's outermost ring is carried by a single node, so its node box
 * stops well short of its circle.
 */
function crowdedGraph(bigDepth, smallCount) {
  const nodes = [];
  const edges = [];
  const cls = (id) => ({ id, name: id, kind: "class", file: `/p/${id}.py`, line: 1 });

  // A wide-then-narrow tree: a fan at depth 1 so the box is wide, then a single
  // chain outward so the outer rings hold one node each.
  nodes.push(cls("big"));
  for (let i = 0; i < 12; i++) {
    nodes.push(cls(`b${i}`));
    edges.push({ from: "big", to: `b${i}`, kind: "uses" });
  }
  let tip = "b0";
  for (let d = 0; d < bigDepth; d++) {
    const id = `deep${d}`;
    nodes.push(cls(id));
    edges.push({ from: tip, to: id, kind: "uses" });
    tip = id;
  }

  for (let i = 0; i < smallCount; i++) {
    nodes.push(cls(`s${i}a`), cls(`s${i}b`));
    edges.push({ from: `s${i}a`, to: `s${i}b`, kind: "uses" });
  }
  return { nodes, edges };
}

/**
 * Every group's centre and the radii drawn around it, taken from the viewer,
 * paired with the nodes that belong to each group.
 */
function drawnGroups(L) {
  const pos = {};
  L.cy.nodes().forEach((n) => {
    if (n.style("display") === "none") return;
    const p = n.position();
    pos[n.id()] = { x: p.x, y: p.y };
  });
  const groupOf = L.nodeGroups || {};
  const members = new Map();
  for (const [id, root] of Object.entries(groupOf)) {
    if (!pos[id]) continue;
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  }
  // `ringGroups` carries a centre and its radii; match it to the group whose
  // root sits at that centre.
  const rings = [];
  for (const g of L.ringGroups || []) {
    let root = null;
    for (const r of members.keys()) {
      const p = pos[r];
      if (p && Math.abs(p.x - g.cx) < 1e-6 && Math.abs(p.y - g.cy) < 1e-6) {
        root = r;
        break;
      }
    }
    rings.push({ root, cx: g.cx, cy: g.cy, radii: g.radii });
  }
  return { pos, groupOf, members, rings };
}

/** Nodes of one group sitting inside another group's outermost ring. */
function enclosedNodes(d) {
  let n = 0;
  for (const g of d.rings) {
    const R = g.radii[g.radii.length - 1];
    for (const [id, root] of Object.entries(d.groupOf)) {
      if (root === g.root) continue;
      const p = d.pos[id];
      if (!p) continue;
      if (Math.hypot(p.x - g.cx, p.y - g.cy) < R) n++;
    }
  }
  return n;
}

/** Pairs of groups whose outermost circles intersect. */
function crossingRings(d) {
  let n = 0;
  for (let i = 0; i < d.rings.length; i++) {
    for (let j = i + 1; j < d.rings.length; j++) {
      const a = d.rings[i];
      const b = d.rings[j];
      const Ra = a.radii[a.radii.length - 1];
      const Rb = b.radii[b.radii.length - 1];
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      // Two circles miss entirely when one contains the other with room to
      // spare, or when they are further apart than the sum of their radii. The
      // first case is exactly the failure being guarded against, so both count.
      if (dist < Ra + Rb) n++;
    }
  }
  return n;
}

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return { g, L: g.live, d: drawnGroups(g.live) };
}

// ---------------------------------------------------------------------------
suite("one group's rings do not intrude on another group");

{
  const { d } = opened(crowdedGraph(8, 6));
  ok(d.rings.length >= 2, `expected several groups with rings, got ${d.rings.length}`);
  eq(enclosedNodes(d), 0, "no node falls inside another group's rings");
  eq(crossingRings(d), 0, "no two groups' rings intersect");
}

{
  // Deeper, so the big group's circle is far larger than its node box.
  const { d } = opened(crowdedGraph(14, 10));
  eq(enclosedNodes(d), 0, "deeper tree: no node falls inside another group's rings");
  eq(crossingRings(d), 0, "deeper tree: no two groups' rings intersect");
}

{
  // Many small groups, which is CPython's shape: the cost lands on them.
  const { d } = opened(crowdedGraph(6, 30));
  eq(enclosedNodes(d), 0, "30 small groups: no node falls inside another group's rings");
  eq(crossingRings(d), 0, "30 small groups: no two groups' rings intersect");
}

// ---------------------------------------------------------------------------
suite("packing moves whole groups and keeps each group's shape");

{
  // Adding isolated nodes changes how the shelf packs, and nothing else. If a
  // node's offset from its own centre moves, the packer is reshaping a group
  // rather than placing it — which is the one thing packing must not do.
  const base = crowdedGraph(8, 4);
  const padded = {
    nodes: base.nodes.concat(
      Array.from({ length: 40 }, (_, i) => ({
        id: `iso${i}`,
        name: `iso${i}`,
        kind: "class",
        file: `/p/iso${i}.py`,
        line: 1,
      }))
    ),
    edges: base.edges,
  };

  const a = opened(base).d;
  const b = opened(padded).d;
  let moved = 0;
  let compared = 0;
  for (const [id, root] of Object.entries(a.groupOf)) {
    const pa = a.pos[id];
    const oa = a.pos[root];
    const pb = b.pos[id];
    const ob = b.pos[b.groupOf[id]];
    if (!pa || !oa || !pb || !ob) continue;
    compared++;
    if (
      Math.abs(pa.x - oa.x - (pb.x - ob.x)) > 1e-6 ||
      Math.abs(pa.y - oa.y - (pb.y - ob.y)) > 1e-6
    ) {
      moved++;
    }
  }
  ok(compared > 10, `expected enough nodes to compare, got ${compared}`);
  eq(moved, 0, "after packing, every node keeps its position relative to its own centre");
}

// ---------------------------------------------------------------------------
suite("the primary centre's group still holds the top-left corner");

{
  // The group holding the marked centre is the one the eye lands on: it is
  // placed first, so nothing is above it or to its left.
  const { L, d } = opened(crowdedGraph(8, 8));
  const centres = [...L.centerIds].filter((id) => d.pos[id]);
  ok(centres.length >= 3, `expected several marked centres, got ${centres.length}`);

  const primary = L.centerClassId;
  ok(!!d.pos[primary], "the primary centre has a position");

  // Measured on the room each group reserves, not on where its nodes happen
  // to fall: a group's box grows upward as well as downward to hold its rings,
  // so its topmost node sits well inside the room it was given.
  const box = (root) => {
    const p = d.pos[root];
    let r = 0;
    for (const [id, g] of Object.entries(d.groupOf)) {
      if (g !== root || !d.pos[id]) continue;
      r = Math.max(r, Math.hypot(d.pos[id].x - p.x, d.pos[id].y - p.y));
    }
    return { minX: p.x - r, minY: p.y - r };
  };
  const mine = box(primary);
  let ahead = 0;
  for (const id of centres) {
    if (id === primary) continue;
    const b = box(id);
    if (b.minX < mine.minX - 1 || b.minY < mine.minY - 1) ahead++;
  }
  eq(ahead, 0, "no other group sits above or left of the primary centre's group");
}

// ---------------------------------------------------------------------------
suite("a group without rings takes no extra space");

{
  // Isolated single nodes carry no ring at all; a default radius would inflate
  // the grid for nothing.
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 20; i++) {
    nodes.push({ id: `n${i}`, name: `n${i}`, kind: "class", file: `/p/n${i}.py`, line: 1 });
  }
  nodes.push({ id: "a", name: "a", kind: "class", file: "/p/a.py", line: 1 });
  nodes.push({ id: "b", name: "b", kind: "class", file: "/p/b.py", line: 1 });
  edges.push({ from: "a", to: "b", kind: "uses" });
  const { L } = opened({ nodes, edges });
  const xs = [];
  const ys = [];
  L.cy.nodes().forEach((n) => {
    if (n.style("display") === "none") return;
    const p = n.position();
    xs.push(p.x);
    ys.push(p.y);
  });
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  ok(extent < 3000, `20 isolated nodes plus a pair span ${Math.round(extent)}px, which should not be inflated by empty rings`);
}

// ---------------------------------------------------------------------------
// The same property on real graphs. FastAPI and TinyDB pass it by having too
// few groups to pack tightly — recorded so their green is not read as
// evidence.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");

  for (const name of ["tinydb", "fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`${name} groups do not overlap`);
    const { d, L } = opened(JSON.parse(fs.readFileSync(file, "utf8")));
    eq(enclosedNodes(d), 0, "no node falls inside another group's rings");
    eq(crossingRings(d), 0, "no two groups' rings intersect");

  }
}

module.exports = {};
