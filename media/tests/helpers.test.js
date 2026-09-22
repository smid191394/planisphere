"use strict";

// Where a class goes when everything it is joined to is a function.
//
// One shape per cause, because there are three and a single test would pass on
// a partial fix. FastAPI places all seven of its helpers correctly today, so
// the fixture the project looks at most cannot tell whether any of this worked.
//
// What each asserts is what a reader sees — the class is within a satellite's
// reach of a function it is related to — and not that a `satelliteOwner` was
// recorded. That is recorded today for classes sitting 1,824px away.

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

/** A tree with a centre, so there is a wrong answer available to land on. */
function withTree(extraNodes, extraEdges) {
  const nodes = [N("root.py", "Root")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(N(`c${i}.py`, `C${i}`));
    edges.push({ from: id("root.py", "Root"), to: id(`c${i}.py`, `C${i}`), kind: "uses" });
  }
  return { nodes: nodes.concat(extraNodes), edges: edges.concat(extraEdges) };
}

/** The centre a stray lands on when the placement gives up: SAT_RADIUS away. */
function atCentre(g, L, nodeId) {
  const d = gap(L, nodeId, id("root.py", "Root"));
  return Math.abs(d - g.SAT_RADIUS) < 1;
}

// Each synthetic shape below holds exactly one helper, so nothing contends for
// the seat and the class really should land beside its function. How far a
// *contended* seat ends up is a different defect — see the fixture block at the
// bottom, which only requires that it does not get worse.

// ---------------------------------------------------------------------------
suite("class uses function: the edge points outward");

{
  // `IsoCalendarDate` uses `weekday`. The edge points away from the class, so a
  // collector that read only edges pointing in would never find it.
  const g = opened(
    withTree(
      [N("iso.py", "Iso"), N("wd.py", "weekday", "function")],
      [
        { from: id("c3.py", "C3"), to: id("wd.py", "weekday", "function"), kind: "uses" },
        { from: id("iso.py", "Iso"), to: id("wd.py", "weekday", "function"), kind: "uses" },
      ]
    )
  );
  const L = g.live;
  const d = gap(L, id("iso.py", "Iso"), id("wd.py", "weekday", "function"));
  ok(
    d < g.RING_RADIUS,
    `Iso should be beside weekday, got ${Math.round(d)}px`
  );
  ok(!atCentre(g, L, id("iso.py", "Iso")), "should not land on the primary centre's satellite ring");
}

// ---------------------------------------------------------------------------
suite("a references-only relation counts too");

{
  // `_ThemeSyntax` is named by `_theme_style` in an annotation. `uses` versus
  // `references` says how the analyzer classified the mention; it says nothing
  // about whether the two belong near each other.
  const g = opened(
    withTree(
      [N("theme.py", "ThemeSyntax"), N("style.py", "themeStyle", "function")],
      [
        { from: id("c1.py", "C1"), to: id("style.py", "themeStyle", "function"), kind: "uses" },
        { from: id("style.py", "themeStyle", "function"), to: id("theme.py", "ThemeSyntax"), kind: "references" },
      ]
    )
  );
  const L = g.live;
  const d = gap(L, id("theme.py", "ThemeSyntax"), id("style.py", "themeStyle", "function"));
  ok(
    d < g.RING_RADIUS,
    `ThemeSyntax should be beside themeStyle, got ${Math.round(d)}px`
  );
  ok(!atCentre(g, L, id("theme.py", "ThemeSyntax")), "should not land on the primary centre's satellite ring");
}

// ---------------------------------------------------------------------------
suite("the function's owner is the class being placed");

{
  // `check`'s nearest class is `_error`, and `_error` is waiting for `check`.
  // Measuring the seat from the function's owner would make that a deadlock.
  const g = opened(
    withTree(
      [N("err.py", "Err"), N("chk.py", "check", "function")],
      [
        { from: id("chk.py", "check", "function"), to: id("err.py", "Err"), kind: "uses" },
        { from: id("chk.py", "check", "function"), to: id("root.py", "Root"), kind: "uses" },
      ]
    )
  );
  const L = g.live;
  const d = gap(L, id("err.py", "Err"), id("chk.py", "check", "function"));
  ok(
    d < g.RING_RADIUS,
    `Err should be beside check, got ${Math.round(d)}px`
  );
  ok(!atCentre(g, L, id("err.py", "Err")), "should not land on the primary centre's satellite ring");
}

// ---------------------------------------------------------------------------
suite("a function related to many classes still seats them around itself");

