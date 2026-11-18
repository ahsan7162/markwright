// Raw HTML found in a Markdown file is kept as an opaque atom that is shown
// as source, never executed, and written back byte-for-byte. @tiptap/markdown
// would otherwise run it through the schema's parseHTML rules, which drops
// anything the schema has no node for (`<p align>`, `<img width>`, comments).
import { mergeAttributes, Node } from "@tiptap/core";

// Inline tags and comments. A tag name must be followed by whitespace, `/` or
// `>`, so autolinks such as <https://x.dev> and <a@b.dev> are left to marked.
const INLINE_HTML =
  /^(?:<!--[\s\S]*?-->|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>)/;

function rawAttr(attribute: string) {
  return {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute(attribute) ?? "",
    renderHTML: (attrs: Record<string, unknown>) => ({ [attribute]: attrs.raw }),
  };
}

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { raw: rawAttr("data-bbmd-raw-html") };
  },
  parseHTML() {
    return [{ tag: "pre[data-bbmd-raw-html]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["pre", mergeAttributes(HTMLAttributes, { class: "bbmd-raw-html" }), String(node.attrs.raw)];
  },
  markdownTokenName: "html",
  parseMarkdown: (token, helpers) => {
    if (!token.block) return []; // declines: inline html is claimed by RawHtmlInline's tokenizer
    const raw = String(token.raw ?? token.text ?? "").replace(/\n+$/, "");
    return raw.trim() ? helpers.createNode("rawHtmlBlock", { raw }) : [];
  },
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});

export const RawHtmlInline = Node.create({
  name: "rawHtmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: rawAttr("data-bbmd-raw-html-inline") };
  },
  parseHTML() {
    return [{ tag: "code[data-bbmd-raw-html-inline]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["code", mergeAttributes(HTMLAttributes, { class: "bbmd-raw-html-inline" }), String(node.attrs.raw)];
  },
  markdownTokenName: "rawHtmlInline",
  markdownTokenizer: {
    name: "rawHtmlInline",
    level: "inline",
    start: (src: string) => src.indexOf("<"),
    tokenize: (src: string) => {
      const match = INLINE_HTML.exec(src);
      return match ? { type: "rawHtmlInline", raw: match[0], text: match[0] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("rawHtmlInline", { raw: String(token.raw ?? "") }),
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});
