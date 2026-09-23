#!/usr/bin/env node
"use strict";

// The README's banner: the mascot, the name, and the constellation the mascot
// is named after, over the star field the viewer draws behind every graph.
//
// Canis Major is drawn the way the viewer draws a graph — nodes joined by the
// dashed line it uses for a reference — with Sirius the brightest of them, as
// it is in the sky and as the centre of a drawing is.
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

/** What the mascot has hanging off it, in the colours the drawing gives them. */
const LANGUAGES = [
  { name: "Python", colour: "#1E88E5" },
  { name: "TypeScript", colour: "#00BCD4" },
  { name: "Go", colour: "#C0CA33" },
  { name: "Rust", colour: "#7E57C2" },
  { name: "Java", colour: "#FB8C00" },
];

/**
 * The languages as a ring of nodes around the mascot, drawn as the viewer draws
 * a node and the dashed line that reaches it — the mascot standing where the
 * centre of a drawing stands.
 */
function ring(cx, cy, radius) {
  const marks = LANGUAGES.map(({ name, colour }, i) => {
    // From the top, so that no two labels share a side by accident.
    const a = ((-90 + (i * 360) / LANGUAGES.length) * Math.PI) / 180;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    // The label sits outside the ring, on the side the node is on.
    const outward = Math.cos(a) >= -0.2;
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
        stroke="${colour}" stroke-width="1.4" stroke-dasharray="6 4" opacity="0.5" />
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${colour}"
        stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.5" />
      <text x="${(x + (outward ? 17 : -17)).toFixed(1)}" y="${(y + 6).toFixed(1)}" fill="#dbe3ee"
        text-anchor="${outward ? "start" : "end"}" font-family="DejaVu Sans, sans-serif" font-size="19">${name}</text>`;
  }).join("\n");
  return `<svg class="ring" width="${SIZE.width}" height="${SIZE.height}" xmlns="http://www.w3.org/2000/svg">
    ${marks}
  </svg>`;
}

const html = (starfield, sirius) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        width: ${SIZE.width}px;
        height: ${SIZE.height}px;
        background: #05070d url("${starfield}") center / cover;
        font-family: "DejaVu Sans", system-ui, sans-serif;
        color: #ffffff;
        position: relative;
        overflow: hidden;
      }
      /* The drawing's background is darkest where its labels sit. */
      .veil {
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, rgba(5, 7, 13, 0.8) 0%, rgba(5, 7, 13, 0.5) 55%, rgba(5, 7, 13, 0.3) 100%);
      }
      .ring { position: absolute; left: 0; top: 0; }
      .mascot { position: absolute; left: 170px; top: 96px; width: 232px; filter: drop-shadow(0 0 46px rgba(255, 235, 59, 0.22)); }
      .words { position: absolute; left: 700px; top: 130px; }
      .name { font-size: 66px; font-weight: bold; letter-spacing: 1px; line-height: 1; }
      .line { margin-top: 16px; font-size: 20px; color: #E91E63; letter-spacing: 3px; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <div class="veil"></div>
    ${ring(286, 210, 168)}
    <img class="mascot" src="${sirius}" alt="" />
    <div class="words">
      <div class="name">Planisphere</div>
      <div class="line">Read a codebase as one drawing</div>
    </div>
  </body>
</html>`;

async function main() {
  // A mascot and a destination may be given, to try another picture without
  // replacing the one the README carries.
  const [mascotArg, outArg] = process.argv.slice(2);
  const sirius = mascotArg ? path.resolve(mascotArg) : path.join(ROOT, "docs", "images", "sirius.png");
  const out = outArg ? path.resolve(outArg) : OUT;
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
    await sharp(shot).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toFile(out);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`wrote ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
