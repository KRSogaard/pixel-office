import Phaser from "phaser";
import { TILE } from "../../office/layout.js";
import type { Bin } from "../../world/world.js";
import { scraps } from "./effects.js";
import { propImage } from "./textures.js";

type BinImage = "bin-empty" | "bin-half" | "bin-full";

/**
 * Each agent's wastepaper bin beside its desk: green, then amber, then red and
 * overflowing as its context window fills; stomped flat (paper flying) while
 * it compacts.
 */
export class BinsView {
  private bins = new Map<string, Phaser.GameObjects.Graphics>();
  /** Packs with bin images: an empty, half-full and overflowing bin per agent. */
  private images = new Map<string, Record<BinImage, Phaser.GameObjects.Image | undefined>>();
  private lastScrap = new Map<string, number>();

  constructor(private scene: Phaser.Scene) {}

  update(bins: Bin[], now: number): void {
    const shown = new Set(bins.map((b) => b.agentId));
    for (const id of [...this.bins.keys(), ...this.images.keys()]) if (!shown.has(id)) this.remove(id);
    for (const bin of bins) this.draw(bin, now);
  }

  private draw(bin: Bin, now: number): void {
    if (this.drawImage(bin, now)) return;
    let g = this.bins.get(bin.agentId);
    if (!g) {
      g = this.scene.add.graphics();
      this.bins.set(bin.agentId, g);
    }
    const { seat, fill, stomping } = bin;
    const x = (seat.x + 1) * TILE + 3;
    const y = seat.y * TILE + 4;
    const squash = stomping ? (Math.floor(now / 160) % 2 ? 3 : 1) : 0;
    const h = 10 - squash;
    const top = y + (10 - h);
    const color = fill > 0.85 ? 0xff5d5d : fill > 0.6 ? 0xf0c45a : 0x6fd08c;

    g.clear().setVisible(true).setDepth(seat.y * TILE + 14);
    // Bin: grey wire basket.
    g.fillStyle(0x5c6370, 1).fillRect(x, top, 9, h);
    g.fillStyle(0x7d8590, 1).fillRect(x + 1, top + 1, 7, h - 2);
    g.fillStyle(0x3b3f4a, 1).fillRect(x - 1, top, 11, 1);
    // Paper level.
    const level = Math.round((h - 2) * fill);
    if (level > 0) {
      g.fillStyle(0xf4f1e8, 1).fillRect(x + 1, top + 1 + (h - 2 - level), 7, level);
      g.fillStyle(color, 1).fillRect(x + 1, top + 1 + (h - 2 - level), 7, 1);
    }
    // Overflowing: crumpled balls on top.
    if (fill > 0.85) {
      g.fillStyle(0xf4f1e8, 1).fillRect(x + 1, top - 2, 3, 2).fillRect(x + 5, top - 3, 3, 3);
    }
    if (stomping) this.scrap(bin.agentId, x + 4, top, now);
  }

  /** Draw the bin with the pack's images. False when the pack has none. */
  private drawImage(bin: Bin, now: number): boolean {
    let imgs = this.images.get(bin.agentId);
    if (!imgs) {
      imgs = { "bin-empty": propImage(this.scene, "bin-empty"), "bin-half": propImage(this.scene, "bin-half"), "bin-full": propImage(this.scene, "bin-full") };
      this.images.set(bin.agentId, imgs);
    }
    if (!imgs["bin-empty"] || !imgs["bin-half"] || !imgs["bin-full"]) return false;
    const { seat, fill, stomping } = bin;
    const which = fill > 0.85 ? "bin-full" : fill > 0.4 ? "bin-half" : "bin-empty";
    const x = (seat.x + 1) * TILE + 7;
    const y = seat.y * TILE + 15;
    for (const [name, img] of Object.entries(imgs)) {
      if (!img) continue;
      img.setVisible(name === which);
      if (name !== which) continue;
      const base = img.getData("scale") ?? img.scaleY;
      img.setData("scale", base);
      // Stomped flat: squash down and spread out, in time with the hops.
      const squash = stomping ? (Math.floor(now / 160) % 2 ? 0.6 : 0.85) : 1;
      img.setPosition(x, y).setScale(base * (2 - squash), base * squash).setDepth(seat.y * TILE + 14);
    }
    if (stomping) this.scrap(bin.agentId, x, y - 8, now);
    return true;
  }

  private scrap(agentId: string, x: number, y: number, now: number): void {
    if (now - (this.lastScrap.get(agentId) ?? 0) <= 500) return;
    this.lastScrap.set(agentId, now);
    scraps(this.scene, x, y);
  }

  private remove(agentId: string): void {
    this.bins.get(agentId)?.destroy();
    this.bins.delete(agentId);
    for (const img of Object.values(this.images.get(agentId) ?? {})) img?.destroy();
    this.images.delete(agentId);
    this.lastScrap.delete(agentId);
  }
}
