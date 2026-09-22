"use strict";

// Where a node's colour comes from.
//
// Every colour is read inside the style rules, each time the stylesheet is
// built, and none is baked into an element. A colour read once as elements
// are built and written into each node's `data.color` and `data.rim` would
// stay put when its variable changed, while the centre and the edges, read in
// the rules, followed it — the same gesture, two outcomes, for no reason a
// reader could guess.
//
// This suite is also a guard on the colours themselves: where they are
// decided must not change what they are.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const N = (id, kind) => ({ id, name: id, kind, file: "/p/" + id + ".py", line: 1 });

/**
 * A centre with a class, a function and a file hanging off it.
 *
 * The centre carries its own colour rule, so a second class is needed for the
 * class colour to be visible at all.
 */
function palette() {
  return {
    nodes: [N("Root", "class"), N("Kid", "class"), N("fn", "function"), N("mod.py", "file")],
    edges: [
      { from: "Root", to: "Kid", kind: "inherits" },
      { from: "Root", to: "fn", kind: "uses" },
      { from: "Root", to: "mod.py", kind: "uses" },
    ],
  };
}

function opened() {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: palette() });
  return g;
}

/**
 * Opened with the functions drawn.
 *
 * Nothing is built until it is drawn, so a function's colour is not a question
 * the drawing can answer while the function is hidden. Turning them on is what
 * makes the question askable — and it is also the state a reader is in when
 * they can see a function to wonder about.
 */
function withFunctions() {
  const g = opened();
  g.el("toggle-fns").dispatch("click");
  return g;
}

const styleOf = (g, id, prop) => {
  const n = g.live.cy.getElementById(id);
  return n && n.length ? n.style(prop) : null;
};

// The palette as it is drawn today. Written out rather than derived from the
// source, so that a change to any of these is something a person chose.
const PALETTE = {
  Kid: { bg: "rgb(30,136,229)", rim: "rgb(131,190,241)" },
  fn: { bg: "rgb(67,160,71)", rim: "rgb(152,203,154)" },
  "mod.py": { bg: "rgb(251,140,0)", rim: "rgb(253,192,115)" },
  Root: { bg: "rgb(233,30,99)" },
};

// ---------------------------------------------------------------------------
suite("every kind keeps exactly its current colour");

{
  const g = withFunctions();
  for (const [id, want] of Object.entries(PALETTE)) {
    eq(styleOf(g, id, "background-color"), want.bg, `${id} background colour`);
    if (want.rim) eq(styleOf(g, id, "border-color"), want.rim, `${id} border colour`);
  }
}

// ---------------------------------------------------------------------------
suite("satellites get the same colours");

{
  // Satellites carry their own size and label rules, and they read the same
  // two colour fields — so they are the second place this could break.
  const g = withFunctions();
  const fn = g.live.cy.getElementById("fn");
  ok(fn.length > 0, "expected the function to be drawn");
  eq(fn.style("background-color"), PALETTE.fn.bg, "a satellite's background matches the body rule");
  eq(fn.style("border-color"), PALETTE.fn.rim, "so does its border");
}

// ---------------------------------------------------------------------------
suite("colours come from the stylesheet, not from node data");

{
  // A node carries what it is, not what it looks like. `kind` is in `data`
  // and is what decides the colour.
  const g = opened();
  let baked = [];
  g.live.cy.nodes().forEach((n) => {
    if (n.data("color") !== undefined || n.data("rim") !== undefined) baked.push(n.id());
  });
  eq(baked.length, 0, `no node should carry its own colour, got ${baked.slice(0, 4).join(", ")}`);
}

// ---------------------------------------------------------------------------
suite("the stylesheet can be asked for again, and is the same both times");

{
  // The point of a stylesheet that can be asked for again. Asking twice must
  // give the same rules, or "ask again after a colour changes" would be a way
  // of getting some other drawing.
  const pure = loadGraphJs();
  ok(typeof pure.graphStyle === "function", "expected the stylesheet to be a callable function");
  const a = pure.graphStyle();
  const b = pure.graphStyle();
  ok(Array.isArray(a) && a.length > 10, `expected a full set of rules, got ${a.length}`);
  eq(JSON.stringify(b), JSON.stringify(a), "asking twice should give identical rules");

  // And it is the drawing's own stylesheet, not a copy that drifted: the kinds
  // it colours are the ones the drawing draws. `class` is not among them on
  // purpose — the type colour is the base `node` rule's default and only the
  // kinds that differ from it get a rule of their own.
  const selectors = a.map((r) => r.selector).join(" | ");
  for (const kind of ["interface", "type", "enum", "function", "file"]) {
    ok(selectors.includes(`node[kind = "${kind}"]`), `expected a rule for ${kind}`);
  }
  ok(!selectors.includes('node[kind = "class"]'), "class has no rule of its own, it is the default");
  ok(!JSON.stringify(a).includes("data(color)"), "no rule should read data(color)");
  ok(!JSON.stringify(a).includes("data(rim)"), "nor data(rim)");
}

module.exports = {};
