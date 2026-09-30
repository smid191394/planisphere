//! The artifact document, in the shape and the bytes every producer writes.

use std::cmp::Ordering;

/// Something that belongs to a node without being one: a method, which is its
/// type's or its trait's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub name: String,
    pub file: String,
    pub line: usize,
    /// The members of the same type this one calls, by name.
    pub calls: Vec<String>,
    /// The nodes this member's signature and body name, by id. Each one is a
    /// target its own node has an edge to; the member says which method that
    /// edge came from.
    pub points: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file: String,
    pub line: usize,
    pub end_line: Option<usize>,
    pub internal: bool,
    pub members: Vec<Member>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Debug, Clone, Default)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// Compare as JavaScript compares strings, by UTF-16 code unit. The contract
/// checks edge order with `<` in Node, and a path above U+FFFF would sort
/// differently by byte.
pub fn js_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

enum Json<'a> {
    Str(&'a str),
    Num(usize),
    Bool(bool),
    Arr(Vec<Json<'a>>),
    Obj(Vec<(&'static str, Json<'a>)>),
}

/// The document's bytes: what `JSON.stringify(doc, null, 2) + "\n"` writes,
/// which is the check the contract applies. Key order is the order every
/// producer uses, and a field that does not hold is left out rather than
/// written empty, so a document without it matches what a producer that never
/// writes it produces.
pub fn encode(g: &Graph) -> String {
    let nodes = g
        .nodes
        .iter()
        .map(|n| {
            let mut f = vec![
                ("id", Json::Str(&n.id)),
                ("kind", Json::Str(&n.kind)),
                ("name", Json::Str(&n.name)),
                ("file", Json::Str(&n.file)),
                ("line", Json::Num(n.line)),
            ];
            if let Some(end) = n.end_line {
                f.push(("endLine", Json::Num(end)));
            }
            if n.internal {
                f.push(("internal", Json::Bool(true)));
            }
            if !n.members.is_empty() {
                let members = n
                    .members
                    .iter()
                    .map(|m| {
                        let mut fields = vec![
                            ("name", Json::Str(&m.name)),
                            ("file", Json::Str(&m.file)),
                            ("line", Json::Num(m.line)),
                        ];
                        if !m.calls.is_empty() {
                            fields.push((
                                "calls",
                                Json::Arr(m.calls.iter().map(|c| Json::Str(c)).collect()),
                            ));
                        }
                        if !m.points.is_empty() {
                            fields.push((
                                "points",
                                Json::Arr(m.points.iter().map(|p| Json::Str(p)).collect()),
                            ));
                        }
                        Json::Obj(fields)
                    })
                    .collect();
                f.push(("members", Json::Arr(members)));
            }
            Json::Obj(f)
        })
        .collect();
    let edges = g
        .edges
        .iter()
        .map(|e| {
            Json::Obj(vec![
                ("from", Json::Str(&e.from)),
                ("to", Json::Str(&e.to)),
                ("kind", Json::Str(&e.kind)),
            ])
        })
        .collect();
    let doc = Json::Obj(vec![("nodes", Json::Arr(nodes)), ("edges", Json::Arr(edges))]);
    let mut out = String::new();
    write(&doc, 0, &mut out);
    out.push('\n');
    out
}

fn pad(depth: usize, out: &mut String) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn write(v: &Json, depth: usize, out: &mut String) {
    match v {
        Json::Str(s) => quote(s, out),
        Json::Num(n) => out.push_str(&n.to_string()),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Arr(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                pad(depth + 1, out);
                write(item, depth + 1, out);
            }
            out.push('\n');
            pad(depth, out);
            out.push(']');
        }
        Json::Obj(fields) => {
            if fields.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push_str("{\n");
            for (i, (key, value)) in fields.iter().enumerate() {
                if i > 0 {
                    out.push_str(",\n");
                }
                pad(depth + 1, out);
                quote(key, out);
                out.push_str(": ");
                write(value, depth + 1, out);
            }
            out.push('\n');
            pad(depth, out);
            out.push('}');
        }
    }
}

/// JSON.stringify's escaping and no further: a quote, a backslash and the
/// control characters, and nothing else. `<`, `&` and non-ASCII are written as
/// themselves.
fn quote(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push('\\');
                out.push('u');
                out.push_str(&format!("{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
