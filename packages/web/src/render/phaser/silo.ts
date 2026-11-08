import Phaser from "phaser";
import { SILO_DOORS } from "../../art/tiles.js";
import { TILE } from "../../office/layout.js";
import type { Flight, RocketSilo } from "../../world/silo.js";
import { propImage } from "./textures.js";

interface Pit {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rocket silo: the cargo gauge beside it, and the launch — blast doors
 * sliding open, the rocket rising out of the pit, steam, the countdown, and
 * lift-off in flame and smoke.
 */
export class SiloView {
  private gauge: Phaser.GameObjects.Graphics;
  private gfx: Phaser.GameObjects.Graphics;
  private rocket: Phaser.GameObjects.Image | undefined;
  private gaugeKey = "";
  private lastSteam = 0;
  private lastSmoke = 0;

  constructor(
    private scene: Phaser.Scene,
    private silo: RocketSilo,
    private where: () => { x: number; y: number } | undefined,
  ) {
    this.gfx = scene.add.graphics();
    this.gauge = scene.add.graphics();
  }

  /** The office was rebuilt: the silo may have moved. */
  relocate(): void {
    this.gaugeKey = "";
  }

  update(now: number): void {
    this.drawGauge();
    const s = this.where();
    const flight = this.silo.flight;
    if (!s || !flight) {
      this.gfx.clear();
      this.rocket?.destroy();
      this.rocket = undefined;
      return;
    }
    const px = s.x * TILE;
    const py = s.y * TILE;
    const d = SILO_DOORS;
    const pit = { x: px + d.x, y: py + d.y, w: d.w, h: d.h };
    this.gfx.setDepth(py + 3 * TILE + 1);
    // The pack's rocket image, when it has one; otherwise the rocket is drawn in pixels.
    if (!this.rocket) this.rocket = propImage(this.scene, "rocket")?.setDepth(py + 3 * TILE + 2).setVisible(false);
    this.draw(pit, flight);
    if (flight.steaming && now - this.lastSteam >= 120) {
      this.lastSteam = now;
      this.puff(pit, 0xe9e4d8, 1.6, 900);
    }
    if (flight.smoking && now - this.lastSmoke >= 40) {
      this.lastSmoke = now;
      this.puff(pit, 0xbfc5cc, 4, 2200);
    }
  }

  countdown(n: string): void {
    const s = this.where();
    if (!s) return;
    const d = SILO_DOORS;
    const t = this.scene.add
      .text(s.x * TILE + d.x + d.w + 6, s.y * TILE + d.y - 4, n, { fontFamily: "monospace", fontSize: "12px", color: "#ff5d2a", fontStyle: "bold", resolution: 4 })
      .setDepth(100_000);
    this.scene.tweens.add({ targets: t, alpha: 0, y: t.y - 6, duration: 420, onComplete: () => t.destroy() });
  }

  /** Ten-segment cargo gauge beside the silo, like Factorio's rocket-part progress. */
  private drawGauge(): void {
    const s = this.where();
    const key = s ? `${s.x},${s.y},${this.silo.cargo}` : "";
    if (key === this.gaugeKey) return;
    this.gaugeKey = key;
    const g = this.gauge.clear();
    if (!s) return;
    const x = (s.x + 3) * TILE + 2;
    const y = s.y * TILE + 4;
    g.setDepth(y + 60);
    g.fillStyle(0x1d1f27, 1).fillRect(x, y, 6, 42);
    const filled = Math.min(10, this.silo.cargo);
    for (let i = 0; i < 10; i++) {
      g.fillStyle(i < filled ? (filled >= 10 ? 0x5af07a : 0xd9a83a) : 0x3b3f4a, 1).fillRect(x + 1, y + 37 - i * 4, 4, 3);
    }
  }

  private draw(pit: Pit, s: Flight): void {
    const g = this.gfx.clear();
    const rocket = this.rocket;
    // Open pit: dark, glowing warmer as the rocket comes up.
    if (s.open > 0) {
      const half = (pit.w / 2) * s.open;
      const cx = pit.x + pit.w / 2;
      g.fillStyle(0x0b0c10, 1).fillRect(cx - half, pit.y, half * 2, pit.h);
      g.fillStyle(0xff7a2a, 0.15 + 0.35 * s.rise).fillRect(cx - half, pit.y + pit.h - 6, half * 2, 6);
      // Doors slide sideways under the apron.
      g.fillStyle(0x5c6370, 1).fillRect(pit.x, pit.y, pit.w / 2 - half, pit.h).fillRect(cx + half, pit.y, pit.w / 2 - half, pit.h);
    }
    rocket?.setVisible(s.rise > 0);
    if (s.rise <= 0) return;
    // The rocket: rises out of the pit, then flies.
    const rw = 14;
    const rh = 44;
    const cx = Math.round(pit.x + pit.w / 2);
    const bottom = pit.y + pit.h - 2 - s.rise * 26 - s.fly * 300;
    const top = bottom - rh;
    if (s.fly > 0) {
      // Exhaust: a column of flame and a glow.
      const len = 12 + s.fly * 56;
      g.fillStyle(0xff5d2a, 0.9).fillRect(cx - 5, bottom, 10, len);
      g.fillStyle(0xffb03c, 1).fillRect(cx - 3, bottom, 6, len * 0.8);
      g.fillStyle(0xfff3b0, 1).fillRect(cx - 1, bottom, 2, len * 0.5);
    }
    if (rocket) {
      rocket.setPosition(cx, bottom);
      return;
    }
    // Body with a shaded side, nose cone, porthole, stripe and fins.
    g.fillStyle(0xe9e4d8, 1).fillRect(cx - rw / 2, top + 9, rw, rh - 9);
    g.fillStyle(0xc9bfa8, 1).fillRect(cx + rw / 2 - 3, top + 9, 3, rh - 9);
    g.fillStyle(0xc0504d, 1).fillRect(cx - 5, top + 5, 10, 4).fillRect(cx - 3, top + 2, 6, 3).fillRect(cx - 1, top, 2, 2);
    g.fillStyle(0x3b3f4a, 1).fillRect(cx - 3, top + 13, 6, 6);
    g.fillStyle(0x4fa3d1, 1).fillRect(cx - 2, top + 14, 4, 4);
    g.fillStyle(0xd9f2fb, 1).fillRect(cx - 2, top + 14, 1, 1);
    g.fillStyle(0xc0504d, 1).fillRect(cx - rw / 2, top + 26, rw, 2);
    g.fillStyle(0xc0504d, 1).fillRect(cx - 10, bottom - 12, 4, 12).fillRect(cx + 6, bottom - 12, 4, 12);
    g.fillStyle(0x9c3d3b, 1).fillRect(cx - 1, bottom - 10, 2, 10);
  }

  private puff(pit: Pit, color: number, scale: number, ms: number): void {
    const x = pit.x + pit.w / 2 + Phaser.Math.Between(-pit.w / 2, pit.w / 2);
    const y = pit.y + pit.h - Phaser.Math.Between(0, 10);
    const c = this.scene.add.circle(x, y, Phaser.Math.Between(3, 5), color, 0.75).setDepth(pit.y + 200);
    this.scene.tweens.add({
      targets: c,
      x: x + Phaser.Math.Between(-24, 24),
      y: y + Phaser.Math.Between(-8, 14),
      scale,
      alpha: 0,
      duration: ms,
      ease: "Quad.easeOut",
      onComplete: () => c.destroy(),
    });
  }
}
