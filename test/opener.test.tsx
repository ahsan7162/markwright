import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it, vi } from "vitest";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";

const source: PluginFileOpenerProps["source"] = { kind: "workspace", environmentId: "env_1", threadId: null, projectId: null };
const Original = () => <div>BB PREVIEW</div>;

function fakes(content: string, write = vi.fn(async () => ({ outcome: "written" as const, sha256: "sha_2", sizeBytes: 1 }))) {
  return {
    write,
    sdk: {
      environments: { get: async () => ({ id: "env_1", hostId: "host_1", path: "/repo" }) },
      files: {
        read: async () => ({ content, contentEncoding: "utf8" as const, sha256: "sha_1", sizeBytes: content.length, path: "/repo/README.md" }),
        write,
        createPreview: async () => ({ baseUrl: "http://127.0.0.1/preview/abc/" }),
      },
    },
  };
}

async function opener() {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.fileOpeners.find((entry) => entry.id === "rich-markdown");
  if (!registration) throw new Error("rich-markdown opener not registered");
  return registration;
}

describe("file opener", () => {
  it("registers for .md and .markdown", async () => {
    const registration = await opener();
    expect(registration.extensions).toEqual(["md", "markdown"]);
    expect(registration.title).toBe("Markwright");
  });

  it("opens a Markdown file in the rich editor without writing anything", async () => {
    const { sdk, write } = fakes("# Hello\n\nSome **bold** text.\n");
    const view = renderSlot(await opener(), { path: "README.md", source, Original, experimental_lineRange: null }, { sdk: sdk as never });
    expect(await view.findByText("Hello")).toBeTruthy();
    expect(view.queryByText(/editing is off to protect it/)).toBeNull();
    expect(view.getByLabelText("Document").getAttribute("contenteditable")).toBe("true");
    expect(view.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(view.getByText("Saved")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(write).not.toHaveBeenCalled();
    view.lifecycle.unmount();
  });

  it("falls back to bb's preview for a gated file and says why", async () => {
    const { sdk, write } = fakes("Text.[^1]\n\n[^1]: A footnote.\n");
    const view = renderSlot(await opener(), { path: "notes.md", source, Original, experimental_lineRange: null }, { sdk: sdk as never });
    expect(await view.findByText("BB PREVIEW")).toBeTruthy();
    expect(view.getByText(/this file has footnotes/)).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    view.lifecycle.unmount();
  });

  it("refuses a path that climbs out of the workspace", async () => {
    const { sdk } = fakes("# x\n");
    const view = renderSlot(await opener(), { path: "../../etc/notes.md", source, Original, experimental_lineRange: null }, { sdk: sdk as never });
    expect(await view.findByText(/leaves its folder/)).toBeTruthy();
    view.lifecycle.unmount();
  });
});
