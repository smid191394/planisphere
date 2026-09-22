"use strict";

// What one turn of the wheel does.
//
// The defect these guard is not a wrong number, it is a number that changes:
// cytoscape samples the first four wheel events to decide between a trackpad
// and a wheel, clamping them to a magnitude of 5 while it looks, and from the
// fifth gives a wheel three times the rate. The sample lives on the renderer,
// which the viewer rebuilds on every open, so the reader relearns the gesture
// each time.
//
// So every assertion here compares one wheel event against another rather
// than against a constant. Whether the rate feels right is not something a
// headless test can say; whether it is the same rate twice is.

const { loadGraphJs, suite, ok, eq, near } = require("./harness.js");

const id = (sym) => `/p/m.py::class::${sym}`;
const N = (sym) => ({ id: id(sym), name: sym, kind: "class", file: "/p/m.py", line: 1 });

/** A graph with enough in it that there is something to zoom around. */
function smallGraph() {
  const nodes = [N("Root")];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(N(`C${i}`));
    edges.push({ from: id("Root"), to: id(`C${i}`), kind: "uses" });
  }
  return { nodes, edges };
}

function opened() {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: smallGraph() });
  return g;
}

/**
 * Turn the wheel once and report what the zoom was multiplied by.
 *
 * The zoom is reset to 1 first so the reading is the factor itself rather than
 * a position on a curve, and the pointer is put in the middle of the 1200x800
 * rect the harness reports.
 */
function factor(g, delta, deltaMode) {
  const cy = g.live.cy;
  cy.zoom(1);
  g.el("main").dispatch("wheel", {
    deltaY: delta,
    deltaMode: deltaMode || 0,
    clientX: 600,
    clientY: 400,
  });
  return cy.zoom();
}

// ---------------------------------------------------------------------------
suite("every scroll step zooms by the same factor");

{
  const g = opened();
  const seen = [];
  for (let i = 0; i < 20; i++) seen.push(factor(g, -100));
  const first = seen[0];
  ok(first > 1, `scrolling up should zoom in, got factor ${first.toFixed(4)}`);
  const spread = Math.max(...seen) - Math.min(...seen);
  near(spread, 0, 1e-12, `twenty scroll steps should have identical factors (1st ${seen[0]}, 5th ${seen[4]}, 20th ${seen[19]})`);
}

// ---------------------------------------------------------------------------
suite("the factor is unchanged after reopening");

{
  const g = opened();
  const before = factor(g, -100);
  ok(before !== 1, `expected an actual zoom first, got ${before}`);
  // A second setGraph destroys `cy` and builds another one, which is what
  // opening the artifact again does. The library's device sample lives on the
  // renderer and does not survive that; a rate that is stated once does.
  g.send({ command: "setGraph", graph: smallGraph() });
  const after = factor(g, -100);
  near(after, before, 1e-12, `after reopening the same scroll should give the same factor: ${before} → ${after}`);
}

// ---------------------------------------------------------------------------
suite("scrolling twice as far squares the factor");

{
  const g = opened();
  const one = factor(g, -100);
  const two = factor(g, -200);
  ok(one !== 1 && two !== 1, `expected an actual zoom first, got ${one} / ${two}`);
  near(two, one * one, 1e-9, `scrolling twice as far should give ${(one * one).toFixed(6)}, got ${two.toFixed(6)}`);
  // And the other direction undoes it, so a reader can scroll back to where
  // they were rather than to somewhere near it.
  const back = factor(g, 100);
  near(back * one, 1, 1e-12, `scrolling back should cancel exactly: ${one.toFixed(6)} × ${back.toFixed(6)}`);
}

// ---------------------------------------------------------------------------
suite("line-mode scrolling is converted to pixels first");

{
  // Firefox on Linux reports deltaMode 1 — lines, about 3 per notch — where
  // everything else reports about 100 pixels. Converting before the rate is
  // applied is what makes one notch mean one notch on both.
  const g = opened();
  const px = factor(g, -99);
  const lines = factor(g, -3, 1);
  ok(px !== 1 && lines !== 1, `expected an actual zoom first, got ${px} / ${lines}`);
  near(lines, px, 1e-9, `3 lines should equal 99 pixels: ${px.toFixed(6)} vs ${lines.toFixed(6)}`);
}

// ---------------------------------------------------------------------------
suite("what is under the cursor stays under the cursor");

{
  const g = opened();
  const cy = g.live.cy;
  cy.zoom(1);
  cy.pan({ x: 0, y: 0 });
  const node = cy.getElementById(id("C0"));
  const before = { ...node.renderedPosition() };
  g.el("main").dispatch("wheel", {
    deltaY: -100,
    deltaMode: 0,
    clientX: before.x,
    clientY: before.y,
  });
  const after = node.renderedPosition();
  ok(cy.zoom() !== 1, `expected an actual zoom first, got ${cy.zoom()}`);
  near(
    Math.hypot(after.x - before.x, after.y - before.y),
    0,
    1e-6,
    `the node under the cursor should stay in place: (${before.x.toFixed(1)}, ${before.y.toFixed(1)}) → (${after.x.toFixed(1)}, ${after.y.toFixed(1)})`
  );
}

// ---------------------------------------------------------------------------
suite("the zoom limits still hold");

{
  const g = opened();
  const cy = g.live.cy;
  cy.minZoom(0.25);
  cy.maxZoom(4);

  cy.zoom(1);
  for (let i = 0; i < 100; i++) {
    g.el("main").dispatch("wheel", { deltaY: -100, deltaMode: 0, clientX: 600, clientY: 400 });
  }
  eq(cy.zoom(), 4, "scrolling up repeatedly should stop at the upper limit");

  for (let i = 0; i < 200; i++) {
    g.el("main").dispatch("wheel", { deltaY: 100, deltaMode: 0, clientX: 600, clientY: 400 });
  }
  eq(cy.zoom(), 0.25, "scrolling down repeatedly should stop at the lower limit");
}

// ---------------------------------------------------------------------------
suite("the factor is a readable number");

{
  const g = loadGraphJs();
  // One notch of a typical wheel is 100px, and the rate says how much scrolling
  // is worth a doubling. The two together are the whole statement — no device
  // detection, no library-internal step, nothing else multiplying it.
  ok(
    g.ZOOM_DOUBLING_SCROLL > 0,
    `expected the factor to be a positive number: ${g.ZOOM_DOUBLING_SCROLL}`
  );
  eq(g.wheelScrollPixels(-100, 0, 800), -100, "pixel mode passes through unchanged");
  eq(g.wheelScrollPixels(-3, 1, 800), -3 * g.WHEEL_LINE_PIXELS, "lines are converted to pixels");
  eq(g.wheelScrollPixels(-1, 2, 800), -800, "a page is converted to one container height");
  eq(g.wheelScrollPixels(0, 0, 800), 0, "no scroll is no scroll");
}

// ---------------------------------------------------------------------------
suite("the starfield redraws after zooming");

{
  // The rings and the star field are on their own canvas and repaint on
  // `viewport`. A zoom applied outside the library's own handler still has to
  // emit it, or the backdrop stays where the drawing used to be.
  const g = opened();
  const cy = g.live.cy;
  let seen = 0;
  cy.on("viewport", () => seen++);
  g.el("main").dispatch("wheel", { deltaY: -100, deltaMode: 0, clientX: 600, clientY: 400 });
  ok(seen > 0, `one scroll should emit one viewport event, got ${seen}`);
}

module.exports = {};
