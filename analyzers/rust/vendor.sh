#!/usr/bin/env bash
# Vendor the Rust analyzer's dependencies, so that the packaged extension can
# build it with the network off.
#
# `syn` is the parser Rust's standard library does not have, and it is a source
# dependency: without this, a reader who installed the extension needs
# crates.io the first time they draw a Rust project. What this writes is
# third-party source — 3.6 MB — so it is gitignored here and shipped there,
# the way the sample projects are cloned rather than committed.
#
# Run it after changing Cargo.toml or Cargo.lock.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p .cargo
cargo vendor --locked vendor > .cargo/config.toml
echo "Vendored $(du -sh vendor | cut -f1) into $(pwd)/vendor"
