"use strict";

// Every analyzer, run from what ships rather than from the repository.
//
// The repository has `node_modules/typescript` and a warm cargo cache, and
// every other test in this project runs there, so none of them can see a
// dependency the package lacks. Without the compiler shipped, the TypeScript
// analyzer fails with `Cannot find module 'typescript'`; without the vendored
// crates, the Rust one asks cargo to fetch `syn` over the network and to build
// it inside the extension's own install directory.
//
// So this suite builds the shipped layout — exactly the files `vsce ls` lists,
// nothing else — copies it somewhere else, and runs each analyzer there. Cargo
// is given an empty `CARGO_HOME` and `--offline`, so a machine's warm cache
// cannot answer for a dependency that does not ship.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

/** The files the package holds, as `vsce ls` lists them. */
function shipped() {
  const r = spawnSync("npx", ["vsce", "ls"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, `vsce ls failed: ${r.stderr}`);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** A copy of the package, laid out as an installed extension is. */
function installedCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-installed-"));
  for (const rel of shipped()) {
    const from = path.join(ROOT, rel);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, fs.statSync(from).mode);
  }
  return dir;
}

/** A tiny project of one language, in a directory of its own. */
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-project-"));
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return dir;
}

/** Run one analyzer out of the copy and read back the document it wrote. */
function analyze(install, language, dir) {
  const out = path.join(dir, "planisphere.json");
  const started = Date.now();
  const env = { ...process.env, PLANISPHERE_CWD: dir };
  // Nothing of the repository may answer for what the package is missing.
  delete env.NODE_PATH;
  if (language === "rust") {
    // An empty cargo home and no network: the dependency either ships or the
    // build fails, and a warm cache cannot hide the difference.
    env.CARGO_HOME = path.join(install, ".cargo-home");
    env.CARGO_TARGET_DIR = path.join(install, ".cargo-target");
  }
  const runner = {
    python: ["python3", [path.join(install, "analyzers/python/planisphere.py"), dir, "-o", out]],
    typescript: ["node", [path.join(install, "analyzers/typescript/planisphere.js"), dir, "-o", out]],
    go: ["go", ["-C", path.join(install, "analyzers/go"), "run", ".", dir, "-o", out]],
    // From the analyzer's own directory, because that is where cargo looks for
    // the config that points it at the vendored dependencies.
    rust: [
      "cargo",
      ["run", "--quiet", "--release", "--locked", "--offline", "--", dir, "-o", out],
      path.join(install, "analyzers/rust"),
    ],
    java: ["java", [path.join(install, "analyzers/java/Analyzer.java"), dir, "-o", out]],
  }[language];
  const r = spawnSync(runner[0], runner[1], {
    encoding: "utf8",
    env,
    cwd: runner[2] || dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  return { ...r, doc, ms };
}

const PROJECTS = {
  python: { "a/thing.py": "class Thing:\n    pass\n" },
  typescript: { "a/thing.ts": "export class Thing {}\n" },
  go: { "go.mod": "module example.com/m\n\ngo 1.23\n", "a.go": "package m\n\ntype Thing struct{}\n" },
  rust: { "Cargo.toml": '[package]\nname = "m"\nversion = "0.1.0"\nedition = "2021"\n', "src/lib.rs": "pub struct Thing;\n" },
  java: { "src/a/Thing.java": "package a;\npublic class Thing {}\n" },
};

/** The PATH the editor's extension host has: system directories only. */
const EXTENSION_HOST_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Every platform the marketplace serves, as it names them. */
const PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

let install = null;
test.before(() => {
  // The executables this platform's package ships, built if this checkout has
  // none yet: what is being tested is the package, and the package has them.
  const missing = PLATFORMS.some((p) => !fs.existsSync(path.join(ROOT, "analyzers/go/prebuilt", p)));
  if (missing) {
    const r = spawnSync(path.join(ROOT, "scripts/build-analyzers.sh"), [], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, `could not build the Go executables: ${r.stderr}`);
  }
  install = installedCopy();
});

for (const [language, files] of Object.entries(PROJECTS)) {
  test(`the ${language} analyzer runs from the shipped files`, () => {
    const dir = project(files);
    const r = analyze(install, language, dir);
    assert.ok(
      r.doc,
      `${language} produced no document (exit code ${r.status}): ${(r.stderr || "").slice(0, 300)}`
    );
    const names = r.doc.nodes.map((n) => n.name);
    assert.ok(
      names.includes("Thing"),
      `${language}'s document has no Thing, only ${JSON.stringify(names)}`
    );
    console.log(`  ${language}: ${r.doc.nodes.length} nodes, ${r.ms} ms`);
  });
}

/** Run the CLI shipped inside an install. */
function shippedCli(copy, language, env) {
  const dir = project(PROJECTS[language]);
  return spawnSync(path.join(copy, "bin/planisphere"), ["--lang", language, dir, "--stdout"], {
    encoding: "utf8", env: { ...env, PLANISPHERE_CWD: dir }, cwd: dir, maxBuffer: 64 * 1024 * 1024,
  });
}

test("the shipped CLI uses the Go executable and does not need go", () => {
  const r = shippedCli(install, "go", { ...process.env, PATH: EXTENSION_HOST_PATH });
  assert.strictEqual(r.status, 0, `the shipped CLI did not run: ${(r.stderr || "").slice(0, 300)}`);
  assert.ok(r.stdout.includes('"nodes"'), "the shipped CLI should print the document");
});

test("Rust builds in the reader's cache, not into the install directory", () => {
  // No Rust executable ships: the vendored source is built — into the reader's
  // cache, never into the install, which belongs to the editor and is replaced
  // on every update.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-cache-"));
  const env = { ...process.env, XDG_CACHE_HOME: cache, CARGO_HOME: path.join(install, ".cargo-home") };
  delete env.CARGO_TARGET_DIR;
  const r = shippedCli(install, "rust", env);
  assert.strictEqual(r.status, 0, `the shipped CLI did not run: ${(r.stderr || "").slice(0, 300)}`);
  assert.ok(!fs.existsSync(path.join(install, "analyzers/rust/target")), "no target/ should appear under the install directory");
  assert.ok(fs.existsSync(path.join(cache, "planisphere/rust-target")), "the build output should land in the reader's cache");
});

test("the package has Go executables for five platforms and no Rust executable", () => {
  const files = shipped();
  for (const p of PLATFORMS) {
    const exe = `analyzers/go/prebuilt/${p}/planisphere-go${p.startsWith("win32") ? ".exe" : ""}`;
    assert.ok(files.includes(exe), `missing ${exe}`);
  }
  const rust = files.filter((f) => f.startsWith("analyzers/rust/prebuilt/"));
  assert.deepStrictEqual(rust, [], "Rust ships no executable: the reader uses their own cargo");
});

test("no planning documents are shipped", () => {
  // How this project is planned — its OpenSpec commands, its skills, its
  // changes — is not part of the product, and nothing but `.vscodeignore`
  // keeps it out of the extension.
  const planning = shipped().filter(
    (f) => f.startsWith(".claude/") || f.startsWith("openspec/") || f.startsWith("packaging/") || f.startsWith("scripts/") ||
      f.startsWith("e2e/") || f === "docs/release-checklist.md" || f.startsWith(".vscode-test/")
  );
  assert.deepStrictEqual(planning, [], `these should not be in the package: ${planning.join(", ")}`);
});

test("only images in media/ are shipped", () => {
  // A screenshot dropped at the repository's root would ship inside the
  // extension unless something excluded it and something looked.
  const stray = shipped().filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f) && !f.startsWith("media/"));
  assert.deepStrictEqual(stray, [], `these should not be in the package: ${stray.join(", ")}`);
});

