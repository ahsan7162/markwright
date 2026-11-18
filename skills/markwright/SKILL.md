---
name: markwright
description: The user's Markdown files may be open in the Markwright rich editor. Use when writing or editing .md files the user will read or edit in bb, so the file stays visually editable and your edits don't collide with theirs.
---

# Writing Markdown for the Markwright editor

Markwright opens `.md` and `.markdown` files in the side panel as a rich document
(the "Markwright" file opener). The user edits it like a Word or Notion page; the
file on disk stays plain Markdown, and a save rewrites only the blocks they changed.

## Syntax that renders well and stays editable

- Headings, paragraphs, **bold**, *italic*, ~~strike~~, `inline code`, links, images.
- Bulleted, numbered and task lists (`- [ ]` / `- [x]`).
- GitHub pipe tables.
- Fenced code blocks with a language (```` ```ts ````).
- Mermaid diagrams as ```` ```mermaid ```` fences; they render as diagrams.
- GitHub callouts:

  ```markdown
  > [!NOTE]
  > Text of the note.
  ```

  Types: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`.
- YAML front matter at the top is kept byte-for-byte (shown read-only).
- Raw HTML is kept byte-for-byte but shown as source, not rendered.

## Syntax that turns rich editing off for the whole file

The editor opens these files read-only in bb's normal preview (the user can still
edit the source):

- Footnotes (`[^1]` with a `[^1]: …` definition).
- Reference-style links (`[text][ref]` with a `[ref]: url` definition). Use inline
  links `[text](url)` instead.
- `$$ … $$` math blocks.
- MDX/JSX (`import`/`export` lines, `<Component />`).
- Files larger than 600 KB.

Prefer the editable forms when you create or restructure a document the user will edit.

## When the user has the file open

- The editor checks the file every few seconds. If the user has no unsaved edits, your
  change appears in place.
- If they do have unsaved edits, they get a "changed on disk" banner and choose
  Compare / Use theirs / Keep mine. Their autosave pauses; nothing is overwritten
  silently in either direction.
- Make small, targeted edits rather than rewriting the whole file, so untouched blocks
  (and the user's place in the document) stay put.

To show the user a file, open it in the thread's side panel with `bb thread open <path>`.
