// Open and save a Markdown file so that a save changes only the blocks the user
// edited. The approach follows Orca's rich-markdown editor (MIT, stablyai/orca):
//   1. unchanged document  → write the original bytes;
//   2. otherwise           → keep the original source of every untouched top-level
//                            block, serialize only new or edited blocks, and accept
//                            the result only if it re-parses to the same document;
//   3. if that proof fails → write the canonical serialization.
// Files whose constructs the editor can't round-trip are refused ("gated") and
// shown read-only by the caller.
import { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { createExtensions } from "../editor/extensions";
import { joinFile, splitFile, type FileParts } from "./text";

export const MAX_RICH_BYTES = 600 * 1024;

export type GateReason =
  | "too-large"
  | "unparseable"
  | "reference-links"
  | "footnotes"
  | "math"
  | "mdx"
  | "structure"
  | "unstable";

export const GATE_MESSAGES: Record<GateReason, string> = {
  "too-large": "this file is larger than 600 KB",
  unparseable: "the Markdown parser couldn't map this file back to its source",
  "reference-links": "this file uses reference-style links",
  footnotes: "this file has footnotes",
  math: "this file has $$ math blocks",
  mdx: "this file contains MDX/JSX",
  structure: "the editor couldn't map every block back to the source",
  unstable: "a block in this file can't be saved back without changing it",
};

interface LexToken {
  type: string;
  raw: string;
}

export interface MarkdownCodec {
  schema: Schema;
  lex(src: string): { tokens: LexToken[]; links: Record<string, unknown> };
  parse(markdown: string): PMNode;
  serialize(nodes: readonly PMNode[]): string;
}

export function createCodec(editor: Editor): MarkdownCodec {
  const manager = editor.markdown;
  if (!manager) throw new Error("The Markdown extension is not installed on this editor");
  const marked = manager.instance;
  return {
    schema: editor.schema,
    lex(src) {
      // The same lexer construction @tiptap/markdown uses in MarkdownManager.parse.
      const list = new marked.Lexer(marked.defaults).lex(src);
      return { tokens: [...list] as LexToken[], links: (list as { links?: Record<string, unknown> }).links ?? {} };
    },
    parse: (markdown) => editor.schema.nodeFromJSON(repairJson(manager.parse(markdown), editor.schema)),
    serialize: (nodes) => manager.serialize({ type: "doc", content: nodes.map((node) => protectCodeSpaces(node.toJSON())) }),
  };
}

type Json = ReturnType<PMNode["toJSON"]>;

/** A CommonMark code span holding `text` exactly: a longer fence than any backtick run, padded when needed. */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (/^ /.test(text) && / $/.test(text) && text.trim() !== "") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

// @tiptap/markdown moves whitespace at a mark's edges outside the mark, which is right
// for `**bold **` but changes a code span: `# ` would be written as `#` plus a space.
// For serialization only, write such code text through the verbatim raw-inline node.
function protectCodeSpaces(json: Json): Json {
  if (json.type === "text" && /^\s|\s$/.test(json.text ?? "") && json.marks?.some((mark: { type: string }) => mark.type === "code")) {
    const marks = json.marks.filter((mark: { type: string }) => mark.type !== "code");
    return { type: "rawHtmlInline", attrs: { raw: codeSpan(json.text) }, ...(marks.length ? { marks } : {}) };
  }
  return Array.isArray(json.content) ? { ...json, content: json.content.map(protectCodeSpaces) } : json;
}

// `- ` or `1. ` with nothing after it parses to a listItem with no content, which
// the schema rejects. Fill any required-but-empty content with the schema's minimum
// (an empty paragraph), the same thing a user sees in the editor.
// @tiptap/markdown also unwraps an image-only paragraph into a bare inline image under
// `doc`; wrap such inline runs back into a paragraph, as Markdown means them.
function repairJson(json: Json, schema: Schema): Json {
  const type = schema.nodes[json.type as string];
  let children: Json[] | undefined = Array.isArray(json.content) ? json.content.map((child: Json) => repairJson(child, schema)) : json.content;
  if (children && type && !type.inlineContent) {
    const wrapped: Json[] = [];
    for (const child of children) {
      const inline = schema.nodes[child.type as string]?.isInline;
      const last = wrapped[wrapped.length - 1];
      if (!inline) wrapped.push(child);
      else if (last?.type === "paragraph" && last.bbmdWrapped) last.content.push(child);
      else wrapped.push({ type: "paragraph", content: [child], bbmdWrapped: true });
    }
    children = wrapped.map(({ bbmdWrapped: _wrapped, ...rest }) => rest);
  }
  const repaired = { ...json, content: children };
  if (type && !type.isLeaf && (!children || children.length === 0) && !type.contentMatch.matchFragment(Fragment.empty)?.validEnd) {
    const filled = type.createAndFill(json.attrs ?? null);
    if (filled) repaired.content = (filled.toJSON() as Json).content;
  }
  return repaired;
}

let shared: MarkdownCodec | null = null;
/** A headless editor's codec, built once. Parsing never touches a visible editor. */
export function sharedCodec(): MarkdownCodec {
  shared ??= createCodec(new Editor({ element: null, extensions: createExtensions() }));
  return shared;
}

interface Segment {
  /** The block's original source, as marked sliced it. */
  raw: string;
  /** Blank lines (and node-less tokens) that followed it in the file. */
  trail: string;
  nodes: PMNode[];
}

export interface Baseline {
  parts: Omit<FileParts, "body">;
  original: string;
  lead: string;
  segments: Segment[];
  canonical: string;
  endsWithNewline: boolean;
}

export type Opened =
  /** `doc` is the parsed body; load the editor from `doc.toJSON()` so it holds exactly this document. */
  | { ok: true; body: string; frontMatter: string; baseline: Baseline; doc: PMNode }
  | { ok: false; reason: GateReason };

// Blocks that mean something even with no text.
const MEANINGFUL_WHEN_EMPTY = new Set(["horizontalRule", "table", "codeBlock", "rawHtmlBlock", "heading"]);

/**
 * Empty paragraphs, and quotes or lists holding only empty paragraphs, carry no
 * Markdown (they'd be written as `&nbsp;`, `>` or `1. `). The user sees them while
 * typing; the file never gets them.
 */
function isContent(node: PMNode): boolean {
  if (node.isAtom || MEANINGFUL_WHEN_EMPTY.has(node.type.name) || node.textContent.length > 0) return true;
  let hasAtom = false;
  node.descendants((child) => {
    if (child.isAtom && child.type.name !== "hardBreak") hasAtom = true;
    return !hasAtom;
  });
  return hasAtom;
}

export function contentNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.forEach((node) => {
    if (isContent(node)) nodes.push(node);
  });
  return nodes;
}

