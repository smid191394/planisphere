"use strict";

// Which class a drawing chooses to be about.
//
// The class nearest to everything else, not the one that can walk to the most
// of the graph along directed edges. Out-reach finds the top of the deepest
// dependency chain — an application's entry point, not a codebase's subject —
// and on six projects whose subject nobody would argue about it names two:
// it puts Flask's centre on its CLI command group, Pydantic's on a private
// helper, Scrapy's on an HTTP download handler, Django's on an admin class.
//
// It also roots the tree at a leaf. Pydantic comes out as twelve children with
// 97% of the drawing behind one of them, CPython as two with 97%: the first
// rings empty and the picture starting somewhere out at the fourth.

const fs = require("fs");
const path = require("path");
const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g = loadGraphJs();

const N = (id, kind, lines) => ({
  id,
  name: id,
  kind: kind || "class",
  file: "/p/" + id + ".py",
  line: 1,
  endLine: lines || 40,
});
const E = (from, to, kind) => ({ from, to, kind: kind || "uses" });

// ---------------------------------------------------------------------------
suite("picks the near one, not the one that reaches far");

{
  // The shape out-reach always gets wrong: a hub with a chain hanging off
  // it. Walking out from the chain's end reaches everything; standing at the
  // hub is near everything. Only one of those is a centre.
  const nodes = [N("Hub", "class", 300)];
  const edges = [];
  for (let i = 0; i < 8; i++) {
    nodes.push(N("Kid" + i, "class", 60));
    edges.push(E("Hub", "Kid" + i, "inherits"));
  }
  let prev = "Hub";
  for (let i = 0; i < 5; i++) {
    nodes.push(N("Tail" + i, "class", 60));
    edges.push(E("Tail" + i, prev));
    prev = "Tail" + i;
  }
  const centre = g.pickTopClass({ nodes, edges });
  eq(centre, "Hub", "the centre should be the hub, not the end of the chain");
}

// ---------------------------------------------------------------------------
suite("a private name is not the subject");

{
  // Pydantic's `_Pipeline` is the case. A codebase marks what it does not mean
  // you to reach for, and that mark is the answer to whether it is a subject.
  const nodes = [N("_Helper", "class", 400), N("Thing", "class", 400)];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(N("Uses" + i, "class", 40));
    // Both are equally central; only the name tells them apart.
    edges.push(E("Uses" + i, "_Helper"), E("Uses" + i, "Thing"));
  }
  eq(g.pickTopClass({ nodes, edges }), "Thing", "of two equally central ones, the public one is picked");
}

// ---------------------------------------------------------------------------
suite("an exception is not the subject");

{
  // Django's `ImproperlyConfigured` outranks `Model` without this: everything
  // raises it, so everything is near it.
  const nodes = [N("ConfigError", "class", 400), N("Thing", "class", 400)];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(N("Uses" + i, "class", 40));
    edges.push(E("Uses" + i, "ConfigError"), E("Uses" + i, "Thing"));
  }
  eq(g.pickTopClass({ nodes, edges }), "Thing", "a name that reads as an exception is skipped");

  // And by what it inherits, not only by what it is called.
  const nodes2 = [N("Boom", "class", 400), N("Thing", "class", 400), N("ValueError", "class", 10)];
  const edges2 = [E("Boom", "ValueError", "inherits")];
  for (let i = 0; i < 6; i++) {
    nodes2.push(N("U" + i, "class", 40));
    edges2.push(E("U" + i, "Boom"), E("U" + i, "Thing"));
  }
  eq(g.pickTopClass({ nodes: nodes2, edges: edges2 }), "Thing", "one that inherits from an exception is skipped too");
}

// ---------------------------------------------------------------------------
suite("size breaks ties, it does not decide");

{
  // Two classes equally near everything: the bigger one is the subject.
  const nodes = [N("Small", "class", 12), N("Large", "class", 900)];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(N("U" + i, "class", 40));
    edges.push(E("U" + i, "Small"), E("U" + i, "Large"));
  }
  eq(g.pickTopClass({ nodes, edges }), "Large", "when equally central, the one with more weight is picked");

  // And within the range real projects show, it does not outvote nearness: a
  // class ten times the size, one hop off to the side, loses to the modest one
  // in the middle. Ten times is generous — the candidates that actually
  // compete differ by about 1.4 (Pydantic's 2,267-line `GenerateSchema`
  // against its 1,629-line `BaseModel`). It is a product, so a large enough
  // ratio wins eventually; what is claimed is that the ratios in real code do
  // not reach it.
  const nodes2 = [N("Middle", "class", 60), N("Big", "class", 600)];
  const edges2 = [E("Big", "Middle")];
  for (let i = 0; i < 8; i++) {
    nodes2.push(N("U" + i, "class", 40));
    edges2.push(E("U" + i, "Middle"));
  }
  eq(g.pickTopClass({ nodes: nodes2, edges: edges2 }), "Middle", "ten times the size still does not outweigh centrality");
}

