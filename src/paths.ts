import * as path from "path";

/** What the CLI names an artifact, so that both doors write the same file. */
export const ARTIFACT_NAME = "planisphere.json";

/** Custom Editor viewType for `*.planisphere.json`. */
export const STRUCTURE_GRAPH_VIEW_TYPE = "planisphere.structureGraph";

/**
 * Join a workspace-relative path to an absolute filesystem root.
 * Absolute inputs are returned unchanged (normalized separators).
 */
export function resolveNodeFilePath(
  file: string,
  workspaceRoot: string
): string {
  if (path.isAbsolute(file)) {
    return path.resolve(file);
  }
  const parts = file.split(/[/\\]/).filter(Boolean);
  return path.resolve(workspaceRoot, ...parts);
}
