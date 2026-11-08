import { TILE, type Office } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import type { Clock } from "./clock.js";
import type { WorldListener } from "./events.js";
import { between } from "./random.js";

/**
 * Bugs, Factorio-biter style. Every failed command or test run lets a bug
 * loose where the agent is; it scuttles around the floor. When that agent's
 * session gets a passing test run, its bugs are squashed. Too many bugs at
 * once and they swarm the server room. Old bugs wander off after a while.
 */

export interface Bug {
  id: number;
  sessionId: string;
  x: number;
  y: number;
  target: { x: number; y: number };
  born: number;
  /** Horizontal heading of the last step (negative: left). */
  dx: number;
  /** Shell colour (pixel art); other styles may ignore it. */
  hue: number;
}

const MAX_BUGS = 40;
const SWARM_AT = 9;
const LIFETIME_MS = 20 * 60_000;
const SPEED = 22;

export class Bugs {
  list: Bug[] = [];
  private n = 0;

  constructor(
    private clock: Clock,
    private office: () => Office,
    private emit: WorldListener,
  ) {}

  get count(): number {
    return this.list.length;
  }

  /** A failure: a bug crawls out at (x, y). */
  spawn(sessionId: string, x: number, y: number, now: number): void {
    if (this.list.length >= MAX_BUGS) this.kill(this.list[0]!, false);
    const hue = [0x5c3d2e, 0x3b5c2e, 0x5c2e4a][this.list.length % 3]!;
    const bug: Bug = { id: ++this.n, sessionId, x, y: y - 2, target: { x, y }, born: now, dx: 0, hue };
    bug.target = this.wanderTarget(bug);
    this.list.push(bug);
  }

  /** Tests pass: squash this session's bugs. Returns how many were squashed. */
  squash(sessionId: string): number {
    const mine = this.list.filter((b) => b.sessionId === sessionId);
    mine.forEach((b, i) => this.clock.after(i * 120, () => this.kill(b, true)));
    return mine.length;
  }

  update(dtMs: number, now: number): void {
    const swarming = this.list.length >= SWARM_AT;
    const server = swarming ? this.serverRoom() : undefined;
    for (const b of [...this.list]) {
      if (now - b.born > LIFETIME_MS) {
        this.kill(b, false);
        continue;
      }
      const dx = b.target.x - b.x;
      const dy = b.target.y - b.y;
      const d = Math.hypot(dx, dy);
      const speed = (swarming ? SPEED * 1.6 : SPEED) * (dtMs / 1000);
      b.dx = dx;
      if (d < 2) {
        b.target = swarming && server && Math.random() < 0.8 ? jitter(server, 20) : this.wanderTarget(b);
      } else {
        b.x += (dx / d) * Math.min(speed, d);
        b.y += (dy / d) * Math.min(speed, d);
      }
    }
  }

  /** The office was rebuilt: put bugs back on the floor. */
  relocate(): void {
    for (const b of this.list) if (!this.walkableAt(b.x, b.y)) b.target = this.wanderTarget(b);
  }

  private kill(b: Bug, splat: boolean): void {
    if (!this.list.includes(b)) return;
    this.list = this.list.filter((x) => x !== b);
    if (splat) this.emit({ type: "splat", x: b.x, y: b.y });
  }

  private wanderTarget(b: Bug): { x: number; y: number } {
    for (let i = 0; i < 12; i++) {
      const t = { x: b.x + between(-48, 48), y: b.y + between(-32, 32) };
      if (this.walkableAt(t.x, t.y)) return t;
    }
    return { x: b.x, y: b.y };
  }

  private walkableAt(x: number, y: number): boolean {
    return !!this.office().walkable[Math.floor(y / TILE)]?.[Math.floor(x / TILE)];
  }

  private serverRoom(): Point | undefined {
    const r = this.office().rooms.find((x) => x.kind === "server");
    return r && { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2 + 1) * TILE };
  }
}

function jitter(p: Point, r: number): { x: number; y: number } {
  return { x: p.x + between(-r, r), y: p.y + between(-r, r) };
}
