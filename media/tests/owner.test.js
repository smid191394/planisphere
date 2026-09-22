"use strict";

// What decides a node's group.
//
// A node that is not a tree vertex — a function satellite, a helper class — is
// placed against an owner. Its group is that owner's group, followed up the
// chain until one has a group of its own. It is not the group of whichever
// grouped node happens to be nearest.
//
// The two rules agree almost everywhere, which is why the geometric one looks
// right: a satellite sits within SAT_RADIUS of its owner and the
// gap between components is larger than that. They stop agreeing where the
// drawing is crowded — and crowded is not something a hand-written shape gets
// to be. Every synthetic drawing tried here agrees under both rules, so the
// assertion that tells them apart is the one against a real artifact, and it
// does not run on a checkout without the generated fixtures.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g = loadGraphJs();

const F = (id) => ({ id, name: id, kind: "function", file: "/p/" + id + ".py", line: 1 });
const C = (id) => ({ id, name: id, kind: "class", file: "/p/" + id + ".py", line: 1 });
const E = (from, to) => ({ from, to, kind: "uses" });

// ---------------------------------------------------------------------------
suite("a chain of satellites still belongs to the tree at its end");

{
  // f1 hangs off a class; f2 hangs off f1, which has no group of its own at
  // the moment it is asked. Walking the chain is what makes that resolve in
  // one pass, whatever order the nodes come in.
  const nodes = [C("Root")];
  const edges = [];
  for (let i = 0; i < 5; i++) {
    nodes.push(C("K" + i));
    edges.push(E("Root", "K" + i));
  }
  nodes.push(F("f1"), F("f2"), F("f3"));
  edges.push(E("K0", "f1"), E("f1", "f2"), E("f2", "f3"));
  const graph = { nodes, edges };
  const ids = new Set(nodes.map((n) => n.id));
  const r = g.computeClassRingPositions(graph, g.pickTopClass(graph), ids);

  eq(r.satelliteOwner.f2, "f1", "f2 hangs on f1, and f1 has no group of its own yet");
  eq(r.groupOf.f1, r.groupOf.K0, "f1 goes with K0");
  eq(r.groupOf.f2, r.groupOf.K0, "f2 goes with K0 too");
  eq(r.groupOf.f3, r.groupOf.K0, "so does the third level");
}

// ---------------------------------------------------------------------------
suite("a node connected to nothing stays on the grid with no group");

{
  const nodes = [C("Root"), C("Kid"), C("Alone"), F("lonely")];
  const edges = [E("Root", "Kid")];
  const graph = { nodes, edges };
  const ids = new Set(nodes.map((n) => n.id));
  const r = g.computeClassRingPositions(graph, g.pickTopClass(graph), ids);

  eq(r.groupOf.Alone, undefined, "an isolated class belongs to no group");
  eq(r.groupOf.lonely, undefined, "neither does an isolated function");
}

// ---------------------------------------------------------------------------
suite("every node with an owner is in its owner's group");

{
  // The rule itself, asserted over real artifacts. This is what tells the two
  // apart: on CPython the geometric rule breaks it six times, putting
  // `wsgiref/validate.py`'s checks in `xml/dom` and `re/_optimizer.py`'s
  // helpers on an island in `shutil`.
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const available = ["tinydb", "fastapi", "django", "cpython"]
    .map((name) => ({ name, file: path.join(FIXTURES, name, "planisphere.json") }))
    .filter((f) => fs.existsSync(f.file));

  if (!available.length) {
    console.log("(skipping — without a generated artifact this section has nothing to tell the two rules apart)");
  }

  for (const { name, file } of available) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const W = g.live.withGroups(raw);
    const ids = new Set(W.graph.nodes.filter((n) => !W.groupOf[n.id]).map((n) => n.id));
    const r = g.computeClassRingPositions(W.graph, g.pickTopClass(raw), ids, {});

    const byId = {};
    for (const n of W.graph.nodes) byId[n.id] = n;
    const wrong = [];
    for (const [id, owner] of Object.entries(r.satelliteOwner)) {
      if (!r.positions[id]) continue;
      // The owner may itself be a satellite; the group is the chain's.
      let at = owner;
      const seen = new Set([id]);
      while (at && !r.groupOf[at] && !seen.has(at)) {
        seen.add(at);
        at = r.satelliteOwner[at];
      }
      if (at && r.groupOf[at] && r.groupOf[id] !== r.groupOf[at]) {
        wrong.push(`${(byId[id] || {}).name || id} hangs on ${(byId[at] || {}).name || at}`);
      }
    }
    eq(
      wrong.length,
      0,
      `${name}: ${wrong.length} nodes are not in the group of the node they hang on — ${wrong.slice(0, 3).join(", ")}`
    );
  }
}

module.exports = {};
