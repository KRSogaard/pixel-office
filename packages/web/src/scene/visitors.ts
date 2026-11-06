import Phaser from "phaser";
import type { AgentState, OfficeStats } from "@pixel-office/protocol";
import type { Appearance } from "../art/characters.js";
import { artStyle } from "../art/style.js";
import { TILE, type Office, type SpotKind } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { Character, type Destination, type Step } from "./Character.js";

/**
 * Visitors: familiar faces and office characters who drop by now and then,
 * wander a few stops, say something silly, and leave. Most come at random
 * (every 3–8 minutes);
 * some react to what's really going on — the Auditor turns up after a scary
 * command, the Investor comments on today's numbers.
 *
 * Each art style has its own cast (`ArtStyle.visitors`): the pixel office gets
 * famous faces, the toon office the Big Boss.
 *
 * `?visitors=fast` in the URL brings one every ~20 seconds, for a preview.
 */

export type VisitorKind = "ceo" | "trump" | "boss" | "consultant" | "intern" | "auditor" | "investor" | "grandpa";

const skin = { skin: "#f6d3b3", skinShade: "#e3b48f" };
const LOOKS: Record<VisitorKind, Appearance> = {
  ceo: { ...skin, hair: "#2b2118", hairStyle: 0, shirt: "#1d1f27", shirtShade: "#111216", pants: "#3d4a8a", shoes: "#e8e8e8" },
  trump: { ...skin, hair: "#e2b75c", hairStyle: 2, shirt: "#2f3a56", shirtShade: "#e8e8e8", pants: "#2f3a56", shoes: "#1e1e22" },
  boss: { ...skin, hair: "#2b2118", hairStyle: 0, shirt: "#3b3f4a", shirtShade: "#c0504d", pants: "#3b3f4a", shoes: "#1e1e22" },
  consultant: { ...skin, hair: "#5a3a22", hairStyle: 2, shirt: "#2f3a56", shirtShade: "#e8e8e8", pants: "#2f3a56", shoes: "#1e1e22" },
  intern: { ...skin, hair: "#a5682f", hairStyle: 1, shirt: "#6fbf73", shirtShade: "#4f9a52", pants: "#46566e", shoes: "#e8e8e8" },
  auditor: { skin: "#eac09a", skinShade: "#d19f77", hair: "#7d8590", hairStyle: 0, shirt: "#5c6370", shirtShade: "#3b3f4a", pants: "#3b3f4a", shoes: "#1e1e22" },
  investor: { ...skin, hair: "#f6d3b3", hairStyle: 0, shirt: "#c8a26e", shirtShade: "#a07a4b", pants: "#2b2f38", shoes: "#5a3a22" },
  grandpa: { skin: "#eac09a", skinShade: "#d19f77", hair: "#e8e8e8", hairStyle: 0, shirt: "#8a5a36", shirtShade: "#6b4226", pants: "#5a4632", shoes: "#2b2118" },
};

const NAMES: Record<VisitorKind, string> = {
  ceo: "Elon Musk",
  trump: "Donald Trump",
  boss: "The Big Boss",
  consultant: "The Consultant",
  intern: "The Lost Intern",
  auditor: "The Auditor",
  investor: "The Investor",
  grandpa: "Grandpa Cobol",
};

