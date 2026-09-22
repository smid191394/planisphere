package main

// Planisphere Go CLI: analyze Go roots and write planisphere.json.
//
// bin/planisphere runs this with `go -C analyzers/go run .`, which moves the
// working directory into the analyzer. The caller's directory arrives as
// PLANISPHERE_CWD, and relative roots and -o are resolved against it.

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const usage = `Usage: planisphere-go [roots...] [-o OUT] [--stdout]

Analyze Go symbol structure and write a *.planisphere.json graph.

  roots           project root(s) to scan (default: .)
  -o, --output    output path (default: ./planisphere.json)
  --stdout        print JSON to stdout instead of writing a file
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) (code int) {
	roots := []string{}
	output := "planisphere.json"
	toStdout := false
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "-h" || a == "--help":
			fmt.Fprint(stdout, usage)
			return 0
		case a == "--stdout":
			toStdout = true
		case a == "-o" || a == "--output":
			if i+1 >= len(args) {
				fmt.Fprintln(stderr, "planisphere-go: -o needs a path")
				return 2
			}
			i++
			output = args[i]
		case len(a) > 0 && a[0] == '-':
			fmt.Fprintf(stderr, "planisphere-go: unknown option %s\n%s", a, usage)
			return 2
		default:
			roots = append(roots, a)
		}
	}
	if len(roots) == 0 {
		roots = append(roots, ".")
	}

	base := os.Getenv("PLANISPHERE_CWD")
	if base == "" {
		base, _ = os.Getwd()
	}
	abs := func(p string) string {
		if filepath.IsAbs(p) {
			return filepath.Clean(p)
		}
		return filepath.Join(base, p)
	}
	for i, r := range roots {
		roots[i] = abs(r)
	}

	// Never a partial artifact reported as success.
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(stderr, "planisphere-go: %v\n", r)
			code = 1
		}
	}()
	g, err := Analyze(roots)
	if err != nil {
		fmt.Fprintf(stderr, "planisphere-go: %v\n", err)
		return 1
	}
	text, err := Encode(g)
	if err != nil {
		fmt.Fprintf(stderr, "planisphere-go: %v\n", err)
		return 1
	}
	if toStdout {
		stdout.Write(text)
		return 0
	}
	out := abs(output)
	if err := os.WriteFile(out, text, 0o644); err != nil {
		fmt.Fprintf(stderr, "planisphere-go: %v\n", err)
		return 1
	}
	fmt.Fprintf(stderr, "Wrote %s (%d nodes, %d edges)\n", out, len(g.Nodes), len(g.Edges))
	return 0
}
