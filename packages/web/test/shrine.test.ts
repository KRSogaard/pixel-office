import { describe, expect, it } from "vitest";
import type { OfficeStats } from "@pixel-office/protocol";
import { generateOffice, MIN_ROOMS } from "../src/office/generate.js";
import { KNEEL_AFTER_MS, Shrine } from "../src/world/shrine.js";

const office = generateOffice({ rooms: MIN_ROOMS, teams: [] });

function shrine(today: Partial<OfficeStats["today"]> = {}) {
  const stats = { today: { testRuns: 0, testPasses: 0, coffeeBreaks: 0, failedPushes: 0, ...today } } as OfficeStats;
  return new Shrine({ office: () => office, stats: () => stats, say: () => {}, emit: () => {}, sfx: { choir() {}, thunder() {} } });
}

describe("the statue of the Almighty Prompter", () => {
  it("stands against the meeting room's back wall, with room to kneel in front of it", () => {
    const room = office.rooms.find((r) => r.kind === "meeting")!;
    const s = office.statue!;
    expect(s.y).toBe(room.y);
    expect(office.tiles[s.y]![s.x]).toBe("V");
    expect(office.tiles[s.y]![s.x + 1]).toBe("V");
    const kneel = office.spots.filter((p) => p.kind === "shrine");
    expect(kneel.length).toBeGreaterThanOrEqual(2);
    for (const k of kneel) {
      expect(k.y).toBe(s.y + 1);
      expect(k.facing).toBe("up");
    }
  });

  it("sends an agent to kneel once it has waited on you a minute", () => {
    const s = shrine();
    expect(s.shouldKneel(undefined)).toBe(false);
    expect(s.shouldKneel(Date.now() - 5_000)).toBe(false);
    expect(s.shouldKneel(Date.now() - KNEEL_AFTER_MS - 1000)).toBe(true);
  });

  it("changes its plaque now and then", () => {
    const s = shrine();
    expect(s.plaque(0)).not.toBe(s.plaque(15_000));
    expect(s.plaque(0)).toBe(s.plaque(14_999));
  });

  it("collects today's coffee breaks, failed pushes and failed test runs at its feet, a few of each", () => {
    expect(shrine().offerings()).toEqual([]);
    const items = shrine({ coffeeBreaks: 2, failedPushes: 1, testRuns: 20, testPasses: 5 }).offerings();
    const count = (emoji: string) => items.filter((o) => o.emoji === emoji).length;
    expect(count("☕")).toBe(2);
    expect(count("🚀")).toBe(1);
    expect(count("❌")).toBe(6); // 15 failed runs, capped
    // All along the front of the statue's plinth.
    const s = office.statue!;
    for (const o of items) {
      expect(o.x).toBeGreaterThanOrEqual(s.x * 16);
      expect(o.x).toBeLessThanOrEqual((s.x + 2) * 16);
    }
  });
});
