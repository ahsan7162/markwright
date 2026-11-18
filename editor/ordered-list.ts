// @tiptap/extension-list 3.34's ordered-list tokenizer dedents an item's continuation
// lines by `indent + marker.length + 1`, forgetting the `.` or `)`. Every continuation
// line keeps one stray space, so a code block inside `1. ` gains a space on every save.
// This wraps the original tokenizer (keeping its list structure and nesting) and
// re-lexes each item's own content with the CommonMark content offset.
import { OrderedList } from "@tiptap/extension-list";
import type { MarkdownTokenizer } from "@tiptap/core";

interface ListToken {
  type?: string;
  raw?: string;
  ordered?: boolean;
  items?: ListToken[];
  tokens?: ListToken[];
}

// indent, marker (1 / a / iv), separator, then 1–4 spaces of padding (5+ means indented code)
const ITEM_START = /^([ \t]*)(\d+|[a-zA-Z]{1,2}|[ivxlcdmIVXLCDM]+)([.)])( {1,4}|$)/;

type Lexer = Parameters<MarkdownTokenizer["tokenize"]>[2] & { blockTokens(src: string): ListToken[] };

function relex(item: ListToken, lexer: Lexer) {
  const lines = (item.raw ?? "").split("\n");
  const match = ITEM_START.exec(lines[0] ?? "");
  if (!match) return;
  const offset = match[0].length;
  const body = [
    lines[0]!.slice(offset),
    ...lines.slice(1).map((line) => line.slice(Math.min(line.length - line.trimStart().length, offset))),
  ].join("\n");
  const last = item.tokens?.at(-1);
  const nested = last?.type === "list" && last.ordered ? [last] : [];
  // Inside a list marked returns `text` blocks; the original tokenizer emits `paragraph`
  // tokens, which are what @tiptap/markdown parses inline formatting in.
  const blocks = (body.trim() ? lexer.blockTokens(body) : []).map((token) => (token.type === "text" && token.tokens ? { ...token, type: "paragraph" } : token));
  item.tokens = [...blocks, ...nested];
  nested[0]?.items?.forEach((child) => relex(child, lexer));
}

const original = OrderedList.config.markdownTokenizer as MarkdownTokenizer;

export const FixedOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...original,
    tokenize(src, tokens, lexer) {
      const token = original.tokenize(src, tokens, lexer) as ListToken | undefined;
      token?.items?.forEach((item) => relex(item, lexer as Lexer));
      return token as ReturnType<MarkdownTokenizer["tokenize"]>;
    },
  },
});
