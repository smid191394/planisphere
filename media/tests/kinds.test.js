"use strict";

// What the drawing is allowed to root on.
//
// `isTreeVertex` cannot ask `kind === "class"`: that is only true of Python.
// Measured against three real TypeScript projects, between 52% and 60% of
// top-level declarations are type-shaped and not classes — zod declares 52
// classes among 1,816 symbols — so a viewer that roots only on classes would
// arrange such a drawing around 3% of it.
//
// The rule is not a longer list of kind names. It is the inversion: `function`
// and `file` orbit, and everything else is a type. Two names the artifact
// contract closes, instead of an open-ended list the viewer has to be taught
// one language at a time.

const { loadGraphJs, suite, ok, eq, allVisible } = require("./harness.js");

const g = loadGraphJs();

/** A graph from a kind-per-id map and a list of [from, to, kind] edges. */
function graphOf(kindOf, edges) {
  const nodes = Object.keys(kindOf).map((id) => ({
    id,
    name: id,
    kind: kindOf[id],
    file: "m.ts",
    line: 1,
  }));
  return {
    nodes,
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind || "uses" })),
  };
}

const index = (graph) => {
  const byId = {};
  for (const n of graph.nodes) byId[n.id] = n;
  return byId;
};

suite("a graph with no class still grows a tree");

// Shaped like zod: interfaces relating to interfaces, functions hanging off
// them. Not one `class` node anywhere.
{
  const kindOf = { Root: "interface", A: "interface", B: "interface", C: "interface" };
  const edges = [
    ["Root", "A", "inherits"],
    ["Root", "B", "inherits"],
    ["A", "C", "inherits"],
  ];
  for (let i = 0; i < 6; i++) {
    kindOf["fn" + i] = "function";
    edges.push(["fn" + i, i < 3 ? "Root" : "A", "uses"]);
  }
  const graph = graphOf(kindOf, edges);
  const byId = index(graph);

  ok(g.graphHasTypes(graph), "the graph should have a type to root the tree");
  for (const id of ["Root", "A", "B", "C"]) {
    ok(g.isTreeVertex(graph, byId[id]), `${id} should be a tree vertex`);
  }
  for (let i = 0; i < 6; i++) {
    ok(!g.isTreeVertex(graph, byId["fn" + i]), `fn${i} should not be a tree vertex`);
  }

  const out = g.computeClassRingPositions(graph, "Root", allVisible(graph));
  eq(Object.keys(out.positions).length, graph.nodes.length, "every node should have a position");
  const origin = out.positions.Root;
  const r = (id) =>
    Math.hypot(out.positions[id].x - origin.x, out.positions[id].y - origin.y);
  ok(r("A") > 0 && r("B") > 0, "the interfaces should be placed on a ring outside the centre");
  ok(Math.abs(r("A") - r("B")) < 1, "two interfaces on the same level should share a radius");
}

suite("when classes are a minority, the tree does not root only on classes");

// Three classes among forty-one interfaces. An escape hatch that let types
// root only when a graph has no classes (`!graphHasClasses`) would stay shut
// here, because three classes exist, and demote every interface to a
// satellite.
{
  const kindOf = { Hub: "interface" };
  const edges = [];
  for (let i = 0; i < 40; i++) {
    kindOf["I" + i] = "interface";
    edges.push(["Hub", "I" + i, "inherits"]);
  }
  for (let i = 0; i < 3; i++) {
    kindOf["K" + i] = "class";
    edges.push(["K" + i, "I0", "uses"]);
  }
  const graph = graphOf(kindOf, edges);

  let vertices = 0;
  for (const n of graph.nodes) if (g.isTreeVertex(graph, n)) vertices++;
  eq(vertices, 44, "all forty-one interfaces and three classes should be vertices");

  // The centre is chosen among all nodes by nearness, so a hub with forty
  // edges wins over a class with one — kind does not enter into it.
  eq(g.pickTopClass(graph), "Hub", "the centre should be the type closest to everything, not a class");
}

suite("a kind the graph has never heard of is a type");

{
  const graph = graphOf(
    { S: "struct", T: "trait", fn: "function", mod: "file" },
    [
      ["S", "T", "inherits"],
      ["fn", "S", "uses"],
    ]
  );
  const byId = index(graph);

  ok(g.isTreeVertex(graph, byId.S), "struct should be a vertex");
  ok(g.isTreeVertex(graph, byId.T), "trait should be a vertex");
  ok(!g.isTreeVertex(graph, byId.fn), "function should not be a vertex");
  ok(!g.isTreeVertex(graph, byId.mod), "file should not be a vertex");

  // …and it is drawn as a type is drawn. The base `node` rule carries the type
  // colour and only `function` and `file` override it, so a kind nothing names
  // inherits the type colour rather than the file colour.
  const style = g.graphStyle();
  const sel = (s) => style.find((rule) => rule.selector === s);
  const base = sel("node");
  ok(base && base.style["background-color"], "the base node rule should carry the type colour");
  const fileRule = sel('node[kind = "file"]');
  ok(fileRule, "file should have its own rule");
  ok(
    base && fileRule && base.style["background-color"] !== fileRule.style["background-color"],
    "the type colour should not be the file colour"
  );
}

suite("the legend and settings panel follow the kinds the artifact actually has");

