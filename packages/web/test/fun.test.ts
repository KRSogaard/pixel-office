import { describe, expect, it } from "vitest";
import { generateOffice } from "../src/office/generate.js";
import { MIN_ROOMS } from "../src/office/generate.js";
import { findPath } from "../src/office/pathfind.js";
import { seasonOn as season } from "../src/office/season.js";

const seasonOn = (d: string, since?: string) =>
  season(new Date(`${d}T12:00:00`), since ? new Date(`${since}T12:00:00`).getTime() : undefined);

describe("office extras", () => {
  const office = generateOffice({ rooms: MIN_ROOMS, teams: [{ sessionId: "s", project: "p", workerSlots: 3 }] });

  it("has a clear row for the conveyor belt and a route from it to the silo", () => {
    const { y, x0, x1 } = office.bus;
    for (let x = x0; x <= x1; x++) expect(office.walkable[y]![x], `bus at ${x}`).toBe(true);
    const git = office.rooms.find((r) => r.kind === "git")!;
    const path = findPath(office.walkable, { x: git.door.x, y }, { x: office.silo!.x + 1, y: office.silo!.y + 3 });
    expect(path.length).toBeGreaterThan(0);
  });

  it("puts you behind the reception counter, reachable from the door", () => {
    const counter = office.tiles[office.boss.y + 1]![office.boss.x];
    expect(counter).toBe("X");
    const door = office.spots.find((s) => s.kind === "door")!;
    expect(findPath(office.walkable, door, office.boss).length).toBeGreaterThan(0);
  });

  it("gives every team a printer and hangs the production board on a wall", () => {
    const t = office.teams[0]!;
    expect(office.tiles[t.printer.y]![t.printer.x]).toBe("Y");
    expect(office.tiles[office.statsBoard.y]![office.statsBoard.x]).toBe("#");
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
