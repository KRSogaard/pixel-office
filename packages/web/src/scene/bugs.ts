import Phaser from "phaser";
import { propImage } from "../art/style.js";
import { TILE, type Office } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";

/**
 * Bugs, Factorio-biter style. Every failed command or test run lets a bug
 * loose where the agent is; it scuttles around the floor. When that agent's
 * session gets a passing test run, its bugs are squashed. Too many bugs at
 * once and they swarm the server room. Old bugs wander off after a while.
 */

interface Bug {
  sessionId: string;
  x: number;
  y: number;
  target: { x: number; y: number };
  born: number;
  gfx: Phaser.GameObjects.Graphics;
  /** The style's bug image, when it has one (otherwise `gfx` draws a pixel beetle). */
  img: Phaser.GameObjects.Image | undefined;
  hue: number;
}

const MAX_BUGS = 40;
const SWARM_AT = 9;
const LIFETIME_MS = 20 * 60_000;
const SPEED = 22;

export class Bugs {
  private bugs: Bug[] = [];

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
  ) {}

  get count(): number {
    return this.bugs.length;
  }

  /** A failure: a bug crawls out at (x, y) pixels. */
  spawn(sessionId: string, x: number, y: number, now: number): void {
    if (this.bugs.length >= MAX_BUGS) this.kill(this.bugs[0]!, false);
    const gfx = this.scene.add.graphics();
    const bug: Bug = { sessionId, x, y: y - 2, target: { x, y }, born: now, gfx, img: propImage(this.scene, "bug"), hue: [0x5c3d2e, 0x3b5c2e, 0x5c2e4a][this.bugs.length % 3]! };
    bug.target = this.wanderTarget(bug);
    this.bugs.push(bug);
  }

  /** Tests pass: squash this session's bugs. Returns how many were squashed. */
  squash(sessionId: string): number {
    const mine = this.bugs.filter((b) => b.sessionId === sessionId);
    mine.forEach((b, i) => this.scene.time.delayedCall(i * 120, () => this.kill(b, true)));
    return mine.length;
  }

  update(dtMs: number, now: number): void {
    const swarming = this.bugs.length >= SWARM_AT;
    const server = swarming ? this.serverRoom() : undefined;
    for (const b of [...this.bugs]) {
      if (now - b.born > LIFETIME_MS) {
        this.kill(b, false);
        continue;
      }
      const dx = b.target.x - b.x;
      const dy = b.target.y - b.y;
      const d = Math.hypot(dx, dy);
      const speed = (swarming ? SPEED * 1.6 : SPEED) * (dtMs / 1000);
      if (d < 2) {
        b.target = swarming && server && Math.random() < 0.8 ? jitter(server, 20) : this.wanderTarget(b);
      } else {
        b.x += (dx / d) * Math.min(speed, d);
        b.y += (dy / d) * Math.min(speed, d);
      }
      draw(b, now, dx);
    }
  }

  /** The office was rebuilt: put bugs back on the floor. */
  relocate(): void {
    for (const b of this.bugs) if (!this.walkableAt(b.x, b.y)) b.target = this.wanderTarget(b);
  }

  private kill(b: Bug, splat: boolean): void {
    this.bugs = this.bugs.filter((x) => x !== b);
    b.gfx.destroy();
    b.img?.destroy();
    if (!splat) return;
    const s = this.scene.add.graphics().setDepth(b.y);
    s.fillStyle(0x6fd08c, 0.8).fillRect(b.x - 3, b.y - 1, 6, 2).fillRect(b.x - 1, b.y - 3, 2, 6);
    s.fillStyle(0x3b7a3c, 1).fillRect(b.x - 1, b.y - 1, 2, 2);
    this.scene.tweens.add({ targets: s, alpha: 0, delay: 1500, duration: 1200, onComplete: () => s.destroy() });
  }

  private wanderTarget(b: Bug): { x: number; y: number } {
    for (let i = 0; i < 12; i++) {
      const t = { x: b.x + Phaser.Math.Between(-48, 48), y: b.y + Phaser.Math.Between(-32, 32) };
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
  return { x: p.x + Phaser.Math.Between(-r, r), y: p.y + Phaser.Math.Between(-r, r) };
}

/** A 7×4 beetle with scuttling legs, or the style's bug image scuttling (a wobble) in its direction. */
function draw(b: Bug, now: number, dx: number): void {
  if (b.img) {
    const wobble = Math.floor(now / 90) % 2 ? 8 : -8;
    b.img.setPosition(b.x, b.y + 3).setDepth(b.y).setFlipX(dx > 0).setAngle(wobble);
    return;
  }
  const g = b.gfx.clear().setDepth(b.y);
  const x = Math.round(b.x) - 3;
  const y = Math.round(b.y) - 2;
  const leg = Math.floor(now / 90) % 2;
  g.fillStyle(0x1d1f27, 1);
  for (let i = 0; i < 3; i++) {
    g.fillRect(x + 1 + i * 2, y - 1 + (i % 2 === leg ? 0 : 1), 1, 1);
    g.fillRect(x + 1 + i * 2, y + 4 - (i % 2 === leg ? 0 : 1), 1, 1);
  }
  g.fillStyle(b.hue, 1).fillRect(x, y, 7, 4);
  g.fillStyle(0x8a6a4a, 1).fillRect(x + 1, y, 5, 1);
  g.fillStyle(0x1d1f27, 1).fillRect(dx < 0 ? x - 1 : x + 7, y + 1, 1, 2);
  g.fillStyle(0xff3b3b, 1).fillRect(dx < 0 ? x : x + 6, y + 1, 1, 1);
}