function sameNodes(a: readonly PMNode[], b: readonly PMNode[]): boolean {
  return a.length === b.length && a.every((node, index) => node.eq(b[index]!));
}

// Whitespace that renders the same is compared away: around a soft line break (the
// parser keeps "Live\n data" from an indented list continuation, the serializer writes
// "Live\ndata"), and at the start or end of a paragraph or heading. Code text keeps
// its spaces: they are content.
const isPlainText = (json: Json | undefined) => json?.type === "text" && !json.marks?.some((mark: { type: string }) => mark.type === "code");

function normalizedJson(json: Json): Json {
  const copy = { ...json };
  if (typeof copy.text === "string" && isPlainText(copy)) copy.text = copy.text.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  if (Array.isArray(copy.content)) {
    let content: Json[] = copy.content.map(normalizedJson);
    if (copy.type === "paragraph" || copy.type === "heading") {
      if (isPlainText(content[0])) content[0] = { ...content[0], text: content[0].text.replace(/^[ \t]+/, "") };
      const last = content.length - 1;
      if (isPlainText(content[last])) content[last] = { ...content[last], text: content[last].text.replace(/[ \t]+$/, "") };
      content = content.filter((child) => !(child.type === "text" && child.text === ""));
    }
    copy.content = content;
  }
  return copy;
}

function equivalent(a: readonly PMNode[], b: readonly PMNode[]): boolean {
  return (
    a.length === b.length &&
    a.every((node, index) => node.eq(b[index]!) || JSON.stringify(normalizedJson(node.toJSON())) === JSON.stringify(normalizedJson(b[index]!.toJSON())))
  );
}

/** Text with inline code spans removed: a run of N backticks closes only on another run of exactly N. */
function withoutCodeSpans(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      out += text[i];
      i += 1;
      continue;
    }
    let j = i;
    while (text[j] === "`") j += 1;
    const run = text.slice(i, j);
    let close = text.indexOf(run, j);
    while (close >= 0 && (text[close - 1] === "`" || text[close + run.length] === "`")) close = text.indexOf(run, close + 1);
    if (close < 0) {
      out += run;
      i = j;
    } else {
      i = close + run.length;
    }
  }
  return out;
}

