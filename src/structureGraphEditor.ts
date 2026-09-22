import * as vscode from "vscode";
import {
  buildGraphWebviewHtml,
  parseGraphDocument,
} from "./graphDocument";
import { resolveNodeFilePath } from "./paths";
import { leadingComment } from "./leadingComment";

/**
 * What stands for an open artifact.
 *
 * A custom document can be anything; this one is a URI and the watcher that
 * redraws when the file behind it changes. It is deliberately not a text
 * model — see below.
 */
interface ArtifactDocument extends vscode.CustomDocument {
  readonly onDidChange: vscode.Event<void>;
}

/**
 * Custom Editor for `*.planisphere.json` — loads graph from the file only
 * (does not run the Python analyzer).
 *
 * Readonly rather than text-backed. `CustomTextEditorProvider` is the
 * interface that asks the editor for an editable text model, and building one
 * of CPython's 3.77MB artifact is 89,002 lines and a 3.77MB string handed
 * back: about 2,100ms, the largest single thing in a seven-second open, and
 * for a reader that parses the whole file as JSON and never looks at the text
 * again. Reading the file is 9ms.
 */
export class StructureGraphEditorProvider
  implements vscode.CustomReadonlyEditorProvider<ArtifactDocument>
{
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public openCustomDocument(uri: vscode.Uri): ArtifactDocument {
    // A regenerated artifact redraws its panel. That promise is about the file
    // and not about a text model: `onDidChangeTextDocument` fires only while
    // the editor happens to hold the artifact open as text, so it would miss an
    // analyzer writing the file while nothing has it open. A watcher sees the
    // write itself.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(uri, ".."),
        // The basename. `RelativePattern` takes a base and a pattern, and the
        // pattern must not be a path or it is matched against one.
        uri.path.split("/").pop() ?? "*"
      )
    );
    const changed = new vscode.EventEmitter<void>();
    watcher.onDidChange(() => changed.fire());
    watcher.onDidCreate(() => changed.fire());
    return {
      uri,
      onDidChange: changed.event,
      dispose: () => {
        watcher.dispose();
        changed.dispose();
      },
    };
  }

  public async resolveCustomEditor(
    document: ArtifactDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "cytoscape"),
      ],
    };
    webviewPanel.webview.html = buildGraphWebviewHtml(
      webviewPanel.webview,
      this.context.extensionUri
    );

    /**
     * The reader's own preferences, kept for the reader rather than for this
     * panel. A colour or a layout chosen once is a statement about how they
     * want drawings to look, not about the tab it was typed into, so it lives
     * on the extension and outlives the tab, the window and the workspace.
     *
     * One key holding one object: they are read and written together, and a
     * key each would only mean more round trips and a migration every time one
     * is added.
     */
    const SETTINGS_KEY = "planisphere.settings";

    const sendSettings = (): void => {
      void webviewPanel.webview.postMessage({
        command: "setSettings",
        settings: this.context.globalState.get<Record<string, unknown>>(
          SETTINGS_KEY,
          {}
        ),
      });
    };

    /**
     * @param reason `"ready"` marks a re-send prompted by the webview asking,
     *   which the webview ignores if it already has the graph. The eager send
     *   below and edits to the document carry no reason and always apply.
     */
    const updateWebview = async (reason?: string): Promise<void> => {
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      const parsed = parseGraphDocument(new TextDecoder().decode(bytes));
      if (!parsed.ok) {
        void webviewPanel.webview.postMessage({
          command: "setError",
          message: parsed.error,
        });
        return;
      }
      void webviewPanel.webview.postMessage({
        command: "setGraph",
        graph: parsed.graph,
        reason,
      });
    };

    const changeSub = document.onDidChange(() => {
      void updateWebview();
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(
      async (message: {
        command?: string;
        file?: string;
        line?: number;
        data?: string;
        reduced?: boolean;
        width?: number;
        height?: number;
        id?: string;
        settings?: Record<string, unknown>;
      }) => {
        if (message.command === "ready") {
          // Settings first, so a viewer that has just asked for its graph has
          // them in hand before it draws. It does not depend on that — a
          // viewer that only read them before its first drawing would be one
          // that hangs when the answer is slow — but arriving first spares it
          // drawing twice.
          sendSettings();
          await updateWebview("ready");
          return;
        }
        if (message.command === "saveSettings") {
          // Fire and forget on the webview's side, and there is nothing to
          // report back: a colour change that waited for a round trip would
          // make the panel feel like a form.
          await this.context.globalState.update(
            SETTINGS_KEY,
            message.settings ?? {}
          );
          return;
        }
        if (message.command === "getComment" && message.file && message.id) {
          // Always answered, including with nothing. The webview has a
          // pending request keyed on this id; leaving it unanswered would
          // leave it pending forever.
          void webviewPanel.webview.postMessage({
            command: "setComment",
            id: message.id,
            lines: await readLeadingComment(message.file, message.line ?? 1),
          });
          return;
        }
        if (message.command === "jumpTo" && message.file) {
          await jumpToSource(message.file, message.line ?? 1);
          return;
        }
        if (message.command === "exportPng" && message.data) {
          await writeExportedPng(document.uri, message);
        }
      }
    );

    // Settings only. The graph is sent when the webview asks for it and not
    // before: a send made here parses the artifact and serialises the whole
    // graph into a webview that has no listener yet — 167ms of CPython's open,
    // thrown away — and the ask arrives from the top of the webview's script,
    // which on a panel that is already alive is the same frame.
    sendSettings();
  }
}