// ---------------------------------------------------------------------------
// The benchmark: projects whose subject nobody would argue about, and both
// kinds of answer — the base class everything inherits, and the object you
// instantiate. A criterion that only gets one kind has not been tested.

const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");
const ANSWERS = {
  django: "Model",
  fastapi: "FastAPI",
  flask: "Flask",
  pydantic: "BaseModel",
  requests: "Session",
  scrapy: "Spider",
};
const present = Object.keys(ANSWERS).filter((n) =>
  fs.existsSync(path.join(FIXTURES, n, "planisphere.json"))
);

if (!present.length) {
  console.log("(skipping the centre benchmark — no generated artifacts)");
} else {
  suite("the subjects of six projects must not drop in rank");

  // Recorded, not asserted exactly: the point is that a later change to the
  // criterion is measured against these rather than argued about. A rank that
  // gets worse is a regression even when the name still comes out right.
  const CEILING = { django: 1, fastapi: 1, flask: 1, pydantic: 2, requests: 3, scrapy: 8 };

  for (const name of present) {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, name, "planisphere.json"), "utf8")
    );
    const byId = {};
    for (const n of artifact.nodes) byId[n.id] = n;
    const ranked = g.rankCentres(artifact);
    const at = ranked.findIndex((id) => byId[id] && byId[id].name === ANSWERS[name]) + 1;
    ok(
      at > 0 && at <= CEILING[name],
      `${ANSWERS[name]} in ${name} should rank within the top ${CEILING[name]}, got rank ${at || "—"}`
    );
  }

  suite("the picked centre does not hang the whole graph on one branch");

  for (const name of present) {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, name, "planisphere.json"), "utf8")
    );
    const W = g.live.withGroups(artifact);
    const centre = g.pickTopClass(artifact);
    const c = W.groupOf[centre] || centre;
    const ids = new Set(W.graph.nodes.filter((n) => !W.groupOf[n.id]).map((n) => n.id));
    const out = g.computeClassRingPositions(W.graph, c, ids, {});
    const tp = out.treeParent || {};
    const kids = {};
    for (const [id, p] of Object.entries(tp)) {
      if (out.groupOf[id] === c) (kids[p] = kids[p] || []).push(id);
    }
    const size = (id) => {
      let n = 1;
      for (const k of kids[id] || []) n += size(k);
      return n;
    };
    const direct = (kids[c] || []).map(size);
    const total = direct.reduce((a, b) => a + b, 0) || 1;
    const worst = Math.max(0, ...direct) / total;
    ok(worst < 0.8, `${name}: the largest branch should not take the whole graph, got ${(worst * 100).toFixed(0)}%`);
  }
}

// ---------------------------------------------------------------------------
// The centre each sample project chooses, written down.
//
// Not a claim that these are the right answers — `ANSWERS` above is that, and
// three of them differ. This guards a shortcut that is only worth taking if
// nothing moves: finding the centre from a handful of pivots instead of from
// every class is a twentieth of the work, and the only way to know it costs
// nothing is to have written down what "nothing" is.
//
// A name here changing is not necessarily a defect. It means the criterion
// moved, and that is a thing to have decided rather than to discover.

suite("the centre picked for each sample project, recorded verbatim");

{
  const CHOSEN = {
    tinydb: "Table",
    flask: "Flask",
    requests: "PreparedRequest",
    fastapi: "FastAPI",
    scrapy: "Crawler",
    pydantic: "GenerateSchema",
    django: "Model",
    cpython: "Pdb",
  };
  const here = Object.keys(CHOSEN).filter((n) =>
    fs.existsSync(path.join(FIXTURES, n, "planisphere.json"))
  );
  ok(here.length > 0, "at least one artifact is needed to measure");

  for (const name of here) {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, name, "planisphere.json"), "utf8")
    );
    const byId = {};
    for (const n of artifact.nodes) byId[n.id] = n;
    const got = g.pickTopClass(artifact);
    eq((byId[got] || {}).name, CHOSEN[name], `centre of ${name}`);
  }
}

// ---------------------------------------------------------------------------
suite("picking twice on the same graph gives the same centre");

