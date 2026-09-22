"use strict";

// The reader's choice about how a crowded level is drawn.
//
// A level too wide for its ring can be drawn two ways: everything on the ring,
// overlapping, or the childless overflow in rows outside it. Both were
// measured — Django's overlapping pairs are 5,279 one way and 1,975 the other,
// at the same drawing size and the same magnification — and the measurement
// does not settle it, because what differs is what the picture looks like. So
// the layout takes it as an option and the viewer offers it.
//
// What is asserted here is that the option is real: the same graph laid out
// twice, differing only in the option, comes out differently, and each answer
// is the one it claims to be.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const pure = loadGraphJs();

const C = (id) => ({ id, name: id, kind: "class", file: "/p/" + id + ".py", line: 1 });
const E = (from, to) => ({ from, to, kind: "uses" });

/** A root with `sibs` children, each carrying `leaves` of its own. */
function narrowSectors(sibs, leaves) {
  const nodes = [C("Root")];
  const edges = [];
  for (let i = 0; i < sibs; i++) {
    nodes.push(C(`S${i}`));
    edges.push(E("Root", `S${i}`));
    for (let k = 0; k < leaves; k++) {
      nodes.push(C(`S${i}L${k}`));
      edges.push(E(`S${i}`, `S${i}L${k}`));
    }
  }
  return { nodes, edges };
}

function laidOut(graph, opts) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return pure.computeClassRingPositions(graph, pure.pickTopClass(graph), ids, opts);
}

/** Distance from the group's centre, for a list of ids. */
function radii(out, ids) {
  const c = out.positions["Root"];
  return ids.map((id) => {
    const p = out.positions[id];
    return p ? Math.hypot(p.x - c.x, p.y - c.y) : NaN;
  });
}

const leavesOf = (n, count) => {
  const a = [];
  for (let k = 0; k < count; k++) a.push(`S${n}L${k}`);
  return a;
};

// ---------------------------------------------------------------------------
suite("the two layouts really differ");

{
  const graph = narrowSectors(20, 8);
  const band = laidOut(graph, { bandOverflow: true });
  const ring = laidOut(graph, { bandOverflow: false });
  let moved = 0;
  for (const [id, p] of Object.entries(band.positions)) {
    const q = ring.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) moved++;
  }
  ok(moved > 0, "laying out one graph with the two settings should put some nodes in different places");
  eq(
    Object.keys(band.positions).length,
    Object.keys(ring.positions).length,
    "both settings should draw the same number of nodes, differing only in position"
  );
}

// ---------------------------------------------------------------------------
suite("with the single ring chosen, nothing is pushed outward");

{
  const out = laidOut(narrowSectors(20, 8), { bandOverflow: false });
  const rs = radii(out, leavesOf(1, 8));
  ok(rs.every((r) => !Number.isNaN(r)), "all eight children should have a position");
  for (const r of rs) {
    ok(Math.abs(r - 360) < 1, `expected every node on its own depth's ring, got r=${Math.round(r)}`);
  }
}

// ---------------------------------------------------------------------------
suite("with stacked rows chosen, what does not fit moves outward");

{
  const out = laidOut(narrowSectors(20, 8), { bandOverflow: true });
  const rs = radii(out, leavesOf(1, 8));
  const outward = rs.filter((r) => r > 361).length;
  ok(outward >= 4, `expected the overflow to move outward, only ${outward} did`);
}

// ---------------------------------------------------------------------------
suite("with no setting the result is a clean arc");

{
  // The default is what a reader who never opens the panel gets, so it is the
  // one that has to be right without being chosen.
  const graph = narrowSectors(20, 8);
  const bare = laidOut(graph);
  const ring = laidOut(graph, { bandOverflow: false });
  let moved = 0;
  for (const [id, p] of Object.entries(bare.positions)) {
    const q = ring.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
  }
  eq(moved, 0, "no setting should give exactly the same result as choosing the single ring");

  // And it is the other one, not both being the same drawing.
  const rows = laidOut(graph, { bandOverflow: true });
  let differs = 0;
  for (const [id, p] of Object.entries(bare.positions)) {
    const q = rows.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) differs++;
  }
  ok(differs > 0, "and it should differ from stacked rows, or this assertion tests nothing");
}

// ---------------------------------------------------------------------------
suite("when the fan is wide enough both settings draw the same");

