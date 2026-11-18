import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  experimental_Diff as Diff,
  experimental_FileLink as FileLink,
  useBbNavigate,
  useSdk,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import { RichEditor } from "../editor/RichEditor";
import { GATE_MESSAGES, openDocument } from "../fidelity/document";
import { useDocumentSession, type SaveStatus, type Writer } from "./document-session";
import { dirname, MARKDOWN_FILE, resolveFile, type ResolvedFile } from "./resolve-file";

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  conflict: "Changed on disk",
  failed: "Save failed",
};

/** One hunk spanning every changed line, with 3 lines of context. bb's diff viewer accepts a bare hunk. */
export function singleHunkPatch(before: string, after: string, path: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const from = Math.max(0, start - 3);
  const toA = Math.min(a.length, endA + 3);
  const toB = Math.min(b.length, endB + 3);
  const lines = [
    ...a.slice(from, start).map((line) => ` ${line}`),
    ...a.slice(start, endA).map((line) => `-${line}`),
    ...b.slice(start, endB).map((line) => `+${line}`),
    ...a.slice(endA, toA).map((line) => ` ${line}`),
  ];
  return `--- a/${path}\n+++ b/${path}\n@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@\n${lines.join("\n")}\n`;
}

/** Resolve `./x/../y.md` against a folder, refusing to climb above the first segment. */
function joinRelative(folder: string, relative: string): string | null {
  const parts = folder === "." || folder === "" ? [] : folder.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function SourceEditor(props: { text: string; writer: MutableRefObject<Writer | null>; onDirty(): void }) {
  const [value, setValue] = useState(props.text);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    props.writer.current = {
      getText: () => valueRef.current,
      applyExternal: (text) => {
        setValue(text);
        return true;
      },
      saved: () => {},
    };
  }, [props.writer]);
  return (
    <textarea
      aria-label="Markdown source"
      spellCheck={false}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        props.onDirty();
      }}
      className="block h-full min-h-[60vh] w-full resize-none bg-transparent p-6 font-mono text-[13px] leading-6 outline-none"
    />
  );
}

function Banner(props: { tone: "warning" | "info" | "error"; children: React.ReactNode }) {
  const tone = props.tone === "error" ? "border-destructive/40" : props.tone === "warning" ? "border-amber-500/50" : "border-border";
  return (
    <div role={props.tone === "info" ? "status" : "alert"} className={`flex flex-wrap items-center gap-2 border-b ${tone} bg-muted/40 px-4 py-2 text-sm`}>
      {props.children}
    </div>
  );
}

const action = "rounded border border-border px-2 py-0.5 text-xs hover:bg-state-hover";

