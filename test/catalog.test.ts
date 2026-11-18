import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG, filterCatalog } from "../editor/catalog";
import { createExtensions } from "../editor/extensions";
import { contentNodes, createCodec, openDocument, saveDocument } from "../fidelity/document";

const START = "# Title\n\nIntro paragraph.\n";
let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function insertAtEnd(item: (typeof CATALOG)[number]) {
  editor = new Editor({ element: document.createElement("div"), extensions: createExtensions(), content: START, contentType: "markdown" });
  const codec = createCodec(editor);
  const opened = openDocument(START, codec);
  if (!opened.ok) throw new Error("start gated");
  const end = editor.state.doc.content.size;
  editor.chain().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run();
  item.run(editor, item.needs === "url" ? "./images/picture.png" : undefined);
  return { codec, text: saveDocument(editor.state.doc, opened.baseline, codec) };
}

describe.each(CATALOG.map((item) => [item.id, item] as const))("catalog block %s", (_id, item) => {
  it("saves, keeps the original blocks, and reopens in rich mode", () => {
    const { codec, text } = insertAtEnd(item);
    expect(text.startsWith("# Title\n\nIntro paragraph.\n")).toBe(true);
    expect(text).not.toContain("&nbsp;");
    const reopened = openDocument(text, codec);
    expect(reopened.ok, `${item.id} produced a file the gate refuses:\n${text}`).toBe(true);
    if (!reopened.ok) return;
    // The reopened document matches what the user saw, and saving it again changes nothing.
    const doc = codec.parse(reopened.body);
    expect(saveDocument(doc, reopened.baseline, codec)).toBe(text);
    expect(contentNodes(doc).length).toBeGreaterThanOrEqual(contentNodes(editor!.state.doc).length - 1);
  });
});

describe("specific blocks", () => {
  it("writes GitHub callouts without escaping the marker", () => {
    const { text } = insertAtEnd(CATALOG.find((item) => item.id === "callout-warning")!);
    expect(text).toContain("> [!WARNING]\n> Write here");
  });

  it("writes Mermaid templates as mermaid fences", () => {
    const { text } = insertAtEnd(CATALOG.find((item) => item.id === "mermaid-flowchart")!);
    expect(text).toMatch(/```mermaid\nflowchart TD\n/);
  });

  it("writes a 3×3 GFM table with a header row", () => {
    const { text } = insertAtEnd(CATALOG.find((item) => item.id === "table")!);
    expect(text).toMatch(/\|[^\n]*\|\n\| *-+ *\|/);
  });

  it("writes task lists as - [ ]", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: createExtensions(), content: "", contentType: "markdown" });
    CATALOG.find((item) => item.id === "checklist")!.run(editor);
    editor.commands.insertContent("buy milk");
    const codec = createCodec(editor);
    const opened = openDocument("", codec);
    if (!opened.ok) throw new Error("gated");
    expect(saveDocument(editor.state.doc, opened.baseline, codec)).toMatch(/^- \[ \] buy milk\n$/);
  });
});

describe("filterCatalog", () => {
  it("matches labels and aliases", () => {
    expect(filterCatalog("todo").map((item) => item.id)).toContain("checklist");
    expect(filterCatalog("diagram").some((item) => item.id.startsWith("mermaid-"))).toBe(true);
    expect(filterCatalog("warn").map((item) => item.id)).toContain("callout-warning");
    expect(filterCatalog("zzz")).toEqual([]);
  });
});
