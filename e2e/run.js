"use strict";

// The command, run in a real VS Code, from the package a reader installs.
//
// Every other suite here runs the extension's parts outside an editor, and two
// faults a reader can meet live exactly in that gap: on WSL the editor's
// extension host does not see `cargo`, so a Rust folder would be refused on a
// machine that has cargo; and the editor caches an extension's manifest, so an
// install that copies files into its folder does not refresh the cache, and a
// renamed command keeps its old name through a reload.
//
// So this builds nothing and copies nothing: it takes the `.vsix` that
// `npm run package` made, installs it with VS Code's own CLI into an empty
// extensions directory, and runs the command in VS Code's extension host, twice:
//
//   equipped  a fresh home holding only ~/.cargo and ~/.rustup, linked where
//             rustup puts them — cargo installed, and not on the host's PATH
//   bare      an empty home — a reader who has installed nothing
//
// Desktop VS Code replaces the PATH it is given with the one the
// user's login shell reports, so a stripped PATH cannot be handed to it; a
// fresh home is what strips it.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
/** Pinned, so that a VS Code release does not change the suite under it. */
const VSCODE_VERSION = "1.138.0";
const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const LAUNCHES = ["bare", "equipped"];

function fail(message) {
  console.error(`e2e: ${message}`);
  process.exit(1);
}

/** One launch: VS Code with the installed extension, running the runner's scenarios. */
async function launch() {
  const { runTests } = require("@vscode/test-electron");
  const work = process.env.E2E_WORK;
  const name = process.env.E2E_LAUNCH;
  await runTests({
    vscodeExecutablePath: process.env.E2E_CODE,
    extensionDevelopmentPath: path.join(__dirname, "runner"),
    extensionTestsPath: path.join(__dirname, "runner", "index.js"),
    launchArgs: [
      "--extensions-dir", path.join(work, "ext"),
      // Short, under the system temp directory: VS Code may put its IPC socket
      // here, and a socket path has a length limit a scratch path can exceed.
      "--user-data-dir", path.join(work, `user-${name}`),
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
}

async function main() {
  const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require("@vscode/test-electron");
  const { version } = require(path.join(ROOT, "package.json"));
  const vsix = path.join(ROOT, `planisphere-${version}.vsix`);
  if (!fs.existsSync(vsix)) {
    console.log(`e2e: ${path.basename(vsix)} is not built; running npm run package`);
    const r = spawnSync("npm", ["run", "package"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) fail("npm run package failed");
  }

  // Electron needs a display; on Linux the suite brings its own.
  const xvfb = process.platform === "linux" ? "/usr/bin/xvfb-run" : null;
  if (xvfb && !fs.existsSync(xvfb)) fail("needs xvfb-run to give VS Code a display: sudo apt install xvfb");

  const code = await downloadAndUnzipVSCode({ version: VSCODE_VERSION, cachePath: path.join(ROOT, ".vscode-test") });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-e2e-"));

  // Installed as a reader installs it. On WSL the Linux CLI otherwise stops to
  // ask whether to install the Windows build instead, and waits on stdin.
  const installed = spawnSync(
    resolveCliPathFromVSCodeExecutablePath(code),
    ["--extensions-dir", path.join(work, "ext"), "--user-data-dir", path.join(work, "user-cli"),
      "--install-extension", vsix],
    { encoding: "utf8", env: { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" }, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (installed.status !== 0) fail(`VS Code's CLI did not install the package: ${installed.stderr}`);

  const started = Date.now();
  const failed = [];
  for (const name of LAUNCHES) {
    const home = path.join(work, `home-${name}`);
    fs.mkdirSync(home);
    if (name === "equipped") {
      for (const dir of [".cargo", ".rustup"]) {
        const real = path.join(os.homedir(), dir);
        if (fs.existsSync(real)) fs.symlinkSync(real, path.join(home, dir));
      }
    }
    const env = {
      HOME: home,
      SHELL: "/bin/sh",
      PATH: SYSTEM_PATH,
      DONT_PROMPT_WSL_INSTALL: "1",
      E2E_LAUNCH: name,
      E2E_WORK: work,
      E2E_CODE: code,
      E2E_MANIFEST: path.join(ROOT, "package.json"),
    };
    if (process.env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
    const argv = [process.execPath, __filename, "--launch"];
    const [command, args] = xvfb ? [xvfb, ["-a", ...argv]] : [argv[0], argv.slice(1)];
    const status = await new Promise((resolve) => {
      const child = spawn(command, args, { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
      // Only the runner's own lines: Electron's stderr is dbus and GPU noise.
      const relay = (chunk) => {
        for (const line of String(chunk).split("\n")) if (line.includes("[e2e]")) console.log(line.trim());
      };
      child.stdout.on("data", relay);
      child.stderr.on("data", relay);
      child.on("close", resolve);
    });
    if (status !== 0) failed.push(name);
  }
  console.log(`e2e: ${LAUNCHES.length} launches in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  fs.rmSync(work, { recursive: true, force: true });
  if (failed.length) fail(`failed in: ${failed.join(", ")}`);
}

if (process.argv.includes("--launch")) {
  launch().catch(() => process.exit(1));
} else {
  main().catch((e) => fail(e.stack || String(e)));
}