{
  const withFiles = graphOf({ A: "class", f: "function", m: "file" }, []);
  const noFiles = graphOf({ A: "class", B: "interface", f: "function" }, []);

  eq([...g.kindsInGraph(withFiles)].sort().join(","), "class,file,function", "all three should be present");
  eq([...g.kindsInGraph(noFiles)].sort().join(","), "class,function,interface", "there should be no file");

  // The rows exist in the markup for every kind the viewer names; which of
  // them a reader sees follows the graph. Keeping them static is what lets
  // legend.test.js go on deriving the list of marks from the stylesheet.
  // Elements with a real classList, not plain objects carrying a `hidden`
  // field. An assertion on `{dataset, hidden}` could only prove that the
  // function set something — it would pass while every row stayed on
  // screen, because `#legend li { display: flex }` beats
  // the browser's `[hidden]` rule. What decides whether a row is seen is which
  // mechanism is used, so that is what the test has to read.
  const stub = (kind) => {
    const classes = new Set();
    return {
      dataset: { kind },
      classList: {
        toggle(c, on) {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
    };
  };
  const rows = ["class", "interface", "type", "enum", "function", "file"].map(stub);
  const shown = () =>
    rows
      .filter((row) => !row.classList.contains("hidden"))
      .map((row) => row.dataset.kind)
      .sort()
      .join(",");

  g.syncKindRows(rows, noFiles);
  eq(shown(), "class,function,interface", "only the kinds in the graph should be shown");
  g.syncKindRows(rows, withFiles);
  eq(shown(), "class,file,function", "a different graph should change the rows shown");
}

suite("a row is hidden in a way CSS can actually hide");

{
  // Setting the `hidden` property is not enough: nothing in graph.css
  // matches it, and `#legend li { display: flex }` wins. Both halves
  // have to hold — the mechanism the code uses, and the rule that makes it
  // mean anything.
  const fs = require("fs");
  const path = require("path");
  const js = fs.readFileSync(path.join(__dirname, "..", "graph.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");

  const fn = js.slice(js.indexOf("function syncKindRows"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  ok(/classList\.toggle\("hidden"/.test(body), "rows should be hidden with the hidden class");
  ok(!/\brow\.hidden\s*=/.test(body), "the hidden attribute should not be used; CSS cannot override it");

  const rule = css.match(/\.hidden\s*\{[^}]*\}/);
  ok(!!rule, "graph.css should define .hidden");
  ok(rule && /display:\s*none/.test(rule[0]), ".hidden should be display: none");
  ok(
    rule && /!important/.test(rule[0]),
    ".hidden should carry !important, or the display: flex on #legend li wins"
  );
}

suite("a mark that is not a kind is listed only when it can be drawn");

{
  // `doubled rim` marks several symbols folded into one node. tinydb folds
  // nothing, and no click will make it: a key to a mark that is not there.
  const stub = (attr, value) => {
    const classes = new Set();
    return {
      dataset: { [attr]: value },
      classList: {
        toggle(c, on) {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
    };
  };
  const graph = graphOf({ A: "class", f: "function" }, []);
  const row = stub("mark", "folded");
  const kindRow = stub("kind", "class");

  g.syncKindRows([row, kindRow], graph, {});
  ok(row.classList.contains("hidden"), "with no folded group, the doubled rim row should be hidden");
  ok(!kindRow.classList.contains("hidden"), "the kind rows should be unaffected");

  g.syncKindRows([row, kindRow], graph, { "g:Thing": { members: ["A"] } });
  ok(!row.classList.contains("hidden"), "with a folded group it should be shown");
}

suite("what is hidden by default is still worth listing");

{
  // Functions are hidden until the reader asks for them. What a function is
  // drawn as is still worth a row: the test is what this artifact carries, not
  // what is on screen this instant, or the legend would flicker as the reader
  // toggles.
  const graph = graphOf({ A: "class", f: "function" }, []);
  eq([...g.kindsInGraph(graph)].sort().join(","), "class,function", "functions in the graph should count");
}

suite("each settings panel row shows the colour it sets");

{
  // A colour picker shows a flat square; the drawing does not draw flat
  // squares. And a fixed sample drawing cannot grow: three children of its
  // centre a third of a circle apart show exactly Python's three kinds, and
  // never `interface`, `type` or `enum`.
  const fs = require("fs");
  const path = require("path");
  const doc = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
    "utf8"
  );
  const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");

  const panel = doc.slice(doc.indexOf('<aside id="settings"'), doc.indexOf("</aside>", doc.indexOf('<aside id="settings"')));
  // Split on where a row starts, not on how it ends. Rows close with
  // `</span></div>` or `</div></div>` depending on what they hold, and a
  // terminator-matching regex would silently swallow several rows into one.
  // `class="row"` and `class="row row-edge"` are both rows. Requiring the
  // quote straight after `row` would let every edge row fall into the chunk
  // before it, and the assertions below would then pass on the first match in
  // a chunk holding ten settings.
  const rows = panel
    .split(/(?=<div class="row[ "])/)
    .filter((chunk) => /^<div class="row[ "]/.test(chunk));

  const colourRows = rows.filter((r) => /data-setting="palette\.node-[\w-]+"/.test(r));
  ok(colourRows.length >= 6, `expected at least six node colour rows, got ${colourRows.length}`);

  for (const row of colourRows) {
    const key = row.match(/data-setting="palette\.(node-[\w-]+)"/)[1];
    // The dot's class is the mark's name and the setting's key is the
    // variable's; for the focused node's rim those differ — `node-focus` is
    // the mark, `--node-focus-border` is what it reads. So the test is that
    // the row's dot reads the row's variable, not that the two names match.
    const dot = row.match(/class="dot ([\w-]+)"/);
    ok(!!dot, `the palette.${key} row should carry a dot`);
    if (!dot) continue;
    const rule = css.match(
      new RegExp(`(^|\\})\\s*([^{}]*\\.dot\\.${dot[1]})\\s*\\{([^}]*)\\}`, "m")
    );
    ok(!!rule, `graph.css should have a .dot.${dot[1]} rule`);
    if (rule) {
      ok(
        !/#legend/.test(rule[2]),
        `.dot.${dot[1]} selector should not be scoped under #legend, since the panel uses it too (got ${rule[2].trim()})`
      );
      ok(
        rule[3].includes(`var(--${key})`),
        `.dot.${dot[1]} should read --${key}, the value this row sets`
      );
      ok(
        /color-mix|solid var\(/.test(rule[3]),
        `.dot.${dot[1]} should have the rim drawn on the canvas, not only a flat fill`
      );
    }
  }

  // A kind a project may not have at all still has a colour the reader can
  // see, on its own row.
  for (const kind of ["interface", "type", "enum"]) {
    ok(
      colourRows.some((r) => r.includes(`class="dot node-${kind}"`)),
      `${kind} should have the dot on its own row`
    );
  }
}

suite("each edge row shows the line it sets");

{
  const fs = require("fs");
  const path = require("path");
  const doc = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
    "utf8"
  );
  const js = fs.readFileSync(path.join(__dirname, "..", "graph.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");

  const panel = doc.slice(doc.indexOf('<aside id="settings"'), doc.indexOf("</aside>", doc.indexOf('<aside id="settings"')));
  const rows = panel
    .split(/(?=<div class="row[ "])/)
    .filter((chunk) => /^<div class="row[ "]/.test(chunk));

  for (const kind of ["inherits", "uses", "references"]) {
    const row = rows.find((r) => r.includes(`data-setting="palette.edge-${kind}"`));
    ok(!!row, `expected a ${kind} row`);
    if (row) {
      ok(
        new RegExp(`class="line" data-edge="${kind}"`).test(row),
        `the ${kind} row should carry a line with data-edge="${kind}"`
      );
    }
  }
  // The arrow shape belongs to a kind, not to all of them. One setting on a
  // row of its own would show none of the three lines it changes and leave a
  // reader unable to give `inherits` a head and `references` none.
  ok(
    !rows.some((r) => r.includes('data-setting="edges.arrow"')),
    "there should be no shared arrows row"
  );
  for (const kind of ["inherits", "uses", "references"]) {
    const row = rows.find((r) => r.includes(`data-setting="palette.edge-${kind}"`));
    ok(
      row && row.includes(`data-setting="edges.${kind}.arrow"`),
      `the ${kind} row should have its own arrow option`
    );
  }

  // Painted from the accessor the stylesheet reads, so the panel and the
  // drawing cannot disagree about a width.
  ok(/function paintEdgeSwatches/.test(js), "expected a function that draws these lines");
  const fn = js.slice(js.indexOf("function paintEdgeSwatches"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  // Through the same lookup the stylesheet uses, so the row cannot hold a
  // second opinion about what a `uses` edge looks like.
  ok(/edgeLook\(kind,/.test(body), "the line should be read from edgeLook, the same lookup as the stylesheet");
  const style = js.slice(js.indexOf("function graphStyle"));
  ok(
    /edgeLook\("uses", "width"\)/.test(style.slice(0, style.indexOf("\n  }"))) ||
      /edgeLook\("uses", "width"\)/.test(js),
    "the stylesheet should use edgeLook too"
  );
  ok(/#settings-body \.line/.test(css), "graph.css should style this line");
}

suite("opening the panel really draws those lines");

{
  // `paintEdgeSwatches` has to be wired to something, not merely exist: a
  // suite that asserted the function existed and read the right sources would
  // pass while every edge row rendered nothing at all.
  //
  // What it reads is what a row ended up drawing, not how the swatch is built,
  // so the swatch can change form — it is an SVG — without this breaking.
  const stub = () => {
    const attrs = {};
    return {
      attrs,
      setAttribute: (n, v) => (attrs[n] = String(v)),
      getAttribute: (n) => (n in attrs ? attrs[n] : null),
    };
  };
  const swatch = (kind) => {
    const parts = { ".line-stroke": stub(), ".line-head": stub() };
    return {
      dataset: { edge: kind },
      parts,
      querySelector: (sel) => parts[sel] || null,
    };
  };
  const graph = graphOf({ A: "class", B: "class" }, [["A", "B", "inherits"]]);
  const h = loadGraphJs({ headless: true });
  const lines = ["inherits", "uses", "references"].map(swatch);
  h.sandbox.document.getElementById("settings").query = { "[data-edge]": lines };

  h.send({ command: "setGraph", graph });
  h.el("toggle-settings").dispatch("click");

  for (const el of lines) {
    const kind = el.dataset.edge;
    const a = el.parts[".line-stroke"].attrs;
    ok(a.stroke, `the ${kind} line should be given a colour, or the reader sees nothing`);
    ok(a["stroke-width"], `${kind} should be given a width`);
    ok("stroke-dasharray" in a, `${kind} should be given a dash style`);
  }

  h.send({
    command: "setSettings",
    settings: { palette: { "edge-uses": "#654321" }, edges: { uses: { width: 7 } } },
  });
  const uses = lines.find((l) => l.dataset.edge === "uses");
  eq(uses.parts[".line-stroke"].attrs["stroke-width"], "7", "changing the width should change the line");
}

suite("each row draws its own kind of edge, not another's");

{
  // `paintEdgeSwatches` and the stylesheet must fall back to the same defaults
  // per kind. One set for every kind against the stylesheet's set per kind
  // makes all three rows draw `inherits` — and a dashed edge reads as solid on
  // its row because it is solid.
  const mk = (kind) => {
    const props = {};
    const attrs = {};
    const classes = new Set();
    return {
      dataset: { edge: kind },
      style: {
        props,
        setProperty: (n, v) => (props[n] = String(v)),
        removeProperty: (n) => delete props[n],
        getPropertyValue: (n) => props[n] || "",
      },
      attrs,
      setAttribute: (n, v) => (attrs[n] = String(v)),
      getAttribute: (n) => (n in attrs ? attrs[n] : null),
      classList: {
        toggle(c, on) {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
      query: {},
      querySelector(sel) {
        return this.query[sel] || null;
      },
    };
  };
  const h = loadGraphJs({ headless: true });
  const lines = ["inherits", "uses", "references"].map((k) => {
    const el = mk(k);
    el.query = { ".line-stroke": mk(k), ".line-head": mk(k) };
    return el;
  });
  h.sandbox.document.getElementById("settings").query = { "[data-edge]": lines };
  h.send({
    command: "setGraph",
    graph: graphOf({ A: "class", B: "class" }, [["A", "B", "inherits"]]),
  });
  h.el("toggle-settings").dispatch("click");

  /** What a row ended up drawing, however the swatch is built. */
  const drawn = (el) => {
    const stroke = el.query[".line-stroke"] || el;
    return {
      width: stroke.attrs["stroke-width"] || el.style.props["border-top-width"],
      dash: stroke.attrs["stroke-dasharray"] || el.style.props["border-top-style"],
      colour: stroke.attrs.stroke || el.style.props["border-top-color"],
    };
  };
  const [inh, uses, refs] = lines.map(drawn);

  // The stylesheet is the authority on what each kind looks like.
  const styleFor = (kind) =>
    h.graphStyle().find((r) => r.selector === `edge[kind = "${kind}"]`).style;

  ok(
    String(inh.width) !== String(uses.width),
    `inherits and uses should differ in width (the stylesheet has ${styleFor("inherits").width} vs ${styleFor("uses").width}), got ${inh.width} vs ${uses.width}`
  );
  ok(
    String(inh.dash) !== String(uses.dash),
    `inherits is solid and uses is dashed, which the rows should show, got ${inh.dash} vs ${uses.dash}`
  );
  ok(
    String(inh.colour) !== String(refs.colour),
    `the three edge colours should differ, got inherits ${inh.colour} vs references ${refs.colour}`
  );
}

suite("the arrow control has its own column and its mark is drawn on the line");

{
  // Two halves. The control belongs in a column of its own, one per kind, on
  // the row that shows that kind. The mark belongs on the line, because the
  // line is the whole edge and an edge's head is part of it; in a box of its
  // own on the right it would read as a second, unrelated thing.
  const fs = require("fs");
  const path = require("path");
  const doc = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
    "utf8"
  );

  const panel = doc.slice(doc.indexOf('<aside id="settings"'), doc.indexOf("</aside>", doc.indexOf('<aside id="settings"')));
  const rowFor = (kind) =>
    panel
      .split(/(?=<div class="row[ "])/)
      .find((r) => r.includes(`data-setting="palette.edge-${kind}"`));

  for (const kind of ["inherits", "uses", "references"]) {
    const row = rowFor(kind);
    ok(
      row && row.includes(`data-setting="edges.${kind}.arrow"`),
      `${kind} should have its own arrow option`
    );
    const lineSvg = row && row.match(/<svg class="line"[\s\S]*?<\/svg>/);
    ok(!!lineSvg, `${kind} should have a line`);
    ok(
      lineSvg && /class="arrow-head"/.test(lineSvg[0]),
      `the ${kind} arrow should be drawn on that line`
    );
  }

  // And it is painted, on the line's own head.
  const stub = () => {
    const attrs = {};
    return { attrs, setAttribute: (k, v) => (attrs[k] = String(v)), getAttribute: (k) => attrs[k] ?? null };
  };
  const swatches = ["inherits", "uses", "references"].map((k) => {
    const parts = { ".line-stroke": stub(), ".arrow-head": stub() };
    return { dataset: { edge: k }, parts, querySelector: (sel) => parts[sel] || null };
  });
  const h = loadGraphJs({ headless: true });
  h.sandbox.document.getElementById("settings").query = { "[data-edge]": swatches };
  h.send({ command: "setGraph", graph: graphOf({ A: "class" }, []) });
  h.el("toggle-settings").dispatch("click");
  for (const sw of swatches) {
    const head = sw.parts[".arrow-head"].attrs;
    ok(head.d, `the ${sw.dataset.edge} arrow should be given a path`);
    ok(head.fill, `the ${sw.dataset.edge} arrow should be given a fill`);
  }

  h.send({ command: "setSettings", settings: { edges: { uses: { arrow: "none" } } } });
  const uses = swatches.find((sw) => sw.dataset.edge === "uses");
  eq(uses.parts[".arrow-head"].attrs.opacity, "0", "after setting none the arrow should not show");
  eq(
    uses.parts[".line-stroke"].attrs.x2,
    "41",
    "with no head, the line should span the whole mark"
  );
  eq(
    swatches.find((sw) => sw.dataset.edge === "inherits").parts[".arrow-head"].attrs.opacity,
    "1",
    "and only its own kind should be affected"
  );
}

suite("in the control cell, each item has its own column");

{
  // Every cell in this grid is placed by hand. A control nobody placed lands
  // where auto-placement puts it, and two placed in the same column push the
  // second onto a row of its own — which is what happens to the arrow unless
  // something outranks `#settings-body select`, since that pins the line style
  // and the arrow alike. Counting columns does not find that; only resolving
  // each child against the rules does.
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");
  const doc = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
    "utf8"
  );

  const tracks = css
    .match(/#settings-body \.row-controls \{[^}]*grid-template-columns:([^;]*);/)[1]
    .trim()
    .split(/\s+/).length;

  /** [selector, column] for every hand-placed cell, in file order. */
  const placed = [];
  for (const m of css.matchAll(/#settings-body ([^{}\n]+?)\s*\{[^}]*?grid-column:\s*([^;]+);/g)) {
    placed.push({ sel: m[1].trim(), col: m[2].trim() });
  }
  ok(placed.length > 5, "expected to parse the column assignments for this cell");

  /** Which column a child ends up in — the last matching rule wins. */
  const columnOf = (tag, attrs) => {
    let col = null;
    for (const rule of placed) {
      const s = rule.sel;
      let hit = false;
      if (s === "input.num") hit = tag === "input" && /class="num"/.test(attrs);
      else if (s === 'input[type="color"]') hit = tag === "input" && /type="color"/.test(attrs);
      else if (s === "select") hit = tag === "select";
      else if (s === 'select[data-setting$=".arrow"]')
        hit = tag === "select" && /data-setting="[^"]*\.arrow"/.test(attrs);
      else if (s === '[data-revert^="palette."]') hit = /data-revert="palette\./.test(attrs);
      else if (s === '[data-revert$=".width"]') hit = /data-revert="[^"]*\.width"/.test(attrs);
      else if (s === '[data-revert$=".arrow"]') hit = /data-revert="[^"]*\.arrow"/.test(attrs);
      if (hit) col = rule.col;
    }
    return col;
  };

  const panel = doc.slice(doc.indexOf('<aside id="settings"'), doc.indexOf("</aside>", doc.indexOf('<aside id="settings"')));
  const row = panel
    .split(/(?=<div class="row[ "])/)
    .find((r) => r.includes('data-setting="palette.edge-uses"'));
  const controls = row.slice(row.indexOf('<span class="row-controls">'));

  const seen = new Map();
  let auto = 0;
  for (const m of controls.matchAll(/<(button|input|select|svg)\b([^>]*)>/g)) {
    const col = columnOf(m[1], m[2]);
    const what = (m[2].match(/data-(?:setting|revert)="([^"]+)"/) || [, m[1]])[1];
    if (col === null) {
      auto++;
      continue;
    }
    ok(
      !seen.has(col),
      `column ${col} is claimed by both ${seen.get(col)} and ${what}; the latter would be pushed to the next row`
    );
    ok(Number(col) <= tracks, `${what} is assigned column ${col}, but there are only ${tracks} columns`);
    seen.set(col, what);
  }
  // The style revert is the one that has no rule of its own; it lands where
  // auto-placement puts it, which is the cell the others left.
  ok(auto <= 1, `an edge row should have at most one auto-placed control, got ${auto}`);

  // The headers are placed the same way, and a rule for one of them has to
  // outrank the rule for all of them. `.col-h-arrow` unscoped loses to
  // `#settings-body .col-h`, which would put the arrow's header under `colour`.
  const headCols = {};
  for (const m of css.matchAll(/([^{}\n]*\.col-h[\w-]*)\s*\{[^}]*?grid-column:\s*([^;]+);/g)) {
    const sel = m[1].trim();
    const cls = sel.slice(sel.lastIndexOf(".") + 1);
    headCols[cls] = { col: m[2].trim(), scoped: sel.startsWith("#settings-body") };
  }
  const generic = headCols["col-h"];
  ok(generic && generic.scoped, "the generic header rule should be scoped to #settings-body");
  for (const cls of ["col-h-num", "col-h-sel", "col-h-arrow"]) {
    const r = headCols[cls];
    ok(!!r, `expected a column rule for .${cls}`);
    ok(
      r && r.scoped,
      `.${cls} is not scoped to #settings-body, so it loses on specificity to .col-h and the column falls back to column ${generic && generic.col}`
    );
  }
}

suite("what a control shows is what is drawn");

{
  // `settingAt` has to read a stored arrow the way `edgeSetting` does, or a
  // reader who has one stored sees `triangle` in the select while the drawing
  // and the swatch draw a circle. A control that says one thing while the
  // drawing does another is worse than no control.
  const h = loadGraphJs({ headless: true });
  h.send({ command: "setGraph", graph: graphOf({ A: "class" }, []) });
  h.send({
    command: "setSettings",
    settings: { edges: { inherits: { arrow: "circle" }, uses: { arrow: "circle" }, references: { arrow: "circle" } } },
  });

  for (const kind of ["inherits", "uses", "references"]) {
    eq(
      h.settingAt(`edges.${kind}.arrow`),
      "circle",
      `the ${kind} control should show the value in effect, not the default`
    );
    eq(
      h.graphStyle().find((r) => r.selector === `edge[kind = "${kind}"]`).style[
        "target-arrow-shape"
      ],
      "circle",
      `what is drawn for ${kind} should be the same`
    );
  }

  // …and a kind with nothing stored shows the default it is drawn with.
  h.send({ command: "setSettings", settings: { edges: { uses: { arrow: "vee" } } } });
  eq(h.settingAt("edges.uses.arrow"), "vee", "a kind's own setting should be shown");
  eq(h.settingAt("edges.inherits.arrow"), undefined, "a kind with no setting should store nothing");
  eq(
    h.graphStyle().find((r) => r.selector === 'edge[kind = "inherits"]').style["target-arrow-shape"],
    "triangle",
    "and be drawn with its default"
  );
}

suite("the sample line uses the canvas's real dash pattern");

{
  // Cytoscape draws `dashed` as [6, 3] and `dotted` as [1, 1], the same however
  // wide the line is. A swatch pattern proportional to the width would not be
  // the line the drawing draws.
  const cyto = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "node_modules", "cytoscape", "dist", "cytoscape.cjs.js"),
    "utf8"
  );
  const real = cyto.match(/'line-dash-pattern':\s*\[(\d+),\s*(\d+)\]/);
  ok(!!real, "expected to read cytoscape's default dash pattern");

  const stub = () => {
    const attrs = {};
    return { attrs, setAttribute: (k, v) => (attrs[k] = String(v)), getAttribute: (k) => attrs[k] ?? null };
  };
  const swatches = ["inherits", "uses"].map((k) => {
    const parts = { ".line-stroke": stub(), ".arrow-head": stub() };
    return { dataset: { edge: k }, parts, querySelector: (sel) => parts[sel] || null };
  });
  const h = loadGraphJs({ headless: true });
  h.sandbox.document.getElementById("settings").query = { "[data-edge]": swatches };
  h.send({ command: "setGraph", graph: graphOf({ A: "class" }, []) });
  h.el("toggle-settings").dispatch("click");

  const dash = (k) => swatches.find((s) => s.dataset.edge === k).parts[".line-stroke"].attrs["stroke-dasharray"];
  eq(dash("uses"), `${real[1]} ${real[2]}`, "the dash should use cytoscape's pattern, not an invented one");
  eq(dash("inherits"), "", "a solid line should have no pattern");

  // …and it does not change with the width, because the drawing's does not.
  h.send({ command: "setSettings", settings: { edges: { uses: { width: 6 } } } });
  eq(dash("uses"), `${real[1]} ${real[2]}`, "changing the width should not change the dash spacing");
}

suite("an arrow shape fits in its own box");

{
  const js = require("fs").readFileSync(
    require("path").join(__dirname, "..", "graph.js"),
    "utf8"
  );
  const block = js.slice(js.indexOf("const ARROW_PATHS = {"));
  const body = block.slice(0, block.indexOf("\n  };"));
  const doc = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "src", "graphDocument.ts"),
    "utf8"
  );
  const vb = doc.match(/<svg class="line"[^>]*viewBox="0 0 (\d+) (\d+)"/);
  ok(!!vb, "expected to read the line's viewBox");
  const [w, hgt] = [Number(vb[1]), Number(vb[2])];

  // Walk the path, tracking the current point. Taking every other number as an
  // x is wrong for an arc — its parameters are rx ry rot laf sf dx dy — and
  // would pass a circle running out of its box. Adding the radius to both ends
  // of every arc over-corrects: that is only right when the chord is not along
  // that axis, and a semicircle on a horizontal chord bulges vertically, so it
  // would fail a path that fits.
  const extent = (d) => {
    const t = d.match(/[MmLlAaZz]|-?\d*\.?\d+/g) || [];
    let i = 0;
    let cx = 0;
    let cy = 0;
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    const see = (x, y) => {
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
    };
    while (i < t.length) {
      const c = t[i++];
      if (c === "M" || c === "L") {
        cx = Number(t[i++]);
        cy = Number(t[i++]);
        see(cx, cy);
      } else if (c === "m" || c === "l") {
        cx += Number(t[i++]);
        cy += Number(t[i++]);
        see(cx, cy);
      } else if (c === "a" || c === "A") {
        const rx = Number(t[i++]);
        const ry = Number(t[i++]);
        i += 3;
        const dx = Number(t[i++]);
        const dy = Number(t[i++]);
        see(cx, cy);
        const fx = cx;
        const fy = cy;
        cx += dx;
        cy += dy;
        see(cx, cy);
        // The arc bulges away from its chord. Along the chord's own axis it
        // reaches no further than its ends.
        if (dy !== 0) {
          see(Math.min(fx, cx) - rx, cy);
          see(Math.max(fx, cx) + rx, cy);
        }
        if (dx !== 0) {
          see(cx, Math.min(fy, cy) - ry);
          see(cx, Math.max(fy, cy) + ry);
        }
      }
    }
    return box;
  };

  for (const m of body.matchAll(/(\w+):\s*"([^"]*)"/g)) {
    const [, name, d] = m;
    if (!d) continue;
    const box = extent(d);
    ok(box.x0 >= 0 && box.x1 <= w, `${name} spans x ${box.x0}..${box.x1}, but the box is only ${w} wide`);
    ok(box.y0 >= 0 && box.y1 <= hgt, `${name} spans y ${box.y0}..${box.y1}, but the box is only ${hgt} high`);
  }
}