function utf8Length(text: string): number {
  return text.length * 3 <= MAX_RICH_BYTES ? text.length : new TextEncoder().encode(text).length;
}

function unsupportedReason(tokens: LexToken[], links: Record<string, unknown>): GateReason | null {
  if (Object.keys(links).length > 0 || tokens.some((token) => token.type === "def")) return "reference-links";
  const prose = withoutCodeSpans(
    tokens
      .filter((token) => token.type !== "code")
      .map((token) => token.raw)
      .join(""),
  );
  if (/^ {0,3}\[\^[^\]\s]+\]:/m.test(prose)) return "footnotes";
  if (/^ {0,3}\$\$/m.test(prose)) return "math";
  if (/^(?:import|export)\s/m.test(prose) || /<[A-Z][A-Za-z0-9]*[\s/>]/.test(prose)) return "mdx";
  return null;
}

export function openDocument(text: string, codec: MarkdownCodec = sharedCodec()): Opened {
  if (utf8Length(text) > MAX_RICH_BYTES) return { ok: false, reason: "too-large" };
  const parts = splitFile(text);
  const { tokens, links } = codec.lex(parts.body);
  if (tokens.map((token) => token.raw).join("") !== parts.body) return { ok: false, reason: "unparseable" };
  const unsupported = unsupportedReason(tokens, links);
  if (unsupported) return { ok: false, reason: unsupported };

  let lead = "";
  const segments: Segment[] = [];
  for (const token of tokens) {
    const nodes = token.type === "space" ? [] : contentNodes(codec.parse(token.raw));
    const last = segments[segments.length - 1];
    if (nodes.length === 0) {
      if (last) last.trail += token.raw;
      else lead += token.raw;
    } else {
      segments.push({ raw: token.raw, trail: "", nodes });
    }
  }

  const doc = codec.parse(parts.body);
  const docNodes = contentNodes(doc);
  if (!sameNodes(segments.flatMap((segment) => segment.nodes), docNodes)) return { ok: false, reason: "structure" };
  // Every block must survive serialize → parse, or editing it would lose content.
  for (const segment of segments) {
    if (!equivalent(contentNodes(codec.parse(serializeBlocks(segment.nodes, codec))), segment.nodes)) {
      return { ok: false, reason: "unstable" };
    }
  }

  const { body: _body, ...rest } = parts;
  return {
    ok: true,
    body: parts.body,
    frontMatter: parts.frontMatter,
    doc,
    baseline: {
      parts: rest,
      original: text,
      lead,
      segments,
      canonical: codec.serialize(docNodes),
      endsWithNewline: parts.body === "" || parts.body.endsWith("\n"),
    },
  };
}

/** The full file text for `doc`. Untouched blocks keep their original bytes. */
export function saveDocument(doc: PMNode, baseline: Baseline, codec: MarkdownCodec = sharedCodec()): string {
  const current = contentNodes(doc);
  if (codec.serialize(current) === baseline.canonical) return baseline.original;
  const body = reuseBlocks(current, baseline, codec) ?? canonicalBody(current, baseline, codec);
  return joinFile(baseline.parts, body);
}

function canonicalBody(current: PMNode[], baseline: Baseline, codec: MarkdownCodec): string {
  const cleaned = withNewline(serializeBlocks(current, codec), baseline.endsWithNewline);
  if (equivalent(contentNodes(codec.parse(cleaned)), current)) return cleaned;
  return withNewline(codec.serialize(current), baseline.endsWithNewline);
}

function withNewline(text: string, endsWithNewline: boolean): string {
  return text.replace(/\n*$/, endsWithNewline ? "\n" : "");
}

function blankLineAfter(text: string): string {
  return text.replace(/\n*$/, "\n\n");
}

