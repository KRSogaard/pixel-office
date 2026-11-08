import Phaser from "phaser";
import { tintAt } from "../daylight.js";

/**
 * Day and night, following the viewer's local clock: daylight from 8 to 17,
 * warm dusk and dawn, a dark blue night. At night, glowing pools of light sit
 * on every desk with someone at it.
 *
 * Add `?hour=22` to the URL to preview a time of day.
 */

const GLOW_KEY = "glow";

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
