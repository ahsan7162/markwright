// Markwright — opens .md files as a document you edit like a Word or Notion page.
// The file on disk stays plain Markdown, and a save rewrites only the blocks you changed.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MarkdownOpener } from "./opener/MarkdownOpener";
import "./editor/editor.css";

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "rich-markdown",
    title: "Markwright",
    extensions: ["md", "markdown"],
    component: MarkdownOpener,
  });
});
