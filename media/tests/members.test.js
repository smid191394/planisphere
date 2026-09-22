"use strict";

// What a node says belongs to it.
//
// A Go method is its receiver's, and nothing else in the document names one:
// prometheus has 4,429 methods over 699 types, and a search of the drawing's
// nodes for `Append`, `Close`, `Run` or `Start` finds nothing while the
// source holds 36, 86, 28 and 5 of them. So the panel lists them and search
// offers them, and choosing one opens it — there is no node to move a camera
// to.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

const id = (sym, kind) => `/p/${sym}.go::${kind || "struct"}::${sym}`;
const N = (sym, kind, members) => ({
  id: id(sym, kind),
  name: sym,
  kind: kind || "struct",
  file: `/p/${sym}.go`,
  line: 1,
  ...(members ? { members } : {}),
});
const E = (a, b) => ({ from: id(a), to: id(b), kind: "uses" });
const M = (name, file, line) => ({ name, file, line });

/** A drawing with one type that records methods and one that records none. */
function withMembers() {
  return {
    nodes: [
      N("Server", "struct", [
        M("Start", "/p/Server.go", 5),
        M("ServeHTTP", "/p/Server_http.go", 3),
      ]),
      N("Plain"),
      N("Router"),
    ],
    edges: [E("Server", "Plain"), E("Server", "Router")],
  };
}

function opened(graph) {
  const g = loadGraphJs({ headless: true });
  g.send({ command: "setGraph", graph });
  return g;
}

const jumps = (g) => g.posted.filter((m) => m.command === "jumpTo");
const typeSearch = (g, text) => {
  const el = g.el("symbol-search");
  el.value = text;
  el.dispatch("input");
  return el;
};

// ---------------------------------------------------------------------------
suite("clicking a type lists its methods in the panel");

{
  const g = opened(withMembers());
  g.live.activateFocus(id("Server"));
  const list = g.el("comment-members");
  eq(list.children.length, 2, "one row per method, two rows");
  ok(!list.classList.contains("hidden"), "the list is shown");
  const first = list.children[0];
  ok(!!first && String(first.textContent).includes("Start"), `the row shows the method name, got ${first ? first.textContent : "no such row"}`);

  const before = jumps(g).length;
  const second = list.children[1];
  if (second) second.dispatch("click");
  const after = jumps(g);
  eq(after.length, before + 1, "clicking a row sends one jumpTo");
  const last = after[after.length - 1] || {};
  eq(last.file, "/p/Server_http.go", "jumps to the method's own file");
  eq(last.line, 3, "jumps to the method's own line");
}

// ---------------------------------------------------------------------------
suite("for a node with no members the panel is unchanged");

{
  const g = opened(withMembers());
  g.live.activateFocus(id("Plain"));
  const list = g.el("comment-members");
  eq(list.children.length, 0, "no rows");
  ok(list.classList.contains("hidden"), "the list is hidden");
}

// ---------------------------------------------------------------------------
suite("with both a comment and methods, both stay");

{
  // The host's answer arrives after the focus, and `showComment` takes the
  // list down with it — which is right when the list belonged to the node
  // before, and wrong when it belongs to this one.
  const g = opened(withMembers());
  g.live.activateFocus(id("Server"));
  g.send({ command: "setComment", id: id("Server"), lines: ["Server serves."] });
  const list = g.el("comment-members");
  eq(list.children.length, 2, "the methods are still there after the comment arrives");
  ok(!list.classList.contains("hidden"), "the list is not hidden");
  eq(g.el("comment-body").textContent, "Server serves.", "the comment is there too");
}

// ---------------------------------------------------------------------------
suite("search finds methods");

{
  const g = opened(withMembers());
  const hits = g.live.searchMatches(g.live.fullGraph, g.live.visibleIdSet(), "ServeHTTP");
  eq(hits.length, 1, "one hit");
  eq((hits[0] || {}).name, "ServeHTTP", "it is that method");
}

// ---------------------------------------------------------------------------
suite("choosing a method moves to the node it belongs to, not opening a file");

{
  const g = opened(withMembers());
  const el = typeSearch(g, "ServeHTTP");
  const before = { jumps: jumps(g).length, zoom: g.live.cy.zoom() };
  el.dispatch("keydown", { key: "Enter" });
  eq(jumps(g).length, before.jumps, "no file should be opened");
  eq(g.live.focusId, id("Server"), "focuses the node that records this method");

  // The camera ends where choosing that node would have put it.
  const direct = opened(withMembers());
  const el2 = typeSearch(direct, "Server");
  el2.dispatch("keydown", { key: "Enter" });
  eq(
    JSON.stringify([g.live.cy.zoom(), g.live.cy.pan()]),
    JSON.stringify([direct.live.cy.zoom(), direct.live.cy.pan()]),
    "the camera stops where it would when choosing that node directly"
  );

  const rows = g.el("comment-members").children;
  const marked = rows.filter((r) => r.classList.contains("picked"));
  eq(marked.length, 1, "exactly one row is marked");
  eq((marked[0] || {}).textContent, "ServeHTTP", "the marked row is the search hit");
}