suite("a choice can be made and the default chosen again");

/** An arrow shape of its own for every edge kind, none of them the default. */
const STORED_ARROWS = { inherits: { arrow: "circle" }, uses: { arrow: "circle" }, references: { arrow: "circle" }, contains: { arrow: "circle" } };

{
  // A control must not get stuck: picking a value equal to the default
  // deletes the key — "a variable back at its default is removed rather than
  // written" — so what the drawing falls back to after that has to be the
  // default. Were it any other stored value, a reader with `circle` stored
  // could not pick `triangle` again, because picking it would remove the only
  // thing that says so.
  //
  // Driven through the panel's own control, which the harness builds from
  // `graphDocument.ts` and the viewer wires as it loads. Asking the functions
  // one at a time would miss it: each behaves correctly on its own.
  const h = loadGraphJs({ headless: true });
  h.send({ command: "setGraph", graph: graphOf({ A: "class" }, []) });
  // An arrow shape of its own for two kinds in the host's store.
  h.send({ command: "setSettings", settings: { edges: { uses: { arrow: "circle" }, inherits: { arrow: "circle" } } } });

  const control = (key) =>
    [...h.sandbox.document.getElementById("settings").querySelectorAll("[data-setting]")].find(
      (el) => el.getAttribute("data-setting") === key
    );
  const shape = (kind) =>
    h.graphStyle().find((r) => r.selector === `edge[kind = "${kind}"]`).style["target-arrow-shape"];

  const sel = control("edges.uses.arrow");
  ok(!!sel, "expected a uses arrow control");
  eq(sel.value, "circle", "the control should show the stored value");
  eq(shape("uses"), "circle", "and it should be the one drawn");

  sel.value = "triangle";
  sel.dispatch("change");
  eq(shape("uses"), "triangle", "choosing the default again should give the default; a control that cannot go back is broken");
  eq(control("edges.uses.arrow").value, "triangle", "the control should stay there too");
  eq(shape("inherits"), "circle", "the untouched ones should stay as they were");

  sel.value = "vee";
  sel.dispatch("change");
  eq(shape("uses"), "vee", "choosing something else should still work");
}