export function MarkdownOpener({ path, source, Original }: PluginFileOpenerProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [file, setFile] = useState<ResolvedFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewBase, setPreviewBase] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<"rich" | "source">("rich");
  const [sourceSeed, setSourceSeed] = useState("");
  const [comparing, setComparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setProblem(null);
    resolveFile(sdk, source, path).then(
      (resolved) => !cancelled && setFile(resolved),
      (cause: unknown) => !cancelled && setProblem(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, path, source.kind, source.environmentId, source.threadId, source.experimental_hostId]);

  // A preview URL serves the file's siblings, so relative images can display.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setPreviewBase(undefined);
    sdk.files.createPreview({ hostId: file.hostId, rootPath: file.rootPath }).then(
      (preview) => !cancelled && setPreviewBase(preview.baseUrl),
      () => !cancelled && setPreviewBase(null),
    );
    return () => {
      cancelled = true;
    };
  }, [sdk, file]);

  const session = useDocumentSession(sdk, file, true);
  const { phase, status, conflict, draft } = session;

  const previewRef = useRef(previewBase);
  previewRef.current = previewBase;
  const resolveImageSrc = useCallback(
    (src: string) => {
      const base = previewRef.current;
      if (!base || !file || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src) || src.startsWith("/")) return src;
      const folder = file.dir === file.rootPath ? "" : file.dir.slice(file.rootPath.length + 1);
      const relative = joinRelative(folder, src.split(/[?#]/)[0]!);
      if (relative === null) return src;
      return `${base.replace(/\/?$/, "/")}${relative.split("/").map(encodeURIComponent).join("/")}`;
    },
    [file],
  );

  const openLink = useCallback(
    (href: string) => {
      if (/^(https?:|mailto:)/i.test(href)) {
        navigate.openUrl(href);
        return;
      }
      if (!file || /^[a-z][a-z0-9+.-]*:/i.test(href)) return; // other schemes (tel:, vscode: …) are not files
      const relative = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
      if (!relative) return;
      const base = file.target.kind === "host" ? dirname(file.target.path) : dirname(`/${file.target.path}`).slice(1);
      const joined = relative.startsWith("/") ? relative.replace(/^\/+/, "") : joinRelative(base.replace(/^\//, ""), relative);
      if (joined === null) return;
      const targetPath = file.target.kind === "host" ? `/${joined.replace(/^\/+/, "")}` : joined;
      const target = { ...file.target, path: targetPath } as ResolvedFile["target"];
      navigate.experimental_openFilePreview({ target, location: null, opener: MARKDOWN_FILE.test(targetPath) ? "rich-markdown" : undefined });
    },
    [file, navigate],
  );

  const saveNow = () => void session.save();

  const toSource = () => {
    setSourceSeed(phase.kind !== "ready" ? "" : phase.gate ? phase.text : (session.writer.current?.getText() ?? phase.text));
    setMode("source");
  };
  const toRich = () => {
    const text = session.writer.current?.getText() ?? sourceSeed;
    const opened = openDocument(text);
    if (!opened.ok) {
      setNotice(`Rich editing is off because ${GATE_MESSAGES[opened.reason]}. Keep editing the source.`);
      return;
    }
    setNotice(null);
    session.remount(text, true);
    setMode("rich");
  };

  const header = useMemo(
    () => (file ? <FileLink target={file.target} className="truncate text-sm font-medium hover:underline">{path.split("/").pop()}</FileLink> : <span className="truncate text-sm">{path}</span>),
    [file, path],
  );

  if (problem || phase.kind === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Banner tone="error">Markwright couldn't open this file: {problem ?? (phase.kind === "error" ? phase.message : "")}</Banner>
        <div className="min-h-0 flex-1 overflow-auto">
          <Original />
        </div>
      </div>
    );
  }
  if (!file || phase.kind === "loading" || previewBase === undefined) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">Loading…</div>;
  }

  const gated = phase.gate;

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          saveNow();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">{header}</div>
        <span
          className={`text-xs ${status === "conflict" || status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {gated && mode === "rich" ? "Read-only preview" : STATUS_TEXT[status]}
        </span>
        {status === "unsaved" || status === "failed" ? (
          <button type="button" className={action} onClick={saveNow} title="Save (⌘S)">
            Save
          </button>
        ) : null}
        <div role="group" aria-label="View" className="flex overflow-hidden rounded border border-border text-xs">
          <button type="button" aria-pressed={mode === "rich"} onClick={() => (mode === "source" ? toRich() : undefined)} className="px-2 py-0.5 aria-pressed:bg-state-active">
            Rich
          </button>
          <button type="button" aria-pressed={mode === "source"} onClick={() => (mode === "rich" ? toSource() : undefined)} className="px-2 py-0.5 aria-pressed:bg-state-active">
            Source
          </button>
        </div>
        <button type="button" className={action} title="Open in your editor" onClick={() => navigate.experimental_openFileExternally({ target: file.target, location: null })}>
          ↗
        </button>
      </div>

      {conflict ? (
        <Banner tone="warning">
          <span className="font-medium">{conflict.diskText === null ? "This file was deleted on disk." : "This file changed on disk while you were editing."}</span>
          {conflict.diskText !== null ? (
            <>
              <button type="button" className={action} onClick={() => setComparing((value) => !value)}>
                {comparing ? "Hide changes" : "Compare"}
              </button>
              <button type="button" className={action} onClick={() => { setComparing(false); session.takeTheirs(); }}>
                Use theirs
              </button>
            </>
          ) : null}
          <button type="button" className={action} onClick={() => { setComparing(false); session.keepMine(); }}>
            {conflict.diskText === null ? "Recreate with my version" : "Keep mine"}
          </button>
        </Banner>
      ) : null}
      {conflict && comparing && conflict.diskText !== null ? (
        <div className="max-h-[40vh] overflow-auto border-b border-border">
          <p className="px-4 pt-2 text-xs text-muted-foreground">Lines marked + are your unsaved version; − is what's on disk now.</p>
          <Diff patch={singleHunkPatch(conflict.diskText, conflict.mine, path)} path={path} />
        </div>
      ) : null}
      {draft && !conflict ? (
        <Banner tone="info">
          Unsaved changes from an earlier session were kept.
          <button type="button" className={action} onClick={session.restoreDraft}>
            Restore
          </button>
          <button type="button" className={action} onClick={session.discardDraft}>
            Discard
          </button>
        </Banner>
      ) : null}
      {status === "failed" ? <Banner tone="error">Couldn't save. Your text is kept in this tab and in a local draft. <button type="button" className={action} onClick={saveNow}>Retry</button></Banner> : null}
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {gated && mode === "rich" ? (
        <Banner tone="info">
          Rich editing is off because {GATE_MESSAGES[gated]}.
          <button type="button" className={action} onClick={toSource}>
            Edit source
          </button>
        </Banner>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "source" ? (
          <SourceEditor key={`s${phase.mountId}`} text={sourceSeed || phase.text} writer={session.writer} onDirty={session.markDirty} />
        ) : gated ? (
          <Original />
        ) : (
          <RichEditor key={`r${phase.mountId}`} text={phase.text} resolveImageSrc={resolveImageSrc} writer={session.writer} onDirty={session.markDirty} onOpenLink={openLink} />
        )}
      </div>
    </div>
  );
}
