import { renderToStaticMarkup } from "react-dom/server";
import { EditingContext, StaticContext } from "../components/Editable";
import { SectionContent } from "../components/SalesSections";
import type { IconSetId } from "./setIcons";
import type { SalesSection } from "./salesPages";

/**
 * The sections' HTML exactly as React emits it — one dense line per section.
 * This is the formatter's input (`sectionsHtml` pretty-prints it); exported
 * so the pipeline stays verifiable: formatting must never change content.
 *
 * `staticRender` targets the standalone document served at `/<slug>`:
 * nothing runs there, so FAQ answers and carousel slides render all at once
 * instead of behind clicks.
 */
export function renderSectionsHtml(
  sections: SalesSection[],
  iconSet: IconSetId,
  staticRender = false,
): string {
  return sections
    .map((section) =>
      renderToStaticMarkup(
        <EditingContext.Provider value={false}>
          <StaticContext.Provider value={staticRender}>
            <SectionContent
              section={section}
              iconSet={iconSet}
              onChange={() => {
                /* Read-only serialization. */
              }}
              onRemoveItem={() => {
                /* Read-only serialization. */
              }}
            />
          </StaticContext.Provider>
        </EditingContext.Provider>,
      ),
    )
    .join("\n");
}

/** HTML elements that never carry children — they never open a level. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Tags that sit in the inline flow under the default UA stylesheet, plus the
 * ones that render no box at all. This is the formatter's fidelity rule:
 * whitespace *between two inline-flow neighbours* renders as a space, so a
 * line break inserted there would change the page (`</span>,` → `</span> ,`).
 * Around block boxes a break is free — the whitespace collapses at the line
 * edge — so those are where the pretty-printing happens. Unrendered tags
 * (scripts, styles, links…) count as inline because a break around them would
 * leave a collapsed space between the *visible* neighbours.
 */
const INLINE_FLOW_TAGS = new Set([
  // inline boxes
  "a", "abbr", "b", "big", "button", "cite", "code", "data", "del", "em",
  "font", "i", "img", "input", "ins", "kbd", "label", "mark", "meter",
  "picture", "progress", "q", "s", "samp", "select", "slot", "small", "span",
  "strong", "sub", "sup", "svg", "time", "u", "var", "wbr", "audio", "video",
  "iframe", "canvas", "object", "embed", "map", "textarea", "output",
  "marquee", "tt", "nobr", "ruby", "rt", "rp",
  // SVG text content (whitespace inside it renders)
  "text", "tspan", "textpath",
  // render no box: breaking around them spaces the visible neighbours
  "script", "style", "meta", "link", "base", "title", "template", "noscript",
  "desc", "source", "track", "param", "col", "area", "option", "optgroup",
]);

type Flow = "inline" | "block";

function flowOf(name: string): Flow {
  return INLINE_FLOW_TAGS.has(name.toLowerCase()) ? "inline" : "block";
}

/** A break is render-safe unless it would put a space between inline boxes. */
function breaksLine(left: Flow, right: Flow): boolean {
  return !(left === "inline" && right === "inline");
}

/** ASCII whitespace only — NBSP (`&nbsp;` as a literal char) is content. */
const ASCII_WS = /[ \t\r\n\f]+/g;

/**
 * Elements whose content is raw text: CSS, JS and preformatted blocks. The
 * formatter keeps their bodies byte-for-byte — tag scanning would mistake
 * `<` inside JS for markup, and whitespace collapsing would break CSS rules,
 * line comments and <pre> layout. (The importer produces all three.)
 */
const RAW_TEXT_TAGS = new Set(["style", "script", "pre", "textarea"]);

/** Two-space indent (what Tab inserts in the code editor) and a line budget. */
const INDENT = "  ";
const MAX_LINE = 120;

type TokenKind = "open" | "close" | "text" | "comment";

interface Token {
  kind: TokenKind;
  /** Raw token text — emitted verbatim, so formatting only ever adds space. */
  value: string;
  name: string;
  selfClosing: boolean;
}

