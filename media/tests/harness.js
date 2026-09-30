"use strict";

// Loads media/graph.js — a browser IIFE with no exports — into a sandbox so its
// layout functions can be called directly.
//
// The layout is the part of this project with no other guard: it
// has no types, no runtime errors when it is wrong, and a defect in it shows up
// only as a drawing that looks slightly off. It belongs in the repo.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GRAPH_JS = path.join(__dirname, "..", "graph.js");
const GRAPH_DOCUMENT_TS = path.join(__dirname, "..", "..", "src", "graphDocument.ts");

/** Names lifted out of the IIFE's closure and handed to the tests. */
const EXPORTED = [
  // layout
  "computeClassRingPositions",
  // what the right button shows
  "outwardFrom",
  "REACH_FAN",
  // what a type is made of
  "membersDrawing",
  "wayIn",
  "isMadeOfMembers",
  "hasSomethingInside",
  "memberNodeId",
  // an open type's members as a tree, and the room made for it
  "memberTreeOf",
  "placeMemberTree",
  "makeRoomForMembers",
  "MEMBER_STEP",
  "MEMBER_SPREAD",
  // the stylesheet, as something that can be asked for again
  "graphStyle",
  "settingAt",
  "groupSameNamedSiblings",
  "labelsForDrawn",
  "distinguishingTails",
  "disambiguationPath",
  "isGroupId",
  "GROUP_PREFIX",
  "layoutOneClassComponent",
  "leafCounts",
  "bfsParents",
  "classOnlyAdj",
  "undirectedAdj",
  "isTreeVertex",
  "isTreeVertexSatelliteCandidate",
  "isFnOnlyHelperClass",
  "pickTopClass",
  "pickCenterAmong",
  "rankCentres",
  "graphHasTypes",
  "isTypeKind",
  "kindsInGraph",
  "syncKindRows",
  "placeAllSatellites",
  "satelliteOrbit",
  "radiusForChord",
  "freeSeat",
  "makeOccupancy",
  // wheel zoom
  "wheelScrollPixels",
  "ZOOM_DOUBLING_SCROLL",
  "WHEEL_LINE_PIXELS",
  "satelliteDrawOrder",
  "bodyRadius",
  // constants the assertions are written against
  "RING_RADIUS",
  "SAT_RADIUS",
  "SAT_STEP",
  "SAT_GAP",
  "NODE_DIAMETER",
  "SAT_DIAMETER",
  "MIN_SEPARATION",
  "UNARY_STEP_DECAY",
  "COMPONENT_GAP",
  "BAND_STEP",
  "TARGET_ASPECT",
  "UNLINKED_GAP",
  "SECTOR_ORIGIN",
  "VERTEX_PENALTY",
];

/** A 2D context where everything is a no-op and every property sticks. */
/** Reassigned as the viewer runs; read through getters, never captured. */
const LIVE = [
  "cy",
  // Where the layout put every node, drawn or not. The drawing holds only what
  // it shows, so a question about arrangement has to be asked of the layout.
  "lastLayout",
  "fullGraph",
  "focusId",
  "pendingJumpId",
  "centerClassId",
  "hideFunctions",
  "memberGroupOf",
  "groupsById",
  "nodeGroups",
  "ringGroups",
  "centerIds",
  "visibleIdSet",
  "visibleCenter",
  "searchMatches",
  "activateFocus",
  "withGroups",
  "layoutGraph",
  // the view of one type's members
  "insideOf",
  "openInside",
  "closeInside",
  // a type opened where it stands
  "openTypes",
  "openHere",
  "closeHere",
];

