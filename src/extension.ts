import * as path from "node:path";
import * as vscode from "vscode";
import { STRUCTURE_GRAPH_VIEW_TYPE } from "./paths";
import { StructureGraphEditorProvider } from "./structureGraphEditor";
import { chooseOne, detectLanguages, runAnalyzer, Language } from "./analysis";

/** What the CLI names an artifact, so that both doors write the same file. */
const ARTIFACT_NAME = "planisphere.json";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      STRUCTURE_GRAPH_VIEW_TYPE,
      new StructureGraphEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    ),
    vscode.commands.registerCommand("planisphere.analyze", (target?: vscode.Uri) =>
      analyze(context, target)
    )
  );
}

export function deactivate(): void {
  // no-op
}

/**
 * What the command did, returned to whoever ran it: the artifact it wrote and
 * opened and the executable that wrote it, or why it wrote none. A question the reader dismissed returns
 * nothing. The notifications a reader sees are shown either way; this is for
 * a caller, such as the end-to-end suite, that cannot read notifications.
 */
export type Outcome = { artifact: string; ran: string } | { problem: string } | undefined;

/**
 * Produce an artifact for a project and open it.
 *
 * It asks only what it cannot work out: one folder holding one language's
 * source runs without a question. Where the workspace holds several folders,
 * or a folder holds more than one language, the reader chooses — which is the
 * one thing an editor can offer and a script cannot, and why the CLI declines
 * there instead.
 */
async function analyze(context: vscode.ExtensionContext, target?: vscode.Uri): Promise<Outcome> {
  if (!target && !(vscode.workspace.workspaceFolders ?? []).length) {
    const problem = "Planisphere: open a folder first.";
    void vscode.window.showWarningMessage(problem);
    return { problem };
  }
  const folder = await pickFolder(target);
  if (!folder) return undefined;

  const found = detectLanguages(folder.fsPath);
  if (found.length === 0) {
    const problem = `Planisphere found no analyzable source under ${path.basename(folder.fsPath)}.`;
    void vscode.window.showWarningMessage(problem);
    return { problem };
  }
  const language = chooseOne(found) ?? (await pickLanguage(found));
  if (!language) return undefined;

  const output = path.join(folder.fsPath, ARTIFACT_NAME);
  const name = path.basename(folder.fsPath);
  let cancelled = false;
  let ran = "";
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Planisphere: reading ${name} as ${language}…`,
        cancellable: true,
      },
      async (_progress, token) => {
        const control = new AbortController();
        token.onCancellationRequested(() => {
          cancelled = true;
          control.abort();
        });
        ({ executable: ran } = await runAnalyzer({
          extensionPath: context.extensionPath,
          language,
          root: folder.fsPath,
          output,
          signal: control.signal,
          // An installed extension's directory belongs to the editor, which
          // replaces it on every update; the Rust analyzer's build goes to
          // storage this extension owns instead.
          buildDir: path.join(context.globalStorageUri.fsPath, "rust-target"),
        }));
      }
    );
  } catch (error) {
    const problem = (error as Error).message;
    if (!cancelled) {
      void vscode.window.showErrorMessage(`Planisphere: ${problem}`);
    }
    return { problem };
  }
  await vscode.commands.executeCommand(
    "vscode.openWith",
    vscode.Uri.file(output),
    STRUCTURE_GRAPH_VIEW_TYPE
  );
  return { artifact: output, ran };
}

/** The folder to read: the one clicked, the only one open, or the one chosen. */
async function pickFolder(target?: vscode.Uri): Promise<vscode.Uri | null> {
  if (target) return target;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0].uri;
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, uri: f.uri })),
    { title: "Planisphere: which folder?" }
  );
  return picked ? picked.uri : null;
}

/** One artifact holds one language, so where there are several the reader says. */
async function pickLanguage(found: Language[]): Promise<Language | null> {
  const picked = await vscode.window.showQuickPick(
    found.map((language) => ({ label: language })),
    { title: "Planisphere: which language? One artifact holds one." }
  );
  return picked ? (picked.label as Language) : null;
}
