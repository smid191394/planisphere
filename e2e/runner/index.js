"use strict";

// The scenarios, run inside VS Code's extension host against the installed
// extension. Each reads what the command returned, then the evidence: the file
// on disk and the editor tab it opened.

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ID = "planisphere.planisphere";
const ARTIFACT = "planisphere.json";
const VIEW_TYPE = "planisphere.structureGraph";

const PY = { "a/thing.py": "class Thing:\n    pass\n" };
const TS = { "a/thing.ts": "export class Thing {}\n" };
const GO = { "go.mod": "module example.com/m\n\ngo 1.23\n", "a.go": "package m\n\ntype Thing struct{}\n" };
const RS = { "Cargo.toml": '[package]\nname = "m"\nversion = "0.1.0"\nedition = "2021"\n', "src/lib.rs": "pub struct Thing;\n" };
const JAVA = { "src/a/Thing.java": "package a;\npublic class Thing {}\n" };

let counter = 0;
function project(files) {
  const dir = path.join(process.env.E2E_WORK, "projects", `${process.env.E2E_LAUNCH}-${++counter}`);
  for (const [rel, source] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function installed() {
  const ext = vscode.extensions.getExtension(ID);
  check(ext, `${ID} is not installed`);
  return ext;
}

function analyze(dir) {
  return vscode.commands.executeCommand("planisphere.analyze", vscode.Uri.file(dir));
}

/** The graph editor open on this file, waited for: opening a webview is not instant. */
async function graphOpen(file) {
  for (let i = 0; i < 50; i++) {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === VIEW_TYPE && t.input.uri.fsPath === file)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`no ${VIEW_TYPE} editor opened on ${file}`);
}

/** The command wrote this folder's artifact, holding Thing, and opened it as a graph. */
async function produced(outcome, dir, extension) {
  const file = path.join(dir, ARTIFACT);
  check(outcome && outcome.artifact === file, `the command returned ${JSON.stringify(outcome)}`);
  check(fs.existsSync(file), `${file} was not written`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const thing = doc.nodes.find((n) => n.name === "Thing");
  check(thing, `no Thing in ${JSON.stringify(doc.nodes.map((n) => n.name))}`);
  // Which analyzer ran: Thing's own file. (Not every node's — a Rust crate's
  // node is its Cargo.toml.)
  check(thing.file.endsWith(extension), `Thing is in ${thing.file}, not a ${extension} file`);
  await graphOpen(file);
}

function refused(outcome, dir, pattern) {
  check(outcome && typeof outcome.problem === "string", `expected a problem, got ${JSON.stringify(outcome)}`);
  check(pattern.test(outcome.problem), `the problem does not match ${pattern}: ${outcome.problem}`);
  check(!fs.existsSync(path.join(dir, ARTIFACT)), "an artifact was written anyway");
}

function shippedGo() {
  return path.join(installed().extensionPath, "analyzers", "go", "prebuilt", `${process.platform}-${process.arch}`, "planisphere-go");
}

// ---------------------------------------------------------------------------

const COMMON = {
  "the editor sees the manifest that shipped": async () => {
    // A copy into an installed extension's folder leaves the editor's cached
    // manifest in place, and a renamed command keeps its old title through a
    // reload.
    const shipped = JSON.parse(fs.readFileSync(process.env.E2E_MANIFEST, "utf8"));
    const ext = installed();
    const seen = ext.packageJSON;
    check(
      JSON.stringify(seen.contributes) === JSON.stringify(shipped.contributes),
      `the editor sees ${JSON.stringify(seen.contributes.commands)}, the package has ${JSON.stringify(shipped.contributes.commands)}`
    );
    // Registered on activation, which the editor does when the command is run.
    await ext.activate();
    check((await vscode.commands.getCommands(true)).includes("planisphere.analyze"), "planisphere.analyze is not registered");
  },
};

const NO_FOLDER = {
  "with no folder open, it says to open one": async () => {
    // Neither launch opens a folder, and no folder was clicked.
    check(!vscode.workspace.workspaceFolders, "a folder is open, so this proves nothing");
    const outcome = await vscode.commands.executeCommand("planisphere.analyze");
    check(outcome && /open a folder/i.test(outcome.problem || ""), `the command returned ${JSON.stringify(outcome)}`);
  },
};

const SCENARIOS = {
  bare: {
    ...COMMON,
    ...NO_FOLDER,
    "typescript, on the editor's own Node": async () => {
      const dir = project(TS);
      const outcome = await analyze(dir);
      await produced(outcome, dir, ".ts");
      check(outcome.ran === process.execPath, `ran ${outcome.ran}, not the editor's Node`);
    },
    "go, from the shipped executable": async () => {
      const dir = project(GO);
      const outcome = await analyze(dir);
      await produced(outcome, dir, ".go");
      check(outcome.ran === shippedGo(), `ran ${outcome.ran}, not ${shippedGo()}`);
    },
    "the offer draws a sample, and its nodes are where it says": async () => {
      // The offer a reader meets when the command can do nothing. It is a
      // button on a message, which nothing here can press, so this calls what
      // the button calls.
      const ext = installed();
      const api = await ext.activate();
      const outcome = await api.drawSample();
      check(outcome && outcome.artifact, `drawing the sample returned ${JSON.stringify(outcome)}`);
      const doc = JSON.parse(fs.readFileSync(outcome.artifact, "utf8"));
      const telescope = doc.nodes.find((n) => n.name === "Telescope");
      check(telescope, `no Telescope in ${JSON.stringify(doc.nodes.map((n) => n.name))}`);
      // The point of drawing it here rather than shipping it drawn: the paths
      // are this machine's, so activating a node twice opens a file.
      check(fs.existsSync(telescope.file), `${telescope.file} is not on this machine`);
      await graphOpen(outcome.artifact);
    },
    "rust with no cargo says what to install": async () => {
      const dir = project(RS);
      refused(await analyze(dir), dir, /cargo[\s\S]*rustup/);
    },
  },
  equipped: {
    ...COMMON,
    "python": async () => {
      const dir = project(PY);
      await produced(await analyze(dir), dir, ".py");
    },
    "java": async () => {
      const dir = project(JAVA);
      await produced(await analyze(dir), dir, ".java");
    },
    "rust, through a cargo the host's PATH does not show": async () => {
      const cargo = path.join(process.env.HOME, ".cargo", "bin", "cargo");
      check(fs.existsSync(cargo), `no ${cargo}: this machine has no rustup install to lend`);
      check(!(process.env.PATH || "").split(path.delimiter).includes(path.dirname(cargo)), "cargo is on the host's PATH, so this proves nothing");
      const dir = project(RS);
      const outcome = await analyze(dir);
      await produced(outcome, dir, ".rs");
      check(outcome.ran === cargo, `ran ${outcome.ran}, not ${cargo}`);
    },
    "two languages: both are offered, the one chosen is produced": async () => {
      const dir = project({ ...PY, ...GO });
      const running = analyze(dir);
      // The reader's widget, answered as a reader answers it: python is
      // offered first, go second.
      await sleep(1500);
      await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
      await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
      const outcome = await running;
      await produced(outcome, dir, ".go");
    },
    "a folder that cannot be written is named": async () => {
      if (process.getuid && process.getuid() === 0) return "skipped: root writes anywhere";
      const dir = project(PY);
      fs.chmodSync(dir, 0o555);
      try {
        refused(await analyze(dir), dir, new RegExp(`cannot write[\\s\\S]*${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      } finally {
        fs.chmodSync(dir, 0o755);
      }
    },
    "an artifact the CLI wrote opens as a graph": async () => {
      const dir = project(PY);
      const cli = path.join(installed().extensionPath, "bin", "planisphere");
      const r = spawnSync(cli, [dir], { cwd: dir, encoding: "utf8" });
      check(r.status === 0, `the shipped CLI failed: ${r.stderr}`);
      const file = path.join(dir, ARTIFACT);
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
      await graphOpen(file);
    },
    "an artifact named with -o opens as a graph": async () => {
      // One artifact per language in one folder is named by the reader, and
      // the selector must claim that name as well as the default.
      const dir = project(PY);
      const file = path.join(dir, "python.planisphere.json");
      const cli = path.join(installed().extensionPath, "bin", "planisphere");
      const r = spawnSync(cli, [dir, "-o", file], { cwd: dir, encoding: "utf8" });
      check(r.status === 0, `the shipped CLI failed: ${r.stderr}`);
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
      await graphOpen(file);
    },
  },
};

exports.run = async function run() {
  const name = process.env.E2E_LAUNCH;
  const scenarios = SCENARIOS[name];
  if (!scenarios) throw new Error(`no launch named ${name}`);
  console.log(`[e2e] ${name}: HOME=${process.env.HOME} PATH=${process.env.PATH}`);
  let failures = 0;
  for (const [title, scenario] of Object.entries(scenarios)) {
    const started = Date.now();
    try {
      const note = await scenario();
      console.log(`[e2e] ${name} ✓ ${title} (${Date.now() - started} ms)${note ? ` — ${note}` : ""}`);
    } catch (error) {
      failures++;
      console.log(`[e2e] ${name} ✗ ${title}: ${error.message}`);
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
  if (failures) throw new Error(`${failures} scenario(s) failed`);
};
