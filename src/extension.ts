import * as path from "node:path";
import * as vscode from "vscode";
import { ARTIFACT_NAME, STRUCTURE_GRAPH_VIEW_TYPE } from "./paths";
import { StructureGraphEditorProvider } from "./structureGraphEditor";
import { chooseOne, detectLanguages, runAnalyzer, Language } from "./analysis";
import { drawSample, prepareSample } from "./sample";

/**
 * What the extension hands back to whoever activated it.
 *
 * The offer of the sample is a button on a message, not a command, so there is
 * no command for a test to run. This is how the end-to-end suite reaches it,
 * and it is why the sample stays out of the command palette.
 */
export interface Api {
  drawSample(): Promise<{ artifact: string } | { problem: string }>;
}

export function activate(context: vscode.ExtensionContext): Api {
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
  return { drawSample: () => drawSample(context) };
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
    offer(context, problem);
    return { problem };
  }
  const folder = await pickFolder(target);
  if (!folder) return undefined;

  const found = detectLanguages(folder.fsPath);
  if (found.length === 0) {
    const problem = `Planisphere found no analyzable source under ${path.basename(folder.fsPath)}.`;
    offer(context, problem);
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

/** What the offer on those messages says. */
const SEE_THE_SAMPLE = "See a sample drawing";

/**
 * Say what stopped the command, and offer the sample.
 *
 * Both of these are where a reader who has just installed this meets it: no
 * folder open, or a project in a language it does not read. The sample needs
 * nothing installed, so the offer holds for either of them.
 *
 * Not awaited. A message carrying a button stays until it is answered or
 * dismissed, and the command has already finished: what it did is decided, and
 * a caller waiting on it — the end-to-end suite among them — should not wait
 * for a reader to make up their mind.
 */
function offer(context: vscode.ExtensionContext, problem: string): void {
  // Begun here, while the message is being read, so that answering it opens a
  // drawing rather than starting one. A rejection is held until it is pressed:
  // a reader who never presses is not told about work they did not ask for.
  const begun = prepareSample(context);
  begun.catch(() => undefined);
  void vscode.window.showWarningMessage(problem, SEE_THE_SAMPLE).then((chose) => {
    if (chose === SEE_THE_SAMPLE) return drawSample(context, begun);
    return undefined;
  });
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
