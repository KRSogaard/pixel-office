import { TILE, type Office } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";
import type { WorldListener } from "./events.js";
import { between } from "./random.js";

/**
 * Byte, the office cat. Wanders between random spots, sits next to agents,
 * naps on the sofas, and purrs (with a heart) when you click it.
 */

export type PetMode = "walk" | "sit" | "sleep";

export class Pet {
  x = 0;
  y = 0;
  /** Facing right (only meaningful while walking). */
  right = false;
  private tile: Point;
  private path: Point[] = [];
  private resting: "sit" | "sleep" = "sit";
  private until = 0;
  private visiting: Point | undefined;
  private now = 0;

  constructor(
    private office: () => Office,
    private agentTiles: () => Point[],
    private emit: WorldListener,
    /** Byte arrived next to an agent's tile (to sit on their keyboard). */
    private onVisit: (agentTile: Point) => void = () => {},
  ) {
    this.tile = this.randomFloor() ?? { x: 2, y: 2 };
    this.place();
  }

  get mode(): PetMode {
    return this.path.length ? "walk" : this.resting;
  }

  /** The office was rebuilt: make sure the cat isn't inside a wall. */
  relocate(): void {
    const w = this.office().walkable;
    if (!w[this.tile.y]?.[this.tile.x]) this.tile = this.randomFloor() ?? this.tile;
    this.path = [];
    this.place();
  }

  update(dtMs: number, now: number): void {
    this.now = now;
    if (this.path.length) {
      this.step(dtMs);
      if (!this.path.length && this.visiting) {
        this.onVisit(this.visiting);
        this.visiting = undefined;
      }
    } else if (now > this.until) this.decide(now);
  }

  /** Clicked: stop, sit, and purr. */
  purr(): void {
    this.resting = "sit";
    this.path = [];
    this.until = this.now + 3000;
    this.emit({ type: "purr", x: this.x, y: this.y });
  }

  private decide(now: number): void {
    const roll = Math.random();
    if (roll < 0.15) {
      this.resting = "sleep";
      this.until = now + between(8000, 20000);
      return;
    }
    if (roll < 0.4) {
      this.resting = "sit";
      this.until = now + between(2500, 6000);
      return;
    }
    // Walk somewhere: half the time to sit by an agent, otherwise anywhere.
    const agents = this.agentTiles();
    const target = Math.random() < 0.5 && agents.length ? agents[Math.floor(Math.random() * agents.length)] : undefined;
    const goal = target ? this.nextTo(target) : this.randomFloor();
    if (!goal) return;
    this.visiting = target;
    this.path = findPath(this.office().passable, this.tile, goal).slice(0, 40);
    this.resting = "sit";
    this.until = now + between(2000, 5000);
  }

  private step(dtMs: number): void {
    let budget = (40 * dtMs) / 1000;
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const tx = next.x * TILE + TILE / 2;
      const ty = next.y * TILE + TILE - 2;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) this.right = dx > 0;
      this.tile = { ...next };
      if (d <= budget) {
        this.x = tx;
        this.y = ty;
        this.path.shift();
        budget -= d;
      } else {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  private place(): void {
    this.x = this.tile.x * TILE + TILE / 2;
    this.y = this.tile.y * TILE + TILE - 2;
  }

  private nextTo(p: Point): Point | undefined {
    const w = this.office().walkable;
    const options = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
    ].filter((q) => w[q.y]?.[q.x]);
    return options[Math.floor(Math.random() * options.length)];
  }

  private randomFloor(): Point | undefined {
    const o = this.office();
    for (let i = 0; i < 50; i++) {
      const x = between(1, o.width - 2);
      const y = between(1, o.height - 2);
      if (o.walkable[y]?.[x] && o.tiles[y]?.[x] !== "D") return { x, y };
    }
    return undefined;
  }
}