/**
 * The comment above one definition, read now rather than when the graph was
 * analyzed.
 *
 * Through `openTextDocument` rather than the filesystem, so a file open in an
 * editor is read as it currently stands — the comment being typed right now
 * is the comment shown. Nothing is thrown: the drawing does not depend on the
 * source being present, and must not start to because of this.
 */
async function readLeadingComment(
  file: string,
  line: number
): Promise<string[]> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const abs = folder ? resolveNodeFilePath(file, folder.uri.fsPath) : file;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return leadingComment(lines, line);
  } catch {
    return [];
  }
}

async function jumpToSource(file: string, line: number): Promise<void> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const abs = folder
      ? resolveNodeFilePath(file, folder.uri.fsPath)
      : file;
    const uri = vscode.Uri.file(abs);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.One,
    });
    const lineIndex = Math.max(0, line - 1);
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(range.start, range.start);
  } catch {
    void vscode.window.showWarningMessage(
      `Planisphere: could not open ${file}:${line}`
    );
  }
}

/**
 * The webview can draw the image but cannot write a file; the host can write a
 * file but cannot draw. So the bytes come across as a data URI and land here.
 *
 * The destination is derived from the artifact's own URI rather than asked
 * for: one command, one place, and re-exporting after adjusting the view is
 * the common case, so it replaces rather than accumulating near-identical
 * files. It says so, because silently overwriting is the part that would be
 * surprising.
 */
async function writeExportedPng(
  documentUri: vscode.Uri,
  message: { data?: string; reduced?: boolean; width?: number; height?: number }
): Promise<void> {
  try {
    const comma = (message.data ?? "").indexOf(",");
    if (comma < 0) {
      throw new Error("malformed image data");
    }
    const bytes = Buffer.from(message.data!.slice(comma + 1), "base64");
    const target = exportTargetUri(documentUri);
    let replaced = false;
    try {
      await vscode.workspace.fs.stat(target);
      replaced = true;
    } catch {
      replaced = false;
    }
    await vscode.workspace.fs.writeFile(target, bytes);

    const parts = [`Planisphere: wrote ${vscode.workspace.asRelativePath(target)}`];
    if (message.width && message.height) {
      parts.push(`${message.width} × ${message.height}`);
    }
    if (replaced) {
      parts.push("replaced the previous export");
    }
    if (message.reduced) {
      parts.push("reduced to fit the renderer's limits");
    }
    const choice = await vscode.window.showInformationMessage(
      parts.join(" — "),
      "Reveal"
    );
    if (choice === "Reveal") {
      await vscode.commands.executeCommand("revealFileInOS", target);
    }
  } catch (err) {
    void vscode.window.showWarningMessage(
      `Planisphere: could not write the PNG (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
}

/** `foo.planisphere.json` -> `foo.planisphere.png`, beside the artifact. */
export function exportTargetUri(documentUri: vscode.Uri): vscode.Uri {
  const name = documentUri.path.split("/").pop() ?? "planisphere.json";
  const base = name.replace(/\.json$/i, "");
  return documentUri.with({
    path: documentUri.path.slice(0, documentUri.path.length - name.length) +
      base + ".png",
  });
}
