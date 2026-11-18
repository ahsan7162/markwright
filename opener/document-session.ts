// One open file: load, autosave with compare-and-swap, notice outside edits.
// The visible editor (rich or source) registers a Writer; the session never
// touches editor state directly.
import { useCallback, useEffect, useRef, useState } from "react";
import type { useSdk } from "@get-bb/plugin-sdk/app";
import { openDocument, type GateReason } from "../fidelity/document";
import type { ResolvedFile } from "./resolve-file";

type Sdk = ReturnType<typeof useSdk>;

export const AUTOSAVE_MS = 800;
export const POLL_MS = 3000;
export const MAX_WRITE_BYTES = 5 * 1024 * 1024;

export interface Writer {
  /** The full file text the editor would save now. */
  getText(): string;
  /** Show new disk text without remounting; false asks the session to remount instead. */
  applyExternal(text: string): boolean;
  /** The text just written; the editor re-baselines on it. */
  saved(text: string): void;
}

export type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; text: string; gate: GateReason | null; mountId: number; startDirty: boolean };

export type SaveStatus = "saved" | "unsaved" | "saving" | "conflict" | "failed";

export interface Conflict {
  diskText: string | null;
  diskSha: string | null;
  mine: string;
}

interface Draft {
  text: string;
  baseSha: string;
  at: number;
}

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const draftKey = (file: ResolvedFile) => `markwright:draft:${file.hostId}:${file.absPath}`;

