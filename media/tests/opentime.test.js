"use strict";

// Whether the largest project the viewer targets still lays out in proportion
// to a smaller one.
//
// Layout time does not grow linearly in nodes plus edges: Angular is 2.5
// times CPython's nodes plus edges and takes 7.6 times as long. The wait —
// six to seven seconds for a drawing the reader then reads for an hour — is
// acceptable, which is a judgement a growth rate cannot express either way.
//
// What is guarded here is therefore not the reader's seconds but the shape of
// the cost: the large graph against a smaller one, in the same process, on the
// same machine, at the same moment.
//
// An absolute budget would not be about the code. Laying the graph out here
// also builds every element in a stubbed DOM, and over one session that ran
// 9.6, 11.7, 14.6, 15.1, 16.5, 17.2, 21.8, 22.3 and 23.6 seconds, and 34 to
// 35 with two at once. A 20-second budget sits inside that spread, so it
// would fail on a busy machine rather than on a regression. Taking the
// better of two runs does not save it either: the better of two was 21.8s.
//
// The ratio cancels the machine. Across the same session it was 3.40, 4.17,
// 2.81 and 3.02 quiet, and 3.03 and 2.63 with two at once — 2.6 to 4.2, where
// the times themselves moved by two and a half times. The bound is twice the
// worst of that, so noise cannot reach it and a regression that made the large
// graph disproportionately slower would.
//
// The fixtures are external clones and their artifacts are generated, not
// checked in, so a checkout without them skips this rather than failing. The
// fix for a skipped check is to generate the artifact, not to pretend the skip
// is a pass.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok } = require("./harness.js");

const artifact = (lang, name) =>
  path.join(__dirname, "..", "..", "fixtures", lang, name, "planisphere.json");
const SMALL = artifact("python", "cpython");
const LARGE = artifact("typescript", "angular");

/** Twice the worst ratio measured: noise cannot reach it, a regression can. */
const RATIO_LIMIT = 8;

suite("layout time for the largest project stays in proportion to a small one");

if (!fs.existsSync(SMALL) || !fs.existsSync(LARGE)) {
  console.log("(skipping opentime.test.js — no cpython or angular artifact)");
} else {
  const layout = (file) => {
    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const g = loadGraphJs({ headless: true });
    const started = Date.now();
    g.send({ command: "setGraph", graph });
    return { took: Date.now() - started, drawn: g.live.cy.nodes().length, nodes: graph.nodes.length };
  };

  const small = layout(SMALL);
  const large = layout(LARGE);

  ok(small.drawn > 0 && large.drawn > 0, "both graphs actually drew something — a graph that was never laid out is fast");
  // Without this, laying the same graph out twice would pass with a ratio of
  // one however slow it had become.
  ok(
    large.nodes > small.nodes * 1.5,
    `expected the large graph to be larger: ${large.nodes} vs ${small.nodes} nodes`
  );
  const ratio = large.took / Math.max(small.took, 1);
  ok(
    ratio <= RATIO_LIMIT,
    `expected angular to lay out within ${RATIO_LIMIT}x the time of cpython, got ${(large.took / 1000).toFixed(1)}s vs ${(small.took / 1000).toFixed(1)}s, ${ratio.toFixed(2)}x`
  );
}

module.exports = {};
