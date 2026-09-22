"use strict";

// The rule that decides which classes are drawn as one node.
//
// Written against shapes rather than CPython on purpose. The cases that decide
// whether the rule is right — a class with no base, a chain of shared bases,
// two candidates of equal size — are ones no fixture can be relied on to
// contain, and a rule validated only where it happens to be exercised is a rule
// nobody has tested.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g = loadGraphJs();

/**
 * `defs` maps a class name to the bases each of its copies declares:
 *   { Reader: [["Base"], ["Base", "Own1"]] }  →  two classes named Reader
 * Base classes are declared by naming them; each becomes a class of its own.
 */
function classes(defs) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const add = (id, name) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, name, kind: "class", file: id + ".py", line: 1 });
  };
  for (const [name, copies] of Object.entries(defs)) {
    copies.forEach((bases, i) => {
      const id = `m${i}/${name}`;
      add(id, name);
      for (const b of bases) {
        add(b, b);
        edges.push({ from: id, to: b, kind: "inherits" });
      }
    });
  }
  return { nodes, edges };
}

const groupsIn = (graph) => g.groupSameNamedSiblings(graph);

/** Member counts per group name, for readable assertions. */
function shape(result) {
  return result.groups
    .map((gr) => `${gr.name}×${gr.members.length}`)
    .sort()
    .join(" ");
}

// ---------------------------------------------------------------------------
suite("classes group only when they share a name and a base");

{
  const r = groupsIn(classes({ Reader: [["Base"], ["Base"], ["Base"]] }));
  eq(shape(r), "Reader×3", "three classes with the same name and base form a group");
}

{
  // The CPython shape: one shared base plus a base of each one's own.
  const r = groupsIn(
    classes({ Reader: [["Base", "OwnA"], ["Base", "OwnB"], ["Base", "OwnC"]] })
  );
  eq(shape(r), "Reader×3", "different base sets still group if they share one");
}

{
  const r = groupsIn(classes({ Reader: [["Alpha"], ["Beta"]] }));
  eq(r.groups.length, 0, "same name but no shared base → no group");
}

{
  const r = groupsIn(classes({ Reader: [[], [], []] }));
  eq(r.groups.length, 0, "no bases at all → no group, however many share the name");
}

{
  const r = groupsIn(classes({ Reader: [["Base"]] }));
  eq(r.groups.length, 0, "a single member is not a group");
}

// ---------------------------------------------------------------------------
suite("grouping is not transitive");

// A shares a base with B, B shares a different base with C, A and C share
// nothing. A union-find over "shares any base" would draw all three as one
// node stating a relationship that is not there.
{
  const graph = {
    nodes: [
      { id: "A", name: "R", kind: "class", file: "a.py", line: 1 },
      { id: "B", name: "R", kind: "class", file: "b.py", line: 1 },
      { id: "C", name: "R", kind: "class", file: "c.py", line: 1 },
      { id: "X", name: "X", kind: "class", file: "x.py", line: 1 },
      { id: "Y", name: "Y", kind: "class", file: "y.py", line: 1 },
    ],
    edges: [
      { from: "A", to: "X", kind: "inherits" },
      { from: "B", to: "X", kind: "inherits" },
      { from: "B", to: "Y", kind: "inherits" },
      { from: "C", to: "Y", kind: "inherits" },
    ],
  };
  const r = groupsIn(graph);
  eq(r.groups.length, 1, "expected exactly one group");
  const members = r.groups[0].members.slice().sort().join(",");
  eq(members, "A,B", "the largest candidate is (R, X) → A and B; C stays out");
  eq(r.groupOf.C, undefined, "C shares nothing with A and should not be pulled in");
}

// ---------------------------------------------------------------------------
suite("each class belongs to only one group");

{
  // (R, Big) has three members, (R, Small) has two; the class in both goes to
  // the larger, and the smaller is left with one member and is not a group.
  const graph = {
    nodes: ["A", "B", "C", "D"].map((id) => ({
      id, name: "R", kind: "class", file: id + ".py", line: 1,
    })).concat([
      { id: "Big", name: "Big", kind: "class", file: "big.py", line: 1 },
      { id: "Small", name: "Small", kind: "class", file: "small.py", line: 1 },
    ]),
    edges: [
      { from: "A", to: "Big", kind: "inherits" },
      { from: "B", to: "Big", kind: "inherits" },
      { from: "C", to: "Big", kind: "inherits" },
      { from: "C", to: "Small", kind: "inherits" },
      { from: "D", to: "Small", kind: "inherits" },
    ],
  };
  const r = groupsIn(graph);
  eq(r.groups.length, 1, "a candidate left with one member does not form a group");
  eq(r.groups[0].members.slice().sort().join(","), "A,B,C", "C goes to the larger group");
  eq(r.groupOf.D, undefined, "D is left alone");
}

