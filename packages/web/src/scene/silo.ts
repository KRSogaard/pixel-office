import Phaser from "phaser";
import { SILO_DOORS } from "../art/tiles.js";
import { TILE } from "../office/layout.js";

/**
 * The rocket silo in the git room, Factorio-style: on every push or PR the
 * blast doors slide open, the rocket rises slowly out of the pit, a countdown
 * runs, and it lifts off in a column of flame and billowing smoke. Launches
 * queue up if several pushes land at once.
 */
export class RocketSilo {
  launches = 0;
  lastLaunchAt = 0;
  private queued: string[] = [];
  private running = false;
  private gfx: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    private silo: () => { x: number; y: number } | undefined,
    private onLaunched: (label: string) => void,
  ) {
    this.gfx = scene.add.graphics();
  }

  launch(label: string): void {
    this.queued.push(label);
    if (!this.running) this.next();
  }

  private next(): void {
    const label = this.queued.shift();
    const s = this.silo();
    if (label === undefined || !s) {
      this.running = false;
      return;
    }
    this.running = true;
    const px = s.x * TILE;
    const py = s.y * TILE;
    const d = SILO_DOORS;
    const pit = { x: px + d.x, y: py + d.y, w: d.w, h: d.h };
    const state = { open: 0, rise: 0, fly: 0 };
    const g = this.gfx.setDepth(py + 3 * TILE + 1);
    const draw = () => this.draw(g, pit, state);
    const tween = (key: keyof typeof state, to: number, duration: number, ease: string) =>
      new Promise<void>((done) =>
        this.scene.tweens.add({ targets: state, [key]: to, duration, ease, onUpdate: draw, onComplete: () => done() }),
      );
    const wait = (ms: number) => new Promise<void>((r) => this.scene.time.delayedCall(ms, r));

    void (async () => {
      await tween("open", 1, 800, "Sine.easeInOut");
      const steam = this.scene.time.addEvent({ delay: 120, loop: true, callback: () => this.puff(pit, 0xe9e4d8, 1.6, 900) });
      await tween("rise", 1, 1800, "Sine.easeOut");
      for (const n of ["3", "2", "1"]) {
        this.countdown(pit, n);
        await wait(450);
      }
      steam.remove();
      this.scene.cameras.main.shake(600, 0.004);
      const smoke = this.scene.time.addEvent({ delay: 40, loop: true, callback: () => this.puff(pit, 0xbfc5cc, 4, 2200) });
      await tween("fly", 1, 1500, "Cubic.easeIn");
      smoke.remove();
      this.launches++;
      this.lastLaunchAt = Date.now();
      this.onLaunched(label);
      state.rise = 0;
      state.fly = 0;
      await tween("open", 0, 700, "Sine.easeInOut");
      g.clear();
      this.next();
    })();
  }

  private draw(g: Phaser.GameObjects.Graphics, pit: { x: number; y: number; w: number; h: number }, s: { open: number; rise: number; fly: number }): void {
    g.clear();
    // Open pit: dark, glowing warmer as the rocket comes up.
    if (s.open > 0) {
      const half = (pit.w / 2) * s.open;
      const cx = pit.x + pit.w / 2;
      g.fillStyle(0x0b0c10, 1).fillRect(cx - half, pit.y, half * 2, pit.h);
      g.fillStyle(0xff7a2a, 0.15 + 0.35 * s.rise).fillRect(cx - half, pit.y + pit.h - 6, half * 2, 6);
      // Doors slide sideways under the apron.
      g.fillStyle(0x5c6370, 1).fillRect(pit.x, pit.y, pit.w / 2 - half, pit.h).fillRect(cx + half, pit.y, pit.w / 2 - half, pit.h);
    }
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

  private puff(pit: { x: number; y: number; w: number; h: number }, color: number, scale: number, ms: number): void {
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

  private countdown(pit: { x: number; y: number; w: number }, n: string): void {
    const t = this.scene.add
      .text(pit.x + pit.w + 6, pit.y - 4, n, { fontFamily: "monospace", fontSize: "12px", color: "#ff5d2a", fontStyle: "bold", resolution: 4 })
      .setDepth(100_000);
    this.scene.tweens.add({ targets: t, alpha: 0, y: t.y - 6, duration: 420, onComplete: () => t.destroy() });
  }
}
