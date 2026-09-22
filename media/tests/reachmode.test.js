"use strict";

// The right button's view, driven the way the reader drives it: press the
// right button on a node, look, and leave. The set's own rules are in
// reach.test.js and the fan's geometry in fan.test.js; this file is about the
// view as a mode of the viewer — what it shows, what it ignores, what it says
// about itself, and that it leaves nothing behind.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq, near, balancedTree } = require("./harness.js");

const C = "class";

function graphOf(kindOf, edges) {
  return {
    nodes: Object.keys(kindOf).map((id) => ({
      id,
      name: id,
      kind: kindOf[id],
      file: "/p/" + id + ".py",
      line: 1,
    })),
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind || "uses" })),
  };
}

/** The worked example: A inherits B inherits C, D uses A. */
const example = () =>
  graphOf({ A: C, B: C, C: C, D: C }, [
    ["A", "B", "inherits"],
    ["B", "C", "inherits"],
    ["D", "A", "uses"],
  ]);

/** A reaches B only through a function; D points at A. */
const throughFn = () =>
  graphOf({ A: C, f: "function", B: C, D: C }, [
    ["A", "f"],
    ["f", "B"],
    ["D", "A"],
  ]);

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

/** What is on screen, sorted. */
const shown = (g) => {
  const out = [];
  g.live.cy.nodes().forEach((n) => {
    if (n.style("display") !== "none") out.push(n.id());
  });
  return out.sort().join(",");
};
const rightClick = (g, id) => g.live.cy.getElementById(id).emit("cxttap");
const press = (g, key) => g.sandbox.__listeners.keydown.forEach((fn) => fn({ key }));
const pos = (g, id) => g.live.cy.getElementById(id).position();
const saves = (g) => g.posted.filter((m) => m && m.command === "saveSettings").length;
const primary = (g) => {
  const p = g.live.cy.nodes().filter((n) => n.hasClass("primary"));
  return p.length ? p[0].id() : null;
};
const typeSearch = (g, text) => {
  const el = g.el("symbol-search");
  el.value = text;
  el.dispatch("input");
  return g.el("search-status").textContent;
};
const stripHidden = (g) => g.el("reach-strip").classList.contains("hidden");

suite("right-click leaves only what the node can reach");

{
  const g = opened(example());
  eq(shown(g), "A,B,C,D", "all four should be shown at first");
  rightClick(g, "A");
  eq(shown(g), "A,B,C", "right-clicking A should leave only A B C; D points at A, the wrong direction");
  eq(primary(g), "A", "A should be the centre of this view");
  ok(pos(g, "B").y < pos(g, "A").y, "B should be above A");
  ok(pos(g, "C").y < pos(g, "A").y, "C should be above A too");
}

suite("right-clicking inside the view switches to that node's view");

{
  const g = opened(example());
  rightClick(g, "A");
  eq(shown(g), "A,B,C", "should enter A's view first");
  rightClick(g, "B");
  eq(shown(g), "B,C", "right-clicking B inside should switch to B's view");
  eq(primary(g), "B", "the vertex should become B too");
  eq(g.el("reach-name").textContent, "B", "the strip should follow");
}

{
  // Pressing the node the view is already about does nothing — not even a
  // re-frame, so a reader who has moved the camera keeps where they were.
  const g = opened(example());
  rightClick(g, "A");
  g.live.cy.zoom(g.live.cy.zoom() * 3);
  const zoom = g.live.cy.zoom();
  rightClick(g, "A");
  eq(shown(g), "A,B,C", "right-clicking the same node again should not change the view");
  eq(g.live.cy.zoom(), zoom, "and the camera should not move");
}

{
  // Switching is not stacking: the way out still goes to the whole drawing, at
  // the camera the reader left it at — not to the view switched from.
  const g = opened(example());
  g.live.cy.zoom(1.6);
  const zoom = g.live.cy.zoom();
  rightClick(g, "A");
  rightClick(g, "B");
  press(g, "Escape");
  eq(shown(g), "A,B,C,D", "Esc should return to the whole graph, not to A's view");
  eq(g.live.cy.zoom(), zoom, "the camera should return to where it was before the first entry, not before the switch");
}

{
  // And the functions toggle is put back to what it was before the first view,
  // not before the switch.
  const g = opened(throughFn());
  rightClick(g, "A");
  g.el("toggle-fns").dispatch("click");
  rightClick(g, "B");
  press(g, "Escape");
  eq(g.el("toggle-fns").getAttribute("aria-pressed"), "false", "functions should return to how they were before the first entry");
}

