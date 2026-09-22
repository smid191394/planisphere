"use strict";

// What the legend says, checked against what the drawing does.
//
// A legend is the one thing in the viewer a reader cannot verify. Everything
// else is on screen beside its explanation; the legend *is* the explanation.
// So when a rule behind a mark changes, nothing fails — the drawing changes,
// the spec changes, and the sentence the reader is shown goes on describing
// a rule that no longer holds.
//
// The list of marks is therefore derived from the stylesheet rather than
// written down twice. `node[kind = "..."]` and `edge[kind = "..."]` are the
// authority on what the drawing can draw: a mark added there and not here is
// what this file is for.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const SRC = path.join(__dirname, "..", "..", "src");
const document = fs.readFileSync(path.join(SRC, "graphDocument.ts"), "utf8");
const graphJs = fs.readFileSync(path.join(__dirname, "..", "graph.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");

const legend = document.slice(
  document.indexOf('<aside id="legend"'),
  document.indexOf("</aside>", document.indexOf('<aside id="legend"'))
);

/** The rows, as the reader reads them. */
const rows = [...legend.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => {
  const html = m[1];
  const pick = (cls) => {
    const at = html.indexOf(`class="${cls}"`);
    if (at < 0) return "";
    const open = html.indexOf(">", at) + 1;
    return html.slice(open, html.indexOf("</span>", open));
  };
  return {
    html,
    term: pick("term").trim(),
    gloss: pick("gloss").replace(/<[^>]+>/g, "").replace(/^\s*[—-]\s*/, "").trim(),
    text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
});

/** The sections, each with the rows under it. */
const sections = [];
for (const m of legend.matchAll(/<h3>([^<]*)<\/h3>([\s\S]*?)(?=<h3>|$)/g)) {
  sections.push({ title: m[1].trim(), body: m[2] });
}

const marksInStyle = (which) =>
  [...graphJs.matchAll(new RegExp(`selector: '${which}\\[kind = "(\\w+)"\\]'`, "g"))]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);

// ---------------------------------------------------------------------------
suite("every mark that can be drawn has a name");

{
  const named = rows.map((r) => r.term).filter(Boolean);

  for (const kind of marksInStyle("node")) {
    ok(named.includes(kind), `legend is missing node kind "${kind}" — the stylesheet can draw it`);
  }
  for (const kind of marksInStyle("edge")) {
    ok(named.includes(kind), `legend is missing edge kind "${kind}" — the stylesheet can draw it`);
  }

  // Every colour the reader can set is a mark they can see, so the settings
  // panel's palette is a second authority on what the legend owes a name.
  // This is the one that covers `focus`: the panel offers a colour for it, and
  // no kind rule names it.
  for (const m of graphJs.matchAll(
    /key: "palette\.[\w-]+"[^}]*label: "([^"]+)"/g
  )) {
    ok(named.includes(m[1]), `legend is missing "${m[1]}" — the settings panel lets people change its colour`);
  }

  // The marks that are not a kind. Matched on the swatch, not on the prose:
  // the row is identified by the thing it shows.
  for (const [swatch, what] of [
    ["node-center", "the centre"],
    ["stacked", "the folded double ring"],
    ["node-focus", "the selection frame"],
  ]) {
    ok(
      rows.some((r) => r.html.includes(swatch)),
      `legend is missing ${what} (.${swatch})`
    );
  }

  // …and one that must not come back. A node drawn smaller is a satellite, and
  // a satellite is a `function` or a `file` in 96% of the corpus — both of
  // which the reader already reads off the colour. The 4% that are types are
  // the case such a row gets wrong: such a node is seated beside the function
  // that uses it, functions are hidden by default, so it sits beside nothing
  // while the row would say it orbits what is next to it.
  ok(
    !rows.some((r) => r.html.includes("orbiting")),
    "legend should not have a \"small node\" row — the colour already says it, and its gloss is false on the default view"
  );
}

// ---------------------------------------------------------------------------
suite("the centre row describes the mark, not how it is picked");

{
  const centre = rows.find((r) => r.html.includes("node-center"));
  ok(!!centre, "the centre row is found");
  if (centre) {
    // The rule can move. A legend that describes the criterion goes stale every
    // time it does; one that describes the mark does not.
    const criterion = /reach|most of|entry point|nearest|closest|largest|biggest/i;
    ok(
      !criterion.test(centre.gloss),
      `the centre row should not describe how it is picked, got "${centre.gloss}"`
    );
    ok(centre.gloss.length > 0, "but it should still say what it is");
  }
}

// ---------------------------------------------------------------------------
suite("what you can do is in one section");

{
  const withKbd = sections.filter((s) => s.body.includes("<kbd>"));
  eq(withKbd.length, 1, "keys should appear in only one section");

  const doing = withKbd[0];
  if (doing) {
    ok(
      /click/i.test(doing.body),
      `the keys section should cover clicking too — "what can I do here" is one question, got title "${doing.title}"`
    );
  }
  ok(
    !sections.some((s) => /^keys$/i.test(s.title)),
    "there should be no section called just Keys"
  );
  ok(
    !sections.some((s) => /^clicking$/i.test(s.title)),
    "there should be no section called just Clicking"
  );
}

// ---------------------------------------------------------------------------
suite("every bound key is in the legend");

