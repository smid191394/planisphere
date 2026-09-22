"use strict";

// Who decides what the drawing is about.
//
// `centerClassId` is written in one place, `pickTopClass`, and read
// everywhere else. A criterion chooses it, and no criterion is right for
// every project, because the question a reader opens
// a drawing with is not the same one every time. So they can say.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const N = (id, kind) => ({ id, name: id, kind: kind || "class", file: "/p/" + id + ".py", line: 1 });

/**
 * A hub with a long thread hanging off it.
 *
 * `Thread0` is where a count of out-reach would land — it can walk the whole
 * chain and then the hub's children — and rooted there, the first rings come
 * out empty. `Hub` is where a reader would put it.
 */
function threadAndHub() {
  const nodes = [N("Hub")];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(N("Kid" + i));
    edges.push({ from: "Hub", to: "Kid" + i, kind: "inherits" });
  }
  let prev = "Hub";
  for (let i = 0; i < 4; i++) {
    nodes.push(N("Thread" + i));
    edges.push({ from: "Thread" + i, to: prev, kind: "uses" });
    prev = "Thread" + i;
  }
  return { nodes, edges };
}

function opened(settings) {
  const g = loadGraphJs({ headless: true });
  if (settings) g.send({ command: "setSettings", settings });
  g.send({ command: "setGraph", graph: threadAndHub() });
  return g;
}

/** Which node the drawing is built around, read off the marked centre. */
const centreOf = (g) => {
  const marked = g.live.cy.nodes().filter((n) => n.hasClass("primary"));
  return marked.length ? marked[0].id() : null;
};

// ---------------------------------------------------------------------------
suite("the node the reader names is the centre");

{
  const g = opened({ centre: "Thread3" });
  eq(centreOf(g), "Thread3", "once named, it is the centre");

  // And the drawing is built around it, not merely marked there: the node it
  // was named on sits at the origin of its own group.
  const c = g.live.cy.getElementById("Thread3").position();
  let nearest = Infinity;
  g.live.cy.nodes().forEach((n) => {
    if (n.id() === "Thread3") return;
    const p = n.position();
    nearest = Math.min(nearest, Math.hypot(p.x - c.x, p.y - c.y));
  });
  ok(nearest > 0 && nearest < 400, `some node should sit on its first ring, nearest r=${Math.round(nearest)}`);
}

// ---------------------------------------------------------------------------
suite("with none named, the automatic pick is used");

{
  const g = opened();
  const auto = centreOf(g);
  ok(!!auto, "the automatic pick finds a centre");
  eq(auto, g.live.centerClassId, "and it is the one pickTopClass picks");
}

// ---------------------------------------------------------------------------
suite("naming a node not in the graph is silently ignored");

{
  // Settings follow the reader from one artifact to the next, and a node id is
  // a file path plus a symbol — so opening a different project with a stored
  // centre is the normal case, not the edge case.
  const g = opened({ centre: "/somewhere/else.py::class::Whatever" });
  const auto = loadGraphJs({ headless: true });
  auto.send({ command: "setGraph", graph: threadAndHub() });
  eq(centreOf(g), centreOf(auto), "should fall back to the automatic pick");
  ok(g.live.cy.nodes().length > 0, "and the graph is still drawn");
  eq(g.warnings.length, 0, "should not be treated as an error");
}

// ---------------------------------------------------------------------------
suite("making a node the centre from the node itself");

/** Press a key on the graph, the way the reader does with the canvas focused. */
const press = (g, key) => g.sandbox.__listeners.keydown.forEach((fn) => fn({ key }));

{
  // Focused something the drawing would not have chosen. `Hub` is what the
  // criterion picks for this shape, so asking for it would prove nothing — a
  // tail of the chain is a node a reader might want and the drawing would not.
  //
  // Reached from the node with a key rather than from the right button. The
  // button carries no name anywhere and has a view of its own to open; a key
  // can be listed in the legend, which is where this viewer is documented.
  const g = opened();
  ok(centreOf(g) !== "Thread3", "first check the automatic pick is not it");

  g.live.cy.getElementById("Thread3").emit("tap");
  press(g, "c");
  eq(centreOf(g), "Thread3", "choosing it and pressing the key makes it the centre");

  // It is a setting like any other: the drawing shows it at once, the store
  // hears about it when the reader says so.
  eq(
    g.posted.filter((m) => m && m.command === "saveSettings").length,
    0,
    "nothing should be sent before Save is pressed"
  );
}

{
  // The way back, and the reason the key toggles: the panel has no centre row,
  // so without this the only way to undo one keypress is the Reset that
  // returns every other setting too.
  const g = opened();
  const auto = loadGraphJs({ headless: true });
  auto.send({ command: "setGraph", graph: threadAndHub() });

  g.live.cy.getElementById("Thread3").emit("tap");
  press(g, "c");
  eq(centreOf(g), "Thread3", "name one first");

  // The same gesture again, in full: the press let go of the node, so handing
  // the choice back is point-and-press rather than a second press on a node
  // the reader can no longer see they are still holding.
  g.live.cy.getElementById("Thread3").emit("tap");
  press(g, "c");
  eq(centreOf(g), centreOf(auto), "pressing it again on the same node hands back to the automatic pick");
}

