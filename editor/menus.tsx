// Menus and popovers drawn inside the editor's own container (no portals), so
// they stay inside the plugin root and pick up its styles.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { GROUP_ORDER, type CatalogItem } from "./catalog";

export interface Anchor {
  x: number;
  y: number;
}

/** `/query` typed at the start of a block or after a space, outside code. */
export function detectSlash(editor: Editor): { from: number; to: number; query: string } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = /(?:^|\s)\/([\w-]{0,30})$/.exec(before);
  if (!match) return null;
  const query = match[1]!;
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

/** Viewport coordinates of a document position, relative to `container`. */
export function anchorAt(editor: Editor, pos: number, container: HTMLElement | null, below = true): Anchor | null {
  if (!container) return null;
  try {
    const coords = editor.view.coordsAtPos(pos);
    const box = container.getBoundingClientRect();
    return { x: coords.left - box.left, y: (below ? coords.bottom + 6 : coords.top - 6) - box.top };
  } catch {
    return null;
  }
}

function floating(anchor: Anchor, above = false): CSSProperties {
  return { position: "absolute", left: Math.max(0, anchor.x), top: anchor.y, zIndex: 30, transform: above ? "translateY(-100%)" : undefined };
}

export function CatalogMenu(props: {
  anchor: Anchor;
  items: CatalogItem[];
  index: number;
  onHover(index: number): void;
  onChoose(item: CatalogItem): void;
  query?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${props.index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [props.index]);
  const rows: ReactNode[] = [];
  let group: string | null = null;
  props.items.forEach((item, index) => {
    if (item.group !== group) {
      group = item.group;
      rows.push(
        <div key={`g-${group}`} className="bbmd-menu-group" role="presentation">
          {group}
        </div>,
      );
    }
    rows.push(
      <button
        key={item.id}
        type="button"
        role="option"
        data-index={index}
        aria-selected={index === props.index}
        className="bbmd-menu-item"
        onMouseEnter={() => props.onHover(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => props.onChoose(item)}
      >
        <span aria-hidden className="w-6 text-center text-muted-foreground">
          {item.glyph}
        </span>
        {item.label}
        {item.hint ? <small>{item.hint}</small> : null}
      </button>,
    );
  });
  return (
    <div ref={list} className="bbmd-menu" role="listbox" aria-label="Insert block" style={floating(props.anchor)}>
      {rows.length ? rows : <div className="px-2 py-1.5 text-muted-foreground">No block matches “{props.query}”</div>}
    </div>
  );
}

export function sortedByGroup(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export function UrlPrompt(props: {
  anchor: Anchor;
  label: string;
  initial: string;
  placeholder: string;
  validate(url: string): string | null;
  onSubmit(url: string): void;
  onRemove?: () => void;
  onClose(): void;
}) {
  const [value, setValue] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="bbmd-menu flex items-center gap-2"
      style={{ ...floating(props.anchor), minWidth: 320 }}
      onSubmit={(event) => {
        event.preventDefault();
        const problem = props.validate(value.trim());
        if (problem) setError(problem);
        else props.onSubmit(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <label className="sr-only" htmlFor="bbmd-url">
        {props.label}
      </label>
      <input
        id="bbmd-url"
        ref={input}
        value={value}
        placeholder={props.placeholder}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-ring"
        aria-invalid={error !== null}
      />
      <button type="submit" className="rounded px-2 py-1 text-sm hover:bg-state-hover">
        Apply
      </button>
      {props.onRemove ? (
        <button type="button" className="rounded px-2 py-1 text-sm text-destructive hover:bg-state-hover" onClick={props.onRemove}>
          Remove
        </button>
      ) : null}
      {error ? (
        <div role="alert" className="absolute left-2 top-full mt-1 rounded bg-card px-2 py-1 text-xs text-destructive shadow">
          {error}
        </div>
      ) : null}
    </form>
  );
}

export function LinkBubble(props: { anchor: Anchor; href: string; onOpen(): void; onEdit(): void; onRemove(): void }) {
  return (
    <div className="bbmd-menu flex items-center gap-1" style={{ ...floating(props.anchor), minWidth: 0 }} onMouseDown={(event) => event.preventDefault()}>
      <span className="max-w-[260px] truncate px-1 text-xs text-muted-foreground" title={props.href}>
        {props.href}
      </span>
      <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-state-hover" onClick={props.onOpen}>
        Open
      </button>
      <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-state-hover" onClick={props.onEdit}>
        Edit
      </button>
      <button type="button" className="rounded px-2 py-0.5 text-xs text-destructive hover:bg-state-hover" onClick={props.onRemove}>
        Remove
      </button>
    </div>
  );
}

export function SelectionBar(props: { anchor: Anchor; editor: Editor; onLink(): void }) {
  const { editor } = props;
  const button = (label: string, title: string, active: boolean, run: () => void, className = "") => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`min-w-7 rounded px-1.5 py-0.5 text-sm hover:bg-state-hover aria-pressed:bg-state-active ${className}`}
      onClick={run}
    >
      {label}
    </button>
  );
  return (
    <div className="bbmd-menu flex items-center gap-0.5" style={{ ...floating(props.anchor, true), minWidth: 0 }} onMouseDown={(event) => event.preventDefault()}>
      {button("B", "Bold (⌘B)", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "font-bold")}
      {button("I", "Italic (⌘I)", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "italic")}
      {button("S", "Strikethrough (⌘⇧X)", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "line-through")}
      {button("<>", "Inline code (⌘E)", editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "font-mono text-xs")}
      {button("🔗", "Link (⌘K)", editor.isActive("link"), props.onLink)}
    </div>
  );
}