{
  // The choice is about what to do when a level does not fit. Where it fits,
  // there is nothing to choose between.
  const graph = narrowSectors(3, 4);
  const band = laidOut(graph, { bandOverflow: true });
  const ring = laidOut(graph, { bandOverflow: false });
  let moved = 0;
  for (const [id, p] of Object.entries(band.positions)) {
    const q = ring.positions[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
  }
  eq(moved, 0, "when everything fits, both settings should give the same drawing");
}

// ---------------------------------------------------------------------------
suite("the same setting lays out identically twice");

{
  for (const opts of [{ bandOverflow: true }, { bandOverflow: false }]) {
    const graph = narrowSectors(20, 8);
    const a = laidOut(graph, opts);
    const b = laidOut(graph, opts);
    let moved = 0;
    for (const [id, p] of Object.entries(a.positions)) {
      const q = b.positions[id];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) moved++;
    }
    eq(moved, 0, `bandOverflow=${opts.bandOverflow} laid out twice should put every node in the same place`);
  }
}



// ---------------------------------------------------------------------------
// The panel itself: opening it, choosing in it, and being remembered.

const opened = (opts) => {
  const g = loadGraphJs(Object.assign({ headless: true }, opts || {}));
  g.send({ command: "setGraph", graph: narrowSectors(20, 8) });
  return g;
};
/**
 * The crowded-level control: two buttons, each a picture of what it does.
 *
 * They carry their own value rather than holding the setting's, so which is
 * chosen is read off `aria-pressed` and choosing one is a click on it.
 */
const bandButtons = (g) =>
  (g.el("settings").query["[data-setting]"] || []).filter(
    (el) => el.getAttribute("data-setting") === "bandOverflow"
  );
const bandValue = (g) => {
  const on = bandButtons(g).find((el) => el.getAttribute("aria-pressed") === "true");
  return on ? on.value : null;
};
/** Choose, and then save — the panel keeps a draft until it is told to. */
const pick = (g, value) => {
  bandButtons(g).find((b) => b.value === value).dispatch("click");
  g.el("settings-save").dispatch("click");
};
const positionsOf = (g) => {
  const out = {};
  g.live.cy.nodes().forEach((n) => {
    const p = n.position();
    out[n.id()] = { x: p.x, y: p.y };
  });
  return out;
};

// ---------------------------------------------------------------------------
suite("the settings panel opens from the sidebar and takes over the corner");

{
  const g = opened();
  const settings = g.el("settings");
  const legend = g.el("legend");

  g.el("toggle-legend").dispatch("click");
  ok(!legend.classList.contains("hidden"), "the legend should open first");

  g.el("toggle-settings").dispatch("click");
  ok(!settings.classList.contains("hidden"), "the settings panel should open");
  ok(legend.classList.contains("hidden"), "one corner holds one thing at a time; the legend should close");
  eq(g.el("toggle-settings").getAttribute("aria-pressed"), "true", "the sidebar button should show as pressed");

  g.el("toggle-settings").dispatch("click");
  ok(settings.classList.contains("hidden"), "a second click should close it");
  eq(g.el("toggle-settings").getAttribute("aria-pressed"), "false", "the button should return to unpressed");
}

// ---------------------------------------------------------------------------
suite("a choice redraws at once");

{
  // Away from the default and back. Picking the default would change nothing,
  // and the assertion would pass on a drawing that never moved.
  const g = opened();
  const before = positionsOf(g);
  pick(g, "rows");
  const after = positionsOf(g);
  let moved = 0;
  for (const [id, p] of Object.entries(before)) {
    const q = after[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) moved++;
  }
  ok(moved > 0, `choosing the other layout should change the drawing, ${moved} nodes moved`);

  // And back again, to the same drawing — not merely to some other one.
  pick(g, "ring");
  const back = positionsOf(g);
  let differs = 0;
  for (const [id, p] of Object.entries(before)) {
    const q = back[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) differs++;
  }
  eq(differs, 0, "choosing back should return to the identical drawing");
}

// That a choice is handed somewhere, that a returning reader opens on it, and
// that a reader who never chose gets the default are asserted below against
// the host that keeps them —
// "a changed setting is handed to the host to keep", "a setting the host saved is applied on open", and "the graph draws when the host says nothing".

// ---------------------------------------------------------------------------
suite("the settings panel covers the whole view instead of sharing the legend's corner");