function readDraft(file: ResolvedFile): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(file)) ?? "null") as Draft | null;
    if (!draft || typeof draft.text !== "string" || Date.now() - draft.at > DRAFT_TTL_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(file: ResolvedFile, text: string, baseSha: string | null) {
  if (text.length > 1024 * 1024) return;
  try {
    localStorage.setItem(draftKey(file), JSON.stringify({ text, baseSha: baseSha ?? "", at: Date.now() } satisfies Draft));
  } catch {
    // shortcut: a full localStorage only loses the safety copy, never the open edits
  }
}

function clearDraft(file: ResolvedFile) {
  try {
    localStorage.removeItem(draftKey(file));
  } catch {
    // ignore
  }
}

const gateOf = (text: string): GateReason | null => {
  const opened = openDocument(text);
  return opened.ok ? null : opened.reason;
};

export function useDocumentSession(sdk: Sdk, file: ResolvedFile | null, autosave: boolean) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const writer = useRef<Writer | null>(null);
  const sha = useRef<string | null>(null); // the disk version our edits are based on
  const savedText = useRef(""); // the text known to be on disk at `sha`
  const dirty = useRef(false);
  const version = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const conflictRef = useRef<Conflict | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountId = useRef(0);

  const setConflict = (next: Conflict | null) => {
    conflictRef.current = next;
    setConflictState(next);
  };

  const read = useCallback(async () => {
    if (!file) return null;
    const result = await sdk.files.read({ hostId: file.hostId, path: file.absPath, rootPath: file.rootPath });
    if (result.contentEncoding !== "utf8") throw new Error("This file isn't UTF-8 text.");
    return result;
  }, [sdk, file]);

  const mount = useCallback((text: string, startDirty = false) => {
    mountId.current += 1;
    setPhase({ kind: "ready", text, gate: gateOf(text), mountId: mountId.current, startDirty });
  }, []);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    read()
      .then((result) => {
        if (cancelled || !result) return;
        sha.current = result.sha256;
        savedText.current = result.content;
        dirty.current = false;
        setStatus("saved");
        setDraft(readDraft(file));
        mount(result.content);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setPhase({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [file, read, mount]);

  const save = useCallback(
    async (overwrite?: { expectedSha256: string | null }): Promise<void> => {
      if (saving.current) await saving.current;
      if (!file || !writer.current || (!dirty.current && !overwrite)) return;
      if (conflictRef.current && !overwrite) return; // autosave pauses until the user picks a side
      const run = (async () => {
        const startVersion = version.current;
        const text = writer.current!.getText();
        if (!overwrite && text === savedText.current) {
          dirty.current = false;
          setStatus("saved");
          clearDraft(file);
          return;
        }
        if (text.length > MAX_WRITE_BYTES) {
          setStatus("failed");
          return;
        }
        setStatus("saving");
        try {
          const result = await sdk.files.write({
            hostId: file.hostId,
            path: file.absPath,
            rootPath: file.rootPath,
            content: text,
            expectedSha256: overwrite ? overwrite.expectedSha256 : sha.current,
          });
          if (result.outcome === "written") {
            sha.current = result.sha256;
            savedText.current = text;
            setConflict(null);
            clearDraft(file);
            writer.current?.saved(text);
            if (version.current === startVersion) {
              dirty.current = false;
              setStatus("saved");
            } else {
              setStatus("unsaved");
            }
            return;
          }
          const disk = await read().catch(() => null);
          writeDraft(file, text, sha.current);
          setConflict({ diskText: disk?.content ?? null, diskSha: result.currentSha256, mine: text });
          setStatus("conflict");
        } catch {
          writeDraft(file, text, sha.current);
          setStatus("failed");
        }
      })();
      saving.current = run;
      try {
        await run;
      } finally {
        saving.current = null;
      }
      if (dirty.current && autosave && !conflictRef.current) schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sdk, file, read, autosave],
  );

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!autosave) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, AUTOSAVE_MS);
  }, [autosave, save]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    version.current += 1;
    if (conflictRef.current) return;
    setStatus((current) => (current === "saving" ? current : "unsaved"));
    schedule();
  }, [schedule]);

  // Outside edits: re-read on focus and every few seconds while visible.
  const check = useCallback(async () => {
    if (!file || saving.current || document.visibilityState !== "visible") return;
    const result = await read().catch(() => null);
    if (!result || result.sha256 === sha.current) return;
    if (result.content === savedText.current) {
      sha.current = result.sha256;
      return;
    }
    if (dirty.current) {
      setConflict({ diskText: result.content, diskSha: result.sha256, mine: writer.current?.getText() ?? "" });
      setStatus("conflict");
      return;
    }
    sha.current = result.sha256;
    savedText.current = result.content;
    if (!writer.current?.applyExternal(result.content)) mount(result.content);
  }, [file, read, mount]);

  useEffect(() => {
    if (phase.kind !== "ready") return;
    const interval = setInterval(() => void check(), POLL_MS);
    const onFocus = () => void check();
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirty.current) void save();
    };
    const onBlur = () => {
      if (dirty.current) void save();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [phase.kind, check, save]);

  // Unmount: flush what's pending, and keep a draft in case the write fails.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (file && dirty.current && writer.current) {
        writeDraft(file, writer.current.getText(), sha.current);
        void save();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file],
  );

  const takeTheirs = useCallback(() => {
    const disk = conflictRef.current;
    if (!disk || disk.diskText === null) return;
    sha.current = disk.diskSha;
    savedText.current = disk.diskText;
    dirty.current = false;
    setConflict(null);
    setStatus("saved");
    if (file) clearDraft(file);
    mount(disk.diskText);
  }, [file, mount]);

  const keepMine = useCallback(() => {
    const disk = conflictRef.current;
    if (!disk) return;
    void save({ expectedSha256: disk.diskSha });
  }, [save]);

  const restoreDraft = useCallback(() => {
    if (!draft || !file) return;
    setDraft(null);
    dirty.current = true;
    version.current += 1;
    if (draft.baseSha !== sha.current) {
      // The file changed since the draft was taken: let the user choose, never overwrite silently.
      setConflict({ diskText: savedText.current, diskSha: sha.current, mine: draft.text });
      setStatus("conflict");
    } else {
      setStatus("unsaved");
      schedule();
    }
    mount(draft.text, true);
  }, [draft, file, mount, schedule]);

  const discardDraft = useCallback(() => {
    if (file) clearDraft(file);
    setDraft(null);
  }, [file]);

  return {
    phase,
    status,
    conflict,
    draft,
    writer,
    markDirty,
    save,
    takeTheirs,
    keepMine,
    restoreDraft,
    discardDraft,
    remount: mount,
  };
}
