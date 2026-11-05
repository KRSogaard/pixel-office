import { claudeAdapter } from "./claude.js";
import type { Adapter } from "./common.js";
import { genericAdapter } from "./generic.js";
import { OpenCodeAdapter } from "./opencode.js";

export type { Adapter } from "./common.js";

/** One adapter instance per source for the server's lifetime (OpenCode's keeps state). */
export function createAdapters(): Record<string, Adapter> {
  return {
    claude: claudeAdapter,
    opencode: new OpenCodeAdapter(),
    generic: genericAdapter,
  };
}
