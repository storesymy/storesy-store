/**
 * Content editing for a framed preview.
 *
 * A complete document (an import, or one typed into the Code view) mounts in
 * a sandboxed, opaque-origin frame — nothing out here can reach into its DOM.
 * What the frame *can* do is run a script of its own, which is how the height
 * probe already works. Content edit rides the same road: the srcdoc carries a
 * snippet that marks the page's text as editable and posts the resulting
 * document back, and the parent stores it exactly where the Code view would.
 *
 * What gets marked: an element with real text in it whose children are all
 * inline (spans, links, emphasis) — headings, paragraphs, list items, buttons,
 * labels. Containers that hold layout — cards, grids, images, forms — stay
 * untouched, so typing can reword a page without being able to pull it apart.
 *
 * What comes back is the document with every trace of the editor removed: the
 * snippet and the height probe the editor injected are dropped, the marker and
 * `contenteditable` are stripped, and the doctype is rebuilt. A document that
 * brought its own height probe (every import does) keeps it. The stored HTML
 * stays otherwise byte-identical to what the Code view shows.
 */

/** Marks an element the edit layer has made editable. */
export const CONTENT_EDIT_ATTR = "data-sco-edit";

/** Marks the editor's own injected nodes, so serialization can drop them. */
const EDIT_MARK = "data-sco-edit";

const CONTENT_EDIT_SNIPPET = `<style ${EDIT_MARK}>
[${CONTENT_EDIT_ATTR}]:hover { outline: 1px dashed rgba(255, 101, 0, .55); outline-offset: 2px; cursor: text; }
[${CONTENT_EDIT_ATTR}]:focus { outline: 2px solid #FF6500; outline-offset: 2px; }
/* Editing is on by default and every edit autosaves, so a stray image drag
   would silently move a picture in the stored document. Chromium honours
   this; the rule leaves with the rest of the layer on serialize. */
img { -webkit-user-drag: none; }
</style>
<script ${EDIT_MARK}>
(() => {
  const MARK = ${JSON.stringify(EDIT_MARK)};
  // Set when this render injected the height probe, so serialization drops it
  // again — a page that brought its own probe must keep it.
  const DROP_PROBE = __DROP_PROBE__;
  // Tags whose contents are text rather than structure.
  const INLINE = new Set(["A","B","STRONG","EM","I","U","S","SMALL","SUP","SUB","SPAN","BR","CODE","LABEL","TIME","CITE","ABBR","Q","MARK"]);
  // Never editable, and never descended into.
  const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","TEXTAREA","INPUT","SELECT","OPTION","IFRAME","VIDEO","AUDIO","SOURCE","SVG","CANVAS","HEAD"]);

  /** True when every child is either text or a purely inline element. */
  function inlineOnly(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) continue;
      if (node.nodeType !== 1 || !INLINE.has(node.tagName)) return false;
    }
    return true;
  }

  /** True when the element carries visible text of its own. */
  function hasText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.nodeValue.trim() !== "") return true;
    }
    return false;
  }

  function mark(root) {
    for (const el of root.querySelectorAll("*")) {
      if (SKIP.has(el.tagName) || el.hasAttribute(MARK)) continue;
      if (!hasText(el) || !inlineOnly(el)) continue;
      el.setAttribute(MARK, "");
      el.setAttribute("contenteditable", "true");
    }
  }

  /** The document as the page itself would store it — no editor traces. */
  function serialize() {
    const clone = document.documentElement.cloneNode(true);
    const drop = ["style[" + MARK + "]", "script[" + MARK + "]"];
    if (DROP_PROBE) drop.push("script[data-storesy-import]");
    for (const node of clone.querySelectorAll(drop.join(", "))) node.remove();
    for (const el of clone.querySelectorAll("[" + MARK + "]")) {
      el.removeAttribute(MARK);
      el.removeAttribute("contenteditable");
    }
    const dt = document.doctype;
    const doctype = dt
      ? "<!DOCTYPE " + dt.name +
        (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : "") +
        (dt.systemId ? ' "' + dt.systemId + '"' : "") + ">"
      : "<!doctype html>";
    return doctype + "\\n" + clone.outerHTML;
  }

  let timer = 0;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      parent.postMessage({ storesy: "edit", html: serialize() }, "*");
    }, 400);
  };

  mark(document);
  // Capture phase: the page's own listeners can't swallow the edit.
  document.addEventListener("input", send, true);
  document.addEventListener("blur", send, true);
})();
</script>`;

/**
 * The same snippet as a string, stamped into a srcdoc the way the height probe
 * is — before `</body>`, so the page's own styles are already in place when the
 * text gets marked.
 *
 * `ownsHeightProbe` records whether the accompanying `withHeightProbe` call is
 * about to inject a probe of its own. When it is, serialization drops that one
 * too, so an edit round-trips to exactly the document that went in.
 */
export function withContentEdit(html: string, ownsHeightProbe: boolean): string {
  if (html.includes(`script ${EDIT_MARK}`)) return html;
  const snippet = CONTENT_EDIT_SNIPPET.replace("__DROP_PROBE__", ownsHeightProbe ? "true" : "false");
  const at = html.lastIndexOf("</body>");
  return at === -1
    ? `${html}${snippet}`
    : `${html.slice(0, at)}${snippet}${html.slice(at)}`;
}
