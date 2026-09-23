import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { runAnalyzer } from "./analysis";
import { ARTIFACT_NAME, STRUCTURE_GRAPH_VIEW_TYPE } from "./paths";

/**
 * A drawing for a reader who has nothing of their own to draw.
 *
 * The sample ships as source and is analyzed here rather than shipped already
 * drawn: an artifact records absolute paths, so one made elsewhere names files
 * this machine does not have, and every jump from it would fail — which is the
 * gesture the product is for. Analyzed here, the paths are this machine's and
 * the drawing behaves as one of the reader's own.
 *
 * It is TypeScript because that analyzer needs nothing installed: the compiler
 * ships with the extension and runs on the editor's own Node. So the offer
 * holds for a reader who has no toolchain at all — and a sample that draws is
 * also the plainest answer to "is my install working".
 */

/** The sample's source, inside the extension. */
export function sampleRoot(extensionPath: string): string {
  return path.join(extensionPath, "sample");
}

/** Where the drawing of it is kept: storage this extension owns. */
export function sampleArtifact(storagePath: string): string {
  return path.join(storagePath, "sample", ARTIFACT_NAME);
}

/** When the sample's source was last written, over every file in it. */
export function sampleModified(root: string): number {
  let newest = 0;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(root);
  return newest;
}

/**
 * Whether the drawing on disk is still this sample's.
 *
 * An update replaces the extension's directory, so a drawing made from the
 * version before it is stale while still being there.
 */
export function drawingIsCurrent(artifact: string, sourceModified: number): boolean {
  try {
    return fs.statSync(artifact).mtimeMs >= sourceModified;
  } catch {
    return false;
  }
}

/**
 * Draw the sample, or hand back the drawing that is already there.
 *
 * Begun when the offer is made rather than when it is accepted: loading the
 * compiler is about a second and a half, and a reader spends longer than that
 * reading the message the offer sits on. By the time they answer it is waiting.
 * Where they never answer, a second of work is thrown away — which is what the
 * offer is worth.
 */
export async function prepareSample(context: vscode.ExtensionContext): Promise<string> {
  const root = sampleRoot(context.extensionPath);
  const output = sampleArtifact(context.globalStorageUri.fsPath);
  if (drawingIsCurrent(output, sampleModified(root))) {
    return output;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await runAnalyzer({
    extensionPath: context.extensionPath,
    language: "typescript",
    root,
    output,
  });
  return output;
}

/** Open the drawing of the sample, waiting on it where it is still being made. */
export async function drawSample(
  context: vscode.ExtensionContext,
  begun?: Promise<string>
): Promise<{ artifact: string } | { problem: string }> {
  let output: string;
  const waiting = begun ?? prepareSample(context);
  // Answered before the drawing was ready: say that it is being made. Asked
  // again later, it is already there and the panel simply opens, so there is
  // nothing to say and a notification that flashed would be noise.
  const made = drawingIsCurrent(
    sampleArtifact(context.globalStorageUri.fsPath),
    sampleModified(sampleRoot(context.extensionPath))
  );
  try {
    output = made
      ? await waiting
      : await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Planisphere: drawing the sample project…",
          },
          () => waiting
        );
  } catch (error) {
    const problem = (error as Error).message;
    void vscode.window.showErrorMessage(`Planisphere: ${problem}`);
    return { problem };
  }
  await vscode.commands.executeCommand(
    "vscode.openWith",
    vscode.Uri.file(output),
    STRUCTURE_GRAPH_VIEW_TYPE
  );
  return { artifact: output };
}
