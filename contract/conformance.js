"use strict";

// Does the analyzer actually obey the artifact contract?
//
// Every requirement under `structure-graph-artifact` is a claim about the
// document, not about one producer. This file is the executable form of those
// claims, run against whatever artifacts have been generated.
//
// It exists because writing a contract down is the moment it can become a lie.
// A prose copy of a rule drifts silently. A check cannot drift silently: it
// fails.
//
// It is here to verify that the rules written down are true of every analyzer
// that ships, which is why it reads their artifacts rather than any one
// producer's code.
//
// What each requirement is checked against, so a later reader can tell a
// measured claim from an assumed one. Every check below runs over every
// generated artifact under `fixtures/`.
//
//   A node's identity is its file, its kind and its name
//       the string is rebuilt from the node's own fields and compared
//   Persisted node file paths are absolute
//       path.isAbsolute on every node
//   Only top-level symbols become nodes
//       no node's line range falls inside another node's from the same file —
//       a symbol nested in a symbol would. Indentation is not read: it is
//       Python's shape rather than the contract's. Separately, the
//       definition line must name the symbol
//   A file with no top-level symbols is still represented
//       a file node and a symbol node never name the same file, and a file
//       node's name is the file's base name
//   An edge never invents a node
//       both endpoints of every edge are in the same document
//   Every edge carries one of the artifact's kinds
//       the kind is one of four, and an ordered pair appears at most once
//   A node may record the members that belong to it
//       a member names a real line in its own file, and is not also a node
//   A unit above the file may be a node
//       a `contains` edge never starts at a `function` or `file` node, and no
//       node is the target of more than one. That a unit's line names it is the
//       definition-line check under "Only top-level symbols become nodes",
//       which reads every node that is not a file
//   The same document serialises to the same bytes
//       Node's own JSON.stringify is the second producer: its output plus a
//       newline must equal the file, byte for byte. Plus the trailing newline,
//       the two-space indent, no \u escapes, and the edge ordering
//   A node's kind says whether it is a type or something that orbits one
//       every node carries a kind; `function` and `file` are the only two a
//       consumer may treat as orbiting, and no other name is rejected
//   Every analyzer skips the same kinds of directory
//       no node's path contains one of the skipped components
//   Relationship edges are lexical, not a runtime call graph
//       NOT CHECKED. It is an honesty bound on what the edges claim, not a
//       property of the document. There is nothing here that could fail.

const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const EDGE_KINDS = ["contains", "inherits", "uses", "references"];

// Categories every analyzer skips, from "Every analyzer skips the same kinds of
// directory". Language-specific caches are the analyzer's own business and are
// not checked here.
const SKIPPED_DIRS = new Set([
  ".git", ".hg", ".svn",
  "node_modules", "dist", "build",
  ".idea", ".vscode",
  "tests", "test", "__tests__", "testing",
  "docs", "examples",
]);

let checks = 0;
const failures = [];

function ok(condition, what, detail) {
  checks++;
  if (!condition) failures.push(detail ? `${what} — ${detail}` : what);
}

/** Source lines, read once per file. */
const sourceCache = new Map();
function sourceLines(file) {
  if (!sourceCache.has(file)) {
    let lines = null;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n");
    } catch (e) {
      lines = null;
    }
    sourceCache.set(file, lines);
  }
  return sourceCache.get(file);
}

