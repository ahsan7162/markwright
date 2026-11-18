// GitHub alerts (`> [!NOTE]` …) stay plain blockquotes in the document, so they
// round-trip untouched; this only decorates them so they look like callouts.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const CALLOUT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

export const Callouts = Extension.create({
  name: "bbmdCallouts",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("bbmdCallouts"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "blockquote") return true;
              const first = node.firstChild;
              const match = first?.type.name === "paragraph" ? CALLOUT_MARKER.exec(first.textContent) : null;
              if (match) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `bbmd-callout bbmd-callout-${match[1]!.toLowerCase()}` }));
                // pos + 2: inside the blockquote, then inside its first paragraph.
                decorations.push(Decoration.inline(pos + 2, pos + 2 + match[0].length, { class: "bbmd-callout-marker" }));
              }
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
