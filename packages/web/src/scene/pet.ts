import Phaser from "phaser";
import { TILE, type Office } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";

/**
 * Byte, the office cat. Wanders between random spots, sits next to agents,
 * naps on the sofas, and purrs (with a heart) when you click it.
 */

const W = 16;
const H = 12;
const KEY = "cat";
const FRAMES = { walk: [0, 1], sit: [2], sleep: [3, 4] } as const;

function buildCatSheet(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W * 5;
  c.height = H;
  const g = c.getContext("2d")!;
  const fur = "#e08a3c";
  const dark = "#b0642a";
  const belly = "#f6d3a8";
  const ink = "#2b2118";
  const px = (f: number, color: string, x: number, y: number, w = 1, h = 1) => {
    g.fillStyle = color;
    g.fillRect(f * W + x, y, w, h);
  };
  // Walking, facing left: 2 frames.
  for (const f of [0, 1]) {
    px(f, fur, 3, 5, 9, 4); // body
    px(f, dark, 5, 5, 1, 4);
    px(f, dark, 8, 5, 1, 4);
    px(f, belly, 4, 8, 7, 1);
    px(f, fur, 0, 2, 5, 4); // head
    px(f, fur, 0, 1, 1, 1); // ears
    px(f, fur, 3, 1, 1, 1);
    px(f, ink, 1, 3, 1, 1); // eye
    px(f, "#ff9fb0", 0, 4, 1, 1); // nose
    px(f, fur, 12, 3 + f, 1, 3); // tail
    px(f, fur, 13, 2 + f, 1, 2);
    const a = f ? 1 : 0;
    px(f, fur, 3 + a, 9, 1, 2); // legs
    px(f, fur, 6 - a, 9, 1, 2);
    px(f, fur, 9 + a, 9, 1, 2);
    px(f, fur, 11 - a, 9, 1, 2);
  }
  // Sitting, facing the viewer.
  px(2, fur, 5, 4, 6, 7);
  px(2, belly, 6, 7, 4, 4);
  px(2, fur, 4, 1, 8, 5);
  px(2, fur, 4, 0, 1, 1);
  px(2, fur, 11, 0, 1, 1);
  px(2, ink, 6, 3, 1, 1);
  px(2, ink, 9, 3, 1, 1);
  px(2, "#ff9fb0", 7, 4, 2, 1);
  px(2, fur, 11, 9, 3, 2);
  // Sleeping curl: 2 breathing frames.
  for (const f of [3, 4]) {
    const b = f === 4 ? 1 : 0;
    px(f, fur, 3, 6 - b, 10, 5 + b);
    px(f, dark, 6, 6 - b, 1, 3);
    px(f, dark, 9, 6 - b, 1, 3);
    px(f, fur, 2, 7, 4, 4);
    px(f, fur, 2, 6, 1, 1);
    px(f, ink, 3, 9, 2, 1); // closed eye
    px(f, fur, 12, 9, 3, 2);
  }
  return c;
}

type Mode = "walk" | "sit" | "sleep";

export class Pet {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tile: Point;
  private path: Point[] = [];
  private mode: Mode = "sit";
  private until = 0;
  private flip = false;

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private agentTiles: () => Point[],
  ) {
    if (!scene.textures.exists(KEY)) {
      const tex = scene.textures.addCanvas(KEY, buildCatSheet())!;
      for (let i = 0; i < 5; i++) tex.add(i, 0, i * W, 0, W, H);
    }
    this.tile = this.randomFloor() ?? { x: 2, y: 2 };
    this.sprite = scene.add.sprite(0, 0, KEY, 2).setOrigin(0.5, 1).setInteractive({ useHandCursor: true });
    this.place();
    this.sprite.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.purr();
    });
  }

  /** The office was rebuilt: make sure the cat isn't inside a wall. */
  relocate(): void {
    const w = this.office().walkable;
    if (!w[this.tile.y]?.[this.tile.x]) this.tile = this.randomFloor() ?? this.tile;
    this.path = [];
    this.place();
  }

  update(dtMs: number, now: number): void {
    if (this.path.length) this.step(dtMs);
    else if (now > this.until) this.decide(now);
    const t = now / 1000;
    const frames = this.path.length ? FRAMES.walk : FRAMES[this.mode];
    const fps = this.path.length ? 6 : this.mode === "sleep" ? 0.8 : 1;
    this.sprite.setFrame(frames[Math.floor(t * fps) % frames.length]!);
    this.sprite.setFlipX(this.path.length > 0 && this.flip);
    this.sprite.setDepth(this.sprite.y);
  }

  private decide(now: number): void {
    const roll = Math.random();
    if (roll < 0.15) {
      this.mode = "sleep";
      this.until = now + Phaser.Math.Between(8000, 20000);
      return;
    }
    if (roll < 0.4) {
      this.mode = "sit";
      this.until = now + Phaser.Math.Between(2500, 6000);
      return;
    }
    // Walk somewhere: half the time to sit by an agent, otherwise anywhere.
    const agents = this.agentTiles();
    const goal =
      Math.random() < 0.5 && agents.length ? this.nextTo(agents[Math.floor(Math.random() * agents.length)]!) : this.randomFloor();
    if (!goal) return;
    this.path = findPath(this.office().walkable, this.tile, goal).slice(0, 40);
    this.mode = "sit";
    this.until = now + Phaser.Math.Between(2000, 5000);
  }

  private step(dtMs: number): void {
    let budget = (40 * dtMs) / 1000;
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const tx = next.x * TILE + TILE / 2;
      const ty = next.y * TILE + TILE - 2;
      const dx = tx - this.sprite.x;
      const dy = ty - this.sprite.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) this.flip = dx > 0;
      this.tile = { ...next };
      if (d <= budget) {
        this.sprite.setPosition(tx, ty);
        this.path.shift();
        budget -= d;
      } else {
        this.sprite.setPosition(this.sprite.x + (dx / d) * budget, this.sprite.y + (dy / d) * budget);
        budget = 0;
      }
    }
  }

  private purr(): void {
    this.mode = "sit";
    this.path = [];
    this.until = this.scene.time.now + 3000;
    const heart = this.scene.add
      .text(this.sprite.x, this.sprite.y - 14, "♥ purr", { fontFamily: "monospace", fontSize: "8px", color: "#ff7a9a", resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(100_000);
    this.scene.tweens.add({ targets: heart, y: heart.y - 12, alpha: 0, duration: 1400, onComplete: () => heart.destroy() });
  }

  private place(): void {
    this.sprite.setPosition(this.tile.x * TILE + TILE / 2, this.tile.y * TILE + TILE - 2);
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
      const x = Phaser.Math.Between(1, o.width - 2);
      const y = Phaser.Math.Between(1, o.height - 2);
      if (o.walkable[y]?.[x] && o.tiles[y]?.[x] !== "D") return { x, y };
    }
    return undefined;
  }
}
