"use strict";

// Reads TypeScript into the structure-graph document.
//
// The shape of the problem is the opposite of the Python analyzer's. That one's
// largest investment is name resolution — working out what a bare name
// means. Here the compiler
// answers that: `checker.getSymbolAtLocation` follows imports, re-exports and
// aliases, and it is right in a way a hand-written resolver over this language
// would not be.
//
// What is hard instead is TypeScript's own vocabulary. Five declaration kinds
// where Python has two; `export const f = () => …`, which is a function to
// every reader and a variable to the syntax; and declaration merging, where one
// name is an interface and a value at the same time.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

/**
 * Directories no analyzer walks, plus TypeScript's own build and dependency
 * conventions. The first group is the artifact contract's; the second is this
 * language's to declare.
 */
const SKIP_DIR_NAMES = new Set([
  ".git", ".hg", ".svn",
  ".idea", ".vscode",
  "tests", "test", "__tests__", "testing", "spec", "e2e",
  "docs", "examples",
  // TypeScript's own
  "node_modules", "dist", "build", "lib", "out", "coverage", ".next", ".turbo",
]);

/**
 * TypeScript's convention for a package's entry, which re-exports what the
 * package holds. The contract lets an analyzer name such a set; this is ours.
 */
const NOISE_FILE_NODE_NAMES = new Set(["index.ts", "index.tsx", "index.mts", "index.cts"]);

/**
 * Does this file declare nothing of its own — only imports and re-exports?
 *
 * A named set reaches a convention that has a name and reaches nothing else.
 * Angular's barrels are called `browser.ts`, `di.ts`, `compiler.ts`,
 * `core_reactivity_export.ts`; drawn as file nodes, forty-five of them would
 * put the package's table of contents beside its contents.
 *
 * The test is the file's own statements, not a guess about its name. A file
 * holding `export const LIMIT = 10` declares something, however little, and
 * stays.
 */
function isOnlyReExports(sf) {
  if (!sf.statements.length) return false;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st)) continue;
    // `export { A } from "./x"` and `export * from "./x"` carry a module
    // specifier; `export { A }` without one re-exports something this file
    // imported, which is still not a declaration of its own.
    if (ts.isExportDeclaration(st)) continue;
    return false;
  }
  return true;
}

/** Is this a source file the analyzer reads? */
function isSourceName(name) {
  if (!/\.(ts|tsx|mts|cts)$/.test(name)) return false;
  // A declaration file describes an interface to code rather than being it.
  if (/\.d\.(ts|mts|cts)$/.test(name)) return false;
  if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(name)) return false;
  return true;
}

/** Every source file under the roots, in a stable order. */
function iterSourceFiles(roots) {
  const out = [];
  const seen = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        walk(p);
      } else if (e.isFile() && isSourceName(e.name)) {
        const abs = path.resolve(p);
        if (!seen.has(abs)) {
          seen.add(abs);
          out.push(abs);
        }
      }
    }
  };
  for (const root of roots) {
    const abs = path.resolve(root);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) walk(abs);
    else if (fs.existsSync(abs) && isSourceName(path.basename(abs))) {
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push(abs);
      }
    }
  }
  return out;
}

const DECLARATION_KIND = new Map([
  [ts.SyntaxKind.ClassDeclaration, "class"],
  [ts.SyntaxKind.InterfaceDeclaration, "interface"],
  [ts.SyntaxKind.TypeAliasDeclaration, "type"],
  [ts.SyntaxKind.EnumDeclaration, "enum"],
  [ts.SyntaxKind.FunctionDeclaration, "function"],
]);

const EDGE_RANK = { inherits: 0, uses: 1, references: 2 };

/** `<file>::<kind>::<name>`, the identity the artifact contract fixes. */
function nodeId(file, kind, name) {
  return `${file}::${kind}::${name}`;
}

/**
 * @param {string[]} roots
 * @returns {{ nodes: object[], edges: object[] }}
 */