/** A 2D context where everything is a no-op and every property sticks. */
function noopContext() {
  const store = { canvas: { width: 0, height: 0 } };
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createPattern") return () => ({});
      if (prop === "getImageData") return () => ({ data: [] });
      if (prop === "measureText") return () => ({ width: 0 });
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function stubElement(id) {
  const classes = new Set();
  const el = {
    id,
    tagName: "DIV",
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    tabIndex: 0,
    // Custom properties are kept, and readable back. A bare object would
    // accept every `setProperty` silently and answer every read with nothing,
    // so an assertion that a chosen colour reached the drawing could not fail
    // — the same reason the attribute map and the state store keep what they
    // are given.
    style: (() => {
      const props = {};
      return {
        props,
        setProperty(name, value) {
          if (value === null || value === undefined || value === "") delete props[name];
          else props[name] = String(value);
        },
        removeProperty(name) {
          delete props[name];
        },
        getPropertyValue(name) {
          return Object.prototype.hasOwnProperty.call(props, name) ? props[name] : "";
        },
      };
    })(),
    dataset: {},
    children: [],
    // A real element has both, and cytoscape's teardown walks `childNodes`
    // while its own code walks `children`.
    childNodes: [],
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c);
        else classes.delete(c);
        return want;
      },
      contains: (c) => classes.has(c),
    },
    // `Node.contains`, not `classList.contains` — a handler bound on an
    // ancestor asks whether the event happened inside a particular element,
    // and a stub without it would let the guard be written and never run.
    contains(node) {
      if (!node) return false;
      if (node === el) return true;
      return [...this.children, ...this.childNodes].some(
        (k) => k && typeof k.contains === "function" && k.contains(node)
      );
    },
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, event) {
      // The defaults are what a real event always carries and a test never
      // wants to restate: which element the listener is bound to, and the two
      // methods a handler calls before doing anything. A test that needs a
      // different value passes it and wins.
      const ev = Object.assign(
        {
          type,
          target: el,
          currentTarget: el,
          preventDefault() {},
          stopPropagation() {},
        },
        event || {}
      );
      for (const fn of this.listeners[type] || []) fn(ev);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...kids) {
      this.children = kids;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
    },
    remove() {},
    // Attributes are kept rather than discarded. The viewer reads its own
    // `data-collapsed` back to decide which way a toggle goes, and a stub that
    // forgets what was set makes that toggle read as "always collapsed" — a
    // test passing on a state the viewer never has.
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    // Descendants a test wants the viewer to find, keyed by the selector the
    // viewer looks them up with. Nothing here parses CSS: the point is that
    // code which wires a group of controls gets a group to wire.
    query: {},
    querySelector(sel) {
      const list = this.query[sel];
      return list && list.length ? list[0] : null;
    },
    querySelectorAll(sel) {
      return this.query[sel] || [];
    },
    focus() {},
    blur() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 1200,
      height: 800,
      right: 1200,
      bottom: 800,
    }),
    // A canvas is asked for a 2D context by the starfield and by the exporter.
    // Every drawing call is a no-op and every property is writable: the tests
    // are about what the viewer decides, never about what it paints, and
    // enumerating the context method by method only produces a new "not a
    // function" the next time the painting code grows.
    getContext: () => noopContext(),
    toDataURL: () => "data:image/png;base64,",
    width: 0,
    height: 0,
  };
  return el;
}

/**
 * @param {{ starfield?: boolean }} [opts]
 */
/**
 * Register stub elements for the settings panel's controls, read out of the
 * markup `graphDocument.ts` serves.
 *
 * Not a DOM: it scans tags for the attributes the viewer looks controls up by,
 * and files each one under the selectors the viewer actually uses. That keeps
 * the panel's tests honest — a control renamed in the markup and not in the
 * wiring shows up as a test that stops finding it, rather than as a stub list
 * that still agrees with the wiring and no longer with the page.
 */