{
  // The centre key stays inert: the view's subject is the node the right
  // button named, and this key would name another.
  const g = opened(example());
  rightClick(g, "A");
  g.live.cy.getElementById("B").emit("tap");
  press(g, "c");
  eq(primary(g), "A", "pressing c with B selected should not move the vertex");
  ok(!g.settingAt("centre"), "and no centre should be set");
  eq(saves(g), 0, "nothing should have been sent");
}

suite("leaving returns to the graph as it was");

{
  const g = opened(example());
  const before = {};
  for (const id of ["A", "B", "C", "D"]) before[id] = { ...pos(g, id) };
  g.live.cy.zoom(1.7);
  g.live.cy.pan({ x: 123, y: -45 });
  const zoom = g.live.cy.zoom();
  const pan = { ...g.live.cy.pan() };

  rightClick(g, "A");
  press(g, "Escape");
  eq(shown(g), "A,B,C,D", "Esc should return to the whole graph");
  for (const id of ["A", "B", "C", "D"]) {
    const p = pos(g, id);
    ok(p.x === before[id].x && p.y === before[id].y, `${id} should return to its original position`);
  }
  eq(g.live.cy.zoom(), zoom, "the zoom should return to what it was before entering");
  eq(JSON.stringify(g.live.cy.pan()), JSON.stringify(pan), "so should the pan");
  eq(saves(g), 0, "entering and leaving should send nothing to the host");
  ok(g.el("settings-save").disabled, "the settings should not become unsaved because of it");
}

{
  // The strip's own way back goes to the same place.
  const g = opened(example());
  g.live.cy.zoom(1.4);
  const zoom = g.live.cy.zoom();
  rightClick(g, "A");
  g.el("reach-back").dispatch("click");
  eq(shown(g), "A,B,C,D", "the strip's back arrow should also return to the whole graph");
  eq(g.live.cy.zoom(), zoom, "and the camera should return too");
}

suite("toggling functions inside the view keeps the same set");

{
  // A reaches B only through a function, and functions are hidden by default.
  // The set is read off the artifact, so B is in it either way; what the
  // toggle changes is whether the function between them is drawn.
  const g = opened(throughFn());
  rightClick(g, "A");
  eq(shown(g), "A,B", "with functions hidden, B should still be shown; it is reached through f");
  g.el("toggle-fns").dispatch("click");
  eq(shown(g), "A,B,f", "showing functions should draw the f in between");
  g.el("toggle-fns").dispatch("click");
  eq(shown(g), "A,B", "hiding them again should keep the same types");
}

{
  // The apex is the subject of the view and must stay on screen — including
  // when it is a function and the reader then hides functions.
  const g = opened(graphOf({ f: "function", B: C, D: C }, [["f", "B"], ["D", "B"]]));
  g.el("toggle-fns").dispatch("click");
  rightClick(g, "f");
  eq(shown(g), "B,f", "right-clicking a function");
  g.el("toggle-fns").dispatch("click");
  ok(shown(g).split(",").includes("f"), "with functions hidden, the vertex f should still be shown");
}

suite("Reset view reframes the fan instead of leaving");

{
  // A view verb, and the view it is about is the one on screen.
  const g = opened(example());
  rightClick(g, "A");
  const framed = g.live.cy.zoom();
  g.live.cy.zoom(framed * 4);
  g.el("reset-view").dispatch("click");
  eq(shown(g), "A,B,C", "Reset view should stay in this view");
  eq(g.live.cy.zoom(), framed, "and frame it as it was on entry");
}

suite("search looks only within the set");

{
  // The field locates a node among those currently visible, and the view is
  // what is visible — so this holds without search knowing about the view.
  const g = opened(example());
  rightClick(g, "A");
  eq(typeSearch(g, "D"), "No match", "D is not in the set and should not be found");
  ok(/^1 match/.test(typeSearch(g, "B")), "B is in the set and should be found");
}

suite("the strip says which node it is and how many remain");

{
  const g = opened(example());
  ok(stripHidden(g), "the strip should be hidden before any right-click");
  rightClick(g, "A");
  ok(!stripHidden(g), "it should appear after the right-click");
  eq(g.el("reach-name").textContent, "A", "it should name the node the view came from");
  eq(g.el("reach-count").textContent, "3 / 4", "it should give how many remain and how many the whole graph has");
  press(g, "Escape");
  ok(stripHidden(g), "it should hide on leaving");
}

