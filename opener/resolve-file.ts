// Turn a fileOpener `source` + `path` into the absolute location bb.sdk.files
// needs. `path` is untrusted: it must stay inside its root and be Markdown.
import type { PluginFileOpenerProps, useSdk } from "@get-bb/plugin-sdk/app";

type Sdk = ReturnType<typeof useSdk>;
type Source = PluginFileOpenerProps["source"];

export interface ResolvedFile {
  hostId: string;
  /** Absolute path of the file on its host. */
  absPath: string;
  /** Writes are confined beneath this directory. */
  rootPath: string;
  /** Absolute directory holding the file, for relative images. */
  dir: string;
  /** The target bb's own file components take. */
  target:
    | { kind: "workspace"; environmentId: string; path: string }
    | { kind: "host"; hostId: string; path: string }
    | { kind: "thread-storage"; threadId: string; path: string };
}

export const MARKDOWN_FILE = /\.(md|markdown)$/i;

export class ResolveError extends Error {}

/** Join a root and a relative path, refusing `..` segments that climb out of the root. */
export function joinInside(root: string, relative: string): string {
  const parts: string[] = [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new ResolveError("The file path leaves its folder.");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (parts.length === 0) throw new ResolveError("The file path is empty.");
  return `${root.replace(/\/+$/, "")}/${parts.join("/")}`;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

async function hostOfThread(sdk: Sdk, threadId: string): Promise<string> {
  const thread = await sdk.threads.get({ threadId });
  const environmentId = (thread as { environmentId?: string | null }).environmentId;
  if (!environmentId) throw new ResolveError("This thread has no environment to read the file from.");
  return (await sdk.environments.get({ environmentId })).hostId;
}

export async function resolveFile(sdk: Sdk, source: Source, path: string): Promise<ResolvedFile> {
  if (!MARKDOWN_FILE.test(path)) throw new ResolveError("Only .md and .markdown files open in the rich editor.");
  switch (source.kind) {
    case "workspace": {
      if (!source.environmentId) throw new ResolveError("This file has no workspace.");
      const environment = await sdk.environments.get({ environmentId: source.environmentId });
      if (!environment.path) throw new ResolveError("The workspace isn't ready yet.");
      const absPath = joinInside(environment.path, path);
      return {
        hostId: environment.hostId,
        absPath,
        rootPath: environment.path,
        dir: dirname(absPath),
        target: { kind: "workspace", environmentId: source.environmentId, path },
      };
    }
    case "thread-storage": {
      if (!source.threadId) throw new ResolveError("This file has no thread.");
      const location = await sdk.threads.storageLocation({ threadId: source.threadId });
      const absPath = joinInside(location.storageRootPath, path);
      return {
        hostId: location.hostId,
        absPath,
        rootPath: location.storageRootPath,
        dir: dirname(absPath),
        target: { kind: "thread-storage", threadId: source.threadId, path },
      };
    }
    case "host": {
      if (!path.startsWith("/")) throw new ResolveError("A host file needs an absolute path.");
      const absPath = joinInside("/", path);
      const hostId = source.experimental_hostId ?? (source.threadId ? await hostOfThread(sdk, source.threadId) : null);
      if (!hostId) throw new ResolveError("bb didn't say which machine this file is on.");
      return { hostId, absPath, rootPath: dirname(absPath), dir: dirname(absPath), target: { kind: "host", hostId, path: absPath } };
    }
  }
}
