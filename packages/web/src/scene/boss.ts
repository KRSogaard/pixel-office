import type Phaser from "phaser";
import type { Appearance } from "../art/characters.js";
import type { Office } from "../office/layout.js";
import { Character, type Destination } from "./Character.js";

/**
 * You. You stand behind the reception counter, so agents that need you queue up
 * right in front of you. When you send a prompt, you walk over to that agent's
 * desk with a note, hand it over, and walk back.
 */

const LOOK: Appearance = {
  skin: "#f6d3b3",
  skinShade: "#e3b48f",
  hair: "#5a3a22",
  hairStyle: 2,
  shirt: "#2b2f38",
  shirtShade: "#c0504d", // the tie shows as the collar shade
  pants: "#2b2f38",
  shoes: "#1e1e22",
};

export const BOSS_ID = "boss";

interface Delivery {
  agentId: string;
  text: string;
}

export interface BossHost {
  office(): Office;
  /** A spot next to an agent to hand them the note. */
  beside(agentId: string, from: { x: number; y: number }): Destination | undefined;
  say(id: string, text: string): void;
}

export class Boss {
  readonly c: Character;
  private queue: Delivery[] = [];

  constructor(
    scene: Phaser.Scene,
    private host: BossHost,
  ) {
    const home = host.office().boss;
    this.c = new Character(scene, BOSS_ID, home, () => host.office().walkable, LOOK);
    this.goHome();
  }

  /** You sent `text` to an agent: walk it over (or queue it if you're already out). */
  deliver(agentId: string, text: string): void {
    if (this.c.busyWithScript) {
      if (this.queue.length < 3) this.queue.push({ agentId, text });
      return;
    }
    this.run({ agentId, text });
  }

  /** The office was rebuilt: your spot may have moved. */
  relocate(): void {
    if (!this.c.busyWithScript) {
      this.c.placeAt(this.host.office().boss);
      this.goHome();
    }
  }

  update(dtMs: number, now: number): void {
    this.c.update(dtMs, now);
  }

  private run(d: Delivery): void {
    const note = d.text.length > 60 ? `${d.text.slice(0, 59)}…` : d.text;
    this.c.play([
      { type: "goto", dest: () => this.host.beside(d.agentId, this.c.tile) },
      { type: "do", fn: () => this.host.say(BOSS_ID, `📝 ${note}`) },
      { type: "hold", ms: 1400 },
      { type: "do", fn: () => this.host.say(d.agentId, "👍 On it, boss") },
      { type: "hold", ms: 900 },
      { type: "goto", dest: () => this.home() },
      {
        type: "do",
        fn: () => {
          const next = this.queue.shift();
          if (next) this.run(next);
        },
      },
    ]);
  }

  private home(): Destination {
    const h = this.host.office().boss;
    return { tile: { x: h.x, y: h.y }, facing: "down", pose: "stand" };
  }

  private goHome(): void {
    this.c.goTo(this.home());
  }
}