{
  // The case the count exists for: a node that reaches nothing. One circle
  // under "1 / 4" is an answer; one circle under nothing looks broken.
  const g = opened(example());
  rightClick(g, "C");
  eq(shown(g), "C", "C reaches nothing, so it should be the only node shown");
  eq(g.el("reach-count").textContent, "1 / 4", "and the strip should make clear that this is the answer");
}

{
  // Both numbers honour the same toggles, so the count means the same thing
  // whether functions are shown or not.
  const g = opened(throughFn());
  rightClick(g, "A");
  eq(g.el("reach-count").textContent, "2 / 3", "with functions hidden, 2 should be visible in the set and 3 in the whole graph");
  g.el("toggle-fns").dispatch("click");
  eq(g.el("reach-count").textContent, "3 / 4", "showing functions should change both counts");
}

suite("functions shown inside the view are restored on leaving");

{
  // Showing functions inside the view is a way of reading that view. Left on,
  // it changes the whole drawing the reader goes back to.
  const g = opened(throughFn());
  rightClick(g, "A");
  g.el("toggle-fns").dispatch("click");
  eq(shown(g), "A,B,f", "functions should be shown inside the view");
  press(g, "Escape");
  eq(shown(g), "A,B,D", "leaving should hide functions again; it returns to the graph as it was");
  eq(g.el("toggle-fns").getAttribute("aria-pressed"), "false", "the button should be unpressed again");
}

{
  // Restored rather than forced off: on before the view means on after it.
  const g = opened(throughFn());
  g.el("toggle-fns").dispatch("click");
  rightClick(g, "A");
  press(g, "Escape");
  eq(shown(g), "A,B,D,f", "functions shown before entering should still be shown after leaving");
  eq(g.el("toggle-fns").getAttribute("aria-pressed"), "true", "the button should still be pressed");

  const h = opened(throughFn());
  h.el("toggle-fns").dispatch("click");
  rightClick(h, "A");
  h.el("toggle-fns").dispatch("click");
  h.el("reach-back").dispatch("click");
  eq(shown(h), "A,B,D,f", "functions hidden inside should be shown again after leaving by the back arrow");
}

suite("the view's fan uses the shipped opening");

{
  // Seven equal children fill the opening exactly, so the first and last sit
  // half a share in from each edge and span six sevenths of it. A viewer that
  // passed any other angle to the layout would span something else.
  const kids = ["k0", "k1", "k2", "k3", "k4", "k5", "k6"];
  const kindOf = { R: C, X: C };
  for (const k of kids) kindOf[k] = C;
  const g = opened(graphOf(kindOf, kids.map((k) => ["R", k]).concat([["X", "R"]])));
  rightClick(g, "R");
  const apex = pos(g, "R");
  const angles = kids.map((k) => Math.atan2(pos(g, k).y - apex.y, pos(g, k).x - apex.x));
  const fan = g.REACH_FAN;
  ok(
    angles.every((a) => a >= fan.start - 1e-9 && a <= fan.start + fan.width + 1e-9),
    "every child should be inside the opening"
  );
  const spread = Math.max(...angles) - Math.min(...angles);
  ok(
    Math.abs(spread - (fan.width * 6) / 7) < 1e-6,
    `seven children spread over ${((spread * 180) / Math.PI).toFixed(2)}°, expected 6/7 of the opening`
  );
  near(fan.width, (2 * Math.PI) / 3, 1e-12, "the opening is normally 120°, as the reader asked");
}

suite("the view after right-click is as large as the default view");

/**
 * A screen the size of a real one. The harness's own is 1×1, where every fit
 * is below the floor and a fit cannot be told from the default view — so a
 * test left at that size passes on the code it is written to catch.
 */
const sized = (g, w, h) => {
  g.live.cy.width = () => w;
  g.live.cy.height = () => h;
};
const shownBox = (g) =>
  g.live.cy
    .elements()
    .filter((e) => e.style("display") !== "none")
    .renderedBoundingBox();
const floorControl = (g) =>
  (g.el("settings").query["[data-setting]"] || []).find(
    (el) => el.getAttribute("data-setting") === "labelFloor"
  );