{
  // Narrowing the candidates before measuring them must depend on the graph
  // and not on chance: a project that opened on a different node on different
  // days would be a project whose drawing nobody could describe.
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 40; i++) nodes.push(N("C" + i, "class", 40 + i));
  for (let i = 1; i < 40; i++) edges.push(E("C" + (i % 7), "C" + i, i % 3 ? "uses" : "inherits"));
  const graph = { nodes, edges };
  eq(g.pickTopClass(graph), g.pickTopClass(graph), "both picks are the same");

  // And on a copy of the same graph, not only on the same object.
  const copy = JSON.parse(JSON.stringify(graph));
  eq(g.pickTopClass(copy), g.pickTopClass(graph), "the same content gives the same pick");
}

// ---------------------------------------------------------------------------
suite("the estimated order picks the same one as the measured order");

{
  // Small enough that both can be computed, so the two can be compared at all.
  // What is asserted is not that the estimate is accurate — it is not, and does
  // not need to be — but that it puts the true winner among the few that are
  // then measured.
  const nodes = [];
  const edges = [];
  // A hub with a substantial body, a chain hanging off it, and a scatter of
  // small classes around the hub's neighbours.
  nodes.push(N("Hub", "class", 400));
  for (let i = 0; i < 12; i++) {
    nodes.push(N("Near" + i, "class", 80));
    edges.push(E("Hub", "Near" + i, "inherits"));
    for (let k = 0; k < 3; k++) {
      nodes.push(N("Far" + i + "_" + k, "class", 30));
      edges.push(E("Near" + i, "Far" + i + "_" + k));
    }
  }
  let prev = "Hub";
  for (let i = 0; i < 8; i++) {
    nodes.push(N("Tail" + i, "class", 900));
    edges.push(E("Tail" + i, prev));
    prev = "Tail" + i;
  }
  const graph = { nodes, edges };

  // The definition, computed here rather than asked of the viewer: reached
  // over mean distance, times the log of the size, over the same candidates.
  const und = {};
  for (const n of nodes) und[n.id] = [];
  for (const e of edges) {
    und[e.from].push(e.to);
    und[e.to].push(e.from);
  }
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  const exact = (id) => {
    const seen = new Set([id]);
    let frontier = [id];
    let depth = 0;
    let sum = 0;
    while (frontier.length) {
      depth++;
      const next = [];
      for (const u of frontier) {
        for (const v of und[u]) {
          if (seen.has(v)) continue;
          seen.add(v);
          sum += depth;
          next.push(v);
        }
      }
      frontier = next;
    }
    const reached = seen.size - 1;
    const n = byId[id];
    const lines = n.endLine - n.line + 1;
    return (reached ? (reached * reached) / sum : 0) * Math.log(1 + lines);
  };

  let best = null;
  let bestScore = -1;
  for (const n of nodes) {
    const s = exact(n.id);
    if (s > bestScore) {
      bestScore = s;
      best = n.id;
    }
  }
  eq(g.pickTopClass(graph), best, `after narrowing, the pick should be the one the definition itself picks (${best})`);
}

// ---------------------------------------------------------------------------
// How much of a type there is, where its methods are written apart from it.
//
// sqlparser-ranger's `Parser` is declared in 6 lines and has 69 methods in
// `impl` blocks; `TokenKind` is 205 lines of variants. Sized by its lines
// alone, the drawing would be centred on `TokenKind`.

suite("methods written outside the declaration count toward the type's weight");

{
  const member = (i, file) => ({ name: "m" + i, file, line: 1000 + i });
  const withMembers = (n, count, file) => ({
    ...n,
    members: Array.from({ length: count }, (_, i) => member(i, file)),
  });
  const pair = (a, b) => {
    const nodes = [a, b];
    const edges = [];
    for (let i = 0; i < 6; i++) {
      nodes.push(N("U" + i, "struct", 40));
      edges.push(E("U" + i, a.id), E("U" + i, b.id));
    }
    return { nodes, edges };
  };

  // Equally near; 6 lines and 300 methods elsewhere against 205 lines.
  const parser = withMembers(N("Parser", "struct", 6), 300, "/p/impl.rs");
  eq(
    g.pickTopClass(pair(parser, N("TokenKind", "enum", 205))),
    "Parser",
    "a type whose methods are written elsewhere should count them in its weight"
  );

  // In another file, a member is outside whatever its line number is.
  const elsewhere = N("Parser", "struct", 6);
  elsewhere.members = Array.from({ length: 300 }, (_, i) => ({ name: "m" + i, file: "/p/impl.rs", line: 2 }));
  eq(
    g.pickTopClass(pair(elsewhere, N("TokenKind", "enum", 205))),
    "Parser",
    "a method in another file counts even when its line falls inside the declaration range"
  );

  // In the same file but past the declaration's last line is outside too.
  const sameFile = withMembers(N("Parser", "struct", 6), 300, "/p/Parser.py");
  eq(
    g.pickTopClass(pair(sameFile, N("TokenKind", "enum", 205))),
    "Parser",
    "a method in the same file but outside the declaration range counts too"
  );

  // A trait's methods are inside its declaration: already counted by its lines.
  const trait = N("Trait", "trait", 100);
  trait.members = Array.from({ length: 300 }, (_, i) => ({
    name: "m" + i,
    file: trait.file,
    line: 2 + (i % 98),
  }));
  eq(
    g.pickTopClass(pair(trait, N("TokenKind", "enum", 205))),
    "TokenKind",
    "methods inside the declaration range are not counted twice"
  );

  // An artifact without members ranks by lines alone.
  const plain = pair(N("Small", "class", 12), N("Large", "class", 900));
  const bare = { nodes: plain.nodes.map((n) => ({ ...n })), edges: plain.edges };
  const empty = { nodes: plain.nodes.map((n) => ({ ...n, members: [] })), edges: plain.edges };
  eq(g.rankCentres(empty).join(), g.rankCentres(bare).join(), "for an artifact with no methods, the ranking is identical");
}

