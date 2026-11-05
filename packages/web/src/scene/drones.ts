import Phaser from "phaser";
import { TILE, type Office } from "../office/layout.js";

/**
 * Logistic robots, Factorio-style: every `git commit` sends a little flying
 * robot from the agent's desk to the rocket silo, carrying a crate. It flies
 * over everything, so it needs no floor space. The crate loads into the silo's
 * cargo gauge (commits not pushed yet); the next launch empties it.
 */

interface Drone {
  gfx: Phaser.GameObjects.Graphics;
}

export class Drones {
  private drones: Drone[] = [];

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private onDelivered: () => void,
  ) {}

  /** Fly a crate from `from` (pixels) to the silo. */
  ship(from: { x: number; y: number }): void {
    const silo = this.office().silo;
    if (!silo) return;
    const to = { x: (silo.x + 1.5) * TILE, y: (silo.y + 1.5) * TILE };
    const gfx = this.scene.add.graphics().setDepth(95_000);
    const drone: Drone = { gfx };
    this.drones.push(drone);
    const pos = { t: 0 };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.scene.tweens.add({
      targets: pos,
      t: 1,
      duration: Math.max(1200, (dist / 80) * 1000),
      ease: "Sine.easeInOut",
      onUpdate: () => {
        // Take off, cruise a little higher, and set down on the silo.
        const lift = Math.sin(pos.t * Math.PI) * 26 + 8;
        draw(gfx, from.x + (to.x - from.x) * pos.t, from.y + (to.y - from.y) * pos.t - lift, this.scene.time.now);
      },
      onComplete: () => {
        gfx.destroy();
        this.drones = this.drones.filter((d) => d !== drone);
        this.onDelivered();
      },
    });
  }
}

function draw(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  g.clear();
  // Shadow far below would need the ground position; a soft halo reads fine.
  // Rotors (blinking), body, status light, and the crate underneath.
  const spin = Math.floor(now / 60) % 2;
  g.fillStyle(0xc9d0d8, 0.8).fillRect(cx - 6, cy - 5, spin ? 4 : 2, 1).fillRect(cx + 3 - (spin ? 1 : 0), cy - 5, spin ? 4 : 2, 1);
  g.fillStyle(0x7d8590, 1).fillRect(cx - 4, cy - 4, 8, 4);
  g.fillStyle(0xa9b0ba, 1).fillRect(cx - 3, cy - 4, 6, 1);
  g.fillStyle(Math.floor(now / 300) % 2 ? 0xf0c45a : 0xd9a83a, 1).fillRect(cx - 1, cy - 3, 2, 1);
  g.fillStyle(0x3b3f4a, 1).fillRect(cx - 1, cy, 1, 2).fillRect(cx, cy, 1, 2);
  g.fillStyle(0x8a5a36, 1).fillRect(cx - 3, cy + 2, 6, 5);
  g.fillStyle(0xb07a4a, 1).fillRect(cx - 2, cy + 3, 4, 3);
}