{
  // The press is the end of what the reader was doing with that node. Leaving
  // it lit afterwards says it is still the subject of the next keystroke, when
  // what it has become is the subject of the drawing.
  const g = opened();
  g.live.cy.getElementById("Thread3").emit("tap");
  ok(g.live.cy.getElementById("Thread3").hasClass("focused"), "first check the click actually chose it");

  press(g, "c");
  eq(
    g.live.cy.nodes().filter((n) => n.hasClass("focused")).length,
    0,
    "no node should still be chosen after pressing c"
  );

  // And the next press does nothing, there being nothing named — rather than
  // acting on a node the reader thinks they have let go of.
  const after = centreOf(g);
  press(g, "c");
  eq(centreOf(g), after, "pressing again after letting go should target no node");
}

{
  // Capitals too, the way the fit key already takes both.
  const g = opened();
  g.live.cy.getElementById("Thread3").emit("tap");
  press(g, "C");
  eq(centreOf(g), "Thread3", "upper case works too");
}

{
  // Nothing focused is not an error. The key says "this one", and there is no
  // this one, so the drawing is left where it is.
  const g = opened();
  const before = centreOf(g);
  press(g, "c");
  eq(centreOf(g), before, "pressing with no node chosen should not move the centre");
}

{
  // A name with a `c` in it must not keep re-centring the drawing as it is
  // typed. This is the same hazard the fit key guards against, and every
  // single-letter shortcut is a way to walk into it.
  const g = opened();
  const before = centreOf(g);
  g.live.cy.getElementById("Thread3").emit("tap");
  press(g, "/");
  press(g, "c");
  eq(centreOf(g), before, "with the cursor in the search box, typing c is typing, not naming a centre");
}

{
  // The right button opens the view of what a node reaches, and that view is
  // rooted on the node — but naming the drawing's centre is the `c` key's
  // alone. Nothing is stored, and
  // leaving the view finds the centre where it was.
  const g = opened();
  const before = centreOf(g);
  g.live.cy.getElementById("Thread3").emit("tap");
  g.live.cy.getElementById("Thread3").emit("cxttap");
  ok(!g.settingAt("centre"), "right-click does not name a centre — that belongs to c alone");
  press(g, "Escape");
  eq(centreOf(g), before, "after leaving the right-click view, the centre is unchanged");
}

// ---------------------------------------------------------------------------
suite("handing back to the automatic pick");

{
  // The centre has no row in the panel — it is set on the node, not among the
  // settings — so the way back is the panel's Reset, which walks the settings
  // table rather than the controls on screen and so reaches a setting that has
  // no control at all. That is the whole reason Reset walks the table.
  const g = opened({ centre: "Thread3" });
  eq(centreOf(g), "Thread3", "first check it is the named one");
  ok(
    !(g.el("settings").query["[data-revert]"] || []).some(
      (el) => el.getAttribute("data-revert") === "centre"
    ),
    "the panel should have no centre row"
  );

  g.el("settings-reset").dispatch("click");

  const auto = loadGraphJs({ headless: true });
  auto.send({ command: "setGraph", graph: threadAndHub() });
  eq(centreOf(g), centreOf(auto), "after handing back it should be the automatic pick");
}

// ---------------------------------------------------------------------------
suite("after naming a centre, Reset view returns to it");

{
  // Reset frames the tree nearest the camera, which is right while nobody has
  // said otherwise — pan to a small group and reset should stay there. Once
  // the reader has named a centre, pointing anywhere else is the viewer
  // disagreeing with them about the thing they just settled.
  const g = opened({ centre: "Thread3" });
  const hub = g.live.cy.getElementById("Thread3").position();

  // Look somewhere else entirely first.
  g.live.cy.pan({ x: -4000, y: -4000 });
  g.el("reset-view").dispatch("click");

  const ext = g.live.cy.extent();
  const midX = (ext.x1 + ext.x2) / 2;
  const midY = (ext.y1 + ext.y2) / 2;
  const off = Math.hypot(midX - hub.x, midY - hub.y);
  ok(off < 200, `Reset should return to the named centre, got ${Math.round(off)} away from it`);
}

// ---------------------------------------------------------------------------
suite("with no centre named, Reset view still returns to the nearest tree");

{
  const g = opened();
  const auto = g.live.cy.nodes().filter((n) => n.hasClass("primary"))[0];
  ok(!!auto, "the automatic pick finds a centre");
  g.el("reset-view").dispatch("click");
  const ext = g.live.cy.extent();
  const midX = (ext.x1 + ext.x2) / 2;
  const midY = (ext.y1 + ext.y2) / 2;
  const p = auto.position();
  ok(
    Math.hypot(midX - p.x, midY - p.y) < 200,
    "with none named, Reset view frames the automatic centre"
  );
}

module.exports = {};
