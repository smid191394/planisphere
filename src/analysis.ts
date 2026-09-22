/**
 * Producing an artifact: which language is under a directory, and running the
 * analyzer that reads it.
 *
 * Nothing here imports `vscode`, so all of it can be tested. What the extension
 * keeps is the picking and the progress, which are the editor's own widgets.
 *
 * The rules are `bin/planisphere`'s, written twice on purpose: the script is
 * bash, and the editor runs on Windows, where that is nothing. A test runs the
 * two over the same trees and requires the same answer, so they cannot drift
 * apart quietly.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type Language = "python" | "typescript" | "go" | "rust" | "java";

/** Directories every analyzer skips, as the CLI's detection has them. */
const SHARED_PRUNE = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "tests",
  "test",
  "docs",
  "examples",
]);

interface Rule {
  /** Is this directory walked? `isRoot` is the directory the search began at. */
  prune(name: string, isRoot: boolean): boolean;
  /** Is this file the language's source? */
  match(name: string): boolean;
}

const dotDir = (name: string, isRoot: boolean) => !isRoot && name.startsWith(".");

const RULES: Record<Language, Rule> = {
  python: {
    prune: (name) => SHARED_PRUNE.has(name),
    match: (name) => name.endsWith(".py"),
  },
  // Every extension the TypeScript analyzer walks, not only the two common
  // ones, and never a declaration file: those describe a library rather than
  // declaring anything of the project's own.
  typescript: {
    prune: (name) => SHARED_PRUNE.has(name),
    match: (name) =>
      /\.(ts|tsx|mts|cts)$/.test(name) && !/\.d\.(ts|mts|cts)$/.test(name),
  },
  // Go skips more than the shared list does: vendored trees, test data, and
  // every directory the go tool itself ignores.
  go: {
    prune: (name, isRoot) =>
      SHARED_PRUNE.has(name) ||
      name === "vendor" ||
      name === "testdata" ||
      dotDir(name, isRoot) ||
      (!isRoot && name.startsWith("_")),
    match: (name) => name.endsWith(".go") && !name.endsWith("_test.go"),
  },
  rust: {
    prune: (name, isRoot) =>
      SHARED_PRUNE.has(name) ||
      name === "target" ||
      name === "benches" ||
      name === "vendor" ||
      dotDir(name, isRoot),
    match: (name) => name.endsWith(".rs"),
  },
  // Maven and Gradle write generated source into target/, build/ and out/.
  java: {
    prune: (name, isRoot) =>
      SHARED_PRUNE.has(name) || name === "target" || dotDir(name, isRoot),
    match: (name) => name.endsWith(".java") && name !== "module-info.java",
  },
};

export const LANGUAGES = Object.keys(RULES) as Language[];

/** Does this tree hold source the named analyzer would read? Stops at the first. */
function holdsSource(root: string, rule: Rule): boolean {
  const walk = (dir: string, isRoot: boolean): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (rule.prune(entry.name, false)) continue;
        if (walk(path.join(dir, entry.name), false)) return true;
      } else if (entry.isFile() && rule.match(entry.name)) {
        return true;
      }
    }
    return false;
  };
  const name = path.basename(root);
  if (rule.prune(name, true)) return false;
  return walk(root, true);
}

/** Which analyzers have something to read under this directory. */
export function detectLanguages(root: string): Language[] {
  return LANGUAGES.filter((language) => holdsSource(root, RULES[language]));
}

/**
 * The one, where there is exactly one.
 *
 * A single candidate is not a question, and anything else is: nothing to
 * analyze is a message, and several languages under one directory is a choice
 * the reader makes — one artifact holds one language.
 */
export function chooseOne<T>(found: T[]): T | null {
  return found.length === 1 ? found[0] : null;
}

/** The marketplace's name for this platform, which is also Node's. */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Where a toolchain may be, beyond the PATH this process was given.
 *
 * The editor starts its extension host without reading the shell files that
 * add toolchains to PATH, so on a machine where `cargo`, `go` and `node` are
 * all installed the host can see none of them. So a reader who has a
 * toolchain is not told they lack it until the places toolchains live have
 * been looked at: the reader's login shell's PATH, and the directories the
 * installers put themselves in.
 */