const LINES: Record<VisitorKind, string[]> = {
  ceo: [
    "We're shipping this to Mars by Q3.",
    "Can the AI do it in half the tokens?",
    "Make it pop.",
    "What if… it was a platform?",
    "I had an idea in the shower. Drop everything.",
    "Why isn't this on the blockchain yet?",
    "Great. Now do it 10× faster.",
    "I'll buy the repository and rename it X.",
    "What if the compiler was also a car?",
    "This office needs more lasers.",
  ],
  trump: [
    "This is the best code I have ever seen, and trust me, I know code.",
    "Nobody refactors like me. Everybody says so.",
    "We're going to build a firewall, and the bugs are going to pay for it.",
    "This codebase is huge. The biggest. Possibly ever.",
  ],
  boss: [
    "Who's been eating the tokens? I'm docking somebody's pay.",
    "I want that feature yesterday. No — the day before.",
    "Is this what I'm paying you for? Keep going.",
    "Time is money, and you're using both.",
    "Somebody get me a status report on the status reports.",
    "Faster! The competition already shipped it twice.",
    "Nice work. Don't let it go to your head.",
  ],
  consultant: [
    "Have you considered microservices?",
    "Let's circle back on that.",
    "I'm seeing a lot of synergy here.",
    "Have you tried a framework for your framework?",
    "We should align on the alignment.",
    "That'll be four hours, billed as eight.",
    "That's not a bug. It's an unmonetized feature.",
    "Let's take this offline. Then back online. Billable both ways.",
    "I can optimize that, but first we'll need a committee.",
  ],
  intern: [
    "Is this the git room? Which branch am I on?",
    "I pushed to main. Is that bad?",
    "Where do I put my lunch?",
    "Wait, the AIs do all the work?",
    "Is this the coffee machine? It says SILO.",
    "Do I have to go to the stand-up?",
    "I ran npm install and now my laptop is hot.",
    "Can I force-push if I leave a nice note?",
    "The error says 'skill issue'. Is that a dependency?",
  ],
  auditor: [
    "I'll need a word about that command.",
    "Was that rm -rf… approved?",
    "Do we have a change ticket for this?",
    "I'll be taking notes. Carry on.",
    "Interesting. Very interesting.",
    "Who approved this semicolon?",
    "I'll need receipts. Even the digital ones.",
    "I see someone clicked the dangerous merge button.",
  ],
  investor: [
    "Love the energy here.",
    "What's the burn rate on these tokens?",
    "Is it AI-native though?",
    "Can we put this on a slide?",
    "What's the exit strategy for this semicolon?",
    "I don't understand it, but I love the valuation.",
  ],
  grandpa: [
    "Back in my day we compiled overnight.",
    "Is that a mouse? We used punch cards.",
    "These kids and their containers.",
    "COBOL never needed a framework.",
    "I'll just rest my eyes for a minute.",
    "We had one byte. And we were grateful.",
    "The cloud? In my day, that meant rain in the server room.",
    "Debugging used to involve actual moths.",
    "My first computer had less memory than this sandwich.",
  ],
};

export interface VisitorHost {
  office(): Office;
  /** A free tile next to an agent (to talk to them). */
  besideAgent(agentId: string, from: Point): Point | undefined;
  /** Agents currently in the office (not leaving). */
  agents(): AgentState[];
  stats(): OfficeStats | undefined;
  say(id: string, text: string): void;
  /** Show / move / remove the visitor's name tag. */
  tag(id: string, name: string, at: { x: number; y: number } | undefined): void;
  onLeave(kind: VisitorKind): void;
}

interface Visitor {
  id: string;
  kind: VisitorKind;
  c: Character;
  prop: Phaser.GameObjects.Graphics;
  leaving: boolean;
  done: boolean;
}

const fast = new URLSearchParams(location.search).get("visitors") === "fast";
const NEXT_MS = fast ? [15_000, 25_000] : [3 * 60_000, 8 * 60_000];

export class Visitors {
  private visitors: Visitor[] = [];
  private nextAt: number;
  private n = 0;
  private lastKind: VisitorKind | undefined;

  constructor(
    private scene: Phaser.Scene,
    private host: VisitorHost,
  ) {
    this.nextAt = Phaser.Math.Between(fast ? 5000 : 60_000, NEXT_MS[0]!);
  }

  /** Someone ran a scary command: the Auditor will be along shortly. */
  audit(agentId: string): void {
    if (this.visitors.some((v) => v.kind === "auditor")) return;
    this.scene.time.delayedCall(4000, () => this.arrive("auditor", agentId));
  }