{
  // The corner is the legend's shape: a reference card read beside the
  // drawing. Settings are read instead of the drawing, and there are more of
  // them than a 260px column holds.
  const g = opened();
  const settings = g.el("settings");
  const legend = g.el("legend");
  const comment = g.el("comment");

  g.el("toggle-legend").dispatch("click");
  ok(!legend.classList.contains("hidden"), "the legend should open first");

  g.el("toggle-settings").dispatch("click");
  ok(!settings.classList.contains("hidden"), "the settings panel should open");
  ok(legend.classList.contains("hidden"), "the panel covers the legend's place, so the legend should close");
  eq(g.el("toggle-legend").getAttribute("aria-pressed"), "false", "the legend button should turn off too");
  ok(comment.classList.contains("hidden"), "and so should the comment box");
}

// ---------------------------------------------------------------------------
suite("the settings panel can be closed from itself");

{
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  ok(!g.el("settings").classList.contains("hidden"), "the panel should open first");
  g.el("settings-close").dispatch("click");
  ok(g.el("settings").classList.contains("hidden"), "the panel's own close button should close it");
  eq(g.el("toggle-settings").getAttribute("aria-pressed"), "false", "the sidebar button should return to unpressed");
}

// ---------------------------------------------------------------------------
suite("Esc leaves the settings");

{
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  ok(!g.el("settings").classList.contains("hidden"), "the panel should open first");
  g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "Escape" }));
  ok(g.el("settings").classList.contains("hidden"), "Esc should close the settings panel");

  // Nothing to leave: Escape on a closed panel is not an error and does not
  // reach anything else.
  g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "Escape" }));
  ok(g.el("settings").classList.contains("hidden"), "pressing again while closed should do no harm");
}

// ---------------------------------------------------------------------------
suite("while typing a search, Esc leaves search instead of closing settings");

{
  // Two Escapes on one press. Search's own Escape means "leave the field", and
  // it is bound on the input; the window handler must stand back while the
  // field has the keyboard, the way it does for `f` and `/`.
  const g = opened();
  g.el("toggle-settings").dispatch("click");
  g.el("symbol-search").dispatch("focus");
  g.sandbox.__listeners.keydown.forEach((fn) => fn({ key: "Escape" }));
  ok(!g.el("settings").classList.contains("hidden"), "with the cursor in the search box, Esc should not also close settings");
}

// ---------------------------------------------------------------------------
// The claim that the panel takes the whole surface does not live in the DOM
// the other suites drive — it lives in the stylesheet and the markup. Asserted
// there, because a claim with nowhere to fail is not being made.

const fs = require("fs");
const path = require("path");
const cssText = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");
const htmlText = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
  "utf8"
);

/** The body of the first rule whose selector list mentions `sel` as a whole id.
 *
 * As a substring it would also match `#settings-body .dot`, which is a
 * different element — so a rule added anywhere above `#settings` would answer
 * for it. The trailing guard is what makes the id whole. */
function ruleFor(sel) {
  const re = new RegExp(
    "(^|,|\\})\\s*([^{}]*" + sel + "(?![\\w-])[^{}]*)\\{([^}]*)\\}",
    "m"
  );
  const m = cssText.match(re);
  return m ? m[3] : null;
}

// ---------------------------------------------------------------------------
suite("the settings panel fills the drawing area");

