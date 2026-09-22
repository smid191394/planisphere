/**
 * The comment written immediately above a definition.
 *
 * Positional and deliberately not clever. It does not try to work out whether
 * a comment "belongs" to the definition — it says where it has to be, which
 * makes both what it shows and what it declines to show explicable in one
 * sentence. A blank line between comment and definition means the writer
 * separated them, so it is not shown.
 *
 * Decorators are stepped over: a comment above a decorated function is still
 * that function's comment to anyone reading the file. So are Rust attributes,
 * wherever they sit in the run: Rust writes `/// doc`, then `#[derive(…)]`,
 * and sometimes more doc below it.
 *
 * A comment line is one beginning with `#` or with two slashes, or a line
 * inside a block comment that closes in the run directly above. Which markers
 * count is not decided by the file's name: this is handed lines and a line
 * number, never a path. The artifact records no language, the viewer does not
 * know one, and an extension list kept beside two analyzers is a third place
 * to go out of step. Reading every marker in every file cannot misread real
 * code: a line beginning `#` in a Go file is not Go, and a line beginning with
 * two slashes in a Python file is not Python. Both are comments or nothing.
 *
 * @param lines the file, split into lines, without line terminators
 * @param line 1-based line number of the `class` or `def`
 * @returns the comment lines in file order, markers removed; empty when there
 *   is no comment directly above
 */
export function leadingComment(lines: string[], line: number): string[] {
  // 0-based index of the line above the definition, clamped to the file. A
  // line number past the end is not a caller error worth throwing over — the
  // artifact can be older than the file it points into — and unclamped it
  // reads past the array and crashes on the first comparison.
  let i = Math.min(line - 2, lines.length - 1);
  while (i >= 0 && isDecorator(lines[i])) {
    i--;
  }

  /** Collected bottom-up, so reversed before returning. */
  const found: string[] = [];
  while (i >= 0) {
    const text = lines[i].trim();

    const attribute = attributeStart(lines, i);
    if (attribute !== null) {
      i = attribute - 1;
      continue;
    }

    // `//!` documents the module it is written in, not the definition below
    // it. Where the two touch, the run stops here rather than lending the
    // module's text to the first item: otherwise sqlparser-ranger's `TokenKind`
    // would show what its file is for.
    if (isInnerDoc(text)) {
      break;
    }

    // A line comment is a line comment whatever it ends with. Read by its end,
    // `///     /* handle the message */` in an example would close a block that
    // was never opened, and tokio's `pipe::Receiver` would show five lines of
    // its closing brace instead of its documentation.
    if (isLineComment(text)) {
      found.push(stripLineMarker(text));
      i--;
      continue;
    }

    if (closesBlock(text)) {
      // A block is read upward to the line that opens it, and everything
      // between is the comment whether or not it carries a marker of its own.
      const block: string[] = [];
      let j = i;
      while (j >= 0) {
        block.push(lines[j]);
        if (opensBlock(lines[j].trim())) {
          break;
        }
        j--;
      }
      // Closed but never opened: the run above is not a block comment, and
      // guessing which earlier line meant to open it is the cleverness this
      // rule declines.
      if (j < 0) {
        break;
      }
      // `/*!` is `//!` written as a block: the module's, not the item's.
      if (lines[j].trim().startsWith("/*!")) {
        break;
      }
      for (const raw of block) {
        const body = stripBlockMarker(raw);
        if (body !== null) {
          found.push(body);
        }
      }
      i = j - 1;
      continue;
    }

    break;
  }

  return found.reverse();
}

function isDecorator(text: string): boolean {
  return text.trim().startsWith("@");
}

/** Python's marker, and the one Go and TypeScript share. */
function isLineComment(text: string): boolean {
  return text.startsWith("#") || text.startsWith("//");
}

/**
 * Where the Rust attribute ending on line `i` begins, or null if it is not one.
 *
 * An attribute is a whole line, `#[…]` or `#![…]`, not a first character: `#`
 * is also Python's marker, and a Python comment such as `#[69,99] is in the
 * century 1900` does not end with its bracket. One written over several lines
 * is followed upward from its closing `]` to the line that opens it, without
 * crossing a blank line; where no opening is found nothing is guessed.
 */
function attributeStart(lines: string[], i: number): number | null {
  const text = lines[i].trim();
  if (!text.endsWith("]")) {
    return null;
  }
  // A line that is itself a comment closes no attribute: a Python comment may
  // end with a bracket. Only a whole `#[…]` line is both.
  if (isLineComment(text) && !text.startsWith("#[") && !text.startsWith("#![")) {
    return null;
  }
  for (let j = i; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === "") {
      return null;
    }
    if (t.startsWith("#[") || t.startsWith("#![")) {
      return j;
    }
  }
  return null;
}

function isInnerDoc(text: string): boolean {
  return text.startsWith("//!");
}

function opensBlock(text: string): boolean {
  return text.startsWith("/*");
}

function closesBlock(text: string): boolean {
  return text.endsWith("*/");
}

/**
 * `# 123` -> `123`, `// 123` -> `123`, `/// 123` -> `123`, and a marker alone
 * -> ``.
 *
 * Rust's `///` counts as a whole marker only where a space or the end of the
 * line follows, which is how Rust writes it and not how a banner of
 * slashes is written: `////////` and `//// Types` read as plain `//` comments.
 *
 * Exactly one space after the marker is dropped, because one space is the
 * convention rather than part of what was written. Deeper indentation inside
 * the comment is kept: it is usually a list or a code sample, and losing it
 * loses the shape.
 */
function stripLineMarker(text: string): string {
  const body = text.replace(/^(\/\/\/(?= |$)|#|\/\/)/, "");
  return body.startsWith(" ") ? body.slice(1) : body;
}

/**
 * One line of a block comment, or null where the line is only a delimiter.
 *
 * A line that is nothing but the opening or closing marker carries none of what
 * was written, and keeping it would put an empty line at the top and bottom of
 * every documentation comment the panel shows. Removing it is marker removal
 * rather than a judgement about meaning.
 *
 * A continuation line that is deliberately empty — one star alone — is kept as
 * an empty line, because it is what separates one paragraph from the next.
 */
function stripBlockMarker(raw: string): string | null {
  const text = raw.trim();
  if (/^\/\*+$/.test(text) || text === "*/") {
    return null;
  }
  let body = text;
  if (body.startsWith("/*")) {
    body = body.slice(2);
  }
  if (body.endsWith("*/")) {
    body = body.slice(0, -2).replace(/\s+$/, "");
  }
  if (body.startsWith("*")) {
    body = body.slice(1);
  }
  return body.startsWith(" ") ? body.slice(1) : body;
}
