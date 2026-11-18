import { readdirSync, readFileSync } from "node:fs";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { contentNodes, openDocument, saveDocument, sharedCodec, type Baseline } from "../fidelity/document";
import { splitFile } from "../fidelity/text";

const dir = `${process.cwd()}/test/corpus/`;
const files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
const read = (name: string) => readFileSync(dir + name, "utf8");
const codec = sharedCodec();

function open(name: string) {
  const opened = openDocument(read(name));
  if (!opened.ok) throw new Error(`${name} gated: ${opened.reason}`);
  return { ...opened, doc: codec.parse(opened.body) };
}

function children(doc: PMNode): PMNode[] {
  const list: PMNode[] = [];
  doc.forEach((child) => list.push(child));
  return list;
}

const withChildren = (doc: PMNode, list: PMNode[]) => doc.type.create(doc.attrs, list);

/** Body offsets of the segment holding `doc`'s top-level child `node` (matched by position). */
function segmentRange(baseline: Baseline, doc: PMNode, node: PMNode): { start: number; end: number } {
  const index = contentNodes(doc).indexOf(node);
  if (index < 0) throw new Error("not a content node of doc");
  let offset = baseline.lead.length;
  let seen = 0;
  for (const segment of baseline.segments) {
    if (index < seen + segment.nodes.length) return { start: offset, end: offset + segment.raw.length };
    seen += segment.nodes.length;
    offset += segment.raw.length + segment.trail.length;
  }
  throw new Error("node not in a segment");
}

describe("eligibility gate", () => {
  it("opens at least 80% of real and synthetic files in rich mode", () => {
    const candidates = files.filter((name) => !name.startsWith("gated-"));
    const gated = candidates.filter((name) => !openDocument(read(name)).ok);
    const reasons = gated.map((name) => {
      const opened = openDocument(read(name));
      return `${name}: ${opened.ok ? "" : opened.reason}`;
    });
    expect(gated.length / candidates.length, reasons.join("\n")).toBeLessThanOrEqual(0.2);
    for (const name of candidates.filter((n) => n.startsWith("sample-") && n.includes("readme"))) {
      expect(openDocument(read(name)).ok, `${name} must open in rich mode`).toBe(true);
    }
  });

  it("names why a file is gated", () => {
    expect(openDocument(read("gated-footnote.md"))).toEqual({ ok: false, reason: "footnotes" });
    expect(openDocument(read("gated-reflinks.md"))).toEqual({ ok: false, reason: "reference-links" });
    expect(openDocument("x".repeat(700 * 1024))).toEqual({ ok: false, reason: "too-large" });
    expect(openDocument("Intro\n\n$$\nx^2\n$$\n")).toEqual({ ok: false, reason: "math" });
    expect(openDocument("import X from 'y'\n\n<X />\n")).toEqual({ ok: false, reason: "mdx" });
  });
});

const eligible = files.filter((name) => openDocument(read(name)).ok);

describe.each(eligible)("%s", (name) => {
  it("saves an unedited document byte-for-byte", () => {
    const { doc, baseline } = open(name);
    expect(saveDocument(doc, baseline)).toBe(read(name));
  });

  it("an edit to one paragraph changes only that block", () => {
    const { doc, baseline, body } = open(name);
    const list = children(doc);
    const index = list.findIndex((child) => child.type.name === "paragraph" && child.childCount > 0);
    if (index < 0) return;
    const target = list[index]!;
    const range = segmentRange(baseline, doc, target);
    list[index] = target.type.create(target.attrs, target.content.append(Fragment.from(codec.schema.text(" EDITED"))));
    const out = splitFile(saveDocument(withChildren(doc, list), baseline)).body;
    expect(out.startsWith(body.slice(0, range.start))).toBe(true);
    expect(out.endsWith(body.slice(range.end))).toBe(true);
    expect(out).toContain("EDITED");
  });

  it("inserting and deleting blocks keeps every other block's bytes", () => {
    const { doc, baseline, body } = open(name);
    const list = children(doc);
    const middle = Math.floor(list.length / 2);
    const inserted = [...list.slice(0, middle), codec.schema.nodes.paragraph!.create(null, codec.schema.text("NEW BLOCK")), ...list.slice(middle)];
    const out = splitFile(saveDocument(withChildren(doc, inserted), baseline)).body;
    expect(out).toContain("NEW BLOCK");
    expect(out.replace(/\n*NEW BLOCK\n*/, "\n\n").replace(/\n{3,}/g, "\n\n")).toBe(body.replace(/\n{3,}/g, "\n\n"));

    const last = list.length - 1;
    const removedRange = segmentRange(baseline, doc, list[last]!);
    const deleted = splitFile(saveDocument(withChildren(doc, list.slice(0, last)), baseline)).body;
    expect(deleted.trimEnd()).toBe(body.slice(0, removedRange.start).trimEnd());
  });

  it("edit then undo restores the original bytes", () => {
    const { doc, baseline } = open(name);
    const edited = withChildren(doc, [codec.schema.nodes.paragraph!.create(null, codec.schema.text("tmp")), ...children(doc)]);
    expect(saveDocument(edited, baseline)).not.toBe(read(name));
    expect(saveDocument(withChildren(edited, children(edited).slice(1)), baseline)).toBe(read(name));
  });
});