{
  const own = ruleFor("#settings");
  ok(!!own, "expected #settings to have its own rule");
  ok(
    /inset:\s*0/.test(own || "") || /(top|left|right|bottom):\s*0/.test(own || ""),
    "it should fill the area it sits in"
  );
  ok(/overflow[^;]*:\s*auto/.test(cssText), "it should scroll when the content does not fit");

  // The panel does not share the legend's rule: the two are read at
  // different times and only one of them is a card.
  const shared = cssText.match(/#settings,\s*\n?#legend\s*\{/);
  ok(!shared, "it should not share a rule with #legend");
}

// ---------------------------------------------------------------------------
suite("the settings panel has close and reset buttons, and settings sit in named sections");

{
  const panel = htmlText.slice(htmlText.indexOf('id="settings"'));
  const end = panel.indexOf("</aside>");
  const inner = panel.slice(0, end);
  ok(/id="settings-close"/.test(inner), "the panel should have its own close button");
  ok(/id="settings-reset"/.test(inner), "and a reset-all button");
  ok(/id="settings-save"/.test(inner), "and a Save button, since changes are not saved by themselves");
  // No title band: the reader pressed a button marked Settings and this is the
  // only thing on screen, so a heading saying so spends room the settings need.
  ok(!/<h2/.test(inner), "there should be no heading band across the top");
  ok(/<section/.test(inner), "settings should sit in sections so new settings have somewhere to go");
  ok(/data-setting="bandOverflow"/.test(inner), "the crowded-level setting should be there");
}

// ---------------------------------------------------------------------------
suite("the default option comes first");

{
  // A reader scanning the panel to find out what a setting does starts at the
  // top, and what they find there should be what they are already looking at.
  const panel = htmlText.slice(htmlText.indexOf('id="settings"'));
  const inner = panel.slice(0, panel.indexOf("</aside>"));
  const order = [...inner.matchAll(/data-choice value="(ring|rows)"/g)].map((m) => m[1]);
  eq(order.join(","), "ring,rows", "the default single ring should be listed first");
  const pressedAt = inner.indexOf('aria-pressed="true"');
  const secondAt = inner.indexOf('value="rows"');
  ok(pressedAt > 0 && pressedAt < secondAt, "and the first one should be pressed at the start");
}

// ---------------------------------------------------------------------------
// Where a choice is kept.
//
// `vscode.setState` is the webview panel's own scratch space: it survives the
// panel being hidden and shown, and a window reload, and it goes with the
// panel when the tab is closed. The panel holds a dozen settings, and losing
// all of them per tab is a reason not to keep them there. So the host keeps
// them, and hands them down when a viewer opens.

/** A viewer told what the host has stored, before it is given a graph. */
const openedWith = (settings) => {
  const g = loadGraphJs({ headless: true });
  if (settings) g.send({ command: "setSettings", settings });
  g.send({ command: "setGraph", graph: narrowSectors(20, 8) });
  return g;
};
const saved = (g) => g.posted.filter((m) => m && m.command === "saveSettings");

// ---------------------------------------------------------------------------
suite("a setting the host saved is applied on open");

{
  const g = openedWith({ bandOverflow: true });
  eq(bandValue(g), "rows", "the control should show the value the host saved");

  // And the drawing is that one, not merely the control.
  const c = g.live.cy.getElementById("Root").position();
  let banded = 0;
  g.live.cy.nodes().forEach((n) => {
    const p = n.position();
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    if (r > 1 && Math.abs(r / 180 - Math.round(r / 180)) > 1e-6) banded++;
  });
  ok(banded > 0, `the graph should be drawn with that setting, ${banded} nodes stacked outward`);
}

// ---------------------------------------------------------------------------
suite("a changed setting is handed to the host to keep");

{
  const g = openedWith();
  eq(saved(g).length, 0, "nothing should be sent before a change");
  pick(g, "rows");
  const msgs = saved(g);
  ok(msgs.length > 0, "a changed setting should be sent to the host to save");
  const last = msgs[msgs.length - 1] || { settings: {} };
  eq(last.settings.bandOverflow, true, "the value sent should be the new choice");

  // Not the panel's own scratch space. The rail's collapsed flag lives
  // there, and that is the distinction: whether this tab's rail is
  // open is not a preference about every artifact.
  const st = g.state || {};
  ok(!("bandOverflow" in st), "settings should not be written to the webview's own state");
}

// ---------------------------------------------------------------------------
suite("the sidebar's open state stays with this tab");

{
  const g = openedWith();
  g.el("sidebar-toggle").dispatch("click");
  const st = g.state || {};
  ok("sidebarCollapsed" in st, "the sidebar's collapsed state should still be in the webview state");
  eq(saved(g).length, 0, "and it should not be sent to the host as a setting");
}

// ---------------------------------------------------------------------------
suite("the graph draws when the host says nothing");

{
  // No stored settings, and a host that never answers at all. Every setting
  // holds its default and the drawing is complete — which is also what the
  // rest of this file exercises.
  const g = openedWith();
  eq(bandValue(g), "ring", "with nothing saved the value should be the default");
  ok(g.live.cy.nodes().length > 100, `expected the whole graph drawn, got ${g.live.cy.nodes().length} nodes`);
}

// ---------------------------------------------------------------------------
suite("a setting that arrives late is still applied");

{
  // Messages to a webview arrive in order, so the host can send settings
  // first. The viewer must not depend on that: a viewer that only reads them
  // before its first drawing is one that hangs when the answer is slow.
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph: narrowSectors(20, 8) });
  const before = positionsOf(g);
  g.send({ command: "setSettings", settings: { bandOverflow: true } });
  const after = positionsOf(g);

  let moved = 0;
  for (const [id, p] of Object.entries(before)) {
    const q = after[id];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) moved++;
  }
  ok(moved > 0, `a setting received after the graph is drawn should redraw it, ${moved} nodes moved`);

  eq(bandValue(g), "rows", "the control should update too");

  // And it is not echoed back as a change the reader made.
  eq(saved(g).length, 0, "what the host sent should not be sent back to be saved again");
}