function candidateDirs(env: NodeJS.ProcessEnv, loginPath: string | null): string[] {
  const home = env.HOME || env.USERPROFILE || "";
  const fromPath = (value: string | null | undefined) =>
    (value || "").split(path.delimiter).filter(Boolean);
  return [
    ...fromPath(env.PATH),
    ...fromPath(loginPath),
    ...(home ? [path.join(home, ".cargo", "bin"), path.join(home, "go", "bin"), path.join(home, ".local", "bin")] : []),
    "/usr/local/go/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
  ];
}

/** The PATH the reader's login shell reports, or null; never waits long. */
function loginShellPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const shell = env.SHELL;
  if (!shell || process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(shell, ["-lc", 'echo "$PATH"'], { env, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 3000);
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      // A profile may print a banner first; the PATH is the last line.
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve(lines.length ? lines[lines.length - 1] : null);
    });
  });
}

/** The toolchain executable by this name, wherever the reader keeps it, or null. */
export async function findTool(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const loginPath = await loginShellPath(env);
  for (const dir of candidateDirs(env, loginPath)) {
    const file = path.join(dir, name + EXE);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** What a reader who lacks a toolchain is told to install. */
const INSTALL: Record<string, string> = {
  python3: "The Python analyzer needs Python 3, as 'python3' or 'python'. Install Python 3 (https://www.python.org/downloads/) and run the command again.",
  java: "The Java analyzer needs a JDK, Java 21 or newer, with its compiler. Install one (https://adoptium.net/) and run the command again.",
  go: "The Go analyzer needs 'go' on this platform. Install Go (https://go.dev/dl/) and run the command again.",
  cargo: "The Rust analyzer needs 'cargo' on this platform. Install Rust (https://rustup.rs/) and run the command again.",
};

export interface RunOptions {
  /** Where the analyzers are: the extension's own directory, or the checkout. */
  extensionPath: string;
  language: Language;
  root: string;
  output: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Where a build may write, for the analyzer that has one. */
  buildDir?: string;
  /** The Node to run the TypeScript analyzer on: the editor's own. */
  execPath?: string;
}

/**
 * The names Python goes by on a platform, in the order they are tried.
 *
 * `python3` is the name that is certainly Python 3, and comes first. Some
 * installs name it only `python`, and a python.org install on Windows puts
 * `python.exe` and the `py` launcher on PATH and rarely `python3.exe`. A
 * `python` may also be Python 2, so what is found is asked its version.
 */
export function pythonNames(platform: NodeJS.Platform): { command: string; prefix: string[] }[] {
  const names = [
    { command: "python3", prefix: [] as string[] },
    { command: "python", prefix: [] as string[] },
  ];
  if (platform === "win32") names.push({ command: "py", prefix: ["-3"] });
  return names;
}

/** Whether this executable is a Python 3; older macOS and Linux named Python 2 `python`. */
function isPython3(executable: string, prefix: string[], env: NodeJS.ProcessEnv): boolean {
  const r = spawnSync(executable, [...prefix, "-c", "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)"], {
    env,
    stdio: "ignore",
    timeout: 5000,
  });
  return r.status === 0;
}

interface Invocation {
  command: string;
  args: string[];
  /** Other names the same command goes by, tried in order after `command`. */
  alternatives?: { command: string; prefix: string[] }[];
  /** Whether a found executable will do; one that will not is passed over. */
  accepts?: (executable: string, prefix: string[], env: NodeJS.ProcessEnv) => boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** What to say when the command is not on PATH. */
  needs: string;
}

/**
 * The analyzer shipped compiled for this platform, where this is an install.
 *
 * A checkout runs its source, so that a change to an analyzer is what runs
 * next; an install runs what shipped, so that its reader needs no toolchain.
 */
export function shipped(root: string, language: "go"): string | null {
  if (fs.existsSync(path.join(root, ".git"))) return null;
  const file = path.join(root, "analyzers", language, "prebuilt", platformKey(), `planisphere-${language}${EXE}`);
  return fs.existsSync(file) ? file : null;
}

function invocation(options: RunOptions): Invocation {
  const { extensionPath: root, language, root: project, output } = options;
  const at = (...parts: string[]) => path.join(root, ...parts);
  const target = [project, "-o", output];
  // Go ships compiled for every platform. Rust does not: a Rust reader has
  // cargo, and the vendored crates build offline into the reader's cache.
  if (language === "go") {
    const exe = shipped(root, language);
    if (exe) return { command: exe, args: target, needs: exe };
  }
  switch (language) {
    case "python":
      return {
        command: "python3",
        args: [at("analyzers/python/planisphere.py"), ...target],
        alternatives: pythonNames(process.platform).slice(1),
        accepts: isPython3,
        needs: "python3",
      };
    // On the editor's own Node: every VS Code and Cursor carries one, so the
    // reader needs none. Electron becomes a plain Node under this variable.
    case "typescript":
      return {
        command: options.execPath ?? process.execPath,
        args: [at("analyzers/typescript/planisphere.js"), ...target],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        needs: "node",
      };
    // GOTOOLCHAIN=local turns a newer go directive into a clear failure rather
    // than a download, and GOWORK=off keeps a reader's workspace file from
    // pulling this module into theirs.
    case "go":
      return {
        command: "go",
        args: ["-C", at("analyzers/go"), "run", ".", ...target],
        env: { GOTOOLCHAIN: "local", GOWORK: "off", GOFLAGS: "" },
        needs: "go",
      };
    // cargo runs from the analyzer's own directory, because that is where it
    // finds the config pointing at the vendored copy of `syn`; the build goes
    // wherever the caller says, never into an installed extension's directory.
    case "rust":
      return {
        command: "cargo",
        args: ["run", "--quiet", "--release", "--locked", "--", ...target],
        cwd: at("analyzers/rust"),
        env: options.buildDir ? { CARGO_TARGET_DIR: options.buildDir } : {},
        needs: "cargo",
      };
    case "java":
      return { command: "java", args: [at("analyzers/java/Analyzer.java"), ...target], needs: "java" };
  }
}

/**
 * Run one analyzer.
 *
 * A run that does not finish writes nothing: an analyzer builds its whole
 * document in memory and writes it once, at the end, so there is no half file
 * to clean up — and a run cancelled after that write produced a complete
 * artifact, which would be the wrong thing to delete.
 */
/** What ran: the executable, so a caller can tell a shipped one from a toolchain. */
export interface RunResult {
  executable: string;
}

export async function runAnalyzer(options: RunOptions): Promise<RunResult> {
  // Checked before anything starts: the artifact goes into the folder
  // analyzed, a read-only checkout is a folder a reader may well point this
  // at, and what they need to hear then is the folder, not an analyzer's error.
  const folder = path.dirname(options.output);
  try {
    fs.accessSync(folder, fs.constants.W_OK);
  } catch {
    throw new Error(`Cannot write to ${folder}, where the artifact would go. Analyze a folder you can write to.`);
  }
  const { command, args: given, cwd, env, needs, alternatives = [], accepts } = invocation(options);
  const base = options.env ?? process.env;
  let executable = command;
  let args = given;
  let pathForChild = base.PATH || "";
  if (!path.isAbsolute(command)) {
    let found: string | null = null;
    for (const name of [{ command, prefix: [] as string[] }, ...alternatives]) {
      const candidate = await findTool(name.command, base);
      if (candidate && (!accepts || accepts(candidate, name.prefix, base))) {
        found = candidate;
        args = [...name.prefix, ...given];
        break;
      }
    }
    if (!found) {
      throw new Error(INSTALL[needs] ?? `The ${options.language} analyzer needs '${needs}', and it was not found.`);
    }
    executable = found;
    // What the toolchain runs in turn — rustc beside cargo — is found beside it.
    pathForChild = [path.dirname(found), pathForChild].filter(Boolean).join(path.delimiter);
  }
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: cwd ?? options.root,
      env: { ...base, ...env, PATH: pathForChild, PLANISPHERE_CWD: options.root },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const cancel = () => {
      child.kill();
      reject(new Error("The analysis was cancelled."));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        cancel();
        return;
      }
      options.signal.addEventListener("abort", cancel, { once: true });
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error(INSTALL[needs] ?? `The ${options.language} analyzer could not start '${executable}'.`)
          : error
      );
    });

    child.on("close", (code) => {
      if (options.signal?.aborted) return;
      if (code === 0) {
        resolve({ executable });
        return;
      }
      reject(new Error(stderr.trim() || `The ${options.language} analyzer exited with ${code}.`));
    });
  });
}
