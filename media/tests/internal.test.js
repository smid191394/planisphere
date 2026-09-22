"use strict";

// Who decides what a codebase keeps to itself.
//
// The criterion drops a candidate whose name the codebase marks as private, and
// a leading underscore is only Python's mark. Go's is the
// case of the first letter — 40% of hugo's types and 45% of prometheus's are
// unexported and none carries an underscore — and reading Go's rule onto the
// others would rule out 85% of Django's functions and 95% of Angular's. So the
// analyzer says it, and the viewer falls back to the name only where no node
// says anything.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const T = (name, opts) => ({
  id: `/p/${name}.go::struct::${name}`,
  kind: "struct",
  name,
  file: `/p/${name}.go`,
  line: 1,
  endLine: (opts && opts.size) || 40,
  ...(opts && opts.internal ? { internal: true } : {}),
});
const E = (a, b) => ({ from: `/p/${a}.go::struct::${a}`, to: `/p/${b}.go::struct::${b}`, kind: "uses" });
const nameOf = (graph, id) => (graph.nodes.find((n) => n.id === id) || {}).name;

/**
 * A hub that would win on nearness and size, and a runner-up that would not.
 * `hub` is named by the caller so the same shape can be built with a name the
 * viewer reads as private, or with none.
 */
function star(hubName, opts) {
  const leaves = ["Leaf1", "Leaf2", "Leaf3", "Leaf4", "Leaf5", "Leaf6"];
  return {
    nodes: [
      T(hubName, { size: 200, internal: opts && opts.internal }),
      T("Engine", { size: 120 }),
      ...leaves.map((l) => T(l, { size: 10 })),
    ],
    edges: [
      ...leaves.map((l) => E(hubName, l)),
      E("Engine", "Leaf1"),
      E("Engine", "Leaf2"),
      E("Engine", hubName),
    ],
  };
}

// ---------------------------------------------------------------------------
suite("a node the artifact marks internal is never the centre");

{
  const graph = star("scrapeLoop", { internal: true });
  eq(nameOf(graph, pure.pickTopClass(graph)), "Engine", "a node marked internal should not be the centre");
  // Excluded means seated last, not struck off. That is what the other two
  // rules do: in this same shape `_Pipeline` and `ParseError` each rank
  // eighth of eight. What the rule owes is that nothing eligible sits below it.
  const ranked = pure.rankCentres(graph).map((id) => nameOf(graph, id));
  eq(ranked[ranked.length - 1], "scrapeLoop", `expected the internal node to rank last, got ${ranked.join(", ")}`);
}

// ---------------------------------------------------------------------------
suite("when the artifact says nothing, the name rule still applies");

{
  // The same shape, the same lower-case name, and nothing marked. A viewer that
  // read Go's convention onto every drawing would rule this out; it is not the
  // viewer's to read.
  const graph = star("scrapeLoop");
  eq(nameOf(graph, pure.pickTopClass(graph)), "scrapeLoop", "a lowercase name is still eligible");
}

{
  const graph = star("_Pipeline");
  eq(nameOf(graph, pure.pickTopClass(graph)), "Engine", "a leading underscore still rules a name out");
}

// ---------------------------------------------------------------------------
suite("the flag affects the centre and nothing else");

{
  const graph = star("scrapeLoop", { internal: true });
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  const drawn = g.live.cy.nodes().map((n) => n.id());
  ok(
    drawn.includes("/p/scrapeLoop.go::struct::scrapeLoop"),
    "an internal node is still drawn, it just cannot be the centre"
  );
}

module.exports = {};
