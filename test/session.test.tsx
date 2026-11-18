import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AUTOSAVE_MS, useDocumentSession, type Writer } from "../opener/document-session";
import type { ResolvedFile } from "../opener/resolve-file";

const file: ResolvedFile = {
  hostId: "host_1",
  absPath: "/repo/README.md",
  rootPath: "/repo",
  dir: "/repo",
  target: { kind: "workspace", environmentId: "env_1", path: "README.md" },
};

function setup(initial = "# Doc\n") {
  let disk = { content: initial, sha256: "sha_1" };
  const read = vi.fn(async () => ({ ...disk, contentEncoding: "utf8" as const, sizeBytes: disk.content.length, path: file.absPath }));
  const write = vi.fn(async (args: { content: string; expectedSha256?: string | null }) => {
    if (args.expectedSha256 !== disk.sha256) return { outcome: "conflict" as const, currentSha256: disk.sha256 };
    disk = { content: args.content, sha256: `sha_${write.mock.calls.length + 1}` };
    return { outcome: "written" as const, sha256: disk.sha256, sizeBytes: args.content.length };
  });
  const sdk = { files: { read, write } } as never;
  let text = initial;
  const writer: Writer = { getText: () => text, applyExternal: vi.fn(() => true), saved: vi.fn() };
  const hook = renderHook(() => useDocumentSession(sdk, file, true));
  return {
    hook,
    read,
    write,
    writer,
    type: (next: string) => {
      text = next;
      act(() => hook.result.current.markDirty());
    },
    agentWrites: (content: string) => {
      disk = { content, sha256: "sha_agent" };
    },
  };
}

async function ready(s: ReturnType<typeof setup>) {
  await waitFor(() => expect(s.hook.result.current.phase.kind).toBe("ready"));
  s.hook.result.current.writer.current = s.writer;
}

describe("document session", () => {
  it("autosaves with compare-and-swap on the sha it loaded", async () => {
    const s = setup();
    await ready(s);
    s.type("# Doc\n\nEdited.\n");
    expect(s.hook.result.current.status).toBe("unsaved");
    await waitFor(() => expect(s.write).toHaveBeenCalledTimes(1), { timeout: AUTOSAVE_MS + 1000 });
    expect(s.write.mock.calls[0]![0]).toMatchObject({ hostId: "host_1", path: "/repo/README.md", rootPath: "/repo", expectedSha256: "sha_1", content: "# Doc\n\nEdited.\n" });
    await waitFor(() => expect(s.hook.result.current.status).toBe("saved"));
    expect(s.writer.saved).toHaveBeenCalledWith("# Doc\n\nEdited.\n");
  });

  it("never overwrites an agent's change: conflict pauses autosave until the user picks", async () => {
    const s = setup();
    await ready(s);
    s.agentWrites("# Doc\n\nAgent text.\n");
    s.type("# Doc\n\nMine.\n");
    await waitFor(() => expect(s.hook.result.current.status).toBe("conflict"), { timeout: AUTOSAVE_MS + 1000 });
    expect(s.hook.result.current.conflict).toMatchObject({ diskText: "# Doc\n\nAgent text.\n", diskSha: "sha_agent", mine: "# Doc\n\nMine.\n" });
    const writes = s.write.mock.calls.length;
    s.type("# Doc\n\nMine, still typing.\n");
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_MS + 200));
    expect(s.write.mock.calls.length).toBe(writes); // paused

    await act(async () => s.hook.result.current.keepMine());
    await waitFor(() => expect(s.hook.result.current.status).toBe("saved"));
    expect(s.write.mock.calls.at(-1)![0]).toMatchObject({ expectedSha256: "sha_agent", content: "# Doc\n\nMine, still typing.\n" });
  });

  it("use theirs reloads the disk version and clears the conflict", async () => {
    const s = setup();
    await ready(s);
    s.agentWrites("# From agent\n");
    s.type("# Mine\n");
    await waitFor(() => expect(s.hook.result.current.status).toBe("conflict"), { timeout: AUTOSAVE_MS + 1000 });
    act(() => s.hook.result.current.takeTheirs());
    expect(s.hook.result.current.conflict).toBeNull();
    expect(s.hook.result.current.phase).toMatchObject({ kind: "ready", text: "# From agent\n" });
  });

  it("applies an outside edit to a clean editor in place", async () => {
    const s = setup();
    await ready(s);
    s.agentWrites("# Doc\n\nAdded by agent.\n");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(s.writer.applyExternal).toHaveBeenCalledWith("# Doc\n\nAdded by agent.\n"));
    expect(s.write).not.toHaveBeenCalled();
  });
});
