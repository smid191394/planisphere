"use strict";

// The dispatcher, against the scenarios that specify it.
//
// `bin/planisphere` is shell, which no compiler reads, so the only way to check
// it is to run it. `structure-graph-artifact` gives it five scenarios; these run them, by
// spawning the real script rather than reimplementing its argument parsing.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "planisphere");

/** Build a package of `{ "rel/path": source }` and run the CLI in it. */
function run(files, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-"));
  try {
    for (const [rel, source] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, source);
    }
    const r = spawnSync(CLI, args.map((a) => (a === "@" ? dir : a)), {
      encoding: "utf8",
      cwd: dir,
    });
    let doc = null;
    if (r.stdout && r.stdout.trim().startsWith("{")) {
      try {
        doc = JSON.parse(r.stdout);
      } catch (e) {
        doc = null;
      }
    }
    return { ...r, dir, doc };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PY = { "a.py": "class PyThing:\n    pass\n" };
const TS = { "a.ts": "export class TsThing {}\n" };
const GO = {
  "go.mod": "module example.com/m\n\ngo 1.23\n",
  "a.go": "package m\n\ntype GoThing struct{}\n",
};
const RS = {
  "Cargo.toml": '[package]\nname = "m"\nversion = "0.1.0"\n',
  "src/lib.rs": "pub struct RsThing;\n",
};
const JAVA = { "src/a/JavaThing.java": "package a;\npublic class JavaThing {}\n" };
const names = (doc) => (doc ? doc.nodes.map((n) => n.name).sort() : null);

// ---------------------------------------------------------------------------
// Scenario: The analyzer follows from the source

test("a directory with only Python runs the Python analyzer", () => {
  const r = run(PY, ["@", "--stdout"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["PyThing"]);
});

test("a directory with only TypeScript runs the TypeScript analyzer", () => {
  const r = run(TS, ["@", "--stdout"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["TsThing"]);
});

test("a directory with only Go runs the Go analyzer", () => {
  const r = run(GO, ["@", "--stdout"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["GoThing", "m"]);
});

test("a directory with only Rust runs the Rust analyzer", () => {
  const r = run(RS, ["@", "--stdout"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["RsThing", "m"]);
});

test(".rs files only in target/ or benches/ do not count as Rust", () => {
  // Checked beside a real crate first. Alone, "no analyzable source" is also
  // what a detection that had never heard of `.rs` would say, and the exclusion
  // would pass without being measured at all.
  const real = run(RS, ["@", "--stdout"]);
  assert.strictEqual(real.status, 0, real.stderr);
  assert.deepStrictEqual(names(real.doc), ["RsThing", "m"]);
  for (const files of [
    { ...PY, "target/debug/build/x/out.rs": "pub struct Built;\n" },
    { ...PY, "benches/b.rs": "pub struct Bench;\n" },
  ]) {
    const r = run(files, ["@", "--stdout"]);
    assert.strictEqual(r.status, 0, `${Object.keys(files).join(",")}: ${r.stderr}`);
    assert.deepStrictEqual(names(r.doc), ["PyThing"], "only Python should be detected");
  }
});

test("a directory with only Java runs the Java analyzer", () => {
  const r = run(JAVA, ["@", "--stdout"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["JavaThing", "a"]);
});

test(".java files only in target/, build/ or out/ do not count as Java", () => {
  // Checked beside a real project first, so that "no analyzable source" cannot
  // pass for a detection that never heard of `.java`.
  const real = run(JAVA, ["@", "--stdout"]);
  assert.strictEqual(real.status, 0, real.stderr);
  for (const files of [
    { ...PY, "target/generated-sources/a/Built.java": "package a;\npublic class Built {}\n" },
    { ...PY, "build/generated/a/Gradled.java": "package a;\npublic class Gradled {}\n" },
    { ...PY, "out/production/a/Ide.java": "package a;\npublic class Ide {}\n" },
  ]) {
    const r = run(files, ["@", "--stdout"]);
    assert.strictEqual(r.status, 0, `${Object.keys(files).join(",")}: ${r.stderr}`);
    assert.deepStrictEqual(names(r.doc), ["PyThing"], "only Python should be detected");
  }
});

test("a relative Java root and -o resolve against the caller's directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-java-"));
  try {
    for (const [rel, src] of Object.entries(JAVA)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), src);
    }
    const r = spawnSync(CLI, [".", "-o", "out.json"], { encoding: "utf8", cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
    assert.ok(doc.nodes.some((n) => n.name === "JavaThing"
      && n.file === path.join(dir, "src", "a", "JavaThing.java")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("with no java, or a runtime without the compiler module, it names which is wrong", () => {
  // PATH without java at all. The message names java, not javac: this machine
  // has a runtime carrying the compiler module and no javac beside it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-nojava-"));
  try {
    fs.writeFileSync(path.join(dir, "T.java"), "public class T {}\n");
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-empty-bin-"));
    const r = spawnSync(CLI, [".", "--lang", "java", "--stdout"], {
      encoding: "utf8", cwd: dir,
      env: { ...process.env, PATH: `${empty}:/usr/bin:/bin` },
    });
    if (r.status !== 0) {
      assert.match(r.stderr, /java/);
      assert.doesNotMatch(r.stderr, /javac/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a relative Rust root and -o resolve against the caller's directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-rs-"));
  try {
    for (const [rel, src] of Object.entries(RS)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), src);
    }
    const r = spawnSync(CLI, [".", "-o", "out.json"], { encoding: "utf8", cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
    assert.ok(doc.nodes.some((n) => n.name === "RsThing" && n.file === path.join(dir, "src", "lib.rs")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("with no cargo available it says so and writes no artifact", (t) => {
  if (["/usr/bin/cargo", "/bin/cargo"].some((p) => fs.existsSync(p))) {
    t.skip("this machine has cargo in /usr/bin, which cannot be removed");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-nocargo-"));
  try {
    for (const [rel, src] of Object.entries(RS)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), src);
    }
    const r = spawnSync(CLI, [dir, "-o", path.join(dir, "out.json")], {
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /'cargo' on PATH/);
    assert.ok(!fs.existsSync(path.join(dir, "out.json")), "no artifact should be written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-"));
  for (const [rel, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), source);
  return dir;
}

/** /usr/bin without any Python in it, plus `python` as given: a PATH for the tests below. */
function pathWithPython(python) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-bin-"));
  for (const name of fs.readdirSync("/usr/bin")) {
    if (!/^python/.test(name)) fs.symlinkSync(path.join("/usr/bin", name), path.join(bin, name));
  }
  if (python) python(path.join(bin, "python"));
  return bin;
}

test("a Python 3 named only python works too", () => {
  const real = fs.realpathSync("/usr/bin/python3");
  const bin = pathWithPython((at) => fs.symlinkSync(real, at));
  const r = spawnSync(CLI, ["--lang", "python", ".", "--stdout"], {
    encoding: "utf8",
    cwd: project(PY),
    env: { ...process.env, PATH: bin },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(JSON.parse(r.stdout)), ["PyThing"]);
});

test("a python that is Python 2 does not count, and it asks for Python 3", () => {
  const bin = pathWithPython((at) => {
    fs.writeFileSync(at, '#!/bin/sh\necho "Python 2.7.18" >&2\nexit 1\n');
    fs.chmodSync(at, 0o755);
  });
  const r = spawnSync(CLI, ["--lang", "python", ".", "--stdout"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bin },
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /Python 3/);
});

test("Go only in `_test.go` or vendor does not count as Go", () => {
  // Detection agrees with what the analyzer walks, or it announces a language
  // whose analyzer then finds nothing.
  for (const files of [
    { "go.mod": GO["go.mod"], "a_test.go": "package m\n" },
    { "go.mod": GO["go.mod"], "vendor/x/x.go": "package x\n" },
    { "go.mod": GO["go.mod"], "testdata/t.go": "package t\n" },
  ]) {
    const r = run(files, ["@", "--stdout"]);
    assert.notStrictEqual(r.status, 0, Object.keys(files).join(","));
    assert.match(r.stderr, /no analyzable source/);
  }
});

test("a relative root and -o resolve against the caller's directory", () => {
  // `go -C` moves the analyzer's working directory; without the caller's own
  // directory passed along, "." would be the analyzer's source and -o would
  // land inside it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-go-"));
  try {
    for (const [rel, src] of Object.entries(GO)) fs.writeFileSync(path.join(dir, rel), src);
    const r = spawnSync(CLI, [".", "-o", "out.json"], { encoding: "utf8", cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
    assert.ok(doc.nodes.some((n) => n.name === "GoThing" && n.file === path.join(dir, "a.go")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("with no go available it says so and writes no artifact", (t) => {
  if (["/usr/bin/go", "/bin/go"].some((p) => fs.existsSync(p))) {
    t.skip("this machine has go in /usr/bin, which cannot be removed");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-nogo-"));
  try {
    for (const [rel, src] of Object.entries(GO)) fs.writeFileSync(path.join(dir, rel), src);
    const r = spawnSync(CLI, [dir, "-o", path.join(dir, "out.json")], {
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /'go' on PATH/);
    assert.ok(!fs.existsSync(path.join(dir, "out.json")), "no artifact should be written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("`.mts` and `.cts` count as TypeScript too", () => {
  // The analyzer walks these, so detection has to find them: listing only .ts
  // and .tsx, it would tell a package written in them that it held no
  // analyzable source at all.
  for (const ext of ["mts", "cts"]) {
    const r = run({ [`src/thing.${ext}`]: "export class MThing {}\n" }, ["@", "--stdout"]);
    assert.strictEqual(r.status, 0, `${ext}: ${r.stderr}`);
    assert.deepStrictEqual(names(r.doc), ["MThing"], `.${ext} should be recognized`);
  }
});

test("`.d.mts` and `.d.cts` do not count as source", () => {
  // A declaration file describes an interface to code rather than being it —
  // the same reason `.d.ts` does not count, and the detection has to agree
  // with the analyzer or it announces a language whose analyzer finds nothing.
  //
  // Checked beside a real source file, not alone: with nothing else present,
  // "no analyzable source" is also what a detection that had never heard of
  // `.mts` would say, and the assertion would pass without measuring the
  // exclusion at all.
  const r = run(
    {
      "src/real.mts": "export class Real {}\n",
      "types/api.d.mts": "export declare class DeclaredM {}\n",
      "types/x.d.cts": "export declare class DeclaredC {}\n",
    },
    ["@", "--stdout"]
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(names(r.doc), ["Real"], "nothing from a declaration file should come in");

  const alone = run({ "types/api.d.mts": "export declare class Shape {}\n" }, ["@", "--stdout"]);
  assert.notStrictEqual(alone.status, 0, "only declaration files should not count as having source");
  assert.match(alone.stderr, /no analyzable source/);
});

// ---------------------------------------------------------------------------
// Scenario: The reader names the analyzer

test("the one named by --lang runs, whatever else is beside it", () => {
  const both = { ...PY, ...TS };
  assert.deepStrictEqual(names(run(both, ["@", "--lang", "python", "--stdout"]).doc), [
    "PyThing",
  ]);
  assert.deepStrictEqual(names(run(both, ["@", "--lang", "typescript", "--stdout"]).doc), [
    "TsThing",
  ]);
});

test("--lang accepts short names", () => {
  const both = { ...PY, ...TS };
  assert.deepStrictEqual(names(run(both, ["@", "--lang", "py", "--stdout"]).doc), ["PyThing"]);
  assert.deepStrictEqual(names(run(both, ["@", "--lang=ts", "--stdout"]).doc), ["TsThing"]);
});

// ---------------------------------------------------------------------------
// Scenario: More than one language, none named

test("two languages and none named: it says what it found and stops", () => {
  const r = run({ ...PY, ...TS }, ["@", "--stdout"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /python/);
  assert.match(r.stderr, /typescript/);
  assert.match(r.stderr, /--lang/);
  assert.strictEqual(r.stdout.trim(), "", "no partial artifact should be written");
});

test("Go and Python with none named: it names both and stops; naming go runs Go", () => {
  const r = run({ ...PY, ...GO }, ["@", "--stdout"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /python/);
  assert.match(r.stderr, /\bgo\b/);
  assert.strictEqual(r.stdout.trim(), "");
  assert.deepStrictEqual(names(run({ ...PY, ...GO }, ["@", "--lang", "go", "--stdout"]).doc), [
    "GoThing",
    "m",
  ]);
});

test("Rust and Python with none named: it names both and stops; naming rust or rs runs Rust", () => {
  const r = run({ ...PY, ...RS }, ["@", "--stdout"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /python/);
  assert.match(r.stderr, /\brust\b/);
  assert.strictEqual(r.stdout.trim(), "");
  for (const lang of ["rust", "rs"]) {
    assert.deepStrictEqual(names(run({ ...PY, ...RS }, ["@", "--lang", lang, "--stdout"]).doc), [
      "RsThing",
      "m",
    ]);
  }
});

// ---------------------------------------------------------------------------
// Scenario: A named analyzer with nothing to read

test("a named analyzer with nothing to read still writes an empty graph", () => {
  for (const lang of ["python", "typescript", "go", "rust", "java"]) {
    const r = run({ "readme.md": "hello\n" }, ["@", "--lang", lang, "--stdout"]);
    assert.strictEqual(r.status, 0, `${lang}: ${r.stderr}`);
    assert.ok(r.doc, `${lang} should write JSON`);
    assert.deepStrictEqual(r.doc.nodes, []);
    assert.deepStrictEqual(r.doc.edges, []);
  }
});

// ---------------------------------------------------------------------------
// Scenario: Nothing to dispatch to

test("with no analyzable source it says so and stops", () => {
  const r = run({ "readme.md": "hello\n" }, ["@", "--stdout"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no analyzable source/);
  assert.strictEqual(r.stdout.trim(), "");
});

// ---------------------------------------------------------------------------
// The cases the shell makes easy to break

test("an unknown language lists the ones it knows", () => {
  const r = run(PY, ["@", "--lang", "cobol", "--stdout"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /python/);
  assert.match(r.stderr, /typescript/);
  assert.match(r.stderr, /\bgo\b/);
  assert.match(r.stderr, /\brust\b/);
});

test("--lang with nothing after it does not take the next argument as a language", () => {
  const r = run(PY, ["@", "--lang"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /--lang/);
});

test("the value of -o is not taken as a root to scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-out-"));
  try {
    // The output path is an existing TypeScript file, and the root holds only
    // Python. Parsed correctly, `-o` swallows it and the dispatcher sees one
    // language. Parsed wrongly it becomes a second root, the dispatcher sees
    // two languages and declines — which is what makes this discriminating.
    //
    // The output file has to exist already: `has_source` skips a root that is
    // not there, so with `-o` pointed at a new path this test would pass with
    // the parsing broken.
    const out = path.join(dir, "existing.ts");
    fs.writeFileSync(out, "export class Nope {}\n");
    const src = path.join(dir, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "a.py"), "class PyThing:\n    pass\n");
    const r = spawnSync(CLI, [src, "-o", out], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepStrictEqual(doc.nodes.map((n) => n.name), ["PyThing"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a path with spaces works", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cli-sp-"));
  try {
    const root = path.join(dir, "a folder with spaces");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "a.py"), "class Spaced:\n    pass\n");
    const r = spawnSync(CLI, [root, "--stdout"], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout).nodes.map((n) => n.name), ["Spaced"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 and names the five languages", () => {
  const r = spawnSync(CLI, ["--help"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /python/);
  assert.match(r.stdout, /typescript/);
  assert.match(r.stdout, /\bgo\b/);
  assert.match(r.stdout, /\brust\b/);
  assert.match(r.stdout, /\bjava\b/);
});
