import Phaser from "phaser";
import { TILE } from "../../office/layout.js";
import type { Point } from "../../office/pathfind.js";
import type { PizzaBox } from "../../world/extras.js";
import type { Item, Person } from "../../world/person.js";
import type { VisitorKind } from "../../world/visitors.js";
import { duck } from "./effects.js";
import { pack, propImage } from "./textures.js";

/**
 * Small things people carry or leave around: the courier's envelope, the
 * medics' stretcher, pizza (in hand and the box left in the lounge), the
 * visitors' props (a clipboard, a briefcase…) and rubber ducks on desks.
 */

/** What one person is holding, redrawn every frame. */
export class HeldItem {
  private gfx: Phaser.GameObjects.Graphics;
  private img: { item: Item | undefined; obj: Phaser.GameObjects.Image | undefined } | undefined;

  constructor(private scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
  }

  update(p: Person): void {
    const g = this.gfx.clear().setDepth(p.y + 1);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!this.img || this.img.item !== p.item) {
      this.img?.obj?.destroy();
      this.img = { item: p.item, obj: p.item ? propImage(this.scene, p.item) : undefined };
    }
    const held = this.img.obj;
    if (held) {
      // Held in front: the stretcher at waist height, small things up at the chest.
      held.setPosition(x + (p.item === "stretcher" ? 0 : 6), y - (p.item === "stretcher" ? 4 : 8)).setDepth(p.y + 1);
      return;
    }
    if (p.item === "envelope") {
      g.fillStyle(0xfdfbf5, 1).fillRect(x + 3, y - 14, 8, 5);
      g.fillStyle(0x9097a6, 1).fillRect(x + 3, y - 14, 8, 1).fillRect(x + 6, y - 13, 2, 1);
      g.fillStyle(0xc0504d, 1).fillRect(x + 6, y - 11, 2, 1);
    } else if (p.item === "pizza") {
      drawPizzaBox(g, x - 5, y - 17);
    } else if (p.item === "stretcher") {
      g.fillStyle(0xc9d0d8, 1).fillRect(x + 4, y - 12, 2, 10);
      g.fillStyle(0x5c6370, 1).fillRect(x + 4, y - 12, 2, 1);
    }
  }

  destroy(): void {
    this.gfx.destroy();
    this.img?.obj?.destroy();
  }
}

/** Pizza boxes left in the lounge. */
export class PizzaBoxes {
  private boxes = new Map<number, Phaser.GameObjects.Graphics | Phaser.GameObjects.Image>();

  constructor(private scene: Phaser.Scene) {}

  update(boxes: readonly PizzaBox[]): void {
    const live = new Set(boxes.map((b) => b.id));
    for (const [id, obj] of this.boxes) {
      if (live.has(id)) continue;
      obj.destroy();
      this.boxes.delete(id);
    }
    for (const b of boxes) {
      if (this.boxes.has(b.id)) continue;
      const to = b.tile;
      const image = propImage(this.scene, "pizza");
      let box: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;
      if (image) box = image.setPosition(to.x * TILE + 8, to.y * TILE + 15).setDepth(to.y * TILE + 2);
      else drawPizzaBox((box = this.scene.add.graphics().setDepth(to.y * TILE + 2)), to.x * TILE + 3, to.y * TILE + 9);
      this.boxes.set(b.id, box);
    }
  }
}

function drawPizzaBox(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0xc89b5b, 1).fillRect(x, y, 11, 6);
  g.fillStyle(0xe2b97a, 1).fillRect(x, y, 11, 2);
  g.fillStyle(0xc0504d, 1).fillRect(x + 3, y + 3, 5, 2);
}

/** Rubber ducks on desks (agent id → the desk tile). */
export class Ducks {
  private ducks = new Map<string, Phaser.GameObjects.Graphics | Phaser.GameObjects.Image>();

  constructor(private scene: Phaser.Scene) {}

  update(ducks: ReadonlyMap<string, Point>): void {
    for (const [id, obj] of this.ducks) {
      if (ducks.has(id)) continue;
      obj.destroy();
      this.ducks.delete(id);
    }
    for (const [id, t] of ducks) {
      if (!this.ducks.has(id)) this.ducks.set(id, duck(this.scene, t.x * TILE + 4, t.y * TILE + 6));
    }
  }
}

/** Props: the CEO's scooter, the consultant's laptop, the auditor's clipboard, grandpa's walking stick… */
export class VisitorProp {
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
  }

  update(kind: VisitorKind, p: Person, now: number): void {
    const g = this.gfx.clear().setDepth(p.y + 1);
    // Drawn for the pixel figures' hands; other packs draw what their cast carries.
    if (!pack().pixelProps) return;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    switch (kind) {
      case "ceo": // electric scooter
        g.fillStyle(0x3b3f4a, 1).fillRect(x - 6, y - 1, 12, 2);
        g.fillStyle(0x7d8590, 1).fillRect(x + 4, y - 14, 1, 13);
        g.fillStyle(0x3b3f4a, 1).fillRect(x + 2, y - 14, 5, 1);
        g.fillStyle(0x1d1f27, 1).fillRect(x - 6, y, 3, 2).fillRect(x + 3, y, 3, 2);
        break;
      case "trump": // red tie
        g.fillStyle(0xc0504d, 1).fillRect(x, y - 14, 1, 5);
        break;
      case "consultant": // laptop under the arm
        g.fillStyle(0xa9b0ba, 1).fillRect(x + 4, y - 13, 6, 4);
        g.fillStyle(0x7d8590, 1).fillRect(x + 4, y - 10, 6, 1);
        break;
      case "auditor": // clipboard
        g.fillStyle(0x8a5a36, 1).fillRect(x + 4, y - 14, 5, 7);
        g.fillStyle(0xfdfbf5, 1).fillRect(x + 5, y - 13, 3, 5);
        g.fillStyle(0x7d8590, 1).fillRect(x + 5, y - 15, 3, 1);
        break;
      case "intern": // lanyard badge + coffee
        g.fillStyle(0x4fa3d1, 1).fillRect(x - 1, y - 12, 2, 3);
        g.fillStyle(0xfdfbf5, 1).fillRect(x + 5, y - 11, 3, 4);
        g.fillStyle(0x8a5a36, 1).fillRect(x + 5, y - 11, 3, 1);
        break;
      case "investor": // briefcase
        g.fillStyle(0x5a3a22, 1).fillRect(x + 4, y - 8, 7, 5);
        g.fillStyle(0xb8902f, 1).fillRect(x + 7, y - 9, 2, 1).fillRect(x + 7, y - 6, 1, 1);
        break;
      case "grandpa": { // walking stick, tapping as he walks
        const tap = p.arrived ? 0 : Math.floor(now / 250) % 2;
        g.fillStyle(0x6b4226, 1).fillRect(x + 6, y - 11 + tap, 1, 11 - tap);
        g.fillStyle(0x6b4226, 1).fillRect(x + 4, y - 11 + tap, 3, 1);
        break;
      }
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
