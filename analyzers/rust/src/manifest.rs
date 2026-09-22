//! The few things a `Cargo.toml` says that the drawing needs.

/// A name a manifest writes, and the line it writes it on.
#[derive(Debug, Clone)]
pub struct Named {
    pub name: String,
    pub line: usize,
    pub path: Option<String>,
}

#[derive(Debug, Default)]
pub struct Manifest {
    pub package: Option<Named>,
    pub lib_path: Option<String>,
    pub bins: Vec<Named>,
    /// `build = "path"` under `[package]`.
    pub build_path: Option<String>,
    /// `build = false`: the package has no build script, `build.rs` or not.
    pub build_off: bool,
}

/// Not a TOML parser. It reads a `name` or `path` written as a string on its own
/// line under `[package]`, `[lib]` or `[[bin]]`, which is how manifests write
/// them, and it keeps the line so a crate node can land on it.
pub fn read(text: &str) -> Manifest {
    #[derive(PartialEq)]
    enum Section {
        Package,
        Lib,
        Bin,
        Other,
    }
    let mut m = Manifest::default();
    let mut section = Section::Other;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.starts_with("[[") {
            section = if header(line) == "bin" {
                m.bins.push(Named { name: String::new(), line: 0, path: None });
                Section::Bin
            } else {
                Section::Other
            };
            continue;
        }
        if line.starts_with('[') {
            section = match header(line) {
                "package" => Section::Package,
                "lib" => Section::Lib,
                _ => Section::Other,
            };
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if section == Section::Package && key.trim() == "build" && value.trim() == "false" {
            m.build_off = true;
            continue;
        }
        let Some(value) = string_value(value) else { continue };
        match (&section, key.trim()) {
            (Section::Package, "name") => {
                m.package = Some(Named { name: value, line: i + 1, path: None })
            }
            (Section::Lib, "path") => m.lib_path = Some(value),
            (Section::Package, "build") => m.build_path = Some(value),
            (Section::Bin, "name") => {
                if let Some(b) = m.bins.last_mut() {
                    b.name = value;
                    b.line = i + 1;
                }
            }
            (Section::Bin, "path") => {
                if let Some(b) = m.bins.last_mut() {
                    b.path = Some(value);
                }
            }
            _ => {}
        }
    }
    m.bins.retain(|b| !b.name.is_empty());
    m
}

fn header(line: &str) -> &str {
    let inner = line.trim_start_matches('[');
    let end = inner.find(']').unwrap_or(inner.len());
    inner[..end].trim()
}

fn string_value(v: &str) -> Option<String> {
    let v = v.trim();
    let quote = v.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &v[1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}
