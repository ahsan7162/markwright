import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { createCodec, openDocument, saveDocument, type Baseline, type MarkdownCodec } from "../fidelity/document";
import { DOCUMENT_TEMPLATES, fillTemplate } from "../templates/documents";
import type { Writer } from "../opener/document-session";
import { filterCatalog, markdownNodes, type CatalogItem } from "./catalog";
import { CodeBlockView } from "./CodeBlockView";
import { createExtensions, isAllowedUri } from "./extensions";
import { anchorAt, CatalogMenu, detectSlash, LinkBubble, SelectionBar, UrlPrompt, type Anchor } from "./menus";
import { Toolbar } from "./Toolbar";

const EXTERNAL = "bbmdExternal";
const URL_HELP = "Use an http(s) or mailto link, a #heading anchor, or a relative path.";

type Menu =
  | { kind: "slash"; from: number; to: number; query: string; anchor: Anchor }
  | { kind: "insert"; at: number | null; anchor: Anchor };
type Prompt = { kind: "link" | "image"; anchor: Anchor; initial: string };

export interface RichEditorProps {
  /** Full file text at mount; a new text remounts the editor (parent keys it). */
  text: string;
  resolveImageSrc(src: string): string;
  writer: MutableRefObject<Writer | null>;
  onDirty(): void;
  onOpenLink(href: string): void;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

export function RichEditor(props: RichEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const opened = useMemo(() => openDocument(props.text), [props.text]);
  const [frontMatter, setFrontMatter] = useState(opened.ok ? opened.frontMatter : "");
  const fidelity = useRef<{ codec: MarkdownCodec; baseline: Baseline } | null>(null);

  const [menu, setMenuState] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  const setMenu = (next: Menu | null) => {
    menuRef.current = next;
    setMenuState(next);
  };
  const [menuIndex, setMenuIndexState] = useState(0);
  const indexRef = useRef(0);
  const setMenuIndex = (next: number) => {
    indexRef.current = next;
    setMenuIndexState(next);
  };
  const dismissedAt = useRef<number | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const pendingImage = useRef<CatalogItem | null>(null);
  const [gutter, setGutter] = useState<{ top: number; left: number; after: number } | null>(null);
  const [unsafe, setUnsafe] = useState(false);

  // Built once per mount: the node view and image resolver never change the schema.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(() => createExtensions({ codeBlockView: ReactNodeViewRenderer(CodeBlockView), resolveImageSrc: props.resolveImageSrc }), []);

  const itemsFor = (current: Menu) => filterCatalog(current.kind === "slash" ? current.query : "");

  const editor = useEditor({
    extensions,
    // Load the exact document the fidelity layer parsed, not a second parse by Tiptap.
    content: opened.ok ? opened.doc.toJSON() : "",
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "bbmd-prose", spellcheck: "true", "aria-label": "Document", role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => handleKeys(event),
      handleDOMEvents: {
        mousedown: () => {
          if (menuRef.current?.kind === "insert") setMenu(null);
          return false;
        },
      },
      handleClick: (view, pos, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const link = view.state.doc.resolve(pos).marks().find((mark) => mark.type.name === "link");
        if (!link) return false;
        openHref(String(link.attrs.href ?? ""));
        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      const codec = createCodec(created);
      const own = openDocument(live.current.text, codec);
      // Safety net: never save from an editor whose document differs from what was parsed,
      // or the first autosave could rewrite (or empty) the file.
      if (own.ok && created.state.doc.eq(own.doc)) fidelity.current = { codec, baseline: own.baseline };
      else {
        created.setEditable(false);
        setUnsafe(true);
      }
    },
    onUpdate: ({ editor: updated, transaction }) => {
      if (!transaction.getMeta(EXTERNAL)) live.current.onDirty();
      updateSlash(updated);
    },
    onSelectionUpdate: ({ editor: updated }) => updateSlash(updated),
    onBlur: () => {
      if (menuRef.current) setMenu(null);
    },
  });

  function updateSlash(current: Editor) {
    // An Insert menu (toolbar or +) belongs to the moment it opened; any edit or caret move closes it.
    if (menuRef.current?.kind === "insert") setMenu(null);
    const found = detectSlash(current);
    const open = menuRef.current;
    if (!found) {
      if (open?.kind === "slash") setMenu(null);
      dismissedAt.current = null;
      return;
    }
    if (dismissedAt.current === found.from) return;
    const anchor = anchorAt(current, found.from, container.current);
    if (!anchor) return;
    if (open?.kind !== "slash" || open.query !== found.query) setMenuIndex(0);
    setMenu({ kind: "slash", ...found, anchor });
  }

  function choose(item: CatalogItem) {
    const open = menuRef.current;
    if (!editor || !open) return;
    setMenu(null);
    if (open.kind === "slash") editor.chain().focus().deleteRange({ from: open.from, to: open.to }).run();
    if (open.kind === "insert" && open.at !== null) {
      editor.chain().focus().insertContentAt(open.at, { type: "paragraph" }).setTextSelection(open.at + 1).run();
    }
    if (item.needs === "url") {
      pendingImage.current = item;
      openPrompt("image", "");
      return;
    }
    item.run(editor);
  }

  function handleKeys(event: KeyboardEvent): boolean {
    const mod = event.metaKey || event.ctrlKey;
    const open = menuRef.current;
    if (open) {
      const items = itemsFor(open);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length) setMenuIndex((indexRef.current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[indexRef.current];
        if (!item) return false;
        choose(item);
        return true;
      }
      if (event.key === "Escape") {
        if (open.kind === "slash") dismissedAt.current = open.from;
        setMenu(null);
        return true;
      }
    }
    if (!editor || !mod) return false;
    const key = event.key.toLowerCase();
    if (key === "k") {
      openPrompt("link", String(editor.getAttributes("link").href ?? ""));
      return true;
    }
    if (key === "x" && event.shiftKey) {
      editor.chain().focus().toggleStrike().run();
      return true;
    }
    if (key === "\\") {
      editor.chain().focus().unsetAllMarks().clearNodes().run();
      return true;
    }
    return false;
  }

  function openPrompt(kind: Prompt["kind"], initial: string, element?: HTMLElement) {
    if (!editor) return;
    const box = container.current?.getBoundingClientRect();
    const rect = element?.getBoundingClientRect();
    const anchor =
      rect && box ? { x: rect.left - box.left, y: rect.bottom - box.top + 4 } : anchorAt(editor, editor.state.selection.from, container.current);
    if (anchor) setPrompt({ kind, anchor, initial });
  }

  function submitPrompt(url: string) {
    if (!editor || !prompt) return;
    setPrompt(null);
    if (prompt.kind === "image") {
      const item = pendingImage.current;
      pendingImage.current = null;
      if (url) (item ? item.run(editor, url) : editor.chain().focus().setImage({ src: url, alt: "" }).run());
      return;
    }
    const chain = editor.chain().focus();
    if (!url) chain.extendMarkRange("link").unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    else chain.extendMarkRange("link").setLink({ href: url }).run();
  }

  function openHref(href: string) {
    if (!editor || !href) return;
    if (href.startsWith("#")) {
      const target = decodeURIComponent(href.slice(1));
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading" || slug(node.textContent) !== target) return true;
        editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
        return false;
      });
      return;
    }
    live.current.onOpenLink(href);
  }

  // The session reads and updates the document only through this writer.
  useEffect(() => {
    if (!editor) return;
    props.writer.current = {
      getText: () => {
        const own = fidelity.current;
        return own ? saveDocument(editor.state.doc, own.baseline, own.codec) : live.current.text;
      },
      applyExternal: (text) => {
        const own = fidelity.current;
        if (!own) return false;
        const reopened = openDocument(text, own.codec);
        if (!reopened.ok) return false;
        const next = own.codec.parse(reopened.body);
        const { doc } = editor.state;
        own.baseline = reopened.baseline;
        setFrontMatter(reopened.frontMatter);
        const start = doc.content.findDiffStart(next.content);
        if (start === null || start === undefined) return true;
        const end = doc.content.findDiffEnd(next.content);
        if (!end) return true;
        let { a, b } = end;
        const overlap = start - Math.min(a, b);
        if (overlap > 0) {
          a += overlap;
          b += overlap;
        }
        // Replace only the changed range, so the cursor and scroll stay where they were.
        editor.view.dispatch(editor.state.tr.replace(start, a, next.slice(start, b)).setMeta("addToHistory", false).setMeta(EXTERNAL, true));
        return true;
      },
      saved: (text) => {
        const own = fidelity.current;
        if (!own) return;
        const reopened = openDocument(text, own.codec);
        if (reopened.ok) own.baseline = reopened.baseline;
      },
    };
    // The writer stays registered after unmount so a closing tab can still flush its text.
  }, [editor, props.writer]);

  // Links open with ⌘/Ctrl-click; show the pointer only while the key is down.
  useEffect(() => {
    if (!editor) return;
    const toggle = (event: KeyboardEvent) => editor.view.dom.classList.toggle("bbmd-mod", event.metaKey || event.ctrlKey);
    window.addEventListener("keydown", toggle);
    window.addEventListener("keyup", toggle);
    return () => {
      window.removeEventListener("keydown", toggle);
      window.removeEventListener("keyup", toggle);
    };
  }, [editor]);

  const selection = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const s = e.state.selection;
      return {
        empty: s.empty,
        from: s.from,
        node: s instanceof NodeSelection,
        inCode: e.isActive("codeBlock"),
        href: e.isActive("link") ? String(e.getAttributes("link").href ?? "") : null,
        focused: e.isFocused,
        isEmpty: e.isEmpty,
      };
    },
  });

  if (!editor) return null;

  const showSelectionBar = selection && !selection.empty && !selection.node && !selection.inCode && selection.focused && !menu && !prompt;
  const showLinkBubble = selection && selection.empty && selection.href && selection.focused && !menu && !prompt;

  return (
    <div ref={container} className="relative min-h-full">
      <div className="sticky top-0 z-20 bg-background" hidden={unsafe}>
        <Toolbar
          editor={editor}
          onLink={() => openPrompt("link", String(editor.getAttributes("link").href ?? ""))}
          onImage={(element) => {
            pendingImage.current = null;
            openPrompt("image", "", element);
          }}
          onInsert={(element) => {
            const box = container.current?.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            if (!box) return;
            setMenuIndex(0);
            setMenu({ kind: "insert", at: null, anchor: { x: rect.left - box.left, y: rect.bottom - box.top + 4 } });
          }}
        />
      </div>

      {unsafe ? (
        <div role="alert" className="mx-auto mt-4 max-w-3xl rounded-md border border-destructive/40 px-12 py-2 text-sm">
          The editor couldn't load this file exactly, so editing is off to protect it. Use Source to edit it.
        </div>
      ) : null}

      {frontMatter ? (
        <details className="mx-auto mt-4 max-w-3xl px-12 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">Properties (front matter, read-only)</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{frontMatter.trimEnd()}</pre>
        </details>
      ) : null}

      {selection?.isEmpty && !unsafe ? (
        <div className="mx-auto mt-6 max-w-3xl px-12">
          <p className="text-sm text-muted-foreground">Start typing, press / for blocks, or begin from a template:</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DOCUMENT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  editor.commands.setContent({ type: "doc", content: markdownNodes(editor, fillTemplate(template.markdown)) });
                  live.current.onDirty();
                  editor.commands.focus("start");
                }}
                className="rounded-md border border-border px-3 py-2 text-left hover:bg-state-hover"
              >
                <div className="text-sm font-medium">{template.label}</div>
                <div className="text-xs text-muted-foreground">{template.description}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className="relative mx-auto max-w-3xl px-12 pt-6"
        onMouseLeave={() => setGutter(null)}
        onMouseMove={(event) => {
          const box = container.current?.getBoundingClientRect();
          const dom = editor.view.dom.getBoundingClientRect();
          const hit = editor.view.posAtCoords({ left: dom.left + 4, top: event.clientY });
          if (!box || !hit) return;
          const $pos = editor.state.doc.resolve(hit.pos);
          if ($pos.depth < 1) return;
          const start = $pos.before(1);
          const node = editor.state.doc.nodeAt(start);
          const element = editor.view.nodeDOM(start);
          if (!node || !(element instanceof HTMLElement)) return;
          const rect = element.getBoundingClientRect();
          const next = { top: rect.top - box.top, left: dom.left - box.left - 32, after: start + node.nodeSize };
          setGutter((current) => (current && current.top === next.top && current.after === next.after && current.left === next.left ? current : next));
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {gutter && !menu && !unsafe ? (
        <button
          type="button"
          className="bbmd-gutter"
          style={{ top: gutter.top, left: gutter.left }}
          title="Insert a block below"
          aria-label="Insert a block below"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setMenuIndex(0);
            setMenu({ kind: "insert", at: gutter.after, anchor: { x: gutter.left + 28, y: gutter.top + 28 } });
          }}
        >
          +
        </button>
      ) : null}

      {menu ? <CatalogMenu anchor={menu.anchor} items={itemsFor(menu)} index={menuIndex} query={menu.kind === "slash" ? menu.query : ""} onHover={setMenuIndex} onChoose={choose} /> : null}

      {showSelectionBar ? (() => {
        const anchor = anchorAt(editor, selection.from, container.current, false);
        return anchor ? <SelectionBar anchor={anchor} editor={editor} onLink={() => openPrompt("link", String(editor.getAttributes("link").href ?? ""))} /> : null;
      })() : null}

      {showLinkBubble ? (() => {
        const anchor = anchorAt(editor, selection.from, container.current);
        return anchor ? (
          <LinkBubble
            anchor={anchor}
            href={selection.href!}
            onOpen={() => openHref(selection.href!)}
            onEdit={() => openPrompt("link", selection.href!)}
            onRemove={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
          />
        ) : null;
      })() : null}

      {prompt ? (
        <UrlPrompt
          anchor={prompt.anchor}
          label={prompt.kind === "link" ? "Link address" : "Image address"}
          placeholder={prompt.kind === "link" ? "https://… or ./other.md or #heading" : "https://… or ./images/picture.png"}
          initial={prompt.initial}
          validate={(url) => (!url || isAllowedUri(url) ? null : URL_HELP)}
          onSubmit={submitPrompt}
          onRemove={prompt.kind === "link" && prompt.initial ? () => submitPrompt("") : undefined}
          onClose={() => {
            setPrompt(null);
            editor.commands.focus();
          }}
        />
      ) : null}
    </div>
  );
}
