import Phaser from "phaser";
import { TILE, type Office } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";

/**
 * The main bus, Factorio-style: a conveyor belt running the width of the office
 * between the lobby and the team areas, with a spur up through the git room's
 * door to the rocket silo. Every `git commit` pops a crate from the agent's desk
 * onto the belt; it rides to the silo and loads into the rocket.
 */

interface Crate {
  gfx: Phaser.GameObjects.Graphics;
  path: { x: number; y: number }[];
  done: boolean;
}

const SPEED = 46; // px per second

export class Belts {
  /** Belt tiles in order of travel direction, per tile: where it moves crates. */
  private tiles: { x: number; y: number; dx: number; dy: number }[] = [];
  /** Junction column on the bus, and the spur from there to the silo (tile coords). */
  private junction = 0;
  private spur: Point[] = [];
  private belt: Phaser.GameObjects.Graphics;
  private crates: Crate[] = [];
  private lastDraw = -1;

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private onDelivered: () => void,
  ) {
    this.belt = scene.add.graphics().setDepth(0.5);
    this.layout();
  }

  /** The office was rebuilt: re-lay the belt; crates in flight are lost (they fell off). */
  layout(): void {
    for (const c of this.crates) c.gfx.destroy();
    this.crates = [];
    this.tiles = [];
    this.spur = [];
    const o = this.office();
    const git = o.rooms.find((r) => r.kind === "git");
    if (!o.silo || !git) return;
    const { y, x0, x1 } = o.bus;
    this.junction = Math.min(x1, Math.max(x0, git.door.x));
    // Spur: from the bus up through the door to just below the silo.
    const target = { x: o.silo.x + 1, y: o.silo.y + 3 };
    this.spur = [{ x: this.junction, y }, ...findPath(o.walkable, { x: this.junction, y }, target)];
    for (let x = x0; x <= x1; x++) {
      if (x === this.junction) continue;
      this.tiles.push({ x, y, dx: x < this.junction ? 1 : -1, dy: 0 });
    }
    for (let i = 0; i < this.spur.length; i++) {
      const p = this.spur[i]!;
      const n = this.spur[i + 1] ?? { x: p.x, y: p.y - 1 };
      this.tiles.push({ x: p.x, y: p.y, dx: Math.sign(n.x - p.x), dy: Math.sign(n.y - p.y) });
    }
    this.lastDraw = -1;
  }

  /** A crate pops off the desk at `from` (pixels) onto the nearest bus tile, then rides to the silo. */
  ship(from: { x: number; y: number }): void {
    const o = this.office();
    if (!this.spur.length) return;
    const busX = Math.min(o.bus.x1, Math.max(o.bus.x0, Math.round(from.x / TILE - 0.5)));
    const center = (t: Point) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
    const along: Point[] = [];
    const step = busX < this.junction ? 1 : -1;
    for (let x = busX; x !== this.junction; x += step) along.push({ x, y: o.bus.y });
    const path = [...along, ...this.spur].map(center);
    const gfx = this.scene.add.graphics().setDepth(1000);
    const crate: Crate = { gfx, path, done: false };
    // The pop: an arc from the desk onto the belt.
    const start = path[0]!;
    const pos = { x: from.x, y: from.y - 10, t: 0 };
    this.scene.tweens.add({
      targets: pos,
      t: 1,
      duration: 650,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const x = from.x + (start.x - from.x) * pos.t;
        const y = from.y - 10 + (start.y - from.y + 10) * pos.t - Math.sin(pos.t * Math.PI) * 18;
        drawCrate(gfx, x, y);
      },
      onComplete: () => this.crates.push(crate),
    });
  }

  update(dtMs: number, now: number): void {
    // Belt animation: chevrons crawl along at 8 fps.
    const frame = Math.floor(now / 125) % 4;
    if (frame !== this.lastDraw) {
      this.lastDraw = frame;
      this.drawBelt(frame);
    }
    const budget = (SPEED * dtMs) / 1000;
    for (const c of this.crates) {
      let left = budget;
      while (left > 0 && c.path.length > 1) {
        const [a, b] = [c.path[0]!, c.path[1]!];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= left) {
          c.path.shift();
          left -= d;
        } else {
          c.path[0] = { x: a.x + ((b.x - a.x) / d) * left, y: a.y + ((b.y - a.y) / d) * left };
          left = 0;
        }
      }
      const p = c.path[0]!;
      drawCrate(c.gfx, p.x, p.y - 3);
      c.gfx.setDepth(p.y + 1);
      if (c.path.length <= 1) {
        c.done = true;
        c.gfx.destroy();
        this.onDelivered();
      }
    }
    this.crates = this.crates.filter((c) => !c.done);
  }

  private drawBelt(frame: number): void {
    const g = this.belt.clear();
    for (const t of this.tiles) {
      const px = t.x * TILE;
      const py = t.y * TILE;
      const horizontal = t.dy === 0;
      // Frame and rails.
      g.fillStyle(0x3b3f4a, 1);
      if (horizontal) g.fillRect(px, py + 3, TILE, 10);
      else g.fillRect(px + 3, py, 10, TILE);
      g.fillStyle(0x23262e, 1);
      if (horizontal) g.fillRect(px, py + 4, TILE, 8);
      else g.fillRect(px + 4, py, 8, TILE);
      // Moving chevrons in belt-yellow.
      g.fillStyle(0xd9a83a, 1);
      for (let k = 0; k < 2; k++) {
        const o = ((k * 8 + frame * 2) % 16) * (horizontal ? t.dx : t.dy);
        const off = ((o % 16) + 16) % 16;
        if (horizontal) {
          const cx = px + off;
          const dir = t.dx;
          g.fillRect(cx, py + 6, 1, 4);
          g.fillRect(cx - dir, py + 5, 1, 1);
          g.fillRect(cx - dir, py + 10, 1, 1);
        } else {
          const cy = py + off;
          const dir = t.dy;
          g.fillRect(px + 6, cy, 4, 1);
          g.fillRect(px + 5, cy - dir, 1, 1);
          g.fillRect(px + 10, cy - dir, 1, 1);
        }
      }
    }
  }
}

function drawCrate(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const cx = Math.round(x) - 4;
  const cy = Math.round(y) - 4;
  g.clear();
  g.fillStyle(0x8a5a36, 1).fillRect(cx, cy, 8, 8);
  g.fillStyle(0xb07a4a, 1).fillRect(cx + 1, cy + 1, 6, 6);
  g.fillStyle(0x6b4226, 1).fillRect(cx + 1, cy + 3, 6, 1).fillRect(cx + 3, cy + 1, 1, 6);
}