function reuseBlocks(current: PMNode[], baseline: Baseline, codec: MarkdownCodec): string | null {
  const { segments } = baseline;
  const original = segments.flatMap((segment, si) => segment.nodes.map((node, ni) => ({ node, si, ni })));
  const curToOrig = matchNodes(
    original.map((entry) => entry.node),
    current,
  );
  const origToCur = new Array<number>(original.length).fill(-1);
  curToOrig.forEach((o, c) => {
    if (o >= 0) origToCur[o] = c;
  });

  // A segment is intact when all of its nodes survived, in order, next to each other.
  const intact: boolean[] = [];
  let offset = 0;
  for (const segment of segments) {
    const first = origToCur[offset]!;
    intact.push(first >= 0 && segment.nodes.every((_, k) => origToCur[offset + k] === first + k));
    offset += segment.nodes.length;
  }

  type Piece = { seg: number } | { nodes: PMNode[] };
  const pieces: Piece[] = [];
  let run: PMNode[] = [];
  for (let c = 0; c < current.length; ) {
    const o = curToOrig[c]!;
    const entry = o >= 0 ? original[o] : undefined;
    if (entry && entry.ni === 0 && intact[entry.si]) {
      if (run.length) pieces.push({ nodes: run });
      run = [];
      pieces.push({ seg: entry.si });
      c += segments[entry.si]!.nodes.length;
    } else {
      run.push(current[c]!);
      c += 1;
    }
  }
  if (run.length) pieces.push({ nodes: run });

  let out = baseline.lead;
  pieces.forEach((piece, index) => {
    const next = pieces[index + 1];
    if ("seg" in piece) {
      const segment = segments[piece.seg]!;
      out += segment.raw + segment.trail;
      const keepsOriginalNeighbour = next ? "seg" in next && next.seg === piece.seg + 1 : piece.seg === segments.length - 1;
      if (!keepsOriginalNeighbour) out = next ? blankLineAfter(out) : withNewline(out, baseline.endsWithNewline);
    } else {
      out += serializeBlocks(piece.nodes, codec);
      out = next ? blankLineAfter(out) : withNewline(out, baseline.endsWithNewline);
    }
  });

  return equivalent(contentNodes(codec.parse(out)), current) ? out : null;
}

/** Serialize blocks one at a time, dropping escapes the parser doesn't need. */
function serializeBlocks(nodes: readonly PMNode[], codec: MarkdownCodec): string {
  return nodes.map((node) => removeNeedlessEscapes(codec.serialize([node]).replace(/\n+$/, ""), node, codec)).join("\n\n");
}

const ESCAPE = /\\([[\]_*~`])/g;
const MAX_ESCAPE_TRIES = 40;

// @tiptap/markdown escapes `[`, `]`, `_` … defensively (`> \[!NOTE\]`, `PLUGIN\_OVERVIEW`).
// Remove an escape only when the block still parses to the same node without it.
function removeNeedlessEscapes(markdown: string, node: PMNode, codec: MarkdownCodec): string {
  if (!markdown.includes("\\")) return markdown;
  const keeps = (candidate: string) => equivalent(contentNodes(codec.parse(candidate)), [node]);
  const all = markdown.replace(ESCAPE, "$1");
  if (all !== markdown && keeps(all)) return all;
  let out = markdown;
  let from = 0;
  for (let tries = 0; tries < MAX_ESCAPE_TRIES; tries += 1) {
    ESCAPE.lastIndex = from;
    const match = ESCAPE.exec(out);
    if (!match) break;
    const candidate = out.slice(0, match.index) + out.slice(match.index + 1);
    if (keeps(candidate)) {
      out = candidate;
      from = match.index + 1;
    } else {
      from = match.index + 2;
    }
  }
  return out;
}

/**
 * For each current node, the index of the equal original node it continues, or -1.
 * Longest common subsequence after trimming the shared prefix and suffix, which is
 * where nearly all of a typical edit's blocks are.
 */
function matchNodes(original: readonly PMNode[], current: readonly PMNode[]): number[] {
  const result = new Array<number>(current.length).fill(-1);
  let start = 0;
  while (start < original.length && start < current.length && original[start]!.eq(current[start]!)) {
    result[start] = start;
    start += 1;
  }
  let endO = original.length;
  let endC = current.length;
  while (endO > start && endC > start && original[endO - 1]!.eq(current[endC - 1]!)) {
    endO -= 1;
    endC -= 1;
    result[endC] = endO;
  }
  const n = endO - start;
  const m = endC - start;
  if (n === 0 || m === 0) return result;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = original[start + i]!.eq(current[start + j]!)
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (original[start + i]!.eq(current[start + j]!)) {
      result[start + j] = start + i;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}
