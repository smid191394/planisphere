"use strict";

// The same properties, on real artifacts.
//
// These are evidence, not the standard: the shape suite is what defines the
// layout, because it can be aimed at a rule and a project cannot. The fixtures
// are here to catch the case where a rule holds on every shape anyone thought
// to write and still falls over on a graph that actually exists.
//
// The artifacts are generated from external clones and are gitignored, so a
// checkout without them skips this file rather than failing. That is a real
// hole — a clean clone gets 54 assertions, not these — and the honest fix is
// to check in a small artifact, not to pretend the skip is a pass.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq, near, allVisible } = require("./harness.js");

const g = loadGraphJs();

const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");

const available = ["tinydb", "fastapi", "django", "cpython"]
  .map((name) => ({ name, file: path.join(FIXTURES, name, "planisphere.json") }))
  .filter((f) => fs.existsSync(f.file));

if (!available.length) {
  console.log("(skipping fixtures.test.js — no generated artifact)");
  module.exports = {};
  return;
}

for (const { name, file } of available) {
  const graph = JSON.parse(fs.readFileSync(file, "utf8"));

  // The viewer hides functions by default, and that is the view the layout is
  // tuned for, so it is the view to assert on.
  const visible = new Set(
    graph.nodes.filter((n) => n.kind !== "function").map((n) => n.id)
  );
  if (visible.size < 2) continue;

  const center = g.pickTopClass({ nodes: graph.nodes.filter((n) => visible.has(n.id)), edges: graph.edges });
  const out = g.computeClassRingPositions(graph, center, visible);

  suite(`${name} (${visible.size} visible nodes)`);

  // Everything visible gets a position. A node with no position is not drawn
  // at all, which is the one layout failure the viewer cannot show.
  const missing = [...visible].filter((id) => !out.positions[id]);
  eq(missing.length, 0, `every visible node should have a position, missing ${missing.slice(0, 5).join(", ")}`);

  // What the reader sees is rings, so rings are what to measure — not depth.
  //
  // Depth cannot be measured from outside: the layout does not use the
  // shortest-path tree, it re-parents through `pickClassParent` and
  // `balanceRootChildren`, so an independently computed depth disagrees with
  // the one the rings were placed at. Recomputing it in the test would mean
  // duplicating that logic and asserting against the duplicate.
  //
  // The distinct radii say the same thing and say it from the outside: a
  // drawing where every step is the same size is a drawing whose rings are set
  // by depth alone, and one where each ring is further from the last than the
  // one before is compounding.
  const origin = out.positions[center];
  const distinct = new Set();
  for (const id of visible) {
    if (!out.positions[id]) continue;
    if (out.groupOf[id] !== center && id !== center) continue;
    const r = Math.hypot(out.positions[id].x - origin.x, out.positions[id].y - origin.y);
    distinct.add(Math.round(r * 1000) / 1000);
  }
  const radii = [...distinct].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < radii.length; i++) maxGap = Math.max(maxGap, radii[i] - radii[i - 1]);
  ok(
    maxGap <= g.RING_RADIUS + 1e-6,
    `expected the gap between adjacent rings ${maxGap.toFixed(1)} ≤ one step ${g.RING_RADIUS}`
  );

  // And the extent follows from that: n rings cost n steps, not n multiplied.
  const maxRadius = radii[radii.length - 1];
  ok(
    maxRadius <= (radii.length - 1) * g.RING_RADIUS + 1e-6,
    `expected the extent of ${radii.length} rings ${maxRadius.toFixed(0)} ≤ ${(radii.length - 1) * g.RING_RADIUS}`
  );

  // Grouping, as evidence. The rule is defined by grouping.test.js; these
  // numbers are what it produces on graphs that exist, recorded so a change to
  // the rule has to say what it did to them rather than only that it passed.
  const grouped = g.groupSameNamedSiblings(graph);
  const memberCount = grouped.groups.reduce((a, gr) => a + gr.members.length, 0);
  // Split by kind. The class figures are the anchor every other measurement in
  // this project rests on, so a change that folds functions has to show it did
  // not disturb them; a single total would let one rise as the other fell.
  const nodeById = {};
  for (const n of graph.nodes) nodeById[n.id] = n;
  const kindOfGroup = (gr) => nodeById[gr.members[0]].kind;
  const classGroups = grouped.groups.filter((gr) => kindOfGroup(gr) === "class");
  const fnGroups = grouped.groups.filter((gr) => kindOfGroup(gr) === "function");
  const count = (list) => list.reduce((a, gr) => a + gr.members.length, 0);
  // A string is not a reference. If it were, CPython's `timeit.py` and
  // `turtledemo/chaos.py` would fold their `main`s together, because both
  // would appear to use `g` — and `timeit.py`'s use of it is
  // `f"{time_taken:.{precision}g} sec"`, a format specifier. A false edge is
  // not only a line across the drawing; it can merge two unrelated functions
  // into one node.
  //
  // Django's 23 `Migration` classes all write
  // `class Migration(migrations.Migration)`, and they group only because the
  // analyzer follows a re-export through a package's `__init__.py` to resolve
  // that base. Without a resolved base they would have nothing to agree on.
  // These numbers move when the graph does, not only when the rule does.
  const expected = {
    tinydb: { groups: 0, members: 0, fnGroups: 0, fnMembers: 0 },
    fastapi: { groups: 0, members: 0, fnGroups: 0, fnMembers: 0 },
    django: { groups: 21, members: 118, fnGroups: 6, fnMembers: 12 },
    cpython: { groups: 9, members: 599, fnGroups: 23, fnMembers: 193 },
  }[name];
  if (expected) {
    eq(classGroups.length, expected.groups, "class group count");
    eq(count(classGroups), expected.members, "class member count");
    eq(fnGroups.length, expected.fnGroups, "function group count");
    eq(count(fnGroups), expected.fnMembers, "function member count");
    eq(
      grouped.groups.length,
      expected.groups + expected.fnGroups,
      "there is no third kind of group"
    );
    eq(memberCount, expected.members + expected.fnMembers, "total member count");
  }
  // What the merge did to the graph, not just that it ran. Folding 121 classes
  // into one node could have made that node the busiest thing in the drawing
  // and rerooted the whole tree under it.
  //
  // The first of those is true and is not a defect: the busiest real node in
  // CPython is `StreamWriter` at 125, and the group of 121 `StreamReader`
  // classes reaches 133, which is what folding 121 classes does. The
  // rerooting is the half that matters and it is asserted below, where the
  // centre is taken from the artifact and never from this collapsed reading.
  {
    const collapsed = {
      nodes: [],
      edges: [],
    };
    const memberOf = {};
    for (const gr of grouped.groups)
      for (const m of gr.members) memberOf[m] = gr.id;
    const seenGroup = new Set();
    for (const n of graph.nodes) {
      const gid = memberOf[n.id];
      if (!gid) { collapsed.nodes.push(n); continue; }
      if (seenGroup.has(gid)) continue;
      seenGroup.add(gid);
      collapsed.nodes.push({ id: gid, name: n.name, kind: "class", file: "", line: 0 });
    }
    const STRENGTH = { references: 1, uses: 2, inherits: 3 };
    const merged = new Map();
    for (const e of graph.edges) {
      const from = memberOf[e.from] || e.from;
      const to = memberOf[e.to] || e.to;
      if (from === to) continue;
      const k = from + "\n" + to;
      const prev = merged.get(k);
      if (!prev || STRENGTH[e.kind] > STRENGTH[prev.kind])
        merged.set(k, { from, to, kind: e.kind });
    }
    collapsed.edges = [...merged.values()];

    const degBefore = {};
    for (const e of graph.edges) {
      degBefore[e.from] = (degBefore[e.from] || 0) + 1;
      degBefore[e.to] = (degBefore[e.to] || 0) + 1;
    }
    const degAfter = {};
    for (const e of collapsed.edges) {
      degAfter[e.from] = (degAfter[e.from] || 0) + 1;
      degAfter[e.to] = (degAfter[e.to] || 0) + 1;
    }
    // Merging can only merge: two edges onto two members of one group become
    // one edge onto the group, and nothing is ever invented.
    ok(
      collapsed.edges.length <= graph.edges.length,
      `merging should only remove edges: ${graph.edges.length} → ${collapsed.edges.length}`
    );

    // And a node that is in no group cannot gain by it. This is an invariant
    // rather than an observation: whatever a group's own degree becomes,
    // everything outside it either keeps its edges or has duplicates onto one
    // group folded away.
    let grew = 0;
    let worst = "";
    for (const n of graph.nodes) {
      if (memberOf[n.id]) continue;
      const before = degBefore[n.id] || 0;
      const after = degAfter[n.id] || 0;
      if (after > before) {
        grew++;
        worst = `${n.name} ${before} → ${after}`;
      }
    }
    eq(grew, 0, `nodes outside groups should not get busier from merging: ${worst}`);

    // The centre is chosen from the artifact, never from the collapsed
    // reading. A group carries the union of its members' edges — on Django the
    // 29 `Command` classes fold into one node — and a criterion that rewarded
    // that would reroot the drawing on 29 unrelated management commands, at a
    // node that cannot even be opened.
    const artifactCenter = g.pickTopClass(graph);
    ok(!!artifactCenter, "the artifact yields a centre");
    ok(!memberOf[artifactCenter], `${name}'s centre is not itself in any group`);
    if (name === "django") {
      // Nearness does not reward a fold — twenty-nine unrelated commands
      // standing as one node are no nearer anything than they are apart — so
      // on Django the two agree.
      //
      // Choosing from the artifact stays regardless: it is what keeps opening
      // a group from rerooting the drawing under the reader, which is a
      // promise about folding rather than about this criterion.
      eq(
        g.pickTopClass(collapsed),
        artifactCenter,
        "django picks the same centre before and after folding — folding does not raise closeness"
      );
    }
  }

  if (name === "django") {
    const top = classGroups
      .slice()
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 2)
      .map((gr) => `${gr.name}×${gr.members.length}`)
      .join(" ");
    eq(top, "Command×29 Migration×23", "the two largest class groups");
  }

  if (name === "cpython") {
    const top = classGroups
      .slice()
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 5)
      .map((gr) => `${gr.name}×${gr.members.length}`)
      .join(" ");
    eq(
      top,
      "StreamReader×121 StreamWriter×121 IncrementalEncoder×120 Codec×110 IncrementalDecoder×107",
      "the five largest class groups"
    );
    // The same encoding modules, from the other side: each defines a
    // `getregentry` returning a `CodecInfo`, 121 times over.
    const fnTop = fnGroups
      .slice()
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 3)
      .map((gr) => `${gr.name}×${gr.members.length}`)
      .join(" ");
    eq(fnTop, "getregentry×121 __getattr__×20 decode×8", "the three largest function groups");
  }

  // The labelling requirement, stated as one assertion on a graph that exists.
  // Django draws 85 nodes called formats.py and CPython eight called Error;
  // after labelling, no two nodes drawn at once may read the same.
  {
    const drawn = graph.nodes.filter(
      (n) => n.kind !== "function" && !grouped.groupOf[n.id]
    );
    for (const gr of grouped.groups) {
      drawn.push({
        id: gr.id,
        name: gr.name,
        kind: "class",
        file: "",
        line: 0,
        groupSize: gr.members.length,
      });
    }
    const nameById = {};
    for (const n of graph.nodes) nameById[n.id] = n.name;
    const labelled = g.labelsForDrawn(drawn, (id) => nameById[id]);
    const shown = drawn.map((n) => labelled[n.id]);
    const seen = new Map();
    const clashes = [];
    for (const l of shown) {
      seen.set(l, (seen.get(l) || 0) + 1);
      if (seen.get(l) === 2) clashes.push(l);
    }
    eq(clashes.length, 0, `no two labels should be the same, clashes: ${clashes.slice(0, 5).join(", ")}`);
    const gained = drawn.filter((n) => labelled[n.id] !== n.name && !n.groupSize);
    ok(
      gained.length < drawn.length * 0.25,
      `only a few labels should gain a path: ${gained.length} / ${drawn.length}`
    );
  }

  // Layout is a pure function of the artifact. A drawing that moves between
  // reopens cannot be compared with itself.
  const again = g.computeClassRingPositions(graph, center, visible);
  let moved = 0;
  for (const id of Object.keys(out.positions)) {
    const a = out.positions[id];
    const b = again.positions[id];
    if (!b || a.x !== b.x || a.y !== b.y) moved++;
  }
  eq(moved, 0, "laying out the same artifact twice gives identical results");
}

module.exports = {};
