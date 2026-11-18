// Code block node view: language picker, copy, and for ```mermaid a live diagram.
// The diagram is drawn by bb's own chat Markdown renderer (same approach as
// bb-plugin-openui's Diagram), so no Mermaid ships in this bundle.
import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Markdown } from "@get-bb/plugin-sdk/app";

export const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "diff", "dockerfile", "go", "html", "ini", "java", "javascript", "json",
  "kotlin", "markdown", "mermaid", "php", "python", "ruby", "rust", "shell", "sql", "swift", "text", "toml",
  "typescript", "yaml",
];

/** A fence longer than any backtick run in the source keeps it one block. */
export function mermaidFence(source: string): string {
  const longestRun = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}mermaid\n${source}\n${fence}`;
}

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language: string = node.attrs.language ?? "";
  const source = node.textContent;
  const isMermaid = language === "mermaid";
  const [preview, setPreview] = useState(source);
  const [editing, setEditing] = useState(source.trim() === "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPreview(source), 300);
    return () => clearTimeout(timer);
  }, [source]);

  const options = LANGUAGES.includes(language) || language === "" ? LANGUAGES : [language, ...LANGUAGES];
  const showSource = !isMermaid || editing || !editor.isEditable;

  return (
    <NodeViewWrapper className="bbmd-code">
      <div className="bbmd-code-bar" contentEditable={false}>
        <select aria-label="Code language" value={language} onChange={(event) => updateAttributes({ language: event.target.value || null })}>
          <option value="">plain text</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {isMermaid ? (
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? "Done" : "Edit diagram"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(source).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={showSource ? undefined : { display: "none" }}>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
      {isMermaid && preview.trim() ? (
        <div className="bbmd-diagram" contentEditable={false} onDoubleClick={() => setEditing(true)}>
          <Markdown content={mermaidFence(preview.trim())} className="min-w-0 text-sm" />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
