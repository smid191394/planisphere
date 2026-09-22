"use strict";

// What a node is labelled when its name is not its own.
//
// The property is one sentence — no two drawn nodes share a label — and these
// are the shapes that make it hard: a name needing one component beside one
// needing three, paths that differ only at the root, paths of unequal depth,
// and a name carried by a file and a class at once. FastAPI has twelve
// affected nodes out of 126, so the fixture the project looks at most cannot
// show whether the rule holds at all.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const g = loadGraphJs();

/** `["a/b.py:Sym", ...]` → nodes. A trailing `#file` makes it a file node. */
function nodes(specs) {
  return specs.map((s) => {
    const isFile = s.endsWith("#file");
    const body = isFile ? s.slice(0, -5) : s;
    const [file, name] = body.split(":");
    return {
      id: `${file}::${isFile ? "file" : "class"}::${name}`,
      name,
      kind: isFile ? "file" : "class",
      file,
      line: 1,
    };
  });
}

const nameOf = (id) => {
  const at = id.lastIndexOf("::");
  return at === -1 ? id : id.slice(at + 2);
};

const labels = (ns) => g.labelsForDrawn(ns, nameOf);
const list = (ns) => ns.map((n) => labels(ns)[n.id]);

/** The requirement itself, checkable on any input. */
function allDistinct(ns, what) {
  const out = Object.values(labels(ns));
  eq(new Set(out).size, out.length, `${what} — labels should all differ: ${out.join(" | ")}`);
}

// ---------------------------------------------------------------------------
suite("a path is added only on a name clash");

{
  const ns = nodes(["a/models.py:Header", "a/params.py:Header"]);
  eq(list(ns).sort().join(" "), "models/Header params/Header", "one segment each is enough to tell them apart");
  allDistinct(ns, "two with the same name");
}

{
  const ns = nodes(["a/models.py:Header", "a/params.py:Query"]);
  eq(list(ns).sort().join(" "), "Header Query", "names already differ -> no path segment added");
}

{
  const ns = nodes(["a/only.py:Alone"]);
  eq(list(ns)[0], "Alone", "only one node -> nothing added");
}

// ---------------------------------------------------------------------------
suite("add just enough segments, no more");

{
  // `Error` is told apart by one component; `Queue` needs two, because both
  // live in a file called queues.py.
  const ns = nodes([
    "Lib/configparser.py:Error",
    "Lib/copy.py:Error",
    "Lib/asyncio/queues.py:Queue",
    "Lib/multiprocessing/queues.py:Queue",
  ]);
  const l = labels(ns);
  eq(l[ns[0].id], "configparser/Error", "one segment is enough for Error");
  eq(l[ns[1].id], "copy/Error", "one segment is enough for Error");
  // Both Queues live in a file called queues.py, so the component that tells
  // them apart is the directory above it — and only that one.
  eq(l[ns[2].id], "asyncio/Queue", "Queue uses the segment where the paths part");
  eq(l[ns[3].id], "multiprocessing/Queue", "Queue uses the segment where the paths part");
  allDistinct(ns, "one-segment and two-segment labels mixed");
}

{
  // Three deep, and only the root separates them.
  const ns = nodes([
    "one/db/backends/base.py:Wrapper",
    "two/db/backends/base.py:Wrapper",
  ]);
  eq(
    list(ns).sort().join(" "),
    "one/Wrapper two/Wrapper",
    "only the outermost segment differs -> write only that, the middle segments are the same on both"
  );
  allDistinct(ns, "only the root differs");
}

{
  // Unequal depth: the short one runs out of components before the long one.
  const ns = nodes(["top.py:Thing", "a/b/c/top.py:Thing"]);
  allDistinct(ns, "different depths");
  const out = list(ns);
  ok(
    out.some((x) => x === "top/Thing" || x === "Thing"),
    `the shallow one should not grow a path out of nothing: ${out.join(" | ")}`
  );
}

// ---------------------------------------------------------------------------
suite("write the segment where the paths part");

{
  // guava keeps an `android/` mirror: every class exists twice under paths that
  // differ at their second component and agree the whole way down. Taking the
  // run from the parting to the end would make a 166-character label.
  const ns = nodes([
    "guava/guava/src/com/google/common/collect/ImmutableRangeMap.java:SerializedForm",
    "guava/android/guava/src/com/google/common/collect/ImmutableRangeMap.java:SerializedForm",
  ]);
  eq(list(ns).sort().join(" "), "android/SerializedForm guava/SerializedForm", "only the segment that differs");
  allDistinct(ns, "two mirrored copies");
}

