import Phaser from "phaser";
import { TILE } from "../../office/layout.js";
import type { Decorations } from "../../world/seasonal.js";
import { propImage } from "./textures.js";

/**
 * Draws the date's decorations where the world put them: pumpkins, a
 * Christmas tree with twinkling lights, balloons at reception.
 */
export class SeasonalView {
  private static_: Phaser.GameObjects.Graphics;
  private lights: Phaser.GameObjects.Graphics;
  private tree: { x: number; y: number } | undefined;
  /** Decorations drawn with the pack's images (when it has them). */
  private images: Phaser.GameObjects.Image[] = [];
  /** The tree is an image, with its own lights: no pixel twinkle on top. */
  private treeImage = false;
  private lastTwinkle = -1;

  constructor(private scene: Phaser.Scene) {
    this.static_ = scene.add.graphics().setDepth(2);
    this.lights = scene.add.graphics();
  }

  /** Redraw the decorations (the office or the date changed). */
  relocate(d: Decorations): void {
    const g = this.static_.clear();
    this.lights.clear();
    for (const img of this.images) img.destroy();
    this.images = [];
    this.tree = d.tree;
    this.treeImage = false;
    // A decoration as the pack's image standing at (x, y), or false to draw it in pixels.
    const image = (name: "pumpkin" | "tree" | "balloons", x: number, y: number): boolean => {
      const img = propImage(this.scene, name);
      if (img) this.images.push(img.setPosition(x, y).setDepth(y));
      return !!img;
    };
    for (const { x, y } of d.pumpkins) {
      if (!image("pumpkin", x * TILE + 12, y * TILE + 16)) pumpkin(g, x * TILE + 9, y * TILE + 11);
    }
    if (d.tree) {
      this.treeImage = image("tree", d.tree.x * TILE + 8, d.tree.y * TILE + 16);
      if (!this.treeImage) christmasTree(g, d.tree.x * TILE, d.tree.y * TILE);
    }
    if (d.balloons) {
      const { left, right } = d.balloons;
      if (!image("balloons", left.x * TILE + 4, left.y * TILE + 4)) balloons(g, left.x * TILE + 4, left.y * TILE);
      if (!image("balloons", right.x * TILE + 12, right.y * TILE + 4)) balloons(g, right.x * TILE + 12, right.y * TILE);
    }
  }

  update(now: number): void {
    if (!this.tree || this.treeImage) return;
    const f = Math.floor(now / 450);
    if (f === this.lastTwinkle) return;
    this.lastTwinkle = f;
    twinkle(this.lights.clear().setDepth(this.tree.y * TILE + 16), this.tree.x * TILE, this.tree.y * TILE, f);
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
