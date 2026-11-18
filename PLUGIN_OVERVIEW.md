Edit Markdown files in bb like a Word or Notion document, with no syntax to type.

## What you get

- A **Markwright** file opener for `.md` and `.markdown`. Type `/`, click `+`, or use
  the toolbar to insert:
  - headings, lists and checklists
  - tables and code
  - Mermaid diagrams and GitHub callouts
  - images
  - eleven document templates
- Saves that rewrite only the blocks you changed. Untouched text keeps its exact bytes,
  so git diffs stay small.
- Safe alongside agents. Every save checks the file's hash first, so an agent's change
  is never overwritten silently.

## How it works

The editor runs in your bb window and reads and writes the file on its own machine
through bb's file API. Nothing leaves the machine, and the plugin needs no account,
API key, or external service. Mermaid diagrams are drawn by bb's own renderer.

## For agents

The bundled skill lists the Markdown that renders well and stays editable: callouts,
`mermaid` fences, pipe tables and task lists. It also lists the constructs that turn
rich editing off: footnotes, reference-style links and `$$` math.
