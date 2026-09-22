"use strict";

// The drawing's colours, as the reader's.
//
// Blue classes, green functions, orange files, a red centre; a pale blue solid
// line for inheritance, a purple dashed one for use, a teal dotted one for a
// reference. Every one of those is a taste, and no measurement settles any of
// them — which is this project's test for whether something is a setting or a
// constant.
//
// The mechanism is one hop: a chosen value is written onto the document root
// as the CSS variable it already has a name for, and the stylesheet, the
// legend's swatches and the panel's own marks all read that variable. A palette shown in
// one place and drawn in another is worse than no palette.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const N = (id, kind) => ({ id, name: id, kind, file: "/p/" + id + ".py", line: 1 });

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

// ---------------------------------------------------------------------------
suite("a variable set on the root reads back and is drawn");

{
  // The harness's own capability, asserted before anything is built on it. A
  // `getComputedStyle` that answered "" to everything, or a `style` that was a
  // bare object, would mean no claim that a colour reached the drawing could
  // fail.
  const g = opened();
  const root = g.root;
  ok(typeof root.style.setProperty === "function", "expected the root to have setProperty");

  root.style.setProperty("--node-class", "#123456");
  eq(
    g.sandbox.getComputedStyle(root).getPropertyValue("--node-class"),
    "#123456",
    "the variable that was set did not read back"
  );

  // And the drawing reads it: the stylesheet resolves the variable at the
  // moment it is asked for, so asking again is what makes a change land.
  const rules = g.graphStyle();
  // The type colour lives on the base `node` rule rather than in a
  // `node[kind = "class"]` rule of its own: a type is anything that is not a
  // function and not a file, so the default is the type and only the two
  // orbiting kinds override it.
  const baseRule = rules.find((r) => r.selector === "node");
  ok(!!baseRule, "expected a base node rule");
  eq(baseRule.style["background-color"], "#123456", "asking the stylesheet again should return the new colour");
}

// ---------------------------------------------------------------------------
// The palette as a setting: chosen in the panel, kept by the host, written
// where everything that draws already reads.

const nodeOf = (g, id) => g.live.cy.getElementById(id);
const edgeBetween = (g, a, b) =>
  g.live.cy.edges().filter((e) => e.source().id() === a && e.target().id() === b)[0];

/** Every node's position, to prove a colour moved nothing. */
const positionsOf = (g) => {
  const out = {};
  g.live.cy.nodes().forEach((n) => {
    const p = n.position();
    out[n.id()] = { x: p.x, y: p.y };
  });
  return out;
};

const withPalette = (settings) => {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setSettings", settings });
  g.send({ command: "setGraph", graph: palette() });
  return g;
};

// ---------------------------------------------------------------------------
suite("a chosen colour reaches every node of that kind");

{
  const g = withPalette({ palette: { "node-class": "#123456", "node-function": "#654321" } });
  // A function is not built while it is hidden, so its colour is not something
  // the drawing can be asked about until it is drawn.
  g.el("toggle-fns").dispatch("click");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(18,52,86)", "class should use the chosen colour");
  eq(nodeOf(g, "fn").style("background-color"), "rgb(101,67,33)", "so should function");
  // The rim is arithmetic on the colour, so it follows without being chosen.
  eq(nodeOf(g, "Kid").style("border-color"), "rgb(125,143,162)", "the border should be derived from the new colour");
  // Untouched kinds keep the default.
  eq(nodeOf(g, "mod.py").style("background-color"), "rgb(251,140,0)", "a kind that was not chosen should keep its default");
}

// ---------------------------------------------------------------------------
suite("changing a colour moves no node");

