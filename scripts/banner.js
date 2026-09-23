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

/** Canis Major, by right ascension (hours), declination (degrees) and magnitude. */
const STARS = {
  sirius: { ra: 6.752, dec: -16.716, mag: -1.46 },
  mirzam: { ra: 6.378, dec: -17.956, mag: 1.98 },
  muliphein: { ra: 7.064, dec: -15.633, mag: 4.11 },
  wezen: { ra: 7.14, dec: -26.393, mag: 1.83 },
  adhara: { ra: 6.977, dec: -28.972, mag: 1.5 },
  furud: { ra: 6.339, dec: -30.063, mag: 3.02 },
  aludra: { ra: 7.401, dec: -29.303, mag: 2.45 },
  theta: { ra: 6.907, dec: -12.038, mag: 4.08 },
  omicron2: { ra: 7.048, dec: -23.833, mag: 3.02 },
  sigma: { ra: 7.028, dec: -27.934, mag: 3.47 },
};
/** The figure the constellation is drawn as. */
const LINES = [
  ["mirzam", "sirius"], ["sirius", "theta"], ["sirius", "muliphein"],
  ["sirius", "omicron2"], ["omicron2", "wezen"], ["wezen", "aludra"],
  ["wezen", "sigma"], ["sigma", "adhara"], ["adhara", "furud"], ["furud", "mirzam"],
];

/** The constellation as an SVG, at the shape the sky gives it. */
function constellation(w, h) {
  const ras = Object.values(STARS).map((s) => s.ra);
  const decs = Object.values(STARS).map((s) => s.dec);
  const [ra0, ra1] = [Math.min(...ras), Math.max(...ras)];
  const [d0, d1] = [Math.min(...decs), Math.max(...decs)];
  // An hour of right ascension is fifteen degrees, so both axes are degrees and
  // one scale serves them both: stretching either would be another figure.
  const spanX = (ra1 - ra0) * 15;
  const spanY = d1 - d0;
  const pad = 40;
  const k = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = (w - spanX * k) / 2;
  const offY = (h - spanY * k) / 2;
  // Right ascension grows eastward, which is leftward on a chart of the sky.
  const at = (s) => ({ x: offX + (ra1 - s.ra) * 15 * k, y: offY + (d1 - s.dec) * k });
  const radius = (s) => (s.mag < 0 ? 12 : s.mag < 2 ? 6.5 : s.mag < 3.2 ? 5 : 3.5);

  const edges = LINES.map(([a, b]) => {
    const p = at(STARS[a]);
    const q = at(STARS[b]);
    return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"
      stroke="#80CBC4" stroke-width="1.2" stroke-dasharray="6 4" opacity="0.55" />`;
  }).join("\n");
  const nodes = Object.entries(STARS).map(([name, s]) => {
    const p = at(s);
    const brightest = name === "sirius";
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius(s)}"
      fill="${brightest ? "#E91E63" : s.mag < 2.5 ? "#1E88E5" : "#5C6BC0"}"
      stroke="${brightest ? "#FF80AB" : "#90CAF9"}" stroke-width="1.5"${brightest ? ' filter="url(#glow)"' : ""} />`;
  }).join("\n");
  const sirius = at(STARS.sirius);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="7" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter></defs>
    ${edges}
    ${nodes}
    <text x="${(sirius.x + 19).toFixed(1)}" y="${(sirius.y + 5).toFixed(1)}" fill="#ffffff"
      font-family="DejaVu Sans, sans-serif" font-size="16" letter-spacing="1" opacity="0.9">Sirius</text>
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
        display: flex;
        align-items: center;
        gap: 56px;
        padding: 0 72px;
        box-sizing: border-box;
        background: #05070d url("${starfield}") center / cover;
        position: relative;
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
      .sky { position: absolute; right: 56px; top: 26px; }
      .mascot { width: 268px; filter: drop-shadow(0 0 40px rgba(255, 235, 59, 0.18)); }
      .name { font-size: 78px; font-weight: bold; letter-spacing: 1px; line-height: 1; }
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
    <div class="sky">${constellation(330, 368)}</div>
    <img class="mascot" src="${sirius}" alt="" />
    <div class="words">
      <div class="name">Planisphere</div>
      <div class="line">Read a codebase as one drawing</div>
      <div class="languages">Python &nbsp;·&nbsp; TypeScript &nbsp;·&nbsp; Go &nbsp;·&nbsp; Rust &nbsp;·&nbsp; Java</div>
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
