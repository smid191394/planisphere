/* global cytoscape from script tag */
/* eslint-disable no-undef */

(function () {
  const vscode = acquireVsCodeApi();

  /** @type {any} */
  let cy = null;
  /** The artifact plus a node per group of same-named siblings — the element
   *  set, which is built once and then shown or hidden. */
  /** @type {{ nodes: any[]; edges: any[] } | null} */
  let fullGraph = null;
  /**
   * The document as it arrived, before same-named symbols were folded.
   *
   * The centre is chosen from this rather than from the folded reading, so
   * that opening a group cannot reroot the drawing under the reader — and a
   * centre the reader named has to be looked for here too, since that is where
   * it was named.
   */
  let artifactGraph = null;
  /** Member id → the id of the group drawn in its place. A member is never
   *  drawn itself. @type {Record<string, string>} */
  let memberGroupOf = {};
  /** Group id → { id, name, members }. @type {Record<string, any>} */
  let groupsById = {};
  /** @type {string | null} */
  let focusId = null;
  /** Node already activated once; a second activation on it jumps to source. */
  /** @type {string | null} */
  let pendingJumpId = null;
  /** @type {string | null} */
  let centerClassId = null;
  /** Whether the panel's list belongs to the node that has the focus now. */
  let showsMembers = false;
  /**
   * The node the right button was pressed on, while the drawing shows only
   * what it reaches; null the rest of the time. A question the reader asked
   * once rather than a preference: never stored, never restored, and gone
   * with the graph it was asked of.
   * @type {string | null}
   */
  let reachRoot = null;
  /** Drawn ids of everything `reachRoot` reaches, itself included. @type {Set<string> | null} */
  let reachIds = null;
  /** The camera as it was when the view opened, which is where leaving returns. */
  let reachReturnView = null;
  /** Whether functions were hidden when the view opened, which leaving restores. */
  let reachReturnFns = true;
  /** The node whose members are drawn as a graph of their own, or null. */
  let insideOf = null;
  /** What the drawing was before that view was entered. */
  let insideReturn = null;
  /**
   * The types whose members are drawn where the type stands, in the order the
   * reader opened them.
   * @type {string[]}
   */
  let openTypes = [];
  /**
   * The centre while that view is up.
   *
   * Not `settings.centre`: a member's id belongs to a drawing built here and
   * to no artifact, and settings follow the reader from one project to the
   * next. Saved, it would name a node nothing has.
   */
  let insideCentre = null;
  /**
   * How far the whole drawing's own framing zooms, measured as the view opens
   * while the whole drawing is still what is drawn. Clamped each time the view
   * is framed, so the default view setting still decides it from inside.
   */
  let reachWholeFit = null;
  /** The opening the layout gave the view: wider than REACH_FAN where a level crowded it. */
  let reachOpening = null;
  /** Function nodes hidden via the toolbar toggle. Hidden by default: on a real
   *  project functions outnumber classes (150 vs 112 in FastAPI) and bury the
   *  class structure the graph exists to show. */
  let hideFunctions = true;
  /**
   * How a level too crowded for its ring is drawn. One arc by default, though
   * rows measure better — 1,975 overlapping pairs on Django against 5,279, at
   * the same drawing size and the same magnification.
   *
   * The measurement is not what decides it. This drawing's vocabulary is
   * circles: a ring marks a level, and a reader counts rings to see how far a
   * node sits from its centre. Rows turn each arc into a run of small
   * rectangular blocks hanging off it, so what a reader opens on is a grid
   * rather than a star system. The overlapping is real, and rows are what the
   * settings panel offers for it.
   */
  let bandOverflow = false;

  /**
   * What the reader has chosen, over the drawing's own defaults.
   *
   * `palette` is keyed by the CSS variable's name without its dashes, because
   * the variable is where a colour actually goes: the stylesheet reads it
   * through `cssVar`, the legend's swatches read it through `var()`, and the
   * panel's own marks read it through the same stylesheet. A value held only here and
   * handed to the stylesheet directly would leave the legend on a second path,
   * and the two would disagree the first time one was updated alone.
   *
   * `edges` is per kind, plus the arrow they share. These are not colours and
   * have no variable; they are read straight out of here where the rule is
   * built.
   */
  let settings = { palette: {}, edges: {}, centre: "" };

  /**
   * Every value the reader can set, and what it costs to apply.
   *
   * `paint` — write the variable, ask for the stylesheet again. Nothing moves.
   * `layout` — the drawing is arranged differently and has to be re-laid.
   *
   * The table is what the panel is built from and what reset walks, so a
   * setting that is not here is one the panel cannot show and reset cannot
   * return. Sizes are deliberately absent: `NODE_DIAMETER` feeds
   * `MIN_SEPARATION` and so how many nodes a sector seats, `SAT_DIAMETER`
   * feeds satellite seating, `BASE_FONT_SIZE` feeds the unconnected cluster's
   * spacing. They are layout wearing a style's clothes.
   */
  const SETTINGS = [
    { key: "palette.node-class", cost: "paint", label: "class", def: "#1E88E5" },
    { key: "palette.node-interface", cost: "paint", label: "interface", def: "#00BCD4" },
    { key: "palette.node-type", cost: "paint", label: "type", def: "#7E57C2" },
    { key: "palette.node-enum", cost: "paint", label: "enum", def: "#FFB300" },
    { key: "palette.node-struct", cost: "paint", label: "struct", def: "#5C6BC0" },
    { key: "palette.node-package", cost: "paint", label: "package", def: "#C0CA33" },
    { key: "palette.node-function", cost: "paint", label: "function", def: "#43A047" },
    { key: "palette.node-file", cost: "paint", label: "file", def: "#FB8C00" },
    { key: "palette.node-center", cost: "paint", label: "center", def: "#E91E63" },
    { key: "palette.node-focus-border", cost: "paint", label: "focus", def: "#FFEB3B" },
    { key: "palette.edge-inherits", cost: "paint", label: "inherits", def: "#90CAF9" },
    { key: "palette.edge-uses", cost: "paint", label: "uses", def: "#9B72AF" },
    { key: "palette.edge-references", cost: "paint", label: "references", def: "#80CBC4" },
    { key: "palette.edge-contains", cost: "paint", label: "contains", def: "#B0BEC5" },
    { key: "edges.inherits.width", cost: "paint", label: "inherits width", def: 2 },
    { key: "edges.uses.width", cost: "paint", label: "uses width", def: 1.5 },
    { key: "edges.references.width", cost: "paint", label: "references width", def: 1.5 },
    { key: "edges.contains.width", cost: "paint", label: "contains width", def: 1 },
    { key: "edges.inherits.style", cost: "paint", label: "inherits line", def: "solid" },
    { key: "edges.uses.style", cost: "paint", label: "uses line", def: "dashed" },
    { key: "edges.references.style", cost: "paint", label: "references line", def: "dashed" },
    { key: "edges.contains.style", cost: "paint", label: "contains line", def: "dotted" },
    { key: "edges.inherits.arrow", cost: "paint", label: "inherits arrow", def: "triangle" },
    { key: "edges.uses.arrow", cost: "paint", label: "uses arrow", def: "triangle" },
    { key: "edges.references.arrow", cost: "paint", label: "references arrow", def: "triangle" },
    { key: "edges.contains.arrow", cost: "paint", label: "contains arrow", def: "triangle" },
    { key: "labelFloor", cost: "view", label: "default view", def: 4.5 },
    { key: "bandOverflow", cost: "layout", label: "crowded level", def: "ring" },
    // Still a setting, still saved and still returned by Reset — it is set on
    // the node rather than in the panel, so it has no row of its own.
    { key: "centre", cost: "layout", label: "centre", def: "" },
  ];

  /** Read a dotted key out of the settings object. */
  function settingAt(key) {
    // The one setting whose stored form is not what its control says. The wire
    // and the layout both want a boolean; a `<select>` has options with names.
    if (key === "bandOverflow") return bandOverflow ? "rows" : "ring";
    let at = settings;
    for (const part of key.split(".")) {
      if (at === null || at === undefined) return undefined;
      at = at[part];
    }
    return at;
  }

  /** What a setting is showing: the reader's value, or the drawing's own. */
  function settingValue(entry) {
    const v = settingAt(entry.key);
    return v === undefined || v === null || v === "" ? entry.def : v;
  }

  /**
   * The settings the reader has actually moved off their defaults.
   *
   * This is what gets saved: a default that has been written down stops
   * following the drawing when the drawing's own default changes. It is not
   * what the row marks answer — see `savedValueOf`.
   */
  function changedSettings() {
    return SETTINGS.filter((e) => settingValue(e) !== e.def);
  }

  /**
   * The settings as they stood at the last save, unpacked from the snapshot.
   *
   * Null before the panel has been opened, which is the only time there is no
   * such thing: nothing has been edited yet, so nothing can be put back.
   */
  function savedSettings() {
    if (savedState === null) return null;
    const [band, palette, edges, centre, floor] = JSON.parse(savedState);
    return {
      bandOverflow: band ? "rows" : "ring",
      palette,
      edges,
      centre: centre || "",
      labelFloor: floor === null ? undefined : floor,
    };
  }

  /**
   * What one setting's revert puts back: the saved value, or the default when
   * nothing was saved for it.
   *
   * The mark beside a row answers "is this row unsaved?", not "is this row off
   * its default?" — the two are the same question only until the reader presses
   * Save; after that, a mark for being off the default would say the row still
   * had something outstanding when it did not. What is off its default is the
   * drawing's business and is shown by the drawing; what is unsaved is the
   * panel's, and the marks are its per-row breakdown of the same thing
   * the Save button and the "unsaved changes" badge say once for the panel.
   */
  function savedValueOf(saved, entry) {
    if (!saved) return entry.def;
    let at = saved;
    if (entry.key === "bandOverflow") at = saved.bandOverflow;
    else
      for (const part of entry.key.split(".")) {
        if (at === null || at === undefined) break;
        at = at[part];
      }
    return at === undefined || at === null || at === "" ? entry.def : at;
  }

  /**
   * Put the chosen colours where everything that draws reads them.
   *
   * A variable back at its default is removed rather than written, so the
   * stylesheet falls through to the CSS file — which stays the statement of
   * what the defaults are, instead of being shadowed by a copy of itself.
   */
  function writePaletteVars() {
    const root = document.documentElement;
    if (!root || !root.style || !root.style.setProperty) return;
    for (const entry of SETTINGS) {
      if (entry.key.slice(0, 8) !== "palette.") continue;
      const name = "--" + entry.key.slice(8);
      const v = settingAt(entry.key);
      if (v === undefined || v === null || v === "") root.style.removeProperty(name);
      else root.style.setProperty(name, String(v));
    }
  }

  /**
   * The centre the reader named, if this artifact has it.
   *
   * Settings follow the reader from one artifact to the next and a node id is
   * a file path plus a symbol, so a stored centre naming something this graph
   * has never heard of is the ordinary case rather than an error. It is
   * ignored, and the automatic choice stands.
   */
  function chosenCentre(graph) {
    const want = insideCentre || settings.centre;
    if (!want || !graph || !graph.nodes) return null;
    for (const n of graph.nodes) if (n.id === want) return want;
    return null;
  }

  /** Write a dotted key into the settings object, creating what it needs. */
  function setSettingAt(key, value) {
    if (key === "bandOverflow") {
      bandOverflow = value === "rows" || value === true;
      return;
    }
    const parts = key.split(".");
    let at = settings;
    for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = at[parts[i]] || {};
    at[parts[parts.length - 1]] = value;
  }

  /** Drop a chosen value, so the setting falls back to the drawing's own. */
  function clearSettingAt(key, def) {
    if (key === "bandOverflow") {
      bandOverflow = def === "rows" || def === true;
      return;
    }
    const parts = key.split(".");
    let at = settings;
    for (let i = 0; i < parts.length - 1; i++) {
      at = at[parts[i]];
      if (!at) return;
    }
    delete at[parts[parts.length - 1]];
  }

  /** One edge kind's width, line style and arrow, chosen or default. */
  /**
   * What an edge kind looks like when the reader has set nothing.
   *
   * One table, read by the stylesheet and by the row that offers the setting.
   * Written twice — per kind in the stylesheet, and once for all kinds in the
   * swatch painter — the two could disagree, and a row would draw a line other
   * than the one its kind has.
   */
  const EDGE_DEFAULTS = {
    inherits: { colour: "#90CAF9", width: 2, style: "solid", arrow: "triangle" },
    uses: { colour: "#9B72AF", width: 1.5, style: "dashed", arrow: "triangle" },
    // Annotation-only mention: a back-reference, not a dependency. Thinner and
    // dashed so it reads as the weaker relationship.
    references: { colour: "#80CBC4", width: 1.5, style: "dashed", arrow: "triangle" },
    // Where a node is declared, not what it does. A language with a unit above
    // the file draws one of these per node, so it is the quietest line there
    // is: grey, thin and dotted. It keeps the head every other kind has, so a
    // default arrow is still a triangle whatever the kind.
    contains: { colour: "#B0BEC5", width: 1, style: "dotted", arrow: "triangle" },
  };

  /** A kind's setting, or the default this project ships for that kind. */
  function edgeLook(kind, field) {
    const d = EDGE_DEFAULTS[kind] || EDGE_DEFAULTS.inherits;
    return field === "colour"
      ? cssVar("--edge-" + kind, d.colour)
      : edgeSetting(kind, field, d[field]);
  }

  function edgeSetting(kind, field, fallback) {
    const per = (settings.edges || {})[kind] || {};
    const v = per[field];
    return v === undefined || v === null || v === "" ? fallback : v;
  }

  /**
   * Paint the settings panel's controls from the flags.
   *
   * Installed when the panel is wired, and called again whenever the host
   * hands settings down. Always in this direction — the flags are the state,
   * the controls are a view of it — so a value that arrives after the panel
   * was drawn cannot leave the two disagreeing.
   */
  let syncSettingControls = () => {};

  /**
   * Take what the host has stored. Returns whether anything actually moved, so
   * a message that says what the viewer already believes costs no redraw.
   */
  function applySettings(next) {
    if (!next || typeof next !== "object") return "none";
    let cost = "none";
    if (typeof next.bandOverflow === "boolean" && next.bandOverflow !== bandOverflow) {
      bandOverflow = next.bandOverflow;
      cost = "layout";
    }
    const before = JSON.stringify([settings.palette, settings.edges]);
    const beforeCentre = settings.centre || "";
    const beforeFloor = settings.labelFloor;
    settings = {
      palette: next.palette && typeof next.palette === "object" ? { ...next.palette } : {},
      edges: next.edges && typeof next.edges === "object" ? { ...next.edges } : {},
      centre: typeof next.centre === "string" ? next.centre : "",
      labelFloor: typeof next.labelFloor === "number" ? next.labelFloor : undefined,
    };
    // The centre moves nodes, so it costs a layout — and it outranks the
    // cheaper tiers when more than one changed in the same message.
    if (settings.centre !== beforeCentre) cost = "layout";
    else if (settings.labelFloor !== beforeFloor && cost === "none") cost = "view";
    else if (JSON.stringify([settings.palette, settings.edges]) !== before && cost === "none") {
      cost = "paint";
    }
    writePaletteVars();
    savedState = snapshotSettings();
    syncSettingControls();
    return cost;
  }

  /**
   * Show the drawing under whatever the settings now say.
   *
   * A colour moves nothing, so it never goes through `applyView` — that
   * re-lays the drawing out and drops the camera, which for a repaint would be
   * wrong twice over. This is the third cost tier the panel needs, and the
   * palette uses it.
   */
  function repaint() {
    // The panel's own marks are part of the paint. Painted only from the
    // settings handler, a reader who opened the panel and changed nothing
    // would see four rows of nothing.
    paintEdgeSwatches();
    if (!cy) return;
    cy.style(graphStyle());
  }

  /**
   * Draw each edge row's line at what that row now sets.
   *
   * From `edgeSetting` and `cssVar`, which is what `graphStyle` reads — one
   * source and two readers, rather than the panel keeping a second opinion
   * about how wide a `uses` edge is. A border carries a width and a dash
   * pattern; the colour picker beside it carries neither.
   */
  /**
   * What cytoscape draws for each line style, read from its source rather than
   * chosen: `line-dash-pattern` defaults to [6, 3], and `dotted` is [1, 1] in
   * the canvas renderer. Neither scales with the line's width, so neither does
   * this.
   */
  const DASH_PATTERNS = { solid: "", dashed: "6 3", dotted: "1 1" };

  /**
   * The arrow shapes, drawn at the end of the row's own line inside its 42x10
   * box. The head is not a mark of its own beside the control: the line is the
   * whole edge, and an edge's head belongs on it.
   *
   * Every coordinate stays inside the box. A circle reaching x=45 in a box 42
   * wide would be clipped to a half disc and read as some other shape.
   */
  const ARROW_PATHS = {
    triangle: "M31 1 L41 5 L31 9 Z",
    vee: "M31 1 L41 5 L31 9 L34 5 Z",
    circle: "M33 5 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
    none: "",
  };





  function paintEdgeSwatches() {
    if (!settingsEl || !settingsEl.querySelectorAll) return;
    for (const el of settingsEl.querySelectorAll("[data-edge]")) {
      const kind = el.dataset && el.dataset.edge;
      const stroke = el.querySelector && el.querySelector(".line-stroke");
      if (!kind || !stroke) continue;
      const colour = edgeLook(kind, "colour");
      const width = Number(edgeLook(kind, "width")) || 1;
      const style = edgeLook(kind, "style");
      const arrow = edgeLook(kind, "arrow");

      // Cytoscape's own patterns, so the row draws the line the canvas draws.
      // They do not scale with the width and the swatch's must not either: a
      // pattern of this project's own invention is a picture of a line that
      // exists nowhere.
      const dash = DASH_PATTERNS[style] || "";
      stroke.setAttribute("stroke", colour);
      stroke.setAttribute("stroke-width", String(width));
      stroke.setAttribute("stroke-dasharray", dash);
      // Stop short of the head so the two do not overlap.
      stroke.setAttribute("x2", arrow === "none" ? "41" : "30");

      const head = el.querySelector(".arrow-head");
      if (head) {
        head.setAttribute("d", ARROW_PATHS[arrow] || "");
        head.setAttribute("fill", colour);
        head.setAttribute("stroke", colour);
        head.setAttribute("opacity", arrow === "none" ? "0" : "1");
      }
    }
  }






  /** Put back what was last saved, and redraw whatever that costs. */
  function discardDraft() {
    if (!isDirty()) return;
    const [band, palette, edges, centre, floor] = JSON.parse(savedState);
    const wasLayout = band !== bandOverflow || (centre || "") !== (settings.centre || "");
    const wasView = (floor === null ? undefined : floor) !== settings.labelFloor;
    bandOverflow = band;
    settings = {
      palette: { ...palette },
      edges: { ...edges },
      centre: centre || "",
      labelFloor: floor === null ? undefined : floor,
    };
    writePaletteVars();
    syncSettingControls();
    applyCost(wasLayout ? "layout" : wasView ? "view" : "paint");
  }

  function applyCost(cost) {
    if (cost === "layout") {
      // The centre is one of these settings, and it is read once, where the
      // graph arrives. Re-deriving it here is what lets the choice take effect
      // without the document being sent again.
      if (artifactGraph) {
        centerClassId = chosenCentre(artifactGraph) || pickTopClass(artifactGraph);
      }
      applyView();
    } else if (cost === "view") {
      // Nothing moves and nothing is recoloured: what changed is how much of
      // the drawing the camera takes in, so the answer is to frame it again.
      // Framing it is also the only way to see the choice, since the number
      // only binds while a view is being fitted.
      resetView();
    } else if (cost === "paint") {
      repaint();
    }
  }

  /**
   * Hand a change back to the host, which keeps it for the reader rather than
   * for this panel. Fire and forget: there is nothing to do if it fails, and
   * a colour change that waited for a round trip would make the panel feel
   * like a form.
   */
  /**
   * The last state the host was told about.
   *
   * The panel edits a draft: a change shows at once, in the drawing and in the
   * rows, and is kept only when the reader says so. A panel that wrote
   * every keystroke to the store would give the reader no moment at which they
   * had finished, and no way to try something and walk away from it — so
   * closing with a draft outstanding puts this back.
   */
  let savedState = null;

  function snapshotSettings() {
    return JSON.stringify([
      bandOverflow,
      settings.palette,
      settings.edges,
      settings.centre || "",
      settings.labelFloor === undefined ? null : settings.labelFloor,
    ]);
  }

  function isDirty() {
    return savedState !== null && savedState !== snapshotSettings();
  }

  function saveSettings() {
    // Only what the reader moved. Sending the whole table would write every
    // default into the host's store, and a default that has been written down
    // stops following the drawing when the drawing's own default changes.
    const out = {};
    for (const entry of changedSettings()) {
      const parts = entry.key.split(".");
      if (parts[0] === "bandOverflow") {
        out.bandOverflow = bandOverflow;
        continue;
      }
      let at = out;
      for (let i = 0; i < parts.length - 1; i++) at = at[parts[i]] = at[parts[i]] || {};
      at[parts[parts.length - 1]] = settingValue(entry);
    }
    savedState = snapshotSettings();
    syncSettingControls();
    try {
      vscode.postMessage({ command: "saveSettings", settings: out });
    } catch (e) {
      /* no host: the choice holds for this session and no longer */
    }
  }
  /** Center of the whole graph plus the center of each disconnected group. */
  /** @type {Set<string>} */
  let centerIds = new Set();
  /** Which group each node belongs to, keyed by that group's center. */
  /** @type {Record<string, string>} */
  let nodeGroups = {};

  /** Ring radii per group, recomputed with the layout. See `ringsByGroup`. */
  let ringGroups = [];
  /** True while the search field holds keyboard focus, so the graph's own
   *  single-letter shortcuts (f, /) do not fire while the user is typing a
   *  name that happens to contain one. */
  let searchFocused = false;

  /** Index into the current search matches that the next Enter will select.
   *  Resets to 0 whenever the typed query changes, so repeated Enters on the
   *  same text step through every match instead of always landing on the
   *  first one. */
  let searchCycleIndex = 0;
  /** The query text `searchCycleIndex` was last reset against. */
  let searchCycleQuery = null;

  // Raising this needs one opacity level per new hop class in the stylesheet
  // below, otherwise the extra hop renders at full strength.
  const EMPHASIS_HOPS = 1;
  const EMPHASIS_CLASSES = "hop-0 hop-1 dimmed";

  const RING_RADIUS = 180;
  const SAT_RADIUS = 55;

  /** Node circles are 28px across in the stylesheet below. */
  const NODE_DIAMETER = 28;
  /**
   * A satellite is drawn smaller than what it orbits.
   *
   * Two reasons, and the first is geometry rather than taste. A full orbit of
   * `count` bodies has an outer edge at `count * (diameter + gap) / 2π` plus
   * one radius, and it must stay inside `RING_RADIUS` (180) or it reaches the
   * next ring of classes. At the ordinary 28px, an orbit of 32 — the busiest
   * in the FastAPI fixture — ends at 187 and overshoots. At 22px it ends at
   * 154 and sits clear.
   *
   * The second is that without it the drawing cannot say which parts of the
   * structure are heavy: a class carrying twenty functions and a class carrying
   * none would be the same circle, and which is which is what a reader turning
   * functions on is looking for.
   *
   * 14px reads as too small to be a body at all. The size that makes the
   * geometry easiest is not the size that makes the picture legible — and the
   * geometry is not the binding constraint anyway: seating each satellite at
   * the first free angle absorbs every size up to the full 28 with no overlaps
   * and no measurable spread. The drawing grows about 1% and the median
   * satellite stays 55px from its owner.
   *
   * So what sets this is the reading, not the packing. It has to stay clearly
   * smaller than what it orbits, because "which parts of the structure are
   * heavy" is the thing being shown. 22 is a little over half a class by area
   * and 2.5x the area of 14; there is real room above it if it still reads small.
   */
  const SAT_DIAMETER = 22;
  const SAT_FONT_SIZE = 13;
  /** Clear space between two satellites sharing an orbit. */
  const SAT_GAP = 6;
  /**
   * Label size everywhere. Measured on the FastAPI graph as opened (functions
   * hidden, 126 nodes): at 10 one pair of labels collides, at 15 six pairs, at
   * 20 sixteen. 15 buys readability for the cost of five more collisions.
   */
  const BASE_FONT_SIZE = 15;
  /** The focused node alone grows further, so a click still reads as a change. */
  const FOCUS_FONT_SIZE = 20;

  /**
   * Ring radii are bucketed to this before deduping. Vertices meant for the
   * same ring can land a hair apart after the angular maths, and raw floats
   * would draw a dozen coincident circles where one belongs. Well under the
   * smallest real gap between rings, which is a compressed `RING_RADIUS` step.
   */
  const RING_QUANTUM = 2;
  /** Orbit lines are a fixed hairline in screen pixels: they must read as
   *  structure at every zoom without ever competing with the edges, which do
   *  scale. Drawn under everything cytoscape renders. */
  const RING_LINE_WIDTH = 1;
  const RING_STROKE = "rgba(150,178,214,0.16)";

  /**
   * Star field layers, thought about the way a 2D space game would.
   *
   * The camera is the player and the drawing is the plane they are on. The
   * background's job is to report *their* motion — "I am moving through
   * space", not "the picture is sliding". That makes `depth` the only number
   * a layer needs, and everything else follows from it:
   *
   *   depth 0   infinitely far: never moves, never changes size (a skybox)
   *   depth 1   the drawing's own plane: welded to it, so it reports nothing
   *
   * Both extremes are wrong for the same reason. A fixed backdrop gives
   * maximum relative motion and reads as two stacked pictures, the background
   * looking separate from the drawing. A backdrop pinned at 1 gives *zero*
   * relative motion and reads as wallpaper glued to the diagram. Depth comes
   * from the spread between layers, so none of them sits at either end.
   *
   * `depth` drives the pan share AND the zoom response (`zoom ** depth`), so a
   * layer cannot claim to be far away when panning and near when zooming.
   * Nearer layers are drawn larger and brighter, which is the depth cue that
   * still works when nothing is moving at all.
   *
   * Drawn additively: light adds, and stars do not occlude one another. Alpha
   * blending would average each layer into the one below and wash the
   * highlights out, so three layers would measure *fainter* than two.
   */
  const STAR_LAYERS = [
    { depth: 0.35, scale: 0.45, alpha: 0.19, phaseX: 0, phaseY: 0 },
    { depth: 0.6, scale: 0.72, alpha: 0.32, phaseX: 317, phaseY: 149 },
    { depth: 0.85, scale: 1.15, alpha: 0.34, phaseX: 811, phaseY: 577 },
  ];

  /**
   * Never draw the tile smaller than this, whatever `zoom ** depth` asks for.
   * Measured on the shipped tile by resampling it down and back: star
   * retention is flat above 0.5x, still 85% at 0.4x, and falls off a cliff
   * below that — 48% at 0.3x. Without the floor, raising the layers' depths to
   * make them drift faster would also make the far layer shed half its stars
   * at the opening fit zoom, since `0.35 ** depth` shrinks faster as depth
   * rises. This is a resampling-quality guard, not a change to the model.
   */
  const STAR_MIN_TILE_SCALE = 0.45;
  /**
   * What the export draws instead of `STAR_LAYERS`.
   *
   * The three layers exist to report the reader's own motion — that is the
   * entire job of a parallax layer. A still image has no motion to report, so
   * in an exported PNG they are three copies of the same texture at three
   * scales, indistinguishable from one layer of the same density.
   *
   * They are not free, though: a star field is dense high-frequency noise,
   * which is precisely what a lossless format cannot compress. Measured on a
   * real 6939 x 3984 export, the background alone cost **14.0 MB** as three
   * layers against 2.9 MB for the entire drawing on top of it. This single
   * layer is tuned to the same visible star density rather than to one of the
   * three depths — 0.73x of the three-layer density at **3.5 MB**, where
   * simply keeping the nearest layer would have been both sparser (0.49x) and
   * larger (3.8 MB), since its bigger tile repeats less often.
   */
  const EXPORT_STAR_LAYERS = [
    { depth: 0.6, scale: 0.72, alpha: 0.46, phaseX: 0, phaseY: 0 },
  ];

  /** Only used before the tile has loaded, to keep the maths finite. */
  const STAR_TILE_FALLBACK = 1600;
  /**
   * Every label is outlined against the background. Emphasis widens it rather
   * than being the only thing that has it; see the `hop-0` / `hop-1` rules.
   */
  const BASE_OUTLINE_WIDTH = 1.8;

  /** Labels are drawn centered on the node and overflow its 28px circle, so
   *  isolated nodes need far more room across than down: a median symbol name
   *  runs ~13 characters. Derived from the label size rather than fixed, so
   *  changing that size cannot silently start overlapping them.
   *
   *  These are the axes of the exclusion *ellipse* around an isolated node —
   *  not the gaps of a rectangular grid, which would be the least celestial
   *  the least celestial arrangement available; see `placeUnlinkedCluster`. */
  const UNLINKED_SEP_X = 15 * BASE_FONT_SIZE;
  const UNLINKED_SEP_Y = NODE_DIAMETER + Math.round(BASE_FONT_SIZE * 1.2) + 16;

  /**
   * Isolated nodes are arranged as a phyllotaxis spiral — the sunflower-seed
   * packing — rather than as a grid.
   *
   * A grid reads as a spreadsheet, which is the least celestial arrangement
   * there is, and its 3.6:1 cell shape would make that worse: perfectly aligned
   * rows and columns at very different pitches. But that anisotropy is not
   * negotiable, because the label overflows sideways. So it is used as the
   * shape instead of fought: points are placed isotropically and then scaled
   * by `UNLINKED_SEP_X` / `UNLINKED_SEP_Y`. Scaling maps the unit circle
   * exactly onto the exclusion ellipse — `(dx/SEP_X)^2 + (dy/SEP_Y)^2 >= 1`
   * holds iff the normalized points were a unit apart — so label separation is
   * guaranteed by construction rather than checked afterwards. What it looks
   * like is a disc seen at an angle.
   *
   * `SPIRAL_OFFSET` exists because `r = c*sqrt(i)` puts point 0 at the origin
   * and point 1 a unit away, making the very centre the tightest pair in the
   * whole arrangement while the bulk sits ~1.9 apart. Everything then has to
   * be scaled up to clear that one pair, costing 3.14x the grid's area per
   * node. Offsetting the spiral outward lifts the worst-case separation to
   * ~1.64 and brings the cost down to 1.24x, searched over offsets 0 to 5.
   */
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const UNLINKED_SPIRAL_OFFSET = 1.5;
  /**
   * Derived, not chosen. At `UNLINKED_SPIRAL_OFFSET`, the tightest pair
   * anywhere in 2..400 nodes sits 1.640995 apart (it occurs at N = 7), so the
   * whole arrangement is scaled by its reciprocal to bring that pair to
   * exactly one exclusion ellipse. The half-percent of margin is there because
   * rounding 0.609386 down to 0.609 would land the closest pair at 0.9994 of an
   * ellipse — inside it, by a thousandth.
   */
  const UNLINKED_SPIRAL_SCALE = 1.005 / 1.640995;
  /**
   * Clear space between two disconnected groups, in both axes.
   *
   * For reading them apart, and only that. Keeping their rings apart is the
   * box's job — the room reserved for a group already contains its outermost
   * circle, so two boxes that do not overlap hold two circles that do not
   * either. A larger number here would be a second reservation on top of the
   * first: at 360, the space between two 130px trees on CPython would be almost
   * three times the trees.
   *
   * One ring step is the statement: the space between two groups is at least
   * as wide as one step inside a group. Checked at 240, 120 and 60 as well —
   * the ring and overlap promises hold at all of them, which says the geometry
   * is safe rather than that the drawing reads well, so the number is chosen
   * against the drawing and not against the tests.
   */
  const COMPONENT_GAP = RING_RADIUS;
/**
 * How far one row of an overflowing sector sits outside the row inside it.
 *
 * Larger than a node so consecutive rows clear each other, and small enough
 * that the rows a sector is allowed stay inside `RING_RADIUS`: a row that
 * reached the next ring would have to move it, and moving a ring moves every
 * ring outside it.
 */
  const BAND_STEP = 45;
  /** Groups are packed into rows aiming for roughly this shape. Deliberately
   *  fixed rather than following the actual canvas: following a narrower
   *  canvas makes the drawing much *worse*, not better. Group boxes are chunky,
   *  so the row packer cannot hit an arbitrary target — asked for 1.33 with
   *  FastAPI's three groups it drops from three-per-row to fewer and produces a
   *  2327x3457 drawing, overshooting into a shape far taller than asked for and
   *  costing 38% of the fit zoom. The fixed value acts as a stabiliser; making
   *  the packer genuinely aspect-aware is its own problem. */
  const TARGET_ASPECT = 16 / 9;
  /**
   * Zoom floor, expressed as the smallest rendered label size worth drawing.
   *
   * The opening view fits the whole drawing. On a project small enough for that
   * to stay visible this is all that happens; the floor exists for the ones
   * where it does not. Fitting alone would open a 2000-class graph at 0.7px
   * labels and 1.4px circles, which is not a drawing, it is noise. The floor stops the
   * fit there and accepts that most of such a graph is off screen.
   *
   * Expressed against the label rather than the zoom so it does not silently
   * change meaning when `BASE_FONT_SIZE` does.
   *
   * 4.5 is chosen from measurement: 12 reads as far too magnified, 9 as still
   * too magnified. At 4.5 the FastAPI fixture opens whole at
   * 1200x800 and above, and the floor only binds on a small window or a very
   * large project. It is the default the reader's setting starts from.
   */
  const MIN_LABEL_PX = 4.5;

  /**
   * The floor now in force: the reader's, or the tuned default above.
   *
   * Every framing reads this, not only the one on open: `Reset view` and a
   * jump from search go through the same fit. The panel calls it `default
   * view` for that reason — naming it for opening would have named one of the
   * three times it decides what the reader sees.
   *
   * A function rather than a value read once, because the reader can move it
   * while an artifact is open and the next framing has to use the new one.
   * Clamped to the range the control offers, since a stored setting outlives
   * the control that wrote it and arrives from the host unchecked.
   */
  function labelFloor() {
    const v = Number(settings.labelFloor);
    if (!Number.isFinite(v) || v <= 0) return MIN_LABEL_PX;
    return Math.min(15, Math.max(2, v));
  }
  /** Margin left around the drawing when fitting. */
  const FIT_PADDING = 24;

  /**
   * Export geometry. The two caps are the browser's, not ours: canvases refuse
   * to allocate past roughly 16384px on a side or 268 megapixels of area, and
   * a large project's drawing exceeds both by a wide margin.
   */
  const CANVAS_MAX_SIDE = 16384;
  const CANVAS_MAX_AREA = 268435456;
  /**
   * Rendered at 1:1 with the drawing's own coordinates.
   *
   * Not 2x, although an exported image should survive being looked at
   * closely. It does not need 2x for that: the drawing is already
   * 3470px wide on the FastAPI fixture at 1x, and a label renders at exactly
   * the size it has on screen at zoom 1, which is the size it was tuned to be
   * readable at.
   *
   * What 2x would buy is four times the pixels, and this picture is 97% star
   * field — dense low-amplitude noise, the one thing a lossless format cannot
   * compress. At 2x a real export is 23.7 MB, 87% of it background.
   * Quadrupling the pixel count to sharpen text that was already sharp is a
   * bad trade when the cost lands on every pixel of the sky behind it.
   */
  const EXPORT_SCALE = 1;
  /** Breathing room around the drawing, in world units, as `fit` uses. */
  const EXPORT_PADDING = 40;
  /** Ceiling, so a two-node graph is not two circles filling the screen. */
  const MAX_OPEN_ZOOM = 2;
  /**
   * Smallest world-space area a search jump's neighbourhood fit will ever be
   * zoomed past, however few nodes are in it. In the same units as everything
   * else in the layout (`RING_RADIUS`, `NODE_DIAMETER`) rather than a fixed
   * zoom multiplier, so what it guarantees ("at least this much canvas stays
   * visible") means the same thing on a narrow docked panel and a maximised
   * window — a flat zoom-number ceiling would not work: on a typical viewport
   * it either does nothing (the natural fit is already under it) or clamps to
   * the same fixed size regardless of how much room the viewport actually has.
   *
   * 800 (zoom ≤ 1, nodes never larger than their unmagnified size) reads as
   * too small in practice — it clamps ordinary, not-especially-sparse
   * neighbourhoods too, not just the one- or two-node case this is for.
   * 500 (zoom ≤ 1.6 on a viewport around 800px in its narrower
   * dimension) leaves more room before the ceiling engages at all.
   */
  const MIN_SEARCH_EXTENT = 500;

  /**
   * The zoom past which `MIN_SEARCH_EXTENT` says not to go, for the viewport
   * as it is right now. Recomputed per call rather than cached: the viewport
   * can resize between one search jump and the next.
   */
  function searchZoomCeiling() {
    if (!cy) return MAX_OPEN_ZOOM;
    const w = cy.width();
    const h = cy.height();
    if (!w || !h) return MAX_OPEN_ZOOM;
    return Math.min(w, h) / MIN_SEARCH_EXTENT;
  }
  /** Key that frames the whole drawing. Listed in the legend. */
  const FIT_KEY = "f";
  /** Key that focuses the search field. Listed in the legend. */
  const SEARCH_KEY = "/";
  /**
   * Key that makes the focused node the centre, and hands it back when it is
   * already the centre. Listed in the legend.
   *
   * `c` for centre, the way `f` is for fit — the legend is the only place this
   * viewer is documented, so a key a reader has to memorise from it is a key
   * they will not remember. Not the right button: that is a gesture with
   * nothing written on it anywhere, and the viewer uses it for something else.
   */
  const CENTRE_KEY = "c";
  /** Expand the focused type's members where it stands, or put them away. */
  const EXPAND_KEY = "e";
  /** Draw the focused type's members alone. */
  const ONLY_KEY = "m";
  /**
   * Chars needed before live search highlighting kicks in. Below this a
   * single letter would match most of the graph and dim almost nothing,
   * which reads as broken filtering rather than as a starting point.
   */
  const SEARCH_HIGHLIGHT_MIN_CHARS = 2;
  /**
   * How far the reader must scroll, in pixels, to double or halve the zoom.
   *
   * Stated this way because it answers the question a reader has: a wheel
   * notch reports about 100, so this is five notches to a doubling. A multiple
   * of whatever the library was about to do would depend on what it had
   * concluded from the reader's first four turns — see the wheel handler.
   *
   * 500 matches the rate the library gives a wheel's first four turns, the one
   * the reader meets first and learns the gesture on: those clamped turns work
   * out at x1.1482 a notch, and 2^(100/500) is x1.1487. Here it is also the
   * fifth turn's rate, and the fiftieth's.
   */
  const ZOOM_DOUBLING_SCROLL = 500;
  /**
   * Pixels one line stands for, when a wheel event is measured in lines rather
   * than pixels. Firefox on Linux reports `deltaMode === 1` with about 3 per
   * notch where everything else reports about 100 pixels.
   */
  const WHEEL_LINE_PIXELS = 33;
  /** Closest two tree vertices may ever be: the circle plus breathing room. */
  const MIN_SEPARATION = NODE_DIAMETER * 1.5;
  /** Where the root's circle of children starts. -90° puts the first child up. */
  const SECTOR_ORIGIN = -Math.PI / 2;
  /**
   * The opening the right button's set is laid out in: 120° pointing up, so
   * the pressed node sits at the foot and what it points to rises above it.
   * -90° is up on screen, y growing downward.
   *
   * A full ring says the others surround the node; this set is directional,
   * and a fan says so. Both the direction and the angle are the reader's call;
   * the narrower fan is preferred because a crowded first ring widens it
   * anyway. Where the first ring would crowd, it widens about the same centre
   * only as far as that ring needs, up to `widenTo`, a full circle. Retuning
   * any of it is changing these lines.
   */
  const REACH_FAN = {
    start: -Math.PI / 2 - Math.PI / 3,
    width: (2 * Math.PI) / 3,
    widenTo: 2 * Math.PI,
  };
  /**
   * A run of single-child links carries no branching, so it needs no ring step.
   * Each successive link shrinks by this factor down to `MIN_SEPARATION`, which
   * keeps a class with one subclass looking normal while stopping a 50-deep
   * inheritance chain from drawing as a 9000px line.
   */
  const UNARY_STEP_DECAY = 0.55;

  /**
   * Leaves under every node of a child map, counted iteratively.
   *
   * This is the angular weight: the width a subtree needs is set by how many
   * nodes end up side by side on its outermost ring, not by how deep it runs.
   * Iterative rather than recursive because a deep chain would overflow the
   * call stack, and guarded against cycles because a malformed parent map must
   * not hang the viewer.
   *
   * A node may ask for more than one leaf's worth of the ring: an open type
   * carries a ring of its own members, and the space that ring needs is space
   * the nodes beside it have to give up. `weightOf` is how it asks, in the
   * same unit everything else is measured in — one leaf, one seat.
   *
   * @param {Record<string, string[]>} childrenOf
   * @param {string} root
   * @param {(id: string) => number} [weightOf]
   * @returns {Record<string, number>}
   */
  function leafCounts(childrenOf, root, weightOf) {
    const weight = (id) => (weightOf ? Math.max(1, weightOf(id)) : 1);
    /** @type {Record<string, number>} */
    const counts = {};
    const seen = new Set();
    /** @type {[string, boolean][]} */
    const stack = [[root, false]];
    while (stack.length) {
      const [id, expanded] = stack.pop();
      const kids = childrenOf[id] || [];
      if (kids.length === 0) {
        counts[id] = weight(id);
        continue;
      }
      if (!expanded) {
        if (seen.has(id)) {
          counts[id] = 1;
          continue;
        }
        seen.add(id);
        stack.push([id, true]);
        for (const k of kids) stack.push([k, false]);
      } else {
        let total = 0;
        for (const k of kids) total += counts[k] !== undefined ? counts[k] : 1;
        // A parent needs room for its own ring as well as for its children's.
        counts[id] = Math.max(total, weight(id));
      }
    }
    return counts;
  }

  /** Which nodes of this drawing are members, built once per graph. */
  const memberIdCache = new WeakMap();
  function drawnMemberIds(graph) {
    let ids = memberIdCache.get(graph);
    if (!ids) {
      ids = new Set();
      for (const n of graph.nodes) if (n.member) ids.add(n.id);
      memberIdCache.set(graph, ids);
    }
    return ids;
  }

  /**
   * Spread the root's heaviest subtrees to opposite sides of its circle.
   *
   * Sector widths do not depend on this order and neither does the ring radius,
   * so the guarantee is untouched — but where the mass sits does. With the
   * default ordering, OpenAPI's two largest children are adjacent, so most of
   * the group piles up on one side and the drawing reads as centred on
   * `BaseModelWithConfig` rather than on OpenAPI. Measured on that group, the
   * centroid sits 272px from OpenAPI and 223px from `BaseModelWithConfig`;
   * balancing moves it to 97px and 164px, so the marked centre is the
   * nearest thing to the centre of mass.
   *
   * Root only. Deeper parents own a slice rather than a full circle, so there
   * are no opposite sides to spread across, and reordering there just scrambles
   * the inherit-grouping `orderRingClasses` establishes.
   *
   * @param {Record<string, string[]>} orderedKids
   * @param {string} root
   */
  function balanceRootChildren(orderedKids, root) {
    const kids = orderedKids[root];
    if (!kids || kids.length < 3) return;
    const leaves = leafCounts(orderedKids, root);
    const weight = (id) => (leaves[id] !== undefined ? leaves[id] : 1);
    const heaviestFirst = kids.slice().sort((a, b) => {
      const d = weight(b) - weight(a);
      if (d !== 0) return d;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    /** @type {string[]} */
    const near = [];
    /** @type {string[]} */
    const far = [];
    let nearWeight = 0;
    let farWeight = 0;
    for (const id of heaviestFirst) {
      if (nearWeight <= farWeight) {
        near.push(id);
        nearWeight += weight(id);
      } else {
        far.push(id);
        farWeight += weight(id);
      }
    }
    // Reversing the far half keeps the two heaviest at opposite ends, which on
    // a closed circle means opposite sides.
    orderedKids[root] = near.concat(far.reverse());
  }

  /**
   * Radius at which two points `angle` apart around a circle are `sep` apart.
   *
   * Straight-line distance is the chord `2r·sin(θ/2)`, not the arc `r·θ`. Using
   * the arc left pairs 41.97px apart against a 42px floor — small, but the
   * guarantee is either exact or it is not one. `angle` is taken the short way
   * round, so a separation of 0 (nothing to clear) is the only case with no
   * finite answer.
   */
  function radiusForChord(sep, angle) {
    let a = Math.abs(angle) % (2 * Math.PI);
    if (a > Math.PI) a = 2 * Math.PI - a;
    const s = Math.sin(a / 2);
    if (s <= 1e-9) return 0;
    return sep / (2 * s);
  }

  /**
   * Bucketed point lookup for "is anything already sitting here".
   *
   * Nodes outside the tree — helper classes orbiting a producer function, and
   * function satellites — get their slot from whatever they attach to, so two
   * of them can land on top of each other with no shared parent to arbitrate.
   * Scanning every placed position for each one would be O(N²); bucketing by
   * `MIN_SEPARATION` makes it a constant number of cells.
   */
  function makeSpatialIndex(cell) {
    /** @type {Map<string, { x: number; y: number }[]>} */
    const cells = new Map();
    const key = (cx, cy) => cx + ":" + cy;
    return {
      add(p) {
        const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
        const bucket = cells.get(k);
        if (bucket) bucket.push(p);
        else cells.set(k, [p]);
      },
      /** True when nothing already placed is within `cell` of this point. */
      isFree(p) {
        const cx = Math.floor(p.x / cell);
        const cy = Math.floor(p.y / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = cells.get(key(cx + dx, cy + dy));
            if (!bucket) continue;
            for (const q of bucket) {
              if (Math.hypot(p.x - q.x, p.y - q.y) < cell) return false;
            }
          }
        }
        return true;
      },
    };
  }

  /** Outward fan span: ≤3 children → 90°, else 120°. */
  function outerFanSpanRad(count) {
    return count <= 3 ? Math.PI / 2 : (2 * Math.PI) / 3;
  }

  function outerFanAngle(baseOut, i, count) {
    const span = outerFanSpanRad(count);
    const t = count === 1 ? 0.5 : i / (count - 1);
    return baseOut - span / 2 + t * span;
  }

  /**
   * How much room a node takes on screen. Satellites are drawn smaller, so
   * anything reasoning about collisions has to ask rather than assume.
   *
   * @param {string} id
   * @param {Record<string, string>} satelliteOwner
   */
  function bodyRadius(id, satelliteOwner) {
    return (satelliteOwner && satelliteOwner[id] ? SAT_DIAMETER : NODE_DIAMETER) / 2;
  }

  /**
   * Which cells of space are taken, so a satellite can be asked to sit
   * somewhere free without comparing it against every node in the drawing.
   *
   * A plain O(n) scan per candidate seat is fine for a fixture and not for the
   * 2000-class graph the layout is already careful about, and the check is
   * needed several times per satellite. One bucket grid keyed on the largest
   * body plus its clearance keeps each check to nine cells.
   */
  const VERTEX_PENALTY = 120;

  function makeOccupancy(cell) {
    /** @type {Map<string, { x: number; y: number; r: number }[]>} */
    const buckets = new Map();
    const key = (cx, cy) => cx + "," + cy;
    return {
      add(x, y, r, isVertex) {
        const k = key(Math.floor(x / cell), Math.floor(y / cell));
        const entry = { x, y, r, isVertex: !!isVertex };
        const list = buckets.get(k);
        if (list) list.push(entry);
        else buckets.set(k, [entry]);
      },
      /**
       * Smallest surface gap from a body of radius `r` centred here to
       * anything already placed, and separately to the tree vertices among
       * them. Negative means overlapping.
       *
       * Kept apart because they answer different questions. "Is this seat
       * free" is about everything; "is this seat a bad place to end up" is
       * mostly about classes, since a satellite drawn over a class reads as
       * belonging to that class. Folding the second into the first would be a
       * mistake: with one number, a seat merely near a class would score as
       * occupied, so nothing could sit near any class at all — not even its own.
       */
      probe(x, y, r) {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        let gap = Infinity;
        let vertexGap = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const list = buckets.get(key(cx + dx, cy + dy));
            if (!list) continue;
            for (const o of list) {
              const dd = Math.hypot(o.x - x, o.y - y) - o.r - r;
              if (dd < gap) gap = dd;
              if (o.isVertex && dd < vertexGap) vertexGap = dd;
            }
          }
        }
        return { gap, vertexGap };
      },
    };
  }

  /**
   * The first free seat at or after the satellite's ideal one.
   *
   * Orbit geometry keeps one owner's satellites off each other; it says
   * nothing about two owners whose orbits reach into the same space, and
   * measurement says that is where the last overlaps live — nine on the
   * FastAPI fixture, every one of them between satellites of *different*
   * owners or a satellite and a backbone class.
   *
   * Rotating along the orbit is the cheapest way out that keeps what the
   * picture is claiming: the satellite is still at its owner's radius, still
   * going round the same node.
   *
   * The radius never changes here, and that is the point. Pushing a satellite
   * out to a second, wider ring when the first is full does avoid the
   * overlap, and it draws two concentric circles around one node — which
   * reads as two tiers of something, a distinction the graph does not make.
   * One ring is what is true. Where the ring cannot hold them all they
   * overlap, which is the honest failure: crowded, and visibly one orbit.
   */
  function freeSeat(occupancy, tentative, ownerPos, radius, angle, bodyRadius, slot, maxOffset) {
    // `tentative` are seats already handed out in this same attempt but not
    // committed, because the whole set is seated together and may be redone
    // at a wider radius.
    // How much room a seat has: the smallest surface gap to anything already
    // there. Negative means overlapping. Returned as a number rather than a
    // yes/no so that when no seat is free the emptiest one can be taken —
    // otherwise the fallback is the ideal angle, which on a full ring is a
    // sibling's seat, and two bodies land exactly on top of each other.
    const clearance = (x, y) => {
      const { gap, vertexGap } = occupancy.probe(x, y, bodyRadius);
      let room = gap;
      // Tentative seats are all satellites, so none of them is a vertex.
      for (const t of tentative) {
        const d = Math.hypot(t.x - x, t.y - y) - t.r - bodyRadius;
        if (d < room) room = d;
      }
      // Free is free of everything. The ranking used when nothing is free
      // additionally prefers landing on a sibling over landing on a class.
      return { room, rank: room - (vertexGap < 0 ? VERTEX_PENALTY : 0) };
    };
    // Step by the orbit's own slot, not by an angle derived from the arc.
    // Those are nearly the same number and the difference matters: at 22
    // satellites the slot is 16.36 degrees and the arc-derived step 16.30, so
    // stepping by the arc would land a displaced satellite 0.06 degrees from a
    // sibling instead of on the next seat along. Stepping by the slot lands on
    // the next seat exactly, and since seats are filled in order that one is
    // still free.
    const stepAngle =
      slot > 1e-6
        ? slot
        : Math.max(0.12, (SAT_DIAMETER + SAT_GAP) / Math.max(radius, 1));
    const turns = Math.ceil((2 * Math.PI) / stepAngle);
    let roomiest = -Infinity;
    let fallback = {
      x: ownerPos.x + Math.cos(angle) * radius,
      y: ownerPos.y + Math.sin(angle) * radius,
      a: angle,
      found: false,
    };
    for (let k = 0; k <= turns; k++) {
      // Alternate either side so the satellite drifts as little as it can
      // from where its orbit wanted it.
      const offsets = k === 0 ? [0] : [k * stepAngle, -k * stepAngle];
      // A chain's link may only shuffle inside its own wedge; going further
      // would put it in a sibling's, or fold it back over its parent.
      if (maxOffset !== undefined && k * stepAngle > maxOffset) break;
      for (const off of offsets) {
        const a = angle + off;
        const x = ownerPos.x + Math.cos(a) * radius;
        const y = ownerPos.y + Math.sin(a) * radius;
        const { room, rank } = clearance(x, y);
        if (room >= SAT_GAP) return { x, y, a, found: true };
        if (rank > roomiest) {
          roomiest = rank;
          fallback = { x, y, a, found: false };
        }
      }
    }
    return fallback;
  }

  /**
   * Where one node's satellites go: a radius and an angle per satellite.
   *
   * Pulled out as one function because radius and angle are one decision. The
   * radius that fits N nodes depends on the arc they are spread over, so
   * chosen apart, a span can end up unable to hold what the radius was sized
   * for.
   *
   * @param {number} count
   * @param {number} baseOut direction away from whatever the owner hangs off
   * @param {boolean} whole true for an owner that gets the full circle
   * @returns {{ radius: number; slot: number; angleAt: (i: number) => number }}
   */
  function satelliteOrbit(count, baseOut, whole) {
    // Centre-to-centre distance two neighbours need in order not to touch.
    const step = SAT_DIAMETER + SAT_GAP;
    // Two satellites an angle apart are separated by the chord between them,
    // not by the arc. Sizing the radius from arc length leaves every orbit
    // fractionally too tight — 19.9px where 20 was asked for at 22 satellites
    // — which is invisible and still means the invariant does not hold.
    const radiusForGap = (delta) =>
      delta > 0 ? step / (2 * Math.sin(Math.min(delta, Math.PI) / 2)) : 0;
    const fullRadius = Math.max(
      SAT_RADIUS,
      count > 1 ? radiusForGap((2 * Math.PI) / count) : 0
    );

    // Island roots have nothing to face away from, so they always get the
    // whole circle.
    if (whole) {
      return {
        radius: fullRadius,
        slot: (2 * Math.PI) / count,
        angleAt: (i) => baseOut + (2 * Math.PI * i) / count,
      };
    }

    // The outward fan is kept while it can hold the satellites at the minimum
    // radius: an owner with two satellites should have them beside it, not
    // pushed out to a radius sized for a crowd. `count - 1` gaps, because the
    // fan puts a satellite at each end of the span.
    const span = outerFanSpanRad(count);
    const fanRadius = count > 1 ? radiusForGap(span / (count - 1)) : 0;
    if (fanRadius <= SAT_RADIUS) {
      return {
        radius: SAT_RADIUS,
        slot: count > 1 ? span / (count - 1) : span,
        angleAt: (i) => outerFanAngle(baseOut, i, count),
      };
    }

    // Full, so it opens rather than stretching. Widening the fan alone would
    // need a radius that grows without bound as the span approaches a circle
    // it never reaches; the circle is the limit, so take it. The radius is
    // then linear in the count, as arc length is. An `8 * sqrt(count)` radius
    // would only exceed the minimum above 47 satellites, so across the whole
    // range where crowding actually happens it would compensate by nothing at
    // all.
    return {
      radius: fullRadius,
      slot: (2 * Math.PI) / count,
      angleAt: (i) => baseOut + (2 * Math.PI * i) / count,
    };
  }

  const toggleFnsEl = document.getElementById("toggle-fns");
  const sidebarEl = document.getElementById("sidebar");
  const sidebarToggleEl = document.getElementById("sidebar-toggle");
  const toggleLegendEl = document.getElementById("toggle-legend");
  const exportPngEl = document.getElementById("export-png");
  const resetViewEl = document.getElementById("reset-view");
  const reachStripEl = document.getElementById("reach-strip");
  const reachBackEl = document.getElementById("reach-back");
  const reachNameEl = document.getElementById("reach-name");
  const reachCountEl = document.getElementById("reach-count");
  const legendEl = document.getElementById("legend");
  const commentEl = document.getElementById("comment");
  const settingsEl = document.getElementById("settings");
  const toggleSettingsEl = document.getElementById("toggle-settings");
  const settingsCloseEl = document.getElementById("settings-close");
  const settingsResetEl = document.getElementById("settings-reset");
  const settingsSaveEl = document.getElementById("settings-save");
  const settingsDirtyEl = document.getElementById("settings-dirty");
  const commentTitleEl = document.getElementById("comment-title");
  const commentExpandEl = document.getElementById("comment-expand");
  const commentOnlyEl = document.getElementById("comment-only");
  const commentBodyEl = document.getElementById("comment-body");
  const commentMembersEl = document.getElementById("comment-members");
  const emptyEl = document.getElementById("empty");
  const errorEl = document.getElementById("error");
  const cyEl = document.getElementById("cy");
  // The drawing's container is `position: absolute; inset: 0` inside this, so
  // the two occupy exactly the same rectangle — which is what lets the wheel
  // handler read the pointer's position within the drawing from here.
  const mainEl = document.getElementById("main");
  const spaceEl = document.getElementById("space");
  const searchInputEl = document.getElementById("symbol-search");
  const searchStatusEl = document.getElementById("search-status");

  /** Read a color from graph.css so the drawing and the legend cannot drift. */
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Mix a colour toward white. Used for the rim: a body reads as lit when its
   * edge is brighter than its face, and a rim in the node's own hue keeps each
   * kind identifiable where a plain white rim would make them all look alike.
   * Falls back to the input unchanged if it is not a hex colour, so a themed
   * `--node-*` in some other notation degrades to "no rim" rather than to junk.
   */
  function lighten(color, amount) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return color;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `rgb(${r},${g},${b})`;
  }

  /** How far the rim is lifted toward white. */
  const RIM_LIGHTEN = 0.45;

  /**
   * Who is drawn over whom, in bands so the ordering cannot quietly drift.
   *
   * Bare numbers — emphasis at `20` and `30` against everything else's default
   * `0` — stop lifting anything the moment satellites carry a value of their
   * own: same numbers, different meaning, and nothing to notice. Writing the
   * bands down makes the relationship the thing that is stated.
   */
  const Z_SATELLITE_SPAN = 720;
  const Z_VERTEX = 1000;
  const Z_HOP1 = 2000;
  const Z_HOP0 = 3000;

  /** Prefix that tells a group node's id from a symbol's. A symbol id is a
   *  path, so it can never start with this. */
  const GROUP_PREFIX = "group::";

  /** Wide enough for the doubled rim to resolve as two lines, not one thick
   *  one; a group is marked by being visibly stacked. */
  const GROUP_BORDER_WIDTH = 4;

  function isGroupId(id) {
    return typeof id === "string" && id.slice(0, GROUP_PREFIX.length) === GROUP_PREFIX;
  }

  /** Separator inside a group id. A base id is a path and may contain spaces,
   *  but a Python class name cannot, so the first one is always the split. */
  const GROUP_KEY_SEP = " ";

  /**
   * Classes that share a name and a base class, gathered into groups.
   *
   * CPython draws `StreamReader` 123 times, once per codec module, and 121 of
   * them derive from the same `codecs.StreamReader`. That repetition is the
   * structure worth reading — but a shared name alone is not evidence of it,
   * as FastAPI's unrelated `Header` and `HTTPBearer` pairs show.
   *
   * One base in common is the test, not all of them. Each codec writes
   * `class StreamReader(Codec, codecs.StreamReader)` where `Codec` is its own
   * module's, so the 123 base *sets* are 113 distinct signatures: demanding
   * total agreement collapses 379 nodes and misses `StreamReader` entirely.
   *
   * Deliberately not a union-find over "shares any base". That relation is
   * transitive — A shares a base with B, B shares a different one with C, and
   * A and C end up drawn as one node having nothing in common. The two rules
   * happen to agree on CPython, which is exactly why the weaker one should not
   * be the one written down: it would hold until some project made it fail.
   * Instead each class joins the largest candidate it is still free for, ties
   * broken by the key, so the assignment is a pure function of the artifact
   * and the drawing is reproducible across reopens.
   *
   * @param {{ nodes: any[]; edges: { from: string; to: string; kind: string }[] }} graph
   * @returns {{ groupOf: Record<string, string>; groups: { id: string; name: string; members: string[] }[] }}
   */
  /**
   * Rank the candidates and let each symbol join the largest one it is still
   * free for.
   *
   * Shared by both passes on purpose. The ranking, the tie-break on the key,
   * the refusal of a candidate left with one member and the non-transitivity
   * that follows from taking members out as they are claimed are the same
   * rules for a class and for a function; written twice they would drift.
   *
   * @param {Map<string, string[]>} candidates key -> the ids that qualify
   * @param {Record<string, string>} nameOf
   * @param {Record<string, string>} groupOf filled in
   * @param {{ id: string; name: string; members: string[] }[]} groups appended to
   */
  function assignGroups(candidates, nameOf, groupOf, groups) {
    const ranked = [...candidates.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    for (const [key, ids] of ranked) {
      const free = ids.filter((id) => groupOf[id] === undefined);
      // A candidate left with one member is not a group: that symbol is drawn
      // as itself, with no count.
      if (free.length < 2) continue;
      const id = GROUP_PREFIX + key;
      for (const memberId of free) groupOf[memberId] = id;
      groups.push({ id, name: nameOf[free[0]], members: free });
    }
  }

  function groupSameNamedSiblings(graph) {
    /** @type {Record<string, string>} */
    const groupOf = {};
    /** @type {{ id: string; name: string; members: string[] }[]} */
    const groups = [];
    /** @type {Record<string, string>} */
    const nameOf = {};
    /** @type {Record<string, string>} */
    const kindOf = {};
    for (const n of graph.nodes) {
      nameOf[n.id] = n.name;
      kindOf[n.id] = n.kind;
    }

    // Classes first: a class's shared relationship is a base it inherits.
    /** @type {Record<string, string[]>} */
    const basesOf = {};
    for (const e of graph.edges) {
      if (e.kind !== "inherits") continue;
      (basesOf[e.from] = basesOf[e.from] || []).push(e.to);
    }

    /** Candidate group per (name, base). @type {Map<string, string[]>} */
    const classCandidates = new Map();
    for (const n of graph.nodes) {
      if (!isTypeKind(n.kind)) continue;
      const bases = basesOf[n.id];
      if (!bases || !bases.length) continue;
      for (const base of bases) {
        const key = n.name + GROUP_KEY_SEP + base;
        let list = classCandidates.get(key);
        if (!list) classCandidates.set(key, (list = []));
        // A class can declare the same base twice; it joins the candidate once.
        if (list.indexOf(n.id) === -1) list.push(n.id);
      }
    }
    assignGroups(classCandidates, nameOf, groupOf, groups);

    // Then functions, on the classes' result. A function has no base, but it
    // has edges, and one of them says the same thing: CPython's 121
    // `getregentry` all return a `CodecInfo`.
    //
    // Read through `groupOf`, so that functions pointing at the several
    // members of one class group count as pointing at one thing. Read before
    // the classes were folded, those 121 point at 121 different classes and
    // nothing groups at all — the ordering is the whole reason this works.
    //
    // Either direction. `inherits` is asymmetric and the class key uses the
    // base end deliberately; a function's edges carry no such asymmetry —
    // `getregentry` returns a `CodecInfo` and `main` calls `getopt`, and both
    // are "this function is about that node".
    /** @type {Map<string, string[]>} */
    const fnCandidates = new Map();
    for (const e of graph.edges) {
      for (const pair of [[e.from, e.to], [e.to, e.from]]) {
        const selfId = pair[0];
        const otherId = pair[1];
        if (kindOf[selfId] !== "function") continue;
        if (otherId === selfId) continue;
        const key = nameOf[selfId] + GROUP_KEY_SEP + (groupOf[otherId] || otherId);
        let list = fnCandidates.get(key);
        if (!list) fnCandidates.set(key, (list = []));
        if (list.indexOf(selfId) === -1) list.push(selfId);
      }
    }
    assignGroups(fnCandidates, nameOf, groupOf, groups);

    return { groupOf, groups };
  }

  /** The analyzer's own precedence when a pair earns more than one kind. */
  const EDGE_STRENGTH = { references: 1, uses: 2, inherits: 3 };

  /**
   * The artifact, plus one node per group and that group's merged edges.
   *
   * Both representations live in the same graph — the members and the node
   * that stands for them — because the element set is built once and shown or
   * hidden, never rebuilt. Only one side of each pair is ever visible, so
   * anything computed from the visible subset sees exactly one of them; see
   * `layoutGraph`, which is what the layout and the centre are read from.
   *
   * @param {{ nodes: any[]; edges: { from: string; to: string; kind: string }[] }} graph
   */
  function withGroups(graph) {
    const { groupOf, groups } = groupSameNamedSiblings(graph);
    if (!groups.length) return { graph, groupOf: {}, groupById: {} };

    /** @type {Record<string, { id: string; name: string; members: string[] }>} */
    const groupById = {};
    const nodes = graph.nodes.slice();
    /** @type {Record<string, string>} */
    const kindOf = {};
    for (const n of graph.nodes) kindOf[n.id] = n.kind;
    for (const group of groups) {
      groupById[group.id] = group;
      nodes.push({
        id: group.id,
        name: group.name,
        // The kind its members are. It decides three things at once: the
        // colour, whether the node is a tree vertex or a satellite, and
        // whether hiding functions hides it — so a group of functions that
        // claimed to be a class would sit in the class ring and survive the
        // toggle.
        kind: kindOf[group.members[0]] || "class",
        // Deliberately no location. A group is in as many files as it has
        // members, and every path that treats an id as a place in the source
        // — navigation, the comment lookup — must ask the members instead.
        file: "",
        line: 0,
        groupSize: group.members.length,
      });
    }

    /** @type {Map<string, { from: string; to: string; kind: string }>} */
    const merged = new Map();
    for (const e of graph.edges) {
      const from = groupOf[e.from] || e.from;
      const to = groupOf[e.to] || e.to;
      // Untouched by grouping: the original edge already says it.
      if (from === e.from && to === e.to) continue;
      // Both ends in one group. "This group relates to itself" is not a fact
      // about the drawing.
      if (from === to) continue;
      const key = from + "\n" + to;
      const prev = merged.get(key);
      if (!prev || EDGE_STRENGTH[e.kind] > EDGE_STRENGTH[prev.kind]) {
        merged.set(key, { from, to, kind: e.kind });
      }
    }

    return {
      graph: { nodes, edges: graph.edges.concat([...merged.values()]) },
      groupOf,
      groupById,
    };
  }

  /**
   * What the layout and the centre are computed from: the visible nodes and
   * the edges joining two of them.
   *
   * `fullGraph` holds a collapsed group and its members at once, so reading it
   * whole would count both. Filtering to what is on screen is what makes the
   * two representations never overlap — and it is also what the layout already
   * wanted, since a node reserving space it does not occupy is the defect this
   * mirrors one level up.
   *
   * @param {Set<string>} visibleIds
   */
  /**
   * The units in a graph: every node that `contains` others, and every node of
   * the same kind as one. A package with no members is a unit too, which its
   * edges alone would not say: hugo has eight, some with edges from their
   * `init` and `var` blocks. One node's kind is compared with another's; the
   * viewer still knows nothing about the word `package`.
   */
  const unitsCache = new WeakMap();
  function unitsOf(graph) {
    let units = unitsCache.get(graph);
    if (!units) {
      units = new Set();
      const kinds = new Set();
      const kindOf = {};
      const isMember = {};
      for (const n of graph.nodes) {
        kindOf[n.id] = n.kind;
        isMember[n.id] = !!n.member;
      }
      for (const e of graph.edges) {
        if (e.kind !== "contains") continue;
        // A type holding the members the reader opened it to see is not a unit
        // of the project. Taken as one, every type of its kind would become a
        // unit, and the drawing would be two trees with nothing between them.
        if (isMember[e.to]) continue;
        units.add(e.from);
        kinds.add(kindOf[e.from]);
      }
      if (kinds.size) for (const n of graph.nodes) if (kinds.has(n.kind)) units.add(n.id);
      unitsCache.set(graph, units);
    }
    return units;
  }

  /**
   * Whether an edge runs between the unit tree and everything else. In the
   * whole drawing such an edge is neither arranged by nor drawn: the units are
   * a tree of their own, and a click is what joins the two. Drawn on the same
   * rings, hugo's packages and types would collapse to four rings with 859
   * nodes on the second at 2.6px of arc each.
   */
  function crossesTrees(e, units) {
    return units.size > 0 && units.has(e.from) !== units.has(e.to);
  }

  function layoutGraph(visibleIds) {
    // The right button's view keeps them: pressed on a package, what it
    // contains is the structure being shown.
    const units = reachRoot ? null : unitsOf(fullGraph);
    return {
      nodes: fullGraph.nodes.filter((n) => visibleIds.has(n.id)),
      edges: fullGraph.edges.filter(
        (e) =>
          visibleIds.has(e.from) &&
          visibleIds.has(e.to) &&
          !(units && crossesTrees(e, units))
      ),
    };
  }

  /**
   * The path components a node is told apart by.
   *
   * For a class or a function that is the file it is defined in, minus the
   * extension. For a file node the name *is* the filename, so it is the
   * directory instead — otherwise `formats.py` would come out as
   * `ar/formats/formats.py`.
   *
   * A unit's node is its directory too. Which of a package's files carries its
   * declaration is an accident of which one sorts first, and guava's two source
   * roots pick different ones: the two nodes for
   * `com.google.common.util.concurrent` would be told apart by
   * `AbstractFutureFootprintBenchmark.java`, a component that says nothing
   * about either of them.
   */
  function disambiguationPath(node, isUnit) {
    const file = node.file || "";
    const base = file.replace(/\.pyi?$/, "");
    const parts = base.split(/[\\/]/).filter(Boolean);
    if (node.kind === "file" || (isUnit && isUnit(node))) parts.pop();
    return parts;
  }

  /**
   * The components where these paths part, in path order.
   *
   * Not the run from the parting to the end: guava mirrors its sources under
   * `android/`, so each of its classes exists twice under paths that differ at
   * their second component and agree the whole way down. Taking everything
   * after the difference would label 3,232 of that drawing's 3,313 nodes with a
   * path, the longest 166 characters. What tells them apart is the component
   * where they parted, and that is what is shown.
   *
   * Differences nearest the file come first, being the most specific, and only
   * as many are taken as it takes to tell every path apart.
   *
   * Returns one tail per input, or nulls where nothing separates them — two
   * nodes defined in the same file under the same name, which Python allows
   * only across kinds (`class Foo` then `def Foo`).
   */
  function distinguishingTails(paths) {
    const deepest = paths.reduce((a, p) => Math.max(a, p.length), 0);
    const at = (p, i) => p[p.length - 1 - i];
    /** Depths, counted from the file, at which the paths do not agree. */
    const differing = [];
    for (let i = 0; i < deepest; i++) {
      if (new Set(paths.map((p) => at(p, i))).size > 1) differing.push(i);
    }
    // The fewest of them that tell every path apart, not the first few: guava
    // holds `ForwardingBlockingDeque` in two packages and each of those twice,
    // and depths that separate one pair say nothing about the other. Taking
    // them in order drags every depth between the two into the label — seven
    // components. Chosen greedily, a depth at a time, preferring the one that
    // separates the most and then the one nearest the file.
    const chosen = [];
    const written = (p, picked) => picked.map((i) => at(p, i) || "").join("/");
    for (let round = 0; round < differing.length; round++) {
      const tails = paths.map((p) => written(p, chosen.slice().sort((a, b) => b - a)));
      if (chosen.length && new Set(tails).size === paths.length) break;
      let best = null;
      let bestCount = new Set(tails).size;
      for (const i of differing) {
        if (chosen.includes(i)) continue;
        const with_i = chosen.concat(i).sort((a, b) => b - a);
        const count = new Set(paths.map((p) => written(p, with_i))).size;
        if (count > bestCount) {
          bestCount = count;
          best = i;
        }
      }
      if (best === null) break;
      chosen.push(best);
    }
    const picked = chosen.sort((a, b) => b - a);
    const tails = paths.map((p) => written(p, picked));
    if (picked.length && new Set(tails).size === paths.length) return tails;
    return paths.map(() => null);
  }

  /**
   * The shortest trailing run of a name's own segments that no other drawn node
   * can be written as.
   *
   * A name written in segments — a type declared inside a type, `Maps.KeySet` —
   * identifies the node by its whole chain, and Java writes chains three deep:
   * `WorkerThreadPoolHierarchicalTestExecutorService.WorkQueue.Entry`. On screen
   * it is the last segment or two that is read. Shown at its shortest unique
   * length, junit5's labels over 40 characters fall from 215 to 73, jenkins's
   * from 143 to 33 and jackson's from 76 to 11.
   */
  function shortNames(drawn) {
    // A file node's name is a file name, and the dot in `command_notwin.go`
    // separates it from its extension rather than a type from the type it is
    // declared in. Shortened, cobra's file node would be labelled `go`.
    const segmentsOf = (n) => (n.kind === "file" ? [String(n.name)] : String(n.name).split("."));
    // How many *names* could be written this way, not how many nodes: two
    // nodes of one name are the same symbol seen twice — guava declares every
    // class again under `android/` — and a path tells those apart. Counting
    // nodes, each twin would claim its own short form and no name in that
    // drawing could shorten at all.
    const claims = new Map();
    for (const n of drawn) {
      const segs = segmentsOf(n);
      for (let k = 1; k <= segs.length; k++) {
        const written = segs.slice(-k).join(".");
        if (!claims.has(written)) claims.set(written, new Set());
        claims.get(written).add(String(n.name));
      }
    }
    /** @type {Record<string, string>} */
    const short = {};
    for (const n of drawn) {
      const segs = segmentsOf(n);
      short[n.id] = n.name;
      for (let k = 1; k <= segs.length; k++) {
        const written = segs.slice(-k).join(".");
        if (claims.get(written).size === 1) {
          short[n.id] = written;
          break;
        }
      }
    }
    return short;
  }

  /**
   * A label for every drawn node, unique among them.
   *
   * Stated as "no two labels are the same" rather than "repeated names get a
   * path", which is what makes the group case fall out instead of being a
   * special case: a group's label already carries its count, so it only
   * reaches for anything more where the count is not enough.
   *
   * And it has to reach for something other than a path. Two groups can share
   * a name — Django has two `Deserializer` groups and two `Serializer`, CPython
   * two `IncrementalDecoder` — and in every one of those the members sit in a
   * single directory shared with the other group, so no path suffix separates
   * them. What differs is the base class that defined the group, written in
   * front of the name in the same grammar the path uses.
   *
   * @param {any[]} drawn nodes currently on screen
   * @param {(id: string) => string} nameOf a node id's plain name
   */
  function labelsForDrawn(drawn, nameOf, isUnit) {
    /** @type {Record<string, string>} */
    const label = {};
    /** @type {Map<string, any[]>} */
    const sharing = new Map();
    const short = shortNames(drawn);
    for (const n of drawn) {
      const own = short[n.id] || n.name;
      const plain = n.groupSize ? `${own} ×${n.groupSize}` : own;
      label[n.id] = plain;
      if (!sharing.has(plain)) sharing.set(plain, []);
      sharing.get(plain).push(n);
    }

    for (const [plain, group] of sharing) {
      if (group.length < 2) continue;
      const groups = group.filter((n) => n.groupSize);
      const plainNodes = group.filter((n) => !n.groupSize);
      for (const n of groups) {
        const baseId = n.id.slice(GROUP_PREFIX.length + n.name.length + 1);
        const baseName = nameOf(baseId);
        if (baseName) label[n.id] = `${baseName}/${plain}`;
      }
      if (plainNodes.length > 1) {
        const tails = distinguishingTails(plainNodes.map((n) => disambiguationPath(n, isUnit)));
        plainNodes.forEach((n, i) => {
          if (tails[i]) label[n.id] = `${tails[i]}/${short[n.id] || n.name}`;
        });
      }
    }
    return label;
  }

  /**
   * @param {{ nodes: any[]; edges: any[] }} graph
   * @param {Set<string>} [only] Ids that may be built. An edge needs both ends.
   */
  function buildElements(graph, only) {
    const nodes = graph.nodes
      .filter((n) => !only || only.has(n.id))
      .map((n) => ({
      // A group is marked in the drawing rather than only in its label: the
      // count says how many, the ring says that this node is not one thing.
      classes: n.groupSize ? "grouped" : undefined,
      data: {
        id: n.id,
        // `×121` is how many classes this node stands for. It is deliberately
        // not the node's degree, which is a different number about the same
        // node; the member list is where the count is explained.
        label: n.groupSize ? `${n.name} ×${n.groupSize}` : n.name,
        groupSize: n.groupSize || 0,
        kind: n.kind,
        file: n.file,
        line: n.line,
        // What belongs to this node without being one: a Go method, which is
        // its receiver's. Nothing else in the document names one.
        members: n.members || [],
        // Drawn because its type was opened, not because it is a function of
        // the project.
        member: !!n.member,
        // Present from the start, even though only the layout knows its real
        // value. The style maps `z-index` to this field, and a mapping with
        // no field to read does not wait for one to appear: cytoscape falls
        // back to the property default and warns on the console. That is how a
        // correct order can be computed, applied to nothing, and still pass every
        // test.
        z: 0,
      },
    }));
    // The index is the artifact's, not the filtered list's: an edge built later
    // has to arrive with the same id it would have had at open, or the second
    // build is a different drawing wearing the same positions.
    const edges = [];
    // Not built in the whole drawing, where they are never shown; the right
    // button's view builds the ones among its set when it opens.
    const units = unitsOf(graph);
    graph.edges.forEach((e, i) => {
      if (only && !(only.has(e.from) && only.has(e.to))) return;
      if (!reachRoot && crossesTrees(e, units)) return;
      // Drawn from the member that accounts for it, while its type is open.
      if (e.byMember) return;
      // A type joined to a member beyond the first level of its tree.
      if (e.quiet) return;
      edges.push({
        data: {
          id: `e${i}-${e.from}-${e.to}-${e.kind}`,
          source: e.from,
          target: e.to,
          kind: e.kind,
        },
      });
    });
    return [...nodes, ...edges];
  }

  function undirectedAdj(graph) {
    /** @type {Record<string, string[]>} */
    const adj = {};
    for (const n of graph.nodes) {
      adj[n.id] = [];
    }
    for (const e of graph.edges) {
      if (!adj[e.from]) adj[e.from] = [];
      if (!adj[e.to]) adj[e.to] = [];
      adj[e.from].push(e.to);
      adj[e.to].push(e.from);
    }
    return adj;
  }

  /**
   * Per-node edge buckets, built once per graph.
   *
   * Parent selection, helper-class detection and satellite attachment each
   * need a node's edges. Scanning all of `graph.edges` for every node they
   * consider is O(V·E); on a 2000-class / 8000-edge graph that alone costs
   * 1.2s, which rules out recomputing the layout when node visibility changes.
   * Reading one bucket instead makes the pass O(V+E).
   *
   * Buckets are appended in `graph.edges` order, so every consumer sees the
   * edges in the same relative order as the array itself. Positions must not
   * move because of this index.
   *
   * @param {{ nodes: any[]; edges: { from: string; to: string; kind: string }[] }} graph
   */
  function buildEdgeIndex(graph) {
    /** @type {Record<string, { id: string; kind: string }[]>} incoming[x] = edges pointing at x */
    const incoming = {};
    /** @type {Record<string, { id: string; kind: string }[]>} outgoing[x] = edges leaving x */
    const outgoing = {};
    /** @type {Record<string, string[]>} every neighbour, both directions, duplicates kept */
    const incident = {};
    for (const e of graph.edges) {
      (outgoing[e.from] = outgoing[e.from] || []).push({ id: e.to, kind: e.kind });
      (incoming[e.to] = incoming[e.to] || []).push({ id: e.from, kind: e.kind });
      (incident[e.from] = incident[e.from] || []).push(e.to);
      (incident[e.to] = incident[e.to] || []).push(e.from);
    }
    return { incoming, outgoing, incident };
  }

  /**
   * The layout treats `graph` as immutable, so the index is memoised on the
   * graph object itself. This keeps every call site's signature unchanged —
   * including the ones the headless tests call directly.
   */
  const edgeIndexCache = new WeakMap();
  function edgeIndex(graph) {
    let idx = edgeIndexCache.get(graph);
    if (!idx) {
      idx = buildEdgeIndex(graph);
      edgeIndexCache.set(graph, idx);
    }
    return idx;
  }

  const NO_EDGES = [];

  /**
   * How many steps out the right button's view goes: what a node points to,
   * and what those point to. The reader's definition; a third step is this
   * number.
   */
  const REACH_STEPS = 2;

  /**
   * A node, what it points to, and what those point to — `REACH_STEPS` out
   * along edges in their own direction, of every kind. What the right button
   * shows.
   *
   * The reader's definition, chosen over two other readings. Everything
   * reachable runs to 149 nodes for Angular's FieldTree, whose own definition
   * names five types; ancestors alone show a node by itself on seven in ten of
   * Angular's types. Two steps is FieldTree's
   * five and what they name. Nothing that points in is followed, and nothing is
   * left out on any other ground: a node the pressed one points to is in, even
   * where it also points back.
   *
   * Breadth first, a step at a time, so a node is counted at its nearest
   * distance — one reached in one step along one path and three along another
   * is one step out. Read off the artifact graph rather than off what is drawn,
   * so a hidden function is a step like any other and the set does not change
   * when the reader toggles functions.
   *
   * @param {{ edges: { from: string; to: string }[] }} graph
   * @param {string[]} starts  more than one for a group, whose set is its members'
   * @returns {Set<string>} with the starts included
   */
  function outwardFrom(graph, starts) {
    const { outgoing } = edgeIndex(graph);
    const seen = new Set();
    let frontier = [];
    for (const s of starts) {
      if (seen.has(s)) continue;
      seen.add(s);
      frontier.push(s);
    }
    for (let step = 0; step < REACH_STEPS && frontier.length; step++) {
      const next = [];
      for (const from of frontier) {
        for (const { id } of outgoing[from] || NO_EDGES) {
          if (seen.has(id)) continue;
          seen.add(id);
          next.push(id);
        }
      }
      frontier = next;
    }
    return seen;
  }

  /** No seats are pending when a helper is placed: they are seated one at a
   *  time, not as a set that may be redone at a wider radius. */
  const NO_TENTATIVE = [];

  /**
   * The two kinds that orbit rather than anchor. Everything else is a type.
   *
   * The other way round — a tree vertex being `kind === "class"` and nothing
   * else — holds only for Python. Measured on three TypeScript projects,
   * between 52% and 60% of
   * top-level declarations are type-shaped and not classes: zod declares 52
   * classes among 1,816 symbols, so a class-rooted tree would have arranged
   * that drawing around 3% of it and hung the rest in orbit.
   *
   * Inverting it rather than lengthening it is the point. A longer list —
   * class, interface, struct, trait, protocol, record — is the same closed set
   * with more entries, and every new language would have to edit the viewer
   * before it could be drawn. Two names the artifact contract closes leaves
   * the other direction open: a Go `struct` arrives and is arranged correctly
   * by a viewer that has never heard of Go.
   */
  const ORBITING_KINDS = new Set(["function", "file"]);

  /** @param {string | undefined} kind */
  function isTypeKind(kind) {
    return !ORBITING_KINDS.has(kind);
  }

  /**
   * Is there anything here the tree can be rooted on?
   *
   * A project of nothing but functions — a script, a data pipeline — would
   * leave the tree with nothing to root, and the viewer would draw nothing at
   * all. In that case, and only that case, every node becomes a tree vertex.
   *
   * Deliberately keyed on the whole graph rather than the current subset, so a
   * graph that has even one type keeps the type-rooted tree.
   */
  const hasTypesCache = new WeakMap();
  function graphHasTypes(graph) {
    let has = hasTypesCache.get(graph);
    if (has === undefined) {
      has = graph.nodes.some((n) => isTypeKind(n.kind));
      hasTypesCache.set(graph, has);
    }
    return has;
  }

  /** Hide every `data-kind` row in the legend and the panel that this graph has no node of. */
  function showKindRowsFor(graph) {
    // The legend and the panel: the two places a mark is named or set.
    for (const host of [legendEl, settingsEl]) {
      if (!host || !host.querySelectorAll) continue;
      syncKindRows(host.querySelectorAll("[data-kind], [data-mark]"), graph, groupsById);
    }
  }

  /** Every node kind this graph actually contains. */
  function kindsInGraph(graph) {
    const kinds = new Set();
    if (graph && graph.nodes) for (const n of graph.nodes) kinds.add(n.kind);
    return kinds;
  }

  /**
   * Show a row only where the drawing has the mark it names.
   *
   * A row names either a node kind (`data-kind`) or one of the marks that are
   * not a kind (`data-mark`). Both are asked the same question: can this
   * artifact produce it? Not "is it on screen right now" — functions are
   * hidden until the reader asks for them, and a legend that followed the
   * screen would flicker as they toggle.
   *
   * The rows stay in the markup — the legend's own test derives the list of
   * marks from the stylesheet, and a row generated at runtime is a mark it
   * could not check. What follows the graph is which of them a reader sees.
   */
  function syncKindRows(rows, graph, groups) {
    const present = kindsInGraph(graph);
    // An edge row's mark is `edge:<kind>`, so an edge kind the artifact never
    // draws is not named either: `contains` on every Python drawing, and
    // `references` on a project whose annotations name nothing.
    if (graph && graph.edges) for (const e of graph.edges) present.add("edge:" + e.kind);
    // The doubled rim marks several symbols drawn as one. tinydb folds nothing
    // and no click will make it, so the row is a key to a mark that is not
    // there.
    if (groups && Object.keys(groups).length) present.add("folded");
    for (const row of rows || []) {
      if (!row || !row.dataset || !row.classList) continue;
      const mark = row.dataset.kind || row.dataset.mark;
      // The `hidden` class, not the `hidden` property. `#legend li` and
      // `#settings-body .row` both set `display: flex`, which outranks the
      // browser's own `[hidden] { display: none }` — so the attribute alone would
      // leave every row on screen. `.hidden` carries `!important` and is
      // how the other twenty things in this file hide.
      row.classList.toggle("hidden", !present.has(mark));
    }
  }

  /** A node is a satellite candidate exactly when it is not a tree vertex. */
  function isTreeVertexSatelliteCandidate(graph, node) {
    return !!node && !isTreeVertex(graph, node);
  }

  /** @param {{ kind: string } | undefined} node */
  /**
   * Is this node a vertex of the tree, rather than something that orbits one?
   *
   * A type always. Anything else only where there is no type to root on —
   * which the whole graph already answers with `graphHasTypes`, and which a
   * single component answers with `alsoVertex`. `ctypes/macholib/dyld.py` is
   * thirteen functions calling each other inside a project full of classes:
   * globally there are types, in that component there are none, and it is
   * the component that decides what its own tree is rooted on.
   *
   * @param {Set<string>} [alsoVertex] ids that are vertices whatever their kind
   */
  function isTreeVertex(graph, node, alsoVertex) {
    if (!node) return false;
    if (isTypeKind(node.kind)) return true;
    if (alsoVertex && alsoVertex.has(node.id)) return true;
    return !graphHasTypes(graph);
  }

  /**
   * Rank center candidates among `ids` and return the best, or null.
   *
   * The score is nearness, weighted by size, over the classes a codebase
   * presents as its own.
   *
   * Out-reach alone — how much of the graph a node can walk to along directed
   * edges — finds the end of the deepest dependency chain rather than the
   * middle of anything. Measured on six projects whose subject nobody would
   * argue about, it names two: Flask's centre comes out as its CLI command
   * group, Pydantic's as a private helper, Scrapy's as an HTTP download
   * handler, Django's as an admin class. It also roots the drawing at a leaf —
   * Pydantic comes out as twelve children with 97% of everything behind one of
   * them.
   *
   * Nearness, because a centre should be near the thing it is the centre of,
   * and because the tree the layout builds is an undirected walk, so nearness
   * is what the drawing already expresses. Size as a logarithm, so that it
   * settles a tie between two comparably central classes without deciding
   * against a much more central one: taken raw it puts Pydantic's 2,267-line
   * `GenerateSchema` over its `BaseModel` and drops Scrapy's answer from 8th
   * to 25th.
   *
   * Private names and exceptions are out. Both are one line and both are
   * load-bearing: without them the answers are `_Pipeline`, and a class that
   * loses to `ImproperlyConfigured` because everything raises it and is
   * therefore near it.
   *
   * Weighting by subclasses is rejected. It moves Scrapy's answer
   * from 8th to 1st and breaks Flask, FastAPI, Pydantic and Requests — a term
   * that helps only the project it was added for, which is the shape of
   * fitting a formula to its examples.
   *
   * Ties break on fewest incoming, then most outgoing, then id for determinism.
   */
  /**
   * A name a codebase marks as not for reaching — the fallback, for an artifact
   * that says nothing.
   *
   * An underscore is Python's mark. It is read here only where no node in the
   * artifact carries the analyzer's own answer, because no convention travels:
   * 40% of hugo's types are unexported and carry no underscore, while 85% of
   * Django's functions and 95% of Angular's begin with a lower-case letter and
   * are not internal at all.
   */
  function isPrivateName(name) {
    return typeof name === "string" && name.charAt(0) === "_";
  }

  /** Whether this drawing's artifact answers the question itself. */
  function marksInternal(graph) {
    return graph.nodes.some((n) => n.internal);
  }

  /** A name that says the thing is raised rather than used. */
  const EXCEPTION_NAME = /(Error|Exception|Warning)$/;

  /**
   * How much of a class there is: its lines, and one for each member recorded
   * outside them.
   *
   * `endLine` is what the analyzer records; a node without one counts as a
   * single line, which is what a class that could not be measured should be
   * worth here.
   *
   * Go and Rust write a type's methods apart from its declaration, so its lines
   * are not the type: sqlparser-ranger's `Parser` is 6 lines with 69 methods in
   * `impl` blocks, and by lines alone the drawing would be centred on the 205
   * lines of `TokenKind`. A member inside the declaration — a Rust trait's methods —
   * is already in the lines and is not counted again.
   */
  function classSize(node) {
    const end = node && node.endLine;
    const start = node && node.line;
    const lines = !end || !start || end < start ? 1 : end - start + 1;
    let outside = 0;
    for (const m of (node && node.members) || NO_EDGES) {
      const inside = m.file === node.file && start && m.line >= start && m.line <= (end || start);
      if (!inside) outside++;
    }
    return lines + outside;
  }

  /**
   * The units among `candidates` that no candidate contains and that contain
   * at least one candidate — empty unless every candidate is a unit.
   */
  function containmentRoots(candidates, graph) {
    const found = new Set();
    const units = unitsOf(graph);
    if (!units.size || !candidates.every((c) => units.has(c.id))) return found;
    const ids = new Set(candidates.map((c) => c.id));
    const contained = new Set();
    for (const e of graph.edges) {
      if (e.kind !== "contains" || !ids.has(e.from) || !ids.has(e.to)) continue;
      found.add(e.from);
      contained.add(e.to);
    }
    for (const id of contained) found.delete(id);
    return found;
  }

  function pickCenterAmong(ids, graph, alsoVertex) {
    const ranked = rankCentresAmong(ids, graph, alsoVertex);
    return ranked.length ? ranked[0] : null;
  }

  /** Every candidate, best first. Exported so the benchmark can say "3rd". */
  function rankCentres(graph) {
    return rankCentresAmong(graph.nodes.map((n) => n.id), graph);
  }

  function rankCentresAmong(ids, graph, alsoVertex) {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    const classes = graph.nodes.filter(
      (n) => isTreeVertex(graph, n, alsoVertex) && idSet.has(n.id)
    );
    // Only a graph with no nodes at all has no center. A graph with no classes
    // ranks its functions and files by the same criterion.
    if (classes.length === 0) return null;

    /** @type {Set<string>} */
    const classIds = new Set(classes.map((c) => c.id));
    /** @type {Set<string>} */
    const hasParentInGraph = new Set();
    for (const e of graph.edges) {
      if (e.kind !== "inherits") continue;
      if (classIds.has(e.from) && classIds.has(e.to)) hasParentInGraph.add(e.from);
    }

    const roots = classes.slice();

    /** @type {Record<string, number>} */
    const outDeg = {};
    /** @type {Record<string, number>} */
    const inDeg = {};
    for (const c of classes) {
      outDeg[c.id] = 0;
      inDeg[c.id] = 0;
    }
    /** @type {Record<string, string[]>} */
    const outAdj = {};
    for (const e of graph.edges) {
      (outAdj[e.from] = outAdj[e.from] || []).push(e.to);
      if (outDeg[e.from] !== undefined) outDeg[e.from] += 1;
      if (inDeg[e.to] !== undefined) inDeg[e.to] += 1;
    }

    // Nearness is measured over every node, not only the candidates: a class
    // reaches another through the functions between them, and the drawing's
    // own groups are components of the whole graph.
    /** @type {Record<string, string[]>} */
    const und = {};
    for (const n of graph.nodes) und[n.id] = [];
    for (const e of graph.edges) {
      if (e.from === e.to || !und[e.from] || !und[e.to]) continue;
      und[e.from].push(e.to);
      und[e.to].push(e.from);
    }

    /**
     * How the field is narrowed before it is measured.
     *
     * Nearness is defined for every class and only the nearest is wanted, and
     * computing the definition for all of them to find one costs 3,179ms on
     * CPython, spent on 1,909 answers nobody reads.
     *
     * So: distances from a few sources give every candidate a position
     * relative to those sources, and a node near all of them is near the
     * graph. That orders the field well enough to say which few could win, and
     * those few are then measured by the definition itself, so the winner's
     * score and the comparison among the leaders are both exact.
     *
     * Sixteen and sixty are measured rather than derived — comfortably past
     * where the answer stops moving, both being cheap. On all eight sample
     * projects the centre is the same node the full computation finds, and
     * CPython's is found 28 times faster.
     */
    const PIVOTS = 16;
    const LEADERS = 60;

    /**
     * The pivots are the highest-degree candidates, not a random sample.
     *
     * A seed would make a project open on different nodes on different days.
     * The busiest nodes are also where a random walk spends its time, so
     * ranking costs nothing in quality and makes the answer a property of the
     * graph.
     */
    function pivotsAmong(ids) {
      return ids
        .slice()
        .sort((a, b) => {
          const d = (und[b] || NO_EDGES).length - (und[a] || NO_EDGES).length;
          return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
        })
        .slice(0, PIVOTS);
    }

    /** Distance to everything from one source. */
    function distancesFrom(source) {
      /** @type {Record<string, number>} */
      const dist = { [source]: 0 };
      let frontier = [source];
      let depth = 0;
      while (frontier.length) {
        depth++;
        const next = [];
        for (const u of frontier) {
          for (const v of und[u] || NO_EDGES) {
            if (dist[v] === undefined) {
              dist[v] = depth;
              next.push(v);
            }
          }
        }
        frontier = next;
      }
      return dist;
    }

    /** Reached, over their mean distance — high for a node in the middle. */
    function closeness(id) {
      const seen = new Set([id]);
      let frontier = [id];
      let depth = 0;
      let sum = 0;
      while (frontier.length) {
        depth++;
        const next = [];
        for (const u of frontier) {
          for (const v of und[u] || NO_EDGES) {
            if (seen.has(v)) continue;
            seen.add(v);
            sum += depth;
            next.push(v);
          }
        }
        frontier = next;
      }
      const reached = seen.size - 1;
      return reached ? (reached * reached) / sum : 0;
    }

    /** @type {Record<string, {name: string, endLine?: number, line?: number}>} */
    const nodeById = {};
    for (const n of graph.nodes) nodeById[n.id] = n;

    // Which classes inherit from something named like an exception, answered
    // once. Asking it per candidate would mean scanning the whole edge list per
    // candidate — CPython's 2,363 classes against 11,000 edges is twenty-six
    // million steps, 361ms, to answer a question that is a single pass.
    /** @type {Set<string>} */
    const inheritsAnException = new Set();
    for (const e of graph.edges) {
      if (e.kind !== "inherits") continue;
      const base = nodeById[e.to];
      if (base && EXCEPTION_NAME.test(base.name || "")) inheritsAnException.add(e.from);
    }

    /** Raised rather than used — by its own name, or by what it inherits. */
    const isException = (id) => {
      const n = nodeById[id];
      if (n && EXCEPTION_NAME.test(n.name || "")) return true;
      return inheritsAnException.has(id);
    };

    /** The size term is exact for everyone; only nearness is estimated. */
    const sizeTerm = {};
    /** @type {string[]} */
    const eligible = [];
    /** @type {Record<string, number>} */
    const score = {};
    // What the codebase presents as its plumbing is the artifact's answer where
    // it gives one, and the name only where it does not.
    const marked = marksInternal(graph);
    for (const c of classes) {
      const n = nodeById[c.id];
      const plumbing = marked ? !!(n && n.internal) : isPrivateName(n && n.name);
      if (plumbing || isException(c.id)) {
        score[c.id] = -1;
        continue;
      }
      score[c.id] = 0;
      sizeTerm[c.id] = Math.log(1 + classSize(n));
      eligible.push(c.id);
    }

    const tables = pivotsAmong(eligible).map(distancesFrom);
    /** Nearness to the pivots, standing in for nearness to everything. */
    for (const id of eligible) {
      let sum = 0;
      let reached = 0;
      for (const table of tables) {
        const d = table[id];
        if (d !== undefined && d > 0) {
          sum += d;
          reached++;
        }
      }
      score[id] = (reached ? (reached * reached) / sum : 0) * sizeTerm[id];
    }

    // The leaders, measured by the definition. Everything below them keeps its
    // estimate, which is enough to order a field nobody reads past the top.
    const leaders = eligible
      .slice()
      .sort((a, b) => score[b] - score[a] || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, LEADERS);
    for (const id of leaders) score[id] = closeness(id) * sizeTerm[id];

    // A group of units is centred on what contains it. Every unit is one size,
    // and a module many others sit beside is nearer to them than the crate
    // holding them all: otherwise sqlparser-ranger's unit group would be centred
    // on `mod parser`. Only where every candidate is a unit — over a whole graph, types
    // included, this would put a crate at the centre of every Rust drawing.
    const containing = containmentRoots(classes, graph);
    roots.sort((a, b) => {
      const cd = (containing.has(b.id) ? 1 : 0) - (containing.has(a.id) ? 1 : 0);
      if (cd !== 0) return cd;
      const sd = score[b.id] - score[a.id];
      if (sd > 1e-9 || sd < -1e-9) return sd;
      const sub =
        (hasParentInGraph.has(a.id) ? 1 : 0) - (hasParentInGraph.has(b.id) ? 1 : 0);
      if (sub !== 0) return sub;
      const idd = (inDeg[a.id] || 0) - (inDeg[b.id] || 0);
      if (idd !== 0) return idd;
      const od = (outDeg[b.id] || 0) - (outDeg[a.id] || 0);
      if (od !== 0) return od;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return roots.map((r) => r.id);
  }

  /** Center of the whole graph. @returns {string | null} */
  function pickTopClass(graph) {
    return pickCenterAmong(
      graph.nodes.map((n) => n.id),
      graph
    );
  }

  /**
   * Order class ids on one ring: inherit-connected components first, then id.
   * @param {string[]} classIds
   * @param {{ edges: { from: string; to: string; kind: string }[] }} graph
   */
  function orderRingClasses(classIds, graph) {
    const set = new Set(classIds);
    /** @type {Record<string, string[]>} */
    const inheritAdj = {};
    for (const id of classIds) inheritAdj[id] = [];
    // Called once per parent during the tree walk, so scanning every edge here
    // would be O(V·E) on its own. Insertion order is irrelevant — everything below
    // is sorted before it is used.
    const idx = edgeIndex(graph);
    for (const id of classIds) {
      for (const e of idx.outgoing[id] || NO_EDGES) {
        if (e.kind === "inherits" && set.has(e.id)) inheritAdj[id].push(e.id);
      }
      for (const e of idx.incoming[id] || NO_EDGES) {
        if (e.kind === "inherits" && set.has(e.id)) inheritAdj[id].push(e.id);
      }
    }
    const visited = new Set();
    /** @type {string[][]} */
    const components = [];
    for (const start of [...classIds].sort()) {
      if (visited.has(start)) continue;
      /** @type {string[]} */
      const comp = [];
      /** @type {string[]} */
      const q = [start];
      visited.add(start);
      while (q.length) {
        const id = q.shift();
        comp.push(id);
        for (const nb of (inheritAdj[id] || []).slice().sort()) {
          if (!visited.has(nb)) {
            visited.add(nb);
            q.push(nb);
          }
        }
      }
      components.push(comp.sort());
    }
    return components.flat();
  }

  /**
   * Fixed layout: root class at center; each deeper class ring is centered on
   * its previous-layer class parent; satellites on an outward fan (90°/120°);
   * other components offset; degree-0 leftovers in a 10-col grid.
   *
   * Which tree a class is in counts a hop through a function; how deep it sits
   * does not. Those are two questions, and one BFS cannot answer both. The
   * class-to-class reading is right for depth, so a shared helper cannot
   * shorten the path between two classes. Taken for membership as well, it
   * would exile 70 of FastAPI's 108 classes to a tree of their own, joined to
   * the drawing by 45 function bridges drawn as edges up to 2,888px long. With
   * functions hidden, which is the default, they would read as related to
   * nothing at all.
   *
   * The depth reading lives in `layoutOneClassComponent`.
   */
  /**
   * @param opts.rootSector The angle the root's children may use, `{ start, width }`
   *   in radians. The whole circle when absent; the right button's fan passes
   *   120° of it, pointing up. With `widenTo`, it opens further about its
   *   centre where a level would crowd it, as far as that level needs and no
   *   further than `widenTo`; the opening used comes back as `rootWidth`.
   * @param opts.bandOverflow When a sector cannot seat its children side by
   *   side, whether the childless ones are seated in rows outside the ring.
   *   Omitted means the ring, which is what the viewer opens on: a caller that
   *   wants rows asks for them. Neither is better and no measurement settles
   *   it, so it is the reader's choice and it arrives here rather than being
   *   read from module state — the property that one graph lays out two ways
   *   is not testable if it is a `let`.
   */
  function computeClassRingPositions(graph, center, visibleIds, opts) {
    const bandOverflow = !!(opts && opts.bandOverflow);
    const rootSector = (opts && opts.rootSector) || undefined;
    // Without an open type's members: they are placed as a tree of their own,
    // and what they are joined to is nothing the project's tree should be
    // rebuilt around.
    const fullAdj = undirectedAdj(withoutMembers(graph));

    /** @type {Record<string, { id: string; kind: string; file: string; name: string }>} */
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;

    // Linked means linked *to something on screen*. Counting hidden edges would
    // leave classes whose only neighbour is a hidden function floating in the
    // middle of the drawing with nothing joined to them; they belong in the grid with
    // the other unconnected nodes.
    /** @type {Set<string>} */
    const linked = new Set();
    for (const e of graph.edges) {
      if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) continue;
      linked.add(e.from);
      linked.add(e.to);
    }

    /** @type {Set<string>} */
    const linkedVisible = new Set();
    /** @type {string[]} */
    const unlinkedIds = [];
    for (const id of visibleIds) {
      if (linked.has(id) || id === center) linkedVisible.add(id);
      else unlinkedIds.push(id);
    }

    /** @type {Record<string, { x: number; y: number }>} */
    const positions = {};
    /** @type {Record<string, number>} */
    const outwardAngles = {};
    /** @type {Set<string>} */
    const componentRoots = new Set();
    /** Which group each node belongs to, keyed by that group's centre. */
    /** @type {Record<string, string>} */
    const groupOf = {};

    const allClassIds = new Set(
      [...linkedVisible].filter((id) => isTreeVertex(graph, byId[id]))
    );
    // Over the full graph, so a function counts as a way through. A class the
    // full walk cannot reach either is genuinely apart and still gets a tree of
    // its own: TinyDB's `Query` is unreachable from `TinyDB` through functions
    // as well, and stays where it is.
    const primaryReach = bfsParents(fullAdj, center).dist;
    const primaryClasses = [...allClassIds].filter(
      (id) => id === center || primaryReach[id] !== undefined
    );

    // Classes first (no satellites yet) so Query-side fns wait for Query.
    // Which radii the tree placed levels at, per component root. Filled in by
    // the placement itself and handed to the renderer unchanged.
    /** @type {Map<string, Set<number>>} */
    const ringRadii = new Map();
    /** Which node the tree hung each node off. @type {Record<string, string>} */
    const treeParent = {};

    const rootWidth = layoutOneClassComponent(
      graph,
      byId,
      fullAdj,
      primaryClasses,
      center,
      0,
      0,
      positions,
      false,
      outwardAngles,
      componentRoots,
      ringRadii,
      undefined,
      treeParent,
      bandOverflow,
      // The primary component only. Everything else is placed beside it by
      // the packer and keeps the whole circle it always had.
      rootSector
    );

    for (const id of primaryClasses) if (positions[id]) groupOf[id] = center;

    /** @type {{ ids: string[]; weight: number; primary: boolean }[]} */
    const blocks = [
      {
        ids: primaryClasses.filter((id) => positions[id]),
        weight: primaryClasses.filter((id) => positions[id]).length,
        primary: true,
        root: center,
      },
    ];

    const unplacedLinked = [...linkedVisible].filter((id) => !positions[id]);
    placeSecondaryClassComponents(
      unplacedLinked,
      graph,
      byId,
      fullAdj,
      positions,
      outwardAngles,
      componentRoots,
      blocks,
      groupOf,
      ringRadii,
      treeParent,
      bandOverflow
    );

    // The group holding the graph's own centre reads first, then the rest by
    // size. The centre is the node the view opens on and the one marked red, so
    // starting anywhere else means the eye lands on the drawing's second
    // subject. On the FastAPI fixture the two do not coincide: the centre sits
    // in a 31-class group while the biggest is OpenAPI's 68.
    // A tree rooted on something that is not a class reads after every tree
    // that is. Those are the components with no class to root on — a module of
    // functions calling each other — and they are a different kind of thing
    // from a class tree, not merely a smaller one. Keeping them together at
    // the end means the drawing runs class trees first and then the rest,
    // rather than interleaving them by size.
    const classRooted = (b) => (b.root ? isTreeVertex(graph, byId[b.root]) : true);
    blocks.sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      const ac = classRooted(a);
      const bc = classRooted(b);
      if (ac !== bc) return ac ? -1 : 1;
      if (b.weight !== a.weight) return b.weight - a.weight;
      const am = a.ids.slice().sort()[0] || "";
      const bm = b.ids.slice().sort()[0] || "";
      return am < bm ? -1 : am > bm ? 1 : 0;
    });

    // The isolated grid is placed last but its size is known now, so measure it
    // on a throwaway map and let the packer size its rows for the whole
    // drawing. Without this the grid would always wrap onto a row of its own and
    // the FastAPI graph would come out taller than it is wide.
    /** @type {Record<string, { x: number; y: number }>} */
    const gridProbe = {};
    placeUnlinkedCluster(unlinkedIds, byId, gridProbe);
    const probeIds = Object.keys(gridProbe);
    let gridArea = 0;
    if (probeIds.length) {
      const gx = probeIds.map((id) => gridProbe[id].x);
      const gy = probeIds.map((id) => gridProbe[id].y);
      gridArea =
        (Math.max(...gx) - Math.min(...gx) + COMPONENT_GAP) *
        (Math.max(...gy) - Math.min(...gy) + COMPONENT_GAP);
    }

    // Pack the class groups first. Satellites then hang off owners that are
    // already in their final place, so they ride along automatically.
    const shelf = packBlocks(blocks, positions, gridArea);

    // Who each satellite was hung off. Returned alongside the positions
    // because it is a fact about the layout, not a debugging aid: it is what
    // says a node was placed next to something it is connected to, and
    // geometry alone cannot answer that afterwards.
    /** @type {Record<string, string>} */
    const satelliteOwner = {};

    // Before the satellites: an open type's members are a tree of their own,
    // not a ring of things that happened to attach to it. Placed first, they
    // are part of the space every other satellite is seated around.
    /** @type {Map<string, number>} */
    const rooms = new Map();
    for (const typeId of openTypesIn(graph)) {
      if (!positions[typeId]) continue;
      rooms.set(typeId, placeMemberTree(graph, typeId, positions, outwardAngles));
    }

    placeAllSatellites(
      graph,
      byId,
      fullAdj,
      linkedVisible,
      positions,
      center,
      outwardAngles,
      componentRoots,
      satelliteOwner
    );

    // Leftovers only after satellites have had their turn. Running the grid
    // first would swallow every function: none of them has a position yet, so
    // all 150 would count as leftovers and the satellite pass would skip them
    // for already being placed, a median of 2398px from the class they belong
    // to.
    const leftover = unlinkedIds.concat(
      [...linkedVisible].filter((id) => !positions[id])
    );
    // Leftovers in the grid stay ungrouped — they belong to nothing, and Reset
    // falls back to the primary centre there.
    inheritGroupsFromOwners(groupOf, satelliteOwner);

    placeUnlinkedCluster(leftover, byId, positions, fullAdj);
    placeGridBlock(leftover.filter((id) => positions[id]), positions, shelf);
    // Last, over everything that has a place: the room an open type's members
    // take is room the drawing gives up, and what gives it up is everything.
    makeRoomForMembers(graph, positions, rooms);
    return {
      positions,
      componentRoots,
      groupOf,
      satelliteOwner,
      ringRadii,
      treeParent,
      rootWidth,
    };
  }

  /**
   * Give every satellite the group of what it was hung off.
   *
   * A group answers "which tree is this part of", which is a fact about how a
   * node was placed. Settling it by distance — the nearest already-grouped
   * node — almost always gives the same answer, because a satellite sits
   * within `SAT_RADIUS` of its owner and the gap between components is larger
   * than that.
   *
   * Almost. On CPython the geometric answer is wrong six times: four checks
   * from `wsgiref/validate.py` grouped into `xml/dom`, and two helpers from
   * `re/_optimizer.py` onto an island in `shutil` while the function they hang
   * off is in the main tree. It would also be asking of an unfinished drawing —
   * the grid's leftovers are placed after this — so the geometry it read would
   * be missing them.
   *
   * The owner may itself be a satellite, so the chain is walked until it
   * reaches something with a group. A node with no owner has none to inherit:
   * that is the grid, and the grid is meant to stay ungrouped.
   *
   * @param {Record<string, string>} groupOf
   * @param {Record<string, string>} satelliteOwner
   */
  function inheritGroupsFromOwners(groupOf, satelliteOwner) {
    for (const id of Object.keys(satelliteOwner)) {
      if (groupOf[id]) continue;
      let at = satelliteOwner[id];
      // A cycle should not exist — each satellite is hung off a node already
      // placed — but a cycle here would be a blank screen rather than a wrong
      // drawing, which is the one failure worth a Set to rule out.
      const seen = new Set([id]);
      while (at && !groupOf[at] && !seen.has(at)) {
        seen.add(at);
        at = satelliteOwner[at];
      }
      if (at && groupOf[at]) groupOf[id] = groupOf[at];
    }
  }

  /** Undirected adjacency restricted to class nodes. */
  function classOnlyAdj(classIds, fullAdj) {
    /** @type {Record<string, string[]>} */
    const adj = {};
    for (const id of classIds) adj[id] = [];
    for (const id of classIds) {
      for (const nb of fullAdj[id] || []) {
        if (classIds.has(nb) && nb !== id) adj[id].push(nb);
      }
    }
    return adj;
  }

  /**
   * Layout one component in two phases:
   * 1) place every class (parent-centered rings)
   * 2) optionally place functions/files as satellites (prefer class that uses the fn)
   * @param {boolean} placeSats
   * @param {Record<string, number>} outwardAngles
   * @param {Set<string>} componentRoots
   */
  function layoutOneClassComponent(
    graph,
    byId,
    fullAdj,
    memberIds,
    localCenter,
    originX,
    originY,
    positions,
    placeSats,
    outwardAngles,
    componentRoots,
    ringRadii,
    alsoVertex,
    treeParent,
    bandOverflow,
    rootSector
  ) {
    const memberSet = new Set(memberIds);
    if (!memberSet.has(localCenter)) return;

    const { dist: fullDist, parent } = bfsParents(fullAdj, localCenter);
    const classIds = new Set(
      [...memberSet].filter((id) => isTreeVertex(graph, byId[id], alsoVertex))
    );

    // Depth for the class ring is measured class-to-class. Going through
    // functions lets a shared helper act as a shortcut: `_get_fastapi_scope` is
    // called by both APIRouter and _FrontendStaticFiles, which would make the
    // latter look as shallow as _FrontendRoute — the class that actually builds
    // it — and reparent it onto APIRouter instead of nesting it under
    // _FrontendRoute. Classes reachable only through functions keep the
    // full-adjacency depth so they still get placed.
    const classDist = bfsParents(classOnlyAdj(classIds, fullAdj), localCenter).dist;
    /** @type {Record<string, number>} */
    const dist = {};
    for (const id of Object.keys(fullDist)) dist[id] = fullDist[id];
    for (const id of Object.keys(classDist)) dist[id] = classDist[id];

    componentRoots.add(localCenter);
    positions[localCenter] = { x: originX, y: originY };
    outwardAngles[localCenter] = -Math.PI / 2;

    /** @type {Record<string, string[]>} */
    const childrenOf = {};
    for (const id of classIds) {
      if (id === localCenter) continue;
      if (dist[id] === undefined) continue;
      // FrozenDict-style helpers orbit their producer fn, not the class ring.
      if (isFnOnlyHelperClass(id, graph, byId)) continue;
      const cp = pickClassParent(
        id,
        graph,
        fullAdj,
        classIds,
        dist,
        parent,
        localCenter
      );
      if (!childrenOf[cp]) childrenOf[cp] = [];
      childrenOf[cp].push(id);
      // What the tree used as this node's parent. Every other edge in the
      // graph crosses the drawing rather than building it, and telling the two
      // apart is what lets the structure be drawn brighter than the traffic.
      if (treeParent) treeParent[id] = cp;
    }

    // Order once; the walk below reads the same list it measures.
    /** @type {Record<string, string[]>} */
    const orderedKids = {};
    for (const p of Object.keys(childrenOf)) {
      orderedKids[p] = orderRingClasses(childrenOf[p], graph);
    }
    // A fan widens where its first ring would crowd: about its own centre, only
    // as far as that ring needs to seat its members side by side, and no
    // further than the caller allows. Not on the set failing to fit a screen: a
    // circle is as wide as the fan and twice as tall, so it fits less.
    //
    // The first ring alone, by the reader's rule: the nearer a ring is to the
    // root the less it may overlap, being what the root points to directly and
    // what everything further out hangs off. Both readings are measured and
    // the cost of this one is accepted: an outer ring overlaps in 12.3% of
    // Angular's views against 2.3% under the most-crowded-ring rule, and 8.7%
    // of Django's against 0.1%; what it buys is the reader's opening, kept in
    // 91% of Angular's views against 81% and 97% of Django's against 89%. The
    // first ring reads the same under either — it overlaps only where the root
    // points straight at more than a circle seats, which no opening fixes.
    let rootOpen = rootSector;
    if (rootSector && rootSector.widenTo > rootSector.width) {
      const first = (orderedKids[localCenter] || []).length;
      const floor = 2 * Math.asin(Math.min(1, MIN_SEPARATION / (2 * RING_RADIUS)));
      const need = first * floor;
      const width = Math.min(rootSector.widenTo, Math.max(rootSector.width, need));
      const centre = rootSector.start + rootSector.width / 2;
      rootOpen = { start: centre - width / 2, width };
    }
    const rootWidth = rootOpen ? rootOpen.width : 2 * Math.PI;

    // Only for a root that owns the whole circle — a fan widened to one
    // included, since it then has opposite sides: balancing spreads the heaviest
    // subtrees to opposite sides, and a fan's root owns a slice with no
    // opposite sides. Measured on real sets it would not help a fan either —
    // the centroid's sideways drift, as a share of the fan's half-width, is
    // 3.2% skipped against 3.4% balanced on Django, 10.2 against 8.5 on
    // Angular, 16.8 against 17.6 on CPython — so what decides it is the other
    // half of its own docstring: reordering scrambles the inheritance grouping.
    const ownsWholeCircle = rootWidth >= 2 * Math.PI - 1e-9;
    if (ownsWholeCircle) balanceRootChildren(orderedKids, localCenter);

    // Every vertex owns an angular sector; its children partition that sector
    // in proportion to their leaf counts, so a subtree can never spill into a
    // sibling's space no matter how deep it runs. Positions are polar around
    // the component origin rather than offsets from the parent, which is what
    // makes the separation argument in `ringStepFor` hold.
    const leaves = leafCounts(orderedKids, localCenter);

    /** @type {Record<string, { start: number; width: number }>} */
    // The one place the root's angular budget is decided. Every sector below
    // is a share of this one, so a narrower seed confines the whole tree to it
    // — which is all the right button's fan is.
    const sectorOf = {
      [localCenter]: rootOpen
        ? { start: rootOpen.start, width: rootOpen.width }
        : { start: SECTOR_ORIGIN, width: 2 * Math.PI },
    };
    /** @type {Record<string, number>} */
    const radiusOf = { [localCenter]: 0 };
    /** Consecutive single-child links above this node. */
    /** @type {Record<string, number>} */
    const unaryRun = { [localCenter]: 0 };

    /** @type {string[]} */
    let level = [localCenter];
    const placed = new Set([localCenter]);
    let prevRadius = 0;

    // A ring at a time, and its radius from its own depth.
    //
    // Not derived from whatever the ring inside it has grown to and then
    // multiplied until the angular floors fit. The multiplication would be
    // earned — a sector too narrow to hold its children is fixed by
    // moving them outward — but the sector narrows geometrically with depth,
    // each level taking a share of a share, so the radius that satisfies a
    // fixed arc inside it grows geometrically as well, each level inheriting
    // the last one's inflation. A ternary tree six levels deep would come out
    // 4.8x its depth's worth of pixels, seven levels 12.5x, eight 33.1x;
    // Django's step of 180 would become a radius of 37000.
    //
    // A tree four levels deep never reaches it — every ring still fits, the
    // radii land on exact multiples of the step — so only a deep tree shows it.
    //
    // So depth alone decides, and a ring that cannot hold its contents lets
    // them overlap. That is the trade already settled for a node's
    // satellites, one level up: crowded reads as crowded, where fleeing
    // outward takes the whole drawing with it.
    while (level.length) {
      /** @type {{ p: string; kids: string[]; sector: {start:number;width:number}; run: number }[]} */
      const work = [];
      for (const p of level) {
        const kids = orderedKids[p] || [];
        if (!kids.length) continue;
        const sector = sectorOf[p];
        if (!sector) continue;
        work.push({
          p,
          kids,
          sector,
          run: kids.length === 1 ? (unaryRun[p] || 0) + 1 : 0,
        });
      }
      if (!work.length) break;

      // A chain of single children compresses its steps, which is what keeps
      // a 50-link inheritance chain on the page. It only applies where the
      // whole ring is such a continuation: one branching parent means the
      // ring has real width to earn, and the full step is what earns it.
      let minRun = Infinity;
      for (const w of work) minRun = Math.min(minRun, w.run);
      const step =
        minRun > 0
          ? Math.max(MIN_SEPARATION, RING_RADIUS * Math.pow(UNARY_STEP_DECAY, minRun))
          : RING_RADIUS;
      const ringRadius = prevRadius + step;

      const floorWidth =
        2 * Math.asin(Math.min(1, MIN_SEPARATION / (2 * Math.max(ringRadius, 1e-6))));

      /** @type {string[]} */
      const next = [];
      for (let { kids, sector, run } of work) {
        let parentLeaves = 0;
        for (const id of kids) {
          parentLeaves += leaves[id] !== undefined ? leaves[id] : 1;
        }

        // Floor first, then share out what is left. Pure leaf-proportional
        // allocation punishes small siblings twice: a one-leaf child next to
        // a thirty-leaf one gets a sliver, and a sliver cannot hold a node.
        const shares = kids.map((id) => {
          const weight = leaves[id] !== undefined ? leaves[id] : 1;
          return sector.width * (weight / (parentLeaves || kids.length));
        });
        let widths = shares.map((sh) => Math.max(sh, floorWidth));
        let total = 0;
        for (const w of widths) total += w;
        if (total > sector.width) {
          // The floors do not fit. The ring does not move — the sector is
          // divided by weight and the nodes on it overlap, which is what
          // "crowded reads as crowded" means in code.
          widths = shares;
        } else if (total > 0) {
          // Hand the slack back in proportion, so children fill the sector
          // exactly and sibling sectors stay adjacent.
          const scale = sector.width / total;
          widths = widths.map((w) => w * scale);
        }

        // A sector too narrow for its children seats the childless ones outward
        // instead of jamming everything onto the ring. Half the parents on both
        // large fixtures are in this state, and it is what puts 5,279 pairs of
        // Django's tree vertices on top of one another.
        //
        // Only the childless move. A row reuses the angular slots of the row
        // inside it, which is harmless for a leaf and not for anything else:
        // a subtree hanging off a moved node would land on the subtree of
        // whichever node holds that slot one row in. Measured, 86% of Django's
        // overflow is leaves and 89% of CPython's, so little is given up.
        const perRow = Math.max(1, Math.floor(sector.width / floorWidth));
        // The rows live in the room that is already there, between this ring
        // and the next. Letting them push outward instead would take Django's
        // drawing from 6,454x3,421 to 11,707x6,570 and its magnification from
        // 0.186 to 0.102 — a bigger drawing shown smaller. What still does not
        // fit stays crowded.
        const maxRows = 1 + Math.max(0, Math.floor((RING_RADIUS - MIN_SEPARATION) / BAND_STEP));
        /** @type {string[]} */
        let banded = [];
        if (bandOverflow && kids.length > perRow) {
          const carriers = kids.filter((id) => (orderedKids[id] || []).length);
          const leaf = kids.filter((id) => !(orderedKids[id] || []).length);
          const room = Math.max(0, perRow - carriers.length);
          if (leaf.length > room) {
            banded = leaf.slice(room, room + (maxRows - 1) * perRow);
            const moved = new Set(banded);
            const kept = [];
            const keptWidths = [];
            for (let i = 0; i < kids.length; i++) {
              if (moved.has(kids[i])) continue;
              kept.push(kids[i]);
              keptWidths.push(widths[i]);
            }
            // The sector is the same width; what stays now shares all of it.
            let keptTotal = 0;
            for (const w of keptWidths) keptTotal += w;
            if (keptTotal > 0) {
              const scale = sector.width / keptTotal;
              for (let i = 0; i < keptWidths.length; i++) keptWidths[i] *= scale;
            }
            kids = kept;
            widths = keptWidths;
          }
        }

        for (let i = 0; i < banded.length; i++) {
          const id = banded[i];
          if (placed.has(id)) continue;
          placed.add(id);
          const row = Math.floor(i / perRow) + 1;
          const radius = ringRadius + row * BAND_STEP;
          const inRow = Math.min(perRow, banded.length - (row - 1) * perRow);
          const width = sector.width / inRow;
          const angle = sector.start + width * ((i % perRow) + 0.5);
          sectorOf[id] = { start: sector.start + width * (i % perRow), width };
          radiusOf[id] = radius;
          unaryRun[id] = run;
          // No ring is recorded. A row is a row inside a level, not a level:
          // a circle at each would turn one level into four.
          positions[id] = {
            x: originX + Math.cos(angle) * radius,
            y: originY + Math.sin(angle) * radius,
          };
          outwardAngles[id] = angle;
          next.push(id);
        }

        let cursor = sector.start;
        for (let i = 0; i < kids.length; i++) {
          const id = kids[i];
          const width = widths[i];
          const start = cursor;
          cursor += width;
          if (placed.has(id)) continue;
          placed.add(id);
          const angle = start + width / 2;
          sectorOf[id] = { start, width };
          radiusOf[id] = ringRadius;
          // The ring this level sits on, recorded where it is decided. A ring
          // marks a level of the tree, so this is the only place that knows
          // what one is: reconstructing it afterwards from where nodes ended
          // up cannot tell a level from a node the tree never placed.
          if (ringRadii) {
            let set = ringRadii.get(localCenter);
            if (!set) ringRadii.set(localCenter, (set = new Set()));
            set.add(ringRadius);
          }
          unaryRun[id] = run;
          positions[id] = {
            x: originX + Math.cos(angle) * ringRadius,
            y: originY + Math.sin(angle) * ringRadius,
          };
          outwardAngles[id] = angle;
          next.push(id);
        }
      }
      prevRadius = ringRadius;
      level = next;
    }

    if (!placeSats) return rootWidth;

    placeSatellitesForOwners(
      graph,
      byId,
      fullAdj,
      memberSet,
      classIds,
      positions,
      dist,
      componentRoots,
      outwardAngles,
      originX,
      originY
    );
    return rootWidth;
  }

  /**
   * After all class clusters are placed, attach remaining functions/files,
   * then fn-only helper classes (e.g. FrozenDict next to freeze).
   * Island roots (Query, TinyDBPlugin, …) get full-circle sats around themselves —
   * not an outer fan relative to the primary TinyDB/Storage center.
   */
  function placeAllSatellites(
    graph,
    byId,
    fullAdj,
    linkedVisible,
    positions,
    primaryCenter,
    outwardAngles,
    componentRoots,
    satelliteOwner
  ) {
    const { dist } = bfsParents(fullAdj, primaryCenter);

    // The two passes feed each other. A satellite needs its class placed; a
    // helper class — one no other class uses, only functions do — is placed
    // next to the function that uses it, so it needs that function placed
    // first. Three nodes can be waiting on each other in a ring: FastAPI's
    // `_check_event_single_line` has exactly one class, `ServerSentEvent`,
    // which is a helper, so in a single pass the function is still unplaced
    // when helpers run and the class is still unplaced when satellites run. A
    // fallback owner would hide that, the function falling through to it and
    // looking placed. With no fallback it would fall to the isolated cluster,
    // which is just as wrong — it has a path to the class structure.
    //
    // So run them to a fixpoint. Positions are only ever added, never
    // removed, and the node set is finite, so a round that places nothing is
    // the end.
    for (;;) {
      const before = Object.keys(positions).length;
      const classIds = new Set(
        [...linkedVisible].filter(
          (id) => isTreeVertex(graph, byId[id]) && positions[id]
        )
      );

      placeSatellitesForOwners(
        graph,
        byId,
        fullAdj,
        linkedVisible,
        classIds,
        positions,
        dist,
        componentRoots,
        outwardAngles,
        0,
        0,
        satelliteOwner
      );

      placeHelperClassesNearFunctions(
        graph,
        byId,
        fullAdj,
        linkedVisible,
        classIds,
        positions,
        dist,
        primaryCenter,
        satelliteOwner
      );

      if (Object.keys(positions).length === before) break;
    }
  }

  /**
   * Class with no class↔class edges, only function/file links (FrozenDict, TinyDBPlugin).
   * Skip class-ring placement unless it is a component local center.
   */
  function isFnOnlyHelperClass(id, graph, byId) {
    // Only meaningful when there is a satellite tier to be a helper of.
    if (!graphHasTypes(graph)) return false;
    if (!byId[id] || !isTypeKind(byId[id].kind)) return false;
    let hasFnOrFile = false;
    for (const other of edgeIndex(graph).incident[id] || NO_EDGES) {
      const o = byId[other];
      if (!o) continue;
      if (isTypeKind(o.kind)) return false;
      hasFnOrFile = true;
    }
    return hasFnOrFile;
  }

  /**
   * Place helper classes just beyond the function that uses them (same ray from owner).
   */
  function placeHelperClassesNearFunctions(
    graph,
    byId,
    fullAdj,
    linkedVisible,
    classIds,
    positions,
    dist,
    localCenter,
    satelliteOwner
  ) {
    const HELPER_GAP = 40;
    // Helpers sharing a producer would otherwise land on identical coordinates,
    // since the slot is derived entirely from that producer's position. Seats
    // fan alternately either side of it, so the first keeps the exact spot.
    const HELPER_FAN = 0.55;
    /** @type {Map<string, number>} */
    const seatsTaken = new Map();
    const nextSeatAngle = (key, base) => {
      const used = seatsTaken.get(key) || 0;
      seatsTaken.set(key, used + 1);
      if (used === 0) return base;
      const step = Math.ceil(used / 2);
      return base + (used % 2 === 1 ? step : -step) * HELPER_FAN;
    };
    // The seat fan only separates helpers that share a producer. Helpers of
    // different producers have nothing in common to arbitrate them, so an
    // occupancy check decides the final radius. Bounded, and deterministic
    // because helpers are processed in sorted order.
    // The same occupancy the satellite pass uses, so the seat search can ask
    // how much room a candidate has rather than only whether a point is taken.
    // It carries each body's radius and whether it is a tree vertex, which is
    // what lets a full neighbourhood be ranked instead of merely refused.
    const occupied = makeOccupancy(MIN_SEPARATION);
    for (const id of Object.keys(positions)) {
      const p = positions[id];
      occupied.add(
        p.x,
        p.y,
        bodyRadius(id, satelliteOwner),
        isTreeVertex(graph, byId[id])
      );
    }
    // Room is looked for *around* the node, not further out along one line
    // from it.
    //
    // Stepping outward at a fixed angle finds space by leaving the
    // neighbourhood: the ideal seat beside CPython's `filename` has 29 other
    // nodes within 40px, so twelve steps of `MIN_SEPARATION` would put the class
    // 599px away — clear of everything, including the function it belongs to.
    // 74 of CPython's 117 helper classes would end up more than 200px from theirs.
    //
    // `freeSeat` is the search the satellite pass already uses: it walks around
    // the owner a slot at a time, scores each candidate by the smallest surface
    // gap to anything already there, and when nothing is free takes the
    // emptiest. Crowding is the settled trade everywhere else in this drawing,
    // and a class touching a neighbour beside its function reads better than
    // one touching nothing half a screen away.
    const freeSpot = (ox, oy, ang, r0) => {
      const seat = freeSeat(
        occupied,
        NO_TENTATIVE,
        { x: ox, y: oy },
        r0,
        ang,
        SAT_DIAMETER / 2,
        0
      );
      return { x: seat.x, y: seat.y };
    };
    /** @type {string[]} */
    const helpers = [];
    for (const id of linkedVisible) {
      if (positions[id]) continue;
      if (!isFnOnlyHelperClass(id, graph, byId)) continue;
      helpers.push(id);
    }
    helpers.sort();

    for (const id of helpers) {
      // Every function this class is joined to, whichever way the edge points
      // and whatever kind it carries.
      //
      // Reading only the edges *into* the class would miss 24 of CPython's 31
      // such classes and 6 of Django's 7: `IsoCalendarDate` uses
      // `weekday`, `_Printer` uses `get_pager` — the class is the source.
      // Requiring `uses` would miss one more, `_ThemeSyntax`, named by
      // `_theme_style` in an annotation. Which kind the analyzer recorded says
      // how it classified the mention; it says nothing about whether the two
      // belong near each other.
      /** @type {string[]} */
      const producerFns = [];
      for (const other of edgeIndex(graph).incident[id] || NO_EDGES) {
        if (byId[other] && byId[other].kind === "function") {
          if (producerFns.indexOf(other) === -1) producerFns.push(other);
        }
      }
      producerFns.sort();

      let placed = false;
      for (const fnId of producerFns) {
        const fp = positions[fnId];
        if (!fp) continue;
        // Seated against the function itself.
        //
        // Not measured out from whatever class the function is drawn beside:
        // that would make placing a class depend on a question whose answer can
        // be that same class — `check`'s nearest class is `_error`, and `_error`
        // is waiting for `check`. That owner is also arbitrary wherever a function
        // has more than one class — `filename` has 85 — and the one it names
        // has nothing to do with the class being seated.
        //
        // The angle still points outward from the origin, so a chain of these
        // reads as leading away from the centre rather than back into it.
        const ang = nextSeatAngle(fnId, Math.atan2(fp.y, fp.x));
        positions[id] = freeSpot(fp.x, fp.y, ang, SAT_RADIUS + HELPER_GAP);
        occupied.add(positions[id].x, positions[id].y, SAT_DIAMETER / 2, false);
        // "Satellite of X" here means "seated against X", not "on X's orbit":
        // a contended seat is pushed outward, so a check that every satellite
        // of one node shares one radius has to exclude these.
        if (satelliteOwner) satelliteOwner[id] = fnId;
        placed = true;
        break;
      }
      if (placed) continue;

      // No related function has a position, on this round or any. Left
      // unplaced, which is how a node reaches the grid of unconnected ones:
      // `leftover` collects everything the passes above did not place, and the
      // fixpoint gives this one more rounds first.
      //
      // A seat at one satellite radius from the group's centre instead would
      // draw 31 of CPython's classes in a ring around the middle of the drawing,
      // a median of 743px from the function each is actually related to. "Where
      // this belongs could not be worked out" and "this belongs at the middle"
      // are different statements, and only the first is true.
    }
  }

  /**
   * How far one link of a chain reaches beyond the node it hangs off.
   *
   * Swept against the FastAPI fixture rather than picked. 95 is not a
   * compromise between cramped and sprawling — it is better than both
   * neighbours on every measure at once: nothing drawn over a class (55 has
   * two, 150 has three), the fewest overlapping pairs anywhere in the drawing
   * (28, against 35 at 55 and 30 at 120), and the shallowest worst overlap
   * (-9px, against -19px at 55).
   *
   * The reason there is an optimum at all: too short and consecutive links
   * crowd each other, too long and chains reach into the next class's
   * neighbourhood and crowd that instead.
   */
  const SAT_STEP = 95;

  /**
   * One level of a chain of satellites, laid out the way the class tree is.
   *
   * Below the first ring the rules change, and deliberately. That ring
   * answers "which class do these belong to", so it is held close and capped.
   * A chain hanging off one of its members has already answered that
   * question; what it has to show instead is the chain — which means walking
   * outward, one step per link, inside a wedge that its siblings cannot enter.
   *
   * Treating chains like the first ring makes them read badly in two ways: a
   * full circle lets a link fold back over its own parent (8 of FastAPI's
   * 50), and a cap meant for the first ring leaves no room to walk (depth 3
   * lands anywhere from 43px to 146px from its class, some of it inside depth
   * 1).
   *
   * Sector width follows subtree size, so two chains off the same function
   * get room in proportion to what hangs below them and cannot cross.
   */
  function placeSubtreeLevel(
    owner,
    sats,
    ownerPos,
    baseOut,
    ownSector,
    leaves,
    sector,
    outwardAngles,
    positions,
    occupancy
  ) {
    const count = sats.length;
    let total = 0;
    for (const id of sats) total += leaves[id] || 1;
    // Never the whole circle: the span is what stops a link folding back over
    // the node it hangs off.
    const span = Math.min(ownSector, outerFanSpanRad(count));
    let cursor = baseOut - span / 2;
    for (const id of sats) {
      const share = ((leaves[id] || 1) / (total || 1)) * span;
      const angle = cursor + share / 2;
      cursor += share;
      // Marching outward is the shape; landing on a class is still wrong, and
      // the two do not conflict. The step stays what it is and the link only
      // shuffles within its own wedge, which is enough to slide off a class
      // body without changing what the chain looks like.
      // Fine enough to actually find a way off a class body: stepping by the
      // wedge itself, the first probe would already exceed the limit, so
      // nothing but the ideal angle would ever be tried.
      const probe = (r) =>
        freeSeat(
          occupancy,
          [],
          ownerPos,
          r,
          angle,
          SAT_DIAMETER / 2,
          Math.max(0.02, share / 8),
          share / 2
        );
      // A longer step is the second way out, and the only one that does not
      // change what the chain is saying — still one link, still outward,
      // still inside its own wedge. Tried only when the wedge alone was not
      // enough.
      let seat = probe(SAT_STEP);
      if (!seat.found) {
        const longer = probe(SAT_STEP * 1.35);
        if (longer.found) seat = longer;
      }
      positions[id] = { x: seat.x, y: seat.y };
      occupancy.add(seat.x, seat.y, SAT_DIAMETER / 2);
      outwardAngles[id] = seat.a;
      sector[id] = share;
    }
  }

  function placeSatellitesForOwners(
    graph,
    byId,
    fullAdj,
    candidateIds,
    classIds,
    positions,
    dist,
    componentRoots,
    outwardAngles,
    originX,
    originY,
    satelliteOwner
  ) {
    const candidateSet = new Set(candidateIds);

    /**
     * Who each satellite hangs off, and how many edges from the class
     * structure it is.
     *
     * Depth 0 is a satellite of a class: it has an edge to one. Everything
     * deeper is reached by walking edges between satellites outward from all
     * of depth 0 at once, so the shortest chain of edges wins without any
     * candidate being compared against another. That walk is the whole point
     * of the pass: asking only "which class do you touch" would hand
     * everything that answers "none" to one node for the entire drawing — 50
     * of FastAPI's 150 functions beside something they share no edge with, 60
     * of them around the same node.
     */
    /** @type {Record<string, string>} */
    const ownerOf = {};
    /** @type {Record<string, number>} */
    const depth = {};
    /** @type {string[]} */
    const queue = [];

    for (const id of [...candidateIds].sort()) {
      if (positions[id]) continue;
      const n = byId[id];
      if (!isTreeVertexSatelliteCandidate(graph, n)) continue;
      // No fallback owner. A satellite with no class of its own is not
      // "somewhere near the middle" — it is either reached below, or it is
      // not part of the class structure and the isolated cluster takes it.
      const owner = attachSatelliteOwner(
        id,
        graph,
        fullAdj,
        classIds,
        positions,
        dist,
        null
      );
      if (!owner || !positions[owner]) continue;
      ownerOf[id] = owner;
      depth[id] = 0;
      queue.push(id);
    }

    // Sorted seeds and sorted expansion: the same artifact must reopen to the
    // same drawing, and BFS parentage is where that could quietly stop being
    // true.
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const v of (fullAdj[u] || []).slice().sort()) {
        if (depth[v] !== undefined) continue;
        if (positions[v]) continue;
        if (!candidateSet.has(v)) continue;
        if (!isTreeVertexSatelliteCandidate(graph, byId[v])) continue;
        ownerOf[v] = u;
        depth[v] = depth[u] + 1;
        queue.push(v);
      }
    }

    // Where the tree vertices are, so an orbit can be told to stop short of
    // the nearest one.
    /** @type {{ id: string; x: number; y: number }[]} */
    const vertexPoints = [];
    for (const id of classIds) {
      const p = positions[id];
      if (p) vertexPoints.push({ id, x: p.x, y: p.y });
    }

    /**
     * How wide this owner's ring is allowed to be.
     *
     * A ring says "these belong to that node". It stops saying it the moment
     * it reaches far enough to touch a different class, because then the
     * bodies on it are as near one class as the other. So the ring stops
     * short of the nearest other class rather than growing until its contents
     * fit; when they do not fit, they overlap.
     */
    const ringCap = (ownerId, ownerPos) => {
      let nearest = Infinity;
      for (const v of vertexPoints) {
        if (v.id === ownerId) continue;
        const d = Math.hypot(v.x - ownerPos.x, v.y - ownerPos.y);
        if (d < nearest) nearest = d;
      }
      if (!isFinite(nearest)) return Infinity;
      // Half way to the nearest other class, so every body on the ring stays
      // on its own owner's side of the gap between them. Merely not touching
      // the neighbour is not enough — a satellite can be clear of a class and
      // still be nearer to it than to the node it belongs to, and then the
      // ring has stopped saying which class this lot is attached to.
      //
      // The floor wins when a neighbour is very close. A ring inside its own
      // owner would be worse than one that reaches a little.
      const outside = NODE_DIAMETER / 2 + SAT_DIAMETER / 2 + SAT_GAP;
      return Math.max(outside, nearest / 2);
    };

    // Everything already on the board, so a satellite can be given a seat
    // nobody is sitting in. Rebuilt per call rather than carried across the
    // fixpoint rounds: a round can add tree vertices and helper classes too.
    const occupancy = makeOccupancy(NODE_DIAMETER + SAT_GAP);
    for (const id of Object.keys(positions)) {
      const p = positions[id];
      occupancy.add(
        p.x,
        p.y,
        bodyRadius(id, satelliteOwner),
        isTreeVertex(graph, byId[id])
      );
    }

    // How much of the drawing each subtree needs, so siblings can be given
    // shares of an angle rather than all of it. Same rule the class tree
    // already uses: a sector proportional to the leaves below it.
    /** @type {Record<string, string[]>} */
    const kids = {};
    for (const id of queue) {
      const o = ownerOf[id];
      if (!kids[o]) kids[o] = [];
      kids[o].push(id);
    }
    /** @type {Record<string, number>} */
    const leaves = {};
    for (let i = queue.length - 1; i >= 0; i--) {
      const id = queue[i];
      const ks = kids[id];
      if (!ks || !ks.length) {
        leaves[id] = 1;
        continue;
      }
      let total = 0;
      for (const k of ks) total += leaves[k] || 1;
      leaves[id] = total;
    }

    /**
     * The slice of angle a satellite's own subtree may use.
     *
     * Depth 0 gets its slot on the class's ring. Below that, a node divides
     * its own slice among its children in proportion to their subtrees, so
     * two chains hanging off the same function cannot cross.
     */
    /** @type {Record<string, number>} */
    const sector = {};

    // By depth, so an owner is always in its final place before anything it
    // carries is measured against it. A single pass would be enough if every
    // owner were a class; it is not, since a satellite can carry satellites.
    let maxDepth = -1;
    for (const id of queue) if (depth[id] > maxDepth) maxDepth = depth[id];

    for (let d = 0; d <= maxDepth; d++) {
      /** @type {Record<string, string[]>} */
      const satsByOwner = {};
      for (const id of queue) {
        if (depth[id] !== d) continue;
        const owner = ownerOf[id];
        if (!satsByOwner[owner]) satsByOwner[owner] = [];
        satsByOwner[owner].push(id);
        if (satelliteOwner) satelliteOwner[id] = owner;
      }

      for (const owner of Object.keys(satsByOwner).sort()) {
        const sats = satsByOwner[owner].sort();
        const count = sats.length;
        const ownerPos = positions[owner];
        const baseOut =
          outwardAngles[owner] !== undefined
            ? outwardAngles[owner]
            : Math.atan2(ownerPos.y - originY, ownerPos.x - originX);

        if (d > 0) {
          placeSubtreeLevel(
            owner,
            sats,
            ownerPos,
            baseOut,
            sector[owner] !== undefined ? sector[owner] : Math.PI,
            leaves,
            sector,
            outwardAngles,
            positions,
            occupancy
          );
          continue;
        }

        // Depth 0 only: the ring around a class. Each island root (TinyDB,
        // Query, TinyDBPlugin, …) gets a full circle.
        const whole = componentRoots.has(owner);
        const { radius, slot, angleAt } = satelliteOrbit(count, baseOut, whole);

        // Seated together, and at one radius. The ring is never widened to
        // make room: a ring that grows to fit its contents ends up reaching
        // across to the next class, and "which class is this lot attached
        // to" stops being readable — which is the only thing the ring is for.
        // Crowding is the accepted cost.
        //
        // The cap belongs to this level and no other. Reaching the next class
        // is only misleading for the ring that says which class these belong
        // to; a chain hanging off one of them has already said that, and has
        // to be able to walk outward.
        const seatAll = (r) => {
          /** @type {{x: number; y: number; r: number}[]} */
          const taken = [];
          const seats = [];
          let misses = 0;
          for (let i = 0; i < count; i++) {
            const seat = freeSeat(
              occupancy,
              taken,
              ownerPos,
              r,
              angleAt(i),
              SAT_DIAMETER / 2,
              slot
            );
            seats.push(seat);
            taken.push({ x: seat.x, y: seat.y, r: SAT_DIAMETER / 2 });
            if (!seat.found) misses++;
          }
          return { seats, misses };
        };

        const best = seatAll(Math.min(radius, ringCap(owner, ownerPos)));

        for (let i = 0; i < count; i++) {
          const seat = best.seats[i];
          positions[sats[i]] = { x: seat.x, y: seat.y };
          occupancy.add(seat.x, seat.y, SAT_DIAMETER / 2);
          // A satellite's own satellites fan away from it, not away from the
          // group's centre — otherwise a chain doubles back over its owner.
          outwardAngles[sats[i]] = seat.a;
          sector[sats[i]] = slot;
        }
      }
    }
  }

  /**
   * @param {Record<string, string[]>} adj
   * @param {string} startId
   * @returns {{ dist: Record<string, number>; parent: Record<string, string> }}
   */
  function bfsParents(adj, startId) {
    /** @type {Record<string, number>} */
    const dist = { [startId]: 0 };
    /** @type {Record<string, string>} */
    const parent = {};
    /** @type {string[]} */
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
        for (const nb of adj[id] || []) {
        if (dist[nb] === undefined) {
          dist[nb] = dist[id] + 1;
          parent[nb] = id;
          queue.push(nb);
        }
      }
    }
    return { dist, parent };
  }

  /**
   * Undirected hop distances from startId, capped at maxHops.
   * @param {Record<string, string[]>} adj
   * @param {string} startId
   * @param {number} maxHops
   * @returns {Record<string, number>} id -> hop distance (0..maxHops)
   */
  function hopDistances(adj, startId, maxHops) {
    const { dist } = bfsParents(adj, startId);
    /** @type {Record<string, number>} */
    const near = {};
    for (const id of Object.keys(dist)) {
      if (dist[id] <= maxHops) near[id] = dist[id];
    }
    return near;
  }

  /**
   * Class parent toward the root:
   * 1) closer class that uses this node (facade: TinyDB→JSONStorage beats inherits→Storage)
   * 2) inherits superclass at same/closer hop (not a farther child / cycle)
   * 3) adjacent class with smaller hop
   * 4) walk BFS parent chain through fns until a class
   * 5) component local center
   */
  /** `byId` for a graph, built once. `pickClassParent` is not handed one. */
  const byIdCache = new WeakMap();
  function byIdIn(graph) {
    let m = byIdCache.get(graph);
    if (!m) {
      m = {};
      for (const n of graph.nodes) m[n.id] = n;
      byIdCache.set(graph, m);
    }
    return m;
  }

  function pickClassParent(id, graph, fullAdj, classIds, dist, parentMap, root) {
    const selfDist = dist[id] !== undefined ? dist[id] : 9999;

    // A helper class is not in the tree — it orbits the function that builds
    // it, and the placement skips it. So nothing can hang off one: a node
    // parented there is never reached by the walk that places the tree, falls
    // through to the satellite pass, and arrives as a satellite of a satellite
    // 55px from its siblings instead of a ring step away. Parented on
    // `ReadError`, which hangs off `unpack_archive`, `shutil`'s
    // `_unpack_zipfile` and `_unpack_tarfile` would crowd three of that
    // island's five nodes into 139x107.
    const inTree = (cand) =>
      classIds.has(cand) && !isFnOnlyHelperClass(cand, graph, byIdIn(graph));

    // A class that assembles this one places it better than its base class does:
    // OpenAPI holding a Components field says more about where Components
    // belongs than the fact that both extend BaseModelWithConfig.
    //
    // Annotation-only consumers count too. Schema and model code names its parts
    // almost entirely in type annotations, so restricting this to `uses` would
    // silently disable the rule exactly where it matters most — every OpenAPI
    // model would fall through to its shared base class instead.
    /** @type {{ id: string; hop: number; weak: number }[]} */
    const consumers = [];
    for (const e of edgeIndex(graph).incoming[id] || NO_EDGES) {
      if (e.kind !== "uses" && e.kind !== "references") continue;
      if (!inTree(e.id)) continue;
      const cd = dist[e.id] !== undefined ? dist[e.id] : 9999;
      if (cd < selfDist) {
        consumers.push({
          id: e.id,
          hop: cd,
          weak: e.kind === "references" ? 1 : 0,
        });
      }
    }
    if (consumers.length) {
      consumers.sort((a, b) => {
        if (a.hop !== b.hop) return a.hop - b.hop;
        if (a.weak !== b.weak) return a.weak - b.weak;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return consumers[0].id;
    }

    /** @type {string[]} */
    const superclasses = [];
    for (const e of edgeIndex(graph).outgoing[id] || NO_EDGES) {
      if (e.kind !== "inherits" || !inTree(e.id)) continue;
      const sd = dist[e.id] !== undefined ? dist[e.id] : 9999;
      // Allow same hop; reject only farther supers (Query→QueryInstance).
      if (sd <= selfDist) superclasses.push(e.id);
    }
    if (superclasses.length) {
      superclasses.sort((a, b) => {
        const da = dist[a] !== undefined ? dist[a] : 9999;
        const db = dist[b] !== undefined ? dist[b] : 9999;
        if (da !== db) return da - db;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      return superclasses[0];
    }

    /** @type {string[]} */
    const closer = [];
    for (const nb of fullAdj[id] || []) {
      if (!inTree(nb) || nb === id) continue;
      const nd = dist[nb] !== undefined ? dist[nb] : 9999;
      if (nd < selfDist) closer.push(nb);
    }
    if (closer.length) {
      closer.sort((a, b) => {
        const da = dist[a] !== undefined ? dist[a] : 9999;
        const db = dist[b] !== undefined ? dist[b] : 9999;
        if (da !== db) return da - db;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      return closer[0];
    }

    let p = parentMap[id];
    while (p !== undefined) {
      if (inTree(p) || p === root) return p;
      p = parentMap[p];
    }
    return root;
  }

  /**
   * @param {string} nodeId
   * @param {Record<string, string[]>} fullAdj
   * @param {Set<string>} classIds
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {Record<string, number>} dist
   * @param {string} localCenter
   * @returns {string | null}
   */
  /**
   * The step from one level of an open type's members to the next.
   *
   * A member's circle is `SAT_DIAMETER` across, and a level has to clear the
   * one inside it with room for a label between them. Sized for members, not
   * for types: `RING_RADIUS` between levels would put a four-level tree 720px
   * from the type it belongs to. Wide enough that one level reads as a level,
   * rather than as the ring inside it grown thicker.
   */
  const MEMBER_STEP = 80;

  /**
   * How far past the room it needs an open type still pushes the drawing.
   *
   * Anything nearer than this multiple of that room moves outward, and the
   * nearer it is the further it moves; past it nothing moves at all. Greater
   * than 1, because that is what keeps the push from ever reordering two nodes
   * on one ray: the move grows with distance for every `SPREAD > 1`.
   */
  const MEMBER_SPREAD = 3;

  /**
   * The types this drawing has members under, in the order their members were
   * added — which is the order the reader opened them.
   *
   * Read off the graph rather than taken from the viewer's state, so the
   * layout stays a function of what it is given.
   */
  function openTypesIn(graph) {
    const members = drawnMemberIds(graph);
    if (!members.size) return [];
    const idx = edgeIndex(graph);
    /** @type {string[]} */
    const order = [];
    const seen = new Set();
    for (const n of graph.nodes) {
      if (!members.has(n.id)) continue;
      for (const e of idx.incoming[n.id] || NO_EDGES) {
        if (e.kind !== "contains" || seen.has(e.id)) continue;
        seen.add(e.id);
        order.push(e.id);
      }
    }
    return order;
  }

  /**
   * What an open type's members hang off, as a tree rooted on the type.
   *
   * The way in — the member no member of that type calls — hangs off the type;
   * what it calls hangs off it, and so on outward. A member no chain of calls
   * reaches hangs off the type beside the way in, which is where a reader would
   * look for something nothing else leads to.
   *
   * Breadth first, so a member called from two places is drawn under the
   * shallower of them, and sorted at every step, so the same artifact comes out
   * the same way twice.
   */
  function memberTreeOf(graph, typeId) {
    const members = drawnMemberIds(graph);
    const idx = edgeIndex(graph);
    /** @type {any[]} */
    const mine = [];
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    for (const e of idx.outgoing[typeId] || NO_EDGES) {
      if (e.kind === "contains" && members.has(e.id) && byId[e.id]) mine.push(byId[e.id]);
    }
    if (!mine.length) return null;
    const set = new Set(mine.map((n) => n.id));
    /** @type {{from: string, to: string}[]} */
    const calls = [];
    for (const n of mine) {
      for (const e of idx.outgoing[n.id] || NO_EDGES) {
        if (set.has(e.id) && e.id !== n.id) calls.push({ from: n.id, to: e.id });
      }
    }
    const root = wayIn(mine, calls);
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const e of calls) (out[e.from] = out[e.from] || []).push(e.to);
    /** @type {Record<string, string[]>} */
    const children = { [typeId]: [] };
    const seen = new Set();
    /** @type {string[]} */
    const queue = [];
    if (root) {
      children[typeId].push(root);
      seen.add(root);
      queue.push(root);
    }
    while (queue.length) {
      const id = queue.shift();
      for (const to of (out[id] || []).slice().sort()) {
        if (seen.has(to)) continue;
        seen.add(to);
        (children[id] = children[id] || []).push(to);
        queue.push(to);
      }
    }
    // Reached by nothing: beside the way in, rather than nowhere.
    for (const n of mine.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!seen.has(n.id)) children[typeId].push(n.id);
    }
    return { root: typeId, children, ids: mine.map((n) => n.id) };
  }

  /**
   * Place an open type's members around it, and say how much room they took.
   *
   * The same rule the class tree is laid out by — a level at a time, each node
   * owning a slice of its parent's slice in proportion to the leaves below it —
   * at a step sized for members. A level that cannot hold what is on it at that
   * radius is moved out until it can, which a tree of members can afford and
   * the class tree cannot: there is one of these, and it is what the reader
   * asked to see.
   *
   * @returns {number} the radius the tree reaches, from the type
   */
  function placeMemberTree(graph, typeId, positions, outwardAngles) {
    const tree = memberTreeOf(graph, typeId);
    const origin = positions[typeId];
    if (!tree || !origin) return 0;
    const beside = besideTheType(tree, typeId, origin, positions, outwardAngles);
    const leaves = leafCounts(tree.children, typeId);
    // The leaves of the whole tree: what every slice is a share of.
    const total = leaves[typeId] || 1;
    const step = SAT_DIAMETER + SAT_GAP;
    const base = outwardAngles[typeId] !== undefined ? outwardAngles[typeId] : SECTOR_ORIGIN;
    /** @type {Record<string, {start: number, width: number}>} */
    const sectorOf = { [typeId]: { start: base, width: 2 * Math.PI } };
    let level = [typeId];
    let radius = 0;
    let reach = 0;
    const placed = new Set([typeId]);
    if (beside) placed.add(beside);
    while (level.length) {
      /** @type {{parent: string, kids: string[]}[]} */
      const work = [];
      for (const p of level) {
        const kids = (tree.children[p] || []).filter((id) => !placed.has(id));
        if (kids.length) work.push({ parent: p, kids });
      }
      if (!work.length) break;
      // One step further out, and never nearer than the radius at which the
      // narrowest slice on this level holds one member.
      //
      // Every node's slice is its share of the leaves below the whole tree, so
      // no slice anywhere is narrower than one leaf's worth — `2π / L` — and
      // the radius this asks for is never more than `L · step / 2π`. Asked per
      // level rather than once for the tree, the levels near the type, whose
      // slices are wide, stay near it: the tree grows outward the way the
      // calls do instead of starting at the radius its outermost level needs.
      let narrowest = 2 * Math.PI;
      for (const w of work) {
        let weight = 0;
        for (const id of w.kids) weight += leaves[id] || 1;
        for (const id of w.kids) {
          narrowest = Math.min(narrowest, ((leaves[id] || 1) / weight) * sectorOf[w.parent].width);
        }
      }
      radius = Math.max(radius + MEMBER_STEP, step / Math.max(narrowest, 2 * Math.PI / total));
      /** @type {string[]} */
      const next = [];
      for (const w of work) {
        const sector = sectorOf[w.parent];
        let weight = 0;
        for (const id of w.kids) weight += leaves[id] || 1;
        let at = sector.start;
        for (const id of w.kids) {
          const share = ((leaves[id] || 1) / weight) * sector.width;
          const angle = at + share / 2;
          sectorOf[id] = { start: at, width: share };
          at += share;
          positions[id] = {
            x: origin.x + Math.cos(angle) * radius,
            y: origin.y + Math.sin(angle) * radius,
          };
          outwardAngles[id] = angle;
          placed.add(id);
          next.push(id);
        }
      }
      reach = radius;
      level = next;
    }
    return reach + SAT_DIAMETER / 2 + SAT_GAP;
  }

  /**
   * Draw the member that holds most of the tree beside the type, not out on
   * the first level.
   *
   * A tree drawn round a centre puts each node in the middle of its slice. A
   * slice wider than half the circle has its middle on the far side of the
   * circle from half of what it holds, so a way in that leads to most of the
   * type — `sql_stmt_list`, which reaches 63 of `Parser`'s 69 members — would
   * sit at one edge of the first level with its children spread round the
   * whole of the second, and every line out of it would cross the drawing.
   * Beside the type, its children are the first level around both.
   *
   * Changes the tree in place: that member's children become the type's, and
   * it is placed at the type's side. Returns it, or null where no member holds
   * more than half.
   */
  function besideTheType(tree, typeId, origin, positions, outwardAngles) {
    const leaves = leafCounts(tree.children, typeId);
    const total = leaves[typeId] || 1;
    const heavy = (tree.children[typeId] || []).find((id) => (leaves[id] || 1) * 2 > total);
    if (!heavy) return null;
    const own = tree.children[heavy] || [];
    tree.children[typeId] = tree.children[typeId].filter((id) => id !== heavy).concat(own);
    tree.children[heavy] = [];
    // Touching distance: the type's circle and the member's, with the gap two
    // satellites keep.
    const gap = NODE_DIAMETER / 2 + SAT_DIAMETER / 2 + SAT_GAP;
    const toward = outwardAngles[typeId] !== undefined ? outwardAngles[typeId] : SECTOR_ORIGIN;
    positions[heavy] = {
      x: origin.x + Math.cos(toward) * gap,
      y: origin.y + Math.sin(toward) * gap,
    };
    outwardAngles[heavy] = toward;
    return heavy;
  }

  /**
   * Move what is around an open type outward, to leave the room its members
   * need.
   *
   * Along the ray from the type, so every node keeps the direction it was in:
   * the reader who knows where a package sits still finds it in that
   * direction. Furthest where it is nearest, nothing at all past
   * `MEMBER_SPREAD` times the room — a change in one corner of the drawing
   * does not move the other corner.
   *
   * An open type and its members move as one body. Pushed node by node, a
   * second open type's tree would be stretched by the difference across it.
   */
  function makeRoomForMembers(graph, positions, rooms) {
    if (!rooms.size) return;
    const idx = edgeIndex(graph);
    const members = drawnMemberIds(graph);
    /** Which body each id belongs to: an open type, or itself. */
    /** @type {Record<string, string>} */
    const bodyOf = {};
    for (const id of Object.keys(positions)) bodyOf[id] = id;
    for (const typeId of rooms.keys()) {
      for (const e of idx.outgoing[typeId] || NO_EDGES) {
        if (e.kind === "contains" && members.has(e.id)) bodyOf[e.id] = typeId;
      }
    }
    /** @type {Record<string, string[]>} */
    const parts = {};
    for (const id of Object.keys(positions)) (parts[bodyOf[id]] = parts[bodyOf[id]] || []).push(id);
    for (const [typeId, room] of rooms) {
      const origin = positions[typeId];
      if (!origin || !(room > 0)) continue;
      const bound = MEMBER_SPREAD * room;
      for (const body of Object.keys(parts)) {
        if (body === typeId) continue;
        const anchor = positions[body];
        if (!anchor) continue;
        const dx = anchor.x - origin.x;
        const dy = anchor.y - origin.y;
        const d = Math.hypot(dx, dy);
        if (d >= bound) continue;
        // A node sitting exactly on the type has no direction of its own; the
        // drawing's own outward direction is as good an answer as there is.
        const push = room * (1 - d / bound);
        const ux = d > 0 ? dx / d : 0;
        const uy = d > 0 ? dy / d : -1;
        const mx = ux * push;
        const my = uy * push;
        for (const id of parts[body]) {
          positions[id] = { x: positions[id].x + mx, y: positions[id].y + my };
        }
      }
    }
  }

  /**
   * Attach a function/file after all classes are placed.
   * Prefer a class that uses this symbol (e.g. Query → freeze); else a class
   * this symbol uses; else closest class by hop to the root.
   */
  function attachSatelliteOwner(
    nodeId,
    graph,
    fullAdj,
    classIds,
    positions,
    dist,
    localCenter
  ) {
    // A class that contains this node owns it, before anything else is
    // considered. That is a type whose members the reader opened: a method
    // belongs beside the type it is a method of, and the rule below would hang
    // it off whatever it points at instead — `Scanner`, not the `Parser` it is
    // written on — which seats two types' methods in one another's places.
    // A file containing a function is not this case: a file is a unit, and no
    // unit is among the classes.
    const index = edgeIndex(graph);
    for (const e of index.incoming[nodeId] || NO_EDGES) {
      if (e.kind !== "contains" || !classIds.has(e.id)) continue;
      // Not yet placed: wait for it, as an unplaced class neighbour is waited
      // for below, rather than hanging the member somewhere else for good.
      return positions[e.id] ? e.id : null;
    }

    /** @type {string[]} */
    const positioned = [];
    let hasUnplacedClassNeighbor = false;
    for (const nb of fullAdj[nodeId] || []) {
      if (!classIds.has(nb)) continue;
      if (positions[nb]) positioned.push(nb);
      else hasUnplacedClassNeighbor = true;
    }
    if (!positioned.length) {
      if (hasUnplacedClassNeighbor) return null;
      return positions[localCenter] ? localCenter : null;
    }

    /** @type {Set<string>} */
    const consumers = new Set();
    /** @type {Set<string>} */
    const producers = new Set();
    const idx = edgeIndex(graph);
    for (const e of idx.incoming[nodeId] || NO_EDGES) {
      if (e.kind !== "uses") continue;
      if (classIds.has(e.id) && positions[e.id]) consumers.add(e.id);
    }
    for (const e of idx.outgoing[nodeId] || NO_EDGES) {
      if (e.kind !== "uses") continue;
      if (classIds.has(e.id) && positions[e.id]) producers.add(e.id);
    }

    /** @type {string[]} */
    let pool = positioned.filter((id) => consumers.has(id));
    if (!pool.length) pool = positioned.filter((id) => producers.has(id));
    if (!pool.length) pool = positioned.slice();

    pool.sort((a, b) => {
      const da = dist[a] !== undefined ? dist[a] : 9999;
      const db = dist[b] !== undefined ? dist[b] : 9999;
      if (da !== db) return da - db;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return pool[0];
  }

  /**
   * @param {string[]} ids
   * @param {Record<string, string[]>} adj
   * @returns {string[][]}
   */
  function connectedComponents(ids, adj) {
    const idSet = new Set(ids);
    const seen = new Set();
    /** @type {string[][]} */
    const comps = [];
    for (const start of [...ids].sort()) {
      if (seen.has(start)) continue;
      /** @type {string[]} */
      const comp = [];
      /** @type {string[]} */
      const q = [start];
      seen.add(start);
      while (q.length) {
        const u = q.shift();
        comp.push(u);
        for (const v of adj[u] || []) {
          if (idSet.has(v) && !seen.has(v)) {
            seen.add(v);
            q.push(v);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  /**
   * @param {string[]} unplacedIds
   * @param {{ nodes: any[]; edges: any[] }} graph
   * @param {Record<string, { id: string; kind: string; file: string; name: string }>} byId
   * @param {Record<string, string[]>} fullAdj
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {Record<string, number>} outwardAngles
   * @param {Set<string>} componentRoots
   */
  function placeSecondaryClassComponents(
    unplacedIds,
    graph,
    byId,
    fullAdj,
    positions,
    outwardAngles,
    componentRoots,
    blocks,
    groupOf,
    ringRadii,
    treeParent,
    bandOverflow
  ) {
    if (unplacedIds.length === 0) return;

    const comps = connectedComponents(unplacedIds, fullAdj);

    // Biggest group first, so the canvas reads in order of how much of the
    // project each disconnected island accounts for. Ties break on the smallest
    // member id to keep the arrangement stable across reopens.
    comps.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const am = a.slice().sort()[0];
      const bm = b.slice().sort()[0];
      return am < bm ? -1 : am > bm ? 1 : 0;
    });

    for (const comp of comps) {
      // A class whose only neighbours are functions belongs beside the function
      // that builds it, not at the head of a group of its own. Left in, such a
      // class would be made a component root — drawn as a marked centre, sitting
      // on its own among the isolated nodes — and by the time the helper pass
      // runs it would already have a position and be skipped.
      const classes = comp.filter(
        (id) =>
          isTreeVertex(graph, byId[id]) && !isFnOnlyHelperClass(id, graph, byId)
      );

      // Nothing to root on. Dropped here, a component would never be given a
      // position, and everything without one falls through to the cluster of
      // nodes that have no connection to anything. Two shapes arrive: a
      // component of only functions (`ctypes/macholib/dyld.py`, thirteen of
      // them calling each other), and one whose only class belongs beside a
      // function (`CurvesTurtle` and the `main` that uses it), filtered out
      // just above.
      //
      // The whole graph already knows the answer — "the highest-reaching class
      // where the graph has classes, otherwise the most-connected function or
      // file". A component is a graph, and the rule applies to it too: its own
      // members become its tree vertices, and only its own.
      //
      // Only for a component that touches nothing already drawn. These
      // components are cut from the nodes that have no position *yet*, and at
      // this point that includes every function waiting for the satellite
      // pass: a helper joined to a class in the main tree looks, for one
      // moment, exactly like an island. What tells them apart is whether
      // anything they touch is already on the board.
      const attached = comp.some((id) =>
        (fullAdj[id] || []).some((nb) => positions[nb])
      );
      // And only where there is a class in it to draw. A component that is
      // functions all the way down — `ctypes/macholib/dyld.py`, thirteen of
      // them calling each other — is a module's internals, not a piece of the
      // structure the drawing is about; it stays among the unconnected nodes.
      // What this places is a class with nowhere else to go because the only
      // thing holding it is a function.
      const anyClass = comp.some((id) => isTreeVertex(graph, byId[id]));
      const rootless = classes.length === 0 && !attached && anyClass;
      const alsoVertex = rootless ? new Set(comp) : undefined;
      // Still not the helper class itself. It is excluded above for a reason
      // that does not stop being true here — it belongs beside the function
      // that builds it, and making it the marked centre of a tree is the exact
      // thing that exclusion prevents. Without this, Django's `Trans` would
      // become the root of its own component instead of sitting beside the
      // function that uses it.
      const candidates = rootless
        ? comp.filter((id) => !isFnOnlyHelperClass(id, graph, byId))
        : classes;
      if (!candidates.length) continue;

      // Same criterion as the graph's own center, applied within the group.
      // Candidates exclude helpers for the same reason.
      const localCenter =
        pickCenterAmong(candidates, graph, alsoVertex) || candidates[0];

      // Every group is laid out about its own origin; `packBlocks` moves it.
      layoutOneClassComponent(
        graph,
        byId,
        fullAdj,
        comp,
        localCenter,
        0,
        0,
        positions,
        false,
        outwardAngles,
        componentRoots,
        ringRadii,
        alsoVertex,
        treeParent,
        bandOverflow
      );
      // Count what the block actually contributes to the picture, the same way
      // the primary block is counted. `comp` also holds functions and files, so
      // using its raw length would compare classes against everything.
      const placedIds = comp.filter((id) => positions[id]);
      for (const id of placedIds) groupOf[id] = localCenter;
      blocks.push({
        ids: placedIds,
        weight: placedIds.filter((id) => isTreeVertex(graph, byId[id], alsoVertex))
          .length,
        primary: false,
        root: localCenter,
      });
    }
  }

  /**
   * Arrange already-laid-out groups into rows.
   *
   * A single left-to-right row would turn the FastAPI graph into a 4400 x 1180
   * strip: fitting it to the viewport would shrink everything to a thin band
   * with nothing legible. Rows aimed at the viewport's own shape use the whole
   * canvas instead.
   *
   * Shelf packing rather than a real bin packer: a bin packer reorders blocks
   * to fill holes, which would destroy the largest-group-first reading order.
   * Worse density, and the arrangement still means something.
   *
   * @param {{ ids: string[]; weight: number }[]} blocks in reading order
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {number} [extraArea] area of blocks packed after this pass
   */
  function packBlocks(blocks, positions, extraArea) {
    /** @type {{ ids: string[]; minX: number; minY: number; maxX: number; maxY: number; w: number; contentMinY: number }[]} */
    const boxes = [];
    let totalArea = 0;
    let widest = 0;
    for (const block of blocks) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const id of block.ids) {
        const p = positions[id];
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (minX === Infinity) continue;

      // A group occupies its rings as well as its nodes.
      //
      // The rectangle above stops where the outermost nodes are; the drawing
      // puts a full circle at that radius all the way round. An outer ring is
      // often carried by one or two nodes, so the circle continues into space
      // the rectangle never claimed — 721px past the box on CPython. Without the
      // reservation, a group's orbits close over a small group packed beside it.
      //
      // Extending the box to hold the circle is what turns "fewer collisions"
      // into none: two disjoint rectangles hold two disjoint circles. Quantised
      // the same way `ringsByGroup` quantises, so the reservation and the
      // drawing cannot disagree about where the outermost ring is.
      // Before the rings grow the box: where this group's own nodes start and
      // end. The room it reserves is bigger than that in both directions and
      // the difference is where nothing is drawn.
      const contentMinY = minY;
      const contentMaxY = maxY;
      const rootPos = block.root ? positions[block.root] : null;
      if (rootPos) {
        let maxR = 0;
        for (const id of block.ids) {
          const p = positions[id];
          if (!p) continue;
          maxR = Math.max(maxR, Math.hypot(p.x - rootPos.x, p.y - rootPos.y));
        }
        const outer = Math.round(maxR / RING_QUANTUM) * RING_QUANTUM;
        // A group with no ring — a lone node — reserves exactly its nodes.
        if (outer >= RING_QUANTUM) {
          minX = Math.min(minX, rootPos.x - outer);
          maxX = Math.max(maxX, rootPos.x + outer);
          minY = Math.min(minY, rootPos.y - outer);
          maxY = Math.max(maxY, rootPos.y + outer);
        }
      }

      const w = maxX - minX;
      const h = maxY - minY;
      boxes.push({
        ids: block.ids,
        minX,
        minY,
        maxX,
        maxY,
        w,
        contentMinY,
        contentMaxY,
      });
      totalArea += (w + COMPONENT_GAP) * (h + COMPONENT_GAP);
      if (w > widest) widest = w;
    }
    if (boxes.length === 0) return undefined;

    // Derived from the actual content, not a fixed column count, so it holds
    // for one big group and for fifty small ones alike.
    const targetWidth = Math.max(
      widest,
      Math.sqrt((totalArea + (extraArea || 0)) * TARGET_ASPECT)
    );

    // A group goes where there is room for it, not where the last row ended.
    //
    // A row costs the height of its tallest member, so twenty small groups
    // beside one large one leave the whole height of the large one empty: on
    // CPython, rows would fill 55%, 16% and 15% of themselves and leave 58% of
    // the canvas empty. Filling the space beside a group instead brings the
    // drawing's height down to the primary tree's own height — every other
    // tree fits alongside it.
    //
    // What is given up is reading order. Boxes are still laid down largest
    // first, so the big ones take the low-left ground and the arrangement runs
    // broadly large to small, but a small group can sit above and to the
    // right of a larger one. That is the price of the room it fills.
    const sky = makeSkyline(targetWidth, COMPONENT_GAP);
    let first = true;
    let rightEdge = 0;
    for (const box of boxes) {
      const spot = sky.place(
        box.w,
        box.maxY - box.minY,
        box.contentMaxY - box.minY
      );
      const dx = spot.x - box.minX;
      const dy = spot.y - box.minY;
      if (dx !== 0 || dy !== 0) {
        for (const id of box.ids) {
          const p = positions[id];
          if (!p) continue;
          p.x += dx;
          p.y += dy;
        }
      }
      rightEdge = Math.max(rightEdge, spot.x + box.w);
      if (first) {
        first = false;
        // Nothing sits above the first group's first node.
        //
        // A group's box holds the whole circle its outermost ring draws, and
        // that circle reaches above every node on it — 387px above CPython's
        // topmost class, 299px above Django's. A small group placed flush with
        // the top of that box is in a band the drawing has nothing in, and it
        // reads as floating over the picture rather than beside it. So the
        // first group's own content decides where the top of the arrangement
        // is, and the room its rings need above that is left empty.
        const inset = box.contentMinY - box.minY;
        if (inset > 0) sky.floor(spot.y + inset);
      }
    }
    return {
      targetWidth,
      rightEdge,
      place: (w, h, contentH) => sky.place(w, h, contentH),
      placeSmallest: (w, h) => sky.placeSmallest(w, h, rightEdge),
    };
  }

  /**
   * Where to put the next box so that it sits as low as it can.
   *
   * The skyline is the profile of what has been placed: a list of x
   * breakpoints and the used height from each one until the next. A box is
   * tried with its left edge at every breakpoint and takes the lowest — ties
   * to the leftmost, which is what keeps the arrangement the same on every
   * reopen.
   *
   * @param {number} width the width to pack into
   * @param {number} gap clear space kept to the right of and below each box
   */
  function makeSkyline(width, gap) {
    // Two profiles over the same breakpoints. `ys` is the room the groups
    // reserve — their rings included — and is what keeps one group's circle
    // out of another's. `cs` is where the drawing actually ends, which on
    // CPython is 442px higher because the primary group's outermost ring
    // reaches well past its lowest node. A block with rings of its own has to
    // clear the first; the cluster of unconnected nodes has none and clears
    // the second, letting that ring pass behind it.
    /** Breakpoints. `ys[i]` / `cs[i]` hold from `xs[i]` until `xs[i + 1]`. */
    const xs = [0];
    const ys = [0];
    const cs = [0];

    const highestIn = (arr, x0, x1) => {
      let top = 0;
      for (let i = 0; i < xs.length; i++) {
        const end = i + 1 < xs.length ? xs[i + 1] : Infinity;
        if (end <= x0 || xs[i] >= x1) continue;
        if (arr[i] > top) top = arr[i];
      }
      return top;
    };
    const highest = (x0, x1) => highestIn(ys, x0, x1);

    const cut = (x) => {
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] === x) return;
        if (xs[i] > x) {
          xs.splice(i, 0, x);
          ys.splice(i, 0, ys[i - 1]);
          cs.splice(i, 0, cs[i - 1]);
          return;
        }
      }
      xs.push(x);
      ys.push(ys[ys.length - 1]);
      cs.push(cs[cs.length - 1]);
    };

    const raise = (x0, x1, y, content) => {
      cut(x0);
      cut(x1);
      for (let i = 0; i < xs.length; i++) {
        const end = i + 1 < xs.length ? xs[i + 1] : Infinity;
        if (xs[i] >= x0 && end <= x1) {
          ys[i] = y;
          cs[i] = content === undefined ? y : content;
        }
      }
      for (let i = xs.length - 1; i > 0; i--) {
        if (ys[i] === ys[i - 1] && cs[i] === cs[i - 1]) {
          xs.splice(i, 1);
          ys.splice(i, 1);
          cs.splice(i, 1);
        }
      }
    };

    return {
      /** Raise the whole profile to at least `y`, where it is lower. */
      floor(y) {
        for (let i = 0; i < ys.length; i++) if (ys[i] < y) ys[i] = y;
        for (let i = 0; i < cs.length; i++) if (cs[i] < y) cs[i] = y;
        for (let i = xs.length - 1; i > 0; i--) {
          if (ys[i] === ys[i - 1] && cs[i] === cs[i - 1]) {
            xs.splice(i, 1);
            ys.splice(i, 1);
            cs.splice(i, 1);
          }
        }
      },
      /**
       * The slot that leaves the drawing smallest.
       *
       * For a block the target width cannot hold: the target is a shape to aim
       * the arrangement at, not an edge the canvas has, so this one may run
       * past it. Taking the lowest slot instead would send it to the far right,
       * where nothing has been placed and the profile is therefore at the
       * floor — CPython's canvas would go to 14,465px wide for it. What the block
       * should do is fill the emptiest room, which is what minimising the
       * resulting box says.
       */
      placeSmallest(w, h, rightEdge) {
        const span = w + gap;
        const bottom = highestIn(cs, 0, Infinity);
        let bestX = 0;
        let bestY = 0;
        let bestCost = Infinity;
        // The breakpoints, plus the one position that is not a breakpoint and
        // matters: flush with the right edge. Without it a block that ties on
        // area sits at x = 0 and hangs off the left, past where the leftmost
        // group's own content starts.
        const candidates = xs.concat([Math.max(0, rightEdge - w)]);
        for (const x of candidates) {
          const y = highestIn(cs, x, x + span);
          const wide = Math.max(rightEdge, x + w);
          const tall = Math.max(bottom, y + h);
          // Scored by how large the drawing can be shown, not by how small it
          // is. Area is the wrong answer: on FastAPI
          // it puts this block underneath, at 1,715x2,276 against 3,000x1,530
          // beside — 18% less area, and a fifth less magnification in a 16:9
          // viewport, because a tall narrow drawing wastes the width. The cost
          // is what the viewport has to divide by, so a smaller one is a
          // bigger picture.
          const cost = Math.max(wide / TARGET_ASPECT, tall);
          // Ties go to the right. Two slots that show the drawing at the same
          // size are not equal to a reader: this is the block with nothing to
          // say about the structure, so it belongs away from the corner the
          // reader starts in. It also keeps the block from hanging off the
          // left, where a group's own content starts inset from the room it
          // reserves and the drawing would grow that way instead.
          if (cost < bestCost - 1e-6 || (cost <= bestCost + 1e-6 && x > bestX)) {
            bestCost = Math.min(bestCost, cost);
            bestX = x;
            bestY = y;
          }
        }
        raise(bestX, bestX + span, bestY + h + gap);
        return { x: bestX, y: bestY };
      },
      place(w, h, contentH) {
        const span = w + gap;
        let bestX = 0;
        let bestY = Infinity;
        for (const x of xs) {
          // A box wider than the target still has to go somewhere, and x = 0
          // is always allowed for exactly that.
          if (x !== 0 && x + w > width) continue;
          const y = highest(x, x + span);
          if (y < bestY) {
            bestY = y;
            bestX = x;
          }
        }
        if (!isFinite(bestY)) bestY = highest(0, span);
        raise(bestX, bestX + span, bestY + h + gap, bestY + contentH + gap);
        return { x: bestX, y: bestY };
      },
    };
  }

  /**
   * Drop the isolated-node grid into the next free shelf slot.
   *
   * It cannot join the main packing pass: leftovers are only known after
   * satellites have been placed, and satellites need their owners' final
   * positions. So the packer hands back where it stopped and the grid
   * continues from there.
   *
   * @param {string[]} ids
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {{ cursorX: number; baseline: number; bottom: number; targetWidth: number; nextRowTop: number } | undefined} shelf
   */
  /**
   * How far the isolated cluster sits from the drawing it is not part of.
   *
   * `COMPONENT_GAP` is sized to separate two *groups of connected classes*,
   * which are things a reader compares. This block is not one of those: it
   * only has to read as set apart, and a full `COMPONENT_GAP` of empty space
   * to say so is paid for by everything else shrinking: on a small drawing
   * such as TinyDB's, the opening fit would lose much of its zoom to a handful
   * of unconnected nodes, mostly to that gap rather than to the cluster.
   *
   * Twice the cluster's own row spacing, so the space between the drawing and
   * the cluster is unmistakably larger than the space inside it, which is the
   * whole job.
   */
  const UNLINKED_GAP = 2 * UNLINKED_SEP_Y;

  function placeGridBlock(ids, positions, shelf) {
    if (!ids.length || !shelf) return;
    const placed = new Set(ids);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const p = positions[id];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === Infinity) return;

    // The lowest room it fits in, and it may run past the target width to get
    // there.
    //
    // The target width is a shape to aim the *arrangement* at, not an edge the
    // canvas has. Held to it, this block — 5,701px wide on CPython against a
    // target of about 8,900 — could not stand beside the primary tree and would
    // fall to the only place left, underneath everything, leaving the whole
    // region right of the primary tree and below the small ones empty:
    // 4,234x2,683 of nothing, against the 5,701x1,572 looking for somewhere to go.
    const spot = shelf.placeSmallest(maxX - minX, maxY - minY);
    const dx = spot.x - minX;
    const dy = spot.y - minY;
    for (const id of ids) {
      const p = positions[id];
      if (!p) continue;
      p.x += dx;
      p.y += dy;
    }
  }

  /**
   * Place leftover nodes in a 10-column grid to the right of the main layout.
   * Wrap at 10 columns, and also start a new row when kind changes
   * (class → file → function).
   * @param {string[]} unlinkedIds
   * @param {Record<string, { kind: string; name: string }>} byId
   * @param {Record<string, { x: number; y: number }>} positions
   */
  function placeUnlinkedCluster(unlinkedIds, byId, positions, adj) {
    if (unlinkedIds.length === 0) return;

    // Two of these nodes can be joined to each other. Reaching this cluster
    // means having nothing that ties you to the *structure*; it says nothing
    // about ties within it. CPython's cluster holds 36 such pairs; placed
    // without regard to them, only one would be drawn within 200px, with a
    // median separation of 1,835px — a line
    // crossing the whole cluster to reach a node beside it in nothing but the
    // artifact.
    //
    // They take one slot between them, not one each. Ordering them adjacently
    // would not do it: the spiral turns by the golden angle, so slot `i` and
    // slot `i + 1` are 1,771px apart at i=100 while slot 155 is 98px away.
    // Sorting controls the index, and the index is not where a node is.
    /** @type {Map<string, string[]>} */
    const groupOfNode = new Map();
    /** @type {string[][]} */
    const clumps = [];
    if (adj) {
      const inCluster = new Set(unlinkedIds);
      const seen = new Set();
      for (const start of unlinkedIds.slice().sort()) {
        if (seen.has(start)) continue;
        const clump = [];
        const queue = [start];
        seen.add(start);
        while (queue.length) {
          const cur = queue.shift();
          clump.push(cur);
          for (const nb of adj[cur] || NO_EDGES) {
            if (!inCluster.has(nb) || seen.has(nb)) continue;
            seen.add(nb);
            queue.push(nb);
          }
        }
        clump.sort();
        clumps.push(clump);
        for (const id of clump) groupOfNode.set(id, clump);
      }
    } else {
      for (const id of unlinkedIds) {
        const solo = [id];
        clumps.push(solo);
        groupOfNode.set(id, solo);
      }
    }

    // A clump reads by its first member, so the kind-then-name arrangement is
    // unchanged for everything that is on its own — which is almost all of it.
    /** @type {Record<string, number>} */
    const kindOrder = { class: 0, file: 1, function: 2 };
    const rank = (id) => {
      const n = byId[id];
      const k = n && kindOrder[n.kind] !== undefined ? kindOrder[n.kind] : 9;
      return { k, s: (n && n.name) || id };
    };
    clumps.sort((a, b) => {
      const ra = rank(a[0]);
      const rb = rank(b[0]);
      if (ra.k !== rb.k) return ra.k - rb.k;
      return ra.s < rb.s ? -1 : ra.s > rb.s ? 1 : 0;
    });

    // Two discs, one above the other: what functions orbit, and the functions.
    //
    // One disc comes out 3.6 times wider than it is tall, because the spiral is
    // isotropic and the exclusion ellipse it is scaled by is that shape. At
    // that width it cannot stand beside a tree — CPython's is 5,701px against
    // trees 4,445 wide — so it falls underneath, and where it falls stops
    // being the same answer from one graph to the next: Django's would go below
    // and CPython's beside. Two stacked discs are 1.9:1, which fits beside the
    // trees on both.
    //
    // Split on kind rather than in half, because the ordering is a promise:
    // kind decides where a node sits, from the centre outward. Cut in half,
    // the first disc's middle could hold a function. Cut on kind, each disc
    // keeps that ordering inside it — class in the middle, then file — and the
    // discs themselves are in kind order too.
    const isFn = (id) => byId[id] && byId[id].kind === "function";
    const discs = [
      clumps.filter((c) => !isFn(c[0])),
      clumps.filter((c) => isFn(c[0])),
    ].filter((d) => d.length);

    // A clump takes one slot per member, not one slot between them.
    //
    // Fanning a clump inside a single slot works for a pair and fails for a
    // crowd: the members would sit on a circle of a fixed 21px radius whatever
    // their number, so twenty of them — `re/_properties.py`, a module of
    // functions calling each other and nothing else — would come out 6.6px apart
    // with bodies 28px across. CPython would hold 159 overlapping pairs that way,
    // in 8 clumps.
    //
    // So every node gets a slot of its own, and a clump's members take the
    // slots nearest their first. Slots are an exclusion ellipse apart by
    // construction, so nothing can overlap; and "nearest" is what keeps a
    // connected pair together, which is the whole reason clumps exist.
    const slotAt = (i) => {
      const r = UNLINKED_SPIRAL_SCALE * Math.sqrt(i + UNLINKED_SPIRAL_OFFSET);
      const angle = i * GOLDEN_ANGLE;
      return {
        x: r * Math.cos(angle) * UNLINKED_SEP_X,
        y: r * Math.sin(angle) * UNLINKED_SEP_Y,
      };
    };

    let cursorY = 0;
    for (const disc of discs) {
      let total = 0;
      for (const clump of disc) total += clump.length;
      const slots = [];
      for (let i = 0; i < total; i++) slots.push({ ...slotAt(i), free: true });

      // Clumps before singletons. Slots are claimed in order, and a clump
      // that comes late finds only the leftovers scattered across the disc —
      // 55 connected pairs would end more than 200px apart that way. A singleton
      // has nothing to be near, so it is the one that can take what is left.
      // Within each half the kind-then-name order is unchanged.
      const ordered = disc
        .filter((c) => c.length > 1)
        .concat(disc.filter((c) => c.length === 1));

      const drawn = [];
      let next = 0;
      for (const clump of ordered) {
        while (next < slots.length && !slots[next].free) next++;
        const anchor = slots[next];
        anchor.free = false;
        positions[clump[0]] = { x: anchor.x, y: anchor.y };
        drawn.push(clump[0]);
        for (let m = 1; m < clump.length; m++) {
          let best = -1;
          let bestD = Infinity;
          for (let s = 0; s < slots.length; s++) {
            if (!slots[s].free) continue;
            const d = Math.hypot(slots[s].x - anchor.x, slots[s].y - anchor.y);
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
          if (best === -1) break;
          slots[best].free = false;
          positions[clump[m]] = { x: slots[best].x, y: slots[best].y };
          drawn.push(clump[m]);
        }
      }
      if (!drawn.length) continue;
      let top = Infinity;
      let bottom = -Infinity;
      for (const id of drawn) {
        const y = positions[id].y;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
      const dy = cursorY - top;
      for (const id of drawn) positions[id].y += dy;
      cursorY += bottom - top + UNLINKED_GAP;
    }
  }

  /**
   * The radii the layout actually placed tree vertices at, per group.
   *
   * Derived rather than recorded: `computeClassRingPositions` already returns
   * everything needed, and asking it to also report its ring steps would mean
   * two places that have to agree about what a ring is. Satellites are
   * excluded — they orbit their parent class at `SAT_RADIUS`, so their
   * distance from the group's center is not a ring and drawing it would
   * invent structure that is not there.
   *
   * Pure: no `cy`, no DOM. This is the part of the ring work the harness can
   * test properly, so as much of the thinking as possible lives here.
   *
   * @param {Record<string, {x: number, y: number}>} positions
   * @param {Record<string, string>} groupOf node id -> its group's root id
   * @param {(id: string) => boolean} isVertex
   * @returns {{cx: number, cy: number, radii: number[]}[]}
   */
  /**
   * The circles to draw around each group.
   *
   * A ring marks a level of the tree, so the radii come from the placement that
   * made those levels rather than from measuring where nodes ended up. The two
   * agree for a node the tree placed and disagree for every other — a satellite
   * sits where its owner is, a helper class beside the function that produces
   * it, an unconnected node wherever the packing put it. Measuring would draw a
   * circle at each of those: CPython's outer edge would become a band of 112
   * rings, 89 of them under 30px apart, reaching 7042px where the tree ends at
   * 1899.
   *
   * There is nothing to quantise here either. Reconstruction would have to,
   * because two vertices on one level differ in the last bits after the
   * angular arithmetic — enough to draw `1898` and `1900` as two rings for
   * one level.
   *
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {Map<string, Set<number>>} ringRadii radii per component root
   */
  /**
   * A ring marks a level of a class tree, so a tree with no class at its root
   * marks none.
   *
   * Those are the components that have no class to root on — a module of
   * functions calling each other — and their root is hidden in the default
   * view, which would leave a faint circle drawn around nothing: 46 of them on
   * CPython, the largest 558px across. The rule is on the root's kind rather
   * than on what is currently shown, so the rings are the same set whether
   * functions are visible or not.
   */
  function ringsByGroup(positions, ringRadii, graph, componentRoots) {
    const out = [];
    if (!ringRadii) return out;
    const byId = {};
    if (graph) for (const n of graph.nodes) byId[n.id] = n;
    for (const [root, radii] of ringRadii) {
      const origin = positions[root];
      if (!origin) continue;
      if (graph && !isTreeVertex(graph, byId[root])) continue;
      const list = [...radii].filter((r) => r > 0).sort((a, b) => a - b);
      if (!list.length) continue;
      out.push({ cx: origin.x, cy: origin.y, radii: list });
    }
    return out;
  }

  /**
   * World -> screen, the same mapping cytoscape's renderer uses. Taken as
   * plain numbers rather than read off `cy` so the PNG export can call the
   * ring drawing with its own transform instead of the screen's.
   */
  function ringScreenGeometry(group, view) {
    return {
      x: group.cx * view.zoom + view.panX,
      y: group.cy * view.zoom + view.panY,
      radii: group.radii.map((r) => r * view.zoom),
    };
  }

  /**
   * Where each star layer's tile sits for a given pan, in screen pixels.
   *
   * The star field translates with the pan but is deliberately NOT scaled by
   * the zoom. Scaling a photographic texture across the zoom range this viewer
   * allows turns it into either moiré or blur, and stars that hold their size
   * while the drawing grows is what "very far away" looks like. Translating is
   * the part that matters: a backdrop that stays put while the graph slides
   * over it reads as a separate picture behind glass.
   *
   * Two layers at different scales and phases, because a single 1600px tile
   * repeats visibly once you pan more than a screen. Their periods do not line
   * up, so the combined pattern takes far longer to repeat than either.
   */
  function starLayerOffsets(view) {
    const zoom = view.zoom > 0 ? view.zoom : 1;
    return (view.layers || STAR_LAYERS).map((layer) => {
      // One number, two consequences: `zoom ** depth` keeps the size response
      // in step with the pan response, so a layer cannot read as near when
      // panning and far when zooming. Floored, see STAR_MIN_TILE_SCALE.
      const s = Math.max(
        STAR_MIN_TILE_SCALE,
        layer.scale * Math.pow(zoom, layer.depth)
      );
      // Rounded to whole pixels, both the size and the offset. A tile drawn at
      // a fractional size or a fractional position is resampled differently on
      // every repeat, so a field that looks like one texture repeated is, in
      // the pixels, thousands of slightly different textures. That is
      // invisible on screen and expensive in an exported PNG, where the
      // repetition is the only thing a lossless format could have exploited —
      // measured at 37% of the background's size on a 4000 x 2400 canvas.
      // It also renders the stars a little crisper.
      const w = Math.max(1, Math.round(view.tileWidth * s));
      const h = Math.max(1, Math.round(view.tileHeight * s));
      // Modulo keeps the numbers small however far the user has panned;
      // without it a long pan eventually loses precision in the transform.
      const mod = (v, m) => ((v % m) + m) % m;
      return {
        depth: layer.depth,
        scale: s,
        alpha: layer.alpha,
        width: w,
        height: h,
        x: Math.round(mod(view.panX * layer.depth + layer.phaseX, w)) - w,
        y: Math.round(mod(view.panY * layer.depth + layer.phaseY, h)) - h,
      };
    });
  }

  /**
   * Paint the star field for one transform. Split from `drawRings` only so
   * each can be reasoned about alone; `drawSpace` is what callers use.
   */
  function drawStarfield(ctx, tile, view) {
    if (!ctx || !tile) return 0;
    let drawn = 0;
    // Additive, so a star in one layer never dims a star in another. The tile
    // ships with its background floored to black precisely so this does not
    // also stack three copies of a grey haze on top of the void.
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const layer of starLayerOffsets(view)) {
      ctx.globalAlpha = layer.alpha;
      for (let x = layer.x; x < view.width; x += layer.width) {
        for (let y = layer.y; y < view.height; y += layer.height) {
          ctx.drawImage(tile, x, y, layer.width, layer.height);
          drawn += 1;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previous;
    return drawn;
  }

  /**
   * Draw the rings for one transform. `view` is `{zoom, panX, panY, width,
   * height}` — never read from `cy` in here, because the export passes its own.
   * A no-op without a context, which is what the headless harness has.
   */
  function drawRings(ctx, groups, view) {
    if (!ctx) return 0;
    ctx.lineWidth = RING_LINE_WIDTH;
    ctx.strokeStyle = RING_STROKE;
    let drawn = 0;
    for (const group of groups) {
      const g = ringScreenGeometry(group, view);
      for (const r of g.radii) {
        // Cull two ways. A ring smaller than a node is noise rather than
        // structure; a ring whose band misses the viewport entirely costs a
        // full arc for nothing, and on a deep tree there are many of those.
        if (r < NODE_DIAMETER) continue;
        const nearest = Math.hypot(
          Math.max(0, Math.abs(g.x - view.width / 2) - view.width / 2),
          Math.max(0, Math.abs(g.y - view.height / 2) - view.height / 2)
        );
        const farthest =
          Math.hypot(
            Math.abs(g.x - view.width / 2) + view.width / 2,
            Math.abs(g.y - view.height / 2) + view.height / 2
          );
        if (r < nearest || r > farthest) continue;
        ctx.beginPath();
        ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.stroke();
        drawn += 1;
      }
    }
    return drawn;
  }

  /**
   * Everything behind the graph, for one transform: void, stars, rings, in
   * that order. This is the single function the live canvas and the PNG export
   * both call — the export differs only in the `view` it passes.
   */
  function drawSpace(ctx, view) {
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = cssVar("--space-deep", "#05070B");
    ctx.fillRect(0, 0, view.width, view.height);
    drawStarfield(ctx, starfieldImage, view);
    drawRings(ctx, ringGroups, view);
    ctx.restore();
  }

  /** The live canvas. Sizes itself to the container and to device pixels. */
  function paintSpace() {
    if (!cy || !spaceEl || typeof spaceEl.getContext !== "function") return;
    const w = cy.width();
    const h = cy.height();
    if (!w || !h) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    if (spaceEl.width !== Math.round(w * dpr) || spaceEl.height !== Math.round(h * dpr)) {
      spaceEl.width = Math.round(w * dpr);
      spaceEl.height = Math.round(h * dpr);
      spaceEl.style.width = w + "px";
      spaceEl.style.height = h + "px";
    }
    const ctx = spaceEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pan = cy.pan();
    drawSpace(ctx, {
      zoom: cy.zoom(),
      panX: pan.x,
      panY: pan.y,
      width: w,
      height: h,
      tileWidth: (starfieldImage && starfieldImage.width) || STAR_TILE_FALLBACK,
      tileHeight: (starfieldImage && starfieldImage.height) || STAR_TILE_FALLBACK,
    });
  }

  /**
   * The star tile, once. Loaded from the URI the extension host resolved onto
   * the canvas element, because a webview URI cannot be written by hand and a
   * relative path would resolve against the document, not against media/.
   */
  let starfieldImage = null;

  /**
   * How long the panel will wait for the tile before opening without it.
   *
   * The wait exists so the star field is not seen arriving after everything
   * else. The cap exists because a request that neither loads nor fails would
   * otherwise hold the panel blank forever, and a starless open beats that.
   */
  const STARFIELD_WAIT_MS = 2000;
  let starfieldSettled = false;
  /** Loaded, failed, or waited long enough — the tile is no longer pending. */
  function settleStarfield() {
    if (starfieldSettled) return;
    starfieldSettled = true;
    revealWhenReady();
  }

  function loadStarfield() {
    if (!spaceEl || typeof spaceEl.getAttribute !== "function") {
      settleStarfield();
      return;
    }
    const src = spaceEl.getAttribute("data-starfield");
    if (!src || typeof Image !== "function") {
      settleStarfield();
      return;
    }
    const img = new Image();
    img.onload = () => {
      starfieldImage = img;
      paintSpace();
      settleStarfield();
    };
    img.onerror = () => settleStarfield();
    // Armed before the src is assigned: a cached tile can load synchronously,
    // and a timer set afterwards would be one nobody needs.
    if (typeof setTimeout === "function") {
      setTimeout(settleStarfield, STARFIELD_WAIT_MS);
    }
    img.src = src;
  }

  /**
   * What the last layout decided, kept for elements built after it ran.
   *
   * The drawing holds only what has been drawn, so a node turned on later
   * arrives with no position, no draw order and no idea whether it is a
   * satellite. Everything it needs was computed for the whole artifact — it
   * just was not there to receive it.
   *
   * @type {{ positions: Record<string, {x:number;y:number}>;
   *          drawOrder: Record<string, number>;
   *          satelliteOwner: Record<string, string>;
   *          structural: Set<string> } | null}
   */
  let lastLayout = null;

  /**
   * Give elements what the layout decided about them.
   *
   * The layout calls this over everything and growth calls it over what it has
   * just built, so the two cannot drift: there is one description of what a
   * drawn element looks like, and both go through it.
   */
  function dressElements(els, layout) {
    els.nodes().forEach((node) => {
      node.grabbable(false);
      const pos = layout.positions[node.id()];
      if (pos) node.position(pos);
      node.data("z", layout.drawOrder[node.id()] || 0);
      // Size follows the layout, so it is set here and nowhere else. A node
      // that stopped being a satellite between two layouts has to stop
      // being drawn as one, which is why this clears as well as sets.
      node.toggleClass("satellite", !!layout.satelliteOwner[node.id()]);
    });
    els.edges().forEach((edge) => {
      const key = edge.source().id() + "\u0000" + edge.target().id();
      edge.toggleClass("crossing", !layout.structural.has(key));
    });
  }

  /**
   * Build whatever `want` names and the drawing does not have yet.
   *
   * Elements are added and never removed, so the drawing holds everything that
   * has ever been visible rather than exactly what is visible now. That is
   * what lets every place that looks an id up — the comment box, the focus,
   * the framing, the centre marks — go on assuming a node it can see is there.
   */
  function growCy(want) {
    if (!cy || !fullGraph || !want) return false;
    const have = new Set();
    cy.nodes().forEach((n) => have.add(n.id()));
    let missing = false;
    for (const id of want) {
      if (!have.has(id)) {
        missing = true;
        break;
      }
    }
    // Every node the right button's view shows can already be built while the
    // edges between the two trees are not: they were left out of the whole
    // drawing. The view needs them.
    if (!missing && reachRoot) {
      const units = unitsOf(fullGraph);
      fullGraph.edges.forEach((e, i) => {
        if (missing || !crossesTrees(e, units) || !want.has(e.from) || !want.has(e.to)) return;
        if (cy.getElementById(`e${i}-${e.from}-${e.to}-${e.kind}`).empty()) missing = true;
      });
    }
    if (!missing) return false;

    for (const id of want) have.add(id);
    const fresh = buildElements(fullGraph, have).filter((el) =>
      cy.getElementById(el.data.id).empty()
    );
    if (!fresh.length) return false;
    cy.batch(() => {
      const added = cy.add(fresh);
      if (lastLayout) dressElements(added, lastLayout);
    });
    return true;
  }

  function applyFixedClassRingLayout(visible, keepView) {
    if (!cy || !fullGraph || !centerClassId) return;

    // Laid out from the artifact, not from what is drawn.
    //
    // Computing positions from the visible set would let a hidden node reserve
    // no space, and that costs more than it buys: a class whose only neighbours
    // are functions has no visible edge at all while they are hidden, so it
    // would count as unconnected and be exiled to the grid — on CPython, 117 of
    // them a median of 6,256px from the nearest thing they relate to. Reserving
    // room for hidden satellites is cheaper than that: the default view comes
    // out 7,971×5,638 rather than 9,459×7,869, with the same median
    // nearest-neighbour distance.
    //
    // Groups are still folded — a group and its members are different nodes,
    // and only the group is ever drawn — but nothing else narrows this set, so
    // it does not change when a kind is toggled and neither do the positions.
    const layoutIds = layoutIdSet();
    const drawn = layoutGraph(layoutIds);
    const {
      positions,
      componentRoots,
      groupOf,
      satelliteOwner,
      ringRadii,
      treeParent,
      rootWidth,
    } = computeClassRingPositions(drawn, visibleCenter(), layoutIds, {
      bandOverflow,
      rootSector: reachRoot ? REACH_FAN : undefined,
    });
    reachOpening = reachRoot ? rootWidth : null;

    // Which edges build the drawing, and which only cross it.
    //
    // An edge from a node to the thing the layout hung it off — its parent in
    // the tree, or the node it orbits — is why it is where it is. Every other
    // edge is a relationship that the arrangement could not honour with
    // position, and on CPython there are thousands of them: drawn at the same
    // weight they read as a haze over the middle of the tree with the
    // structure lost inside it.
    /** @type {Set<string>} */
    const structural = new Set();
    for (const [id, p] of Object.entries(treeParent || {})) {
      structural.add(id + "\u0000" + p);
      structural.add(p + "\u0000" + id);
    }
    for (const [id, owner] of Object.entries(satelliteOwner || {})) {
      structural.add(id + "\u0000" + owner);
      structural.add(owner + "\u0000" + id);
    }
    const visibleIds = visible || visibleIdSet();
    centerIds = componentRoots;
    nodeGroups = groupOf;
    ringGroups = ringsByGroup(positions, ringRadii, drawn, componentRoots);
    const drawOrder = satelliteDrawOrder(positions, satelliteOwner);
    // Labels follow what is *drawn*, which is a different set from what is
    // laid out, and this is the one place that distinction goes the other way.
    //
    // Positions come from the artifact because where a class belongs is a fact
    // about the code that hiding a kind cannot alter. A label is not that: a
    // disambiguating path is there to be read, and there is nothing to tell
    // apart from a node that is not on screen. So a class does not carry
    // `configparser/Error` because of an `Error` nobody can see.
    applyLabels(visibleIds);
    lastLayout = { positions, drawOrder, satelliteOwner: satelliteOwner || {}, structural };
    cy.batch(() => {
      dressElements(cy.elements(), lastLayout);
    });
    // Framing deliberately does NOT happen here. Done here, it would come *before*
    // `markCenter()` has run, so the opening view would be framed against a
    // bounding box taken before the center class is on, and the opening frame
    // and the first Reset would be taken on different drawings. `applyView`
    // frames after the classes are on.
  }

  /**
   * Which of two overlapping bodies is drawn on top.
   *
   * A crowded ring overlaps — that is the accepted cost of not letting the
   * ring grow — but *how* it overlaps is a free choice, and it is the whole
   * difference between a mess and a pattern. Left to whatever order the
   * nodes happen to be in, each body is covered from a different side and
   * the ring reads as a jumble. Ordered by angle, every body is covered from
   * the same side and the ring reads as overlapping scales.
   *
   * Cytoscape draws each element complete — body and label together — in
   * z-order, so this settles the labels as well, which is where most of the
   * mess actually is.
   *
   * The order starts on the inward side, so the single seam — where the last
   * body covers the first instead of the other way round — falls behind the
   * owner rather than on the face being read.
   *
   * @param {Record<string, { x: number; y: number }>} positions
   * @param {Record<string, string>} satelliteOwner
   * @returns {Record<string, number>}
   */
  function satelliteDrawOrder(positions, satelliteOwner) {
    /** @type {Record<string, number>} */
    const z = {};
    const TAU = 2 * Math.PI;
    for (const id of Object.keys(positions)) {
      const owner = satelliteOwner[id];
      if (!owner || !positions[owner]) {
        // Tree vertices above every satellite: a class is never the thing
        // that gets covered.
        z[id] = Z_VERTEX;
        continue;
      }
      const p = positions[id];
      const op = positions[owner];
      const outward = Math.atan2(op.y, op.x);
      const here = Math.atan2(p.y - op.y, p.x - op.x);
      let rel = (here - (outward + Math.PI)) % TAU;
      if (rel < 0) rel += TAU;
      z[id] = Math.round((rel / TAU) * Z_SATELLITE_SPAN);
    }
    return z;
  }

  /** Emphasis is presentation only: it never adds or removes visible nodes. */
  function clearEmphasis() {
    if (!cy) return;
    cy.elements().removeClass(EMPHASIS_CLASSES);
  }

  /**
   * Emphasize the focus node and everything within EMPHASIS_HOPS undirected hops;
   * dim the rest. An edge is emphasized only when both endpoints are.
   */
  function applyEmphasis() {
    if (!cy || !fullGraph) return;
    if (!focusId || cy.getElementById(focusId).empty()) {
      clearEmphasis();
      return;
    }
    const near = hopDistances(undirectedAdj(fullGraph), focusId, EMPHASIS_HOPS);
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        node.removeClass(EMPHASIS_CLASSES);
        const d = near[node.id()];
        node.addClass(d === undefined ? "dimmed" : `hop-${d}`);
      });
      cy.edges().forEach((edge) => {
        edge.removeClass(EMPHASIS_CLASSES);
        const bothNear =
          near[edge.data("source")] !== undefined &&
          near[edge.data("target")] !== undefined;
        // An edge that touches the focus is drawn at full strength, whatever
        // faded it. A line the arrangement did not use is drawn at 0.18,
        // because those are 60% of the lines and at full strength they read as
        // the structure — but that answers a question about the whole picture,
        // and a click asks about one node. Without this, on prometheus, clicking
        // `Labels` would leave 78 of its 169 edges at 0.18 while the nodes at their
        // far ends are lit: a lit node, a lit neighbour, and nothing drawn
        // between them.
        //
        // `edge.hop-1` is declared after the fading rule in the stylesheet, so it
        // wins over it. Nothing else is
        // needed for the way back: `EMPHASIS_CLASSES` is removed above and by
        // `clearEmphasis`, so every path that moves or clears the focus
        // restores these lines.
        const touchesFocus =
          edge.data("source") === focusId || edge.data("target") === focusId;
        if (!bothNear) edge.addClass("dimmed");
        else if (touchesFocus) edge.addClass("hop-1");
      });
    });
  }

  /**
   * Focus one node exactly as a first click would: the node this shares with
   * the tap handler is which node counts as "focused", not how the camera
   * moves — search moves the camera separately, a first click does not move
   * it at all.
   */
  /**
   * The comment above the focused node's definition, asked for on focus.
   *
   * Only the host can read a file, so this is a request and a reply, and the
   * reply can arrive after the focus has moved on. What comes back is checked
   * against what is focused *now*, never against what was focused when it was
   * asked — the failure that would cause is one node's comment shown under
   * another node's name, which looks exactly like a correct answer.
   */
  function requestComment(id, mark) {
    showComment(null, null);
    if (!cy) return;
    // A group has as many comments as it has members and no reason to prefer
    // one, so it asks for none. It carries no location precisely so that every
    // path treating an id as a place in the source stops here.
    if (isGroupId(id)) {
      showMembers(id);
      showsMembers = true;
      return;
    }
    const node = cy.getElementById(id);
    if (node.empty()) return;
    // Listed before the host answers, and kept when it does.
    showsMembers = showNodeMembers(id, mark);
    const file = node.data("file");
    if (!file) return;
    vscode.postMessage({
      command: "getComment",
      id,
      file,
      line: node.data("line") || 1,
    });
  }

  /**
   * How much of every file path is the project root, so the member list can
   * drop it. Computed from the whole graph rather than per group, so two
   * groups' rows are read against the same origin.
   */
  let filePrefixLength = 0;
  function computeFilePrefix(nodes) {
    let prefix = null;
    for (const n of nodes) {
      if (!n.file) continue;
      if (prefix === null) {
        prefix = n.file;
        continue;
      }
      let i = 0;
      while (i < prefix.length && i < n.file.length && prefix[i] === n.file[i]) i++;
      prefix = prefix.slice(0, i);
      if (!prefix) break;
    }
    // Back up to a separator: half a directory name is worse than the whole.
    if (prefix) {
      const cut = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));
      prefix = cut >= 0 ? prefix.slice(0, cut + 1) : "";
    }
    filePrefixLength = prefix ? prefix.length : 0;
  }

  /**
   * A group's members, in the panel a comment would have used.
   *
   * This is the only route from the drawing to any one of the classes a group
   * stands for: the group has no location of its own, so its second activation
   * has nothing to open. Each row does have one.
   */
  function showMembers(groupId) {
    if (!commentEl || !commentMembersEl) return;
    const group = groupsById[groupId];
    if (!group) return;
    const byId = {};
    for (const n of fullGraph ? fullGraph.nodes : []) byId[n.id] = n;
    const rows = group.members
      .map((id) => byId[id])
      .filter(Boolean)
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map((n) => ({ label: n.file.slice(filePrefixLength) || n.file, title: n.file, file: n.file, line: n.line }));
    listRows(`${group.name} ×${group.members.length}`, rows, { clearBody: true });
    // A group stands for several types, so there is no one type to act on.
    panelTypeId = null;
    syncTypeButtons();
  }

  /**
   * The members a node records, listed beside the drawing.
   *
   * A method is not a node and can be reached no other way. Listed under the
   * node's own name, because that is what the reader clicked, and beside
   * whatever comment the node has rather than instead of it.
   */
  function showNodeMembers(id, mark) {
    const node = cy ? cy.getElementById(id) : null;
    if (!node || node.empty()) return false;
    const members = node.data("members") || [];
    if (!members.length) return false;
    const name = node.data("label") || node.data("name") || "";
    listRows(
      name,
      members.map((m) => ({ label: m.name, title: `${m.file}:${m.line}`, file: m.file, line: m.line })),
      { clearBody: false, mark }
    );
    panelTypeId = id;
    syncTypeButtons();
    return true;
  }

  /** The node whose members the panel lists, which its two buttons act on. */
  let panelTypeId = null;

  /** Whether the drawing can open this node where it stands, now. */
  function canExpand(id) {
    // Not from inside a view: the view of one type alone already is its
    // members, and the right button's view is a question about the drawing
    // as it was when it was asked.
    if (!id || insideOf || reachRoot || isGroupId(id) || !artifactGraph) return false;
    const node = artifactGraph.nodes.find((n) => n.id === id);
    return !!node && hasSomethingInside(node.members);
  }

  /** Whether this node's members can be drawn alone, now. */
  function canShowOnly(id) {
    if (!id || insideOf || isGroupId(id) || !artifactGraph) return false;
    const node = artifactGraph.nodes.find((n) => n.id === id);
    return !!node && isMadeOfMembers(node.members);
  }

  /**
   * The two buttons beside the panel's title: shown where there is something
   * for them to draw, and the first pressed while its type is open — a toggle,
   * as the rail's are, rather than a label that changes its words.
   */
  function syncTypeButtons() {
    const id = panelTypeId;
    if (commentExpandEl) {
      const shown = canExpand(id);
      commentExpandEl.classList.toggle("hidden", !shown);
      const open = shown && openTypes.includes(id);
      commentExpandEl.setAttribute("aria-pressed", open ? "true" : "false");
      commentExpandEl.title = open ? "Collapse members (E)" : "Expand members (E)";
      commentExpandEl.setAttribute("aria-label", open ? "Collapse members" : "Expand members");
    }
    if (commentOnlyEl) commentOnlyEl.classList.toggle("hidden", !canShowOnly(id));
  }

  /** Open a type where it stands, or put it away if it is open. */
  function toggleExpand(id) {
    if (!canExpand(id)) return false;
    const done = openTypes.includes(id) ? closeHere(id) : openHere(id);
    syncTypeButtons();
    return done;
  }

  /** Draw a type's members alone. */
  function showOnly(id) {
    if (!canShowOnly(id)) return false;
    return openInside(id);
  }

  /**
   * One list, one row shape: a label, where it is, and what to open.
   * @param {string} title
   * @param {{ label: string; title: string; file: string; line: number }[]} rows
   */
  function listRows(title, rows, opts) {
    if (!commentEl || !commentMembersEl) return;
    if (legendEl) setLegendOpen(false);
    if (opts && opts.clearBody && commentBodyEl) commentBodyEl.textContent = "";
    if (commentTitleEl) commentTitleEl.textContent = title;
    const items = rows.map((n) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.textContent = n.label;
      li.title = n.title;
      const jump = () => {
        vscode.postMessage({ command: "jumpTo", file: n.file, line: n.line || 1 });
      };
      li.addEventListener("click", jump);
      li.addEventListener("keydown", (event) => {
        if (event && (event.key === "Enter" || event.key === " ")) {
          if (event.preventDefault) event.preventDefault();
          jump();
        }
      });
      // The row the reader was brought here for. A type may record scores of
      // members — sqlparser-ranger's `Parser` records 69 — and taking a reader
      // to the type without saying which row was found hands them a haystack.
      if (opts && opts.mark && opts.mark.file === n.file && (opts.mark.line || 1) === (n.line || 1)) {
        li.classList.add("picked");
        if (li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
      }
      return li;
    });
    commentMembersEl.replaceChildren(...items);
    commentMembersEl.classList.remove("hidden");
    commentEl.classList.remove("hidden");
  }

  /** Nothing to show means nothing shown — no empty frame, no leftover. */
  function showComment(id, lines) {
    if (!commentEl) return;
    // The member list shares this panel, so a focus change clearing it has to
    // take the list down with it — but not a comment arriving for the node
    // whose members are listed, which has both and shows both.
    if (commentMembersEl && !(id && focusId === id && showsMembers)) {
      commentMembersEl.replaceChildren();
      commentMembersEl.classList.add("hidden");
      showsMembers = false;
      // The buttons belong to the list: gone with it.
      panelTypeId = null;
      syncTypeButtons();
    }
    const has = !!id && Array.isArray(lines) && lines.length > 0;
    commentEl.classList.toggle("hidden", !has);
    if (!has) {
      if (commentBodyEl) commentBodyEl.textContent = "";
      if (commentTitleEl) commentTitleEl.textContent = "";
      return;
    }
    // One corner, one panel.
    if (legendEl) setLegendOpen(false);
    const node = cy ? cy.getElementById(id) : null;
    if (commentTitleEl) {
      commentTitleEl.textContent =
        node && node.nonempty() ? node.data("label") || "" : "";
    }
    if (commentBodyEl) commentBodyEl.textContent = lines.join("\n");
  }

  /**
   * Let go of the focused node: the emphasis, the pending second activation,
   * and the comment that was opened for it.
   *
   * Clicking away is one way to arrive here. Naming a centre is the other:
   * that press is the end of what the reader was doing with that node, and
   * leaving it lit afterwards says the node is still the subject of the next
   * keystroke when what it has become is the subject of the drawing.
   */
  function clearFocus() {
    focusId = null;
    pendingJumpId = null;
    if (cy) cy.nodes().removeClass("focused");
    clearEmphasis();
    clearSearchHighlight();
    showComment(null, null);
  }

  function activateFocus(id, mark) {
    if (!cy) return;
    const node = cy.getElementById(id);
    if (node.empty()) return;
    focusId = id;
    pendingJumpId = id;
    cy.nodes().removeClass("focused");
    node.addClass("focused");
    // A live search's spotlight is declared after this emphasis in the
    // stylesheet, so it would keep overriding it otherwise — whether this
    // focus came from choosing a search result or from clicking a node while
    // a search was still live.
    clearSearchHighlight();
    applyEmphasis();
    requestComment(id, mark);
  }

  /**
   * Spotlight the nodes a live search has matched and dim everything else, as
   * the user types — narrower with every character rather than waiting for
   * Enter. Deliberately a separate class pair from `hop-0`/`hop-1`/`dimmed`:
   * those track a clicked focus and its neighbourhood, this tracks typed text,
   * and neither should have to know the other exists. `search-hit`/`-miss` are
   * declared after every other emphasis rule in the stylesheet, so they win
   * over whatever focus state was already showing while the search is live,
   * and `clearSearchHighlight` hands the picture straight back unmodified.
   *
   * @param {Set<string>} matchIds
   */
  function applySearchHighlight(matchIds) {
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const hit = matchIds.has(node.id());
        node.toggleClass("search-hit", hit);
        node.toggleClass("search-miss", !hit);
      });
      cy.edges().forEach((edge) => {
        const bothHit =
          matchIds.has(edge.data("source")) && matchIds.has(edge.data("target"));
        edge.toggleClass("search-hit", bothHit);
        edge.toggleClass("search-miss", !bothHit);
      });
    });
  }

  function clearSearchHighlight() {
    if (!cy) return;
    cy.elements().removeClass("search-hit search-miss");
  }

  /**
   * Ids the toolbar toggles leave on screen.
   *
   * Hiding every node would leave a blank canvas, so a project written entirely
   * as functions keeps them: there is nothing else to draw.
   */
  /**
   * Whether a node is drawn at all, before the kind toggle has its say.
   *
   * A group's members never are. There is no expansion: the gesture a reader
   * actually reaches for — activating the node — gives the member list. And
   * with no expansion nothing changes which nodes exist after the artifact is
   * read, so the layout is computed once and a visibility toggle is only a
   * toggle.
   */
  function isFoldedAway(id) {
    return !!memberGroupOf[id];
  }

  /**
   * The centre as it is drawn.
   *
   * `centerClassId` names a class in the artifact. When that class is folded
   * into a group, the group is what stands in its place.
   */
  function visibleCenter() {
    // While the right button's view is open its node is the subject: the
    // layout is rooted on it, it is marked as the centre, and Reset view
    // returns to it. This is the one place all three read.
    if (reachRoot) return reachRoot;
    if (!centerClassId) return centerClassId;
    return memberGroupOf[centerClassId] || centerClassId;
  }

  /**
   * Every node the layout places: the artifact with each group folded to its
   * one node. It does not depend on which kinds are shown, which is the whole
   * of this rule — hiding functions hides the functions.
   */
  function layoutIdSet() {
    if (!fullGraph) return new Set();
    // Narrowed by the right button's view, and it has to be here and not only
    // in what is shown: positions are computed from this set, which ignores
    // visibility on purpose, so narrowing only the visible set would leave the
    // view's nodes at their places in the whole drawing with the rest hidden.
    return new Set(
      fullGraph.nodes
        .filter((n) => !isFoldedAway(n.id) && (!reachIds || reachIds.has(n.id)))
        .map((n) => n.id)
    );
  }

  function visibleIdSet() {
    return visibleAmong(reachIds);
  }

  /**
   * What the toggles show among `within`, or among everything when it is null.
   * The strip counts the view against the whole drawing with this, so both
   * numbers honour the same toggles.
   * @param {Set<string> | null} within
   */
  function visibleAmong(within) {
    if (!fullGraph) return new Set();
    const all = fullGraph.nodes.filter(
      (n) => !isFoldedAway(n.id) && (!within || within.has(n.id))
    );
    if (!hideFunctions) return new Set(all.map((n) => n.id));
    // A member drawn where its type stands is on screen because the reader
    // opened that type, which is a different question from whether they want
    // the project's functions.
    const kept = all.filter((n) => n.kind !== "function" || n.member).map((n) => n.id);
    if (kept.length === 0) return new Set(all.map((n) => n.id));
    // The view's subject stays on screen, including when it is a function and
    // the reader then hides functions: a fan with no apex has no subject.
    if (within && reachRoot && within.has(reachRoot) && !kept.includes(reachRoot)) {
      kept.push(reachRoot);
    }
    return new Set(kept);
  }

  /** Toolbar-driven visibility. Only `display` changes: positions come from
   *  the artifact, so a hidden node keeps its place — see
   *  `applyFixedClassRingLayout`. */
  function applyVisibility(visible) {
    if (!cy) return;
    const shown = visible || visibleIdSet();
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        node.style("display", shown.has(node.id()) ? "element" : "none");
      });
      // Built for the right button's view, and not part of the whole drawing
      // the reader returns to.
      const units = fullGraph ? unitsOf(fullGraph) : new Set();
      if (units.size) {
        cy.edges().forEach((edge) => {
          const e = { from: edge.data("source"), to: edge.data("target") };
          if (crossesTrees(e, units)) edge.style("display", reachRoot ? "element" : "none");
        });
      }
    });
  }

  /** Every group gets a marked center, not just the graph's own. */
  function markCenter() {
    if (!cy) return;
    cy.nodes().removeClass("center").removeClass("primary");
    for (const id of centerIds) cy.getElementById(id).addClass("center");
    const drawnCenter = visibleCenter();
    // The graph's own entry point, told apart from the other group centres
    // because the red belongs to it: there is one place the graph starts and
    // the colour says which.
    if (drawnCenter) cy.getElementById(drawnCenter).addClass("center primary");
  }

  /**
   * Frame the graph the way it opens: zoomed to fit what is visible, panned so
   * the primary center sits in the middle of the screen. The layout puts that
   * node at the origin, so this is literally "back to the origin".
   */
  function visibleElements() {
    return cy.elements().filter((e) => e.style("display") !== "none");
  }

  /**
   * Nodes matching a typed name, best match first.
   *
   * Scoped to `visibleIds`: a hidden node does not exist as far as search is
   * concerned. A hidden node appearing in search results while invisible
   * everywhere else in the viewer would read as the search box ignoring a
   * choice the user had just made. Ordered exact match, then
   * prefix, then how early the match falls in the name, then id for a stable
   * order when everything else ties.
   *
   * Pure and independent of cytoscape, so it is testable without a renderer.
   *
   * @param {{ nodes: { id: string; name: string; kind: string }[] }} graph
   * @param {Set<string>} visibleIds
   * @param {string} query
   * @returns {{ id: string; name: string; kind: string }[]}
   */
  function searchMatches(graph, visibleIds, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q || !graph) return [];
    /** @type {{ n: { id: string; name: string; kind: string }; exact: number; prefix: number; at: number }[]} */
    const hits = [];
    for (const n of graph.nodes) {
      if (!visibleIds.has(n.id)) continue;
      const name = (n.name || "").toLowerCase();
      // A name written in segments is matched by its last segment too, as
      // exactly as if that were its name: guava's node is
      // `LocalCache.ManualSerializationProxy`, the reader types the last
      // segment, and the label already shows only that much.
      const own = name.slice(name.lastIndexOf(".") + 1);
      const at = name.indexOf(q);
      const atOwn = own.indexOf(q);
      if (at !== -1 || atOwn !== -1) {
        const found = [at, atOwn].filter((x) => x !== -1);
        hits.push({
          n,
          exact: name === q || own === q ? 0 : 1,
          prefix: found.includes(0) ? 0 : 1,
          at: Math.min.apply(null, found),
          member: 0,
        });
      }
      // A member is not drawn, which is why it has to be offered: nothing else
      // in the document names it. It carries where it is instead of an id, and
      // choosing one opens it rather than moving the camera.
      for (const m of n.members || []) {
        const mn = (m.name || "").toLowerCase();
        const mat = mn.indexOf(q);
        if (mat === -1) continue;
        hits.push({
          n: {
            id: `${n.id}::member::${m.name}`,
            name: m.name,
            kind: "member",
            file: m.file,
            line: m.line,
            owner: n.id,
          },
          exact: mn === q ? 0 : 1,
          prefix: mat === 0 ? 0 : 1,
          at: mat,
          member: 1,
        });
      }
    }
    hits.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact - b.exact;
      if (a.prefix !== b.prefix) return a.prefix - b.prefix;
      if (a.at !== b.at) return a.at - b.at;
      // A member is offered because nothing else in the document names it. A
      // node of the same name, on screen, is what the reader asked for — and
      // Java makes the two collide by construction, a constructor being a
      // member named after its type.
      if (a.member !== b.member) return a.member - b.member;
      return a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0;
    });
    return hits.map((h) => h.n);
  }

  /**
   * Point the camera at one node, showing as much of `elements` as it can —
   * the whole visible drawing by default, so Open/Reset frame the whole
   * picture. Search passes the node's own hop-0/hop-1 neighbourhood
   * instead: fitting the whole drawing into the window would leave every jump
   * at whatever tiny zoom the *whole graph* happens to need, which has nothing
   * to do with how much room the one node being searched for actually needs. A
   * handful of neighbours fits at a far closer zoom than the whole drawing
   * does, with no new constant to tune — the same floor and ceiling below
   * just clamp a smaller fit instead of a bigger one.
   *
   * Two cases, and which one applies is decided by the fit rather than by
   * the caller:
   *
   * - It fits without falling below the floor. Show all of `elements`; the
   *   fit framing beats centring on any one node. This is the normal case.
   * - It does not. Stop at the floor and centre on the node, accepting that
   *   most of `elements` is off screen — which beats drawing all of it at a
   *   size where nothing is distinguishable.
   *
   * @param {string | null} nodeId
   * @param {any} [elements] defaults to everything currently visible
   * @param {number} [maxZoom] defaults to `MAX_OPEN_ZOOM`; search passes a
   *   tighter ceiling since a sparse neighbourhood needs one more than a
   *   small whole graph does
   */
  function frameOn(nodeId, elements, maxZoom) {
    if (!cy) return;
    // Whether the caller asked for a specific set (search's neighbourhood) or
    // fell back to everything visible (Open/Reset) — remembered separately
    // from `visible` so the floor branch below can tell the two apart.
    const requestedSet = elements;
    const visible = elements || visibleElements();
    if (!visible.length) return;
    const ceiling = maxZoom === undefined ? MAX_OPEN_ZOOM : maxZoom;

    cy.fit(visible, FIT_PADDING);
    const fitZoom = cy.zoom();
    const floorZoom = labelFloor() / BASE_FONT_SIZE;

    if (fitZoom >= floorZoom) {
      if (fitZoom > ceiling) {
        cy.zoom(ceiling);
        cy.center(visible);
      }
      return;
    }

    cy.zoom(floorZoom);
    // A caller-supplied set (the neighbourhood, for search) is what should
    // stay centred — the point is to see the node together with what it
    // connects to, not to centre on the node alone and let its neighbours
    // fall wherever. Only the no-set default (Open/Reset framing a whole
    // graph too big to centre meaningfully as one mass) falls back to the
    // single node.
    if (requestedSet) {
      cy.center(requestedSet);
      return;
    }
    if (!nodeId) return;
    const node = cy.getElementById(nodeId);
    if (node.nonempty() && node.style("display") !== "none") cy.center(node);
  }

  /**
   * The centre of the group the camera is over.
   *
   * The primary centre is chosen for the whole graph, so on a project with more
   * than one group it is the wrong place to return to half the time: FastAPI's
   * fixture holds the primary centre in a 31-class group and has a 68-class one
   * beside it. Reading the answer off the camera means Reset goes back to what
   * the user was reading, with nothing to configure.
   *
   * Falls back to the primary centre when the answer is not clear — over empty
   * canvas, over an ungrouped node in the isolated grid, or when the group's
   * own centre is not currently drawn.
   */
  function currentGroupCenter() {
    // Every path out of here names a node the camera will be pointed at, so
    // it has to be one that is drawn: a centre folded into a group is not.
    const fallback = visibleCenter();
    if (!cy) return fallback;
    try {
      const ext = cy.extent();
      const midX = (ext.x1 + ext.x2) / 2;
      const midY = (ext.y1 + ext.y2) / 2;
      /** @type {{ id: string; x: number; y: number }[]} */
      const entries = [];
      cy.nodes().forEach((node) => {
        if (node.style("display") === "none") return;
        const p = node.position();
        entries.push({ id: node.id(), x: p.x, y: p.y });
      });
      const nearest = nearestEntryId(entries, midX, midY);
      const root = nearest ? nodeGroups[nearest] : null;
      if (!root) return fallback;
      const node = cy.getElementById(root);
      if (node.empty() || node.style("display") === "none") return fallback;
      return root;
    } catch (e) {
      return fallback;
    }
  }

  /** The zoom `cy.fit` would choose for `eles`, without moving the camera. */
  function fitZoomOf(eles) {
    if (!cy || !eles || !eles.length) return null;
    const was = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    cy.fit(eles, FIT_PADDING);
    const z = cy.zoom();
    cy.viewport(was);
    return z;
  }

  /**
   * Frame the right button's view at the magnification the whole drawing's
   * default view uses, rather than fitted to the few nodes it holds.
   *
   * Fitted, a small set would come out at the zoom ceiling — a 4-node set in a
   * 40-node drawing at 1200×800 would go from 0.68 to 2.0 — so every press
   * would change the size of everything as well as what is shown. The whole
   * drawing's fit is measured as the view opens, and it is clamped here by the floor and
   * ceiling as they are now, so the default view setting still decides it.
   */
  function frameReach() {
    const eles = visibleElements();
    if (!eles.length) return;
    const floorZoom = labelFloor() / BASE_FONT_SIZE;
    const fit = reachWholeFit === null ? floorZoom : reachWholeFit;
    const z = fit < floorZoom ? floorZoom : Math.min(fit, MAX_OPEN_ZOOM);
    cy.zoom(z);
    const bb = eles.boundingBox();
    const w = cy.width();
    const h = cy.height();
    if (bb.w * z <= w - 2 * FIT_PADDING && bb.h * z <= h - 2 * FIT_PADDING) {
      cy.center(eles);
      return;
    }
    // Too big to show whole at this size. The fan starts at the pressed node,
    // so that is what stays in sight — at the foot of the screen — and the far
    // levels run off the top.
    const apex = cy.getElementById(reachRoot);
    // Past half a circle some of the set lies below the pressed node, so it is
    // centred instead of anchored at the foot.
    if (apex.nonempty() && reachOpening !== null && reachOpening > Math.PI + 1e-9) {
      cy.center(apex);
      return;
    }
    const ax = apex.nonempty() ? apex.position().x : (bb.x1 + bb.x2) / 2;
    cy.pan({ x: w / 2 - ax * z, y: h - FIT_PADDING - bb.y2 * z });
  }

  function resetView() {
    // The right button's view keeps its own framing: the whole drawing's
    // default magnification, not a fit to what it holds.
    if (reachRoot && cy) {
      frameReach();
      return;
    }
    // A centre the reader named is where reset goes. Saying "this is what the
    // drawing is about" and then having reset point at whichever tree the
    // camera happens to be nearest is the viewer disagreeing with them about
    // the thing they just settled.
    //
    // With no centre named, the nearest tree is still right: it is what the
    // reader is looking at, and nothing has been said to the contrary.
    if ((insideCentre || settings.centre) && cy) {
      const named = visibleCenter();
      if (named && !cy.getElementById(named).empty()) {
        frameOn(named);
        return;
      }
    }
    frameOn(currentGroupCenter());
  }

  /** Frame everything that is drawn, whatever that costs in label size. */
  /**
   * Decide the export's pixel size *before* anything is rendered.
   *
   * Browser canvases cap out near 16384px on a side and around 268 megapixels
   * of area; the 2000-class shape's drawing is 25524 x 24296, which is 620.
   * Rendering at full size and scaling the result down afterwards is exactly
   * the operation that would fail, so the scale is clamped up front instead.
   *
   * The image cytoscape produces for `full: true` is `bbox * scale` with no
   * padding — it does `translate(-bb.x1 * scale)` then `scale(scale)` — so the
   * padding here is added by the composite in device pixels, not world units,
   * and does not grow with the scale.
   *
   * Pure, and the part of the export the harness can check properly.
   *
   * @returns {{width: number, height: number, imageWidth: number,
   *            imageHeight: number, scale: number, reduced: boolean}}
   */
  function exportSize(bbox, desired) {
    const want = desired === undefined ? EXPORT_SCALE : desired;
    const bw = Math.max(1, bbox.w);
    const bh = Math.max(1, bbox.h);
    const pad2 = 2 * EXPORT_PADDING;
    // Side cap, with the padding taken off the top since it does not scale.
    const bySide = Math.min(
      (CANVAS_MAX_SIDE - pad2) / bw,
      (CANVAS_MAX_SIDE - pad2) / bh
    );
    // Area cap: solve (bw*s + pad2)(bh*s + pad2) = MAX for s.
    const qa = bw * bh;
    const qb = pad2 * (bw + bh);
    const qc = pad2 * pad2 - CANVAS_MAX_AREA;
    const byArea =
      (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
    const scale = Math.max(0, Math.min(want, bySide, byArea));
    const imageWidth = Math.max(1, Math.floor(bw * scale));
    const imageHeight = Math.max(1, Math.floor(bh * scale));
    return {
      width: imageWidth + pad2,
      height: imageHeight + pad2,
      imageWidth,
      imageHeight,
      scale,
      reduced: scale < want,
    };
  }

  /**
   * Write the drawing to a PNG beside the artifact.
   *
   * Three things have to be true at once, and the order is what makes them so:
   * the image must not carry the emphasis the reader happens to have applied,
   * the reader must still have it afterwards, and the background must be in
   * the file rather than only on screen.
   */
  function exportPng() {
    if (!cy || typeof document.createElement !== "function") return;
    const visible = visibleElements();
    if (!visible.length) return;

    const bbox = cy.mutableElements().boundingBox();
    const size = exportSize(bbox);

    // Off, capture, back on, with no `await` in between: JavaScript is
    // single-threaded and the browser does not paint mid-task, so the reader
    // never sees the drawing without their own emphasis on it.
    const marked = cy.elements(
      ".hop-0, .hop-1, .dimmed, .focused, .search-hit, .search-miss"
    );
    const saved = marked.map((el) => ({ el, classes: el.classes() }));
    let dataUri = null;
    try {
      marked.removeClass(EMPHASIS_CLASSES);
      marked.removeClass("focused search-hit search-miss");
      dataUri = cy.png({ full: true, scale: size.scale, bg: "transparent" });
    } finally {
      for (const entry of saved) entry.el.classes(entry.classes);
    }
    if (!dataUri) return;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return;

    // The same transform cytoscape used, offset by the padding the composite
    // adds: image x = (world x - bbox.x1) * scale + EXPORT_PADDING.
    drawSpace(ctx, {
      zoom: size.scale,
      panX: EXPORT_PADDING - bbox.x1 * size.scale,
      panY: EXPORT_PADDING - bbox.y1 * size.scale,
      width: size.width,
      height: size.height,
      tileWidth: (starfieldImage && starfieldImage.width) || STAR_TILE_FALLBACK,
      tileHeight: (starfieldImage && starfieldImage.height) || STAR_TILE_FALLBACK,
      layers: EXPORT_STAR_LAYERS,
    });

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(
        img,
        EXPORT_PADDING,
        EXPORT_PADDING,
        size.imageWidth,
        size.imageHeight
      );
      vscode.postMessage({
        command: "exportPng",
        data: canvas.toDataURL("image/png"),
        reduced: size.reduced,
        width: size.width,
        height: size.height,
      });
    };
    img.src = dataUri;
  }

  function fitAll() {
    if (!cy) return;
    const visible = visibleElements();
    if (!visible.length) return;
    cy.fit(visible, FIT_PADDING);
  }

  /**
   * The entry nearest a point.
   * @param {{ id: string; x: number; y: number }[]} entries
   * @returns {string | null}
   */
  function nearestEntryId(entries, midX, midY) {
    let bestId = null;
    let bestDist = Infinity;
    for (const e of entries) {
      const d = Math.hypot(e.x - midX, e.y - midY);
      if (d < bestDist) {
        bestDist = d;
        bestId = e.id;
      }
    }
    return bestId;
  }

  /**
   * Draw the current state.
   *
   * `opts.visibilityOnly` is the toggle's path. Positions come from the
   * artifact and cannot change when a kind is hidden, so re-running the layout
   * there would spend a full pass to arrive at the numbers it already has. What
   * still has to run is everything downstream of *which nodes are on screen*:
   * the labels, since a path is only worth adding against something visible,
   * the emphasis, and the search's highlight.
   */
  /**
   * Labels follow what is *drawn*, which is a different set from what is laid
   * out — that distinction is the whole of the one-layout rule, and this is
   * the one place it goes the other way.
   *
   * Positions come from the artifact because where a class belongs is a fact
   * about the code that hiding a kind cannot alter. A label is not that: a
   * disambiguating path is there to be read, and there is nothing to tell
   * apart from a node that is not on screen. So a class does not carry
   * `configparser/Error` because of an `Error` nobody can see.
   */
  function applyLabels(visibleIds) {
    if (!cy || !fullGraph) return;
    const nameOf = {};
    for (const n of fullGraph.nodes) nameOf[n.id] = n.name;
    const units = unitsOf(fullGraph);
    const labels = labelsForDrawn(
      fullGraph.nodes.filter((n) => visibleIds.has(n.id)),
      (id) => nameOf[id],
      (n) => units.has(n.id)
    );
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const label = labels[node.id()];
        if (label !== undefined) node.data("label", label);
      });
    });
  }

  function applyView(opts) {
    if (!cy || !fullGraph) return;
    const visible = visibleIdSet();
    const keepView = !!(opts && opts.keepView);
    // Before anything reads the drawing. Both paths through this function walk
    // `cy.nodes()` — one to lay out, one only to show and label — so whatever
    // is about to be drawn has to be there first, and then it is treated like
    // everything else rather than needing a case of its own.
    const grew = growCy(visible);
    applyVisibility(visible);
    if (opts && opts.visibilityOnly) {
      // A centre is marked by the layout's pass, and this path deliberately
      // does not run one. But a group's centre can be built here, and it
      // arrives without
      // the mark the layout would have given it — a component rooted on a
      // function has no `.center` until something says so.
      if (grew) markCenter();
      applyLabels(visible);
      applyEmphasis();
      updateSearchStatus();
      syncReachStrip();
      return;
    }
    applyFixedClassRingLayout(visible, keepView);
    markCenter();
    // After `markCenter`, never before: the fit is taken on the drawing as it
    // will be shown, with the center's classes on.
    if (!keepView) resetView();
    // The radii changed with the layout, and `keepView` means the camera did
    // not move, so no `viewport` event will arrive to repaint them.
    paintSpace();
    applyEmphasis();
    // A live search's matches were computed against whichever set was visible
    // at the time; visibility just changed (or this is the first layout), so
    // recompute against the current one rather than leave a stale highlight.
    updateSearchStatus();
    syncReachStrip();
  }

  /**
   * The stylesheet, as something that can be asked for again.
   *
   * Written inline inside the `cytoscape({...})` call, nothing else could
   * reach it: a colour could not be re-applied after the fact, and anything
   * else wanting to draw a node the way this drawing draws one would have to
   * be a second renderer carrying its own idea of what a class looks like —
   * and two renderers disagree exactly where a rule is added, which is the
   * only place it matters.
   *
   * Every colour is read through `cssVar` at the moment this is called, so
   * calling it again after a variable changes is what makes the change land.
   */
  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: "#FFFFFF",
          "text-valign": "center",
          "text-halign": "center",
          "font-size": BASE_FONT_SIZE,
          // Every label, not only the emphasized ones. Over a star field a
          // white glyph sits on white pinpoints and loses its edges.
          "text-outline-width": BASE_OUTLINE_WIDTH,
          "text-outline-color": cssVar("--space-deep", "#05070B"),
          "text-outline-opacity": 0.9,
          width: NODE_DIAMETER,
          height: NODE_DIAMETER,
          // The rim, and the whole of the planet treatment. No halo outside the
          // circle: a planet should not have a glow sticking out past it. The
          // body is a disc with an edge brighter than its face, and that is all.
          // This costs nothing in legibility: what separates a node from a
          // background star is chroma, not spread, and a halo would dilute
          // chroma per pixel rather than raise it.
          "border-width": 1.5,
          // Set by the layout, not by kind: which body covers which when a
          // crowded ring makes them overlap. See `satelliteDrawOrder`.
          "z-index": "data(z)",
          // The type colour, here rather than in a `node[kind = "class"]` rule,
          // because "a type is anything that is not a function and not a file"
          // is what the arrangement asks and this is the stylesheet saying the
          // same thing. A kind nothing below names keeps this, which is right:
          // the drawing knows it anchors, it just has no name for it yet.
          "background-color": cssVar("--node-class", "#1E88E5"),
          "border-color": lighten(cssVar("--node-class", "#1E88E5"), RIM_LIGHTEN),
        },
      },
      // A node's colour is its kind's, and `kind` is already in its data — so
      // the stylesheet says it, where cytoscape can read it again. Resolved once
      // per node into `data.color` when elements are built, these would be the
      // only colours in the drawing that a changed variable could not reach.
      //
      // The rim is arithmetic on the colour and cytoscape has no expression
      // for it, so it is computed here — once per build, once per kind,
      // instead of once per node.
      //
      // These override the type colour on the base rule. `class` is absent on
      // purpose: it is the default, and a rule restating it is a second copy
      // of a value to go out of date.
      ...[
        ["interface", "--node-interface", "#00BCD4"],
        ["type", "--node-type", "#7E57C2"],
        ["enum", "--node-enum", "#FFB300"],
        ["struct", "--node-struct", "#5C6BC0"],
        ["package", "--node-package", "#C0CA33"],
        ["function", "--node-function", "#43A047"],
        ["file", "--node-file", "#FB8C00"],
      ].map(([kind, name, fallback]) => ({
        selector: `node[kind = "${kind}"]`,
        style: {
          "background-color": cssVar(name, fallback),
          "border-color": lighten(cssVar(name, fallback), RIM_LIGHTEN),
        },
      })),
      {
        // Anything the layout hung off another node. The class marked here
        // is `.satellite`, applied after the layout has run, because
        // whether a node is a satellite is something only the layout knows
        // — it is not a property of the node's kind. Files and functions
        // both end up here, and a function that is a tree vertex (a graph
        // with no classes at all) does not.
        selector: "node.satellite",
        style: {
          width: SAT_DIAMETER,
          height: SAT_DIAMETER,
          "font-size": SAT_FONT_SIZE,
          "border-width": 1,
        },
      },
      {
        // A group is not one thing, and the label's count alone would only
        // say so to a reader already looking at it. A doubled rim reads as
        // stacked at any zoom the label survives.
        selector: "node.grouped",
        style: {
          "border-width": GROUP_BORDER_WIDTH,
          "border-style": "double",
        },
      },
      {
        // The graph's entry point. Colored rather than merely bigger so it
        // stays findable after panning, and distinct from the yellow focus
        // border so "where the graph starts" and "what I clicked" never
        // read as the same thing.
        // The centre, when it is a type. `center` is on every group's local
        // centre, not only the graph's entry, and a component with no type to
        // root on is rooted on a function — painting that red would put an
        // entry mark on a module's internals.
        selector: 'node.center[kind != "function"][kind != "file"]',
        style: {
          "background-color": cssVar("--node-center", "#E91E63"),
          "border-color": lighten(
            cssVar("--node-center", "#E91E63"),
            RIM_LIGHTEN
          ),
          // Marked by colour alone, plus the rim: `--node-center` is the dimmest
          // of the four colours and its size cannot grow, and nothing draws a
          // halo.
        },
      },
      // A group rooted on a function is that group's centre, but it is not
      // where the graph starts, and the red says the second thing — those
      // roots exist because their component had no class to root on, so
      // colouring them like the entry point puts a red dot on a module's
      // internals. The red is only ever applied to a class, so they simply
      // keep what their kind gives them.
      {
        // Except the graph's own centre. On a graph with no classes at all
        // that is a function or a file, and it is still where the graph
        // starts.
        selector: "node.primary",
        style: {
          "background-color": cssVar("--node-center", "#E91E63"),
          "border-color": lighten(
            cssVar("--node-center", "#E91E63"),
            RIM_LIGHTEN
          ),
        },
      },
      {
        selector: "node.focused",
        style: {
          "border-color": cssVar("--node-focus-border", "#FFEB3B"),
          "border-width": 4,
        },
      },
      {
        selector: 'edge[kind = "inherits"]',
        style: {
          width: edgeLook("inherits", "width"),
          "line-color": edgeLook("inherits", "colour"),
          "target-arrow-color": edgeLook("inherits", "colour"),
          "target-arrow-shape": edgeLook("inherits", "arrow"),
          "curve-style": "bezier",
          "line-style": edgeLook("inherits", "style"),
        },
      },
      {
        selector: 'edge[kind = "uses"]',
        style: {
          width: edgeLook("uses", "width"),
          "line-color": edgeLook("uses", "colour"),
          "target-arrow-color": edgeLook("uses", "colour"),
          "target-arrow-shape": edgeLook("uses", "arrow"),
          "curve-style": "bezier",
          "line-style": edgeLook("uses", "style"),
        },
      },
      {
        selector: 'edge[kind = "references"]',
        style: {
          width: edgeLook("references", "width"),
          "line-color": edgeLook("references", "colour"),
          "target-arrow-color": edgeLook("references", "colour"),
          "target-arrow-shape": edgeLook("references", "arrow"),
          "curve-style": "bezier",
          "line-style": edgeLook("references", "style"),
        },
      },
      {
        selector: 'edge[kind = "contains"]',
        style: {
          width: edgeLook("contains", "width"),
          "line-color": edgeLook("contains", "colour"),
          "target-arrow-color": edgeLook("contains", "colour"),
          "target-arrow-shape": edgeLook("contains", "arrow"),
          "curve-style": "bezier",
          "line-style": edgeLook("contains", "style"),
        },
      },
      {
        // An edge that does not say where either end of it is.
        //
        // The tree hangs each node off one other, and a satellite orbits
        // one owner; those edges are the drawing's skeleton and are drawn
        // at full strength. Every other edge is a real relationship the
        // arrangement could not express with a position, so it crosses the
        // picture instead — thousands of them on CPython, and at the same
        // weight they read as a haze over the middle with the tree lost
        // inside it. Faint rather than hidden: the relationship is real and
        // following one is what the emphasis on click is for.
        selector: "edge.crossing",
        style: { opacity: 0.18 },
      },
      // Emphasis levels. Declared last so they win over the rules above.
      // Positions never change — dimmed elements stay rendered so the
      // whole-graph context survives a click.
      {
        selector: "node.hop-0, node.hop-1, edge.hop-0, edge.hop-1",
        style: { opacity: 1, "text-opacity": 1 },
      },

      {
        // Labels overlap their neighbours at this size, which only matters
        // where the user is actually reading. The outline keeps the
        // neighbourhood legible where it does; text only, so the circles keep
        // their size and no separation guarantee is affected.
        selector: "node.hop-1",
        style: {
          "text-outline-width": BASE_OUTLINE_WIDTH + 0.8,
          "z-index": Z_HOP1,
        },
      },
      {
        selector: "node.hop-0",
        style: {
          "font-size": FOCUS_FONT_SIZE,
          "font-weight": "bold",
          "text-outline-width": BASE_OUTLINE_WIDTH + 1.6,
          "z-index": Z_HOP0,
        },
      },
      {
        selector: "node.dimmed, edge.dimmed",
        style: { opacity: 0.12, "text-opacity": 0.12 },
      },
      // Live search highlighting. Declared last so it wins over click-focus
      // emphasis while a search is in progress; see applySearchHighlight.
      {
        selector: "node.search-hit, edge.search-hit",
        style: { opacity: 1, "text-opacity": 1 },
      },
      {
        selector: "node.search-miss, edge.search-miss",
        style: { opacity: 0.12, "text-opacity": 0.12 },
      },
    ];
  }

  /**
   * @param {{ nodes: any[]; edges: any[] }} graph
   * @param {Set<string>} [only] What to build. Omitted means all of it.
   */
  function ensureCy(graph, only) {
    if (cy) {
      cy.destroy();
      cy = null;
    }
    lastLayout = null;

    cy = cytoscape({
      container: cyEl,
      elements: buildElements(graph, only),
      style: graphStyle(),

      layout: {
        name: "preset",
        fit: false,
      },
    });

    // The rings live on their own canvas, so nothing repaints them for us.
    // `viewport` covers both pan and zoom; `resize` covers the panel changing
    // size, which also invalidates the canvas's backing store.
    cy.on("viewport", paintSpace);
    cy.on("resize", paintSpace);


    // Two-step activation: first tap focuses and emphasizes, second tap on the
    // same node jumps. No time window — this is stateful, not a double-click.
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const id = node.id();

      if (pendingJumpId === id) {
        // A group is in as many files as it has members, so there is nothing
        // single to open. The second activation lists them instead, and a row
        // is what opens a file — the only node where the second step does not
        // navigate, and only because there is no destination.
        if (isGroupId(id)) {
          showMembers(id);
          return;
        }
        vscode.postMessage({
          command: "jumpTo",
          file: node.data("file"),
          line: node.data("line"),
        });
        return;
      }

      // Focusing a different node replaces the pending target, so jumping to
      // the newly focused node also takes two activations.
      activateFocus(id);
    });

    // The right button shows only what a node points to. Inside that view it
    // switches the view to the node pressed, which is not stacking: there is
    // still one way out and one destination. Left inert there, a press would
    // read as the viewer ignoring it — pressing a node while inside another
    // node's view would look like the centre being wrong.
    cy.on("cxttap", "node", (evt) => {
      if (evt.originalEvent && evt.originalEvent.preventDefault) {
        evt.originalEvent.preventDefault();
      }
      openReach(evt.target.id());
    });

    // Anything that is not a node clears the focus — empty canvas and edges
    // alike. An edge is not something you can focus; if clicking one did
    // nothing, the click would read as swallowed rather than as "you are still
    // on the node you were on". Tapping a
    // different node is not this: that transfers focus, and its own handler
    // above has already run by the time this one is reached.
    cy.on("tap", (evt) => {
      const target = evt.target;
      const isNode =
        target !== cy &&
        typeof target.isNode === "function" &&
        target.isNode();
      if (isNode) return;
      clearFocus();
    });
  }

  function clearError() {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }
  }

  function setError(message) {
    fullGraph = null;
    focusId = null;
    reachRoot = null;
    reachIds = null;
    reachReturnView = null;
    insideOf = null;
    insideReturn = null;
    insideCentre = null;
    syncReachStrip();
    showComment(null, null);
    centerClassId = null;
    if (cy) {
      cy.destroy();
      cy = null;
    }
    if (emptyEl) emptyEl.classList.add("hidden");
    if (cyEl) cyEl.classList.add("hidden");
    if (errorEl) {
      errorEl.textContent = message || "Could not load graph document.";
      errorEl.classList.remove("hidden");
    }
  }

  /**
   * Draw this graph.
   *
   * `opts.insideCentre` is how the view of one type's members says that it is
   * being entered: taking a graph is otherwise how the viewer forgets a view,
   * and the centre has to be in place before the layout runs.
   */
  function setGraph(graph, opts) {
    clearError();
    const grouped = withGroups(graph);
    artifactGraph = graph;
    fullGraph = grouped.graph;
    memberGroupOf = grouped.groupOf;
    groupsById = grouped.groupById;
    focusId = null;
    // With the focus it belongs to. Left behind, the first click on that node
    // in the new drawing would count as its second and open the file.
    pendingJumpId = null;
    // The view was a question about the graph that was here.
    reachRoot = null;
    reachIds = null;
    reachReturnView = null;
    insideOf = null;
    insideReturn = null;
    insideCentre = (opts && opts.insideCentre) || null;
    openTypes = [];
    syncReachStrip();
    // The legend names what a reader can see and the panel offers a colour for
    // it, so both follow the artifact rather than a list fixed at three. From
    // `graph`, not from the collapsed reading: folding changes how many nodes
    // of a kind there are, never whether the kind is in the drawing.
    showKindRowsFor(graph);
    computeFilePrefix(graph.nodes);
    showComment(null, null);
    // From the artifact, deliberately — not from the collapsed reading.
    //
    // A group carries the union of its members' edges, so folding Django's 29
    // `Command` classes into one node gives that node more reach than any real
    // class and makes it the centre. It is a bad place to start reading: the
    // centre is where Reset returns to and what the drawing is rooted on, and
    // 29 unrelated management commands are not Django's entry point —
    // `AdminSite` is. It also cannot be opened.
    //
    // Choosing from the artifact keeps the centre a single class whatever is
    // folded, so opening a group cannot reroot the drawing under the reader.
    // `visibleCenter` is what resolves it to whatever stands in its place.
    centerClassId = chosenCentre(graph) || pickTopClass(graph);

    const empty = !graph.nodes || graph.nodes.length === 0;
    if (emptyEl) emptyEl.classList.toggle("hidden", !empty);
    if (cyEl) cyEl.classList.toggle("hidden", empty);

    if (empty) {
      if (cy) {
        cy.destroy();
        cy = null;
      }
      return;
    }

    if (!centerClassId) {
      // No classes — fall back to a simple circle of all nodes.
      //
      // This one asks for the whole graph rather than for what is drawn: it
      // positions every node by id straight afterwards, and there is no layout
      // behind it for growth to read. It is also the one branch nothing can
      // reach with a well-formed artifact — `pickTopClass` chooses among all
      // nodes, so it returns a function or a file when there is no class, and
      // only a node without an id leaves it empty-handed.
      ensureCy(fullGraph);
      const ids = fullGraph.nodes.map((n) => n.id);
      const n = ids.length;
      cy.batch(() => {
        ids.forEach((id, i) => {
          const a = (2 * Math.PI * i) / n - Math.PI / 2;
          cy.getElementById(id).position({
            x: Math.cos(a) * RING_RADIUS,
            y: Math.sin(a) * RING_RADIUS,
          });
          cy.getElementById(id).grabbable(false);
        });
      });
      cy.fit(undefined, 24);
      return;
    }

    ensureCy(fullGraph, visibleIdSet());
    applyView();
  }

  function setLegendOpen(open) {
    if (!legendEl) return;
    // One corner, one panel — the other direction of the same rule.
    // One corner, one panel — between these two. Settings is not in this
    // rule, not being a card in the corner; it is drawn over both of them and
    // closes them itself.
    if (open && commentEl) commentEl.classList.add("hidden");
    legendEl.classList.toggle("hidden", !open);
    if (toggleLegendEl) {
      toggleLegendEl.setAttribute("aria-pressed", open ? "true" : "false");
    }
  }

  /**
   * The settings panel covers the whole drawing surface, so it does not
   * compete for the corner — but it is drawn over what is in that corner, and
   * a rail button left lit for a panel nobody can see reports a state the
   * reader cannot check. So it closes both.
   */
  function setSettingsOpen(open) {
    if (!settingsEl) return;
    if (open) {
      if (commentEl) commentEl.classList.add("hidden");
      if (legendEl) {
        legendEl.classList.add("hidden");
        if (toggleLegendEl) toggleLegendEl.setAttribute("aria-pressed", "false");
      }
    }
    settingsEl.classList.toggle("hidden", !open);
    if (toggleSettingsEl) {
      toggleSettingsEl.setAttribute("aria-pressed", open ? "true" : "false");
    }
    // Built on open, gone on close. Nothing about the drawing pays for it
    // while the panel is shut, and it is seeded from the drawing as it stands
    // when the reader opens the panel rather than from a stale copy.
    if (open) {
      if (savedState === null) savedState = snapshotSettings();
      // The rows are in the markup all along; what they show is written here,
      // because nothing has painted them while the panel was shut.
      paintEdgeSwatches();
    } else {
      discardDraft();
    }
  }

  /**
   * Nothing about the drawing changes here — not even its size. The rail is
   * out of flow and only its collapsed width is reserved, so expanding lays
   * the rest of it over the canvas instead of narrowing it. That is deliberate:
   * resizing the canvas would re-frame the graph under the reader every time
   * they opened the rail to press one button.
   */
  function setSidebarCollapsed(collapsed) {
    if (!sidebarEl) return;
    const on = !!collapsed;
    sidebarEl.setAttribute("data-collapsed", on ? "true" : "false");
    if (sidebarToggleEl) {
      sidebarToggleEl.setAttribute("aria-expanded", on ? "false" : "true");
      sidebarToggleEl.setAttribute("title", on ? "Expand" : "Collapse");
      // Which way the chevron points is CSS's job, keyed off the same
      // `data-collapsed` attribute set above — one source for the state
      // instead of a second copy of it kept in an element's text.
    }
    // The reader's choice, kept across the panel being hidden and shown again.
    try {
      const prev = (vscode.getState && vscode.getState()) || {};
      if (vscode.setState) vscode.setState({ ...prev, sidebarCollapsed: on });
    } catch (e) {
      /* no state host: the choice simply does not persist */
    }
  }

  /** Label and pressed state always derive from hideFunctions, never the markup. */
  /**
   * The label stays "Show functions" always — it names the toggle, not the
   * action a click takes from here, so it does not need to swap with
   * `hideFunctions`. Whether functions are currently shown is what
   * `aria-pressed` (and the bright/dark style it drives) is for.
   */
  function syncFnToggle() {
    if (!toggleFnsEl) return;
    // Pressed means "on", and functions hidden is the default the button
    // opens in — the same convention Legend already uses (closed/default is
    // unpressed, open/non-default is pressed). Tying pressed to `hideFunctions`
    // directly would have this backwards: the button would render in its
    // bright, already-pressed style before anything had been clicked.
    toggleFnsEl.setAttribute("aria-pressed", hideFunctions ? "false" : "true");
  }

  if (toggleFnsEl) {
    syncFnToggle();
    toggleFnsEl.addEventListener("click", () => {
      hideFunctions = !hideFunctions;
      syncFnToggle();
      // Nothing moves, so there is nothing to hold onto and nothing to
      // re-frame: the toggle paints a different subset of a drawing that is
      // already arranged.
      applyView({ keepView: true, visibilityOnly: true });
    });
  }

  if (sidebarToggleEl && legendEl) {
    setLegendOpen(false);
    // Restore the reader's last choice before anything is measured. Collapsed
    // is the default: the drawing gets the room, and the labels are one click
    // or one tooltip away. Note the distinction between "never chosen" and
    // "chose expanded" — reading it as a plain boolean would let the default
    // overwrite a stored `false` every time the panel reopened.
    const SIDEBAR_COLLAPSED_BY_DEFAULT = true;
    let startCollapsed = SIDEBAR_COLLAPSED_BY_DEFAULT;
    try {
      const st = vscode.getState && vscode.getState();
      if (st && typeof st.sidebarCollapsed === "boolean") {
        startCollapsed = st.sidebarCollapsed;
      }
    } catch (e) {
      startCollapsed = SIDEBAR_COLLAPSED_BY_DEFAULT;
    }
    setSidebarCollapsed(startCollapsed);
    sidebarToggleEl.addEventListener("click", () =>
      setSidebarCollapsed(sidebarEl.getAttribute("data-collapsed") !== "true")
    );
    if (toggleLegendEl) {
      toggleLegendEl.addEventListener("click", () =>
        setLegendOpen(legendEl.classList.contains("hidden"))
      );
    }
    if (toggleSettingsEl && settingsEl) {
      setSettingsOpen(false);
      toggleSettingsEl.addEventListener("click", () =>
        setSettingsOpen(settingsEl.classList.contains("hidden"))
      );
      if (settingsCloseEl) {
        settingsCloseEl.addEventListener("click", () => setSettingsOpen(false));
      }

      const valueControls = settingsEl.querySelectorAll("[data-setting]");
      const revertControls = settingsEl.querySelectorAll("[data-revert]");
      const byKey = {};
      for (const entry of SETTINGS) byKey[entry.key] = entry;

      // Every control the table names has to exist, and every control has to
      // be in the table. Otherwise a setting is either unreachable or
      // unresettable, and neither shows up as anything going wrong.
      for (const el of valueControls) {
        const key = el.getAttribute("data-setting");
        if (!byKey[key]) warn("settings panel offers a control the table has no entry for: " + key);
      }

      // Registered rather than called: the host may hand settings down before
      // this panel is wired or long after, and either way the controls have to
      // end up showing what the flags say.
      syncSettingControls = () => {
        for (const el of valueControls) {
          const entry = byKey[el.getAttribute("data-setting")];
          if (!entry) continue;
          // A control that carries its own value is a choice among buttons:
          // it says whether it is the one, rather than holding what the value
          // is. Everything else is a field and takes the value.
          if (el.hasAttribute && el.hasAttribute("data-choice")) {
            const on = el.value === String(settingValue(entry));
            el.setAttribute("aria-pressed", on ? "true" : "false");
            el.classList.toggle("on", on);
          } else {
            el.value = String(settingValue(entry));
          }
        }
        // A revert shows only where there is something to revert — where this
        // row differs from what the host was last told. Pressing Save answers
        // every one of them at once, so they all go.
        //
        // Shown or not shown, never present or absent: a control that appears
        // pushes the ones beside it sideways, and the reader is on the way to
        // one of those with a mouse.
        const saved = savedSettings();
        for (const el of revertControls) {
          const entry = byKey[el.getAttribute("data-revert")];
          if (!entry) continue;
          const back = savedValueOf(saved, entry);
          const outstanding = settingValue(entry) !== back;
          el.classList.toggle("shown", outstanding);
          // Where it goes back to is not fixed — it is whatever was saved — so
          // the button has to say so itself rather than carry a value written
          // into the markup that would stop being true at the first Save.
          if (outstanding) el.setAttribute("title", "Back to " + (back === "" ? "no centre" : back));
        }

        const dirty = isDirty();
        if (settingsSaveEl) settingsSaveEl.disabled = !dirty;
        if (settingsDirtyEl) settingsDirtyEl.hidden = !dirty;
      };
      syncSettingControls();

      /** One place a change lands, whatever control made it. */
      const settingChanged = (entry) => {
        // The variables first: they are where the colour actually lives, and
        // the stylesheet reads them rather than the settings object. Without
        // this the panel's own pickers would move the object and nothing else.
        writePaletteVars();
        syncSettingControls();
        // Not saved. The drawing shows it at once; the store
        // hears about it when the reader presses Save.
        applyCost(entry.cost);
      };

      for (const el of valueControls) {
        if (el.hasAttribute && el.hasAttribute("data-readout")) continue;
        const choice = el.hasAttribute && el.hasAttribute("data-choice");
        el.addEventListener(choice ? "click" : "change", () => {
          const entry = byKey[el.getAttribute("data-setting")];
          if (!entry) return;
          const raw = el.value;
          const next = typeof entry.def === "number" ? Number(raw) : raw;
          if (next === settingValue(entry)) return;
          if (next === entry.def) clearSettingAt(entry.key, entry.def);
          else setSettingAt(entry.key, next);
          settingChanged(entry);
        });
      }

      for (const el of revertControls) {
        el.addEventListener("click", () => {
          const entry = byKey[el.getAttribute("data-revert")];
          if (!entry) return;
          const back = savedValueOf(savedSettings(), entry);
          // A value equal to the default is removed rather than written, so
          // the stylesheet stays the statement of what the defaults are
          // instead of being shadowed by a copy of itself.
          if (back === entry.def) clearSettingAt(entry.key, entry.def);
          else setSettingAt(entry.key, back);
          settingChanged(entry);
        });
      }

      if (settingsSaveEl) {
        settingsSaveEl.addEventListener("click", () => saveSettings());
      }

      if (settingsResetEl) {
        settingsResetEl.addEventListener("click", () => {
          // Everything, including whatever the reader has forgotten changing —
          // which is the point of a reset that walks the table rather than the
          // controls currently on screen.
          settings = { palette: {}, edges: {}, centre: "", labelFloor: undefined };
          for (const entry of SETTINGS) clearSettingAt(entry.key, entry.def);
          writePaletteVars();
          syncSettingControls();
          // Every tier, because a reset can have moved a value in any of them
          // and, unlike a single setting, there is no one entry to ask.
          //
          // Through `applyCost` rather than `applyView` directly: the centre
          // is read once, where the graph arrives, and `applyView` does not
          // re-derive it. Through `applyView`, Reset would clear the reader's
          // centre out of the settings and then lay the drawing out around it
          // anyway.
          repaint();
          applyCost("layout");
        });
      }

    }
    if (exportPngEl) exportPngEl.addEventListener("click", exportPng);
  }

  if (resetViewEl) {
    resetViewEl.addEventListener("click", resetView);
  }
  // One way out, whichever view is up: a view of what a node points to, taken
  // from inside a type, leaves back into the type rather than to the drawing
  // two steps away.
  if (reachBackEl) reachBackEl.addEventListener("click", () => closeReach() || closeInside());
  if (commentExpandEl) commentExpandEl.addEventListener("click", () => toggleExpand(panelTypeId));
  if (commentOnlyEl) commentOnlyEl.addEventListener("click", () => showOnly(panelTypeId));

  /** Live "N matches — Enter: Name" / "No match" feedback as the user types. */
  /** Reset the Enter-cycle position whenever the typed text has changed since
   *  it was last checked, so a fresh query always starts from the top match. */
  function syncSearchCycle(query) {
    if (query === searchCycleQuery) return;
    searchCycleQuery = query;
    searchCycleIndex = 0;
  }

  /**
   * Just the status text — "N matches (i/N) — Enter: Name" — with no
   * side effect on the live highlight. Used both while typing and right
   * after committing a result, where the highlight has already been cleared
   * by `activateFocus` and must stay cleared.
   *
   * @returns {{ id: string; name: string; kind: string }[]} the current matches,
   *   so callers that also need the highlight do not have to search twice
   */
  function renderSearchStatusText(query) {
    if (!searchStatusEl) return [];
    const trimmed = query ? query.trim() : "";
    syncSearchCycle(query);
    if (!trimmed) {
      searchStatusEl.textContent = "";
      return [];
    }
    const matches = searchMatches(fullGraph, visibleIdSet(), query);
    if (matches.length === 0) {
      searchStatusEl.textContent = "No match";
    } else {
      const at = searchCycleIndex % matches.length;
      searchStatusEl.textContent =
        matches.length === 1
          ? `1 match — Enter: ${matches[0].name}`
          : `${matches.length} matches (${at + 1}/${matches.length}) — Enter: ${matches[at].name}`;
    }
    return matches;
  }

  /** Typing: refresh the status text and the live highlight together. */
  function updateSearchStatus() {
    if (!searchStatusEl || !searchInputEl) return;
    const query = searchInputEl.value;
    const trimmed = query ? query.trim() : "";
    const matches = renderSearchStatusText(query);
    if (!trimmed) {
      clearSearchHighlight();
      return;
    }
    // A single character would light up most of the graph and dim almost
    // nothing — a filter that has not filtered yet.
    if (trimmed.length < SEARCH_HIGHLIGHT_MIN_CHARS) {
      clearSearchHighlight();
      return;
    }
    applySearchHighlight(new Set(matches.map((m) => m.id)));
  }

  /**
   * Choose the best match and move the camera and focus it exactly as a click
   * would. Matches are already scoped to visible nodes by `searchMatches`, so
   * there is nothing hidden left to reveal here.
   */
  /**
   * Commit to a match and advance the cycle, so the next Enter on the same
   * text goes to the next match instead of the same one again. The cycle
   * position is what `updateSearchStatus` already shows as "Enter: <name>",
   * so this always acts on exactly the node the status line just promised.
   */
  function commitSearch() {
    if (!searchInputEl || !fullGraph) return;
    const query = searchInputEl.value;
    // Renders the status for the match this press is about to use, then
    // `at` below reads the identical, still-un-advanced index — so the text
    // and the node that actually gets focused can never disagree. A second
    // render call here would read the *already* advanced index instead,
    // describing next press's target while the screen is still showing this
    // one.
    const matches = renderSearchStatusText(query);
    if (matches.length === 0) return;
    const at = searchCycleIndex % matches.length;
    const target = matches[at];
    searchCycleIndex = at + 1;
    // A member is not drawn, but the node that records it is, and that is
    // where the reader is taken — with the row they found marked in the list.
    // This key walks the matches, and a key that moves a camera on one press
    // and opens an editor on the next is two gestures on one key.
    const id = target.kind === "member" ? target.owner : target.id;
    if (!id) return;
    activateFocus(id, target.kind === "member" ? { file: target.file, line: target.line } : null);
    const neighborhood = cy
      .elements(".hop-0, .hop-1")
      .filter((e) => e.style("display") !== "none");
    frameOn(id, neighborhood.length ? neighborhood : undefined, searchZoomCeiling());
  }

  if (searchInputEl) {
    searchInputEl.addEventListener("focus", () => {
      searchFocused = true;
    });
    searchInputEl.addEventListener("blur", () => {
      searchFocused = false;
    });
    searchInputEl.addEventListener("input", updateSearchStatus);
    searchInputEl.addEventListener("keydown", (event) => {
      if (!event) return;
      if (event.key === "Enter") {
        commitSearch();
        if (event.preventDefault) event.preventDefault();
      } else if (event.key === "Escape") {
        if (searchInputEl.blur) searchInputEl.blur();
        searchFocused = false;
        clearSearchHighlight();
        if (event.preventDefault) event.preventDefault();
      }
    });
  }

  /**
   * How far one wheel event scrolled, in pixels.
   *
   * `deltaMode` says what unit the browser measured in, and the units are
   * nothing like each other: 100 pixels, 3 lines and 1 page can all be one
   * notch of the same wheel. Converting here, before the rate is applied,
   * keeps the rate a single statement about pixels — cytoscape instead
   * multiplies its already-computed step by 33 for the line case, which is the
   * same correction made where a reader is not looking for it.
   *
   * @param {number} delta the event's `deltaY`
   * @param {number} mode the event's `deltaMode`: 0 pixels, 1 lines, 2 pages
   * @param {number} pageHeight height of the drawing, for the page case
   */
  function wheelScrollPixels(delta, mode, pageHeight) {
    if (!delta) return 0;
    if (mode === 1) return delta * WHEEL_LINE_PIXELS;
    if (mode === 2) return delta * pageHeight;
    return delta;
  }

  /**
   * Zoom on the wheel, at one rate, forever.
   *
   * Bound to `#main` in the capture phase rather than to the drawing itself,
   * and stopping the event there, so cytoscape's own wheel handler — bound on
   * `#cy`, which is inside this — never sees it. The alternative,
   * `userZoomingEnabled: false`, takes two other things with it, as the
   * library's source shows: Safari's desktop pinch, which arrives as
   * `gesturechange` and is routed into the same wheel handler, and two-finger
   * pinch on a touchscreen. Both are gestures this handler has no quarrel with,
   * and both keep working when only `wheel` is intercepted.
   *
   * What the library does on its own: clamp the first four events to a
   * magnitude of 5 while sampling them to guess trackpad or wheel, then give a
   * wheel three times the rate from the fifth on. The guess is kept on the
   * renderer, which `ensureCy` rebuilds on every open, so it is made again each
   * time.
   */
  if (mainEl) {
    mainEl.addEventListener(
      "wheel",
      (event) => {
        if (!cy) return;
        // The settings panel is a child of this element and covers the whole
        // drawing surface, so a wheel over it is never meant for the drawing.
        // Taking it anyway would zoom a graph the reader cannot see and leave
        // the panel unable to scroll — the panel is taller than the room it
        // has, and this handler would eat every wheel event before it got there.
        if (settingsEl && !settingsEl.classList.contains("hidden")) return;
        // The legend is a child of this element too, and the same handler would
        // eat its wheel events for the same reason. It differs in covering a
        // corner rather than the whole surface, so the question is not whether
        // it is open but whether the wheel is over it. The comment panel is the
        // same shape in the same corner, and a type's members — 69 of them on
        // one Rust parser — outgrow it just as the legend does.
        for (const corner of [legendEl, commentEl]) {
          if (
            corner &&
            !corner.classList.contains("hidden") &&
            corner.contains(event.target)
          ) {
            return;
          }
        }
        // Not passive: the webview would otherwise scroll the page behind the
        // drawing, and the drawing is the whole page.
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        const rect = mainEl.getBoundingClientRect();
        const px = wheelScrollPixels(event.deltaY, event.deltaMode, rect.height);
        if (!px) return;
        // Scrolling up is a negative delta and means closer, so the sign flips
        // once, here, where it can be seen next to the rate.
        cy.zoom({
          level: cy.zoom() * Math.pow(2, -px / ZOOM_DOUBLING_SCROLL),
          // Anchoring the pointer, and honouring the zoom floor and ceiling,
          // are both `cy.zoom`'s to do — it is only the amount that this
          // handler decides.
          renderedPosition: {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          },
        });
      },
      { capture: true, passive: false }
    );
  }

  // Single-letter shortcuts only fire while the graph, not the search field,
  // has keyboard focus — otherwise typing a name containing "f" would also
  // fit the whole drawing on every keystroke.
  window.addEventListener("keydown", (event) => {
    if (!event || event.altKey || event.ctrlKey || event.metaKey) return;
    if (searchFocused) return;
    if (event.key === FIT_KEY || event.key === FIT_KEY.toUpperCase()) {
      fitAll();
      if (event.preventDefault) event.preventDefault();
    } else if (event.key === CENTRE_KEY || event.key === CENTRE_KEY.toUpperCase()) {
      // Nothing focused is not an error: the key says "this one", and there is
      // no this one. The press is left alone rather than swallowed.
      if (centreOnFocus() && event.preventDefault) event.preventDefault();
    } else if (event.key === EXPAND_KEY || event.key === EXPAND_KEY.toUpperCase()) {
      // The focused node, as the centre key's is: the key says "this one".
      if (toggleExpand(focusId) && event.preventDefault) event.preventDefault();
    } else if (event.key === ONLY_KEY || event.key === ONLY_KEY.toUpperCase()) {
      if (showOnly(focusId) && event.preventDefault) event.preventDefault();
    } else if (event.key === SEARCH_KEY && searchInputEl) {
      searchInputEl.focus();
      searchFocused = true;
      if (event.preventDefault) event.preventDefault();
    } else if (event.key === "Escape") {
      // Only when there is something to leave: the settings panel first, since
      // it covers the drawing, and then the right button's view. The early
      // return above already keeps this away from a press meant for the search
      // field, whose own Escape means "leave the field".
      if (settingsEl && !settingsEl.classList.contains("hidden")) {
        setSettingsOpen(false);
        if (event.preventDefault) event.preventDefault();
      } else if (closeReach() || closeInside() || closeHere()) {
        // One thing at a time, innermost first: a reader who opened three
        // types closes them one press at a time rather than losing all of
        // them at once.
        if (event.preventDefault) event.preventDefault();
      }
    }
  });

  /**
   * Show only what a node reaches: the node, and what its edges lead to up to
   * REACH_STEPS steps away, laid out as a fan below it.
   *
   * The set is read off the artifact, not off what is drawn, so a hidden
   * function on the path is walked through and the answer does not change when
   * the reader toggles functions. A group's set is all of its members'.
   */
  function openReach(id) {
    if (!cy || !artifactGraph) return;
    if (cy.getElementById(id).empty()) return;
    // Already the subject: not even a re-frame, so a reader who has moved the
    // camera keeps where they were.
    if (id === reachRoot) return;
    const starts = isGroupId(id) ? (groupsById[id] || {}).members || [id] : [id];
    const drawn = new Set([id]);
    for (const x of outwardFrom(artifactGraph, starts)) drawn.add(memberGroupOf[x] || x);
    // Only on the way in. Switching from one node's view to another must not
    // move the way back: what leaving restores is the whole drawing as it was
    // before the first of them, not before the switch.
    if (!reachRoot) {
      reachReturnView = { zoom: cy.zoom(), pan: { ...cy.pan() } };
      reachReturnFns = hideFunctions;
      reachWholeFit = fitZoomOf(visibleElements());
    }
    reachRoot = id;
    reachIds = drawn;
    clearFocus();
    applyView();
  }

  /**
   * Back to the whole drawing, where the reader left it — the one destination
   * the view has. Returns whether there was a view to leave.
   */
  /**
   * What a type is made of, as a drawing: one node per member name, joined by
   * the calls the members record.
   *
   * One node per name, not per member: a language that overloads writes several
   * members under one name — jackson-databind's `ObjectMapper` declares 172
   * members under 68 names — and a reader thinks of `readValue` as one thing.
   * The first member of a name is where opening it goes.
   */
  function membersDrawing(node) {
    const members = memberNodesOf(node);
    return quietMembership(
      {
        nodes: [node, ...members],
        edges: [
          ...members.map((m) => ({ from: node.id, to: m.id, kind: "contains" })),
          ...callsAmong(node),
        ],
      },
      [node.id]
    );
  }

  /**
   * Draw the line from a type to its members only where the tree has one.
   *
   * Every member is joined to its type, and the layout needs every one of those
   * joins to know whose member it is. Drawn, they are sixty-nine lines out of
   * `Parser`, and the tree its members make — the way in beside the type, each
   * rule beyond the rule that calls it — is under them. So the type is drawn
   * joined to the first level of its tree and no further; a member further out
   * is joined to what calls it, which is where its place in the tree comes
   * from.
   */
  function quietMembership(graph, typeIds) {
    for (const typeId of typeIds) {
      const tree = memberTreeOf(graph, typeId);
      if (!tree) continue;
      const first = new Set(tree.children[typeId] || []);
      for (const e of graph.edges) {
        if (e.from === typeId && e.kind === "contains" && tree.ids.includes(e.to) && !first.has(e.to)) {
          e.quiet = true;
        }
      }
    }
    return graph;
  }

  /** The id a member's name is drawn under, wherever it is drawn. */
  function memberNodeId(typeId, name) {
    return `${typeId}::member::${name}`;
  }

  /** One node per member name, marked as a member so the ƒ toggle leaves it. */
  function memberNodesOf(node) {
    const byName = new Map();
    for (const m of node.members || []) {
      if (!byName.has(m.name)) byName.set(m.name, m);
    }
    return [...byName.values()].map((m) => ({
      id: memberNodeId(node.id, m.name),
      kind: "function",
      name: m.name,
      file: m.file,
      line: m.line,
      member: true,
    }));
  }

  /** The calls between one type's members, one line however often written. */
  function callsAmong(node) {
    const names = new Set((node.members || []).map((m) => m.name));
    const edges = [];
    const seen = new Set();
    for (const m of node.members || []) {
      for (const called of m.calls || []) {
        if (!names.has(called) || called === m.name) continue;
        const key = `${m.name}\u0000${called}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          from: memberNodeId(node.id, m.name),
          to: memberNodeId(node.id, called),
          kind: "uses",
        });
      }
    }
    return edges;
  }

  /**
   * The drawing with each open type's members in it, where the type stands.
   *
   * The type stays: what points at a type points at the type, and a type that
   * disappeared when opened would take every line into it off the drawing. Its
   * members are contained by it, which is how a file contains its functions, so
   * the layout seats them the way it seats those.
   *
   * An edge of the type that a member accounts for is drawn from that member
   * instead — which is what a reader opens a type to see. One no member
   * accounts for, a field's type or a supertype, stays the type's.
   *
   * @param {{nodes: any[], edges: any[]}} graph the drawing, already folded
   * @param {Record<string, string>} groupOf what each folded node stands under
   */
  function withOpenTypes(graph, groupOf) {
    if (!openTypes.length || !artifactGraph) return graph;
    const drawn = new Set(graph.nodes.map((n) => n.id));
    const kindOf = new Map();
    for (const e of graph.edges) kindOf.set(`${e.from}\u0000${e.to}`, e.kind);
    const nodes = graph.nodes.slice();
    const added = [];
    const claimed = new Set();
    const seen = new Set();
    for (const id of openTypes) {
      const type = artifactGraph.nodes.find((n) => n.id === id);
      // A type folded into a group is not drawn under its own id, and a group
      // stands for several types, so there is nothing single to open.
      if (!type || !drawn.has(id)) continue;
      const members = memberNodesOf(type);
      if (!members.length) continue;
      nodes.push(...members);
      for (const m of members) added.push({ from: id, to: m.id, kind: "contains" });
      added.push(...callsAmong(type));
      for (const m of type.members || []) {
        const from = memberNodeId(id, m.name);
        for (const target of m.points || []) {
          const to = (groupOf && groupOf[target]) || target;
          if (to === id || !drawn.has(to)) continue;
          const key = `${from}\u0000${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const kind = kindOf.get(`${id}\u0000${to}`);
          // Only what the type itself points at. Folding can put a target
          // under a group the type has no edge to, and a line the drawing
          // cannot account for is a line the reader cannot check.
          if (!kind) continue;
          added.push({ from, to, kind });
          claimed.add(`${id}\u0000${to}`);
        }
      }
    }
    // Kept, and marked rather than removed. The layout builds the project's
    // tree from the type's own edges — which type hangs off which — and the
    // project around an open type is meant to be the tree it was. Only the
    // line is drawn somewhere else: from the member that accounts for it.
    const edges = graph.edges
      .map((e) => (claimed.has(`${e.from}\u0000${e.to}`) ? { ...e, byMember: true } : e))
      .concat(added);
    return quietMembership({ nodes, edges }, openTypes);
  }

  /**
   * The drawing as it is without any type opened: its own nodes, and the edges
   * between them. What the project's tree is built from, so that opening a
   * type moves what is around it and never rearranges it.
   */
  function withoutMembers(graph) {
    const members = drawnMemberIds(graph);
    if (!members.size) return graph;
    return {
      nodes: graph.nodes.filter((n) => !members.has(n.id)),
      edges: graph.edges.filter((e) => !members.has(e.from) && !members.has(e.to)),
    };
  }

  /** Whether a node's members have anything of their own to draw. */
  function hasSomethingInside(members) {
    const names = new Set((members || []).map((m) => m.name));
    return (members || []).some(
      (m) =>
        (m.calls || []).some((c) => names.has(c) && c !== m.name) ||
        (m.points || []).length > 0
    );
  }

  /** Draw a type where it stands, leaving everything else where it is. */
  function openHere(id) {
    if (!cy || !artifactGraph || openTypes.includes(id) || isGroupId(id)) return false;
    if (insideOf || reachRoot) return false;
    const node = artifactGraph.nodes.find((n) => n.id === id);
    if (!node || !hasSomethingInside(node.members)) return false;
    openTypes.push(id);
    redrawOpen();
    return true;
  }

  /** Put a type back to one node. Without an id, the one opened last. */
  function closeHere(id) {
    if (!openTypes.length) return false;
    const want = id === undefined ? openTypes[openTypes.length - 1] : id;
    const at = openTypes.indexOf(want);
    if (at < 0) return false;
    openTypes.splice(at, 1);
    redrawOpen();
    return true;
  }

  /**
   * Build the drawing again with whatever is open, and leave the reader looking
   * where they were. The camera is kept by hand: the drawing is rebuilt from
   * its elements up, and a fresh canvas starts at its own zoom.
   */
  function redrawOpen() {
    if (!artifactGraph) return;
    const view = cy ? { zoom: cy.zoom(), pan: { ...cy.pan() } } : null;
    const grouped = withGroups(artifactGraph);
    memberGroupOf = grouped.groupOf;
    groupsById = grouped.groupById;
    fullGraph = withOpenTypes(grouped.graph, grouped.groupOf);
    ensureCy(fullGraph, visibleIdSet());
    applyView({ keepView: true });
    if (view && cy) cy.viewport(view);
  }

  /**
   * The way into a drawing of members: one nothing else in the type calls.
   *
   * Inside a type the most-called member is a utility. Measured on
   * sqlparser-ranger's `Parser`, whose 69 members make 342 calls, that is
   * `eat`, a one-line helper every rule uses, and centred there the grammar the
   * parser follows sits behind it. `sql_stmt_list`, which nothing calls, is
   * where a reader starts reading.
   */
  function wayIn(members, calls) {
    const called = new Set(calls.map((e) => e.to));
    let ways = members.filter((n) => !called.has(n.id)).map((n) => n.id);
    if (ways.length === 1) return ways[0];
    // With no way in at all — every member called by another, which is a type
    // whose members form a ring — the choice is over all of them, as it is for
    // a drawing with no root to start from.
    if (!ways.length) ways = members.map((n) => n.id);
    if (!ways.length) return null;
    // Several ways in: the criterion that chooses every other centre chooses
    // among them.
    const drawing = { nodes: members, edges: calls };
    return pickCenterAmong(ways, drawing, new Set(members.map((n) => n.id))) || ways[0];
  }

  /** Whether this node is made of members that call one another. */
  function isMadeOfMembers(members) {
    const names = new Set((members || []).map((m) => m.name));
    return (members || []).some((m) => (m.calls || []).some((c) => names.has(c) && c !== m.name));
  }

  /** Show what a type is made of, keeping the drawing to come back to. */
  function openInside(id) {
    if (!cy || !artifactGraph) return false;
    const node = artifactGraph.nodes.find((n) => n.id === id);
    if (!node || !isMadeOfMembers(node.members)) return false;
    const drawing = membersDrawing(node);
    const returning = {
      graph: artifactGraph,
      view: { zoom: cy.zoom(), pan: { ...cy.pan() } },
      fns: hideFunctions,
      name: node.name,
      members: (node.members || []).length,
      // What is drawn: one circle per name, which is fewer than the members
      // wherever a language overloads one. The type's own circle is not one
      // of them.
      drawn: drawing.nodes.filter((n) => n.member).length,
    };
    // Members are drawn as functions are, so a reader who had functions hidden
    // would be shown an empty view. Put back on the way out, as the right
    // button's view puts them back.
    if (hideFunctions) {
      hideFunctions = false;
      syncFnToggle();
    }
    setGraph(drawing, { insideCentre: id });
    insideOf = id;
    insideReturn = returning;
    syncReachStrip();
    return true;
  }

  /** Leave that view, and give back the drawing it was entered from. */
  function closeInside() {
    if (!insideOf || !insideReturn) return false;
    const back = insideReturn;
    insideOf = null;
    insideReturn = null;
    insideCentre = null;
    setGraph(back.graph);
    if (hideFunctions !== back.fns) {
      hideFunctions = back.fns;
      syncFnToggle();
      applyView({ keepView: true });
    }
    if (cy && back.view) cy.viewport(back.view);
    syncReachStrip();
    return true;
  }

  function closeReach() {
    if (!reachRoot) return false;
    reachRoot = null;
    reachIds = null;
    // Functions shown inside the view were a way of reading that view. Left
    // on, they would change the whole drawing the reader returns to, which is
    // meant to be the one they left. Restored rather than forced off, so a
    // reader who had them on before the view has them on again.
    if (hideFunctions !== reachReturnFns) {
      hideFunctions = reachReturnFns;
      syncFnToggle();
    }
    clearFocus();
    applyView({ keepView: true });
    if (reachReturnView && cy) cy.viewport(reachReturnView);
    reachReturnView = null;
    reachWholeFit = null;
    return true;
  }

  /**
   * The strip: which node the view was taken from, how much of the drawing it
   * kept, and the way back. The count is what makes a nearly empty screen an
   * answer — one circle under "1 / 8,763" is what the reader asked for, and
   * one circle under nothing is a viewer that looks broken.
   */
  function syncReachStrip() {
    if (!reachStripEl) return;
    reachStripEl.classList.toggle("hidden", !reachRoot && !insideOf);
    // Inside a type, with no node of the drawing pressed: the strip says whose
    // members these are and how many, which is the same answer in the same
    // place — the count of a view of 69 circles is 69 members, not a share of
    // a drawing they are not in.
    if (!reachRoot) {
      if (!insideOf || !insideReturn) return;
      if (reachNameEl) reachNameEl.textContent = insideReturn.name;
      if (reachCountEl) {
        const all = insideReturn.members;
        const here = insideReturn.drawn;
        const many = all.toLocaleString("en-US") + (all === 1 ? " member" : " members");
        // Where a name stands for several members the circles are fewer than
        // the panel's rows, and a count that mentioned only one of the two
        // numbers would look like the other one was wrong.
        reachCountEl.textContent =
          here === all ? many : `${here.toLocaleString("en-US")} of ${many}`;
      }
      return;
    }
    let name = reachRoot;
    if (isGroupId(reachRoot)) name = (groupsById[reachRoot] || {}).name || reachRoot;
    else if (fullGraph) {
      for (const n of fullGraph.nodes) {
        if (n.id === reachRoot) {
          name = n.name;
          break;
        }
      }
    }
    if (reachNameEl) reachNameEl.textContent = name;
    if (reachCountEl) {
      const shownHere = visibleIdSet().size;
      const shownWhole = visibleAmong(null).size;
      reachCountEl.textContent =
        shownHere.toLocaleString("en-US") + " / " + shownWhole.toLocaleString("en-US");
    }
  }

  /**
   * Make the focused node the centre, or hand the centre back if it already
   * is one.
   *
   * The centre is named in the artifact's own terms, not the drawing's: a
   * group stands for several classes and cannot be one of them, so asking for
   * a group asks for the class it was folded from.
   *
   * Pressing it again on the node that is already the centre is how a reader
   * gets back to the automatic pick. Without it the only way back is the
   * panel's Reset, which returns every other setting too — so undoing one
   * keypress would cost the reader their colours.
   */
  function centreOnFocus() {
    // The right button's view has one subject, and this key would name another.
    if (reachRoot) return false;
    // Inside a type, the centre is the way in, and a member's id names nothing
    // in any artifact — stored as a setting it would follow the reader to
    // every project as a centre none of them has.
    if (insideOf) return false;
    if (!cy || !focusId) return false;
    const node = cy.getElementById(focusId);
    if (node.empty()) return false;
    const want = isGroupId(focusId)
      ? ((groupsById[focusId] || {}).members || [focusId])[0]
      : focusId;
    settings.centre = settings.centre === want ? "" : want;
    // Read `focusId` before this, not after: letting go is part of the act.
    // Handing the centre back is then the same gesture as naming it — point
    // at the node, press the key — rather than a second press on a node the
    // reader can no longer see they are still holding.
    clearFocus();
    syncSettingControls();
    // A setting like any other: the drawing shows it now, the store hears
    // about it when the reader presses Save.
    applyCost("layout");
    return true;
  }

  /**
   * Nothing is shown until both halves are in: what to draw, and whether the
   * star tile is coming. Either one alone would put something on screen that
   * the other then changes, and the panel reads as assembling itself rather
   * than opening. See `body.ready` in graph.css.
   */
  let viewDecided = false;
  function revealWhenReady() {
    if (!viewDecided || !starfieldSettled) return;
    if (document.body && document.body.classList) {
      document.body.classList.add("ready");
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) return;
    if (message.command === "setSettings") {
      // Sent before the graph when the host has it in hand, and possibly after
      // — nothing depends on the order. Applied late means redrawing what has
      // already been drawn; applied early means the first drawing is already
      // the reader's own. It is not handed back: this is what the host said.
      applyCost(applySettings(message.settings));
      return;
    }
    if (message.command === "setComment") {
      // Stale by the time it arrived: the reader has moved on, and this is
      // now an answer about a node they are no longer looking at.
      if (message.id === focusId) showComment(message.id, message.lines);
      return;
    }
    if (message.command === "setGraph") {
      // A re-send in case the first one was missed. If it was not missed,
      // rebuilding the graph would throw away a drawing that is already on
      // screen and make the reader watch it appear twice. Only the reply to
      // `ready` carries this, so an actual edit still always applies.
      if (message.reason === "ready" && fullGraph) return;
      setGraph(message.graph);
    } else if (message.command === "setError") {
      setError(message.message);
    } else {
      return;
    }
    // Whatever the panel is going to show, it is decided by here — a drawing,
    // the empty-state line, or an error.
    viewDecided = true;
    revealWhenReady();
  });

  // The host sends the graph in the same tick as it sets `webview.html`, which
  // is what makes a warm webview draw without a visible gap — but a webview
  // being built for the first time is still loading then, has no listener yet,
  // and that message lands nowhere. Without asking, the panel would stay empty
  // until the file is opened a second time. Asking from here cannot be too early, and it is
  // asked again whenever the webview reloads (hiding the tab discards it, and
  // `resolveCustomTextEditor` does not run again on the way back).
  vscode.postMessage({ command: "ready" });

  // Fired off at startup rather than awaited: the graph draws immediately over
  // the void colour, and the stars appear a frame later when the tile arrives.
  loadStarfield();

  document.body.tabIndex = 0;
  document.body.focus();
})();
