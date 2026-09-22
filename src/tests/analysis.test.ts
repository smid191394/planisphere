// What the command has to know: which language is under a directory, which
// question to ask, and how an analyzer is run.
//
// None of this imports `vscode`, so all of it can be tested. What is left in
// the extension itself is the picking and the progress, which are the editor's
// own widgets.

import test from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { detectLanguages, chooseOne, runAnalyzer, findTool, shipped, platformKey, pythonNames } from "../analysis";

const ROOT = path.join(__dirname, "..", "..");

/** A project on disk, from `{ "rel/path": source }`. */
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-detect-"));
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return dir;
}

const PY = { "a/thing.py": "class Thing:\n    pass\n" };
const TS = { "a/thing.ts": "export class Thing {}\n" };
const GO = { "go.mod": "module example.com/m\n\ngo 1.23\n", "a.go": "package m\n\ntype Thing struct{}\n" };
const RS = { "Cargo.toml": '[package]\nname = "m"\nversion = "0.1.0"\nedition = "2021"\n', "src/lib.rs": "pub struct Thing;\n" };
const JAVA = { "src/a/Thing.java": "package a;\npublic class Thing {}\n" };

// ---------------------------------------------------------------------------

test("a tree of one language detects that one", () => {
  for (const [language, files] of [
    ["python", PY],
    ["typescript", TS],
    ["go", GO],
    ["rust", RS],
    ["java", JAVA],
  ] as const) {
    assert.deepStrictEqual(detectLanguages(project(files)), [language], `a ${language} tree`);
  }
});

test("a tree of two languages detects both", () => {
  const dir = project({ ...PY, ...GO });
  assert.deepStrictEqual(detectLanguages(dir).sort(), ["go", "python"]);
});

test("a tree with nothing detects none", () => {
  assert.deepStrictEqual(detectLanguages(project({ "readme.md": "hello\n" })), []);
});

test("build output and commonly skipped directories do not count", () => {
  // Each analyzer's own exclusions, as the CLI's detection has them: a tree
  // whose only source is where a build wrote it holds nothing to analyze.
  const cases: [string, Record<string, string>][] = [
    ["python's tests/", { "tests/test_a.py": "class T:\n    pass\n" }],
    ["typescript declaration files", { "a/types.d.ts": "export declare class T {}\n" }],
    ["go's testdata/", { "go.mod": "module m\n", "testdata/a.go": "package m\ntype T struct{}\n" }],
    ["go's _test.go", { "go.mod": "module m\n", "a_test.go": "package m\ntype T struct{}\n" }],
    ["rust's target/", { "Cargo.toml": "[package]\nname = \"m\"\n", "target/debug/a.rs": "pub struct T;\n" }],
    ["java's build/", { "build/generated/a/T.java": "package a;\npublic class T {}\n" }],
    ["java's module-info", { "src/module-info.java": "module m {}\n" }],
    ["node_modules/", { "node_modules/x/a.ts": "export class T {}\n" }],
    ["a directory starting with a dot", { ".cache/a.rs": "pub struct T;\n" }],
    ["a directory starting with an underscore (go)", { "go.mod": "module m\n", "_ignored/a.go": "package m\ntype T struct{}\n" }],
  ];
  for (const [what, files] of cases) {
    assert.deepStrictEqual(detectLanguages(project(files)), [], what);
  }
});

test("one is used directly, more than one needs asking", () => {
  assert.strictEqual(chooseOne(["python"]), "python");
  assert.strictEqual(chooseOne(["python", "go"]), null, "with two the reader chooses");
  assert.strictEqual(chooseOne([]), null, "with none there is nothing to choose");
});

// ---------------------------------------------------------------------------

test("runs the analyzer and writes the document", async () => {
  const dir = project(PY);
  const out = path.join(dir, "planisphere.json");
  await runAnalyzer({ extensionPath: ROOT, language: "python", root: dir, output: out });
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepStrictEqual(doc.nodes.map((n: { name: string }) => n.name), ["Thing"]);
});

