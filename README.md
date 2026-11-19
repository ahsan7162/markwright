# Markwright

A bb plugin that opens `.md` files as a document you edit like a Word or Notion page,
with no Markdown syntax to type. The file on disk stays plain Markdown, and **a save
rewrites only the blocks you changed**, so git diffs stay small.

<!-- SCREENSHOT: replace this line with screenshots/readme/1-overview.png (alt: "Markwright editing a launch plan") -->

## Install

```sh
bb plugin install https://github.com/ahsan7162/markwright.git
```

Requires bb 0.49 or later. Then open any `.md` file in a thread's side panel. To make
Markwright the default for Markdown, see [Choosing the default opener](#choosing-the-default-opener).

## What you can do

- **Type `/`** on an empty line, or click **`+`** beside a block, or **+ Insert** in the
  toolbar to add any block:
  - text and headings 1–6
  - quotes and dividers
  - bulleted, numbered and check lists
  - tables and code blocks
  - eight Mermaid diagram starters (flowchart, sequence, class, state, ER, Gantt, pie, mind map)
  - five GitHub callouts (Note, Tip, Important, Warning, Caution)
  - images
  - eleven document templates (README, meeting notes, ADR, PRD, RFC, changelog, bug report, runbook, PR description, postmortem, weekly status)
- **Format** with the toolbar or the bubble that appears over a selection:
  - ⌘B bold, ⌘I italic, ⌘⇧X strikethrough, ⌘E inline code
  - ⌘K link, ⌘\\ clear formatting, ⌘⌥1–6 headings
  - Markdown shortcuts (`# `, `- `, `[ ] `, `> `, ```` ``` ````) still work
- **Tables:** Tab moves to the next cell; Tab in the last cell adds a row. A table
  toolbar adds or removes rows and columns.
- **Mermaid:** diagrams render in place through bb's own renderer. **Edit diagram**
  shows the source, and the diagram updates as you type.
- **Links:** ⌘-click opens a link. Relative `.md` links open in this editor, and
  `#heading` links scroll to the heading.
- **Rich | Source** toggle in the header switches to the raw text.

<!-- SCREENSHOT: replace this line with screenshots/readme/2-slash-menu.png (alt: "The / block menu filtered to diagram starters") -->

<!-- SCREENSHOT: replace this line with screenshots/readme/3-mermaid.png (alt: "Editing a Mermaid diagram above its live preview") -->

<!-- SCREENSHOT: replace this line with screenshots/readme/4-templates.png (alt: "The template picker on an empty file") -->

## Saving and agents

- Autosaves 800 ms after you stop typing; ⌘S saves at once. A pending save is flushed
  when the tab loses focus or closes.
- Every write is compare-and-swap on the file's SHA-256. If an agent changed the file
  while you had unsaved edits, autosave pauses and a banner offers **Compare**,
  **Use theirs** or **Keep mine**. Nothing is overwritten silently.
- If the editor is clean, an agent's change appears in place within about 3 seconds,
  without moving your cursor.
- If a save fails or a conflict is open, your text is also kept in a local draft and
  offered back the next time you open the file.

<!-- SCREENSHOT: replace this line with screenshots/readme/5-conflict.png (alt: "The changed-on-disk banner comparing both versions") -->

## Files that open read-only

Some Markdown can't be edited visually without changing it. These files open in bb's
normal preview with a one-line reason and an **Edit source** button:

- footnotes
- reference-style links
- `$$` math
- MDX/JSX
- files over 600 KB
- the rare block the serializer can't write back exactly (the editor refuses rather than
  changing it)

Raw HTML (`<p align>`, `<img width>`, comments) is fine. It's shown as source and saved
byte-for-byte.

## Choosing the default opener

bb picks the first matching opener in plugin-id order unless you choose one. To make
this editor the default for Markdown, go to **Settings → File openers** and pick
**Markwright** for `md`. For a single file, right-click its link and choose
**Open with → Markwright**.

## Development

```sh
npm install
npm test          # fidelity corpus, catalog, session and opener tests
npm run typecheck
npm run build     # bb plugin build
bb plugin install .
bb plugin dev     # rebuild and reload on save
```

How it works, with file references:

- `fidelity/document.ts`: open and save. The gate, block reuse, escape cleanup and
  the re-parse proof.
- `editor/`: the Tiptap 3 extension list, the block catalog, the menus and toolbar,
  and the code/Mermaid node view.
- `opener/`: source resolution, plus the document session (autosave, compare-and-swap,
  polling, conflicts, drafts).
- `templates/documents.ts`: the document templates.
- `test/corpus/`: the golden files. Every eligible file must save byte-for-byte when
  unedited, and a one-block edit must change only that block.

The save approach (write the original bytes when nothing changed, keep untouched
blocks' source, prove the result re-parses to the same document) follows
[Orca](https://github.com/stablyai/orca)'s rich-markdown editor (MIT). The code here is
our own.

## License

MIT. See [LICENSE](LICENSE).
