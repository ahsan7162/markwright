// The one list of insertable blocks. The toolbar's Insert menu, the `/` menu and
// the `+` gutter button all read it, so a block added here appears everywhere.
import type { Editor } from "@tiptap/core";
import { createCodec } from "../fidelity/document";
import { DOCUMENT_TEMPLATES, fillTemplate } from "../templates/documents";

/** Markdown → nodes through the repaired codec (Tiptap's own parse rejects empty list items such as `- `). */
export function markdownNodes(editor: Editor, markdown: string) {
  return createCodec(editor).parse(markdown).toJSON().content ?? [];
}

export type CatalogGroup = "Text" | "Lists" | "Advanced" | "Diagrams" | "Callouts" | "Media" | "Templates";

export interface CatalogItem {
  id: string;
  label: string;
  /** Short glyph shown beside the label; no icon font needed. */
  glyph: string;
  group: CatalogGroup;
  aliases: string[];
  hint?: string;
  /** "image" asks for a URL first; everything else runs immediately. */
  needs?: "url";
  run(editor: Editor, value?: string): void;
}

export const MERMAID_TEMPLATES: { id: string; label: string; code: string }[] = [
  { id: "flowchart", label: "Flowchart", code: "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Ship it]\n  B -->|No| D[Fix]\n  D --> B" },
  { id: "sequence", label: "Sequence diagram", code: "sequenceDiagram\n  participant U as User\n  participant A as API\n  U->>A: Request\n  A-->>U: Response" },
  { id: "class", label: "Class diagram", code: "classDiagram\n  class Order {\n    +id: string\n    +total(): number\n  }\n  Customer \"1\" --> \"*\" Order" },
  { id: "state", label: "State diagram", code: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Published\n  Published --> [*]" },
  { id: "er", label: "Entity relationship", code: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains" },
  { id: "gantt", label: "Gantt chart", code: "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :a1, 2026-01-05, 5d\n  Build  :after a1, 10d" },
  { id: "pie", label: "Pie chart", code: "pie title Traffic\n  \"Search\" : 60\n  \"Direct\" : 30\n  \"Social\" : 10" },
  { id: "mindmap", label: "Mind map", code: "mindmap\n  root((Idea))\n    Goals\n    Risks\n    Next steps" },
];

export const CALLOUTS = [
  { id: "note", label: "Note", glyph: "ⓘ" },
  { id: "tip", label: "Tip", glyph: "✦" },
  { id: "important", label: "Important", glyph: "❢" },
  { id: "warning", label: "Warning", glyph: "⚠" },
  { id: "caution", label: "Caution", glyph: "⛔" },
] as const;

function insertCallout(editor: Editor, type: string) {
  // Same shape @tiptap/markdown parses `> [!NOTE]\n> text` into, so it round-trips.
  editor
    .chain()
    .focus()
    .insertContent({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: `[!${type.toUpperCase()}]\nWrite here` }] }],
    })
    .run();
}

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): CatalogItem => ({
  id: `h${level}`,
  label: `Heading ${level}`,
  glyph: `H${level}`,
  group: "Text",
  aliases: [`h${level}`, "heading", "title"],
  hint: "#".repeat(level),
  run: (editor) => editor.chain().focus().setHeading({ level }).run(),
});

export const CATALOG: CatalogItem[] = [
  { id: "text", label: "Text", glyph: "¶", group: "Text", aliases: ["paragraph", "plain", "p"], run: (e) => e.chain().focus().setParagraph().run() },
  heading(1),
  heading(2),
  heading(3),
  heading(4),
  heading(5),
  heading(6),
  { id: "quote", label: "Quote", glyph: "❝", group: "Text", aliases: ["blockquote", "citation"], hint: ">", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "divider", label: "Divider", glyph: "—", group: "Text", aliases: ["hr", "rule", "separator", "line"], hint: "---", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: "bullet", label: "Bulleted list", glyph: "•", group: "Lists", aliases: ["ul", "unordered", "list"], hint: "-", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "numbered", label: "Numbered list", glyph: "1.", group: "Lists", aliases: ["ol", "ordered"], hint: "1.", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "checklist", label: "Checklist", glyph: "☑", group: "Lists", aliases: ["todo", "task", "checkbox"], hint: "[ ]", run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "table", label: "Table", glyph: "⊞", group: "Advanced", aliases: ["grid", "columns", "rows"], run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "code", label: "Code block", glyph: "</>", group: "Advanced", aliases: ["snippet", "pre", "fence"], hint: "```", run: (e) => e.chain().focus().setCodeBlock().run() },
  ...MERMAID_TEMPLATES.map<CatalogItem>((template) => ({
    id: `mermaid-${template.id}`,
    label: template.label,
    glyph: "◇",
    group: "Diagrams",
    aliases: ["mermaid", "diagram", "chart", "graph", template.id],
    run: (e) => e.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: template.code }] }).run(),
  })),
  ...CALLOUTS.map<CatalogItem>((callout) => ({
    id: `callout-${callout.id}`,
    label: `${callout.label} callout`,
    glyph: callout.glyph,
    group: "Callouts",
    aliases: ["callout", "alert", "admonition", callout.id],
    run: (e) => insertCallout(e, callout.id),
  })),
  {
    id: "image",
    label: "Image",
    glyph: "▣",
    group: "Media",
    aliases: ["img", "picture", "photo"],
    needs: "url",
    run: (e, url) => {
      if (url) e.chain().focus().setImage({ src: url, alt: "" }).run();
    },
  },
  ...DOCUMENT_TEMPLATES.map<CatalogItem>((template) => ({
    id: `template-${template.id}`,
    label: template.label,
    glyph: "▤",
    group: "Templates",
    aliases: ["template", template.id, ...template.label.toLowerCase().split(/\W+/)],
    hint: "template",
    run: (e) => e.chain().focus().insertContent(markdownNodes(e, fillTemplate(template.markdown))).run(),
  })),
];

export const GROUP_ORDER: CatalogGroup[] = ["Text", "Lists", "Advanced", "Diagrams", "Callouts", "Media", "Templates"];

/** Substring match on label and aliases; empty query lists everything. */
export function filterCatalog(query: string, items: CatalogItem[] = CATALOG): CatalogItem[] {
  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((item) => item.label.toLowerCase().includes(q) || item.aliases.some((alias) => alias.includes(q))) : items;
  return [...matches].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}