function seedPanelControls(settings) {
  const src = fs.readFileSync(GRAPH_DOCUMENT_TS, "utf8");
  const at = src.indexOf('id="settings"');
  if (at === -1) throw new Error("graphDocument.ts does not declare #settings");
  const panel = src.slice(at, src.indexOf("</aside>", at));

  const bySelector = {};
  const file = (sel, el) => (bySelector[sel] = bySelector[sel] || []).push(el);

  for (const tag of panel.match(/<(input|select|button|span)\b[^>]*>/g) || []) {
    const attr = (name) => {
      const m = tag.match(new RegExp(name + '="([^"]*)"'));
      return m ? m[1] : null;
    };
    const setting = attr("data-setting");
    const revert = attr("data-revert");
    const warn = attr("data-contrast-warn");
    const name = attr("name");
    if (!setting && !revert && !warn && !name) continue;

    const el = stubElement(setting || revert || warn || name);
    el.type = attr("type") || "";
    if (name) el.name = name;
    if (attr("value") !== null) el.value = attr("value");
    el.checked = /\bchecked\b/.test(tag);
    el.hidden = /\bhidden\b/.test(tag);
    if (setting) el.setAttribute("data-setting", setting);
    if (/\bdata-choice\b/.test(tag)) el.setAttribute("data-choice", "");
    if (/\bdata-readout\b/.test(tag)) el.setAttribute("data-readout", "");
    if (revert) el.setAttribute("data-revert", revert);
    if (warn) el.setAttribute("data-contrast-warn", warn);

    if (setting) file("[data-setting]", el);
    if (revert) file("[data-revert]", el);
    if (warn) file("[data-contrast-warn]", el);
    if (name) file('input[name="' + name + '"]', el);
  }
  Object.assign(settings.query, bySelector);
}