{
  // The legend is the one place this viewer is documented, and a shortcut
  // nobody can find is a shortcut nobody has. Each key is declared once in
  // `graph.js` as a `_KEY` constant saying it is listed here — so the list is
  // taken from there rather than written down a second time, and a key added
  // to the viewer and not to the legend is what this suite is for.
  const keys = [...graphJs.matchAll(/const\s+([A-Z_]+_KEY)\s*=\s*"([^"]+)"/g)].map((m) => ({
    name: m[1],
    key: m[2],
  }));
  ok(keys.length >= 3, `every key should be read from the source, got ${keys.length}`);

  const shown = [...legend.matchAll(/<kbd>([\s\S]*?)<\/kbd>/g)].map((m) => m[1].trim());
  for (const { name, key } of keys) {
    ok(
      shown.includes(key),
      `${name} binds "${key}", it should be in the legend — listed: ${JSON.stringify(shown)}`
    );
  }
}

// ---------------------------------------------------------------------------
suite("the caveat is a sentence, not a section");

{
  ok(
    !sections.some((s) => /caveat/i.test(s.title)),
    "Caveat should not be a heading"
  );
  ok(
    /lexical/.test(legend),
    "but the sentence should stay — edges are textual, not a runtime call graph"
  );
}

// ---------------------------------------------------------------------------
suite("a term whose name says enough needs no gloss");

{
  const cls = rows.find((r) => r.term === "class");
  if (cls) eq(cls.gloss, "", "class needs no gloss");

  // A gloss longer than the thing it explains has stopped being one. The cap
  // is on a gloss, which is what explains a named mark — not on the caveat,
  // which is a sentence and is meant to be one. There is room for exactly one
  // of those, or the rule has no teeth.
  //
  // The number is the column, not a preference. The panel is 260px wide and
  // keeps 14px of padding each side; a node row spends 22px on the swatch, 8px
  // of gap, about 70px on the longest name and 8px more of gap — so a gloss
  // has roughly 124px, which at 11px is about 22 characters. A gloss over the
  // cap is one that wraps: a 44-character line takes three rows.
  const CAP = 28;
  for (const r of rows) {
    if (!r.term || !r.gloss) continue;
    ok(
      r.gloss.length <= CAP,
      `the gloss for "${r.term}" is ${r.gloss.length} characters, over ${CAP}: "${r.gloss}"`
    );
  }

  const unnamed = rows.filter((r) => !r.term);
  eq(unnamed.length, 1, "only the caveat row may be a bare sentence, every other row should have a name");
}

// ---------------------------------------------------------------------------
suite("still readable in full when it does not fit");

{
  // A legend is a fixed list in a box of the window's height, and the window is
  // not the viewer's to choose. Sixteen rows in three sections need about
  // 400px; a split editor or a short window gives less, and what does not fit
  // is simply not reachable.
  const at = css.indexOf("#legend {");
  const block = at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  ok(/max-height/.test(block), "#legend should have a height cap");
  ok(/overflow-y:\s*auto/.test(block), "the overflow should be scrollable");
}

// ---------------------------------------------------------------------------
suite("the wheel over the legend scrolls the legend, not the canvas");

{
  // The drawing's wheel handler is bound on the ancestor with `capture: true`,
  // so it runs first; if it called `preventDefault` on every wheel event, that
  // would include the ones meant for a panel that cannot scroll without them.
  const id = (sym) => `/p/m.py::class::${sym}`;
  const g = loadGraphJs({ headless: true });
  g.send({
    command: "setGraph",
    graph: {
      nodes: ["Root", "A", "B"].map((s) => ({
        id: id(s), name: s, kind: "class", file: "/p/m.py", line: 1,
      })),
      edges: [
        { from: id("Root"), to: id("A"), kind: "uses" },
        { from: id("Root"), to: id("B"), kind: "uses" },
      ],
    },
  });

  const legend = g.el("legend");
  legend.classList.remove("hidden");

  const turn = (target) => {
    g.live.cy.zoom(1);
    g.el("main").dispatch("wheel", {
      deltaY: -100, deltaMode: 0, clientX: 600, clientY: 400, target,
    });
    return g.live.cy.zoom();
  };

  ok(turn(g.el("main")) !== 1, "the wheel over the canvas still zooms");
  eq(turn(legend), 1, "the wheel over the legend should not change the canvas zoom");
}

// ---------------------------------------------------------------------------
suite("the wheel over the comment panel scrolls the panel, not the canvas");

{
  // The panel beside the drawing — a node's comment and its members — is a
  // child of the same element, and a type with 69 methods lists more than the
  // panel has room for. A handler that took the event would zoom the drawing
  // instead of letting the list scroll.
  const id = (sym) => `/p/m.py::class::${sym}`;
  const g = loadGraphJs({ headless: true });
  g.send({
    command: "setGraph",
    graph: {
      nodes: ["Root", "A"].map((s) => ({ id: id(s), name: s, kind: "class", file: "/p/m.py", line: 1 })),
      edges: [{ from: id("Root"), to: id("A"), kind: "uses" }],
    },
  });

  const panel = g.el("comment");
  const turn = (target) => {
    g.live.cy.zoom(1);
    g.el("main").dispatch("wheel", { deltaY: -100, deltaMode: 0, clientX: 600, clientY: 400, target });
    return g.live.cy.zoom();
  };

  panel.classList.remove("hidden");
  eq(turn(panel), 1, "the wheel over the comment panel should not change the canvas zoom");
  ok(turn(g.el("main")) !== 1, "while the panel is open, the wheel over the canvas still zooms");
  panel.classList.add("hidden");
  ok(turn(panel) !== 1, "once the panel is closed, that spot is the canvas");
}

module.exports = {};
