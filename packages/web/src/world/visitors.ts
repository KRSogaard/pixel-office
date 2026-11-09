import type { AgentState, OfficeStats } from "@pixel-office/protocol";
import type { Office, SpotKind } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import type { Clock } from "./clock.js";
import { Person, type Destination, type Step } from "./person.js";
import { between, pick } from "./random.js";

/**
 * Visitors: familiar faces and office characters who drop by now and then,
 * wander a few stops, say something silly, and leave. Most come at random
 * (every 3–8 minutes); some react to what's really going on — the Auditor
 * turns up after a scary command, the Investor comments on today's numbers.
 *
 * Which visitors come depends on the art style (each has its own cast).
 *
 * `?visitors=fast` in the URL brings one every ~20 seconds, for a preview.
 */

export type VisitorKind = "ceo" | "trump" | "boss" | "consultant" | "intern" | "auditor" | "investor" | "grandpa";

export const VISITOR_NAMES: Record<VisitorKind, string> = {
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
  onLeave(kind: VisitorKind): void;
}

export interface Visitor {
  id: string;
  kind: VisitorKind;
  name: string;
  person: Person;
  done: boolean;
}

const fast = new URLSearchParams(location.search).get("visitors") === "fast";
const NEXT_MS = fast ? [15_000, 25_000] : [3 * 60_000, 8 * 60_000];

export class Visitors {
  list: Visitor[] = [];
  private nextAt: number;
  private n = 0;
  private lastKind: VisitorKind | undefined;

  constructor(
    private clock: Clock,
    private host: VisitorHost,
    /** Who drops by in this art style. */
    private cast: readonly string[],
  ) {
    this.nextAt = between(fast ? 5000 : 60_000, NEXT_MS[0]!);
  }

  /** Someone ran a scary command: the Auditor will be along shortly. */
  audit(agentId: string): void {
    if (this.list.some((v) => v.kind === "auditor")) return;
    this.clock.after(4000, () => this.arrive("auditor", agentId));
  }

  update(dtMs: number, now: number): void {
    if (now > this.nextAt && this.list.length < 2) {
      this.nextAt = now + between(NEXT_MS[0]!, NEXT_MS[1]!);
      // The Auditor only comes when called (a scary command).
      const kinds = this.cast.filter((k): k is VisitorKind => k in LINES && k !== "auditor");
      const choices = kinds.filter((k) => k !== this.lastKind);
      if (choices.length) this.arrive(pick(choices));
    }
    for (const v of this.list) v.person.update(dtMs, now);
    for (const v of this.list.filter((x) => x.done)) this.host.onLeave(v.kind);
    this.list = this.list.filter((v) => !v.done);
  }

  /** The office was rebuilt: visitors caught in a wall just leave. */
  relocate(): void {
    const w = this.host.office().walkable;
    for (const v of this.list) if (!w[v.person.tile.y]?.[v.person.tile.x]) v.done = true;
  }

  private arrive(kind: VisitorKind, target?: string): void {
    const door = this.door();
    if (!door) return;
    this.lastKind = kind;
    const id = `visitor:${kind}:${++this.n}`;
    const person = new Person(id, { cast: kind }, door, () => this.host.office().passable);
    const v: Visitor = { id, kind, name: VISITOR_NAMES[kind], person, done: false };
    this.list.push(v);
    person.play([...this.plan(v, target), ...this.exit(v, door)]);
  }

  /** Each visitor's little tour: a few stops, a line at each. */
  private plan(v: Visitor, target?: string): Step[] {
    const say = (text: string) => ({ type: "do" as const, fn: () => this.host.say(v.id, text) });
    const line = () => say(pick(LINES[v.kind]));
    const hold = (ms: number) => ({ type: "hold" as const, ms });
    const toSpot = (kind: SpotKind) => this.goto(v, () => this.spot(kind));
    const toAgent = (id?: string) =>
      this.goto(v, () => {
        const agent = id ?? this.randomAgent()?.id;
        return agent ? this.host.besideAgent(agent, v.person.tile) : undefined;
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
          toSpot(pick(["lab", "server", "web"] as const)), line(), hold(2600),
          toSpot("git"), say(pick(LINES.intern.slice(0, 5))), hold(2600),
          toSpot(pick(["lounge", "meeting"] as const)), line(), hold(2400),
        ];
      case "auditor": {
        const who = target ?? this.randomAgent()?.id;
        const audit = [toAgent(who), say(target ? LINES.auditor[0]! : pick(LINES.auditor)), hold(3000), say("📋 *writes something down*"), hold(2200)];
        // Now and then the gold statue in the meeting room catches the Auditor's eye.
        if (!this.host.office().statue || Math.random() > 0.4) return audit;
        return [...audit, toSpot("shrine"), say("I'll need to see a receipt for this gold."), hold(3200)];
      }
      case "investor":
        return [toSpot("git"), say(this.investorLine("launches")), hold(3000), toSpot("lab"), say(this.investorLine("tests")), hold(3000), toAgent(), line(), hold(2600)];
      case "grandpa":
        return [toSpot("lounge"), { type: "do", fn: () => v.person.goTo({ tile: v.person.tile, facing: "down", pose: "lounge" }) }, line(), hold(4000), line(), hold(9000), say("Zzz…"), hold(5000), line(), hold(2600)];
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
    return [this.goto(v, () => door, v.kind === "ceo"), { type: "do", fn: () => (v.done = true) }];
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
}