  update(dtMs: number, now: number): void {
    if (now > this.nextAt && this.visitors.length < 2) {
      this.nextAt = now + Phaser.Math.Between(NEXT_MS[0]!, NEXT_MS[1]!);
      // The Auditor only comes when called (a scary command).
      const kinds = artStyle().visitors.filter((k): k is VisitorKind => k in LINES && k !== "auditor");
      const choices = kinds.filter((k) => k !== this.lastKind);
      this.arrive(choices[Math.floor(Math.random() * choices.length)]!);
    }
    for (const v of this.visitors) {
      v.c.update(dtMs, now);
      this.drawProp(v, now);
      this.host.tag(v.id, NAMES[v.kind], v.done ? undefined : { x: v.c.x, y: v.c.y });
    }
    for (const v of this.visitors.filter((x) => x.done)) {
      v.c.destroy();
      v.prop.destroy();
      this.host.tag(v.id, NAMES[v.kind], undefined);
      this.host.onLeave(v.kind);
    }
    this.visitors = this.visitors.filter((v) => !v.done);
  }

  /** The office was rebuilt: visitors caught in a wall just leave. */
  relocate(): void {
    const w = this.host.office().walkable;
    for (const v of this.visitors) if (!w[v.c.tile.y]?.[v.c.tile.x]) v.done = true;
  }

  private arrive(kind: VisitorKind, target?: string): void {
    const door = this.door();
    if (!door) return;
    this.lastKind = kind;
    const id = `visitor:${kind}:${++this.n}`;
    const c = new Character(this.scene, `visitor:${kind}`, door, () => this.host.office().walkable, { name: kind, appearance: LOOKS[kind] });
    c.sprite.disableInteractive();
    const v: Visitor = { id, kind, c, prop: this.scene.add.graphics(), leaving: false, done: false };
    this.visitors.push(v);
    c.play([...this.plan(v, target), ...this.exit(v, door)]);
  }

  /** Each visitor's little tour: a few stops, a line at each. */
  private plan(v: Visitor, target?: string): Step[] {
    const say = (text: string) => ({ type: "do" as const, fn: () => this.host.say(v.id, text) });
    const line = () => say(pick(LINES[v.kind]));
    const hold = (ms: number) => ({ type: "hold" as const, ms });
    const toSpot = (kind: SpotKind) => this.goto(v, () => this.spot(kind));
    const toAgent = (id?: string) => this.goto(v, () => {
      const agent = id ?? this.randomAgent()?.id;
      return agent ? this.host.besideAgent(agent, v.c.tile) : undefined;
    });
    const run = v.kind === "ceo";

    switch (v.kind) {
      case "ceo":
        return [toAgent(), line(), hold(2600), this.goto(v, () => this.spot("git"), run), line(), hold(2600), toAgent(), line(), hold(2600)];
      case "trump":
        return [toAgent(), line(), hold(3200), this.goto(v, () => this.spot("git")), line(), hold(3200)];
      case "boss":
        return [toAgent(), line(), hold(2800), toAgent(), line(), hold(2800), toSpot("git"), line(), hold(2400)];
      case "consultant":
        return [toAgent(), line(), hold(2800), toAgent(), line(), hold(2800), say("📄 I'll leave my invoice here."), hold(2000)];
      case "intern":
        return [
          toSpot(pick(["lab", "server", "library", "mail"] as const)), line(), hold(2600),
          toSpot("git"), say(pick(LINES.intern.slice(0, 5))), hold(2600),
          toSpot(pick(["lounge", "reception"] as const)), line(), hold(2400),
        ];
      case "auditor": {
        const who = target ?? this.randomAgent()?.id;
        return [toAgent(who), say(target ? LINES.auditor[0]! : pick(LINES.auditor)), hold(3000), say("📋 *writes something down*"), hold(2200)];
      }
      case "investor":
        return [toSpot("git"), say(this.investorLine("launches")), hold(3000), toSpot("lab"), say(this.investorLine("tests")), hold(3000), toAgent(), line(), hold(2600)];
      case "grandpa":
        return [toSpot("lounge"), { type: "do", fn: () => v.c.goTo({ tile: v.c.tile, facing: "down", pose: "lounge" }) }, line(), hold(4000), line(), hold(9000), say("Zzz…"), hold(5000), line(), hold(2600)];
    }
  }

  private investorLine(topic: "launches" | "tests"): string {
    const t = this.host.stats()?.today;
    if (!t) return "So… what do we actually ship here?";
    if (topic === "launches") {
      return t.launches === 0 ? "No launches today? Hmm." : t.launches >= 5 ? `${t.launches} launches today. I love it.` : `Only ${t.launches} launch${t.launches > 1 ? "es" : ""} today?`;
    }
    if (!t.testRuns) return "Do we… test things?";
    const rate = Math.round((t.testPasses / t.testRuns) * 100);
    return rate >= 80 ? `${rate}% passing. Very investable.` : `${rate}% passing? I'm going to need a minute.`;
  }

