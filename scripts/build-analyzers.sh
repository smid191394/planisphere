#!/usr/bin/env bash
# Build the Go analyzer for every platform the marketplace serves.
#
#   scripts/build-analyzers.sh
#
# A reader who installs the extension to look at a Go project should not need
# Go — and the analyzer wants Go 1.23, which a reader on an older Go would fail
# even with Go installed. So it ships compiled, for all five platforms, in the
# one package: 3.3 MB each, 7 MB for all five compressed, and one package for
# every reader rather than one per platform.
#
# Go cross-compiles from anywhere. Rust does not, and does not ship compiled: a
# Rust reader has cargo, and the vendored crates build offline.
#
# Each lands in analyzers/go/prebuilt/<platform>/, the platform named as the
# marketplace names it, which is also `${process.platform}-${process.arch}` in
# Node — so the extension finds its executable by asking where it runs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

build() { # build <platform> <goos> <goarch> <ext>
  local out="$ROOT/analyzers/go/prebuilt/$1"
  # Emptied first: whatever it held ships, and an executable left from an
  # earlier name would ship beside the new one.
  rm -rf "$out"
  mkdir -p "$out"
  # No C, no symbols, no build paths: the same bytes from any machine.
  (cd "$ROOT/analyzers/go" &&
    CGO_ENABLED=0 GOOS="$2" GOARCH="$3" GOTOOLCHAIN=local GOWORK=off GOFLAGS= \
      go build -trimpath -ldflags="-s -w" -o "$out/planisphere-go$4" .)
  echo "Built $out/planisphere-go$4"
}

rm -rf "$ROOT/analyzers/go/prebuilt"
build linux-x64 linux amd64 ""
build linux-arm64 linux arm64 ""
build darwin-x64 darwin amd64 ""
build darwin-arm64 darwin arm64 ""
build win32-x64 windows amd64 ".exe"
