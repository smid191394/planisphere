#!/usr/bin/env node
"use strict";

// The README's screenshots, made from the viewer's own page.
//
//   npm run compile && node scripts/screenshots.js
//
// The page is the one the editor shows — `buildGraphWebviewHtml`, the shipped
// graph.js, graph.css and star field — with a stand-in for the host: it sends
// the graph, and answers a request for a node's comment the way the host does,
// with `leadingComment` over the source file. So a change to how the drawing
// looks shows up in the next run.
//
// The drawings are two fixtures from the external corpus, which has to be
// cloned first (see docs/languages.md). Playwright drives a headless Chromium,
// installed once with `npx playwright-core install chromium`.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "images");
const VIEWPORT = { width: 1600, height: 1000 };

const SHOTS = [
  {
    // What Planisphere is: one framework's structure as a single drawing.
    file: "overview.jpg",
    artifact: "fixtures/python/fastapi/planisphere.json",
    frame: "primary-group",
  },
  {
    // What one click gives: the node's neighbours, its comment and its methods.
    file: "focus.jpg",
    artifact: "fixtures/go/cobra/planisphere.json",
    click: "Command",
  },
];

/** The compiled host modules, loaded with a stand-in for the `vscode` module. */
function hostModules() {
  const vscode = { Uri: { joinPath: (base, ...p) => ({ fsPath: path.join(base.fsPath, ...p) }) } };
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode" ? vscode : load.call(this, request, ...rest);
  };
  try {
    return {
      ...require(path.join(ROOT, "out", "graphDocument.js")),
      ...require(path.join(ROOT, "out", "parseGraphDocument.js")),
      ...require(path.join(ROOT, "out", "leadingComment.js")),
    };
  } finally {
    Module._load = load;
  }
}

/**
 * graph.js with its drawing reachable from outside, by the same insertion the
 * layout suite makes before the closure's own `})();`.
 */
function reachableGraphJs(dir) {
  const source = fs.readFileSync(path.join(ROOT, "media", "graph.js"), "utf8");
  const tail = "})();";
  const at = source.lastIndexOf(tail);
  if (at === -1) throw new Error("graph.js does not end with an IIFE");
  const file = path.join(dir, "graph.js");
  const reach = "\n;window.__cy = () => cy;\nwindow.__nodeGroups = () => nodeGroups;\n";
  fs.writeFileSync(file, source.slice(0, at) + reach + source.slice(at));
  return file;
}

/** The viewer's page for one artifact, written to `dir`. */
function page(host, dir, artifact) {
  const graphJs = reachableGraphJs(dir);
  const webview = {
    cspSource: "file:",
    asWebviewUri: (uri) =>
      "file://" + (uri.fsPath === path.join(ROOT, "media", "graph.js") ? graphJs : uri.fsPath),
  };
  let html = host.buildGraphWebviewHtml(webview, { fsPath: ROOT });
  const nonce = html.match(/nonce-([A-Za-z0-9]+)/)[1];

  const parsed = host.parseGraphDocument(fs.readFileSync(path.join(ROOT, artifact), "utf8"));
  if (!parsed.ok) throw new Error(`${artifact}: ${parsed.error}`);

  // What the host would answer for each node, worked out here: the page cannot
  // read the source files itself.
  const comments = {};
  for (const n of parsed.graph.nodes) {
    const line = n.line || 1;
    try {
      const lines = fs.readFileSync(n.file, "utf8").split(/\r?\n/);
      comments[`${n.file}:${line}`] = host.leadingComment(lines, line);
    } catch {
      // A file that cannot be read has no comment, as it has none in the editor.
    }
  }

  const standIn = `<script nonce="${nonce}">
window.acquireVsCodeApi = () => ({
  postMessage(m) {
    if (m && m.command === "getComment") {
      const lines = ${JSON.stringify(comments)}[m.file + ":" + (m.line || 1)] || [];
      setTimeout(() => window.postMessage({ command: "setComment", id: m.id, lines }, "*"), 0);
    }
  },
  getState() { return undefined; },
  setState() {},
});
window.addEventListener("load", () => {
  window.postMessage({ command: "setSettings", settings: {} }, "*");
  window.postMessage({ command: "setGraph", graph: ${JSON.stringify(parsed.graph)} }, "*");
});
</script>`;
  html = html.replace(/<script nonce="[^"]+" src=/, (m) => standIn + "\n  " + m);
  const file = path.join(dir, "page.html");
  fs.writeFileSync(file, html);
  return file;
}