function analyze(roots) {
  const files = iterSourceFiles(roots);
  if (!files.length) return { nodes: [], edges: [] };

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: false,
    skipLibCheck: true,
    noEmit: true,
    noResolve: false,
  });
  const checker = program.getTypeChecker();
  const inProject = new Set(files);

  /** id -> node, in insertion order, which is file order then statement order. */
  const nodes = new Map();
  /** ts declaration -> node id, for resolution to land on. */
  const declToId = new Map();
  /** {declaration, id} for every node that has a body worth walking. */
  const owners = [];

  const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const record = (sf, file, kind, name, decl, bodyNode) => {
    const id = nodeId(file, kind, name);
    // Overload signatures declare one name several times; the last wins,
    // because that is the one with a body and it is what the name means once
    // the module has been read. The Python analyzer follows the same rule.
    nodes.set(id, {
      id,
      kind,
      name,
      file,
      // The declared name's line, not the declaration's start. `getStart`
      // includes decorators, so an `@Injectable()` on the line above would make
      // the jump land on the decorator instead of on `class HttpClient` — 195
      // of Angular's nodes. Python's `ast` gives the `def` or `class` line and
      // the contract's scenario says the same, so this keeps the two producers
      // in agreement rather than expressing a preference.
      line: lineOf(sf, (decl.name || decl).getStart(sf)),
      endLine: lineOf(sf, decl.getEnd()),
    });
    declToId.set(decl, id);
    owners.push({ decl: bodyNode || decl, id });
    return id;
  };

  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    let declaredSomething = false;

    /**
     * Take the declarations of one scope, and descend into the scopes inside it.
     *
     * A file is a scope and so is a `namespace` body. A namespace is a naming
     * scope rather than a symbol — the contract's rule against nesting forbids
     * a node for a method, a function inside a function, or a type inside a
     * type, and none of those is a namespace. Walking past it would drop 86
     * declarations across the four sample projects.
     *
     * `prefix` is what the scope is called, and it goes into the node's name:
     * zod declares seven names both at a file's top level and inside one of its
     * namespaces, and an identity is `<file>::<kind>::<name>`, so an
     * unqualified `Circle` would replace the other one under the rule written
     * for overload signatures.
     */
    const takeScope = (statements, prefix) => {
      for (const st of statements) {
        // `export const parse = (x) => …` is a function everywhere but the AST.
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            const init = d.initializer;
            if (!init) continue;
            if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
            if (!ts.isIdentifier(d.name)) continue;
            const name = prefix + d.name.text;
            record(sf, file, "function", name, d, init);
            // Resolution lands on the variable declaration; make the whole
            // statement reach it too, since that is what a symbol may name.
            declToId.set(d, nodeId(file, "function", name));
            declaredSomething = true;
          }
          continue;
        }

        // A namespace holds declarations; it is not one itself.
        if (ts.isModuleDeclaration(st)) {
          const scope = st.name && st.name.text ? st.name.text : "";
          if (st.body && ts.isModuleBlock(st.body)) {
            takeScope(st.body.statements, scope ? prefix + scope + "." : prefix);
          }
          continue;
        }

        const kind = DECLARATION_KIND.get(st.kind);
        if (!kind) continue;
        // `export default class {}` names nothing there is a node for.
        if (!st.name || !ts.isIdentifier(st.name)) continue;
        record(sf, file, kind, prefix + st.name.text, st);
        declaredSomething = true;
      }
    };
    takeScope(sf.statements, "");

    if (!declaredSomething) {
      const base = path.basename(file);
      if (!NOISE_FILE_NODE_NAMES.has(base) && !isOnlyReExports(sf)) {
        const id = nodeId(file, "file", base);
        nodes.set(id, { id, kind: "file", name: base, file, line: 1, endLine: 1 });
      }
    }
  }

  const edges = [];
  /** "from to" -> index into edges. One edge per ordered pair. */
  const edgeAt = new Map();

  const addEdge = (from, to, kind) => {
    if (from === to) return;
    if (!nodes.has(from) || !nodes.has(to)) return;
    const key = from + " " + to;
    const at = edgeAt.get(key);
    if (at === undefined) {
      edgeAt.set(key, edges.length);
      edges.push({ from, to, kind });
      return;
    }
    if (EDGE_RANK[kind] < EDGE_RANK[edges[at].kind]) edges[at].kind = kind;
  };

  /**
   * The node a name denotes, or null where it denotes nothing this document
   * contains.
   *
   * Declaration merging means one symbol can have declarations of several
   * kinds — `interface Foo {}` beside `const Foo = …` is one symbol with two.
   * The first declaration that maps to a node wins. Preferring the type would
   * sound more principled and would make half the edges disagree with what the
   * code does at run time; what the contract actually requires is that the
   * answer is the same on every run, and the compiler reports declarations in
   * a stable order.
   */
  const resolveName = (nameNode) => {
    let sym;
    try {
      sym = checker.getSymbolAtLocation(nameNode);
    } catch (e) {
      return null;
    }
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch (e) {
        /* not an alias after all; keep the symbol we have */
      }
    }
    for (const d of sym.declarations || []) {
      const hit = declToId.get(d);
      if (hit) return hit;
      // An arrow constant's symbol names the variable declaration; the node
      // was recorded against it, but a nested binding may reach here by parent.
      if (d.parent && declToId.has(d.parent)) return declToId.get(d.parent);
    }
    return null;
  };

  for (const { decl, id: src } of owners) {
    const heritage = decl.heritageClauses || [];

    // `extends` and `implements` are both `inherits`. Measured across three
    // projects, `implements` is about one heritage edge in ten; giving it an
    // edge kind of its own is a change to the artifact contract, and making
    // that change for one language before a second has asked is a guess.
    for (const clause of heritage) {
      for (const t of clause.types) {
        const to = resolveName(t.expression);
        if (to) addEdge(src, to, "inherits");
      }
    }

    // Everything else. A name in a type position is a reference; a name where
    // a value is expected is a use.
    const walk = (node, inType) => {
      if (!node) return;
      const typeHere = inType || ts.isTypeNode(node);
      if (
        ts.isIdentifier(node) &&
        // `a.b` — only `a` denotes something reachable from here.
        !(node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        // A declaration's own name is not a reference to itself.
        !(node.parent && node.parent.name === node && DECLARATION_KIND.has(node.parent.kind))
      ) {
        const to = resolveName(node);
        if (to) addEdge(src, to, typeHere ? "references" : "uses");
      }
      ts.forEachChild(node, (child) => walk(child, typeHere));
    };

    // An interface's whole body is type positions, and so is a type alias's.
    const bodyIsType =
      ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl);
    ts.forEachChild(decl, (child) => {
      if (heritage.includes(child)) return;
      walk(child, bodyIsType);
    });
  }

  return {
    nodes: [...nodes.values()],
    // Sorted, because the artifact is a file people keep. Node order is the
    // file walk's, which is sorted; edge order has to be imposed.
    edges: edges.slice().sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 :
      a.to < b.to ? -1 : a.to > b.to ? 1 :
      a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0
    ),
  };
}

module.exports = {
  analyze,
  iterSourceFiles,
  isOnlyReExports,
  SKIP_DIR_NAMES,
  NOISE_FILE_NODE_NAMES,
};
