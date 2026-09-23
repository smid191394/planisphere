// What counts as a comment, and what a marker is.
//
// Every marker counts, not only Python's: the 5,259 comments sitting directly
// above a definition in hugo, prometheus and Angular are every one of them
// written with two slashes or a block instead of a hash.

import { test } from "node:test";
import assert from "node:assert";
import { leadingComment } from "../leadingComment";

/** The file as lines, and the 1-based line the definition sits on. */
const above = (lines: string[], line: number): string[] =>
  leadingComment(lines, line);

// ---------------------------------------------------------------------------
// The positional rule, with Python's hash.

test("hash comments are shown in order with the marker removed", () => {
  const file = ["# 上面這一行", "# 還有這一行", "class Thing:"];
  assert.deepStrictEqual(above(file, 3), ["上面這一行", "還有這一行"]);
});

test("a decorator is skipped and the comment above still belongs to the definition", () => {
  const file = ["# 它的註解", "@decorator", "def f():"];
  assert.deepStrictEqual(above(file, 3), ["它的註解"]);
});

test("a blank line between comment and definition shows nothing", () => {
  const file = ["# 離得遠的註解", "", "class Thing:"];
  assert.deepStrictEqual(above(file, 3), []);
});

test("a comment at the end of the definition line does not count as above it", () => {
  const file = ["class Thing:  # 行末的註解"];
  assert.deepStrictEqual(above(file, 1), []);
});

// ---------------------------------------------------------------------------
// What opens the definition, where nothing is written above it.

test("a quoted block opening the definition is shown without its markers", () => {
  const file = ["class Thing:", '    """What it is for."""'];
  assert.deepStrictEqual(above(file, 1), ["What it is for."]);
});

test("a quoted block of several lines keeps its own shape", () => {
  const file = [
    "class Thing:",
    '    """What it is for.',
    "",
    "    And what it is not for:",
    "      - one",
    '    """',
  ];
  assert.deepStrictEqual(above(file, 1), [
    "What it is for.",
    "",
    "And what it is not for:",
    "  - one",
  ]);
});

test("what is written above the definition wins over what opens it", () => {
  const file = ["# The comment above.", "class Thing:", '    """The block below."""'];
  assert.deepStrictEqual(above(file, 2), ["The comment above."]);
});

test("single quotes open a block as well", () => {
  const file = ["def f():", "    '''What it does.'''"];
  assert.deepStrictEqual(above(file, 1), ["What it does."]);
});

test("a quoted block that does not open the definition is not shown", () => {
  const file = ["def f():", "    total = 0", '    """Not the definition’s."""'];
  assert.deepStrictEqual(above(file, 1), []);
});

test("a string assigned below the definition is not a block that opens it", () => {
  const file = ["class Thing:", '    name = "Thing"'];
  assert.deepStrictEqual(above(file, 1), []);
});

test("nothing below the definition at all", () => {
  const file = ["class Thing:"];
  assert.deepStrictEqual(above(file, 1), []);
});

// ---------------------------------------------------------------------------
// What documentation is marked up with, which a reader of a drawing is not
// reading the markup of.

test("a braced tag is shown as what it names", () => {
  const file = ["// Reads into a {@link JsonNode}.", "class ObjectMapper {}"];
  assert.deepStrictEqual(above(file, 2), ["Reads into a JsonNode."]);
});

test("a braced tag with no text is dropped", () => {
  const file = ["// Nothing follows it {@inheritDoc}", "class Thing {}"];
  assert.deepStrictEqual(above(file, 2), ["Nothing follows it"]);
});

test("paragraph markup is dropped and the lines are kept", () => {
  const file = [
    "/**",
    " * The first paragraph.",
    " * <p>",
    " * The second, with <code>code</code> in it.",
    " */",
    "class Thing {}",
  ];
  assert.deepStrictEqual(above(file, 6), [
    "The first paragraph.",
    "",
    "The second, with code in it.",
  ]);
});

test("a generic type is not markup", () => {
  const file = ["// Holds a List<String>, not a tag.", "class Thing {}"];
  assert.deepStrictEqual(above(file, 2), ["Holds a List<String>, not a tag."]);
});

test("a line number past the end of the file does not throw", () => {
  // The artifact can be older than the file it points into.
  const file = ["class Thing:"];
  assert.deepStrictEqual(above(file, 99), []);
});

test("only one space after the marker is removed, deeper indentation stays", () => {
  const file = ["#   - 一項", "# 說明", "class T:"];
  assert.deepStrictEqual(above(file, 3), ["  - 一項", "說明"]);
});

// ---------------------------------------------------------------------------
// Two slashes and blocks.

test("double-slash comments are shown", () => {
  const file = ["// 上面這一行", "// 還有這一行", "type Server struct{}"];
  assert.deepStrictEqual(above(file, 3), ["上面這一行", "還有這一行"]);
});

test("a block comment is shown with its markers and continuation stars removed", () => {
  const file = [
    "/**",
    " * 一個東西。",
    " *",
    " * 第二段。",
    " */",
    "export class Thing {}",
  ];
  // A line that is only a delimiter is not a line of the comment; a line that
  // is a deliberately empty continuation is, or two paragraphs become one.
  assert.deepStrictEqual(above(file, 6), ["一個東西。", "", "第二段。"]);
});

test("a block comment on a single line counts too", () => {
  const file = ["/* 一個東西。 */", "export class Thing {}"];
  assert.deepStrictEqual(above(file, 2), ["一個東西。"]);
});

test("a block comment separated by a blank line shows nothing", () => {
  const file = ["/* 離得遠 */", "", "export class Thing {}"];
  assert.deepStrictEqual(above(file, 3), []);
});