{
  // The same question asked of every control at once, because the hazard is
  // not about arrows: it is "a value equal to the default is deleted" meeting
  // a permanent fallback, and any row could grow that pair.
  //
  // Two kinds of control, and they are not interchangeable: a `<select>` or a
  // colour well carries the value and answers `change`; the crowded-level
  // pictures are a group of buttons where the value lives in `aria-pressed`
  // and the event is `click`. Reading `el.value` off a button reads the button,
  // not the setting — which is a false failure.
  const h = loadGraphJs({ headless: true });
  h.send({ command: "setGraph", graph: graphOf({ A: "class", B: "class" }, [["A", "B", "inherits"]]) });
  h.send({ command: "setSettings", settings: { edges: STORED_ARROWS } });

  const panel = h.sandbox.document.getElementById("settings");
  const controls = () =>
    [...panel.querySelectorAll("[data-setting]")].filter((el) => !el.hasAttribute("data-readout"));

  // The buttons: press each one, and each has to be the one that is pressed.
  const groups = {};
  for (const el of controls())
    if (el.hasAttribute("data-choice")) (groups[el.getAttribute("data-setting")] ||= []).push(el);
  for (const [key, buttons] of Object.entries(groups)) {
    const pressed = () => buttons.find((b) => b.getAttribute("aria-pressed") === "true");
    const started = pressed();
    for (const b of buttons) {
      b.dispatch("click");
      eq(pressed() && pressed().value, b.value, `${key}: clicking ${b.value} should give ${b.value}`);
    }
    started.dispatch("click");
    eq(pressed(), started, `${key}: should return to the starting ${started.value}`);
  }

  // The rest: move it off what it shows, then put it back.
  const other = (v) =>
    String(v).startsWith("#")
      ? "#123456"
      : v !== "" && !isNaN(Number(v))
        ? String(Number(v) + 0.5)
        : { triangle: "vee", vee: "none", none: "triangle", circle: "triangle", solid: "dashed", dashed: "dotted", dotted: "solid" }[v];
  const shows = (key) => controls().find((el) => el.getAttribute("data-setting") === key).value;

  // What the control says is only half of it. A stuck arrow can show
  // `triangle` on a drawing full of circles, so a sweep that reads the
  // control against itself agrees with a broken panel. For every setting
  // that reaches a cytoscape rule, read the rule.
  const STYLE_OF = { width: "width", style: "line-style", arrow: "target-arrow-shape" };
  const drawn = (key) => {
    const parts = key.split(".");
    if (parts[0] !== "edges" || !STYLE_OF[parts[2]]) return undefined;
    const rule = h.graphStyle().find((r) => r.selector === `edge[kind = "${parts[1]}"]`);
    return rule && String(rule.style[STYLE_OF[parts[2]]]);
  };

  let swept = 0;
  let checked = 0;
  for (const el of controls()) {
    if (el.hasAttribute("data-choice")) continue;
    const key = el.getAttribute("data-setting");
    const was = el.value;
    const to = other(was);
    if (to === undefined) continue; // the centre readout has no other value to pick
    swept++;
    el.value = to;
    el.dispatch("change");
    eq(shows(key), to, `${key}: choosing ${to} should stay at ${to}`);
    if (drawn(key) !== undefined) {
      checked++;
      eq(drawn(key), to, `${key}: what is drawn should also be ${to}`);
    }
    el.value = was;
    el.dispatch("change");
    eq(shows(key), was, `${key}: choosing ${was} again should stay at ${was}; a control that cannot go back is broken`);
    if (drawn(key) !== undefined)
      eq(drawn(key), was, `${key}: what is drawn should follow the choice back`);
  }
  ok(checked >= 9, `expected every edge width, line style and arrow checked against the drawing, checked ${checked}`);
  ok(swept >= 14, `expected to sweep most of the panel's controls, swept ${swept}`);
}

