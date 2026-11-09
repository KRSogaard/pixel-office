import type { OfficeStats } from "@pixel-office/protocol";
import { TILE, type Office } from "../office/layout.js";
import type { WorldListener } from "./events.js";
import type { Person } from "./person.js";
import { between, pick } from "./random.js";

/**
 * The statue of the Almighty Prompter (you) in the meeting room, and the
 * small religion around it:
 *  - its plaque changes every little while;
 *  - an agent that has waited on you too long leaves its chair, kneels before
 *    the statue and prays (they all bow in time with each other);
 *  - offerings pile up at its feet through the day: a coffee cup for every
 *    coffee break, a crashed rocket for every failed push, a red ✗ for every
 *    failed test run (from today's stats, so they clear at midnight);
 *  - when you answer, the statue's eyes glow and a beam of light falls on the
 *    agent ("It has spoken."); when you deny it, a storm cloud rains on it.
 */

/** Waiting on you longer than this: off to kneel before the statue. */
export const KNEEL_AFTER_MS = 60_000;
/** How long one plaque stays up. */
const PLAQUE_MS = 15_000;
/** At most this many offerings of each kind at the statue's feet. */
const MAX_EACH = 6;

const PLAQUES = [
  "THE ALMIGHTY PROMPTER · He Who Approves",
  "Blessed Be The Y/N",
  "Thou Shalt Not --force Push",
  "In Prompts We Trust",
  "Our Prompter, Who Art In Terminal",
  "Ask, And It Shall Be Approved (Eventually)",
  "Give Us This Day Our Daily Tokens",
];

const PRAYERS = [
  "O Prompter, grant me Bash permission 🙏",
  "Please press Y. Please press Y.",
  "I promise I won't rm -rf again",
  "Our Prompter, who art in terminal…",
  "Forgive me my force-pushes 🙏",
  "Hallowed be thy keyboard",
  "Thy will be done, in prod as it is in staging",
  "I have been a good agent 🥺",
];

export interface Offering {
  emoji: string;
  /** World pixels: where it sits on the floor. */
  x: number;
  y: number;
  /** Degrees: a crashed rocket lies on its side. */
  angle: number;
}

export interface ShrineHost {
  office(): Office;
  stats(): OfficeStats | undefined;
  say(id: string, text: string): void;
  emit: WorldListener;
  sfx: { choir(): void; thunder(): void };
}

export class Shrine {
  private nextPrayer = new Map<string, number>();

  constructor(private host: ShrineHost) {}

  /** The statue's two tiles, if this office has one. */
  get statue(): { x: number; y: number } | undefined {
    return this.host.office().statue;
  }

  /** What the plaque says right now. */
  plaque(now: number): string {
    return PLAQUES[Math.floor(now / PLAQUE_MS) % PLAQUES.length]!;
  }

  /** Has this agent been waiting on you long enough to go and kneel? */
  shouldKneel(waitingSince: number | undefined): boolean {
    return !!this.statue && waitingSince !== undefined && Date.now() - waitingSince > KNEEL_AFTER_MS;
  }

  /** Kneelers pray out loud now and then (not all at once). */
  pray(kneelers: { id: string }[], now: number): void {
    const here = new Set(kneelers.map((k) => k.id));
    for (const id of this.nextPrayer.keys()) if (!here.has(id)) this.nextPrayer.delete(id);
    for (const { id } of kneelers) {
      const due = this.nextPrayer.get(id);
      if (due === undefined) {
        this.nextPrayer.set(id, now + between(1500, 4000));
      } else if (now >= due) {
        this.host.say(id, pick(PRAYERS));
        this.nextPrayer.set(id, now + between(9000, 16000));
      }
    }
  }

  /** You answered an agent: the statue reacts. */
  answered(id: string, person: Person, outcome: "approved" | "denied"): void {
    const s = this.statue;
    if (outcome === "approved") {
      this.host.emit({
        type: "blessed",
        x: person.x,
        y: person.y,
        ...(s ? { statue: { x: (s.x + 1) * TILE, y: s.y * TILE } } : {}),
      });
      this.host.say(id, "It has spoken. 🙌");
      this.host.sfx.choir();
    } else {
      this.host.emit({ type: "storm", id, x: person.x, y: person.y });
      this.host.say(id, pick(["The Prompter has spoken… no. 🌧", "I have angered the Prompter 🌧", "Denied. I'll reflect on my choices 🌧"]));
      this.host.sfx.thunder();
    }
  }

  /** Today's offerings, laid out along the front of the plinth. */
  offerings(): Offering[] {
    const s = this.statue;
    const today = this.host.stats()?.today;
    if (!s || !today) return [];
    const kinds: { emoji: string; n: number; angle: number }[] = [
      { emoji: "☕", n: today.coffeeBreaks ?? 0, angle: 0 },
      { emoji: "🚀", n: today.failedPushes ?? 0, angle: 125 },
      { emoji: "❌", n: Math.max(0, today.testRuns - today.testPasses), angle: 0 },
    ];
    const items = kinds.flatMap((k) => Array.from({ length: Math.min(MAX_EACH, k.n) }, () => ({ emoji: k.emoji, angle: k.angle })));
    // Two rows across the statue's two tiles, at its feet; a little jitter so it looks like a pile.
    const left = s.x * TILE + 3;
    const width = 2 * TILE - 6;
    const perRow = Math.max(1, Math.ceil(items.length / 2));
    return items.map((it, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const jitter = ((i * 7) % 5) - 2;
      return {
        ...it,
        x: left + (perRow === 1 ? width / 2 : (col / (perRow - 1)) * width),
        y: (s.y + 1) * TILE - 1 + row * 4 + jitter * 0.5,
        angle: it.angle + jitter * 6,
      };
    });
  }
}