test("only the two dependencies the product runs on ship", () => {
  // A development dependency's own optional packages sit at the top of
  // node_modules beside the product's, where the packager takes them for
  // something the extension runs on.
  const dirs = new Set(
    shipped()
      .filter((f) => f.startsWith("node_modules/"))
      .map((f) => f.split("/").slice(1, f.startsWith("node_modules/@") ? 3 : 2).join("/"))
  );
  assert.deepStrictEqual([...dirs].sort(), ["cytoscape", "typescript"], "only these two are the product's");
});

test("the documents that ship are the reader's, not the project's", () => {
  // What is written for a reader of the repository — how to contribute, how to
  // report something, what runs on a push, the fonts a banner is set in — is
  // not part of what a reader installs.
  const files = shipped();
  const docs = files.filter((f) => f.startsWith("docs/"));
  assert.deepStrictEqual(docs, ["docs/languages.md"], `these should not ship: ${docs.join(", ")}`);
  const top = files.filter((f) => /^[^/]+\.md$/.test(f)).sort();
  assert.deepStrictEqual(top, ["CHANGELOG.md", "README.md"], `these should not ship: ${top.join(", ")}`);
  const project = files.filter((f) => f.startsWith(".github/"));
  assert.deepStrictEqual(project, [], `these should not ship: ${project.join(", ")}`);
});