suite("Reset puts every item back to its default");

{
  // The panel's Reset walks the settings table rather than the controls on
  // screen, so it is the one place that can put back something the reader has
  // forgotten changing. That only holds if every entry in the table actually
  // goes back — and the arrow rows are where that can fail, because clearing
  // a key and then falling back to a stored value is a reset that resets
  // nothing.
  //
  // Started from an arrow shape stored for every kind, because with an empty
  // store the stored value and the default agree and the defect is invisible.
  const h = loadGraphJs({ headless: true });
  h.send({ command: "setGraph", graph: graphOf({ A: "class", B: "class" }, [["A", "B", "inherits"]]) });
  h.send({ command: "setSettings", settings: { edges: STORED_ARROWS } });

  const panel = h.sandbox.document.getElementById("settings");
  const controls = () =>
    [...panel.querySelectorAll("[data-setting]")].filter((el) => !el.hasAttribute("data-readout"));
  const other = (v) =>
    String(v).startsWith("#")
      ? "#123456"
      : v !== "" && !isNaN(Number(v))
        ? String(Number(v) + 0.5)
        : { triangle: "vee", vee: "none", none: "triangle", circle: "triangle", solid: "dashed", dashed: "dotted", dotted: "solid" }[v];

  // Every default, read before anything is moved.
  const defaults = {};
  for (const el of controls()) {
    if (el.hasAttribute("data-choice")) continue;
    const key = el.getAttribute("data-setting");
    if (key.split(".")[2] === "arrow") defaults[key] = "triangle"; // stored circle is not the default
    else defaults[key] = el.value;
  }

  // Push all of them off it, the pictures included.
  for (const el of controls()) {
    if (el.hasAttribute("data-choice")) continue;
    const to = other(el.value);
    if (to === undefined) continue;
    el.value = to;
    el.dispatch("change");
  }
  for (const el of controls())
    if (el.hasAttribute("data-choice") && el.value === "rows") el.dispatch("click");

  h.sandbox.document.getElementById("settings-reset").dispatch("click");

  let put = 0;
  for (const [key, def] of Object.entries(defaults)) {
    const now = controls().find((el) => el.getAttribute("data-setting") === key).value;
    put++;
    eq(String(now), String(def), `after Reset ${key} should return to ${def}`);
  }
  ok(put >= 14, `expected Reset to cover most of the panel's settings, checked ${put}`);

  const ring = controls().find((el) => el.hasAttribute("data-choice") && el.value === "ring");
  eq(ring.getAttribute("aria-pressed"), "true", "after Reset crowded level should return to the single arc");

  // And the drawing, because a panel that agrees with itself can still be
  // showing a graph that never moved.
  for (const kind of ["inherits", "uses", "references"]) {
    const rule = h.graphStyle().find((r) => r.selector === `edge[kind = "${kind}"]`);
    eq(rule.style["target-arrow-shape"], "triangle", `after Reset the drawn ${kind} arrow should be the default too`);
  }
  eq(h.graphStyle().find((r) => r.selector === 'edge[kind = "uses"]').style["line-style"], "dashed", "so should the line style");
  eq(h.graphStyle().find((r) => r.selector === 'edge[kind = "inherits"]').style.width, 2, "so should the width");
}