{
  // CPython's `filename` is related to 85 classes, so its owner is one of them
  // arbitrarily and has nothing to do with the class being seated.
  const extra = [N("busy.py", "busy", "function")];
  const edges = [{ from: id("busy.py", "busy", "function"), to: id("root.py", "Root"), kind: "uses" }];
  for (let i = 0; i < 10; i++) {
    extra.push(N(`u${i}.py`, `U${i}`));
    edges.push({ from: id(`u${i}.py`, `U${i}`), to: id("busy.py", "busy", "function"), kind: "uses" });
  }
  const g = opened(withTree(extra, edges));
  const L = g.live;
  let near = 0;
  for (let i = 0; i < 10; i++) {
    if (gap(L, id(`u${i}.py`, `U${i}`), id("busy.py", "busy", "function")) < g.RING_RADIUS) near++;
  }
  eq(near, 10, "all ten should be beside busy");

  // And they must not land on top of one another.
  let stacked = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      if (gap(L, id(`u${i}.py`, `U${i}`), id(`u${j}.py`, `U${j}`)) < 1) stacked++;
    }
  }
  eq(stacked, 0, "no two should be stacked on one point");
}

// ---------------------------------------------------------------------------
suite("what cannot be placed goes to the isolated area, not the centre");

{
  // Its one function is joined to nothing else, so neither can be seated
  // against the structure. "Could not work out where this belongs" and "this
  // belongs at the middle" are different statements.
  const g = opened(
    withTree(
      [N("orphan.py", "Orphan"), N("lonefn.py", "lone", "function")],
      [{ from: id("lonefn.py", "lone", "function"), to: id("orphan.py", "Orphan"), kind: "uses" }]
    )
  );
  const L = g.live;
  ok(
    !atCentre(g, L, id("orphan.py", "Orphan")),
    "with no usable function it should not be hung on the primary centre"
  );
  const d = gap(L, id("orphan.py", "Orphan"), id("root.py", "Root"));
  ok(d > g.RING_RADIUS, `expected it away from the structure, got ${Math.round(d)}px from the primary centre`);
}

// ---------------------------------------------------------------------------
// The property, on real graphs. FastAPI places all
// seven of its helpers correctly today, so its green says nothing — Django and
// CPython are the evidence.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const pure = loadGraphJs();

  for (const name of ["fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`${name} helper classes`);

    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const nbrs = {};
    for (const e of graph.edges) {
      (nbrs[e.from] = nbrs[e.from] || []).push(e.to);
      (nbrs[e.to] = nbrs[e.to] || []).push(e.from);
    }

    const ids = new Set(graph.nodes.map((n) => n.id));
    const centre = pure.pickTopClass(graph);
    const out = pure.computeClassRingPositions(graph, centre, ids);

    const helpers = graph.nodes.filter((n) =>
      pure.isFnOnlyHelperClass(n.id, graph, byId)
    );
    ok(helpers.length > 0, `expected helper classes to test, got ${helpers.length}`);

    // The property: none is parked at a satellite's distance from a group
    // centre it has no relationship with. That is the shape the failure takes:
    // a ring of classes at exactly SAT_RADIUS from the primary centre.
    const centres = new Set(Object.values(out.groupOf));
    let parked = 0;
    for (const n of helpers) {
      const p = out.positions[n.id];
      if (!p) continue;
      const related = new Set(nbrs[n.id] || []);
      for (const c of centres) {
        if (related.has(c)) continue;
        const q = out.positions[c];
        if (!q) continue;
        if (Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - pure.SAT_RADIUS) < 1) {
          parked++;
          break;
        }
      }
    }
    eq(parked, 0, "no helper is parked on the satellite ring of an unrelated group centre");

    // How far a seated class actually lands is a different matter and is not
    // asserted as a property — of CPython's 117 helpers only 37 are within a
    // ring step of the function they are seated against, because several
    // helpers of one function contend for the same seats. What is asserted here
    // is that the count does not get worse, so the property above cannot be
    // bought by making the drawing sloppier.
    const budget = { fastapi: 3, django: 27, cpython: 80 }[name];
    let far = 0;
    let worst = 0;
    for (const n of helpers) {
      const p = out.positions[n.id];
      if (!p) continue;
      let best = Infinity;
      for (const nb of nbrs[n.id] || []) {
        const q = out.positions[nb];
        if (q && byId[nb] && byId[nb].kind === "function") {
          best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
      if (best === Infinity) continue;
      worst = Math.max(worst, best);
      if (best > pure.RING_RADIUS) far++;
    }
    ok(
      far <= budget,
      `helpers more than one ring step from their function should not increase: ${far} > ${budget} (farthest ${Math.round(worst)}px)`
    );
  }
}

module.exports = {};