test("after cancelling there is no partial output and the child process has stopped", async () => {
  const dir = project(PY);
  const out = path.join(dir, "planisphere.json");
  const control = new AbortController();
  const running = runAnalyzer({
    extensionPath: ROOT,
    language: "python",
    root: dir,
    output: out,
    signal: control.signal,
  });
  control.abort();
  await assert.rejects(running, /cancel/i, "cancelling should make it fail, not pretend to succeed");
  assert.ok(!fs.existsSync(out), "no partial output should be left after cancelling");
});

// ---------------------------------------------------------------------------
// Finding a toolchain the editor does not show.
//
// The editor starts its extension host without reading the shell files that
// add toolchains to PATH, so the host can lack `cargo`, `go` and `node` on a
// machine where all three are installed.

/** A home directory with a fake tool in it, and nothing on PATH. */
function fakeHome(tool: string, where: string): { home: string; bin: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  const bin = path.join(home, where);
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, tool);
  fs.writeFileSync(file, "#!/bin/sh\necho fake\n");
  fs.chmodSync(file, 0o755);
  return { home, bin };
}

const EMPTY = () => fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-emptypath-"));

test("a tool not on PATH but in its usual install location is still found", async () => {
  const { home, bin } = fakeHome("cargo", ".cargo/bin");
  const found = await findTool("cargo", { PATH: EMPTY(), HOME: home, SHELL: "" });
  assert.strictEqual(found, path.join(bin, "cargo"));
});

test("the PATH a login shell reports counts too, reading only its last line", async () => {
  const { home, bin } = fakeHome("go", "somewhere/odd/bin");
  // A login shell whose profile prints a banner before the PATH it reports.
  const shell = path.join(home, "fake-shell");
  fs.writeFileSync(shell, `#!/bin/sh\necho "welcome back"\necho "${bin}"\n`);
  fs.chmodSync(shell, 0o755);
  const found = await findTool("go", { PATH: EMPTY(), HOME: home, SHELL: shell });
  assert.strictEqual(found, path.join(bin, "go"));
});

test("when it is nowhere, it says so", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  assert.strictEqual(await findTool("cargo", { PATH: EMPTY(), HOME: home, SHELL: "" }), null);
});

test("a missing python3 says what to install", async () => {
  const dir = project(PY);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  await assert.rejects(
    runAnalyzer({
      extensionPath: ROOT,
      language: "python",
      root: dir,
      output: path.join(dir, "planisphere.json"),
      env: { PATH: EMPTY(), HOME: home, SHELL: "" },
    }),
    (e: Error) => /python3/.test(e.message) && /install/i.test(e.message),
    "the message should say python3 is missing and to install it"
  );
});

test("a missing Java says to install a JDK", async () => {
  const dir = project(JAVA);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  await assert.rejects(
    runAnalyzer({
      extensionPath: ROOT,
      language: "java",
      root: dir,
      output: path.join(dir, "planisphere.json"),
      env: { PATH: EMPTY(), HOME: home, SHELL: "" },
    }),
    (e: Error) => /JDK/.test(e.message) && /install/i.test(e.message),
    "the message should say the JDK is missing and to install it"
  );
});

// ---------------------------------------------------------------------------
// A checkout runs its source; an install runs what shipped.

function withExecutable(isCheckout: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-install-"));
  if (isCheckout) fs.mkdirSync(path.join(root, ".git"));
  const dir = path.join(root, "analyzers", "go", "prebuilt", platformKey());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "planisphere-go" + (process.platform === "win32" ? ".exe" : "")), "");
  return root;
}

test("an installed copy uses the shipped executable", () => {
  const root = withExecutable(false);
  assert.ok(shipped(root, "go"), "a directory without .git is an installed copy and should use the executable");
});

test("a checkout runs the source, not an executable that may be stale", () => {
  const root = withExecutable(true);
  assert.strictEqual(shipped(root, "go"), null, "with .git it is a checkout, so a changed analyzer must run the changed source");
});

