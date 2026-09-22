//! Which files are read.

use std::fs;
use std::path::{Path, PathBuf};

/// Every analyzer skips these (structure-graph-artifact), and Rust adds its own:
/// build output, benchmarks, and vendored crates. A directory starting with `.`
/// is skipped as cargo's own tooling keeps it.
const SKIPPED: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "dist", "build", ".idea", ".vscode", "tests", "test",
    "__tests__", "testing", "docs", "examples", "target", "benches", "vendor",
];

pub struct Walked {
    pub sources: Vec<PathBuf>,
    pub manifests: Vec<PathBuf>,
}

pub fn walk(roots: &[PathBuf]) -> Walked {
    let mut w = Walked { sources: Vec::new(), manifests: Vec::new() };
    for root in roots {
        if root.is_file() {
            take(root, &mut w);
        } else {
            visit(root, &mut w);
        }
    }
    w.sources.sort();
    w.sources.dedup();
    w.manifests.sort();
    w.manifests.dedup();
    w
}

fn take(path: &Path, w: &mut Walked) {
    match path.file_name().and_then(|n| n.to_str()) {
        Some("Cargo.toml") => w.manifests.push(path.to_path_buf()),
        Some(n) if n.ends_with(".rs") => w.sources.push(path.to_path_buf()),
        _ => {}
    }
}

fn visit(dir: &Path, w: &mut Walked) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let Ok(kind) = entry.file_type() else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if kind.is_dir() {
            if !SKIPPED.contains(&name.as_ref()) && !name.starts_with('.') {
                visit(&entry.path(), w);
            }
        } else if kind.is_file() {
            take(&entry.path(), w);
        }
    }
}
