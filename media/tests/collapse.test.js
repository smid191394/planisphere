"use strict";

// Opening and closing a group, and what a group cannot answer.
//
// These drive the real viewer — the shipped graph.js, the cytoscape the webview
// loads — rather than calling the pure functions. What is being checked here is
// not a rule but a sequence: press a key, see the drawing change, press it
// again, see it change back. A test that called `groupSameNamedSiblings` would
// pass whether or not the key was ever bound.

const { loadGraphJs, suite, ok, eq } = require("./harness.js");

/** `n` classes named `name`, all deriving from `base`, plus some unrelated ones. */
function repeated(name, count, base, extra) {
  const id = (file, sym) => `/p/${file}::class::${sym}`;
  const nodes = [{ id: id("base.py", base), name: base, kind: "class", file: "/p/base.py", line: 1 }];
  const edges = [];
  for (let i = 0; i < count; i++) {
    const file = `mod${i}.py`;
    nodes.push({ id: id(file, name), name, kind: "class", file: `/p/${file}`, line: 3 });
    edges.push({ from: id(file, name), to: id("base.py", base), kind: "inherits" });
  }
  for (const sym of extra || []) {
    nodes.push({ id: id(`${sym}.py`, sym), name: sym, kind: "class", file: `/p/${sym}.py`, line: 1 });
    edges.push({ from: id(`${sym}.py`, sym), to: id("base.py", base), kind: "uses" });
  }
  return { graph: { nodes, edges }, id };
}

function opened() {
  const g = loadGraphJs({ headless: true });
  const { graph, id } = repeated("Reader", 5, "Base", ["Alpha", "Beta", "Gamma"]);
  g.send({ command: "setGraph", graph });
  const groupIds = Object.keys(g.live.groupsById);
  return { g, graph, id, groupId: groupIds[0], L: g.live };
}

// ---------------------------------------------------------------------------
suite("collapsed by default");

{
  const { L, groupId, id } = opened();
  eq(Object.keys(L.groupsById).length, 1, "one group recognised");
  eq(L.groupsById[groupId].members.length, 5, "the group has 5 members");
  const visible = L.visibleIdSet();
  ok(visible.has(groupId), "the group node is on screen");
  for (let i = 0; i < 5; i++) {
    ok(!visible.has(id(`mod${i}.py`, "Reader")), `member ${i} is not on screen`);
  }
  const node = L.cy.getElementById(groupId);
  ok(node.nonempty(), "the group node is a real cytoscape element");
  eq(node.data("label"), "Reader ×5", "the label carries the count");
  ok(node.hasClass("grouped"), "the group node carries the grouped class");
  eq(node.data("file"), "", "the group node has no source location");
}

// ---------------------------------------------------------------------------
suite("a group node has no answer to where to jump");

{
  const { g, L, groupId } = opened();
  const before = g.posted.length;
  L.activateFocus(groupId);
  eq(L.pendingJumpId, groupId, "after the first activation, the second lands on the same node");

  // Second activation, through cytoscape's own event, not a stand-in.
  L.cy.getElementById(groupId).emit("tap");
  const jumps = g.posted.slice(before).filter((m) => m.command === "jumpTo");
  eq(jumps.length, 0, "a second activation of a group node should not send jumpTo");

  const list = g.el("comment-members");
  eq(list.children.length, 5, "lists the five members instead");
  ok(!list.classList.contains("hidden"), "the member list is shown");
  eq(g.el("comment-title").textContent, "Reader ×5", "the title is the group name and count");
  eq(list.children[0].textContent, "mod0.py", "paths drop the common prefix");

  // A row is what has a location.
  list.children[2].dispatch("click");
  const after = g.posted.filter((m) => m.command === "jumpTo");
  eq(after.length, 1, "clicking a member sends one jumpTo");
  eq(after[0].file, "/p/mod2.py", "it sends that member's file");
  eq(after[0].line, 3, "and its line number");
}

{
  const { g, L, groupId } = opened();
  const before = g.posted.length;
  L.activateFocus(groupId);
  const asked = g.posted.slice(before).filter((m) => m.command === "getComment");
  eq(asked.length, 0, "a group node does not ask for a comment - there is one per member and no reason to pick one");
}

{
  // A folded member is not in the drawing at all: nothing is built until it is
  // drawn, and a member is never drawn.
  //
  // Nothing in the viewer reaches this: a tap arrives from a drawn node, and
  // search offers the group under the shared name rather than its members.
  const { g, L, groupId, id } = opened();
  L.activateFocus(groupId);
  const member = id("mod1.py", "Reader");
  ok(L.cy.getElementById(member).empty(), "a folded member is not in the graph");

  const before = g.posted.length;
  L.activateFocus(member);
  const asked = g.posted.slice(before).filter((m) => m.command === "getComment");
  eq(asked.length, 0, "so focusing it does nothing");
}

// ---------------------------------------------------------------------------
suite("search finds the group by its shared name");

{
  const { L, groupId, id } = opened();
  const hits = L.searchMatches(L.fullGraph, L.visibleIdSet(), "Reader");
  eq(hits.length, 1, "Reader appears once, not five times");
  eq(hits[0].id, groupId, "the hit is the group node");

  // The members are not offered, and nothing is lost by that: they are not
  // drawn, and they all carry that one name, so a search could not tell them
  // apart if it did offer them. The list beside the drawing names each one.
  ok(
    !hits.some((n) => n.id === id("mod3.py", "Reader")),
    "members should not appear in search results"
  );
}

// ---------------------------------------------------------------------------
suite("a group does not take the centre");

