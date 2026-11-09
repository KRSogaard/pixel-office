import Phaser from "phaser";
import type { Offering } from "../../world/shrine.js";

/**
 * Today's offerings at the feet of the statue in the meeting room: coffee
 * cups, crashed rockets, red ✗'s. Rebuilt only when the pile changes.
 */
export class Offerings {
  private items: Phaser.GameObjects.Text[] = [];
  private key = "";

  constructor(private scene: Phaser.Scene) {}

  update(list: Offering[]): void {
    const key = list.map((o) => `${o.emoji}${o.x},${o.y}`).join("|");
    if (key === this.key) return;
    this.key = key;
    for (const t of this.items) t.destroy();
    this.items = list.map((o) =>
      this.scene.add
        .text(o.x, o.y, o.emoji, { fontSize: "6px", fontFamily: "sans-serif" })
        .setResolution(6)
        .setOrigin(0.5, 1)
        .setAngle(o.angle)
        .setDepth(o.y),
    );
  }
}