async function shoot(browser, host, shot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-shot-"));
  const pg = await browser.newPage({ viewport: VIEWPORT });
  pg.on("pageerror", (e) => console.error(`${shot.file}: ${e.message}`));
  await pg.goto("file://" + page(host, dir, shot.artifact));

  // Drawn, and the opening frame settled: the panel stays closed until every
  // part of it is ready.
  await pg.waitForFunction(() => window.__cy && window.__cy() && window.__cy().nodes(":visible").length > 0);
  await pg.waitForTimeout(1500);

  // The search field floats over the drawing; a picture of the drawing is
  // clearer without it.
  // Set through the element, which the page's content policy allows where an
  // added stylesheet is refused.
  await pg.evaluate(() => {
    document.getElementById("searchbar").style.display = "none";
  });

  if (shot.frame === "primary-group") {
    // Framed on the tree the graph starts from. Unconnected nodes sit in a
    // cluster of their own beside it, and would widen the picture to twice its
    // height with almost nothing in it.
    await pg.evaluate(() => {
      const cy = window.__cy();
      const groups = window.__nodeGroups();
      const primary = cy.nodes(".primary")[0];
      const group = groups[primary.id()] || primary.id();
      const inGroup = (n) => (groups[n.id()] || n.id()) === group;
      cy.nodes(":visible").filter((n) => !inGroup(n)).style("display", "none");
      cy.fit(cy.nodes(":visible"), 40);
    });
    await pg.waitForTimeout(800);
  }

  if (shot.click) {
    const at = await pg.evaluate((name) => {
      const cy = window.__cy();
      // The label is the name, with the path that tells it apart from another
      // symbol of the same name where there is one.
      const node = cy
        .nodes(":visible")
        .filter((n) => n.data("label") === name || String(n.data("label")).endsWith("/" + name))[0];
      if (!node) return null;
      const box = cy.container().getBoundingClientRect();
      const p = node.renderedPosition();
      return { x: box.left + p.x, y: box.top + p.y };
    }, shot.click);
    if (!at) throw new Error(`${shot.artifact}: no visible node named ${shot.click}`);
    await pg.mouse.click(at.x, at.y);
    await pg.waitForSelector("#comment:not(.hidden)");
    // Framed on the node and what it touches, in the part of the drawing the
    // comment panel does not cover.
    const panel = await pg.locator("#comment").boundingBox();
    await pg.evaluate(
      ({ name, covered }) => {
        const cy = window.__cy();
        const node = cy
          .nodes(":visible")
          .filter((n) => n.data("label") === name || String(n.data("label")).endsWith("/" + name))[0];
        cy.fit(node.closedNeighborhood(":visible"), 80);
        cy.panBy({ x: -covered / 2, y: 0 });
      },
      { name: shot.click, covered: panel.width + 24 }
    );
    await pg.waitForTimeout(800);
  }

  const box = await pg.locator("#cy").boundingBox();
  fs.mkdirSync(OUT, { recursive: true });
  // JPEG, not PNG: the star field is a full page of noise, which a lossless
  // format has to record dot by dot — the same picture is 1.6 MB as a PNG and
  // 340 KB here, and a reader watches a PNG that size paint from the top down.
  await pg.screenshot({ path: path.join(OUT, shot.file), clip: box, type: "jpeg", quality: 88 });
  await pg.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`wrote docs/images/${shot.file} (${Math.round(fs.statSync(path.join(OUT, shot.file)).size / 1024)} KB)`);
}

async function main() {
  for (const shot of SHOTS) {
    if (!fs.existsSync(path.join(ROOT, shot.artifact))) {
      throw new Error(`${shot.artifact} is missing: clone the fixture and generate its artifact first`);
    }
  }
  const { chromium } = require("playwright-core");
  const host = hostModules();
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  try {
    for (const shot of SHOTS) await shoot(browser, host, shot);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
