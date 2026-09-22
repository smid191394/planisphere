"use strict";

// Runs every *.test.js beside it, then reports once.
//
// The suites share one assertion counter in harness.js on purpose: a run that
// loads a suite and silently skips it should show up as a drop in the total,
// not as a pass.

const fs = require("fs");
const path = require("path");
const { report } = require("./harness.js");

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

if (!files.length) {
  console.error("no *.test.js files in media/tests");
  process.exit(1);
}

for (const f of files) require(path.join(__dirname, f));

report();