test("double slashes after code are not a comment line", () => {
  const file = ["x := 1 // 行末", "type Server struct{}"];
  assert.deepStrictEqual(above(file, 2), []);
});

test("which markers count is not decided by the file name", () => {
  // The function is handed lines and a line number, and never a file name:
  // there is nothing here that could key on an extension. Both markers read
  // the same on the same shape, which is the whole of the rule.
  assert.deepStrictEqual(above(["// 註解", "func F() {}"], 2), ["註解"]);
  assert.deepStrictEqual(above(["# 註解", "def f():"], 2), ["註解"]);
});

// ---------------------------------------------------------------------------
// Rust. Its documentation marker is three slashes, and a line beginning `#` is
// an attribute rather than a comment. Read as `//` and `#`, a doc line would
// keep a stray `/`, and an attribute such as `[derive(Debug)]` would show as
// text.

test("a triple-slash marker is removed whole", () => {
  const file = ["/// 第一行", "///", "/// 第二段", "struct S;"];
  assert.deepStrictEqual(above(file, 4), ["第一行", "", "第二段"]);
});

test("a divider made of slashes is still shown", () => {
  assert.deepStrictEqual(above(["////////", "export class T {}"], 2), ["//////"]);
  assert.deepStrictEqual(above(["//// Types", "export class T {}"], 2), ["// Types"]);
});

test("an attribute is skipped, not read as a comment", () => {
  const file = [
    "/// Keeps track of the exit status.",
    "#[derive(Debug)]",
    "#![allow(dead_code)]",
    "struct ChildStdio;",
  ];
  assert.deepStrictEqual(above(file, 4), ["Keeps track of the exit status."]);
});

test("an attribute between two comment blocks is skipped too", () => {
  const file = ["/// 上段", "#[cfg(unix)]", "/// 下段", "#[derive(Debug)]", "struct S;"];
  assert.deepStrictEqual(above(file, 5), ["上段", "下段"]);
});

test("an attribute written over several lines is skipped whole", () => {
  const file = [
    "/// 說明",
    "#[cfg_attr(",
    "    feature = \"serde\",",
    "    derive(Serialize)",
    ")]",
    "struct S;",
  ];
  assert.deepStrictEqual(above(file, 6), ["說明"]);
});

test("a multi-line attribute whose start cannot be found stops without guessing", () => {
  const file = ["/// 說明", "    x,", ")]", "struct S;"];
  assert.deepStrictEqual(above(file, 4), []);
});

test("a Python comment starting with #[ but not ending with ] is still a comment", () => {
  const file = ["#[69,99] is in the century 1900", "def f():"];
  assert.deepStrictEqual(above(file, 2), ["[69,99] is in the century 1900"]);
});

test("searching up for an attribute's start does not cross a blank line", () => {
  const file = ["/// 說明", "#[cfg(", "", "    x,", ")]", "struct S;"];
  assert.deepStrictEqual(above(file, 6), []);
});

test("a Python comment ending with ] is still a comment", () => {
  const file = ["# 參考", "# 見 [1]", "def f():"];
  assert.deepStrictEqual(above(file, 3), ["參考", "見 [1]"]);
});

test("a comment line ending with ] is not the end of a multi-line attribute", () => {
  // `#[not closed` is a Python comment, and so is the line below it; reading
  // the two as one attribute would hide both.
  const file = ["#[not closed", "# 註解]", "def f():"];
  assert.deepStrictEqual(above(file, 3), ["[not closed", "註解]"]);
});

test("a comment inside a multi-line attribute does not break it", () => {
  const file = [
    "/// 說明",
    "#[cfg(any(",
    "    // linux",
    "    target_os = \"linux\",",
    "))]",
    "struct S;",
  ];
  assert.deepStrictEqual(above(file, 6), ["說明"]);
});

test("a Python list above a definition is not an attribute", () => {
  const file = ["# 上", "# 說明", "x = [1,", "]", "def f():"];
  assert.deepStrictEqual(above(file, 5), []);
});

// ---------------------------------------------------------------------------
// Less, and right. The rule is positional and simple, so where it cannot tell,
// it shows less rather than something that is not the definition's comment.

test("a /// line whose text ends with */ is still a line comment, not a block's end", () => {
  // Read by where its text ends, tokio's `pipe::Receiver` would show only the
  // five lines below this one.
  const file = [
    "/// Reading end of a Unix pipe.",
    "///",
    "/// ```",
    "/// loop {",
    "///     /* handle the message */",
    "/// }",
    "/// ```",
    "#[derive(Debug)]",
    "pub struct Receiver {",
  ];
  assert.deepStrictEqual(above(file, 9), [
    "Reading end of a Unix pipe.",
    "",
    "```",
    "loop {",
    "    /* handle the message */",
    "}",
    "```",
  ]);
});

test("a # line ending with */ is a line comment too", () => {
  assert.deepStrictEqual(above(["# 說明", "# 像 /* 這樣 */", "def f():"], 3), ["說明", "像 /* 這樣 */"]);
});

test("a real block comment end still works", () => {
  assert.deepStrictEqual(above(["/*", " * 說明", " */", "int f;"], 4), ["說明"]);
});

test("//! documents the module, not the next definition", () => {
  const file = ["//! 這個檔案在做什麼", "//!", "pub enum TokenKind {}"];
  assert.deepStrictEqual(above(file, 3), []);
});

test("a /// right below //! still belongs to the definition", () => {
  const file = ["//! 模組說明", "/// 型別說明", "pub struct T;"];
  assert.deepStrictEqual(above(file, 3), ["型別說明"]);
});

test("a /*! block documents the module too", () => {
  const file = ["/*!", " * 模組說明", " */", "pub struct T;"];
  assert.deepStrictEqual(above(file, 4), []);
});
