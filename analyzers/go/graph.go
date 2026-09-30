package main

import (
	"bytes"
	"encoding/json"
)

// Graph is the artifact document. Field order is the key order the other two
// producers write, so the same graph serialises to the same bytes whichever
// analyzer wrote it.
type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

type Node struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	File    string `json:"file"`
	Line    int    `json:"line"`
	EndLine int    `json:"endLine,omitempty"`
	// What the language marks as not for reaching outside the code that
	// declares it. Go says it with the case of the first letter, which is what
	// its own compiler reads; no convention travels, so this is the analyzer's
	// statement and not something a consumer may infer from the name. Omitted
	// where it does not hold, so an artifact that marks nothing is
	// byte-identical to what a producer that never marks anything writes.
	Internal bool `json:"internal,omitempty"`
	// What belongs to this node without being a node of its own: a Go
	// method, which is its receiver's. Omitted where there is none, so an
	// artifact that records no members is byte-identical to what a producer
	// that never records them writes.
	Members []Member `json:"members,omitempty"`
}

// A member is reachable in the source and nowhere else in the document: it is
// deliberately not a node, and carries only what it takes to show it and to
// jump to it.
type Member struct {
	Name string `json:"name"`
	File string `json:"file"`
	Line int    `json:"line"`
	// The methods of the same type this one calls, by name.
	Calls []string `json:"calls,omitempty"`
	// The nodes this method's signature and body name, by id. Each one is a
	// target its own node has an edge to; the member says which method that
	// edge came from.
	Points []string `json:"points,omitempty"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}

// Encode writes the document the way the contract fixes it: two-space indent,
// one trailing newline, and nothing escaped that JSON.stringify would write as
// itself. encoding/json escapes <, > and & by default; a path holding one of
// them would come out as \u003c and no longer match the other producers.
func Encode(g *Graph) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(g); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
