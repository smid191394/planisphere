"use strict";

// The CLI and the extension decide the same thing twice.
//
// `bin/planisphere` is bash and the editor runs on Windows, so the extension
// detects languages itself rather than shelling out to the script. That is two
// implementations of one decision — which analyzer has something to read here —
// and this suite runs both over the same trees and requires the same answer, so
// that they cannot drift apart quietly.
//
// The CLI has no way to say "python and nothing else" except by behaving: it
// declines when it finds none, names them all when it finds several, and
// otherwise runs one, whose language the document's own file paths give away.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "bin", "planisphere");
const { detectLanguages } = require(path.join(ROOT, "out", "analysis.js"));

const EXTENSION_OF = {
  python: ".py",
  typescript: ".ts",
  go: ".go",
  rust: ".rs",
  java: ".java",
};

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-agree-"));
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return dir;
}

/** What the CLI's own detection decided, read out of how it behaved. */
function cliDetects(dir) {
  const r = spawnSync(CLI, [dir, "--stdout"], { encoding: "utf8", cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 1 && /no analyzable source/.test(r.stderr)) return [];
  if (r.status === 2 && /found /.test(r.stderr)) {
    const found = r.stderr.match(/found ([^\n]*?) under/);
    return found ? found[1].trim().split(/\s+/).sort() : ["<unreadable>"];
  }
  assert.strictEqual(r.status, 0, `the CLI neither succeeded nor said why: ${r.stderr}`);
  const doc = JSON.parse(r.stdout);
  const files = doc.nodes.map((n) => n.file);
  const language = Object.entries(EXTENSION_OF).find(([, ext]) => files.some((f) => f.endsWith(ext)));
  assert.ok(language, `the document it produced shows no language: ${JSON.stringify(files.slice(0, 3))}`);
  return [language[0]];
}

const PY = { "a/thing.py": "class Thing:\n    pass\n" };
const TS = { "a/thing.ts": "export class Thing {}\n" };
const GO = { "go.mod": "module example.com/m\n\ngo 1.23\n", "a.go": "package m\n\ntype Thing struct{}\n" };
const RS = { "Cargo.toml": '[package]\nname = "m"\nversion = "0.1.0"\nedition = "2021"\n', "src/lib.rs": "pub struct Thing;\n" };
const JAVA = { "src/a/Thing.java": "package a;\npublic class Thing {}\n" };

const TREES = {
  "only Python": PY,
  "only TypeScript": TS,
  "only Go": GO,
  "only Rust": RS,
  "only Java": JAVA,
  "Python plus Go": { ...PY, ...GO },
  "Java plus TypeScript": { ...JAVA, ...TS },
  "nothing at all": { "readme.md": "hello\n" },
  "only a tests directory": { "tests/test_a.py": "class T:\n    pass\n" },
  "only declaration files": { "a/types.d.ts": "export declare class T {}\n" },
  "only go testdata": { "go.mod": "module m\n", "testdata/a.go": "package m\ntype T struct{}\n" },
  "only _test.go": { "go.mod": "module m\n", "a_test.go": "package m\ntype T struct{}\n" },
  "only rust target": { "Cargo.toml": '[package]\nname = "m"\n', "target/debug/a.rs": "pub struct T;\n" },
  "only java build": { "build/generated/a/T.java": "package a;\npublic class T {}\n" },
  "only module-info": { "src/module-info.java": "module m {}\n" },
  "only node_modules": { "node_modules/x/a.ts": "export class T {}\n" },
  "Rust hidden in a dot directory": { ".cache/a.rs": "pub struct T;\n" },
};

for (const [what, files] of Object.entries(TREES)) {
  test(`detection agrees: ${what}`, () => {
    const dir = project(files);
    const mine = detectLanguages(dir).slice().sort();
    const theirs = cliDetects(dir).slice().sort();
    assert.deepStrictEqual(mine, theirs, `${what}: the extension says ${mine}, the CLI says ${theirs}`);
  });
}
