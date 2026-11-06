import Phaser from "phaser";
import { addSheet, artStyle } from "../art/style.js";
import { TILE, type Office } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";

/**
 * Byte, the office cat. Wanders between random spots, sits next to agents,
 * naps on the sofas, and purrs (with a heart) when you click it.
 */

const KEY = "cat";
const FRAMES = { walk: [0, 1], sit: [2], sleep: [3, 4] } as const;

type Mode = "walk" | "sit" | "sleep";

export class Pet {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tile: Point;
  private path: Point[] = [];
  private mode: Mode = "sit";
  private until = 0;
  private flip = false;
  private visiting: Point | undefined;

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private agentTiles: () => Point[],
    /** Byte arrived next to an agent's tile (to sit on their keyboard). */
    private onVisit: (agentTile: Point) => void = () => {},
  ) {
    const sheet = artStyle().cat();
    addSheet(scene, KEY, sheet);
    this.tile = this.randomFloor() ?? { x: 2, y: 2 };
    this.sprite = scene.add.sprite(0, 0, KEY, 2).setOrigin(0.5, 1).setScale(1 / sheet.scale).setInteractive({ useHandCursor: true });
    this.place();
    this.sprite.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      // Phaser's own propagation, not the DOM event's: keeps the scene's
      // "click on empty floor closes the panel" handler from firing too.
      ev.stopPropagation();
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
    if (this.path.length) {
      this.step(dtMs);
      if (!this.path.length && this.visiting) {
        this.onVisit(this.visiting);
        this.visiting = undefined;
      }
    } else if (now > this.until) this.decide(now);
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
    const target = Math.random() < 0.5 && agents.length ? agents[Math.floor(Math.random() * agents.length)] : undefined;
    const goal = target ? this.nextTo(target) : this.randomFloor();
    if (!goal) return;
    this.visiting = target;
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