// ---------------------------------------------------------------------------
suite("while the panel is open, the wheel belongs to the panel, not the graph");

{
  // The wheel handler is bound on the element the settings panel lives inside.
  // Taking every event unconditionally, it would zoom a drawing nobody can see
  // when the settings are scrolled, and the panel, which is taller than the
  // room it has, could not be scrolled at all.
  const g = opened();
  const before = g.live.cy.zoom();
  g.el("main").dispatch("wheel", { deltaY: 120, deltaMode: 0, clientX: 600, clientY: 400 });
  ok(g.live.cy.zoom() !== before, "with the panel closed, the wheel should zoom as usual");

  g.el("toggle-settings").dispatch("click");
  const open = g.live.cy.zoom();
  const w2 = {
    deltaY: 120,
    deltaMode: 0,
    clientX: 600,
    clientY: 400,
    stopped: false,
    preventDefault() {
      this.stopped = true;
    },
    stopPropagation() {},
  };
  g.el("main").dispatch("wheel", w2);
  eq(g.live.cy.zoom(), open, "with the panel open the graph should not zoom");
  eq(w2.stopped, false, "and the event should not be stopped, or the panel cannot scroll");
}

// ---------------------------------------------------------------------------
suite("footer: undo on the left, confirm on the right, status next to the button it describes");

{
  // Save at the end, not in the middle with Reset beyond it: the end of the
  // reader's sweep belongs on the button that keeps work, not the one that
  // throws it away, and the words describing Save belong beside Save.
  const panel = htmlText.slice(htmlText.indexOf('id="settings-foot"'));
  const foot = panel.slice(0, panel.indexOf("</div>"));
  const order = [...foot.matchAll(/id="(settings-(?:reset|dirty|save))"/g)].map((m) => m[1]);
  eq(
    order.join(","),
    "settings-reset,settings-dirty,settings-save",
    "expected the order Reset, status, Save"
  );
}

// ---------------------------------------------------------------------------
suite("LAYOUT comes after the colours and the panel has one column");

{
  // Every row shows what it sets, so the panel is one list, and what matters
  // is the order — colour first,
  // because that is what a reader opens the panel for.
  const body = htmlText.slice(htmlText.indexOf('id="settings-body"'));
  const nodes = body.indexOf("<h3>Nodes</h3>");
  const edges = body.indexOf("<h3>Edges</h3>");
  const layout = body.indexOf("<h3>Layout</h3>");
  ok(nodes >= 0 && edges > nodes, "Nodes should come before Edges");
  ok(layout > edges, "Layout should come after the colours");
}

// ---------------------------------------------------------------------------
suite("the controls in the two LAYOUT rows sit at the far right");

