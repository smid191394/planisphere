"use strict";

// Folding functions, by the rule that already folds classes.
//
// A class is folded with those that share its name and one of its bases. A
// function has no base, so that rule says nothing about it — but it has edges,
// and one of them says the same thing: CPython's 121 `getregentry`, one per
// encoding module, all return a `CodecInfo`.
//
// Two things here are easy to get wrong and neither shows on a fixture. The
// neighbour must be read *after* the classes are folded, or the 121 point at
// 121 different classes and nothing groups. And the node standing for a group
// of functions must be a function — a group that claimed to be a class would
// sit in the class ring and survive the toggle that hides functions.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const F = (id, name) => ({ id, name, kind: "function", file: id + ".py", line: 1 });
const C = (id, name) => ({ id, name, kind: "class", file: id + ".py", line: 1 });
const FILE = (id, name) => ({ id, name, kind: "file", file: id + "/" + name, line: 1 });
const E = (from, to, kind) => ({ from, to, kind: kind || "uses" });

/** Member counts per group name, in the same shape grouping.test.js uses. */
function shape(result) {
  return result.groups
    .map((gr) => `${gr.name}×${gr.members.length}`)
    .sort()
    .join(" ");
}

// ---------------------------------------------------------------------------
suite("functions with the same name and a shared neighbour group");

{
  const graph = {
    nodes: [C("Info", "Info"), F("a", "entry"), F("b", "entry"), F("c", "entry")],
    edges: [E("a", "Info"), E("b", "Info"), E("c", "Info")],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "entry×3", "three functions with the same name and neighbour form a group");
}

{
  // The edge may point either way. `getregentry` returns a `CodecInfo` and
  // `main` calls `getopt`; both are "this function is about that node", and
  // nothing in the graph makes one of them repetition and the other not.
  const graph = {
    nodes: [C("Info", "Info"), F("a", "entry"), F("b", "entry")],
    edges: [E("Info", "a"), E("Info", "b")],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "entry×2", "they group the same with the edges reversed");
}

// ---------------------------------------------------------------------------
suite("a shared name alone does not group");

{
  const graph = {
    nodes: [C("P", "P"), C("Q", "Q"), F("a", "run"), F("b", "run")],
    edges: [E("a", "P"), E("b", "Q")],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "", "no shared neighbour means no group");
}

// ---------------------------------------------------------------------------
suite("functions without edges never group");

{
  // The counterpart of "a class with no base is never grouped": nothing to
  // agree on, however many share the name.
  const graph = {
    nodes: [F("a", "run"), F("b", "run"), F("c", "run"), C("K", "K")],
    edges: [],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "", "none of the three has an edge, so no group");
}

// ---------------------------------------------------------------------------
suite("classes fold first, so functions can see their shared neighbour");

{
  // The shape the whole ordering exists for. Each `entry` points at its own
  // module's `Reader`, and the three `Reader`s are themselves a group. Read
  // before folding, that is three different neighbours and no group at all.
  const graph = {
    nodes: [
      C("Base", "Base"),
      C("m0/Reader", "Reader"),
      C("m1/Reader", "Reader"),
      C("m2/Reader", "Reader"),
      F("m0/entry", "entry"),
      F("m1/entry", "entry"),
      F("m2/entry", "entry"),
    ],
    edges: [
      E("m0/Reader", "Base", "inherits"),
      E("m1/Reader", "Base", "inherits"),
      E("m2/Reader", "Base", "inherits"),
      E("m0/entry", "m0/Reader"),
      E("m1/entry", "m1/Reader"),
      E("m2/entry", "m2/Reader"),
    ],
  };
  eq(
    shape(pure.groupSameNamedSiblings(graph)),
    "Reader×3 entry×3",
    "the three entry functions each point to their own module's Reader, which is one node after folding"
  );
}

// ---------------------------------------------------------------------------
suite("function grouping is not transitive either");

