import { TILE, type Office } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { seasonOn, today, type Season } from "../office/season.js";
import type { WorldListener } from "./events.js";
import { between } from "./random.js";

export type { Season };

/**
 * Decorations by date: a Christmas tree in December, pumpkins by the plants
 * for Halloween, confetti on New Year's Eve and Day, and balloons plus party
 * hats on the office's birthday (the anniversary of its first event). Snow
 * outside the windows from December to February is up to the renderer, using
 * `season.snow`.
 *
 * This decides *where* the decorations go; renderers draw them.
 *
 * Add `?date=2026-12-24` to the URL to preview a date.
 */
export interface Decorations {
  /** Plant tiles that get a pumpkin. */
  pumpkins: Point[];
  /** The lounge tile with the Christmas tree. */
  tree: Point | undefined;
  /** Both ends of the reception counter (tiles), each with a bunch of balloons. */
  balloons: { left: Point; right: Point } | undefined;
}

export class Seasonal {
  season: Season;
  decorations: Decorations = { pumpkins: [], tree: undefined, balloons: undefined };
  private lastConfetti = 0;

  constructor(
    private office: () => Office,
    private since: () => number | undefined,
    private emit: WorldListener,
  ) {
    this.season = seasonOn(today(), since());
  }

  /** Work out the date and the decorations for the current office. */
  relocate(): void {
    this.season = seasonOn(today(), this.since());
    const o = this.office();
    const s = this.season;
    const d: Decorations = { pumpkins: [], tree: undefined, balloons: undefined };
    if (s.halloween) {
      o.tiles.forEach((row, y) => row.forEach((c, x) => c === "P" && d.pumpkins.push({ x, y })));
    }
    if (s.christmas) {
      // In the lounge, just left of the coffee machine.
      for (let y = 0; y < o.height && !d.tree; y++) {
        const kx = o.tiles[y]!.indexOf("K");
        if (kx < 0) continue;
        for (const dx of [-2, -1, -3]) if (o.walkable[y + 1]?.[kx + dx]) d.tree = { x: kx + dx, y: y + 1 };
      }
    }
    if (s.birthday) {
      const y = o.tiles.findIndex((row) => row.includes("X"));
      if (y >= 0) {
        const row = o.tiles[y]!;
        d.balloons = { left: { x: row.indexOf("X"), y }, right: { x: row.lastIndexOf("X"), y } };
      }
    }
    this.decorations = d;
  }

  update(now: number): void {
    if (this.season.newYear && now - this.lastConfetti > 6000) {
      this.lastConfetti = now;
      const o = this.office();
      this.emit({ type: "confetti", x: between(4, o.width - 4) * TILE, y: ((o.rooms[0]?.y ?? 1) + (o.rooms[0]?.h ?? 7) + 4) * TILE });
    }
  }
}