{
  // Both rows in Layout sit flush right. In the line style's column the
  // crowded-level choices would sit in the middle of a row whose other cells
  // are empty, level with nothing.
  //
  // The matcher starts at `#settings-body` and refuses a match that crossed a
  // comment. A matcher that took any text containing the selector's name
  // would match a comment mentioning a deleted rule and capture the NEXT
  // rule's body — measuring another rule twice and passing while the thing it
  // named was gone.
  const rule = (sel) => {
    const m = cssText.match(
      new RegExp("(^|\\})\\s*(#settings-body[^{}]*" + sel + "(?![\\w-])[^{}]*)\\{([^}]*)\\}", "m")
    );
    if (!m || m[2].indexOf("*/") !== -1) return null;
    return m[3];
  };

  const grid = rule("\\.row-controls");
  const tracks = ((grid || "").match(/grid-template-columns:([^;]*)/) || [, ""])[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  ok(tracks > 0, `expected to read the column definition, got ${tracks} columns`);

  const choices = rule("\\.choices");
  ok(!!choices, "expected a rule for the two crowded level options");
  ok(
    choices && /grid-column:\s*\d+\s*\/\s*-1/.test(choices),
    `crowded level should extend to the last column (got ${(choices || "").match(/grid-column:[^;]*/) || "none"})`
  );
  ok(choices && /justify-self:\s*end/.test(choices), "crowded level should be right-aligned");

  const view = rule('input\\.num\\[data-setting="labelFloor"\\]');
  ok(!!view, "expected a rule for the smallest label number field");
  const col = Number(((view || "").match(/grid-column:\s*(\d+)/) || [])[1]);
  eq(col, tracks, `smallest label should be in the last column (${tracks} columns, got column ${col})`);
  ok(view && /justify-self:\s*end/.test(view), "smallest label should be right-aligned");
}

// ---------------------------------------------------------------------------
suite("the default view belongs to the reader");

{
  // What the reader gets whenever the viewer frames a large drawing for them.
  // The number is the smallest a label may be drawn at while the view is being
  // fitted, so raising it stops the fit sooner: the drawing comes up larger,
  // and more of it is off screen.
  //
  // `default view` rather than `opening view`, because opening is only one of
  // the times it decides what the reader sees — `Reset view` and a jump from
  // search go through the same fit.
  //
  // Expressed against the label rather than as a zoom because a zoom number
  // means a different amount of drawing on every window size, while what the
  // reader is choosing is whether they can still read it. `4.5` is tuned by
  // eye — 12 reads as far too magnified, 9 as still too magnified — and it is
  // the default; the number is the reader's to change.
  const zoom = (g) => g.live.cy.zoom();
  const control = (g) =>
    (g.el("settings").query["[data-setting]"] || []).find(
      (el) => el.getAttribute("data-setting") === "labelFloor"
    );
  const FONT = 15; // BASE_FONT_SIZE — the floor is a label size, not a zoom

  const g = opened();
  ok(!!control(g), "expected this control on the panel");
  eq(zoom(g), 4.5 / FONT, "with nothing set it should be the tuned default");

  const el = control(g);
  el.value = "9";
  el.dispatch("change");
  eq(zoom(g), 9 / FONT, "a larger value should frame closer, visible at once without saving or reopening");

  el.value = "2";
  el.dispatch("change");
  eq(zoom(g), 2 / FONT, "a smaller value should show more");

  el.value = "4.5";
  el.dispatch("change");
  eq(zoom(g), 4.5 / FONT, "the default should be selectable again");

  // It follows the reader the way every other setting does.
  el.value = "9";
  el.dispatch("change");
  g.el("settings-save").dispatch("click");
  const sent = g.posted.filter((m) => m && m.command === "saveSettings").pop();
  eq(sent && sent.settings && sent.settings.labelFloor, 9, "the saved value should be this one");

  const again = opened();
  again.send({ command: "setSettings", settings: sent.settings });
  eq(zoom(again), 9 / FONT, "the next open should use the reader's choice");

  // Reset walks the settings table, so it reaches this one too.
  again.el("settings-reset").dispatch("click");
  eq(zoom(again), 4.5 / FONT, "after Reset it should return to the default");
}

{
  // The reason for the name. `Reset view` frames the drawing by the same rule
  // the opening does, so the reader's number decides what they get there too —
  // which is why the row says `default view` and not `opening view`. Measured
  // rather than asserted in a comment: the two share `frameOn`, and a claim
  // about a shared path is exactly the kind that stops being true quietly.
  const zoom = (g) => g.live.cy.zoom();
  const FONT = 15;
  const control = (g) =>
    (g.el("settings").query["[data-setting]"] || []).find(
      (el) => el.getAttribute("data-setting") === "labelFloor"
    );

  const g = opened();
  const el = control(g);
  el.value = "9";
  el.dispatch("change");

  // Somewhere else entirely, the way a reader who has been reading gets.
  g.live.cy.zoom(3);
  ok(zoom(g) !== 9 / FONT, "the camera should have moved first");

  g.el("reset-view").dispatch("click");
  eq(zoom(g), 9 / FONT, "Reset view should also frame by the reader's choice, not only on open");
}

{
  // A stored setting outlives the control that wrote it and arrives from the
  // host unchecked, so what the control's own min and max say is enforced
  // where the number is read rather than only where it is typed.
  const zoom = (g) => g.live.cy.zoom();
  const FONT = 15;
  for (const [stored, want, what] of [
    [40, 15, "above the upper limit should clamp to it"],
    [0.1, 2, "below the lower limit should clamp to it"],
    [0, 4.5, "zero is not a view and should count as unset"],
    [-3, 4.5, "so should a negative number"],
    ["9", 4.5, "a string is not a number and should count as unset; nothing the host stores should break the view"],
  ]) {
    const g = opened();
    g.send({ command: "setSettings", settings: { labelFloor: stored } });
    eq(zoom(g), want / FONT, `${what} (stored ${JSON.stringify(stored)})`);
  }
}

module.exports = {};
