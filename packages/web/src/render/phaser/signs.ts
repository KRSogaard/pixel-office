import Phaser from "phaser";
import { TILE } from "../../office/layout.js";
import type { Sign } from "../renderer.js";

/**
 * The name plates on the team offices' glass fronts: a dark plate edged in the
 * session's colour, the project in bold and manager · person · branch under
 * it. Redrawn only when a plate's text, colour or place changes.
 */
export class SignsView {
  private plates = new Map<string, { key: string; gfx: Phaser.GameObjects.Graphics; title: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }>();

  constructor(private scene: Phaser.Scene) {}

  update(signs: readonly Sign[]): void {
    const live = new Set(signs.map((s) => s.key));
    for (const [k, p] of this.plates) {
      if (live.has(k)) continue;
      p.gfx.destroy();
      p.title.destroy();
      p.sub.destroy();
      this.plates.delete(k);
    }
    for (const s of signs) {
      const id = `${s.x},${s.y},${s.w},${s.color},${s.title},${s.subtitle}`;
      const old = this.plates.get(s.key);
      if (old?.key === id) continue;
      if (old) {
        old.gfx.destroy();
        old.title.destroy();
        old.sub.destroy();
      }
      this.plates.set(s.key, { key: id, ...this.draw(s) });
    }
  }

  private draw(s: Sign) {
    const x = s.x * TILE;
    const y = s.y * TILE + 2;
    const w = s.w * TILE;
    const h = 13;
    const depth = (s.y + 1) * TILE;
    const gfx = this.scene.add.graphics().setDepth(depth);
    gfx.fillStyle(0x1d1f27, 0.92).fillRect(x, y, w, h);
    gfx.fillStyle(s.color, 1).fillRect(x, y, 3, h).fillRect(x, y + h - 1, w, 1);
    const style = (size: number, color: string, bold = false): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: "monospace",
      fontSize: `${size}px`,
      color,
      fontStyle: bold ? "bold" : "normal",
      resolution: 6,
    });
    const fit = (t: Phaser.GameObjects.Text) => {
      // Shorten to fit the plate.
      let text = t.text;
      while (t.width > w - 7 && text.length > 3) t.setText((text = text.slice(0, -2)) + "…");
      return t;
    };
    const title = fit(this.scene.add.text(x + 5, y + 1, s.title, style(6, "#f2e6c9", true)).setDepth(depth + 0.1));
    const sub = fit(this.scene.add.text(x + 5, y + 7, s.subtitle, style(4.5, "#c9cfdb")).setDepth(depth + 0.1));
    return { gfx, title, sub };
  }
}
