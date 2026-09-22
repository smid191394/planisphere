"use strict";

// What the right button shows: a node, what it points to, and what those
// point to — two steps out along edges in their own direction, and no further.
//
// The definition: the nodes it points out to, and the nodes those point out
// to. Two examples hold under it. `A` inherits
// `B` inherits `C` inherits `D`: the right button on `B` shows `B C D`. `A`
// uses `B` uses `C`, and `D` uses `A`: the right button on `A` shows `A B C`,
// `D` pointing in and so never followed.
//
// Written against the set alone, before any layout: the set is a property of
// the artifact, and a test that needed a drawing to say which nodes are in it
// would be testing the drawing.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g = loadGraphJs();

function graphOf(kindOf, edges) {
  return {
    nodes: Object.keys(kindOf).map((id) => ({
      id,
      name: id,
      kind: kindOf[id],
      file: "m.py",
      line: 1,
    })),
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind || "uses" })),
  };
}

/** The set, sorted, as a string an assertion can compare. */
const out = (graph, from) => [...g.outwardFrom(graph, [].concat(from))].sort().join(",");

const C = "class";

suite("right button: what it points to, and what those point to");

{
  const lineage = graphOf({ A: C, B: C, C: C, D: C }, [
    ["A", "B", "inherits"],
    ["B", "C", "inherits"],
    ["C", "D", "inherits"],
  ]);
  eq(out(lineage, "B"), "B,C,D", "A extends B extends C extends D — right-clicking B shows B C D");

  const uses = graphOf({ A: C, B: C, C: C, D: C }, [
    ["A", "B", "uses"],
    ["B", "C", "uses"],
    ["D", "A", "uses"],
  ]);
  eq(out(uses, "A"), "A,B,C", "A uses B, B uses C, D uses A — right-clicking A shows A B C, not D which points to it");
}

{
  // Two steps and no further.
  const chain = graphOf({ T: C, A: C, B: C, Z: C }, [
    ["T", "A"],
    ["A", "B"],
    ["B", "Z"],
  ]);
  eq(out(chain, "T"), "A,B,T", "A at the first step, B at the second; not Z at the third");
}

{
  // Counted at the nearest distance. C is three steps out along one path and
  // two along another, which makes it two.
  const near = graphOf({ T: C, A: C, B: C, C: C }, [
    ["T", "A"],
    ["A", "B"],
    ["T", "B"],
    ["B", "C"],
  ]);
  eq(out(near, "T"), "A,B,C,T", "a node counts at its nearest step: C is two steps away via T→B→C");
}

{
  const kinds = graphOf({ A: C, B: C, U: C, R: C }, [
    ["A", "B", "inherits"],
    ["A", "U", "uses"],
    ["A", "R", "references"],
  ]);
  eq(out(kinds, "A"), "A,B,R,U", "all three edge kinds count as outward");
}

{
  const cycle = graphOf({ A: C, B: C }, [
    ["A", "B"],
    ["B", "A"],
  ]);
  eq(g.outwardFrom(cycle, ["A"]).size, 2, "nodes pointing at each other still terminate, each counted once");
}

{
  // A group stands for several members; its set is all of theirs.
  const two = graphOf({ A: C, B: C, X: C, Y: C }, [
    ["A", "X"],
    ["B", "Y"],
  ]);
  eq(out(two, ["A", "B"]), "A,B,X,Y", "starting from several nodes gives the union");
}

suite("a function is a step too");

{
  // Read off the artifact, not off what is drawn, so the set does not change
  // when the reader toggles functions — and a hidden function is a step like
  // any other.
  const through = graphOf({ T: C, f: "function", B: C, Z: C }, [
    ["T", "f"],
    ["f", "B"],
    ["B", "Z"],
  ]);
  eq(out(through, "T"), "B,T,f", "T reaches B through f in two steps; Z beyond it is a third step and is left out");
}

suite("on real projects, by this definition");

// Checked against a two-step walk written here from the definition, over a
// sample of real nodes: the set must be exactly the nodes within two steps.
function withinTwo(graph, start) {
  const outs = {};
  for (const e of graph.edges) (outs[e.from] = outs[e.from] || []).push(e.to);
  const seen = new Set([start]);
  let frontier = [start];
  for (let step = 0; step < 2; step++) {
    const next = [];
    for (const u of frontier) for (const v of outs[u] || []) if (!seen.has(v)) (seen.add(v), next.push(v));
    frontier = next;
  }
  return seen;
}

for (const [lang, name] of [
  ["python", "django"],
  ["typescript", "angular"],
]) {
  const file = path.join(__dirname, "..", "..", "fixtures", lang, name, "planisphere.json");
  if (!fs.existsSync(file)) {
    console.log(`(skipping ${name} in reach.test.js — no generated artifact)`);
    continue;
  }
  const graph = JSON.parse(fs.readFileSync(file, "utf8"));
  const types = graph.nodes.filter((n) => n.kind !== "function" && n.kind !== "file");
  let checked = 0;
  let differ = 0;
  for (let i = 0; i < types.length; i += Math.ceil(types.length / 60)) {
    const got = [...g.outwardFrom(graph, [types[i].id])].sort().join("\n");
    const want = [...withinTwo(graph, types[i].id)].sort().join("\n");
    if (got !== want) differ++;
    checked++;
  }
  eq(differ, 0, `${name}: of ${checked} sampled nodes, every set is exactly the nodes within two steps`);

  if (name === "angular") {
    // A case in point: FieldTree's own definition names five
    // types, and two steps is those five and what they name.
    const id = (n) => graph.nodes.find((x) => x.name === n).id;
    const ft = g.outwardFrom(graph, [id("FieldTree")]);
    for (const n of ["ReadonlyArrayLike", "CompatFieldState", "FieldStateByMode", "MaybeFieldTree", "Subfields"]) {
      ok(ft.has(id(n)), `angular: ${n}, which FieldTree points to, is at the first step`);
    }
    ok(ft.has(id("FieldState")), "angular: FieldState, which FieldStateByMode points to, is at the second step");
  }
}

module.exports = {};