{
  // Walking a run of matches that includes members opens nothing at all.
  const g = opened(withMembers());
  const el = typeSearch(g, "S");
  const before = jumps(g).length;
  for (let i = 0; i < 6; i++) el.dispatch("keydown", { key: "Enter" });
  eq(jumps(g).length, before, "six presses in a row open no file");
}

{
  // The list is still where a member is opened, at its own line.
  const g = opened(withMembers());
  typeSearch(g, "ServeHTTP");
  g.el("symbol-search").dispatch("keydown", { key: "Enter" });
  const row = g.el("comment-members").children.find((r) => r.textContent === "ServeHTTP");
  ok(row, "the row is in the list");
  const before = jumps(g).length;
  if (row) row.dispatch("click", {});
  const after = jumps(g);
  eq(after.length, before + 1, "clicking the row opens the file");
  eq((after[after.length - 1] || {}).line, 3, "opens at the method's own line number");
}

{
  // A node is still a node: Enter on one focuses it and frames it.
  const g = opened(withMembers());
  const el = typeSearch(g, "Router");
  el.dispatch("keydown", { key: "Enter" });
  eq(g.live.focusId, id("Router"), "choosing a node focuses it");
}


// ---------------------------------------------------------------------------
// A Java constructor is a member named after its type, and a Java nested type's
// name carries the type around it. Matched on the whole name alone, a search
// of guava for `SerializationProxy` would find 18 members and not one node,
// so every press of the key would open a file.

suite("the last segment of a name counts too, and nodes rank before members");

{
  const graph = {
    nodes: [
      {
        id: "/p/LocalCache.java::class::LocalCache.ManualSerializationProxy",
        name: "LocalCache.ManualSerializationProxy",
        kind: "class",
        file: "/p/LocalCache.java",
        line: 20,
        members: [{ name: "ManualSerializationProxy", file: "/p/LocalCache.java", line: 24 }],
      },
      { id: "/p/Other.java::class::Other", name: "Other", kind: "class", file: "/p/Other.java", line: 1 },
    ],
    edges: [
      {
        from: "/p/Other.java::class::Other",
        to: "/p/LocalCache.java::class::LocalCache.ManualSerializationProxy",
        kind: "uses",
      },
    ],
  };
  const g = opened(graph);
  const hits = g.live.searchMatches(g.live.fullGraph, g.live.visibleIdSet(), "ManualSerializationProxy");
  ok(hits.length >= 2, `both the type and its constructor should be found: ${hits.length}`);
  eq(hits[0].kind, "class", "the node ranks before the constructor");
  eq(hits[0].name, "LocalCache.ManualSerializationProxy", "the hit is the nested type");

  const before = jumps(g).length;
  const el = typeSearch(g, "ManualSerializationProxy");
  el.dispatch("keydown", { key: "Enter" });
  eq(jumps(g).length, before, "pressing Enter should not open the file directly");
  eq(g.live.focusId, "/p/LocalCache.java::class::LocalCache.ManualSerializationProxy", "the node is what gets chosen");
}

{
  // The member's id sorts before the node's, so only the rule that a node
  // outranks a member keeps this in order.
  const graph = {
    nodes: [
      {
        id: "/p/Aaa.java::class::Aaa",
        name: "Aaa",
        kind: "class",
        file: "/p/Aaa.java",
        line: 1,
        members: [{ name: "Thing", file: "/p/Aaa.java", line: 4 }],
      },
      { id: "/p/Zzz.java::class::Thing", name: "Thing", kind: "class", file: "/p/Zzz.java", line: 1 },
    ],
    edges: [{ from: "/p/Aaa.java::class::Aaa", to: "/p/Zzz.java::class::Thing", kind: "uses" }],
  };
  const g = opened(graph);
  const hits = g.live.searchMatches(g.live.fullGraph, g.live.visibleIdSet(), "Thing");
  eq(hits.length, 2, "both the node and the same-named method are found");
  eq(hits[0].kind, "class", "on a tie the node comes first, even when its id sorts later");
}

{
  // A method nothing else names is still a member match, and still opens.
  const g = opened(withMembers());
  const hits = g.live.searchMatches(g.live.fullGraph, g.live.visibleIdSet(), "ServeHTTP");
  eq(hits.length, 1, "with no same-named node, the method is still found");
  eq(hits[0].kind, "member", "it is the member");
}

module.exports = {};
