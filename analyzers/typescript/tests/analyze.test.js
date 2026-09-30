"use strict";

// What the TypeScript analyzer promises, as shapes rather than as projects.
//
// Each test writes a tiny package to a temporary directory and analyzes it, so
// the input to an assertion is visible beside it. The Python analyzer's tests
// work the same way, for the same reason: a fixture on disk is
// the one thing that can drift away from what the analyzer produces.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { analyze } = require("../analyze_symbols.js");

/** Write a package of `{ "rel/path.ts": source }` and analyze it. */
function analyzed(files, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planisphere-ts-"));
  try {
    for (const [rel, source] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, source.replace(/^\n/, ""));
    }
    return { dir, result: analyze([dir], opts) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const kinds = (r) => r.nodes.map((n) => `${n.kind}:${n.name}`).sort();
const edge = (r, from, to) => {
  const by = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  return r.edges.filter(
    (e) => by[e.from] && by[e.to] && by[e.from].name === from && by[e.to].name === to
  );
};

test("each of the five declarations is a node, and kind is TypeScript's own word", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Klass {}
      export interface Shape { x: number }
      export type Alias = string;
      export enum Colour { Red }
      export function work(): void {}
    `,
  });
  assert.deepStrictEqual(kinds(result), [
    "class:Klass",
    "enum:Colour",
    "function:work",
    "interface:Shape",
    "type:Alias",
  ]);
});

test("an arrow constant is a function, a plain constant is nothing", () => {
  const { result } = analyzed({
    "a.ts": `
      export const parse = (x: string) => x.trim();
      export const build = function (n: number) { return n; };
      export const LIMIT = 10;
      export const table = { a: 1 };
    `,
  });
  assert.deepStrictEqual(kinds(result), ["function:build", "function:parse"]);
});

test("overload signatures plus an implementation are one node, located at the implementation", () => {
  const { result } = analyzed({
    "a.ts": `
      export function pick(x: string): string;
      export function pick(x: number): number;
      export function pick(x: any): any {
        return x;
      }
    `,
  });
  const picks = result.nodes.filter((n) => n.name === "pick");
  assert.strictEqual(picks.length, 1);
  // The implementation, not a signature: it is the one with a body.
  assert.strictEqual(picks[0].line, 3);
  assert.strictEqual(picks[0].endLine, 5);
});

test("a file that declares nothing gets a file node", () => {
  const { result } = analyzed({
    "constants.ts": `
      export const A = 1;
      export const B = 2;
    `,
  });
  assert.deepStrictEqual(kinds(result), ["file:constants.ts"]);
});

test("an import is followed to what it names", () => {
  const { result } = analyzed({
    "other.ts": `export class Thing {}`,
    "a.ts": `
      import { Thing } from "./other";
      export function make(): Thing {
        return new Thing();
      }
    `,
  });
  assert.strictEqual(edge(result, "make", "Thing").length, 1);
});

test("a re-export is followed through to the declaration itself", () => {
  const { result } = analyzed({
    "deep/thing.ts": `export class Thing {}`,
    "deep/index.ts": `export { Thing } from "./thing";`,
    "a.ts": `
      import { Thing } from "./deep";
      export function make(): Thing {
        return new Thing();
      }
    `,
  });
  const es = edge(result, "make", "Thing");
  assert.strictEqual(es.length, 1);
  const by = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
  assert.ok(by[es[0].to].file.endsWith(path.join("deep", "thing.ts")));
});

test("a symbol imported from node_modules produces no edge", () => {
  const { result } = analyzed({
    "node_modules/dep/index.ts": `export class Outside {}`,
    "a.ts": `
      import { Outside } from "./node_modules/dep";
      export function make(): Outside {
        return new Outside();
      }
    `,
  });
  assert.deepStrictEqual(kinds(result), ["function:make"]);
  assert.strictEqual(result.edges.length, 0);
});

test("a type annotation is references, a call is uses", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Shape {}
      export function helper(): number {
        return 1;
      }
      export function annotated(s: Shape): number {
        return helper();
      }
    `,
  });
  assert.deepStrictEqual(
    edge(result, "annotated", "Shape").map((e) => e.kind),
    ["references"]
  );
  assert.deepStrictEqual(
    edge(result, "annotated", "helper").map((e) => e.kind),
    ["uses"]
  );
});

