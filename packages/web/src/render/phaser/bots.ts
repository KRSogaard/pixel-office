import Phaser from "phaser";
import type { Bot } from "../../world/bots.js";

/**
 * Job robots in pixels: a little wheeled robot with a visor in its session's
 * colour. At its station it works (arms going, sparks); on the way back it
 * carries a ✓ or ✗ flag.
 */
export class BotsView {
  private views = new Map<string, Phaser.GameObjects.Graphics>();

  constructor(
    private scene: Phaser.Scene,
    private colorOf: (sessionId: string) => number,
  ) {}

  update(bots: readonly Bot[], now: number): void {
    const live = new Set(bots.map((b) => b.id));
    for (const [id, g] of this.views) {
      if (live.has(id)) continue;
      g.destroy();
      this.views.delete(id);
    }
    for (const b of bots) {
      let g = this.views.get(b.id);
      if (!g) this.views.set(b.id, (g = this.scene.add.graphics()));
      draw(g.clear().setDepth(b.person.y), b, this.colorOf(b.sessionId), now);
    }
  }
}

function draw(g: Phaser.GameObjects.Graphics, b: Bot, visor: number, now: number): void {
  const x = Math.round(b.person.x) - 4;
  const moving = b.person.pose === "walk";
  const bob = moving ? Math.floor(now / 120) % 2 : 0;
  const y = Math.round(b.person.y) - 13 - bob;
  // Wheels, body, head with visor, antenna.
  g.fillStyle(0x1d1f27, 1).fillRect(x, y + 11, 3, 2).fillRect(x + 6, y + 11, 3, 2);
  g.fillStyle(0x7d8590, 1).fillRect(x + 1, y + 6, 7, 5);
  g.fillStyle(0xa9b0ba, 1).fillRect(x + 1, y + 6, 7, 1);
  g.fillStyle(0x9aa3ad, 1).fillRect(x + 1, y + 1, 7, 5);
  g.fillStyle(visor, 1).fillRect(x + 2, y + 2, 5, 2);
  g.fillStyle(0x3b3f4a, 1).fillRect(x + 4, y - 1, 1, 2);
  g.fillStyle(Math.floor(now / 400) % 2 ? 0xff5d5d : 0x7a2a2a, 1).fillRect(x + 4, y - 2, 1, 1);
  if (b.working) {
    // Arms going at the station, and the odd spark.
    const f = Math.floor(now / 150) % 2;
    g.fillStyle(0x5c6370, 1).fillRect(x - 1, y + 7 - f, 2, 1).fillRect(x + 8, y + 6 + f, 2, 1);
    if (Math.floor(now / 90) % 5 === 0) g.fillStyle(0xffe066, 1).fillRect(x + 10, y + 4 - f, 1, 1);
  }
  if (b.result !== undefined) {
    // A little flag with the result.
    g.fillStyle(0x3b3f4a, 1).fillRect(x + 9, y - 4, 1, 10);
    g.fillStyle(b.result ? 0x5af07a : 0xff5d5d, 1).fillRect(x + 10, y - 4, 4, 3);
  }
}
