import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A short id for the web app the server is serving: a hash of its index.html,
 * which names every asset by content hash, so any new build changes it.
 * Browsers that see a different id than they started with reload themselves.
 */
export function webVersion(webDir: string | undefined): string {
  if (!webDir) return "none";
  try {
    return createHash("sha256").update(readFileSync(join(webDir, "index.html"))).digest("hex").slice(0, 12);
  } catch {
    return "none";
  }
}