{
  // Four `main`, two around `getopt` and two around `Turtle`. One group of
  // four would be the same error the class rule already refuses.
  const graph = {
    nodes: [
      C("getopt", "getopt"),
      C("Turtle", "Turtle"),
      F("a", "main"),
      F("b", "main"),
      F("c", "main"),
      F("d", "main"),
    ],
    edges: [E("a", "getopt"), E("b", "getopt"), E("c", "Turtle"), E("d", "Turtle")],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "main×2 main×2", "the two pairs group separately and do not merge into four");

  // And each function is in exactly one of them.
  const r = pure.groupSameNamedSiblings(graph);
  const seen = new Set();
  let twice = 0;
  for (const gr of r.groups) for (const m of gr.members) {
    if (seen.has(m)) twice++;
    seen.add(m);
  }
  eq(twice, 0, "no function belongs to two groups");
}

// ---------------------------------------------------------------------------
suite("files still do not group");

{
  const graph = {
    nodes: [C("B", "B"), FILE("x", "fmt.py"), FILE("y", "fmt.py")],
    edges: [E("x", "B"), E("y", "B")],
  };
  eq(shape(pure.groupSameNamedSiblings(graph)), "", "files with the same name do not group even with a shared neighbour");
}

// ---------------------------------------------------------------------------
suite("a function group is a function");

{
  // The kind decides three things at once: the colour, whether the node is a
  // tree vertex or a satellite, and whether hiding functions hides it.
  const graph = {
    nodes: [C("Root", "Root"), C("Info", "Info"), F("a", "entry"), F("b", "entry")],
    edges: [E("Root", "Info"), E("a", "Info"), E("b", "Info")],
  };
  const W = pure.live.withGroups(graph);
  const node = W.graph.nodes.find((n) => pure.isGroupId(n.id));
  ok(!!node, "a group node was built");
  eq(node ? node.kind : "(no group node)", "function", "the group node's kind matches its members");
  ok(!!node && !pure.isTreeVertex(W.graph, node), "so it is not a tree vertex and takes no seat on a class ring");
}

{
  // End to end: the toggle that hides functions must hide it too.
  const graph = {
    nodes: [C("Root", "Root"), C("Info", "Info"), F("a", "entry"), F("b", "entry")],
    edges: [E("Root", "Info"), E("a", "Info"), E("b", "Info")],
  };
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  const L = g.live;
  const shown = () => {
    const ids = [];
    L.cy.nodes().forEach((n) => {
      if (n.style("display") !== "none") ids.push(n.id());
    });
    return ids;
  };
  const hidden = shown().filter((id) => pure.isGroupId(id));
  eq(hidden.length, 0, "with functions hidden by default, function groups should be hidden too");
  g.el("toggle-fns").dispatch("click");
  const withFns = shown().filter((id) => pure.isGroupId(id));
  eq(withFns.length, 1, "it appears only once functions are shown");
}

// ---------------------------------------------------------------------------
suite("class grouping is entirely unchanged");

{
  // Every measurement in this project is anchored on the class groups. The
  // function pass must not touch them.
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
  const classToday = {
    tinydb: "",
    fastapi: "",
    django: 21,
    cpython: 9,
  };
  const cpythonBiggest =
    "StreamReader×121 StreamWriter×121 IncrementalEncoder×120 Codec×110 IncrementalDecoder×107";

  for (const name of ["tinydb", "fastapi", "django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const r = pure.groupSameNamedSiblings(graph);
    const classGroups = r.groups.filter((gr) => byId[gr.members[0]].kind === "class");
    const fnGroups = r.groups.filter((gr) => byId[gr.members[0]].kind === "function");
    const expected = classToday[name];
    if (typeof expected === "number") {
      eq(classGroups.length, expected, `${name} class group count should not change`);
    } else {
      eq(classGroups.length, 0, `${name} has no class groups to begin with`);
    }
    if (name === "cpython") {
      const top = classGroups
        .slice()
        .sort((a, b) => b.members.length - a.members.length)
        .slice(0, 5)
        .map((gr) => `${gr.name}×${gr.members.length}`)
        .join(" ");
      eq(top, cpythonBiggest, "cpython's five largest class groups should not change");
    }
    // And the function groups arrive.
    const fnToday = { tinydb: 0, fastapi: 0, django: 6, cpython: 23 }[name];
    eq(fnGroups.length, fnToday, `${name} function group count`);
  }
}

module.exports = {};
