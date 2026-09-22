"use strict";

// Units and everything else are drawn as two trees, joined by a click.
//
// A unit is a node that `contains` others — a Go package today — and the viewer
// knows one by that edge, or by sharing a kind with such a node. Never by the
// kind's name, so every suite runs twice: once as `package`, once as `module`.
//
// Drawn on the same rings, hugo's packages and types would collapse to four
// rings with 859 nodes on the second at 2.6px of arc each. Arranged apart,
// the types are 7 rings deep and the packages one group of
// their own.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const N = (id, kind) => ({ id, name: id, kind, file: `/p/${id}.go`, line: 1, endLine: 20 });
const E = (from, to, kind) => ({ from, to, kind: kind || "uses" });

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

const rightClick = (g, id) => g.live.cy.getElementById(id).emit("cxttap");
const press = (g, key) => g.sandbox.__listeners.keydown.forEach((fn) => fn({ key }));

/** Built edges, as `from>to`, with whether each is shown. */
function builtEdges(g) {
  const out = new Map();
  g.live.cy.edges().forEach((e) => out.set(`${e.data("source")}>${e.data("target")}`, e.style("display") !== "none"));
  return out;
}

for (const UNIT of ["package", "module"]) {
  const UNITS = ["P", "Q", "Empty"];
  const TYPES = ["A", "B", "C"];
  /**
   * P holds A, B and two functions; Q holds C. Empty holds nothing, but its
   * package-level code names A and it depends on P — a package whose files are
   * all `init` and `var`. P's code names Q's, and Q's package-level code names A.
   */
  const twoTrees = () => ({
    nodes: [
      N("P", UNIT), N("Q", UNIT), N("Empty", UNIT),
      N("A", "struct"), N("B", "struct"), N("C", "struct"),
      N("f", "function"), N("g", "function"),
    ],
    edges: [
      E("P", "A", "contains"), E("P", "B", "contains"), E("P", "f", "contains"), E("P", "g", "contains"),
      E("Q", "C", "contains"),
      E("P", "Q"), E("Empty", "P"), E("Empty", "A"), E("Q", "A", "references"),
      E("A", "C"), E("B", "A"), E("A", "g"),
    ],
  });
  const isUnit = (id) => UNITS.includes(id);

  // -------------------------------------------------------------------------
  suite(`units and everything else are separate trees (${UNIT})`);

  {
    const g = opened(twoTrees());
    const groups = g.live.nodeGroups;
    for (const u of UNITS) {
      const root = groups[u];
      ok(root !== undefined, `${u} is in some group`);
      const members = Object.keys(groups).filter((id) => groups[id] === root);
      ok(members.every(isUnit), `${u}'s group should hold only units, got ${members.join(",")}`);
    }
    eq(groups.Empty, groups.P, "Empty, with no members, is in the unit tree too, not the type tree");
    for (const t of TYPES) {
      const root = groups[t];
      const members = Object.keys(groups).filter((id) => groups[id] === root);
      ok(!members.some(isUnit), `${t}'s group should hold no units, got ${members.join(",")}`);
    }
  }

  // -------------------------------------------------------------------------
  suite(`in the full drawing, edges between the two trees are not built (${UNIT})`);

  {
    const graph = twoTrees();
    const g = opened(graph);
    const built = builtEdges(g);
    const drawnNodes = new Set();
    g.live.cy.nodes().forEach((n) => drawnNodes.add(n.id()));
    for (const e of graph.edges) {
      if (!drawnNodes.has(e.from) || !drawnNodes.has(e.to)) continue;
      const key = `${e.from}>${e.to}`;
      if (isUnit(e.from) !== isUnit(e.to)) ok(!built.has(key), `${key} (${e.kind}) crosses the two trees and should not be built`);
      else ok(built.has(key), `${key} (${e.kind}) is within one tree and should be built`);
    }
  }

  // -------------------------------------------------------------------------
  suite(`a click connects the two trees (${UNIT})`);

  {
    const g = opened(twoTrees());
    g.live.activateFocus("P");
    for (const t of ["A", "B"]) {
      ok(!g.live.cy.getElementById(t).hasClass("dimmed"), `clicking P lights up its member ${t}`);
    }
    g.live.activateFocus("C");
    ok(!g.live.cy.getElementById("Q").hasClass("dimmed"), "clicking C lights up its unit Q");
  }

  // -------------------------------------------------------------------------
  suite(`right-clicking a unit shows what it contains (${UNIT})`);

  {
    const g = opened(twoTrees());
    rightClick(g, "P");
    const inView = builtEdges(g);
    ok(inView.get("P>A") === true && inView.get("P>B") === true, "in the right-click view, the contains edges from P to A and B are drawn");
    // Drawn and also arranged by: a view that drew the lines but laid its set
    // out without them would leave A and B unconnected beside a fan of nothing.
    const groups = g.live.nodeGroups;
    ok(groups.A !== undefined && groups.A === groups.P, `in the right-click view A should hang in P's group, got ${groups.A} / ${groups.P}`);
    ok(groups.B !== undefined && groups.B === groups.P, `so should B, got ${groups.B} / ${groups.P}`);
    press(g, "Escape");
    const back = builtEdges(g);
    ok(back.get("P>A") !== true && back.get("P>B") !== true, "after leaving, the full drawing no longer shows the edges from P to A and B");
  }

  // -------------------------------------------------------------------------
  suite(`a function contained only by a unit is unconnected (${UNIT})`);

  {
    const g = opened(twoTrees());
    ok(g.live.lastLayout.positions.f, "f has a position");
    eq(g.live.nodeGroups.f, undefined, "f has only P's contains, so it has no layout edge and sits with the unconnected nodes");
    ok(g.live.nodeGroups.g !== undefined, "g is used by A, so it still orbits A");
  }
}

// ---------------------------------------------------------------------------
suite("in a graph without units every edge is built");

{
  const graph = {
    nodes: [N("A", "class"), N("B", "class"), N("C", "class")],
    edges: [E("A", "B", "inherits"), E("B", "C"), E("C", "A", "references")],
  };
  const g = opened(graph);
  const built = builtEdges(g);
  eq(built.size, 3, "all three edges are built");
  ok([...built.values()].every(Boolean), "all three are shown");
}

module.exports = {};