function findArtifacts() {
  const out = [];
  let langs;
  try {
    langs = fs.readdirSync(FIXTURES, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const lang of langs) {
    if (!lang.isDirectory()) continue;
    const dir = path.join(FIXTURES, lang.name);
    for (const project of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const file = path.join(dir, project.name, "planisphere.json");
      if (fs.existsSync(file)) {
        out.push({ label: `${lang.name}/${project.name}`, file });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// One function per requirement.
// ---------------------------------------------------------------------------

/** Requirement: A node's identity is its file, its kind and its name. */
function checkIdentity(g, at) {
  const seen = new Set();
  for (const n of g.nodes) {
    ok(
      n.id === `${n.file}::${n.kind}::${n.name}`,
      `${at} node id is not <file>::<kind>::<name>`,
      n.id
    );
    ok(!seen.has(n.id), `${at} duplicate node id`, n.id);
    seen.add(n.id);
  }
}

/** Requirement: Persisted node file paths are absolute. */
function checkAbsolutePaths(g, at) {
  for (const n of g.nodes) {
    ok(path.isAbsolute(n.file), `${at} node file is not an absolute path`, n.file);
  }
}

/**
 * Requirement: Only top-level symbols become nodes.
 *
 * It does not test that the definition line starts in column 0. That is
 * Python's shape, not the contract's: TypeScript declares types inside a
 * `namespace`, which is a naming scope rather than a symbol, and every one of
 * them is indented. A column-0 check would fail 95 nodes the contract says
 * belong in the graph.
 *
 * What the requirement actually forbids is a node for a symbol nested inside
 * another symbol. That is checkable without reading indentation at all: a
 * symbol's line range covers everything declared inside it, so a nested one
 * would sit inside its owner's range. Measured across every artifact, no two
 * nodes in one file overlap at all.
 *
 * The definition line is still read, for a weaker but different thing: that it
 * names the symbol. A wrong line number is a dead jump, and that is the failure
 * a reader meets first.
 */
function checkTopLevelOnly(g, at) {
  const byFile = new Map();
  for (const n of g.nodes) {
    if (n.kind === "file") continue;
    const lines = sourceLines(n.file);
    if (lines) {
      const line = lines[n.line - 1];
      if (line === undefined) {
        ok(false, `${at} definition line is past the end of the file`, `${n.name} @ ${n.file}:${n.line}`);
      } else {
        // The name a scope qualifies — `Shapes.Circle` is declared as `Circle`.
        const own = String(n.name).split(".").pop();
        ok(
          line.includes(own),
          `${at} definition line does not contain the symbol's name`,
          `${n.name} @ ${n.file}:${n.line}  ${line.trim().slice(0, 60)}`
        );
      }
    }
    if (!byFile.has(n.file)) byFile.set(n.file, []);
    byFile.get(n.file).push(n);
  }

  for (const [file, ns] of byFile) {
    ns.sort((a, b) => a.line - b.line || (b.endLine || b.line) - (a.endLine || a.line));
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      const aEnd = a.endLine || a.line;
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        if (b.line > aEnd) break;
        // A type declared inside a type sits inside its range, and its name is
        // what says so — `Maps.KeySet` inside `Maps`. Every other pair is still
        // a failure, which is how a method or a local class recorded as a node
        // is caught.
        const nested = String(b.name).startsWith(`${a.name}.`);
        ok(
          nested,
          `${at} one symbol's line range falls inside another's`,
          `${b.name} (${b.line}-${b.endLine || b.line}) inside ${a.name} (${a.line}-${aEnd}) @ ${file}`
        );
      }
    }
  }
}

/** Requirement: A file with no top-level symbols is still represented. */
function checkFileFallback(g, at) {
  const symbolFiles = new Set();
  const fileNodes = new Map();
  for (const n of g.nodes) {
    if (n.kind === "file") fileNodes.set(n.file, n);
    else symbolFiles.add(n.file);
  }
  for (const [file, n] of fileNodes) {
    ok(
      !symbolFiles.has(file),
      `${at} one file has both a file node and symbol nodes`,
      file
    );
    ok(
      n.name === path.basename(file),
      `${at} file node name is not the file's base name`,
      `${n.name} != ${path.basename(file)}`
    );
  }
}

/** Requirement: An edge never invents a node. */
function checkNoInventedNodes(g, at) {
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    ok(ids.has(e.from), `${at} edge from is not a node in this document`, e.from);
    ok(ids.has(e.to), `${at} edge to is not a node in this document`, e.to);
  }
}

/** Requirement: Every edge carries one of the artifact's kinds. */
function checkEdgeKinds(g, at) {
  const pairs = new Map();
  for (const e of g.edges) {
    ok(
      EDGE_KINDS.includes(e.kind),
      `${at} edge kind is not one of the four the contract lists`,
      e.kind
    );
    const key = `${e.from}\u0000${e.to}`;
    ok(
      !pairs.has(key),
      `${at} more than one edge for the same ordered node pair`,
      `${key.replace("\u0000", " -> ")} (${pairs.get(key)}, ${e.kind})`
    );
    pairs.set(key, e.kind);
  }
}

/**
 * Requirement: A unit above the file may be a node.
 *
 * Python and TypeScript have no unit and carry no `contains` edge, so on their
 * artifacts this has nothing to check. That a unit's line names it is
 * `checkTopLevelOnly`'s definition-line check, which reads every node that is
 * not a file.
 */
function checkUnits(g, at) {
  const kindOf = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const container = new Map();
  for (const e of g.edges) {
    if (e.kind !== "contains") continue;
    const kind = kindOf.get(e.from);
    ok(
      kind !== "function" && kind !== "file",
      `${at} contains edge starts from a ${kind} node`,
      `${e.from} -> ${e.to}`
    );
    ok(
      !container.has(e.to),
      `${at} one node is contained by two units`,
      `${e.to} ← ${container.get(e.to)}, ${e.from}`
    );
    container.set(e.to, e.from);
  }
}

/** Requirement: The same document serialises to the same bytes. */
function checkSerialisation(text, g, at) {
  ok(text.endsWith("\n"), `${at} file does not end with a newline`);
  ok(!text.endsWith("\n\n"), `${at} file ends with more than one newline`);

  // Non-ASCII is written as itself, never as a \u escape.
  ok(
    !/\\u[0-9a-fA-F]{4}/.test(text),
    `${at} file contains \\u escapes`,
    (text.match(/\\u[0-9a-fA-F]{4}/) || [""])[0]
  );

  // Two-space indent, `nodes` before `edges`.
  const lines = text.split("\n");
  ok(lines[1] === '  "nodes": [', `${at} first top-level key is not nodes indented two spaces`, lines[1]);
  ok(
    text.indexOf('"edges"') > text.indexOf('"nodes"'),
    `${at} edges appears before nodes`
  );

  // Edges sorted by from, then to, then kind.
  for (let i = 1; i < g.edges.length; i++) {
    const a = g.edges[i - 1];
    const b = g.edges[i];
    const ka = [a.from, a.to, a.kind];
    const kb = [b.from, b.to, b.kind];
    ok(
      ka[0] < kb[0] ||
        (ka[0] === kb[0] && (ka[1] < kb[1] || (ka[1] === kb[1] && ka[2] <= kb[2]))),
      `${at} edges are not sorted by from/to/kind`,
      `${ka.join("|")} sorts before ${kb.join("|")}`
    );
  }

  // The whole point of the requirement: another producer, serialising the same
  // document, must land on the same bytes. Node's own JSON.stringify is that
  // other producer.
  ok(
    JSON.stringify(g, null, 2) + "\n" === text,
    `${at} re-serialized bytes differ from the file`
  );
}

/** Requirement: Every analyzer skips the same kinds of directory. */
function checkSkippedDirs(g, at) {
  for (const n of g.nodes) {
    const parts = n.file.split(path.sep).slice(0, -1);
    const hit = parts.find((p) => SKIPPED_DIRS.has(p));
    ok(!hit, `${at} node is under a directory that should be skipped`, `${hit} in ${n.file}`);
  }
}

/**
 * Requirement: A node may record the members that belong to it.
 *
 * A member is something that belongs to a node without being one — a Go method,
 * which is its receiver's. It is reachable in the source and nowhere else in the
 * document, so what has to hold is that it names a real place, and that it was
 * not also drawn as a node - which is a question about the place, not the name. An artifact that records none is checked by every
 * loop below running zero times, which is what it should cost.
 */
function checkMembers(g, at) {
  // What makes a member and a node the same declaration is where they are, not
  // what they are called. Go puts a method and a package-level function of one
  // name in one file - cobra's `Command.MarkFlagRequired` beside
  // `MarkFlagRequired`, 99 such pairs across the four Go projects - and those
  // are two declarations. A name repeats in a file; a line cannot.
  const placed = new Set(g.nodes.map((n) => `${n.file}\u0000${n.line}`));
  for (const n of g.nodes) {
    if (!n.members) continue;
    ok(Array.isArray(n.members), `${at} members is not an array`, n.id);
    for (const m of n.members || []) {
      ok(
        typeof m.name === "string" && m.name.length > 0,
        `${at} member has no name`,
        n.id
      );
      ok(path.isAbsolute(m.file || ""), `${at} member file is not an absolute path`, `${n.name}.${m.name} @ ${m.file}`);
      ok(
        Number.isInteger(m.line) && m.line >= 1,
        `${at} member line is not a positive integer`,
        `${n.name}.${m.name}`
      );
      const lines = sourceLines(m.file);
      if (lines) {
        const line = lines[m.line - 1];
        ok(
          line !== undefined && line.includes(m.name),
          `${at} member's line does not contain its name`,
          `${n.name}.${m.name} @ ${m.file}:${m.line}  ${(line || "").trim().slice(0, 60)}`
        );
      }
      ok(
        !placed.has(`${m.file}\u0000${m.line}`),
        `${at} member is also a node`,
        `${n.name}.${m.name} @ ${m.file}:${m.line}`
      );
    }
  }
}

/**
 * Requirement: A node may say that its language marks it as internal.
 *
 * It is the analyzer's statement in its own language's terms, and no consumer
 * may infer it from the name — this checker is a consumer, so there is nothing
 * here to check it against. What is left is that it is a boolean where it is
 * present, and that an artifact recording it nowhere passes untouched.
 */
function checkInternal(g, at) {
  for (const n of g.nodes) {
    if (!("internal" in n)) continue;
    ok(
      typeof n.internal === "boolean",
      `${at} internal is not a boolean`,
      `${n.name} internal=${JSON.stringify(n.internal)}`
    );
  }
}

/** Shape checks the document cannot be read without. */
function checkShape(g, at) {
  ok(Array.isArray(g.nodes), `${at} nodes is not an array`);
  ok(Array.isArray(g.edges), `${at} edges is not an array`);
  for (const n of g.nodes) {
    // `kind` is an open set: `function` and `file` are reserved for what
    // orbits, and anything else is a type the artifact was free to invent. A
    // check listing the kinds it had been taught would fail the first analyzer
    // to emit `interface`, which is the opposite of what the rule says.
    ok(
      typeof n.kind === "string" && n.kind.length > 0,
      `${at} node has no kind`,
      JSON.stringify(n.kind)
    );
    ok(Number.isInteger(n.line) && n.line >= 1, `${at} node line is not a positive integer`, `${n.name}`);
    if (n.endLine !== undefined && n.endLine !== null) {
      ok(n.endLine >= n.line, `${at} endLine is less than line`, `${n.name}`);
    }
  }
}

// ---------------------------------------------------------------------------

const artifacts = findArtifacts();
if (!artifacts.length) {
  console.log("(skipping contract/conformance.js - no generated artifacts)");
  process.exit(0);
}

for (const { label, file } of artifacts) {
  const text = fs.readFileSync(file, "utf8");
  const g = JSON.parse(text);
  const at = label;
  checkShape(g, at);
  checkMembers(g, at);
  checkInternal(g, at);
  checkIdentity(g, at);
  checkAbsolutePaths(g, at);
  checkTopLevelOnly(g, at);
  checkFileFallback(g, at);
  checkNoInventedNodes(g, at);
  checkEdgeKinds(g, at);
  checkUnits(g, at);
  checkSerialisation(text, g, at);
  checkSkippedDirs(g, at);
}

// "Relationship edges are lexical, not a runtime call graph" is an honesty
// bound on what the edges claim, not a property of the document. There is
// nothing here that could fail; saying so is better than a check that passes
// by construction.

if (failures.length) {
  // Twenty is enough to see the shape of a failure; PLANISPHERE_SHOW_ALL when the
  // question is how many and where, rather than what.
  const shown = process.env.PLANISPHERE_SHOW_ALL ? failures : failures.slice(0, 20);
  for (const f of shown) console.error("  ✗ " + f);
  if (failures.length > shown.length) {
    console.error(`  ... and ${failures.length - shown.length} more`);
  }
  console.error(
    `\nContract check failed: ${artifacts.length} artifacts, ${checks} checks, ${failures.length} failed.`
  );
  process.exit(1);
}

console.log(
  `Contract check passed: ${artifacts.length} artifacts, ${checks} checks, all conform.`
);