// ---------------------------------------------------------------------------
suite("files do not group");

{
  // Functions fold on a shared neighbour — that rule and its shapes live in
  // fnfold.test.js. A file does not: a file node stands for a place in the
  // source rather than for a repeated pattern, and its edges are whatever its
  // module happens to contain.
  const graph = {
    nodes: [
      { id: "p1", name: "fmt.py", kind: "file", file: "x/fmt.py", line: 1 },
      { id: "p2", name: "fmt.py", kind: "file", file: "y/fmt.py", line: 1 },
      { id: "B", name: "B", kind: "class", file: "b0.py", line: 1 },
    ],
    edges: [
      { from: "p1", to: "B", kind: "uses" },
      { from: "p2", to: "B", kind: "uses" },
    ],
  };
  const r = groupsIn(graph);
  eq(r.groups.length, 0, "files with the same name and a shared neighbour still do not group");
}

// ---------------------------------------------------------------------------
suite("grouping is a pure function of the artifact");

{
  // Two candidates of exactly equal size. Ranking by size alone leaves the
  // order to whatever the map iterated first; the key is what settles it, and
  // a test where the sizes always differ would never notice it was missing.
  const graph = {
    nodes: ["A", "B", "C", "D"].map((id) => ({
      id, name: "R", kind: "class", file: id + ".py", line: 1,
    })).concat(["P", "Q"].map((id) => ({
      id, name: id, kind: "class", file: id + ".py", line: 1,
    }))),
    edges: [
      { from: "A", to: "P", kind: "inherits" },
      { from: "B", to: "P", kind: "inherits" },
      { from: "B", to: "Q", kind: "inherits" },
      { from: "C", to: "Q", kind: "inherits" },
      { from: "C", to: "P", kind: "inherits" },
      { from: "D", to: "Q", kind: "inherits" },
    ],
  };
  const first = JSON.stringify(groupsIn(graph));
  // Same graph, nodes and edges in a different order: the answer must not move.
  const shuffled = {
    nodes: graph.nodes.slice().reverse(),
    edges: graph.edges.slice().reverse(),
  };
  ok(
    JSON.stringify(groupsIn(graph)) === first,
    "running the same graph twice gives the same result"
  );
  const other = groupsIn(shuffled);
  const sameMembership = graph.nodes.every(
    (n) => groupsIn(graph).groupOf[n.id] === other.groupOf[n.id]
  );
  ok(sameMembership, "with node and edge order changed, each class still lands in the same group");
}

{
  const dup = {
    nodes: [
      { id: "A", name: "R", kind: "class", file: "a.py", line: 1 },
      { id: "B", name: "R", kind: "class", file: "b.py", line: 1 },
      { id: "P", name: "P", kind: "class", file: "p.py", line: 1 },
    ],
    edges: [
      { from: "A", to: "P", kind: "inherits" },
      { from: "A", to: "P", kind: "inherits" },
      { from: "B", to: "P", kind: "inherits" },
    ],
  };
  const r = groupsIn(dup);
  eq(r.groups.length, 1, "a duplicate inherits edge should not count a member twice");
  eq(r.groups[0].members.length, 2, "member count is 2");
}

// ---------------------------------------------------------------------------
suite("group ids never collide with symbol ids");

{
  const r = groupsIn(classes({ Reader: [["Base"], ["Base"]] }));
  const ids = new Set(classes({ Reader: [["Base"], ["Base"]] }).nodes.map((n) => n.id));
  for (const gr of r.groups) {
    ok(!ids.has(gr.id), `group id ${gr.id} should not equal any node id`);
    ok(g.isGroupId(gr.id), "a group id is recognised as a group");
  }
  ok(!g.isGroupId("a/b.py::class::X"), "an ordinary node id is not mistaken for a group");
}

module.exports = {};
