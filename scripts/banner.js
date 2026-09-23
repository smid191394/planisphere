#!/usr/bin/env node
"use strict";

// The README's banner: the mascot and the name, over the star field the viewer
// draws behind every graph.
//
//   node scripts/banner.js
//
// Laid out in a headless Chromium — the same one the screenshots use — so that
// the text is set by a browser rather than by hand, and written as a
// progressive JPEG for the same reason the screenshots are.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "images", "banner.jpg");
const SIZE = { width: 1200, height: 420 };

const html = (starfield, sirius) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        width: ${SIZE.width}px;
        height: ${SIZE.height}px;
        display: flex;
        align-items: center;
        gap: 56px;
        padding: 0 72px;
        box-sizing: border-box;
        background: #05070d url("${starfield}") center / cover;
        font-family: "DejaVu Sans", system-ui, sans-serif;
        color: #ffffff;
        overflow: hidden;
      }
      /* The drawing's own background is darkest where its labels sit. */
      body::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, rgba(5, 7, 13, 0.82) 0%, rgba(5, 7, 13, 0.62) 45%, rgba(5, 7, 13, 0.35) 100%);
      }
      .mascot, .words { position: relative; }
      .mascot { width: 300px; filter: drop-shadow(0 0 40px rgba(255, 235, 59, 0.18)); }
      .name { font-size: 84px; font-weight: bold; letter-spacing: 1px; line-height: 1; }
      .line {
        margin-top: 18px;
        font-size: 26px;
        color: #E91E63;
        letter-spacing: 3px;
        text-transform: uppercase;
      }
      .languages { margin-top: 22px; font-size: 21px; color: #b8c2d0; letter-spacing: 1px; }
    </style>
  </head>
  <body>
    <img class="mascot" src="${sirius}" alt="" />
    <div class="words">
      <div class="name">Planisphere</div>
      <div class="line">Read a codebase as one drawing</div>
      <div class="languages">Python &nbsp;·&nbsp; TypeScript &nbsp;·&nbsp; Go &nbsp;·&nbsp; Rust &nbsp;·&nbsp; Java</div>
    </div>
  </body>
</html>`;

async function main() {
  const sirius = path.join(ROOT, "docs", "images", "sirius.png");
  const starfield = path.join(ROOT, "media", "starfield.jpg");
  for (const f of [sirius, starfield]) {
    if (!fs.existsSync(f)) throw new Error(`${f} is missing`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-banner-"));
  const page = path.join(dir, "banner.html");
  fs.writeFileSync(page, html("file://" + starfield, "file://" + sirius));

  const { chromium } = require("playwright-core");
  const browser = await chromium.launch();
  try {
    const pg = await browser.newPage({ viewport: SIZE });
    await pg.goto("file://" + page);
    await pg.waitForLoadState("networkidle");
    const shot = await pg.screenshot({ type: "png" });
    await sharp(shot).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toFile(OUT);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`wrote docs/images/banner.jpg (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
