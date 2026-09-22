export interface GraphNode {
  id: string;
  /**
   * `function` and `file` are reserved: they orbit rather than anchor. Every
   * other kind is a type, and the set is open — an analyzer is free to emit
   * `interface`, `struct` or `trait`, and a consumer that listed the kinds it
   * had been taught would reject the first one it had not.
   *
   * The two literals are spelled out so an editor still completes them; the
   * `string & {}` keeps the union from collapsing to plain `string`.
   */
  kind: "function" | "file" | (string & {});
  name: string;
  file: string;
  line: number;
  endLine?: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "inherits" | "uses" | "references";
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