suite("↺ means not yet saved, not different from the default");

{
  // What the mark beside a row means: "this row differs from what the host
  // was last told", which is the per-row breakdown of what the Save button and
  // the "unsaved changes" badge say once for the whole panel. "This is off its
  // default" would be the wrong meaning: it stays true after the reader has
  // saved and there is nothing outstanding at all.
  //
  // Three things move together or the button lies: when it shows, what it puts
  // back, and what its tooltip promises.
  const h = loadGraphJs({ headless: true });
  h.send({ command: "setGraph", graph: graphOf({ A: "class", B: "class" }, [["A", "B", "inherits"]]) });
  // A reader who has already saved something that is not the default.
  h.send({ command: "setSettings", settings: { edges: { uses: { arrow: "vee" }, inherits: { width: 5 } } } });

  const panel = h.sandbox.document.getElementById("settings");
  const control = (key) =>
    [...panel.querySelectorAll("[data-setting]")].find((el) => el.getAttribute("data-setting") === key);
  const mark = (key) =>
    [...panel.querySelectorAll("[data-revert]")].find((el) => el.getAttribute("data-revert") === key);
  const shown = (key) => mark(key).classList.contains("shown");
  const shape = (kind) =>
    h.graphStyle().find((r) => r.selector === `edge[kind = "${kind}"]`).style["target-arrow-shape"];
  const save = h.sandbox.document.getElementById("settings-save");

  ok(!shown("edges.uses.arrow"), "just opened, a saved item should have no ↺; nothing is pending");
  ok(!shown("edges.inherits.width"), "nor should a saved width");
  eq(control("edges.uses.arrow").value, "vee", "but it should still show the saved value");

  const sel = control("edges.uses.arrow");
  sel.value = "circle";
  sel.dispatch("change");
  ok(shown("edges.uses.arrow"), "it should appear after a change");
  eq(mark("edges.uses.arrow").getAttribute("title"), "Back to vee", "and it should say what it goes back to");

  mark("edges.uses.arrow").dispatch("click");
  eq(control("edges.uses.arrow").value, "vee", "clicking should return to the last saved value, not the default");
  eq(shape("uses"), "vee", "the drawing should return to the last saved value too");
  ok(!shown("edges.uses.arrow"), "once reverted it should disappear");

  // Save answers every mark at once.
  sel.value = "none";
  sel.dispatch("change");
  const w = control("edges.inherits.width");
  w.value = "9";
  w.dispatch("change");
  ok(shown("edges.uses.arrow") && shown("edges.inherits.width"), "both rows should be pending");
  save.dispatch("click");
  ok(!shown("edges.uses.arrow"), "after Save the ↺ should disappear");
  ok(!shown("edges.inherits.width"), "on every row");
  ok(save.disabled, "Save itself should be disabled");

  // And from there the mark points at the newly saved value, not the old one.
  sel.value = "triangle";
  sel.dispatch("change");
  eq(mark("edges.uses.arrow").getAttribute("title"), "Back to none", "it should go back to this save, not the one before");
  mark("edges.uses.arrow").dispatch("click");
  eq(shape("uses"), "none", "clicking should really return to this save");

  // A row that was never off its default and never edited has nothing to say.
  ok(!shown("edges.references.arrow"), "an untouched row should never have a ↺");
}

