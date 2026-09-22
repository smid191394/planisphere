import * as vscode from "vscode";
import { parseGraphDocument } from "./parseGraphDocument";

export { parseGraphDocument } from "./parseGraphDocument";
export type { ParsedGraphDocument } from "./parseGraphDocument";

export function buildGraphWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const cytoscapeUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "node_modules",
      "cytoscape",
      "dist",
      "cytoscape.min.js"
    )
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "graph.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "graph.css")
  );
  // Declared here with the other asset URIs rather than in graph.css: the star
  // field is drawn into a canvas, not set as a CSS background, so the
  // stylesheet has no use for it and graph.js needs the resolved webview URI.
  const starfieldUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "starfield.jpg")
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <!-- img-src carries two things: \`cspSource\` for the star field shipped in
       media/, and \`data:\` for the PNG export, which loads cytoscape's own
       data-URI output into an Image before compositing it over the backdrop. -->
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- The closed panel, stated here so that it is true from the first paint.

       Every other rule the page has is in the stylesheet below, fetched over
       the webview's own protocol — and a paint before it arrives shows the
       markup in the browser's own styling. The rail is six \`<button>\`
       elements, the only things on the page the browser gives a border and a
       fill, so what that looks like is a strip of grey buttons on white.

       Three rules, and each is about the closed state rather than about how
       anything looks. The last is the least obvious and does the most work:
       \`.hidden { display: none }\` is itself in that stylesheet, so until it
       lands \`class="hidden"\` means nothing and the legend, the comment box
       and the whole settings panel are laid out too.

       \`body.ready\` is deliberately not here. It is the rule that ends the
       wait, and the wait must not end before the stylesheet that draws what
       comes next. -->
  <style nonce="${nonce}">
    html, body { background: var(--vscode-editor-background, #1B1F24); margin: 0; height: 100%; }
    #sidebar, #main { visibility: hidden; }
    .hidden { display: none; }
  </style>
  <link rel="stylesheet" href="${styleUri}" />
  <title>Planisphere Structure</title>
</head>
<body>
  <!-- A collapsible rail, not a popover. It takes its own column instead of
       overlaying the drawing, which is what lets it drop the scrim and the
       keyboard guard an overlay menu needed: nothing here can be mistaken for
       a click on the canvas, so no cytoscape handler has to know it exists.
       Collapsed it is icons and tooltips; expanded it adds the labels. The
       choice is the reader's and survives the panel being hidden and shown. -->
  <nav id="sidebar" data-collapsed="true" aria-label="View controls">
    <button id="sidebar-toggle" type="button" aria-expanded="false"
            aria-controls="sidebar" title="Expand">
      <!-- A chevron is a shape, so it is drawn as one. The other three icons are
           letterforms and stay as text; this one was the only glyph whose ink
           sat noticeably off its box's centre, because guillemets are
           punctuation and ride high. An SVG has no opinion about baselines. -->
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"
        ><path d="M10.25 3.5 5.75 8l4.5 4.5" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg
      ></span><span class="lbl">Collapse</span>
    </button>
    <div class="rail-sep"></div>
    <button id="toggle-fns" type="button" aria-pressed="false" title="Show functions">
      <span class="ico" aria-hidden="true">&#402;</span><span class="lbl">Show functions</span>
    </button>
    <button id="reset-view" type="button" title="Reset view">
      <span class="ico" aria-hidden="true">&#10226;</span><span class="lbl">Reset view</span>
    </button>
    <!-- Below the separator sit the things that are not about steering the
         view you are looking at. Settings joins them: a preference is not a
         verb, and the three above it all are. -->
    <div class="rail-sep rail-sep-foot"></div>
    <button id="toggle-settings" type="button" aria-pressed="false" title="Settings">
      <span class="ico" aria-hidden="true">&#9881;</span><span class="lbl">Settings</span>
    </button>
    <button id="export-png" type="button" title="Export PNG">
      <span class="ico" aria-hidden="true">&#8615;</span><span class="lbl">Export PNG</span>
    </button>
    <button id="toggle-legend" type="button" aria-pressed="false" title="Legend">
      <span class="ico" aria-hidden="true">&#9432;</span><span class="lbl">Legend</span>
    </button>
  </nav>
  <div id="main">
    <!-- Everything behind the graph, on one canvas: the star field and the
         orbit rings. Both move with the drawing — a fixed backdrop read as
         detached from the graph sliding over it — so both are drawn rather
         than styled, and the PNG export gets them from the same one function.
         Drawn here rather than as cytoscape elements so they never enter
         cy.nodes() / cy.edges(), where fitting, searching and emphasis would
         all have to learn to exclude them. -->
    <canvas id="space" data-starfield="${starfieldUri}"></canvas>
    <div id="empty" class="hidden">No Python symbols found in this graph.</div>
    <div id="error" class="hidden"></div>
    <!-- The right button's view: which node it is, how much of the drawing it
         kept, and the way back. The count is what makes a nearly empty screen
         an answer: one circle under "1 / 8,763" is what the reader asked for,
         and one circle under nothing is a viewer that looks broken. -->
    <div id="reach-strip" class="hidden" role="status">
      <button id="reach-back" type="button" title="Back to the whole drawing"
              aria-label="Back to the whole drawing">&#8592;</button>
      <span id="reach-name"></span>
      <span id="reach-count"></span>
    </div>
    <div id="cy"></div>
    <!-- A box floating near the bottom edge, not a bar across it: a full-width
         strip would take back the vertical space the controls gave up by
         moving left, and would draw a line across the drawing besides. The
         match count sits above the field so the field itself stays put. -->
    <div id="searchbar">
      <span id="search-status" aria-live="polite"></span>
      <input id="symbol-search" type="text" placeholder="Search symbols  (/)" aria-label="Search symbols" autocomplete="off" />
    </div>
    <!-- Shares the legend's corner: both are reference read beside the
         drawing rather than part of it, both are dismissable, and giving each
         its own corner would spend the drawing's space on two panels that are
         rarely wanted at once. -->
    <aside id="comment" class="hidden" aria-live="polite">
      <h3 id="comment-title"></h3>
      <pre id="comment-body"></pre>
      <ul id="comment-members" class="hidden"></ul>
    </aside>
    <!-- Takes the whole drawing surface rather than a corner of it. A corner
         box is the shape of a reference card, read beside the drawing; this is
         read instead of the drawing, and there will be more in it than 260px
         of column holds. Sections from the start: a flat list is the thing
         that has to be undone when the second setting lands. -->
    <aside id="settings" class="hidden" aria-label="Settings">
      <!-- No title band. The reader pressed a button marked Settings and this
           is the only thing on screen; a heading saying so spends a band of
           the room the settings need. The two controls it carried stay, as
           controls. -->
      <div id="settings-actions">
        <button id="settings-close" type="button" title="Close settings" aria-label="Close settings">
          <span aria-hidden="true">&#10005;</span>
        </button>
      </div>
      <div id="settings-body">
        <section>
          <h3>Nodes</h3>
          <div class="rows">
            <!-- The same header the edges carry, so the two sections read as
                 one table with the columns a row happens not to use left
                 empty, rather than as two tables that disagree. -->
            <div class="row row-head">
              <span class="row-name"></span>
              <span class="row-controls"><span class="col-h">colour</span></span>
            </div>
            <div class="row" data-kind="class">
              <label class="row-name" for="set-palette.node-class">class</label>
              <span class="swatch"><span class="dot node-class"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-class" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-class" type="color" data-setting="palette.node-class" value="#1E88E5" />
              </span>
            </div>
            <div class="row" data-kind="interface">
              <label class="row-name" for="set-palette.node-interface">interface</label>
              <span class="swatch"><span class="dot node-interface"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-interface" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-interface" type="color" data-setting="palette.node-interface" value="#00BCD4" />
              </span>
            </div>
            <div class="row" data-kind="type">
              <label class="row-name" for="set-palette.node-type">type</label>
              <span class="swatch"><span class="dot node-type"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-type" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-type" type="color" data-setting="palette.node-type" value="#7E57C2" />
              </span>
            </div>
            <div class="row" data-kind="enum">
              <label class="row-name" for="set-palette.node-enum">enum</label>
              <span class="swatch"><span class="dot node-enum"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-enum" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-enum" type="color" data-setting="palette.node-enum" value="#FFB300" />
              </span>
            </div>
            <div class="row" data-kind="struct">
              <label class="row-name" for="set-palette.node-struct">struct</label>
              <span class="swatch"><span class="dot node-struct"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-struct" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-struct" type="color" data-setting="palette.node-struct" value="#5C6BC0" />
              </span>
            </div>
            <div class="row" data-kind="package">
              <label class="row-name" for="set-palette.node-package">package</label>
              <span class="swatch"><span class="dot node-package"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-package" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-package" type="color" data-setting="palette.node-package" value="#C0CA33" />
              </span>
            </div>
            <div class="row" data-kind="function">
              <label class="row-name" for="set-palette.node-function">function</label>
              <span class="swatch"><span class="dot node-function"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-function" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-function" type="color" data-setting="palette.node-function" value="#43A047" />
              </span>
            </div>
            <div class="row" data-kind="file">
              <label class="row-name" for="set-palette.node-file">file</label>
              <span class="swatch"><span class="dot node-file"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-file" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-file" type="color" data-setting="palette.node-file" value="#FB8C00" />
              </span>
            </div>
            <div class="row">
              <label class="row-name" for="set-palette.node-center">center</label>
              <span class="swatch"><span class="dot node-center"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-center" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-center" type="color" data-setting="palette.node-center" value="#E91E63" />
              </span>
            </div>
            <div class="row">
              <label class="row-name" for="set-palette.node-focus-border">focus</label>
              <span class="swatch"><span class="dot node-focus"></span></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.node-focus-border" title="Back to the saved value">&#8635;</button>
                <input id="set-palette.node-focus-border" type="color" data-setting="palette.node-focus-border" value="#FFEB3B" />
              </span>
            </div>
          </div>
        </section>

        <section>
          <h3>Edges</h3>
          <div class="rows">
            <div class="row row-head">
              <span class="row-name"></span>
              <span class="row-controls"><span class="col-h">colour</span><span class="col-h col-h-num">width</span><span class="col-h col-h-sel">line</span><span class="col-h col-h-arrow">arrow</span></span>
            </div>
            <div class="row row-edge" data-mark="edge:inherits">
              <span class="row-name">inherits</span>
              <span class="swatch swatch-line"><svg class="line" data-edge="inherits" viewBox="0 0 42 10" width="42" height="10" aria-hidden="true"><line class="line-stroke" x1="1" y1="5" x2="41" y2="5" /><path class="arrow-head" d="" /></svg></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.edge-inherits" title="Back to the saved value">&#8635;</button>
                <input type="color" data-setting="palette.edge-inherits" value="#90CAF9" aria-label="inherits colour" />
                <button class="revert" type="button" data-revert="edges.inherits.width" title="Back to the saved value">&#8635;</button>
                <input class="num" type="number" min="0.5" max="8" step="0.5" data-setting="edges.inherits.width" value="2" aria-label="inherits width" />
                <button class="revert" type="button" data-revert="edges.inherits.style" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.inherits.style" aria-label="inherits line style"><option value="solid" selected>solid</option><option value="dashed">dashed</option><option value="dotted">dotted</option></select>
                <button class="revert" type="button" data-revert="edges.inherits.arrow" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.inherits.arrow" aria-label="inherits arrow"><option value="triangle" selected>triangle</option><option value="none">none</option><option value="vee">vee</option><option value="circle">circle</option></select>
              </span>
            </div>
            <div class="row row-edge" data-mark="edge:uses">
              <span class="row-name">uses</span>
              <span class="swatch swatch-line"><svg class="line" data-edge="uses" viewBox="0 0 42 10" width="42" height="10" aria-hidden="true"><line class="line-stroke" x1="1" y1="5" x2="41" y2="5" /><path class="arrow-head" d="" /></svg></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.edge-uses" title="Back to the saved value">&#8635;</button>
                <input type="color" data-setting="palette.edge-uses" value="#9B72AF" aria-label="uses colour" />
                <button class="revert" type="button" data-revert="edges.uses.width" title="Back to the saved value">&#8635;</button>
                <input class="num" type="number" min="0.5" max="8" step="0.5" data-setting="edges.uses.width" value="1.5" aria-label="uses width" />
                <button class="revert" type="button" data-revert="edges.uses.style" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.uses.style" aria-label="uses line style"><option value="solid">solid</option><option value="dashed" selected>dashed</option><option value="dotted">dotted</option></select>
                <button class="revert" type="button" data-revert="edges.uses.arrow" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.uses.arrow" aria-label="uses arrow"><option value="triangle" selected>triangle</option><option value="none">none</option><option value="vee">vee</option><option value="circle">circle</option></select>
              </span>
            </div>
            <div class="row row-edge" data-mark="edge:references">
              <span class="row-name">references</span>
              <span class="swatch swatch-line"><svg class="line" data-edge="references" viewBox="0 0 42 10" width="42" height="10" aria-hidden="true"><line class="line-stroke" x1="1" y1="5" x2="41" y2="5" /><path class="arrow-head" d="" /></svg></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.edge-references" title="Back to the saved value">&#8635;</button>
                <input type="color" data-setting="palette.edge-references" value="#80CBC4" aria-label="references colour" />
                <button class="revert" type="button" data-revert="edges.references.width" title="Back to the saved value">&#8635;</button>
                <input class="num" type="number" min="0.5" max="8" step="0.5" data-setting="edges.references.width" value="1.5" aria-label="references width" />
                <button class="revert" type="button" data-revert="edges.references.style" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.references.style" aria-label="references line style"><option value="solid">solid</option><option value="dashed" selected>dashed</option><option value="dotted">dotted</option></select>
                <button class="revert" type="button" data-revert="edges.references.arrow" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.references.arrow" aria-label="references arrow"><option value="triangle" selected>triangle</option><option value="none">none</option><option value="vee">vee</option><option value="circle">circle</option></select>
              </span>
            </div>
            <div class="row row-edge" data-mark="edge:contains">
              <span class="row-name">contains</span>
              <span class="swatch swatch-line"><svg class="line" data-edge="contains" viewBox="0 0 42 10" width="42" height="10" aria-hidden="true"><line class="line-stroke" x1="1" y1="5" x2="41" y2="5" /><path class="arrow-head" d="" /></svg></span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="palette.edge-contains" title="Back to the saved value">&#8635;</button>
                <input type="color" data-setting="palette.edge-contains" value="#B0BEC5" aria-label="contains colour" />
                <button class="revert" type="button" data-revert="edges.contains.width" title="Back to the saved value">&#8635;</button>
                <input class="num" type="number" min="0.5" max="8" step="0.5" data-setting="edges.contains.width" value="1" aria-label="contains width" />
                <button class="revert" type="button" data-revert="edges.contains.style" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.contains.style" aria-label="contains line style"><option value="solid">solid</option><option value="dashed">dashed</option><option value="dotted" selected>dotted</option></select>
                <button class="revert" type="button" data-revert="edges.contains.arrow" title="Back to the saved value">&#8635;</button>
                <select data-setting="edges.contains.arrow" aria-label="contains arrow"><option value="triangle" selected>triangle</option><option value="none">none</option><option value="vee">vee</option><option value="circle">circle</option></select>
              </span>
            </div>
</div>
        </section>
        <!-- Last, and one row like the others. It is one choice, made rarely,
             and as two labelled radios with prose beside them it was the
             largest thing in a panel it is the smallest part of. -->
        <section>
          <h3>Layout</h3>
          <div class="rows">
            <!-- How much of a large drawing the reader gets when the viewer
                 frames it for them. The number is the smallest a label may be
                 drawn at while the view is being fitted: raise it and the fit
                 stops sooner, so the drawing comes up larger and more of it is
                 off screen.
                 Named for the framing rather than for opening, because opening
                 is only one of the times it happens — Reset view and a jump
                 from search are framed by the same rule, and a name that said
                 "opening" would be describing one of the three.
                 Expressed against the label rather than as a zoom, because a
                 zoom number means a different amount of drawing on every
                 window size, while what the reader is actually choosing is
                 whether they can still read it. -->
            <div class="row">
              <span class="row-name">default view</span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="labelFloor" title="Back to the saved value">&#8635;</button>
                <input class="num" type="number" min="2" max="15" step="0.5" data-setting="labelFloor" value="4.5"
                       title="Smallest label, in pixels, that fitting the drawing may shrink to. Larger frames it more magnified and shows less of the drawing. Used whenever the viewer frames the drawing: on open, on Reset view, and on a jump from search."
                       aria-label="default view: smallest label in pixels" />
              </span>
            </div>
            <div class="row">
              <span class="row-name">crowded level</span>
              <span class="row-controls">
                <button class="revert" type="button" data-revert="bandOverflow" title="Back to the saved value">&#8635;</button>
                <!-- Two pictures rather than two words. What this setting
                     does is a shape, and the shape fits in 34px — where
                     drawing it would need a ring of at least fourteen nodes,
                     most of them there for this one row.
                     Drawn rather than laid out, because what they illustrate
                     is the idea of one arc against two, not any particular
                     arrangement. -->
                <span class="choices">
                  <button class="choice" type="button" data-setting="bandOverflow" data-choice value="ring"
                          aria-pressed="true" title="All on the ring — the level stays one clean arc, and the nodes on it overlap">
                    <svg viewBox="0 0 34 20" width="34" height="20" aria-hidden="true">
                      <path d="M3 15 A 16 16 0 0 1 31 15" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35" />
                      <circle cx="6" cy="12.4" r="3" /><circle cx="11" cy="9.6" r="3" /><circle cx="17" cy="8.6" r="3" />
                      <circle cx="23" cy="9.6" r="3" /><circle cx="28" cy="12.4" r="3" />
                    </svg>
                  </button>
                  <button class="choice" type="button" data-setting="bandOverflow" data-choice value="rows"
                          aria-pressed="false" title="Rows outside the ring — the ones with nothing hanging off them move out, so fewer overlap">
                    <svg viewBox="0 0 34 20" width="34" height="20" aria-hidden="true">
                      <path d="M5 17 A 14 14 0 0 1 29 17" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35" />
                      <circle cx="8" cy="14" r="2.6" /><circle cx="17" cy="11.4" r="2.6" /><circle cx="26" cy="14" r="2.6" />
                      <circle cx="12" cy="6.4" r="2.6" /><circle cx="22" cy="6.4" r="2.6" />
                    </svg>
                  </button>
                </span>
              </span>
            </div>
          </div>
        </section>
        <!-- Changes show at once and are kept only when the reader says so. A
             panel that wrote every keystroke to the store had no moment at
             which the reader had finished, and no way to try something and
             walk away from it.
             It scrolls with the settings rather than being pinned: a bar held
             against the bottom edge takes that height from every section above
             it, and Save is what you reach at the end of reading, not
             something you need in view while you read. -->
        <div id="settings-foot">
        <button id="settings-reset" type="button" title="Put every setting back">Reset all</button>
        <span id="settings-dirty" hidden>unsaved changes</span>
        <button id="settings-save" type="button" disabled>Save</button>
        </div>
      </div>
    </aside>
    <aside id="legend" class="hidden">
      <h3>Nodes</h3>
      <ul>
        <li data-kind="class"><span class="swatch"><span class="dot node-class"></span></span><span class="term">class</span></li>
        <li data-kind="interface"><span class="swatch"><span class="dot node-interface"></span></span><span class="term">interface</span><span class="gloss">a shape, not a body</span></li>
        <li data-kind="type"><span class="swatch"><span class="dot node-type"></span></span><span class="term">type</span><span class="gloss">a name for another type</span></li>
        <li data-kind="enum"><span class="swatch"><span class="dot node-enum"></span></span><span class="term">enum</span><span class="gloss">a fixed set of values</span></li>
        <li data-kind="struct"><span class="swatch"><span class="dot node-struct"></span></span><span class="term">struct</span></li>
        <li data-kind="package"><span class="swatch"><span class="dot node-package"></span></span><span class="term">package</span><span class="gloss">a unit above the file</span></li>
        <li data-kind="function"><span class="swatch"><span class="dot node-function"></span></span><span class="term">function</span><span class="gloss">top level only</span></li>
        <li data-kind="file"><span class="swatch"><span class="dot node-file"></span></span><span class="term">file</span><span class="gloss">no symbol of its own</span></li>
        <li><span class="swatch"><span class="dot node-center"></span></span><span class="term">center</span><span class="gloss">where the drawing starts</span></li>
        <li><span class="swatch"><span class="dot node-focus"></span></span><span class="term">focus</span><span class="gloss">the node you clicked</span></li>
        <li data-mark="folded"><span class="swatch"><span class="dot stacked"></span></span><span class="term">doubled rim</span><span class="gloss">several drawn as one</span></li>
      </ul>
      <h3>Edges</h3>
      <ul>
        <li data-mark="edge:inherits"><span class="swatch"><span class="line edge-inherits"></span></span><span class="term">inherits</span><span class="gloss">subclass of</span></li>
        <li data-mark="edge:uses"><span class="swatch"><span class="line edge-uses"></span></span><span class="term">uses</span><span class="gloss">calls, builds, isinstance</span></li>
        <li data-mark="edge:references"><span class="swatch"><span class="line edge-references"></span></span><span class="term">references</span><span class="gloss">named in a type annotation</span></li>
        <li data-mark="edge:contains"><span class="swatch"><span class="line edge-contains"></span></span><span class="term">contains</span><span class="gloss">declared inside it</span></li>
      </ul>
      <h3>Doing</h3>
      <ul>
        <li><span class="term">click</span><span class="gloss">highlight the neighbours</span></li>
        <li><span class="term">click again</span><span class="gloss">open it, or list them</span></li>
        <li><span class="term">right-click</span><span class="gloss">what it points to, two steps</span></li>
        <li><span class="term">empty space</span><span class="gloss">clear the selection</span></li>
        <li><span class="term"><kbd>c</kbd></span><span class="gloss">centre it, or hand it back</span></li>
        <li><span class="term"><kbd>f</kbd></span><span class="gloss">fit everything</span></li>
        <li><span class="term"><kbd>/</kbd></span><span class="gloss">search by name</span></li>
      </ul>
      <ul>
        <li><span class="gloss">Edges are lexical, not a runtime call graph. Some are missed; some are wrong.</span></li>
      </ul>
    </aside>
  </div>
  <script nonce="${nonce}" src="${cytoscapeUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