/** Tags, comments and the text between them — the formatter's alphabet. */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    if (match.index > last) {
      tokens.push({
        kind: "text",
        value: src.slice(last, match.index),
        name: "",
        selfClosing: false,
      });
    }
    const raw = match[0];
    if (raw.startsWith("<!--")) {
      tokens.push({ kind: "comment", value: raw, name: "", selfClosing: false });
    } else {
      const closing = raw.startsWith("</");
      const name = /^<\/?([a-zA-Z][\w-]*)/.exec(raw)?.[1] ?? "";
      tokens.push({
        kind: closing ? "close" : "open",
        value: raw,
        name,
        selfClosing: !closing && raw.endsWith("/>"),
      });
    }
    last = match.index + raw.length;
    // Raw-text elements: swallow the body as ONE verbatim token and resume
    // scanning exactly at the close tag — never tokenize inside it.
    const previous = tokens[tokens.length - 1];
    if (
      previous?.kind === "open" &&
      !previous.selfClosing &&
      RAW_TEXT_TAGS.has(previous.name.toLowerCase())
    ) {
      const closeRe = new RegExp(`</${previous.name}\\s*>`, "i");
      const rest = src.slice(last);
      const closeMatch = closeRe.exec(rest);
      const bodyEnd = closeMatch ? closeMatch.index : rest.length;
      if (bodyEnd > 0) {
        tokens.push({ kind: "text", value: rest.slice(0, bodyEnd), name: "", selfClosing: false });
      }
      last += bodyEnd;
      re.lastIndex = last;
    }
  }
  if (last < src.length) {
    tokens.push({ kind: "text", value: src.slice(last), name: "", selfClosing: false });
  }
  return tokens;
}

/** Index of the close tag pairing the open tag at `openIndex`, or -1. */
function matchingClose(tokens: Token[], openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.kind === "open") {
      if (token.selfClosing || VOID_TAGS.has(token.name)) continue;
      depth += 1;
    } else if (token.kind === "close") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a tag's attributes on whitespace that sits outside quotes. */