function loadGraphJs(opts) {
  const options = opts || {};
  let source = fs.readFileSync(GRAPH_JS, "utf8");

  // The file ends with the IIFE's own `})();`. Injecting the export assignment
  // just before it is the only way to reach a closure that exports nothing —
  // and it means the tests run the shipped file, not a copy of it.
  const tail = "})();";
  const at = source.lastIndexOf(tail);
  if (at === -1) throw new Error("graph.js does not end with an IIFE");
  const exportLine =
    "\n;globalThis.__internals = { " +
    EXPORTED.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(", ") +
    " };\n" +
    // Mutable state has to be read through a getter, not captured once: `cy`
    // and `focusId` are reassigned on every view change, and a snapshot taken
    // at load time would report the state the viewer had before it drew
    // anything — a test that passes by reading a stale null.
    "\n;globalThis.__live = { " +
    LIVE.map((n) => `get ${n}() { return ${n}; }`).join(", ") +
    " };\n";
  source = source.slice(0, at) + exportLine + source.slice(at);

  const elements = new Map();
  const getElementById = (id) => {
    // cytoscape runs headless exactly when it is given no container, and the
    // viewer already guards every use of this element. Withholding it is what
    // makes the real library usable here.
    if (options.headless && id === "cy") return null;
    if (!elements.has(id)) elements.set(id, stubElement(id));
    return elements.get(id);
  };

  const posted = [];
  /**
   * The webview's own scratch space.
   *
   * `options.state` seeds it, standing for a panel that has been open before —
   * it holds the rail's collapsed flag and nothing else. A reader who has
   * been here before is a different thing and arrives as a `setSettings`
   * message, the host keeping settings rather than the panel.
   */
  const webviewState = { value: options.state };
  const warnings = [];
  const timers = [];

  // The settings panel finds its controls by selector, and there are enough of
  // them that a hand-written list here would be a copy of the markup that
  // drifts from it. So the stubs are built from the shipped markup itself:
  // what the tests drive is what the extension serves.
  seedPanelControls(getElementById("settings"));

  const body = stubElement("body");
  // The same object `getElementById` hands out, because that is what it is:
  // the viewer reads variables off `document.documentElement`, and a test that
  // set them on a second stub of the same name would be setting them where
  // nothing reads.
  const documentElement = getElementById("html");

  // Named so they can be reinstated after cytoscape loads; see below.
  const rafStub = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const setTimeoutStub = (fn, ms) => {
    timers.push(fn);
    return { ms };
  };

  const sandbox = {
    console: {
      log: () => {},
      warn: (...a) => warnings.push(a.join(" ")),
      error: (...a) => warnings.push(a.join(" ")),
    },
    acquireVsCodeApi: () => ({
      postMessage: (m) => posted.push(m),
      // A real store, so what the viewer chooses to remember can be read back.
      // Returning undefined from `getState` would make every "the choice
      // persists" claim untestable, and a claim that cannot fail is not being
      // tested.
      getState: () => webviewState.value,
      setState: (v) => {
        webviewState.value = v;
      },
    }),
    // What was set on that element, which is what the viewer reads back
    // through `cssVar`. Nothing here cascades: a variable is set on the root
    // and read from the root, which is the only use the viewer makes of it.
    getComputedStyle: (el) => ({
      getPropertyValue: (name) =>
        el && el.style && el.style.getPropertyValue ? el.style.getPropertyValue(name) : "",
    }),
    Image: function Image() {
      this.src = "";
      this.onload = null;
      this.onerror = null;
    },
    fetch: () => Promise.reject(new Error("no network in tests")),
    requestAnimationFrame: rafStub,
    cancelAnimationFrame: () => {},
    setTimeout: setTimeoutStub,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    // Set below for headless runs, by evaluating the library inside this same
    // sandbox — see the note there. For layout runs it stays a tripwire.
    cytoscape: function cytoscape() {
      throw new Error("cytoscape was constructed — the layout tests should not need it");
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.devicePixelRatio = 1;
  sandbox.document = {
    documentElement,
    body,
    getElementById,
    createElement: (tag) => stubElement(tag),
    createElementNS: (_ns, tag) => stubElement(tag),
    addEventListener: (t, fn) => body.addEventListener(t, fn),
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    hasFocus: () => true,
    get activeElement() {
      return body;
    },
  };
  sandbox.addEventListener = (type, fn) => {
    (sandbox.__listeners[type] = sandbox.__listeners[type] || []).push(fn);
  };
  sandbox.removeEventListener = () => {};
  sandbox.__listeners = {};

  vm.createContext(sandbox);

  if (options.headless) {
    // Evaluated *inside* the sandbox rather than required from out here.
    //
    // cytoscape's entry point does `plainObject(options)` before building
    // anything, and an object literal created in the vm has the vm realm's
    // `Object.prototype` — so a library loaded in the outer realm decides the
    // viewer passed it something that is not an options object and silently
    // returns undefined. The failure surfaces five calls later as
    // "Cannot read properties of undefined (reading 'on')", which says nothing
    // about realms.
    //
    // This is the same 3.34.1 the webview loads from its script tag, not a
    // stub: z-order, style mappings and element lookup are where this file's
    // bugs hide, and a stub would agree with whatever the code did.
    const CYTOSCAPE = path.join(
      __dirname, "..", "..", "node_modules", "cytoscape", "dist", "cytoscape.cjs.js"
    );
    const shim = { exports: {} };
    sandbox.module = shim;
    sandbox.exports = shim.exports;
    vm.runInContext(fs.readFileSync(CYTOSCAPE, "utf8"), sandbox, {
      filename: "cytoscape.cjs.js",
    });
    const real = shim.exports.default || shim.exports;
    delete sandbox.module;
    delete sandbox.exports;
    // `window` is this same object, so a global the library defines while
    // loading — its own `requestAnimationFrame` shim — becomes the very
    // `window.requestAnimationFrame` that shim delegates to. It calls itself
    // until the stack runs out, in a frame that names neither the harness nor
    // the viewer. Putting the stubs back is what keeps time under the test's
    // control.
    sandbox.requestAnimationFrame = rafStub;
    sandbox.setTimeout = setTimeoutStub;
    if (typeof real !== "function") {
      throw new Error("cytoscape did not load into the sandbox");
    }
    // The viewer mounts into `#cy`, which does not exist here. Without a
    // container cytoscape still reaches for the canvas renderer; naming the
    // null renderer is what makes it run without a DOM. The options object is
    // the viewer's own, passed straight through, so it keeps the vm realm's
    // prototype and still reads as a plain object on the other side.
    // Always the null renderer. There is no canvas here and no layout engine
    // behind these stubs, so a container being present says nothing about
    // whether one could be drawn into. Anything that built a second instance
    // and passed it a container would otherwise reach for the canvas renderer
    // and take the whole suite down.
    sandbox.cytoscape = function (options) {
      if (options && typeof options === "object") {
        options.renderer = { name: "null" };
      }
      return real(options);
    };
  }

  vm.runInContext(source, sandbox, { filename: "graph.js" });

  const internals = sandbox.__internals;
  const missing = EXPORTED.filter((n) => internals[n] === undefined);
  if (missing.length) {
    // Not a warning: a missing constant silently turns every comparison it is
    // in into NaN, and a NaN comparison is false — so the run would report
    // zero failures precisely because it tested nothing.
    throw new Error("graph.js does not define: " + missing.join(", "));
  }

  if (options.starfield === false) timers.length = 0;

  return {
    ...internals,
    live: sandbox.__live,
    /** `document.documentElement` — where the palette's variables are set. */
    root: documentElement,
    /** What the viewer has asked the host to remember. */
    get state() {
      return webviewState.value;
    },
    sandbox,
    posted,
    warnings,
    runTimers() {
      const due = timers.splice(0, timers.length);
      for (const fn of due) fn();
    },
    send(message) {
      for (const fn of sandbox.__listeners.message || []) fn({ data: message });
    },
    el: getElementById,
    body,
  };
}

// --- assertions -------------------------------------------------------------

let passes = 0;
const failures = [];
let currentSuite = "";

function suite(name) {
  currentSuite = name;
}

function ok(cond, what) {
  if (cond) passes++;
  else failures.push(`${currentSuite} — ${what}`);
}

function eq(actual, expected, what) {
  ok(
    Object.is(actual, expected),
    `${what} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function near(actual, expected, tol, what) {
  ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${what} — expected ${expected} ±${tol}, got ${actual}`
  );
}

function report() {
  const total = passes + failures.length;
  if (failures.length) {
    console.log(`\n${failures.length} / ${total} failed:\n`);
    for (const f of failures) console.log("  ✗ " + f);
    console.log("");
    process.exitCode = 1;
  } else {
    console.log(`all ${passes} assertions passed`);
  }
}

// --- graph builders ---------------------------------------------------------

/** A tree of classes: `children` maps id → child ids. */
function classTree(children, opts) {
  const options = opts || {};
  const ids = new Set(Object.keys(children));
  for (const kids of Object.values(children)) for (const k of kids) ids.add(k);
  const nodes = [...ids].map((id) => ({
    id,
    name: id,
    kind: options.kind || "class",
    file: options.file || "m.py",
    line: 1,
  }));
  const edges = [];
  for (const [p, kids] of Object.entries(children))
    for (const k of kids) edges.push({ from: p, to: k, kind: "uses" });
  return { nodes, edges };
}

/** A perfectly balanced tree: `branch` children per node, `depth` levels deep. */
function balancedTree(branch, depth) {
  const children = {};
  let frontier = ["r"];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const p of frontier) {
      children[p] = [];
      for (let i = 0; i < branch; i++) {
        const id = `${p}_${i}`;
        children[p].push(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  return classTree(children);
}

function allVisible(graph) {
  return new Set(graph.nodes.map((n) => n.id));
}

module.exports = {
  loadGraphJs,
  suite,
  ok,
  eq,
  near,
  report,
  classTree,
  balancedTree,
  allVisible,
  get passes() {
    return passes;
  },
  get failures() {
    return failures;
  },
};