// ---------------------------------------------------------------------------
// A group of units is centred on what contains it.
//
// Every unit is the same size, and a module that many others sit beside is
// nearer to them than the crate holding them all: by nearness alone,
// sqlparser-ranger's unit group would be centred on `mod parser`, not on the
// crate.

suite("the centre of a unit group is the unit that contains the others");

{
  const U = (id, kind) => ({ id, name: id, kind, file: "/p/" + id + ".rs", line: 1 });
  const C = (from, to) => E(from, to, "contains");

  // crate ⊃ hub ⊃ eight modules; hub is nearer to everything than the crate.
  const nodes = [U("crate", "crate"), U("hub", "mod")];
  const edges = [C("crate", "hub")];
  for (let i = 0; i < 8; i++) {
    nodes.push(U("m" + i, "mod"));
    edges.push(C("hub", "m" + i));
  }
  const unitIds = nodes.map((n) => n.id);
  eq(g.pickCenterAmong(unitIds, { nodes, edges }), "crate", "the crate that contains the other units is the group's centre");

  // Two crates, each containing modules, joined by a use between two modules.
  const n2 = [U("a", "crate"), U("b", "crate"), U("mid", "mod")];
  const e2 = [C("a", "mid")];
  for (let i = 0; i < 6; i++) {
    n2.push(U("x" + i, "mod"));
    e2.push(C("mid", "x" + i), E("x" + i, "y" + i));
    n2.push(U("y" + i, "mod"));
    e2.push(C("b", "y" + i));
  }
  const picked = g.pickCenterAmong(n2.map((n) => n.id), { nodes: n2, edges: e2 });
  ok(picked === "a" || picked === "b", `with several roots, the centre is one of them (got ${picked})`);

  // Packages that contain types but not one another: nearness decides.
  const n3 = [U("core", "package")];
  const e3 = [];
  for (let i = 0; i < 6; i++) {
    n3.push(U("p" + i, "package"), N("T" + i, "struct", 40));
    e3.push(E("p" + i, "core"), C("p" + i, "T" + i));
  }
  const pkgs = n3.filter((n) => n.kind === "package").map((n) => n.id);
  eq(g.pickCenterAmong(pkgs, { nodes: n3, edges: e3 }), "core", "when units do not contain each other, the centre is unchanged");

  // The whole graph's centre is not moved onto a unit by containment.
  const n4 = nodes.map((n) => ({ ...n })).concat([N("Thing", "struct", 500)]);
  const e4 = edges.concat([E("Thing", "hub")], nodes.slice(2).map((n) => E(n.id, "Thing")));
  eq(g.pickTopClass({ nodes: n4, edges: e4 }), "Thing", "containment does not make a unit the main centre of the graph");
}

// ---------------------------------------------------------------------------
suite("the centre picked for the Go and Rust sample projects, recorded verbatim");

{
  const ROOT = path.join(__dirname, "..", "..", "fixtures");
  const CHOSEN = {
    "go/cobra": "Command",
    "go/gin": "Context",
    "go/hugo": "HugoSites",
    "go/prometheus": "Head",
    "rust/syn": "Fold",
    "rust/tokio": "AsyncReadExt",
    "rust/regex": "Automaton",
    "rust/ripgrep": "WalkBuilder",
    "rust/sqlparser-ranger": "Parser",
  };
  for (const [name, want] of Object.entries(CHOSEN)) {
    const file = path.join(ROOT, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of artifact.nodes) byId[n.id] = n;
    eq((byId[g.pickTopClass(artifact)] || {}).name, want, `centre of ${name}`);
  }
}

module.exports = {};