// ---------------------------------------------------------------------------
suite("the kinds and edges Go brings each have their own row, colour and style");

{
  const fs = require("fs");
  const path = require("path");
  const doc = fs.readFileSync(path.join(__dirname, "..", "..", "src", "graphDocument.ts"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "graph.css"), "utf8");
  const section = (id) => {
    const at = doc.indexOf(`<aside id="${id}"`);
    return doc.slice(at, doc.indexOf("</aside>", at));
  };
  const legendHtml = section("legend");
  const panelHtml = section("settings");

  for (const kind of ["struct", "package"]) {
    ok(legendHtml.includes(`<li data-kind="${kind}"`), `the legend should have a ${kind} row`);
    ok(panelHtml.includes(`<div class="row" data-kind="${kind}"`), `the settings panel should have a ${kind} row`);
    ok(panelHtml.includes(`data-setting="palette.node-${kind}"`), `${kind} should have a colour setting`);
    ok(new RegExp(`--node-${kind}:`).test(css), `graph.css should declare --node-${kind}`);
    ok(new RegExp(`\\.dot\\.node-${kind}\\s*\\{`).test(css), `graph.css should have .dot.node-${kind}`);
  }
  // Every edge row carries its kind as a mark, so the one mechanism that hides
  // an absent node kind hides an absent edge kind too.
  for (const kind of ["inherits", "uses", "references", "contains"]) {
    ok(legendHtml.includes(`<li data-mark="edge:${kind}"`), `the legend's ${kind} row should carry data-mark="edge:${kind}"`);
    ok(
      panelHtml.includes(`<div class="row row-edge" data-mark="edge:${kind}"`),
      `the settings panel's ${kind} row should carry data-mark="edge:${kind}"`
    );
  }
  for (const key of ["palette.edge-contains", "edges.contains.width", "edges.contains.style", "edges.contains.arrow"]) {
    ok(panelHtml.includes(`data-setting="${key}"`), `the settings panel should have ${key}`);
  }
  ok(/--edge-contains:/.test(css), "graph.css should declare --edge-contains");
  ok(/#legend \.line\.edge-contains\s*\{/.test(css), "the legend should be able to draw the contains line");

  const selectors = g.graphStyle().map((r) => r.selector);
  for (const sel of ['node[kind = "struct"]', 'node[kind = "package"]', 'edge[kind = "contains"]']) {
    ok(selectors.includes(sel), `the stylesheet should have ${sel}`);
  }
}

suite("an edge row is listed only when the artifact has that kind of edge");

{
  const stub = (mark) => {
    const classes = new Set();
    return {
      dataset: { mark },
      classList: {
        toggle(c, on) {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
    };
  };
  const rows = ["inherits", "uses", "references", "contains"].map((k) => stub(`edge:${k}`));
  const shown = () =>
    rows
      .filter((r) => !r.classList.contains("hidden"))
      .map((r) => r.dataset.mark)
      .sort()
      .join(",");

  // A Python drawing carries no contains, and this one no references either.
  g.syncKindRows(rows, graphOf({ A: "class", B: "class", f: "function" }, [["A", "B", "inherits"], ["f", "A", "uses"]]), {});
  eq(shown(), "edge:inherits,edge:uses", "only the edges in the graph should be listed");
  g.syncKindRows(rows, graphOf({ P: "package", S: "struct" }, [["P", "S", "contains"]]), {});
  eq(shown(), "edge:contains", "a graph with only contains should change the rows");
}

suite("a function contained only by its package orbits that package");

{
  // The satellite rule asks only that a function share an edge with a type,
  // whatever the edge's kind. A package is a type and `contains` is an edge, so
  // the rule needs nothing new for packages — this checks that it does not.
  const graph = graphOf(
    { P: "package", S: "struct", T: "struct", f: "function" },
    [["P", "S", "contains"], ["P", "T", "contains"], ["P", "f", "contains"], ["S", "T", "uses"]]
  );
  const out = g.computeClassRingPositions(graph, "P", allVisible(graph));
  eq(out.satelliteOwner && out.satelliteOwner.f, "P", "f has only the contains edge and should orbit P");
}
