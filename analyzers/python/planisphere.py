#!/usr/bin/env python3
"""Planisphere CLI — analyze Python roots and write planisphere.json."""

from __future__ import annotations

import argparse
import json
import os
import sys

from analyze_symbols import analyze


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="planisphere",
        description="Analyze Python symbol structure and write a *.planisphere.json graph.",
    )
    parser.add_argument(
        "roots",
        nargs="*",
        default=["."],
        help="Project root(s) to scan (default: current directory)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="planisphere.json",
        help="Output path (default: ./planisphere.json)",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Print JSON to stdout instead of writing a file",
    )
    args = parser.parse_args(argv)

    roots = [os.path.abspath(r) for r in args.roots]
    result = analyze(roots)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"

    if args.stdout:
        sys.stdout.write(text)
        return 0

    out_path = os.path.abspath(args.output)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)

    n_nodes = len(result.get("nodes", []))
    n_edges = len(result.get("edges", []))
    print(f"Wrote {out_path} ({n_nodes} nodes, {n_edges} edges)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    # Allow `python3 planisphere.py` from this directory or via bin/planisphere.
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    raise SystemExit(main())
