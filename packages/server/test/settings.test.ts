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
    expect(s.roomOrder).toEqual(["git", "mail", "cafe", "lab", "server", "web"]);
    // The library became the internet room: the bigger of the old library and web desks.
    expect(s.minRooms.web).toBe(7);
    expect(s.minRooms.lab).toBe(3);
    expect(s.minRooms.git).toBe(3);
    expect(s.teamsPerRow).toBe(2);
    expect(s.rugs).toBe(false);
  });
});

describe("settings: the café", () => {
  it("adds the café to an office saved before it existed, just before the test lab", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-settings-"));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        roomOrder: ["library", "server", "lab", "git", "mail"],
        minRooms: { library: 4, server: 4, lab: 3, git: 3, mail: 3, lounge: 6, reception: 4, globe: 2, filing: 3 },
        teamsPerRow: 3,
        rugs: true,
        plants: true,
      }),
    );
    expect(new SettingsStore(dir).get().roomOrder).toEqual(["web", "server", "cafe", "lab", "git", "mail"]);
  });
});

describe("web version", () => {
  it("changes when the web build changes, and is 'none' without one", async () => {
    const { webVersion } = await import("../src/version.js");
    const dir = mkdtempSync(join(tmpdir(), "po-ver-"));
    expect(webVersion(dir)).toBe("none");
    writeFileSync(join(dir, "index.html"), '<script src="/assets/index-aaa.js">');
    const a = webVersion(dir);
    writeFileSync(join(dir, "index.html"), '<script src="/assets/index-bbb.js">');
    expect(webVersion(dir)).not.toBe(a);
    expect(webVersion(undefined)).toBe("none");
  });
});
