"use strict";

// What the document is before its stylesheet is.
//
// Every rule the page has lives in one file, fetched over the webview's own
// protocol, and the content policy admits no other source of style. So there
// is no state in which the markup is safe to paint: a paint before that file
// arrives shows the rail as six `<button>` elements in the browser's own
// chrome — a border and a grey fill, and the only elements on the page the
// browser gives any — over white.
//
// Worse, `.hidden { display: none }` is in that file too, so until it lands
// `class="hidden"` means nothing and the legend, the comment box and the whole
// settings panel are laid out as well.
//
// There is no browser here and no way to make a stylesheet arrive late, so
// what is checked is the document: that it carries, in its own head, the few
// rules the closed panel is made of.

const fs = require("fs");
const path = require("path");
const { suite, ok, eq } = require("./harness.js");

const source = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "graphDocument.ts"),
  "utf8"
);
const head = source.slice(source.indexOf("<head>"), source.indexOf("</head>"));

// ---------------------------------------------------------------------------
suite("the page does not render differently before the stylesheet arrives");

{
  const styleAt = head.indexOf("<style");
  const linkAt = head.indexOf("<link rel=\"stylesheet\"");
  ok(styleAt >= 0, "expected an inline style block in the head");
  ok(linkAt >= 0, "the stylesheet link is still there");
  ok(styleAt < linkAt, "expected the inline block before the link");

  const inline = head.slice(styleAt, head.indexOf("</style>", styleAt));

  // The colour the panel waits in. Borrowed from the editor, as the stylesheet
  // already borrows it, so the first step is invisible.
  ok(
    /background:\s*var\(--vscode-editor-background/.test(inline),
    "expected a background colour while waiting, borrowed from the editor"
  );
  // The promise that nothing shows until everything can.
  ok(
    /#sidebar[^{]*#main[^{]*\{[^}]*visibility:\s*hidden/.test(inline.replace(/\s+/g, " ")),
    "expected the sidebar and canvas to be held hidden"
  );
  // The one that turns a flash of buttons into a flash of the whole interface.
  ok(
    /\.hidden\s*\{[^}]*display:\s*none/.test(inline),
    "expected `.hidden` inline too — it is otherwise defined only in the stylesheet that has not arrived"
  );
}

// ---------------------------------------------------------------------------
suite("the rule that ends the wait is not inlined");

{
  // `body.ready` is what ends the wait, and the wait cannot end before the
  // stylesheet that draws what comes next.
  const styleAt = head.indexOf("<style");
  const inline = styleAt < 0 ? "" : head.slice(styleAt, head.indexOf("</style>", styleAt));
  ok(!/body\.ready/.test(inline), "`body.ready` should not be inlined");
}

// ---------------------------------------------------------------------------
suite("the content policy allows only that one element");

{
  const csp = head.slice(head.indexOf("Content-Security-Policy"));
  const styleSrc = (csp.match(/style-src ([^;]*)/) || [])[1] || "";
  ok(
    styleSrc.includes("nonce-"),
    `expected style-src to allow by nonce, got "${styleSrc.trim()}"`
  );
  ok(
    !styleSrc.includes("unsafe-inline"),
    "should not use unsafe-inline — that would allow any style block in the document"
  );
  ok(styleSrc.includes("cspSource"), "the stylesheet is still allowed");

  // The same nonce the script carries: two would be two things to keep in step.
  const scriptSrc = (csp.match(/script-src ([^;"]*)/) || [])[1] || "";
  const nonceOf = (s) => (s.match(/nonce-\$\{(\w+)\}/) || [])[1];
  eq(nonceOf(styleSrc), nonceOf(scriptSrc), "style and script use the same nonce");
}

module.exports = {};