describe("constructs", () => {
  it("keeps callout markers unescaped when the callout is edited", () => {
    const { doc, baseline } = open("synth-callouts.md");
    const list = children(doc);
    const quote = list.findIndex((child) => child.type.name === "blockquote");
    const paragraph = list[quote]!.firstChild!;
    const editedQuote = list[quote]!.type.create(null, [
      paragraph.type.create(null, paragraph.content.append(Fragment.from(codec.schema.text(" more")))),
    ]);
    list[quote] = editedQuote;
    const out = saveDocument(withChildren(doc, list), baseline);
    expect(out).toContain("> [!NOTE]");
    expect(out).not.toContain("\\[");
  });

  it("preserves CRLF line endings after an edit", () => {
    const { doc, baseline } = open("synth-crlf.md");
    const out = saveDocument(withChildren(doc, [...children(doc), codec.schema.nodes.paragraph!.create(null, codec.schema.text("added"))]), baseline);
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(out).toContain("added\r\n");
  });

  it("keeps front matter byte-for-byte after an edit", () => {
    const { doc, baseline } = open("synth-frontmatter.md");
    const out = saveDocument(withChildren(doc, [...children(doc), codec.schema.nodes.paragraph!.create(null, codec.schema.text("added"))]), baseline);
    expect(out.startsWith("---\ntitle: Front matter doc\ntags: [a, b]\n---\n")).toBe(true);
  });

  it("keeps raw HTML as opaque atoms and writes it back verbatim", () => {
    const { doc, baseline } = open("synth-html.md");
    const types = new Set<string>();
    doc.descendants((node) => {
      types.add(node.type.name);
    });
    expect(types.has("rawHtmlBlock")).toBe(true);
    expect(types.has("rawHtmlInline")).toBe(true);
    const list = children(doc);
    const heading = list.findIndex((child) => child.type.name === "heading");
    list[heading] = list[heading]!.type.create(list[heading]!.attrs, codec.schema.text("Renamed project"));
    const out = saveDocument(withChildren(doc, list), baseline);
    expect(out).toBe(read("synth-html.md").replace("# Project", "# Renamed project"));
  });

  it("drops empty paragraphs instead of writing &nbsp;", () => {
    const { doc, baseline } = open("synth-styles.md");
    const out = saveDocument(withChildren(doc, [...children(doc), codec.schema.nodes.paragraph!.create(), codec.schema.nodes.paragraph!.create(null, codec.schema.text("end"))]), baseline);
    expect(out).not.toContain("&nbsp;");
    expect(out.trimEnd().endsWith("end")).toBe(true);
  });
});

describe("inline code spaces", () => {
  it("keeps a space at the edge of inline code when its paragraph is edited", () => {
    const text = "Type `# ` then a title, or `` ` `` for code, or ` padded ` text.\n\nNext.\n";
    const opened = openDocument(text);
    if (!opened.ok) throw new Error(opened.reason);
    const doc = codec.parse(opened.body);
    const list = children(doc);
    list[0] = list[0]!.type.create(null, list[0]!.content.append(Fragment.from(codec.schema.text(" EDITED"))));
    const out = saveDocument(withChildren(doc, list), opened.baseline);
    expect(out).toContain("`# `");
    expect(out).toContain("EDITED");
    const reopened = openDocument(out);
    expect(reopened.ok).toBe(true);
    const codesOf = (body: string) => {
      const codes: string[] = [];
      codec.parse(body).descendants((node) => {
        if (node.isText && node.marks.some((mark) => mark.type.name === "code")) codes.push(node.text!);
      });
      return codes;
    };
    // CommonMark strips one space from each side of ` padded `, so the file already means "padded".
    expect(codesOf(opened.body)).toEqual(["# ", "`", "padded"]);
    if (reopened.ok) expect(codesOf(reopened.body)).toEqual(codesOf(opened.body));
  });
});

describe("ordered lists", () => {
  it("keeps code inside numbered items exact through repeated saves", () => {
    const text = "1. Clone it:\n\n   ```bash\n   git clone x\n   ```\n\n2. Run **it**.\n";
    let current = text;
    for (let round = 0; round < 3; round += 1) {
      const opened = openDocument(current);
      if (!opened.ok) throw new Error(opened.reason);
      const doc = codec.parse(opened.body);
      let code = "";
      doc.descendants((node) => {
        if (node.type.name === "codeBlock") code = node.textContent;
      });
      expect(code).toBe("git clone x");
      const list = children(doc);
      list.push(codec.schema.nodes.paragraph!.create(null, codec.schema.text(`Round ${round}`)));
      current = saveDocument(withChildren(doc, list), opened.baseline);
      expect(current.startsWith(text)).toBe(true);
    }
  });
});
