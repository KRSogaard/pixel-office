import Phaser from "phaser";
import { propImage } from "../art/style.js";
import { TILE, type Office } from "../office/layout.js";
import { confetti } from "./effects.js";
import { seasonOn, today, type Season } from "../office/season.js";

export type { Season };

/**
 * Decorations by date: a Christmas tree with twinkling lights in December,
 * pumpkins by the plants for Halloween, confetti on New Year's Eve and Day,
 * and balloons plus party hats on the office's birthday (the anniversary of
 * its first event). Snow outside the windows from December to February is
 * drawn by the wall decor, using `isSnowSeason`.
 *
 * Add `?date=2026-12-24` to the URL to preview a date.
 */

export class Seasonal {
  private static_: Phaser.GameObjects.Graphics;
  private lights: Phaser.GameObjects.Graphics;
  private tree: { x: number; y: number } | undefined;
  /** Decorations drawn with the style's images (when it has them). */
  private images: Phaser.GameObjects.Image[] = [];
  /** The tree is an image, with its own lights: no pixel twinkle on top. */
  private treeImage = false;
  private lastTwinkle = -1;
  private lastConfetti = 0;
  season: Season;

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private since: () => number | undefined,
  ) {
    this.static_ = scene.add.graphics().setDepth(2);
    this.lights = scene.add.graphics();
    this.season = seasonOn(today(), since());
  }

  /** Redraw fixed decorations for the current office and date. */
  relocate(): void {
    this.season = seasonOn(today(), this.since());
    const g = this.static_.clear();
    this.lights.clear();
    this.tree = undefined;
    for (const img of this.images) img.destroy();
    this.images = [];
    this.treeImage = false;
    // A decoration as the style's image standing at (x, y), or false to draw it in pixels.
    const image = (name: "pumpkin" | "tree" | "balloons", x: number, y: number): boolean => {
      const img = propImage(this.scene, name);
      if (img) this.images.push(img.setPosition(x, y).setDepth(y));
      return !!img;
    };
    const o = this.office();
    const s = this.season;

    if (s.halloween) {
      o.tiles.forEach((row, y) =>
        row.forEach((c, x) => c === "P" && !image("pumpkin", x * TILE + 12, y * TILE + 16) && pumpkin(g, x * TILE + 9, y * TILE + 11)),
      );
    }
    if (s.christmas) {
      // In the lounge, just left of the coffee machine.
      for (let y = 0; y < o.height && !this.tree; y++) {
        const kx = o.tiles[y]!.indexOf("K");
        if (kx < 0) continue;
        for (const dx of [-2, -1, -3]) if (o.walkable[y + 1]?.[kx + dx]) this.tree = { x: kx + dx, y: y + 1 };
      }
      if (this.tree) {
        this.treeImage = image("tree", this.tree.x * TILE + 8, this.tree.y * TILE + 16);
        if (!this.treeImage) christmasTree(g, this.tree.x * TILE, this.tree.y * TILE);
      }
    }
    if (s.birthday) {
      // Balloons at both ends of the reception counter.
      const y = o.tiles.findIndex((row) => row.includes("X"));
      if (y >= 0) {
        const row = o.tiles[y]!;
        if (!image("balloons", row.indexOf("X") * TILE + 4, y * TILE + 4)) balloons(g, row.indexOf("X") * TILE + 4, y * TILE);
        if (!image("balloons", row.lastIndexOf("X") * TILE + 12, y * TILE + 4)) balloons(g, row.lastIndexOf("X") * TILE + 12, y * TILE);
      }
    }
  }

  update(now: number): void {
    if (this.tree && !this.treeImage) {
      const f = Math.floor(now / 450);
      if (f !== this.lastTwinkle) {
        this.lastTwinkle = f;
        twinkle(this.lights.clear().setDepth(this.tree.y * TILE + 16), this.tree.x * TILE, this.tree.y * TILE, f);
      }
    }
    if (this.season.newYear && now - this.lastConfetti > 6000) {
      this.lastConfetti = now;
      const o = this.office();
      confetti(this.scene, Phaser.Math.Between(4, o.width - 4) * TILE, ((o.rooms[0]?.y ?? 1) + (o.rooms[0]?.h ?? 7) + 4) * TILE);
    }
  }
}

function pumpkin(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0xe07b39, 1).fillRect(x, y + 1, 6, 4).fillRect(x + 1, y, 4, 6);
  g.fillStyle(0xb85e22, 1).fillRect(x + 2, y + 1, 1, 4);
  g.fillStyle(0x3b7a3c, 1).fillRect(x + 2, y - 1, 2, 1);
  g.fillStyle(0x1d1f27, 1).fillRect(x + 1, y + 2, 1, 1).fillRect(x + 4, y + 2, 1, 1).fillRect(x + 2, y + 4, 2, 1);
}

function christmasTree(g: Phaser.GameObjects.Graphics, px: number, py: number): void {
  g.fillStyle(0x6b4226, 1).fillRect(px + 7, py + 12, 2, 4);
  g.fillStyle(0xc0504d, 1).fillRect(px + 4, py + 14, 8, 2);
  const green = 0x2e7d3a;
  g.fillStyle(green, 1)
    .fillRect(px + 2, py + 8, 12, 4)
    .fillRect(px + 4, py + 3, 8, 6)
    .fillRect(px + 6, py - 2, 4, 6)
    .fillRect(px + 7, py - 5, 2, 4);
  g.fillStyle(0x3b9a4a, 1).fillRect(px + 4, py + 9, 3, 1).fillRect(px + 6, py + 4, 2, 1).fillRect(px + 7, py, 1, 1);
  g.fillStyle(0xffe066, 1).fillRect(px + 7, py - 7, 2, 2);
}

function twinkle(g: Phaser.GameObjects.Graphics, px: number, py: number, f: number): void {
  const bulbs = [
    [4, 10], [8, 9], [12, 10], [6, 6], [10, 5], [8, 1], [5, 11], [11, 7],
  ] as const;
  const colors = [0xff5d5d, 0x5ab4f0, 0xf0c45a, 0xc77dff];
  bulbs.forEach(([bx, by], i) => g.fillStyle(colors[(i + f) % colors.length]!, (i + f) % 3 ? 1 : 0.35).fillRect(px + bx, py + by, 1, 1));
}

function balloons(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const colors = [0xff5d5d, 0x5ab4f0, 0xf0c45a];
  colors.forEach((c, i) => {
    const bx = x + (i - 1) * 5;
    const by = y - 14 - (i % 2) * 3;
    g.fillStyle(0x9097a6, 1).fillRect(bx + 1, by + 5, 1, 12 - (i % 2) * 3);
    g.fillStyle(c, 1).fillRect(bx, by, 4, 5).fillRect(bx + 1, by - 1, 2, 7);
    g.fillStyle(0xffffff, 0.8).fillRect(bx + 1, by + 1, 1, 1);
  });
}
