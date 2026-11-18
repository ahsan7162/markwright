// Markwright has no backend logic: the editor reads and writes files from the
// frontend through useSdk().files with compare-and-swap. bb requires a server entry.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