  private exit(v: Visitor, door: Point): Step[] {
    return [
      { type: "do", fn: () => (v.leaving = true) },
      this.goto(v, () => door, v.kind === "ceo"),
      { type: "do", fn: () => (v.done = true) },
    ];
  }

  private goto(v: Visitor, where: () => Point | undefined, run = false): Step {
    return {
      type: "goto",
      dest: (): Destination | undefined => {
        const p = where();
        return p ? { tile: p, facing: "down", pose: "stand", run: run || v.kind === "ceo" } : undefined;
      },
    };
  }

  private spot(kind: SpotKind): Point | undefined {
    const spots = this.host.office().spots.filter((s) => s.kind === kind);
    const s = spots[Math.floor(Math.random() * spots.length)];
    return s && { x: s.x, y: s.y };
  }

  private door(): Point | undefined {
    return this.spot("door");
  }

  private randomAgent(): AgentState | undefined {
    const list = this.host.agents();
    return list[Math.floor(Math.random() * list.length)];
  }

  /** Props: the CEO's scooter, the consultant's laptop, the auditor's clipboard, grandpa's walking stick… */
  private drawProp(v: Visitor, now: number): void {
    const g = v.prop.clear().setDepth(v.c.y + 1);
    // Drawn for the pixel figures' hands; other styles draw what their cast carries.
    if (!artStyle().pixelProps) return;
    const x = Math.round(v.c.x);
    const y = Math.round(v.c.y);
    switch (v.kind) {
      case "ceo": // electric scooter
        g.fillStyle(0x3b3f4a, 1).fillRect(x - 6, y - 1, 12, 2);
        g.fillStyle(0x7d8590, 1).fillRect(x + 4, y - 14, 1, 13);
        g.fillStyle(0x3b3f4a, 1).fillRect(x + 2, y - 14, 5, 1);
        g.fillStyle(0x1d1f27, 1).fillRect(x - 6, y, 3, 2).fillRect(x + 3, y, 3, 2);
        break;
      case "trump": // red tie
        g.fillStyle(0xc0504d, 1).fillRect(x, y - 14, 1, 5);
        break;
      case "consultant": // laptop under the arm
        g.fillStyle(0xa9b0ba, 1).fillRect(x + 4, y - 13, 6, 4);
        g.fillStyle(0x7d8590, 1).fillRect(x + 4, y - 10, 6, 1);
        break;
      case "auditor": // clipboard
        g.fillStyle(0x8a5a36, 1).fillRect(x + 4, y - 14, 5, 7);
        g.fillStyle(0xfdfbf5, 1).fillRect(x + 5, y - 13, 3, 5);
        g.fillStyle(0x7d8590, 1).fillRect(x + 5, y - 15, 3, 1);
        break;
      case "intern": // lanyard badge + coffee
        g.fillStyle(0x4fa3d1, 1).fillRect(x - 1, y - 12, 2, 3);
        g.fillStyle(0xfdfbf5, 1).fillRect(x + 5, y - 11, 3, 4);
        g.fillStyle(0x8a5a36, 1).fillRect(x + 5, y - 11, 3, 1);
        break;
      case "investor": // briefcase
        g.fillStyle(0x5a3a22, 1).fillRect(x + 4, y - 8, 7, 5);
        g.fillStyle(0xb8902f, 1).fillRect(x + 7, y - 9, 2, 1).fillRect(x + 7, y - 6, 1, 1);
        break;
      case "grandpa": { // walking stick, tapping as he walks
        const tap = v.c.arrived ? 0 : Math.floor(now / 250) % 2;
        g.fillStyle(0x6b4226, 1).fillRect(x + 6, y - 11 + tap, 1, 11 - tap);
        g.fillStyle(0x6b4226, 1).fillRect(x + 4, y - 11 + tap, 3, 1);
        break;
      }
    }
  }
}

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}
