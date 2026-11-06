import Phaser from "phaser";
import type { AgentState } from "@pixel-office/protocol";
import { propImage } from "../art/style.js";
import { TILE } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { scraps } from "./effects.js";

/**
 * A wastepaper bin beside each agent's desk that fills up with paper as the
 * agent's context window fills: green, then amber, then red and overflowing.
 * While the agent compacts it gets stomped flat.
 */
export class ContextBins {
  private bins = new Map<string, Phaser.GameObjects.Graphics>();
  /** Styles with bin images: an empty, half-full and overflowing bin per agent. */
  private images = new Map<string, Record<"bin-empty" | "bin-half" | "bin-full", Phaser.GameObjects.Image | undefined>>();
  private lastScrap = new Map<string, number>();

  constructor(private scene: Phaser.Scene) {}

  /** Draw (or move) the bin for `agent`, standing on the floor tile right of its seat. */
  update(agent: AgentState, seat: Point | undefined, now: number): void {
    let g = this.bins.get(agent.id);
    if (!seat || !agent.context) {
      g?.setVisible(false);
      for (const img of Object.values(this.images.get(agent.id) ?? {})) img?.setVisible(false);
      return;
    }
    if (this.updateImage(agent, seat, now)) return;
    if (!g) {
      g = this.scene.add.graphics();
      this.bins.set(agent.id, g);
    }
    const fill = Math.min(1, agent.context.tokens / agent.context.limit);
    const stomping = agent.activity === "compact";
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
    if (stomping && now - (this.lastScrap.get(agent.id) ?? 0) > 500) {
      this.lastScrap.set(agent.id, now);
      scraps(this.scene, x + 4, top);
    }
  }

  /** Draw the bin with the style's images. False when the style has none. */
  private updateImage(agent: AgentState, seat: Point, now: number): boolean {
    let imgs = this.images.get(agent.id);
    if (!imgs) {
      imgs = { "bin-empty": propImage(this.scene, "bin-empty"), "bin-half": propImage(this.scene, "bin-half"), "bin-full": propImage(this.scene, "bin-full") };
      this.images.set(agent.id, imgs);
    }
    if (!imgs["bin-empty"] || !imgs["bin-half"] || !imgs["bin-full"]) return false;
    const fill = Math.min(1, agent.context!.tokens / agent.context!.limit);
    const stomping = agent.activity === "compact";
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
    if (stomping && now - (this.lastScrap.get(agent.id) ?? 0) > 500) {
      this.lastScrap.set(agent.id, now);
      scraps(this.scene, x, y - 8);
    }
    return true;
  }

  remove(agentId: string): void {
    this.bins.get(agentId)?.destroy();
    this.bins.delete(agentId);
    for (const img of Object.values(this.images.get(agentId) ?? {})) img?.destroy();
    this.images.delete(agentId);
  }
}