test("another platform's executable does not count", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-install-"));
  const other = platformKey() === "linux-x64" ? "darwin-arm64" : "linux-x64";
  const dir = path.join(root, "analyzers", "go", "prebuilt", other);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "planisphere-go"), "");
  assert.strictEqual(shipped(root, "go"), null);
});

test("a missing cargo says to install it with rustup", async () => {
  const dir = project(RS);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  await assert.rejects(
    runAnalyzer({
      extensionPath: ROOT,
      language: "rust",
      root: dir,
      output: path.join(dir, "planisphere.json"),
      env: { PATH: EMPTY(), HOME: home, SHELL: "" },
    }),
    (e: Error) => /cargo/.test(e.message) && /rustup/.test(e.message),
    "the message should say cargo is missing and to install it with rustup"
  );
});

// ---------------------------------------------------------------------------
// Windows' Python, and a folder the artifact cannot go into.

test("Python looks for python3 and python, and on Windows also py -3", () => {
  // A python.org install on Windows puts python.exe and the py launcher on
  // PATH, and rarely python3.exe; elsewhere some installs name it only python.
  assert.deepStrictEqual(pythonNames("win32"), [
    { command: "python3", prefix: [] },
    { command: "python", prefix: [] },
    { command: "py", prefix: ["-3"] },
  ]);
  for (const platform of ["linux", "darwin"] as const) {
    assert.deepStrictEqual(
      pythonNames(platform),
      [{ command: "python3", prefix: [] }, { command: "python", prefix: [] }],
      platform
    );
  }
});

test("a Python 3 named only python works too", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const real = await findTool("python3", process.env);
  assert.ok(real, "this machine needs python3 for the test to run");
  fs.symlinkSync(real, path.join(bin, "python"));
  const dir = project(PY);
  const out = path.join(dir, "planisphere.json");
  const ran = await runAnalyzer({
    extensionPath: ROOT,
    language: "python",
    root: dir,
    output: out,
    env: { PATH: EMPTY(), HOME: home, SHELL: "" },
  });
  assert.strictEqual(ran.executable, path.join(bin, "python"));
  assert.ok(fs.existsSync(out), "the artifact should be written");
});

test("a python that is Python 2 does not count", async () => {
  // Older macOS and Linux shipped /usr/bin/python as Python 2, which cannot
  // run the analyzer; it is passed over, and the reader told to install 3.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const fake = path.join(bin, "python");
  fs.writeFileSync(fake, '#!/bin/sh\necho "Python 2.7.18" >&2\nexit 1\n');
  fs.chmodSync(fake, 0o755);
  const dir = project(PY);
  await assert.rejects(
    runAnalyzer({
      extensionPath: ROOT,
      language: "python",
      root: dir,
      output: path.join(dir, "planisphere.json"),
      env: { PATH: EMPTY(), HOME: home, SHELL: "" },
    }),
    (e: Error) => /Python 3/.test(e.message) && /install/i.test(e.message),
    "Python 2 cannot run it; the message should say to install Python 3"
  );
});

const ROOT_USER = typeof process.getuid === "function" && process.getuid() === 0;

test("an unwritable folder is reported before the analyzer starts", { skip: ROOT_USER && "root can write anywhere" }, async () => {
  const dir = project(PY);
  const out = path.join(dir, "planisphere.json");
  fs.chmodSync(dir, 0o555);
  try {
    // An empty PATH: were an analyzer started, it would fail for want of
    // python3, and that message is not the one a reader needs.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-home-"));
    await assert.rejects(
      runAnalyzer({
        extensionPath: ROOT,
        language: "python",
        root: dir,
        output: out,
        env: { PATH: EMPTY(), HOME: home, SHELL: "" },
      }),
      (e: Error) => /cannot write/i.test(e.message) && e.message.includes(dir),
      "the message should say it cannot write, and name the folder"
    );
    assert.ok(!fs.existsSync(out), "an unwritable folder should leave no artifact");
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});
