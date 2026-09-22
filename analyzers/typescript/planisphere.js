#!/usr/bin/env node
"use strict";

// Planisphere TypeScript CLI — analyze TypeScript roots and write
// planisphere.json.
//
// The flags and the serialisation are the artifact contract's, not this
// analyzer's: two space indent, non-ASCII written as itself, a trailing
// newline. Node's own `JSON.stringify` lands on the same bytes Python's
// `json.dumps(..., ensure_ascii=False, indent=2)` does, which is what makes
// "the same document serialises to the same bytes" true across producers.

const fs = require("fs");
const path = require("path");
const { analyze } = require("./analyze_symbols.js");

const USAGE = `Usage: planisphere-typescript [roots...] [-o OUT] [--stdout]

Analyze TypeScript symbol structure and write a *.planisphere.json graph.

  roots           project root(s) to scan (default: .)
  -o, --output    output path (default: ./planisphere.json)
  --stdout        print JSON to stdout instead of writing a file
`;

function main(argv) {
  const roots = [];
  let output = "planisphere.json";
  let toStdout = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    } else if (a === "--stdout") {
      toStdout = true;
    } else if (a === "-o" || a === "--output") {
      output = argv[++i];
      if (output === undefined) {
        process.stderr.write("planisphere-typescript: -o needs a path\n");
        return 2;
      }
    } else if (a.startsWith("-")) {
      process.stderr.write(`planisphere-typescript: unknown option ${a}\n${USAGE}`);
      return 2;
    } else {
      roots.push(a);
    }
  }
  if (!roots.length) roots.push(".");

  const result = analyze(roots.map((r) => path.resolve(r)));
  const text = JSON.stringify(result, null, 2) + "\n";

  if (toStdout) {
    process.stdout.write(text);
    return 0;
  }
  const outPath = path.resolve(output);
  fs.writeFileSync(outPath, text);
  process.stderr.write(
    `Wrote ${outPath} (${result.nodes.length} nodes, ${result.edges.length} edges)\n`
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    // Never a partial artifact reported as success.
    process.stderr.write(`planisphere-typescript: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
