import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";

const BLOCK_TYPES = [
  { value: "paragraph", label: "Text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
  { value: "codeBlock", label: "Code block" },
] as const;

function currentBlock(editor: Editor): string {
  for (let level = 1; level <= 6; level += 1) if (editor.isActive("heading", { level })) return `h${level}`;
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

function setBlock(editor: Editor, value: string) {
  const chain = editor.chain().focus();
  if (value === "paragraph") chain.setParagraph().run();
  else if (value === "codeBlock") chain.setCodeBlock().run();
  else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
}

export function Toolbar(props: { editor: Editor; onLink(): void; onInsert(anchor: HTMLElement): void; onImage(anchor: HTMLElement): void }) {
  const { editor } = props;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: currentBlock(e),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const button = (label: string, title: string, active: boolean | null, run: () => void, className = "", disabled = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={`h-7 min-w-7 rounded px-1.5 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-40 aria-pressed:bg-state-active aria-pressed:text-foreground ${className}`}
    >
      {label}
    </button>
  );
  const divider = <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
  const chain = () => editor.chain().focus();

  return (
    <div className="border-b border-border">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 px-3 py-1.5">
        <select
          aria-label="Block type"
          value={state.block}
          onChange={(event) => setBlock(editor, event.target.value)}
          className="h-7 rounded border border-border bg-transparent px-1.5 text-sm"
        >
          {BLOCK_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        {divider}
        {button("B", "Bold (⌘B)", state.bold, () => chain().toggleBold().run(), "font-bold")}
        {button("I", "Italic (⌘I)", state.italic, () => chain().toggleItalic().run(), "italic")}
        {button("S", "Strikethrough (⌘⇧X)", state.strike, () => chain().toggleStrike().run(), "line-through")}
        {button("<>", "Inline code (⌘E)", state.code, () => chain().toggleCode().run(), "font-mono text-xs")}
        {button("🔗", "Link (⌘K)", state.link, props.onLink)}
        {divider}
        {button("•", "Bulleted list", state.bullet, () => chain().toggleBulletList().run())}
        {button("1.", "Numbered list", state.ordered, () => chain().toggleOrderedList().run())}
        {button("☑", "Checklist", state.task, () => chain().toggleTaskList().run())}
        {button("❝", "Quote", state.quote, () => chain().toggleBlockquote().run())}
        {divider}
        {button("⊞ Table", "Insert table", null, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        <button
          type="button"
          title="Insert image"
          aria-label="Insert image"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => props.onImage(event.currentTarget)}
          className="h-7 rounded px-1.5 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          ▣ Image
        </button>
        <button
          type="button"
          title="Insert a block, diagram, callout or template"
          aria-label="Insert"
          aria-haspopup="listbox"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => props.onInsert(event.currentTarget)}
          className="h-7 rounded px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          + Insert
        </button>
        <span className="flex-1" />
        {button("↶", "Undo (⌘Z)", null, () => chain().undo().run(), "", !state.canUndo)}
        {button("↷", "Redo (⌘⇧Z)", null, () => chain().redo().run(), "", !state.canRedo)}
      </div>
      {state.table ? (
        <div role="toolbar" aria-label="Table" className="flex flex-wrap items-center gap-0.5 border-t border-border px-3 py-1 text-xs">
          <span className="mr-1 text-muted-foreground">Table</span>
          {button("Row ↑", "Insert row above", null, () => chain().addRowBefore().run(), "text-xs")}
          {button("Row ↓", "Insert row below", null, () => chain().addRowAfter().run(), "text-xs")}
          {button("Col ←", "Insert column left", null, () => chain().addColumnBefore().run(), "text-xs")}
          {button("Col →", "Insert column right", null, () => chain().addColumnAfter().run(), "text-xs")}
          {divider}
          {button("Delete row", "Delete row", null, () => chain().deleteRow().run(), "text-xs")}
          {button("Delete column", "Delete column", null, () => chain().deleteColumn().run(), "text-xs")}
          {button("Delete table", "Delete table", null, () => chain().deleteTable().run(), "text-xs text-destructive")}
        </div>
      ) : null}
    </div>
  );
}