{
  const g = opened(balancedTree(3, 3));
  sized(g, 1200, 800);
  g.el("reset-view").dispatch("click");
  const whole = g.live.cy.zoom();
  ok(whole > 0.3 && whole < 2, `expected the whole graph's default zoom between the lower and upper limits, got ${whole.toFixed(3)}`);

  g.live.cy.zoom(1.7); // wherever the reader had got to
  rightClick(g, "r_0_0");
  eq(shown(g).split(",").length, 4, "expected r_0_0 and the three it points to");
  near(g.live.cy.zoom(), whole, 1e-9, "after right-click the zoom should match the whole graph's default view; framing to fill would zoom to 2");
  const bb = shownBox(g);
  near((bb.x1 + bb.x2) / 2, 600, 1, "when it fits it should be centred (horizontally)");
  near((bb.y1 + bb.y2) / 2, 400, 1, "when it fits it should be centred (vertically)");

  g.live.cy.zoom(3);
  g.el("reset-view").dispatch("click");
  near(g.live.cy.zoom(), whole, 1e-9, "Reset view inside the view should return to this zoom too");
}

{
  // The default view setting decides it here as everywhere: raised past the
  // whole drawing's fit, the floor binds and the view follows.
  const g = opened(balancedTree(3, 3));
  sized(g, 1200, 800);
  rightClick(g, "r_0_0");
  const el = floorControl(g);
  el.value = "12";
  el.dispatch("change");
  near(g.live.cy.zoom(), 12 / 15, 1e-9, "setting default view to 12 inside the view should change the zoom to 0.8");
}

{
  // Too big for the screen at that size: the pressed node stays in sight at
  // the foot, and the far levels run off the top rather than the whole being
  // shrunk to fit.
  const g = opened(balancedTree(3, 3));
  sized(g, 300, 200);
  const el = floorControl(g);
  el.value = "12";
  el.dispatch("change");
  rightClick(g, "r");
  const p = g.live.cy.getElementById("r").renderedPosition();
  ok(
    p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 200,
    `when it does not fit, the clicked node should still be on screen (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`
  );
  ok(p.y > 200 * 0.6, `and near the bottom, with the fan growing upward from there (y=${p.y.toFixed(0)})`);
  ok(shownBox(g).y1 < 0, "the far levels should run past the top edge rather than the whole fan being shrunk to fit");
}

suite("the view's fan widens when crowded");

/** An angle measured from straight up, in (-π, π]. */
const fromUpAt = (apex, p) => {
  let x = Math.atan2(p.y - apex.y, p.x - apex.x) + Math.PI / 2;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
};
const hub = (n) => {
  const kids = Array.from({ length: n }, (_, i) => "k" + i);
  const kindOf = { H: C, X: C };
  for (const k of kids) kindOf[k] = C;
  return { kids, graph: graphOf(kindOf, kids.map((k) => ["H", k]).concat([["X", "H"]])) };
};

{
  // Twenty things it points to: more than 150° seats side by side.
  const { kids, graph } = hub(20);
  const g = opened(graph);
  rightClick(g, "H");
  const apex = pos(g, "H");
  const angles = kids.map((k) => fromUpAt(apex, pos(g, k)));
  const spread = Math.max(...angles) - Math.min(...angles);
  ok(spread > g.REACH_FAN.width, `twenty children spread over ${((spread * 180) / Math.PI).toFixed(0)}°, expected wider than the usual opening`);
  near((Math.max(...angles) + Math.min(...angles)) / 2, 0, 1e-6, "it should still be centred facing up");
}

{
  // Opened past half a circle, some of the set lies below the pressed node, so
  // where it does not fit the screen the node is centred, not anchored at the
  // foot.
  const { graph } = hub(30);
  const g = opened(graph);
  sized(g, 300, 200);
  const el = floorControl(g);
  el.value = "12";
  el.dispatch("change");
  rightClick(g, "H");
  const p = g.live.cy.getElementById("H").renderedPosition();
  near(p.x, 150, 1, "when a full circle does not fit, the clicked node should be at the centre of the screen (horizontally)");
  near(p.y, 100, 1, "when a full circle does not fit, the clicked node should be at the centre of the screen (vertically)");
}

suite("a new graph ends the view");