{
  // The group out-reaches every real class here, which is exactly the Django
  // situation. The centre must still be a class that can be opened.
  const g = loadGraphJs({ headless: true });
  const id = (file, sym) => `/p/${file}::class::${sym}`;
  const nodes = [
    { id: id("base.py", "Base"), name: "Base", kind: "class", file: "/p/base.py", line: 1 },
    { id: id("hub.py", "Hub"), name: "Hub", kind: "class", file: "/p/hub.py", line: 1 },
  ];
  const edges = [];
  for (let i = 0; i < 8; i++) {
    nodes.push({ id: id(`c${i}.py`, "Cmd"), name: "Cmd", kind: "class", file: `/p/c${i}.py`, line: 1 });
    edges.push({ from: id(`c${i}.py`, "Cmd"), to: id("base.py", "Base"), kind: "inherits" });
    nodes.push({ id: id(`leaf${i}.py`, `L${i}`), name: `L${i}`, kind: "class", file: `/p/leaf${i}.py`, line: 1 });
    edges.push({ from: id(`c${i}.py`, "Cmd"), to: id(`leaf${i}.py`, `L${i}`), kind: "uses" });
  }
  edges.push({ from: id("hub.py", "Hub"), to: id("base.py", "Base"), kind: "uses" });
  g.send({ command: "setGraph", graph: { nodes, edges } });
  const L = g.live;
  ok(
    L.centerClassId.indexOf("group::") !== 0,
    `the centre is a real class, not a group: ${L.centerClassId}`
  );
  ok(
    L.visibleIdSet().has(L.visibleCenter()),
    "the drawn centre is always on screen"
  );
}

// ---------------------------------------------------------------------------
// The largest group there is. A group cannot be opened, so what this guards
// is that all 121 stay folded and the one node carries the count.
{
  const fs = require("fs");
  const path = require("path");
  const CPYTHON = path.join(
    __dirname, "..", "..", "fixtures", "python", "cpython",
    "planisphere.json"
  );
  if (fs.existsSync(CPYTHON)) {
    suite("the biggest group");
    const g = loadGraphJs({ headless: true });
    g.send({ command: "setGraph", graph: JSON.parse(fs.readFileSync(CPYTHON, "utf8")) });
    const L = g.live;
    const biggest = Object.values(L.groupsById).sort(
      (a, b) => b.members.length - a.members.length
    )[0];
    eq(`${biggest.name}×${biggest.members.length}`, "StreamReader×121", "the biggest group");

    const node = L.cy.getElementById(biggest.id);
    eq(node.data("label"), "StreamReader ×121", "the label carries the count");

    let drawnMembers = 0;
    for (const m of biggest.members) {
      const n = L.cy.getElementById(m);
      if (n.nonempty() && n.style("display") !== "none") drawnMembers++;
    }
    eq(drawnMembers, 0, "none of the 121 members should be drawn");
  }
}

module.exports = {};

// ---------------------------------------------------------------------------
// A member is never drawn, so the list is the only route to it. That makes the
// list the thing to check: 599 of CPython's nodes and 118 of Django's are
// reachable through it and nowhere else.
{
  const fs = require("fs");
  const path = require("path");
  const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "python");

  for (const name of ["django", "cpython"]) {
    const file = path.join(FIXTURES, name, "planisphere.json");
    if (!fs.existsSync(file)) continue;
    suite(`nodes folded into groups in ${name} are still reachable`);

    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    const byId = {};
    for (const n of graph.nodes) byId[n.id] = n;
    const g = loadGraphJs({ headless: true });
    g.send({ command: "setGraph", graph });
    const L = g.live;

    const folded = Object.keys(L.memberGroupOf);
    ok(folded.length > 100, `need enough folded nodes for the test to mean anything, got ${folded.length}`);

    // Every folded member is listed by exactly one group, and its group is
    // drawn whenever its kind is. Functions are hidden by default and a group
    // of functions is a function, so the promise is not "always on screen" —
    // it is "on screen exactly when a member would have been".
    const listed = new Set();
    for (const group of Object.values(L.groupsById)) {
      const node = L.cy.getElementById(group.id);
      const kind = byId[group.members[0]].kind;
      const shown = node.nonempty() && node.style("display") !== "none";
      ok(
        shown === (kind !== "function"),
        `group ${group.name} (${kind}) should be ${kind === "function" ? "hidden along with functions" : "on screen"}`
      );
      for (const m of group.members) listed.add(m);
    }
    eq(listed.size, folded.length, "every folded member is listed by some group");

    // Not one of them is drawn.
    let drawn = 0;
    for (const m of folded) {
      const n = L.cy.getElementById(m);
      if (n.nonempty() && n.style("display") !== "none") drawn++;
    }
    eq(drawn, 0, "no member is drawn");

    // Every member has a file to open — that is what "reachable" means here.
    let noFile = 0;
    for (const m of folded) {
      const n = byId[m];
      if (!n || !n.file) noFile++;
    }
    eq(noFile, 0, "every member has a file to open");

    // And the panel really renders them: activate the biggest group twice.
    // The biggest drawn one — a group of functions is not on screen in the
    // default view, and a node nobody can see is not what this asserts.
    const biggest = Object.values(L.groupsById)
      .filter((gr) => byId[gr.members[0]].kind !== "function")
      .sort((a, b) => b.members.length - a.members.length)[0];
    L.activateFocus(biggest.id);
    L.cy.getElementById(biggest.id).emit("tap");
    const rows = g.el("comment-members").children;
    eq(rows.length, biggest.members.length, "the panel lists every member");

    const before = g.posted.filter((m) => m.command === "jumpTo").length;
    rows[Math.floor(rows.length / 2)].dispatch("click");
    eq(
      g.posted.filter((m) => m.command === "jumpTo").length,
      before + 1,
      "clicking a row sends jumpTo"
    );
  }
}
