import Phaser from "phaser";
import { TILE, type Office } from "../office/layout.js";

/**
 * Things on the walls that follow your clock: windows looking out on a city
 * skyline (blue sky and drifting clouds by day, a pink sunset, lit windows and
 * stars at night) and a wall clock with real hands.
 *
 * `?hour=22` previews a time of day, like the lighting.
 */
export class WallDecor {
  private windows: Phaser.GameObjects.Graphics;
  private clock: Phaser.GameObjects.Graphics;
  private clockAt: { x: number; y: number } | undefined;
  private readonly forcedHour: number | undefined;
  private lastDrawn = "";

  constructor(
    scene: Phaser.Scene,
    private office: () => Office,
  ) {
    const forced = new URLSearchParams(location.search).get("hour");
    this.forcedHour = forced !== null && forced !== "" ? Number(forced) : undefined;
    this.windows = scene.add.graphics().setDepth(0);
    this.clock = scene.add.graphics().setDepth(1);
  }

  /** The office was rebuilt: find the windows and a wall for the clock again. */
  relocate(): void {
    this.lastDrawn = "";
    const o = this.office();
    const wallRow = (o.rooms[0]?.y ?? 1) + (o.rooms[0]?.h ?? 7);
    // A plain wall tile over the middle of the service strip.
    const row = o.tiles[wallRow] ?? [];
    let best: number | undefined;
    for (let x = 2; x < o.width - 2; x++) {
      if (row[x] !== "#" || row[x - 1] !== "#" || row[x + 1] !== "#") continue;
      if (best === undefined || Math.abs(x - o.width / 2) < Math.abs(best - o.width / 2)) best = x;
    }
    this.clockAt = best === undefined ? undefined : { x: best, y: wallRow };
  }

  /** Redraw when the minute changes (cheap to call every frame). */
  update(now: number): void {
    const d = new Date();
    const hour = this.forcedHour ?? d.getHours() + d.getMinutes() / 60;
    const key = `${Math.floor(hour * 60)}:${Math.floor(now / 2000)}`;
    if (key === this.lastDrawn) return;
    this.lastDrawn = key;
    this.drawWindows(hour, now);
    this.drawClock(this.forcedHour ?? d.getHours(), this.forcedHour !== undefined ? 0 : d.getMinutes());
  }

  private drawWindows(hour: number, now: number): void {
    const g = this.windows.clear();
    const o = this.office();
    const night = hour < 6 || hour >= 20;
    const dusk = !night && (hour < 8 || hour >= 18);
    const sky = night ? 0x141a3a : dusk ? 0xf29e7a : 0x8fd0f0;
    const skyLow = night ? 0x2a2f5a : dusk ? 0xffd28a : 0xc9ecfa;
    o.tiles.forEach((rowTiles, y) =>
      rowTiles.forEach((c, x) => {
        if (c !== "=") return;
        const below = o.tiles[y + 1]?.[x];
        if (!below || below === "#" || below === "=") return;
        // Glass area of a window tile, as painted by tiles.ts.
        const gx = x * TILE + 3;
        const gy = y * TILE + 6;
        g.fillStyle(sky, 1).fillRect(gx, gy, 10, 6);
        g.fillStyle(skyLow, 1).fillRect(gx, gy + 3, 10, 3);
        if (night && (x * 7 + y) % 3 === 0) g.fillStyle(0xffffff, 1).fillRect(gx + ((x * 5) % 9), gy + 1, 1, 1);
        if (!night && !dusk) {
          // A cloud drifting past.
          const cx = gx + ((Math.floor(now / 2000) + x * 3) % 14) - 3;
          g.fillStyle(0xffffff, 0.9).fillRect(Math.max(gx, cx), gy + 1, Math.min(4, gx + 10 - Math.max(gx, cx)), 1);
        }
        // Skyline silhouettes, different per window.
        for (let b = 0; b < 4; b++) {
          const bh = 1 + ((x * 13 + b * 7 + y) % 4);
          const bx = gx + b * 3 - ((x * 2) % 2);
          const w = Math.min(3, gx + 10 - bx);
          if (w <= 0 || bx < gx) continue;
          g.fillStyle(night ? 0x0b0c18 : dusk ? 0x6b4a5a : 0x5c7088, 1).fillRect(bx, gy + 6 - bh, w - 1 || 1, bh);
          if (night && bh > 2) g.fillStyle(0xffe066, 1).fillRect(bx, gy + 6 - bh + 1, 1, 1);
        }
        // Window frame mullion back on top.
        g.fillStyle(0x6a5a45, 1).fillRect(x * TILE + 7, gy, 2, 6);
      }),
    );
  }

  private drawClock(hours: number, minutes: number): void {
    const g = this.clock.clear();
    if (!this.clockAt) return;
    const cx = this.clockAt.x * TILE + TILE / 2;
    const cy = this.clockAt.y * TILE + 8;
    g.fillStyle(0x3b3f4a, 1).fillCircle(cx, cy, 6);
    g.fillStyle(0xfdfbf5, 1).fillCircle(cx, cy, 5);
    for (let i = 0; i < 12; i += 3) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle(0x3b3f4a, 1).fillRect(Math.round(cx + Math.sin(a) * 4), Math.round(cy - Math.cos(a) * 4), 1, 1);
    }
    const hand = (angle: number, len: number, color: number) => {
      for (let r = 0; r <= len; r += 0.5) {
        g.fillStyle(color, 1).fillRect(Math.round(cx + Math.sin(angle) * r), Math.round(cy - Math.cos(angle) * r), 1, 1);
      }
    };
    hand((((hours % 12) + minutes / 60) / 12) * Math.PI * 2, 2.5, 0x1d1f27);
    hand((minutes / 60) * Math.PI * 2, 4, 0xc0504d);
  }
}
