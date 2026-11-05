import Phaser from "phaser";

/**
 * Day and night, following the viewer's local clock: daylight from 8 to 17,
 * warm dusk and dawn, a dark blue night. At night, glowing pools of light sit
 * on every desk with someone at it.
 *
 * Add `?hour=22` to the URL to preview a time of day.
 */

const GLOW_KEY = "glow";

export interface Tint {
  color: number;
  /** 0 = no tint, 1 = full. */
  strength: number;
}

/** The tint for a fractional hour of the day (0–24). Pure, for tests. */
export function tintAt(hour: number): Tint {
  const night = { color: 0x2c3566, strength: 0.62 };
  const dusk = { color: 0xffb37a, strength: 0.28 };
  const day = { color: 0xffffff, strength: 0 };
  const mix = (a: Tint, b: Tint, t: number): Tint => {
    const ch = (v: number, shift: number) => (v >> shift) & 0xff;
    const blend = (shift: number) => Math.round(ch(a.color, shift) + (ch(b.color, shift) - ch(a.color, shift)) * t);
    return { color: (blend(16) << 16) | (blend(8) << 8) | blend(0), strength: a.strength + (b.strength - a.strength) * t };
  };
  const lerp = (from: Tint, to: Tint, h0: number, h1: number) => mix(from, to, (hour - h0) / (h1 - h0));
  if (hour < 5 || hour >= 21) return night;
  if (hour < 7) return lerp(night, dusk, 5, 7);
  if (hour < 8) return lerp(dusk, day, 7, 8);
  if (hour < 17) return day;
  if (hour < 19) return lerp(day, dusk, 17, 19);
  return lerp(dusk, night, 19, 21);
}

export class Lighting {
  private shade: Phaser.GameObjects.Rectangle;
  private glows: Phaser.GameObjects.Image[] = [];
  private readonly forcedHour: number | undefined;

  constructor(private scene: Phaser.Scene) {
    const forced = new URLSearchParams(location.search).get("hour");
    this.forcedHour = forced !== null && forced !== "" ? Number(forced) : undefined;
    this.shade = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0).setOrigin(0, 0).setDepth(90_000);
    this.shade.setBlendMode(Phaser.BlendModes.MULTIPLY);
    if (!scene.textures.exists(GLOW_KEY)) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,230,170,0.9)");
      grad.addColorStop(0.5, "rgba(255,210,140,0.35)");
      grad.addColorStop(1, "rgba(255,200,120,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      scene.textures.addCanvas(GLOW_KEY, c);
    }
  }

  /** Resize to the office (pixels). */
  resize(w: number, h: number): void {
    this.shade.setSize(w, h);
  }

  /** Update tint and place light pools at `lights` (pixel positions). */
  update(lights: { x: number; y: number }[]): void {
    const now = new Date();
    const hour = this.forcedHour ?? now.getHours() + now.getMinutes() / 60;
    const tint = tintAt(hour);
    // MULTIPLY with a colour lerped toward white by (1 - strength).
    const c = Phaser.Display.Color.ValueToColor(tint.color);
    const k = tint.strength;
    const r = Math.round(255 + (c.red - 255) * k);
    const gg = Math.round(255 + (c.green - 255) * k);
    const b = Math.round(255 + (c.blue - 255) * k);
    this.shade.setFillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1).setVisible(k > 0.01);

    const glowStrength = Math.max(0, (k - 0.2) / 0.42);
    while (this.glows.length < lights.length) {
      this.glows.push(this.scene.add.image(0, 0, GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD).setDepth(90_001));
    }
    this.glows.forEach((img, i) => {
      const l = lights[i];
      img.setVisible(!!l && glowStrength > 0);
      if (l) img.setPosition(l.x, l.y).setAlpha(0.75 * glowStrength).setScale(0.9);
    });
  }
}