{
  // Three ways apart, differing in two places: both are needed, in path order.
  const ns = nodes([
    "x/one/lib/mod/Thing.java:Thing",
    "x/two/lib/mod/Thing.java:Thing",
    "y/one/lib/mod/Thing.java:Thing",
  ]);
  const out = list(ns).sort();
  allDistinct(ns, "three-way");
  ok(out.every((l) => l.split("/").length <= 3), `middle segments that match should not be written: ${out.join(" | ")}`);
  ok(out.includes("y/one/Thing"), `both differences should be written: ${out.join(" | ")}`);
}

{
  // guava holds `ForwardingBlockingDeque` in two packages, and mirrors both
  // under `android/`. The depth that separates the packages says nothing about
  // the mirrors, so taking depths in order would drag everything between them in.
  const ns = nodes([
    "r/guava/src/com/google/common/collect/Deque.java:Deque",
    "r/android/guava/src/com/google/common/collect/Deque.java:Deque",
    "r/guava/src/com/google/common/util/concurrent/Deque.java:Deque",
    "r/android/guava/src/com/google/common/util/concurrent/Deque.java:Deque",
  ]);
  allDistinct(ns, "two packages, two copies each");
  const out = list(ns).sort();
  ok(
    out.every((l) => l.split("/").length <= 3),
    `only the segments that separate them should be written: ${out.join(" | ")}`
  );
}

// ---------------------------------------------------------------------------
suite("when the name alone tells them apart, write only the segments needed");

{
  const ns = nodes([
    "a/Maps.java:Maps.KeySet",
    "a/Colour.java:Colour.Shade",
  ]);
  const l = labels(ns);
  eq(l[ns[0].id], "KeySet", "nothing else is called KeySet -> only the last segment");
  eq(l[ns[1].id], "Shade", "nothing else is called Shade -> only the last segment");
}

{
  const ns = nodes([
    "a/Maps.java:Maps.KeySet",
    "a/Sets.java:Sets.KeySet",
  ]);
  const l = labels(ns);
  eq(l[ns[0].id], "Maps.KeySet", "same name -> add the outer segment");
  eq(l[ns[1].id], "Sets.KeySet", "same name -> add the outer segment");
  allDistinct(ns, "two KeySets");
}

{
  // Two roots declaring the same class: the name is one name seen twice, so it
  // still shortens, and the root that differs is what is written in front.
  const ns = nodes([
    "guava/src/a/Maps.java:Maps.KeySet",
    "android/guava/src/a/Maps.java:Maps.KeySet",
  ]);
  const out = list(ns).sort();
  allDistinct(ns, "two copies of one name");
  eq(out.join(" "), "KeySet android/KeySet", "one shows the name, the other shows it is in the mirror");
}

{
  // Two *different* names ending alike, each declared twice. The name has to
  // keep a segment and the path still tells the twins apart.
  const ns = nodes([
    "guava/src/a/Maps.java:Maps.KeySet",
    "android/guava/src/a/Maps.java:Maps.KeySet",
    "guava/src/a/Sets.java:Sets.KeySet",
    "android/guava/src/a/Sets.java:Sets.KeySet",
  ]);
  allDistinct(ns, "two names, two copies each");
  const out = list(ns).sort();
  ok(out.every((l) => l.includes("Maps.KeySet") || l.includes("Sets.KeySet")),
     `the outer segment should stay when the names do not separate them: ${out.join(" | ")}`);
}

{
  // A file name's dot separates it from its extension. Read as segments,
  // cobra's file node would be labelled `go`.
  const ns = nodes(["a/command_notwin.go:command_notwin.go#file"]);
  eq(list(ns)[0], "command_notwin.go", "a file node's name is not a segmented name");
}

// ---------------------------------------------------------------------------
suite("unit nodes also use the directory, not whichever file they happen to land in");

{
  // A package's node sits in whichever of its files sorts first, and guava's
  // two source roots pick different ones: told apart by that, the two nodes
  // for `com.google.common.util.concurrent` would be told apart by a
  // benchmark's file name, which says nothing about either of them.
  const ns = [
    {
      id: "r/guava/src/a/b/Alpha.java::package::a.b",
      name: "a.b", kind: "package", file: "r/guava/src/a/b/Alpha.java", line: 1,
    },
    {
      id: "r/android/guava/src/a/b/Zeta.java::package::a.b",
      name: "a.b", kind: "package", file: "r/android/guava/src/a/b/Zeta.java", line: 1,
    },
  ];
  const l = g.labelsForDrawn(ns, () => null, (n) => n.kind === "package");
  const out = Object.values(l).sort();
  eq(out.join(" "), "android/b r/b", "told apart by the root's name, not by the file it lands in");
  ok(!out.some((l) => l.includes(".java")), `file names should not appear in package labels: ${out.join(" | ")}`);
}

