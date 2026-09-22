//! Planisphere Rust CLI: analyze Rust roots and write planisphere.json.
//!
//! bin/planisphere runs this through cargo. The caller's directory arrives as
//! PLANISPHERE_CWD, and relative roots and -o are resolved against it.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "Usage: planisphere-rust [roots...] [-o OUT] [--stdout]

Analyze Rust symbol structure and write a *.planisphere.json graph.

  roots           project root(s) to scan (default: .)
  -o, --output    output path (default: ./planisphere.json)
  --stdout        print JSON to stdout instead of writing a file
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut roots = Vec::new();
    let mut output = String::from("planisphere.json");
    let mut to_stdout = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-h" | "--help" => {
                print!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            "--stdout" => to_stdout = true,
            "-o" | "--output" => {
                i += 1;
                let Some(path) = args.get(i) else {
                    eprintln!("planisphere-rust: -o needs a path");
                    return ExitCode::from(2);
                };
                output = path.clone();
            }
            a if a.starts_with('-') => {
                eprint!("planisphere-rust: unknown option {a}\n{USAGE}");
                return ExitCode::from(2);
            }
            a => roots.push(a.to_string()),
        }
        i += 1;
    }
    if roots.is_empty() {
        roots.push(String::from("."));
    }

    let base = std::env::var_os("PLANISPHERE_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let abs = |p: &str| {
        let p = Path::new(p);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            base.join(p)
        }
    };
    let roots: Vec<PathBuf> = roots.iter().map(|r| abs(r)).collect();

    // Never a partial artifact reported as success.
    let result = std::panic::catch_unwind(|| {
        let g = planisphere_rust::analyze(&roots);
        (g.nodes.len(), g.edges.len(), planisphere_rust::encode(&g))
    });
    let Ok((nodes, edges, text)) = result else {
        eprintln!("planisphere-rust: the analysis failed, and no artifact was written");
        return ExitCode::from(1);
    };
    if to_stdout {
        let _ = std::io::stdout().write_all(text.as_bytes());
        return ExitCode::SUCCESS;
    }
    let out = abs(&output);
    if let Err(err) = std::fs::write(&out, text) {
        eprintln!("planisphere-rust: {err}");
        return ExitCode::from(1);
    }
    eprintln!("Wrote {} ({nodes} nodes, {edges} edges)", out.display());
    ExitCode::SUCCESS
}
