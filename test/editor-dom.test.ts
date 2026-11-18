import { readFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "../editor/extensions";
import { createCodec, openDocument, saveDocument } from "../fidelity/document";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(text: string, options: Parameters<typeof createExtensions>[0] = {}) {
  editor = new Editor({ element: document.createElement("div"), extensions: createExtensions(options), content: "" });
  const codec = createCodec(editor);
  const opened = openDocument(text, codec);
  if (!opened.ok) throw new Error(opened.reason);
  editor.commands.setContent(opened.doc.toJSON());
  return { editor, codec, opened };
}

describe("images", () => {
  it("copy/paste keeps the path written in the file, not the display URL", () => {
    const { editor: e } = mount("![Diagram](docs/canvas.png)\n", { resolveImageSrc: (src) => `http://127.0.0.1/preview/abc/${src}` });
    const html = e.getHTML();
    expect(html).toContain('src="http://127.0.0.1/preview/abc/docs/canvas.png"');
    expect(html).toContain('data-bbmd-src="docs/canvas.png"');
    e.commands.setContent(html); // what a paste of copied HTML does
    let src: unknown = null;
    e.state.doc.descendants((node) => {
      if (node.type.name === "image") src = node.attrs.src;
    });
    expect(src).toBe("docs/canvas.png");
  });
});

describe("links", () => {
  it("keeps every link scheme through an edit, and never renders javascript: live", () => {
    const text = readFileSync(`${process.cwd()}/test/corpus/synth-links.md`, "utf8");
    const { editor: e, codec, opened } = mount(text);
    expect(e.view.dom.innerHTML).not.toContain("javascript:");
    const list: PMNode[] = [];
    e.state.doc.forEach((child) => list.push(child));
    const paragraph = list[1]!;
    list[1] = paragraph.type.create(null, paragraph.content.append(Fragment.from(codec.schema.text(" More."))));
    const out = saveDocument(e.state.doc.type.create(null, list), opened.baseline, codec);
    for (const href of ["tel:123", "vscode://file/x", "ftp://h/f", "javascript:alert(1)", "./other.md#intro", "https://x.dev"]) {
      expect(out).toContain(`(${href})`);
    }
    expect(out).toContain("More.");
    expect(out.endsWith("Second paragraph.\n")).toBe(true);
  });
});
