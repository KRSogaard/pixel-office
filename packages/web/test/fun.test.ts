import { describe, expect, it } from "vitest";
import { generateOffice } from "../src/office/generate.js";
import { MIN_ROOMS } from "../src/office/generate.js";
import { findPath } from "../src/office/pathfind.js";
import { seasonOn as season } from "../src/office/season.js";

const seasonOn = (d: string, since?: string) =>
  season(new Date(`${d}T12:00:00`), since ? new Date(`${since}T12:00:00`).getTime() : undefined);

describe("office extras", () => {
  const office = generateOffice({ rooms: MIN_ROOMS, teams: [{ sessionId: "s", project: "p", workerSlots: 3 }] });

  it("gives every team a printer", () => {
    const t = office.teams[0]!;
    expect(office.tiles[t.printer.y]![t.printer.x]).toBe("Y");
  });
});

describe("seasons", () => {
  it("knows the holidays and the office's birthday", () => {
    const xmas = seasonOn("2026-12-24");
    expect(xmas.christmas && xmas.snow).toBe(true);
    expect(seasonOn("2026-10-31").halloween).toBe(true);
    expect(seasonOn("2026-07-01")).toMatchObject({ christmas: false, halloween: false, newYear: false, snow: false });
    expect(seasonOn("2027-01-01").newYear).toBe(true);
    expect(seasonOn("2027-11-04", "2026-11-04").birthday).toBe(true);
    expect(seasonOn("2026-11-04", "2026-11-04").birthday).toBe(false);
  });
});
