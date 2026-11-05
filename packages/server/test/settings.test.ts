import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/settings.js";

describe("settings store", () => {
  it("carries a saved meeting room over to the test lab", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-settings-"));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        roomOrder: ["mail", "meeting", "server", "library"],
        minRooms: { library: 7, server: 4, meeting: 8, mail: 3, lounge: 6, reception: 4, globe: 2, filing: 3 },
        teamsPerRow: 2,
        rugs: false,
        plants: true,
      }),
    );
    const s = new SettingsStore(dir).get();
    expect(s.roomOrder).toEqual(["mail", "lab", "server", "library"]);
    expect(s.minRooms.library).toBe(7);
    expect(s.minRooms.lab).toBe(6);
    expect(s.teamsPerRow).toBe(2);
    expect(s.rugs).toBe(false);
  });
});
