// Byte-level pieces of a Markdown file the editor never models: BOM, line
// endings and YAML front matter. They are split off on load and put back on save.

const FRONT_MATTER = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;

export interface FileParts {
  bom: string;
  eol: "\n" | "\r\n";
  /** Front matter exactly as written (LF-normalized), or "" when there is none. */
  frontMatter: string;
  /** Everything after the front matter, LF-normalized. This is what the editor sees. */
  body: string;
}

/** The file's dominant line ending; ties and files without newlines count as LF. */
export function dominantEol(text: string): "\n" | "\r\n" {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

export function splitFile(text: string): FileParts {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const lf = text.slice(bom.length).replace(/\r\n?/g, "\n");
  const match = FRONT_MATTER.exec(lf);
  const frontMatter = match ? match[0] : "";
  return { bom, eol: dominantEol(text), frontMatter, body: lf.slice(frontMatter.length) };
}

export function joinFile(parts: Omit<FileParts, "body">, body: string): string {
  const lf = parts.frontMatter + body;
  return parts.bom + (parts.eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf);
}
