"use strict";

// What a ring marks.
//
// A ring says "the tree's nth level is here", and a reader counts them to see
// how many hops a node sits from its centre. The property is therefore about
// agreement between two things the viewer produces — the radii it draws and the
// radii it placed nodes at — so it is checked against `ringGroups`, the list the
// renderer actually reads.

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

/** Every radius the viewer draws, across all groups. */
function drawnRadii(L) {
  return (L.ringGroups || []).flatMap((g) => g.radii);
}

/**
 * A class tree plus two things that put nodes at radii the tree never used:
 * satellites orbiting their classes, and a class whose only neighbours are
 * functions, which is placed away from the tree entirely.
 */
function treeWithStrays(depth, strays) {
  const nodes = [N("root.py", "Root")];
  const edges = [];
  let tip = "Root";
  let tipFile = "root.py";
  for (let d = 0; d < depth; d++) {
    nodes.push(N(`d${d}.py`, `D${d}`));
    edges.push({ from: id(tipFile, tip), to: id(`d${d}.py`, `D${d}`), kind: "uses" });
    // Two siblings per level, so the tree is a tree and not a chain.
    nodes.push(N(`s${d}.py`, `S${d}`));
    edges.push({ from: id(tipFile, tip), to: id(`s${d}.py`, `S${d}`), kind: "uses" });
    // Satellites: these sit at SAT_RADIUS from their class, never on a level.
    for (let k = 0; k < 3; k++) {
      nodes.push(N(`f${d}_${k}.py`, `f${d}_${k}`, "function"));
      edges.push({
        from: id(`d${d}.py`, `D${d}`),
        to: id(`f${d}_${k}.py`, `f${d}_${k}`, "function"),
        kind: "uses",
      });
    }
    tip = `D${d}`;
    tipFile = `d${d}.py`;
  }
  // Classes reachable only through a function: placed off the tree.
  for (let i = 0; i < strays; i++) {
    nodes.push(N(`stray${i}.py`, `Stray${i}`));
    nodes.push(N(`mk${i}.py`, `make${i}`, "function"));
    edges.push({ from: id(`mk${i}.py`, `make${i}`, "function"), to: id(`stray${i}.py`, `Stray${i}`), kind: "uses" });
    edges.push({ from: id("root.py", "Root"), to: id(`mk${i}.py`, `make${i}`, "function"), kind: "uses" });
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
suite("rings mark the levels of the tree");

{
  const g = opened(treeWithStrays(6, 8));
  const L = g.live;

  // Radii the tree actually used, read from where it placed tree vertices that
  // it — and only it — positioned. The centre of each group is at radius 0.
  const treeRadii = new Set();
  for (const group of L.ringGroups || []) {
    for (const [nodeId, root] of Object.entries(L.nodeGroups)) {
      const node = L.cy.getElementById(nodeId);
      if (node.empty() || node.style("display") === "none") continue;
      if (node.hasClass("satellite")) continue;
      const o = L.cy.getElementById(root);
      if (o.empty()) continue;
      const p = node.position();
      const q = o.position();
      if (Math.abs(q.x - group.cx) > 1e-6 || Math.abs(q.y - group.cy) > 1e-6) continue;
      const r = Math.hypot(p.x - q.x, p.y - q.y);
      if (r > 1) treeRadii.add(Math.round(r));
    }
  }

  const before = drawnRadii(L).length;
  ok(before > 0, "the default view draws rings");

  g.el("toggle-fns").dispatch("click");
  const shown = drawnRadii(L);

  // The tree's levels do not change when functions appear — the tree is built
  // from classes. So the rings must not either.
  eq(shown.length, before, `showing functions should not add rings: ${before} → ${shown.length}`);
}

// ---------------------------------------------------------------------------
suite("nodes not placed by the tree get no ring");

{
  const g = opened(treeWithStrays(5, 10));
  const L = g.live;
  g.el("toggle-fns").dispatch("click");

  // Every drawn radius should be one a tree vertex the tree placed sits at.
  // A satellite's distance from its group centre must not appear.
  const satRadii = new Set();
  for (const [nodeId, root] of Object.entries(L.nodeGroups)) {
    const node = L.cy.getElementById(nodeId);
    if (node.empty() || node.style("display") === "none") continue;
    if (!node.hasClass("satellite")) continue;
    const o = L.cy.getElementById(root);
    if (o.empty()) continue;
    const p = node.position();
    const q = o.position();
    satRadii.add(Math.round(Math.hypot(p.x - q.x, p.y - q.y)));
  }

  const drawn = drawnRadii(L).map((r) => Math.round(r));
  const treeSteps = new Set();
  for (const r of drawn) treeSteps.add(r);

  let fromSatellite = 0;
  for (const r of drawn) {
    // A satellite radius that no tree vertex also sits at.
    if (satRadii.has(r) && !isTreeStep(r, g)) fromSatellite++;
  }
  eq(fromSatellite, 0, `a satellite distance should not become a ring, got ${fromSatellite}`);
  ok(treeSteps.size > 0, "there are still rings");
}

/** A radius on the tree's grid: a whole number of steps, allowing decay. */
function isTreeStep(r, g) {
  const step = g.RING_RADIUS;
  for (let k = 1; k <= 40; k++) {
    if (Math.abs(r - k * step) < 2) return true;
  }
  return r < step;
}

// ---------------------------------------------------------------------------
suite("rings do not extend past the tree");

{
  const g = opened(treeWithStrays(5, 12));
  const L = g.live;
  g.el("toggle-fns").dispatch("click");

  const drawn = drawnRadii(L);
  const outer = Math.max(0, ...drawn);

  // The deepest tree vertex, measured from its own group's centre.
  let deepest = 0;
  for (const [nodeId, root] of Object.entries(L.nodeGroups)) {
    const node = L.cy.getElementById(nodeId);
    if (node.empty() || node.style("display") === "none") continue;
    if (node.hasClass("satellite")) continue;
    const o = L.cy.getElementById(root);
    if (o.empty()) continue;
    const p = node.position();
    const q = o.position();
    deepest = Math.max(deepest, Math.hypot(p.x - q.x, p.y - q.y));
  }

  ok(
    outer <= deepest + 1,
    `the outermost ring ${Math.round(outer)} should not exceed the deepest tree node ${Math.round(deepest)}`
  );
}

module.exports = {};