// ---------------------------------------------------------------------------
suite("file nodes use the directory, not the file name");

{
  const ns = nodes([
    "conf/locale/ar/formats.py:formats.py#file",
    "conf/locale/az/formats.py:formats.py#file",
    "conf/locale/de/formats.py:formats.py#file",
  ]);
  eq(
    list(ns).sort().join(" "),
    "ar/formats.py az/formats.py de/formats.py",
    "the file name should not repeat"
  );
  allDistinct(ns, "a miniature of the 85 formats.py files");
}

{
  // A file node and a class can carry the same name only if the class is named
  // like a filename, which Python does not do — but the two kinds still share
  // one namespace here, so the rule has to cope with the mix.
  const ns = nodes(["pkg/util.py:Helper", "pkg/other/util.py:util.py#file"]);
  allDistinct(ns, "files and classes mixed");
}

// ---------------------------------------------------------------------------
suite("same-named nodes in one file");

{
  // `class Foo` then `def Foo` in one module: two nodes, same name, same file.
  // No path can separate them, and the rule must not invent one.
  const ns = [
    { id: "a/m.py::class::Foo", name: "Foo", kind: "class", file: "a/m.py", line: 1 },
    { id: "a/m.py::function::Foo", name: "Foo", kind: "function", file: "a/m.py", line: 9 },
  ];
  const out = Object.values(labels(ns));
  eq(out[0], "Foo", "no path separates them, so nothing is added");
  eq(out[1], "Foo", "the other one too");
}

// ---------------------------------------------------------------------------
suite("group nodes: no base added when the count is enough");

{
  const ns = [
    { id: "group::Command /p/base.py::class::BaseCommand", name: "Command", kind: "class", file: "", line: 0, groupSize: 29 },
    { id: "group::Command /p/templates.py::class::TemplateCommand", name: "Command", kind: "class", file: "", line: 0, groupSize: 2 },
  ];
  eq(list(ns).sort().join(" | "), "Command ×2 | Command ×29", "different counts -> no base added");
  allDistinct(ns, "two Command groups");
}

{
  // Django's only case: same name, same size. Path cannot help — every member
  // of both groups is under django/db/backends — so the base is what differs.
  const ns = [
    { id: "group::DatabaseFeatures /p/gis/features.py::class::BaseSpatialFeatures", name: "DatabaseFeatures", kind: "class", file: "", line: 0, groupSize: 4 },
    { id: "group::DatabaseFeatures /p/base/features.py::class::BaseDatabaseFeatures", name: "DatabaseFeatures", kind: "class", file: "", line: 0, groupSize: 4 },
  ];
  eq(
    list(ns).sort().join(" | "),
    "BaseDatabaseFeatures/DatabaseFeatures ×4 | BaseSpatialFeatures/DatabaseFeatures ×4",
    "same name and count -> add the base that defines the group"
  );
  allDistinct(ns, "two DatabaseFeatures ×4");
}

{
  const ns = [
    { id: "group::StreamReader /p/codecs.py::class::StreamReader", name: "StreamReader", kind: "class", file: "", line: 0, groupSize: 121 },
    { id: "/p/other.py::class::StreamReader", name: "StreamReader", kind: "class", file: "/p/other.py", line: 1 },
  ];
  eq(list(ns).sort().join(" | "), "StreamReader | StreamReader ×121", "group and ordinary node labels already differ");
}

// ---------------------------------------------------------------------------
suite("grouping is a pure function of the input");

{
  const ns = nodes([
    "Lib/configparser.py:Error",
    "Lib/copy.py:Error",
    "Lib/mailbox.py:Error",
    "solo.py:Unique",
  ]);
  const first = JSON.stringify(labels(ns));
  eq(JSON.stringify(labels(ns)), first, "the same input twice gives the same result");
  const shuffled = ns.slice().reverse();
  const a = labels(ns);
  const b = labels(shuffled);
  ok(
    ns.every((n) => a[n.id] === b[n.id]),
    "reordering the input leaves every node's label unchanged"
  );
}