{
  // Checked where a stale view would actually show. The screen alone cannot:
  // with the set cleared and the node left behind, everything is drawn and
  // looks right — while the drawing is rooted on the old node and the right
  // button has stopped working.
  const fresh = opened(example());
  const auto = primary(fresh);
  const other = ["D", "A", "B"].find((id) => id !== auto);
  const g = opened(example());
  rightClick(g, other);
  eq(primary(g), other, `should be in ${other}'s view first`);
  g.send({ command: "setGraph", graph: example() });
  eq(shown(g), "A,B,C,D", "the new graph should arrive whole");
  eq(primary(g), auto, "the centre should be the graph's own pick, not the node right-clicked before");
  ok(stripHidden(g), "the strip should be hidden too");
  rightClick(g, "B");
  eq(shown(g), "B,C", "right-click should work again; no leftover state should block it");
}

suite("the strip sits top left and is not covered by the expanded rail");

{
  // Against the stylesheet and the markup, since the harness hands out an
  // element for any id it is asked for and so cannot notice one missing.
  const css = fs
    .readFileSync(path.join(__dirname, "..", "graph.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "src", "graphDocument.ts"), "utf8");
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
    const m = css.match(new RegExp("(^|\\})\\s*" + esc + "\\s*\\{([^}]*)\\}", "m"));
    return m ? m[2] : null;
  };
  /** A length in px, adding and subtracting the px terms of a calc(). */
  const px = (body, prop) => {
    const m = (body || "").match(new RegExp("(^|;|\\s)" + prop + ":\\s*([^;]+);"));
    if (!m) return null;
    const v = m[2].trim();
    const inner = (v.match(/^calc\((.*)\)$/) || [, v])[1];
    let total = 0;
    for (const t of inner.replace(/\s+/g, "").match(/[+-]?[\d.]+px/g) || []) total += parseFloat(t);
    return total;
  };

  const strip = rule("#reach-strip");
  ok(!!strip, "expected a #reach-strip rule");
  const railWide = px(rule("#sidebar"), "width");
  const reserved = px(rule("#main"), "margin-left");
  ok(railWide > 0 && reserved > 0, `expected to read the expanded rail width ${railWide}px and the reserved width ${reserved}px`);
  const overlap = railWide - reserved;
  const left = px(strip, "left");
  ok(left !== null && left <= 16, `normally the strip should sit left, ${left}px from the left edge`);
  // Clear of the rail only while it is expanded, the only time it is drawn
  // over the drawing: at rest it sits in a reserved strip of its own.
  const stepped = rule('#sidebar[data-collapsed="false"] ~ #main #reach-strip');
  ok(!!stepped, "expected a rule that moves the strip right when the rail is expanded");
  const leftOpen = px(stepped, "left");
  ok(
    leftOpen >= overlap + 8,
    `with the rail expanded the strip is ${leftOpen}px from the left edge and the rail overlaps by ${overlap}px; it should clear it`
  );
  ok(px(strip, "top") !== null, "it should sit at the top edge");
  ok(!/(^|;|\s)(right|bottom):/.test(strip), "it should not sit right or bottom; the legend and comment are top right and search is at the bottom");
  ok(/(^|;|\s)right:/.test(rule("#legend") || ""), "the legend should be on the right");
  ok(/(^|;|\s)right:/.test(rule("#comment") || ""), "the comment box should be on the right");
  ok(/(^|;|\s)bottom:/.test(rule("#searchbar") || ""), "search should be at the bottom");

  // An id selector outranks the shared `.hidden` class, so a rule on an id can
  // keep an element on screen while the code says it is hidden.
  ok(
    /display:\s*none/.test(rule("#reach-strip.hidden") || ""),
    "the strip needs its own .hidden rule, or the display on its id overrides the shared one"
  );

  const main = html.indexOf('<div id="main">');
  const at = html.indexOf('id="reach-strip"');
  ok(main !== -1 && at > main, "the strip should be inside #main");
  // The rule above reaches the strip through `~`, which only looks forward
  // among siblings: the rail has to close before #main opens.
  const railEnd = html.indexOf("</nav>", html.indexOf('<nav id="sidebar"'));
  ok(railEnd !== -1 && railEnd < main, "#main should come after the rail so `~` can select it");
  const block = html.slice(at, html.indexOf("</div>", at));
  for (const id of ["reach-back", "reach-name", "reach-count"]) {
    ok(block.includes(`id="${id}"`), `the strip should contain ${id}`);
  }
}

module.exports = {};
