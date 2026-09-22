import type { GraphPayload } from "./graphTypes";

export type ParsedGraphDocument =
  | { ok: true; graph: GraphPayload }
  | { ok: false; error: string };

/**
 * Parse a `*.planisphere.json` document body into a graph payload.
 */
export function parseGraphDocument(text: string): ParsedGraphDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: true,
      graph: { nodes: [], edges: [] },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Invalid JSON — could not parse this document." };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as GraphPayload).nodes) ||
    !Array.isArray((parsed as GraphPayload).edges)
  ) {
    return {
      ok: false,
      error: "Invalid graph document — expected JSON with nodes and edges arrays.",
    };
  }

  return { ok: true, graph: parsed as GraphPayload };
}