test("nothing shipped carries the old name", () => {
  // The product's former name, CodeScout, must not ship: it is taken in the
  // marketplace twice over. What a reader installs is where a leftover of
  // it would show, so every shipped path and every shipped byte is read —
  // executables too, which carry their module's path.
  const old = /codescout/i;
  const found = [];
  for (const rel of shipped()) {
    if (old.test(rel)) found.push(rel);
    else if (old.test(fs.readFileSync(path.join(ROOT, rel), "latin1"))) found.push(`${rel} (content)`);
  }
  assert.deepStrictEqual(found, [], `these still carry the old name: ${found.join(", ")}`);
});

// ---------------------------------------------------------------------------
// What the editor actually runs: the extension's own runner, under the PATH the
// extension host has — system directories only, with neither `cargo`, `go` nor
// `node` on it even where all three are installed.

async function runThroughExtension(language, env) {
  const { runAnalyzer } = require(path.join(install, "out", "analysis.js"));
  const dir = project(PROJECTS[language]);
  const output = path.join(dir, "planisphere.json");
  const started = Date.now();
  const ran = await runAnalyzer({
    extensionPath: install,
    language,
    root: dir,
    output,
    env,
    buildDir: path.join(install, ".cargo-target"),
  });
  return { doc: JSON.parse(fs.readFileSync(output, "utf8")), ms: Date.now() - started, executable: ran.executable };
}

for (const language of ["python", "typescript", "go", "rust", "java"]) {
  test(`${language}: runs with the extension host's actual PATH`, async () => {
    const r = await runThroughExtension(language, { ...process.env, PATH: EXTENSION_HOST_PATH });
    assert.ok(r.doc.nodes.some((n) => n.name === "Thing"), `${language}'s document has no Thing`);
    console.log(`  ${language} (extension host PATH): ${r.ms} ms`);
  });
}

for (const language of ["typescript", "go"]) {
  test(`${language}: runs when no toolchain can be found`, async () => {
    // An empty PATH, and a home with nothing in it, so that neither PATH nor
    // the wider search can reach a toolchain: what runs is what shipped.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-nothing-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-nohome-"));
    const r = await runThroughExtension(language, { PATH: empty, HOME: home, SHELL: "" });
    assert.ok(r.doc.nodes.some((n) => n.name === "Thing"), `${language}'s document has no Thing`);
    // What ran must be what shipped — the editor's own Node, or the Go
    // executable for this platform — and not a toolchain the search happened to
    // find: a machine with Go in /usr/local/go would otherwise pass this by
    // falling back to `go run`.
    const expected =
      language === "typescript"
        ? process.execPath
        : path.join(install, "analyzers/go/prebuilt", `${process.platform}-${process.arch}`, "planisphere-go");
    assert.strictEqual(r.executable, expected, `${language} did not run what shipped: ${r.executable}`);
    console.log(`  ${language} (no toolchain): ${r.ms} ms`);
  });
}

test("rust: a missing cargo says where to install it", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-nothing-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-nohome-"));
  await assert.rejects(
    runThroughExtension("rust", { PATH: empty, HOME: home, SHELL: "" }),
    (e) => /cargo/.test(e.message) && /rustup/.test(e.message),
    "the message should say cargo is missing and to install it with rustup"
  );
});