// ---------------------------------------------------------------------------
// Through the real viewer. The pure function proves the rule; only this proves
// that anything calls it, and that the labels follow what is drawn rather than
// what the artifact holds.
{
  suite("labels follow what is on screen");

  const id = (file, sym, kind) => `/p/${file}::${kind || "class"}::${sym}`;
  const N = (file, sym, kind) => ({
    id: id(file, sym, kind),
    name: sym,
    kind: kind || "class",
    file: `/p/${file}`,
    line: 1,
  });

  const drawnLabel = (L, nodeId) => {
    const n = L.cy.getElementById(nodeId);
    return n.nonempty() && n.style("display") !== "none" ? n.data("label") : null;
  };

  // A class named Error, and a *function* named Error in another file. While
  // functions are hidden the class is the only Error on screen.
  {
    const gg = loadGraphJs({ headless: true });
    gg.send({
      command: "setGraph",
      graph: {
        nodes: [
          N("a/hub.py", "Hub"),
          N("a/configparser.py", "Error"),
          N("a/copy.py", "Error", "function"),
        ],
        edges: [
          { from: id("a/configparser.py", "Error"), to: id("a/hub.py", "Hub"), kind: "uses" },
          { from: id("a/copy.py", "Error", "function"), to: id("a/hub.py", "Hub"), kind: "uses" },
        ],
      },
    });
    const L = gg.live;
    eq(
      drawnLabel(L, id("a/configparser.py", "Error")),
      "Error",
      "while functions are hidden, a class should not get a path because of something not visible"
    );

    gg.el("toggle-fns").dispatch("click");
    eq(
      drawnLabel(L, id("a/configparser.py", "Error")),
      "configparser/Error",
      "functions shown, two Errors on screen at once -> path added"
    );
    eq(
      drawnLabel(L, id("a/copy.py", "Error", "function")),
      "copy/Error",
      "the function one too"
    );

    gg.el("toggle-fns").dispatch("click");
    eq(
      drawnLabel(L, id("a/configparser.py", "Error")),
      "Error",
      "hidden again -> path removed"
    );
  }

  // A group's members never appear, so they never take part in disambiguation.
  {
    const gg = loadGraphJs({ headless: true });
    const nodes = [N("base.py", "Base"), N("elsewhere/Reader.py", "Reader")];
    const edges = [];
    for (let i = 0; i < 3; i++) {
      nodes.push(N(`mod${i}.py`, "Reader"));
      edges.push({ from: id(`mod${i}.py`, "Reader"), to: id("base.py", "Base"), kind: "inherits" });
    }
    edges.push({ from: id("elsewhere/Reader.py", "Reader"), to: id("base.py", "Base"), kind: "uses" });
    gg.send({ command: "setGraph", graph: { nodes, edges } });
    const L = gg.live;
    const groupId = Object.keys(L.groupsById)[0];

    eq(
      drawnLabel(L, id("elsewhere/Reader.py", "Reader")),
      "Reader",
      "only one ordinary node called Reader is on screen, so it needs no path"
    );
    eq(drawnLabel(L, groupId), "Reader ×3", "the group node carries the count");
    for (let i = 0; i < 3; i++) {
      eq(
        drawnLabel(L, id(`mod${i}.py`, "Reader")),
        null,
        `member ${i} is not drawn, so it has no label`
      );
    }
  }

  // The requirement itself, on the real drawing: no two visible labels agree.
  {
    const gg = loadGraphJs({ headless: true });
    const nodes = [N("base.py", "Base")];
    const edges = [];
    for (let i = 0; i < 4; i++) {
      nodes.push(N(`x/dup${i}.py`, "Same"));
      edges.push({ from: id(`x/dup${i}.py`, "Same"), to: id("base.py", "Base"), kind: "uses" });
      nodes.push(N(`y/dup${i}.py`, "Same"));
      edges.push({ from: id(`y/dup${i}.py`, "Same"), to: id("base.py", "Base"), kind: "uses" });
    }
    gg.send({ command: "setGraph", graph: { nodes, edges } });
    const L = gg.live;
    const shown = L.cy
      .nodes()
      .filter((n) => n.style("display") !== "none")
      .map((n) => n.data("label"));
    eq(new Set(shown).size, shown.length, `no two labels on screen are the same: ${shown.join(" | ")}`);
  }

  // Display only: the name is what search reads.
  {
    const gg = loadGraphJs({ headless: true });
    gg.send({
      command: "setGraph",
      graph: {
        nodes: [N("hub.py", "Hub"), N("a/one.py", "Error"), N("a/two.py", "Error")],
        edges: [
          { from: id("a/one.py", "Error"), to: id("hub.py", "Hub"), kind: "uses" },
          { from: id("a/two.py", "Error"), to: id("hub.py", "Hub"), kind: "uses" },
        ],
      },
    });
    const L = gg.live;
    eq(drawnLabel(L, id("a/one.py", "Error")), "one/Error", "shown with its path");
    const hits = L.searchMatches(L.fullGraph, L.visibleIdSet(), "Error");
    eq(hits.length, 2, "searching Error finds both - the path is for reading, not for typing");
    eq(
      L.searchMatches(L.fullGraph, L.visibleIdSet(), "one/Error").length,
      0,
      "search matches the name, not the label"
    );
  }
}

module.exports = {};