{
  const g = opened();
  const before = positionsOf(g);
  g.send({ command: "setSettings", settings: { palette: { "node-class": "#00FF00" } } });
  const after = positionsOf(g);
  let moved = 0;
  for (const [id, p] of Object.entries(before)) {
    const q = after[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
  }
  eq(moved, 0, "colour is not layout; no node should move");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(0,255,0)", "but the colour should actually change");
}

// ---------------------------------------------------------------------------
suite("edge colour, width, line style and arrow follow the settings");

{
  const g = withPalette({
    palette: { "edge-inherits": "#FF0000" },
    edges: { inherits: { width: 5, style: "dotted", arrow: "none" } },
  });
  const e = edgeBetween(g, "Root", "Kid");
  ok(!!e, "expected an inherits edge");
  eq(e.style("line-color"), "rgb(255,0,0)", "edge colour");
  eq(e.style("width"), "5px", "edge width");
  eq(e.style("line-style"), "dotted", "edge line style");
  eq(e.style("target-arrow-shape"), "none", "arrow shape");

  // The other kinds keep their own defaults. Asked of the edge to the file
  // node rather than the one to the function: a `uses` edge is a `uses` edge,
  // and the function is not drawn by default, so nothing is built for it.
  const u = edgeBetween(g, "Root", "mod.py");
  eq(u.style("line-color"), "rgb(155,114,175)", "an edge that was not chosen should keep its default colour");
  eq(u.style("width"), "1.5px", "and its default width");
}

// ---------------------------------------------------------------------------
suite("a legend swatch is the same colour as the drawing");

{
  // The legend's swatches are CSS and read `var(--node-class)`. Writing the
  // variable is what makes the two impossible to disagree; reading the drawing
  // out of the settings object instead would leave two paths to keep in step.
  const g = withPalette({ palette: { "node-class": "#ABCDEF" } });
  eq(
    g.root.style.getPropertyValue("--node-class"),
    "#ABCDEF",
    "the chosen colour should be written to the root variable so the legend can read it"
  );
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(171,205,239)", "and the drawing should read the same variable");
}

// ---------------------------------------------------------------------------
suite("Reset puts every item back to its default");

{
  const g = withPalette({
    palette: { "node-class": "#111111", "edge-uses": "#222222" },
    edges: { uses: { width: 9 } },
    bandOverflow: true,
  });
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(17,17,17)", "the setting should take effect first");

  g.el("settings-reset").dispatch("click");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(30,136,229)", "class should return to the default blue");
  eq(edgeBetween(g, "Root", "mod.py").style("line-color"), "rgb(155,114,175)", "the edge should return to the default purple");
  eq(edgeBetween(g, "Root", "mod.py").style("width"), "1.5px", "and so should the width");

  // Including settings the reader may have forgotten changing.
  const band = (g.el("settings").query["[data-setting]"] || []).find(
    (el) => el.getAttribute("data-setting") === "bandOverflow"
  );
  eq(band.value, "ring", "the layout setting should return to its default too");

  // Not saved by itself: reset puts the draft back, and Save is what tells the
  // host. Pressing it here proves the reset really did clear everything.
  eq(g.posted.filter((m) => m && m.command === "saveSettings").length, 0, "resetting alone should not send anything");
  g.el("settings-save").dispatch("click");
  const saves = g.posted.filter((m) => m && m.command === "saveSettings");
  const last = saves[saves.length - 1] || { settings: null };
  eq(JSON.stringify(last.settings), "{}", "expected an empty settings object, sent only on Save");
}

// ---------------------------------------------------------------------------
suite("only a changed item has a revert button");

{
  // Shown only where there is something to revert: the mark answers "is this
  // row unsaved?", so a colour that arrived from the host's store — already
  // saved, nothing outstanding — carries no mark, and one the reader has just
  // moved does.
  // Shown by class, not by presence: a revert that appears from nowhere pushes
  // the controls beside it sideways, and the reader is on the way to one of
  // those with a mouse.
  const g = withPalette({ palette: { "node-class": "#111111" } });
  const shown = (gg) =>
    (gg.el("settings").query["[data-revert]"] || []).filter((el) =>
      el.classList.contains("shown")
    );
  eq(shown(g).length, 0, "a saved colour has nothing pending and should not be marked");

  const control = (gg, key) =>
    (gg.el("settings").query["[data-setting]"] || []).find(
      (el) => el.getAttribute("data-setting") === key
    );
  const picker = control(g, "palette.node-class");
  picker.value = "#222222";
  picker.dispatch("change");

  const changed = shown(g);
  const keys = changed.map((el) => el.getAttribute("data-revert")).sort();
  eq(keys.join(","), "palette.node-class", "only the item that changed should be marked");

  changed[0].dispatch("click");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(17,17,17)", "clicking should return that one item to its last saved value");
  eq(shown(g).length, 0, "the mark should disappear after reverting");
}

// The panel does not report a colour too close to the star field: a number
// beside every swatch is a line of warning in a row of controls. Whether a
// node stays distinguishable from the background is judged by looking at the
// drawing, which the panel covers.

// ---------------------------------------------------------------------------
suite("using the panel's controls directly takes effect");

{
  // The other suites drive the palette through the host's message, which is
  // how a returning reader gets theirs. This one drives the controls, which is
  // how anybody sets one in the first place — and the two must not take
  // different paths through the code.
  const g = opened();
  const control = (key) =>
    (g.el("settings").query["[data-setting]"] || []).find(
      (el) => el.getAttribute("data-setting") === key
    );

  const colour = control("palette.node-class");
  ok(!!colour, "expected a class colour control on the panel");
  colour.value = "#FF00FF";
  colour.dispatch("change");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(255,0,255)", "a chosen colour should be drawn");
  eq(g.root.style.getPropertyValue("--node-class"), "#FF00FF", "the variable should be written too, so the legend keeps up");

  const width = control("edges.uses.width");
  ok(!!width, "expected a uses width control on the panel");
  width.value = "4";
  width.dispatch("change");
  eq(edgeBetween(g, "Root", "mod.py").style("width"), "4px", "width should be a number, not the string \"4\"");

  // Nothing has been told to the host yet — the drawing shows it, the store
  // does not know about it.
  eq(g.posted.filter((m) => m && m.command === "saveSettings").length, 0, "nothing should be sent before Save");
  g.el("settings-save").dispatch("click");
  const saves = g.posted.filter((m) => m && m.command === "saveSettings");
  const last = saves[saves.length - 1] || { settings: {} };
  eq(
    JSON.stringify(last.settings),
    JSON.stringify({ palette: { "node-class": "#FF00FF" }, edges: { uses: { width: 4 } } }),
    "only the changed items should be sent, not the whole table"
  );
}
suite("the panel edits a draft that is handed over only on Save");

{
  // A panel that wrote every keystroke to the store would give the reader no
  // moment at which they had finished, and no way to try something and walk
  // away from it. So: the drawing and the panel's marks show a change at once,
  // and the store hears about it when they say so.
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  const control = (key) =>
    (g.el("settings").query["[data-setting]"] || []).find(
      (el) => el.getAttribute("data-setting") === key
    );
  const saves = () => g.posted.filter((m) => m && m.command === "saveSettings");

  const dirtyEl = g.el("settings-dirty");
  const saveEl = g.el("settings-save");
  ok(saveEl.disabled !== false, "Save should be disabled before any change");
  ok(dirtyEl.hidden !== false, "and there should be no unsaved-changes notice");

  const colour = control("palette.node-class");
  colour.value = "#FF8800";
  colour.dispatch("change");

  eq(nodeOf(g, "Kid").style("background-color"), "rgb(255,136,0)", "the drawing should show it at once");
  eq(saves().length, 0, "but it should not be handed to the host yet");
  eq(saveEl.disabled, false, "Save should be enabled");
  eq(dirtyEl.hidden, false, "and the unsaved-changes notice should show");

  saveEl.dispatch("click");
  eq(saves().length, 1, "expected one send, after Save");
  eq(saveEl.disabled, true, "Save should be disabled again after sending");
  eq(dirtyEl.hidden, true, "the unsaved-changes notice should hide");
}

// ---------------------------------------------------------------------------
suite("closing without Save reverts the changes");

{
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  const colour = (g.el("settings").query["[data-setting]"] || []).find(
    (el) => el.getAttribute("data-setting") === "palette.node-class"
  );
  colour.value = "#FF00FF";
  colour.dispatch("change");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(255,0,255)", "the change should take effect first");

  g.el("settings-close").dispatch("click");
  eq(
    nodeOf(g, "Kid").style("background-color"),
    "rgb(30,136,229)",
    "closing should return to the last saved state"
  );
  eq(g.posted.filter((m) => m && m.command === "saveSettings").length, 0, "and nothing should have been sent");
}

// ---------------------------------------------------------------------------
suite("closing does not discard what was saved");

{
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  const colour = (g.el("settings").query["[data-setting]"] || []).find(
    (el) => el.getAttribute("data-setting") === "palette.node-class"
  );
  colour.value = "#00AA00";
  colour.dispatch("change");
  g.el("settings-save").dispatch("click");
  g.el("settings-close").dispatch("click");
  eq(nodeOf(g, "Kid").style("background-color"), "rgb(0,170,0)", "the saved value should stay");
}

// ---------------------------------------------------------------------------
suite("each row's mark follows the choice as it changes");

{
  // A change is shown where the setting is, as it is made. The panel is
  // opaque and covers the canvas, so a change the reader cannot see until they
  // close it is a change made blind.
  const g = withPalette({});
  const root = g.root;
  root.style.setProperty("--node-class", "#123456");
  root.style.setProperty("--edge-uses", "#654321");

  const rules = g.graphStyle();
  eq(
    rules.find((r) => r.selector === "node").style["background-color"],
    "#123456",
    "the node kind colour should follow the variable"
  );
  eq(
    rules.find((r) => r.selector === 'edge[kind = "uses"]').style["line-color"],
    "#654321",
    "so should the edge colour"
  );

  // …and the marks on the rows read the same variables, which is what makes
  // the row show what it sets.
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "..", "graph.css"),
    "utf8"
  );
  ok(/\.dot\.node-class \{[^}]*var\(--node-class\)/.test(css), "the row's dot should read --node-class");
  const js = require("fs").readFileSync(
    require("path").join(__dirname, "..", "graph.js"),
    "utf8"
  );
  // One table of defaults, read by the stylesheet and by the row. Written
  // twice, they can differ, and then every row draws `inherits`.
  ok(/const EDGE_DEFAULTS = \{/.test(js), "expected a single table of edge defaults");
  const look = js.slice(js.indexOf("function edgeLook"));
  ok(
    /cssVar\("--edge-" \+ kind/.test(look.slice(0, look.indexOf("\n  }"))),
    "the colour should be read from --edge-<kind>"
  );
  const paint = js.slice(js.indexOf("function paintEdgeSwatches"));
  ok(
    /edgeLook\(kind,/.test(paint.slice(0, paint.indexOf("\n  }"))),
    "the row's line should use the same lookup as the stylesheet"
  );
}