test("extends and implements are both inherits", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Base {}
      export interface Shape { x: number }
      export class Sub extends Base implements Shape {
        x = 1;
      }
    `,
  });
  assert.deepStrictEqual(edge(result, "Sub", "Base").map((e) => e.kind), ["inherits"]);
  assert.deepStrictEqual(edge(result, "Sub", "Shape").map((e) => e.kind), ["inherits"]);
});

test("a pair of nodes keeps only the most specific edge", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Base {}
      export class Sub extends Base {
        make(b: Base): Base {
          return new Base();
        }
      }
    `,
  });
  const es = edge(result, "Sub", "Base");
  assert.strictEqual(es.length, 1);
  assert.strictEqual(es[0].kind, "inherits");
});

test(".d.ts and *.test.ts contribute nothing", () => {
  const { result } = analyzed({
    "a.ts": `export class Real {}`,
    "types.d.ts": `export declare class Declared {}`,
    "a.test.ts": `export class Tested {}`,
    "b.spec.ts": `export class Spec {}`,
  });
  assert.deepStrictEqual(kinds(result), ["class:Real"]);
});

test("`.mts` and `.cts` are TypeScript, their declaration files are not", () => {
  // How TypeScript writes a file whose module system is stated in its name.
  // The spec and the dispatcher name these extensions as well as the
  // analyzer; if either looked only for .ts and .tsx, a package written in
  // these would be told it held no analyzable source.
  const { result } = analyzed({
    "m.mts": `export class Mod {}`,
    "c.cts": `export class Common {}`,
    "types.d.mts": `export declare class DeclaredM {}`,
    "types.d.cts": `export declare class DeclaredC {}`,
    "m.test.mts": `export class TestedM {}`,
    "c.spec.cts": `export class SpecC {}`,
  });
  assert.deepStrictEqual(kinds(result), ["class:Common", "class:Mod"]);
});

test("the same source analyzed twice gives the same bytes", () => {
  const files = {
    "a.ts": `
      export class A {}
      export interface B { a: A }
      export function c(b: B): A {
        return new A();
      }
    `,
  };
  const one = JSON.stringify(analyzed(files).result);
  const two = JSON.stringify(analyzed(files).result);
  // Paths differ between the two temporary directories; the shape must not.
  const strip = (s) => s.replace(/planisphere-ts-[A-Za-z0-9]+/g, "DIR");
  assert.strictEqual(strip(one), strip(two));
});