function splitAttrs(attrs: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote = "";
  for (const ch of attrs) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Pretty-print generated HTML for the Code view: one element per line,
 * two-space indent per nesting level, text-only elements collapsed to a
 * single line when they fit, attributes wrapped past the line budget.
 *
 * Every line break must also be *render-neutral* (the formatter may add or
 * remove whitespace, never change the page):
 *
 * - between two inline-flow neighbours no break is inserted at all — a break
 *   there would collapse into a space (`</span>,` → `</span> ,`), so those
 *   runs keep their original adjacency (see INLINE_FLOW_TAGS);
 * - around block boxes a break is free: the whitespace sits at the line edge
 *   and rendering trims it;
 * - text collapses to single ASCII spaces (HTML collapses them anyway) and
 *   only keeps its edge spaces where the adjacent content is inline;
 * - `style`/`script`/`pre`/`textarea` bodies stay byte-for-byte.
 *
 * Re-running the formatter on its own output is a no-op.
 */
export function formatHtml(src: string): string {
  const tokens = tokenize(src);
  const lines: string[] = [];
  let cur: string | null = null; // line under construction (indent applied)
  let depth = 0;

  const append = (s: string): void => {
    cur = cur === null ? INDENT.repeat(depth) + s : cur + s;
  };
  const endLine = (): void => {
    if (cur !== null) {
      // Trailing spaces die with their line break — rendering trims them.
      // A line that ends up holding only whitespace (indent + a run-on space
      // before a break) is invisible in the render, so it is dropped rather
      // than printed as a blank line.
      const line = cur.replace(/[ \t]+$/, "");
      cur = null;
      if (line !== "") lines.push(line);
    }
  };

  /** One tag — run-on when the line allows, attributes wrapped when not. */
  function emitTag(raw: string): void {
    if ((cur ?? INDENT.repeat(depth)).length + raw.length <= MAX_LINE) {
      append(raw);
      return;
    }
    const parts = /^<([a-zA-Z][\w-]*)([\s\S]*?)(\/?>)$/.exec(raw);
    const attrs = parts ? splitAttrs(parts[2] ?? "") : [];
    if (!parts || attrs.length < 2) {
      append(raw);
      return;
    }
    append(`<${parts[1] ?? ""}`);
    for (const attr of attrs) {
      endLine();
      append(INDENT + attr);
    }
    endLine();
    append(parts[3] ?? ">");
  }

  /** A text run: collapsed; edges trimmed only when a line break hides them. */
  function emitText(value: string, atLineStart: boolean): void {
    const collapsed = value.replace(ASCII_WS, " ");
    const text = atLineStart ? collapsed.replace(/^[ \t]+/, "") : collapsed;
    if (text) append(text);
  }

  /** Body + close of a raw-text element (style/script/pre/textarea). */
  function emitRawBody(i: number, to: number): void {
    const bodyToken = tokens[i + 1];
    const hasBody = (to < 0 || i + 1 < to) && bodyToken?.kind === "text";
    const close = to >= 0 ? tokens[to]?.value : undefined;

    if (hasBody && close) {
      const body = bodyToken.value.replace(/^\r?\n/, "").replace(/\s+$/, "");
      if (body) {
        endLine();
        lines.push(body); // verbatim, column zero — never re-indent CSS/JS
        // The close hugs the body: a newline before </pre>/<textarea> would
        // become their content (inside <style>/<script> it renders nothing).
        lines[lines.length - 1] += close;
        return;
      }
      append(close); // Empty body collapses to one tidy line: <style></style>.
      return;
    }
    if (close) {
      append(close);
      return;
    }
    if (hasBody) {
      // Unclosed raw tag: emit what exists — never invent a close tag.
      endLine();
      lines.push(bodyToken.value.replace(/^\r?\n/, ""));
    }
  }

  /** tokens[from, to): the element's children; returns its right-edge flow. */
  function emitChildren(from: number, to: number, leftFlow: Flow): Flow {
    let prev = leftFlow;
    let j = from;
    while (j < to) {
      const token = tokens[j];
      if (!token) break;
      const flow: Flow = token.kind === "open" ? flowOf(token.name) : "inline";
      const brk = breaksLine(prev, flow);
      if (brk) endLine();
      if (token.kind === "text") {
        emitText(token.value, brk);
      } else if (token.kind === "comment") {
        append(token.value);
      } else if (token.kind === "close") {
        append(token.value); // Stray close: keep it — never drop content.
      } else {
        emitTag(token.value);
        if (!token.selfClosing && !VOID_TAGS.has(token.name)) {
          const closeIdx = matchingClose(tokens, j);
          j = emitAfterOpen(j, closeIdx) - 1;
        }
      }
      prev = flow;
      j += 1;
    }
    return prev;
  }

  /**
   * The element opened at `i` (open tag already emitted): its contents and
   * close tag. `to` = matching close index or -1; returns the index past it.
   */
  function emitAfterOpen(i: number, to: number): number {
    const token = tokens[i];
    if (!token) return i + 1;
    if (token.selfClosing || VOID_TAGS.has(token.name)) return i + 1;
    const end = to < 0 ? tokens.length : to;
    const past = to < 0 ? tokens.length : to + 1;
    const flow = flowOf(token.name);

    // Raw text (style/script/pre/textarea): body verbatim. Collapsing its
    // whitespace would break CSS/JS and <pre> layout.
    if (RAW_TEXT_TAGS.has(token.name.toLowerCase())) {
      emitRawBody(i, to);
      return past;
    }

    // Leaf — only text inside (or nothing): the whole thing on one line when
    // it fits. Block elements trim their text edges (the line edge does it
    // while rendering); inline elements keep theirs — they are visible.
    const children = tokens.slice(i + 1, end);
    if (children.every((child) => child.kind === "text")) {
      let body = children.map((child) => child.value).join("").replace(ASCII_WS, " ");
      if (flow === "block") body = body.replace(/^[ \t]+|[ \t]+$/g, "");
      const close = to >= 0 ? tokens[to]?.value ?? "" : "";
      if ((cur ?? INDENT.repeat(depth)).length + body.length + close.length <= MAX_LINE) {
        if (body) append(body);
        append(close);
        return past;
      }
    }

    // Otherwise the tag opens a level and the contents render underneath —
    // with breaks only where `emitChildren` finds them render-safe.
    depth += 1;
    const prev = emitChildren(i + 1, end, flow);
    depth -= 1;

    if (breaksLine(prev, flow)) endLine();
    if (to >= 0) append(tokens[to]?.value ?? "");
    return past;
  }

  emitChildren(0, tokens.length, "block");
  endLine();

  return lines.join("\n");
}

/**
 * The sections' HTML as Code mode shows it: the React markup above,
 * pretty-printed (see `formatHtml`) — newlines, two-space indents and
 * wrapped attributes, so the source reads like hand-written HTML.
 *
 * Deliberately wrapper-free: the theme (canvas custom properties) belongs to
 * the canvas that hosts this markup, so hand edits never have to preserve an
 * inline-style attribute to keep the page styled.
 */
export function sectionsHtml(sections: SalesSection[], iconSet: IconSetId): string {
  return formatHtml(renderSectionsHtml(sections, iconSet));
}
