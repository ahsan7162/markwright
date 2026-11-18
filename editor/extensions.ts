// The one Tiptap extension list, shared by the editor and the fidelity tests so
// both parse and serialize Markdown exactly the same way.
import type { AnyExtension, NodeViewRenderer } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { FixedOrderedList } from "./ordered-list";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { RawHtmlBlock, RawHtmlInline } from "./nodes/raw-html";
import { Callouts } from "./callouts";

export const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown, php, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
});
lowlight.registerAlias({ bash: ["sh", "zsh"], javascript: ["js", "jsx"], typescript: ["ts", "tsx"], xml: ["html"], yaml: ["yml"], ini: ["toml"] });

/** http(s), mailto, in-page anchors and relative paths; never javascript:, data:, etc. */
export function isAllowedUri(url: string): boolean {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed); // no scheme → anchor or relative path
}

export interface ExtensionOptions {
  placeholder?: string;
  /** Visible editor only: React node view for code blocks (language picker, Mermaid preview). */
  codeBlockView?: NodeViewRenderer;
  /** Visible editor only: map a Markdown image src (often relative) to a URL the browser can load. */
  resolveImageSrc?: (src: string) => string;
}

// Rendering-only options never change the schema, so the headless codec and the
// visible editor parse and serialize identically.
export function createExtensions(options: ExtensionOptions = {}): AnyExtension[] {
  const { codeBlockView, resolveImageSrc } = options;
  const codeBlock = codeBlockView ? CodeBlockLowlight.extend({ addNodeView: () => codeBlockView }) : CodeBlockLowlight;
  // The DOM shows a loadable URL, but copy/paste must carry the path written in the
  // file, or a cut-and-paste would save a short-lived preview URL into the Markdown.
  const image = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-bbmd-src") ?? element.getAttribute("src"),
          renderHTML: (attrs: Record<string, unknown>) => {
            const src = String(attrs.src ?? "");
            return { src: resolveImageSrc ? resolveImageSrc(src) : src, "data-bbmd-src": src };
          },
        },
      };
    },
  });
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by CodeBlockLowlight
      underline: false, // Markdown has no underline syntax
      trailingNode: false, // an extra empty paragraph would change the saved file
      orderedList: false, // replaced by FixedOrderedList
      // Tiptap's default scheme allowlist (blocks javascript:, keeps tel:, ftp: …) decides which hrefs render live.
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    codeBlock.configure({ lowlight, defaultLanguage: null }),
    FixedOrderedList, // see ./ordered-list.ts
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    image.configure({ inline: true }),
    RawHtmlBlock,
    RawHtmlInline,
    Callouts,
    Placeholder.configure({ placeholder: options.placeholder ?? "Type / for blocks" }),
    Markdown.configure({ indentation: { style: "space", size: 2 }, markedOptions: { gfm: true } }),
  ];
}