test("a node id is <file>::<kind>::<name> and is unique", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Thing {}
      export interface Thing2 { x: number }
    `,
  });
  const ids = result.nodes.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const n of result.nodes) {
    assert.strictEqual(n.id, `${n.file}::${n.kind}::${n.name}`);
    assert.ok(path.isAbsolute(n.file), `${n.file} should be an absolute path`);
  }
});

test("a type in a namespace is a node whose name carries its scope", () => {
  const { result } = analyzed({
    "a.ts": `
      export namespace Shapes {
        export class Circle {}
        export interface Drawable { draw(): void }
      }
    `,
  });
  assert.deepStrictEqual(kinds(result), [
    "class:Shapes.Circle",
    "interface:Shapes.Drawable",
  ]);
});

test("a nested namespace stacks both levels into the name", () => {
  const { result } = analyzed({
    "a.ts": `
      export namespace Outer {
        export namespace Inner {
          export class Deep {}
        }
      }
    `,
  });
  assert.deepStrictEqual(kinds(result), ["class:Outer.Inner.Deep"]);
});

test("a namespace itself is not a node", () => {
  const { result } = analyzed({
    "a.ts": `
      export namespace Holder {
        export type A = string;
        export type B = number;
      }
    `,
  });
  assert.strictEqual(result.nodes.length, 2);
  assert.ok(!result.nodes.some((n) => n.name === "Holder"));
});

test("the same name at file top level and in a namespace is two nodes", () => {
  const { result } = analyzed({
    "a.ts": `
      export class Foo {}
      export namespace N {
        export class Foo {}
      }
    `,
  });
  assert.deepStrictEqual(kinds(result), ["class:Foo", "class:N.Foo"]);
  const ids = result.nodes.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, 2);
});

test("edges reach types inside a namespace", () => {
  const { result } = analyzed({
    "base.ts": `
      export namespace Shapes {
        export class Circle {}
      }
    `,
    "a.ts": `
      import { Shapes } from "./base";
      export class Round extends Shapes.Circle {}
    `,
  });
  assert.deepStrictEqual(
    edge(result, "Round", "Shapes.Circle").map((e) => e.kind),
    ["inherits"]
  );
});

test("a file with only a namespace is not a file node", () => {
  const { result } = analyzed({
    "a.ts": `
      export namespace Only {
        export class Thing {}
      }
    `,
  });
  assert.ok(!result.nodes.some((n) => n.kind === "file"));
});

test("a file of nothing but re-exports is not a node, whatever it is called", () => {
  const { result } = analyzed({
    "thing.ts": `export class Thing {}`,
    "browser.ts": `
      export * from "./thing";
      export { Thing as Renamed } from "./thing";
    `,
  });
  assert.deepStrictEqual(kinds(result), ["class:Thing"]);
});

test("a file of nothing but imports is not a node either", () => {
  const { result } = analyzed({
    "thing.ts": `export class Thing {}`,
    "side-effect.ts": `import "./thing";\nimport { Thing } from "./thing";`,
  });
  assert.deepStrictEqual(kinds(result), ["class:Thing"]);
});

test("a file with only constants is still a file node", () => {
  const { result } = analyzed({
    "limits.ts": `export const LIMIT = 10;`,
  });
  assert.deepStrictEqual(kinds(result), ["file:limits.ts"]);
});

test("a file that mixes in its own declarations is not a pure re-export", () => {
  const { result } = analyzed({
    "thing.ts": `export class Thing {}`,
    "mixed.ts": `
      export * from "./thing";
      export const VERSION = "1.0.0";
    `,
  });
  assert.deepStrictEqual(kinds(result), ["class:Thing", "file:mixed.ts"]);
});

// ---------------------------------------------------------------------------
// Members: a class's and an interface's methods.
//
// A method is not a node, and until it is a member nothing in the document
// names it — no list in the panel, no search that finds it, no type to open.

const SOURCE = `
export class Token {}

export class Parser {
  constructor(private readonly src: string) {}

  statement(): Token {
    this.expr();
    this.expr();
    return new Token();
  }

  expr(): void {
    this.eat();
    helper();
  }

  eat(): void {}

  parse(x: string): void;
  parse(x: number): void;
  parse(x: any): void {
    this.eat();
  }

  onTick = () => {
    this.eat();
  };

  get size(): number {
    return 0;
  }

  label = "parser";
}

export interface Reader {
  read(): Token;
  close(): void;
}

export function helper(): void {}
`;

const node = (r, name) => r.nodes.find((n) => n.name === name);
const member = (r, cls, name) => (node(r, cls).members || []).filter((m) => m.name === name);

test("a class lists its methods, constructor and function-valued properties", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  assert.deepStrictEqual(
    node(result, "Parser").members.map((m) => m.name),
    ["constructor", "statement", "expr", "eat", "parse", "onTick"]
  );
  assert.strictEqual(node(result, "Token").members, undefined, "a class with no methods records none");
  assert.strictEqual(node(result, "helper").members, undefined, "a function records none");
});

test("an accessor and a plain property are not members", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  const names = node(result, "Parser").members.map((m) => m.name);
  assert.ok(!names.includes("size"), "`get size()` is read, not called");
  assert.ok(!names.includes("label"), "a property holding a string is not a method");
});

test("an interface lists its method signatures", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  assert.deepStrictEqual(node(result, "Reader").members.map((m) => m.name), ["read", "close"]);
});

test("overloads are one member, at the implementation", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  const found = member(result, "Parser", "parse");
  assert.strictEqual(found.length, 1);
  const lines = SOURCE.replace(/^\n/, "").split("\n");
  assert.match(lines[found[0].line - 1], /parse\(x: any\)/);
});

test("a member records what it calls on this", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  const calls = (name) => member(result, "Parser", name)[0].calls || [];
  assert.deepStrictEqual(calls("statement"), ["expr"], "written twice, recorded once");
  assert.deepStrictEqual(calls("expr"), ["eat"], "a free function is not a member's call");
  assert.deepStrictEqual(calls("onTick"), ["eat"], "a function-valued property calls like a method");
  assert.deepStrictEqual(calls("eat"), []);
});

test("a member records the nodes its body names, each an edge its class has", () => {
  const { result } = analyzed({ "parser.ts": SOURCE });
  const points = (name) => member(result, "Parser", name)[0].points || [];
  assert.deepStrictEqual(points("statement"), [node(result, "Token").id]);
  assert.deepStrictEqual(points("expr"), [node(result, "helper").id]);
  const parser = node(result, "Parser").id;
  const edges = new Set(result.edges.map((e) => e.from + " " + e.to));
  for (const m of node(result, "Parser").members) {
    for (const to of m.points || []) assert.ok(edges.has(parser + " " + to), `${m.name} -> ${to}`);
  }
  assert.deepStrictEqual(member(result, "Reader", "read")[0].points, [node(result, "Token").id]);
});

test("a member on its class's own line is not recorded", () => {
  const { result } = analyzed({ "one.ts": "export class A { f() {} }\nexport class B {\n  g() {}\n}\n" });
  assert.strictEqual(node(result, "A").members, undefined);
  assert.deepStrictEqual(node(result, "B").members.map((m) => m.name), ["g"]);
});
