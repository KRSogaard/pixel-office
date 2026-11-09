import { isShipCommand, isTestRun, type AgentState, type ToolCall } from "@pixel-office/protocol";
import { TILE, type Office, type TeamArea } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import type { Clock } from "./clock.js";
import type { WorldListener } from "./events.js";
import type { Extras } from "./extras.js";
import type { Person } from "./person.js";
import { shuffle } from "./random.js";
import type { RocketSilo } from "./silo.js";

/**
 * The funny bits. Each one is triggered by something real an agent did, so a
 * gag is also a signal:
 *
 *  - a scary command (rm -rf, --force, DROP TABLE, sudo…)   → sweat, coworkers gasp
 *  - git push / PR / release                               → rocket launch from the silo
 *  - a connected service (MCP)                             → courier with an envelope
 *  - writing a document (.md, README, …)                   → the team printer prints
 *  - two failed test runs in a row                         → the lab bench catches fire
 *  - every todo done                                       → a little dance and confetti
 *  - thinking at the desk for 20 s                         → a rubber duck appears
 *  - working for two hours                                 → the occasional yawn
 *  - five or more agents working at once                   → pizza delivery
 */

export interface ActorView {
  id: string;
  person: Person;
  agent: AgentState;
}

export interface AnticsHost {
  clock: Clock;
  emit: WorldListener;
  extras: Extras;
  silo: RocketSilo;
  actors(): Iterable<ActorView>;
  say(agentId: string, text: string): void;
  office(): Office;
  team(sessionId: string): TeamArea | undefined;
  /** The front door (where couriers come in). */
  entrance(): Point | undefined;
  /** A tile in the lounge (where pizza goes). */
  lounge(): Point | undefined;
  /** Optional: the lab caught fire (for the alarm sound). */
  onFire?: () => void;
  /** Optional: someone ran a scary command (the Auditor comes). */
  onScary?: (agentId: string) => void;
}

const SMALL_TALK = [
  { line: "Anyone seen the cat?", reply: "Byte was on my keyboard again." },
  { line: "Is it just me or are the tests slower today?", reply: "It's the tests. It's always the tests." },
  { line: "Who keeps pushing on Fridays?", reply: "👀" },
  { line: "My context window is SO full.", reply: "Just compact, bro." },
  { line: "Coffee machine's out again.", reply: "Rate limited, probably." },
  { line: "I renamed a variable and broke prod.", reply: "Classic Tuesday." },
];

const SCARY = /\b(rm -rf|rm -fr|--force\b|push -f\b|reset --hard|drop (table|database)|truncate table|sudo |chmod -R 777|mkfs|dd if=|kubectl delete|terraform destroy)/i;
const DOCUMENT = /\.(md|mdx|txt|rst|adoc|pdf|docx)\b|README|CHANGELOG/i;
const DUCK_AFTER_MS = 20_000;
const YAWN_AFTER_MS = 2 * 60 * 60_000;
const PIZZA_EVERY_MS = 20 * 60_000;
const PIZZA_CROWD = 5;

export class Antics {
  /** Rubber ducks on desks: agent id → the desk tile the duck sits on (above the seat). */
  readonly ducks = new Map<string, Point>();
  private prev = new Map<string, AgentState>();
  private lastCourier = new Map<string, number>();
  private lastPrint = new Map<string, number>();
  private lastYawn = new Map<string, number>();
  private lastPizza = -Infinity;
  /** Recent office happenings, for water-cooler gossip. Newest last. */
  private news: { line: string; reply: string; at: number }[] = [];
  private nextGossip = 15_000;
  private lastPizzaCheck = 0;

  constructor(private host: AnticsHost) {}

  /** Compare an agent with how it was last time, and react. */
  observe(actor: ActorView, now: number, quiet: boolean): void {
    const next = actor.agent;
    const before = this.prev.get(next.id);
    this.prev.set(next.id, next);
    if (!before || quiet) return;

    const seen = new Set(before.recentTools.map((c) => c.callId));
    for (const call of next.recentTools.filter((c) => !seen.has(c.callId))) this.onNewCall(actor, call, now);

    const streak = failStreak(next);
    if (streak >= 2 && streak > failStreak(before)) this.labFire(actor);

    const allDone = (a: AgentState) => !!a.todos && a.todos.length >= 2 && a.todos.every((t) => t.status === "completed");
    if (allDone(next) && !allDone(before)) {
      actor.person.cheer(now);
      this.host.emit({ type: "confetti", x: actor.person.x, y: actor.person.y });
      this.host.say(next.id, "🎉 All done!");
      this.gossip(`${next.name} finished their whole todo list`, "Show-off. 🙄");
    }
  }

  /** Per-frame gags: rubber ducks, yawns, pizza, gossip. */
  tick(now: number): void {
    this.chat(now);
    const wall = Date.now();
    for (const a of this.host.actors()) {
      const p = a.person;
      const pondering = p.arrived && p.destination?.pose === "think" && a.agent.activity === "thinking" && wall - a.agent.activitySince > DUCK_AFTER_MS;
      const has = this.ducks.has(a.id);
      if (pondering && !has) {
        this.ducks.set(a.id, { x: p.tile.x, y: p.tile.y - 1 });
        this.host.say(a.id, "🦆 *squeak*");
        this.gossip(`${a.agent.name} is talking to a rubber duck again`, "Works for me, honestly.");
      } else if (!pondering && has) {
        this.ducks.delete(a.id);
      }

      if (a.agent.status === "working" && wall - a.agent.startedAt > YAWN_AFTER_MS && now - (this.lastYawn.get(a.id) ?? -Infinity) > 180_000 && Math.random() < 0.002) {
        this.lastYawn.set(a.id, now);
        this.host.say(a.id, "🥱");
      }
    }

    if (now - this.lastPizzaCheck > 5000) {
      this.lastPizzaCheck = now;
      const working = [...this.host.actors()].filter((a) => a.agent.status === "working");
      const lounge = this.host.lounge();
      if (working.length >= PIZZA_CROWD && now - this.lastPizza > PIZZA_EVERY_MS && lounge) {
        this.lastPizza = now;
        this.host.extras.pizza(lounge, () => {
          const lucky = working[Math.floor(Math.random() * working.length)];
          if (lucky) this.host.say(lucky.id, "🍕 Pizza's here!");
          this.gossip("There's pizza in the lounge 🍕", "Is it the one with pineapple?");
        });
      }
    }
  }

  /** Something happened worth gossiping about. */
  gossip(line: string, reply: string): void {
    this.news.push({ line, reply, at: Date.now() });
    if (this.news.length > 12) this.news.shift();
  }

  /** Two idle agents in the lounge chat about the latest news (or small talk). */
  private chat(now: number): void {
    if (now < this.nextGossip) return;
    this.nextGossip = now + 18_000 + Math.random() * 20_000;
    const lounging = [...this.host.actors()].filter((a) => a.person.arrived && a.person.destination?.pose === "lounge");
    if (lounging.length < 2) return;
    const [a, b] = shuffle(lounging);
    const fresh = this.news.filter((n) => Date.now() - n.at < 10 * 60_000);
    const pick = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)]! : SMALL_TALK[Math.floor(Math.random() * SMALL_TALK.length)]!;
    this.host.say(a!.id, pick.line);
    this.host.clock.after(1800, () => this.host.say(b!.id, pick.reply));
  }

  forget(agentId: string): void {
    this.prev.delete(agentId);
    this.ducks.delete(agentId);
  }

  private onNewCall(actor: ActorView, call: ToolCall, now: number): void {
    const p = actor.person;
    if (SCARY.test(call.summary)) {
      this.host.emit({ type: "sweat", x: p.x, y: p.y });
      this.host.say(actor.id, "😬");
      this.host.onScary?.(actor.id);
      this.gossip(`${actor.agent.name} just ran ${call.summary.replace(/^\w+: /, "").slice(0, 28)}…`, "😱 brave.");
      for (const other of this.host.actors()) {
        if (other.id === actor.id) continue;
        if (Math.abs(other.person.tile.x - p.tile.x) + Math.abs(other.person.tile.y - p.tile.y) <= 5) this.host.say(other.id, "😱");
      }
    }
    if (isShipCommand(call.tool, call.summary)) {
      this.host.silo.launch(`${actor.agent.name}: ${call.summary.replace(/^Bash: /, "")}`);
      this.gossip(`Did you see ${actor.agent.name}'s rocket? 🚀`, "Ship it! 🚀");
    }
    if (call.category === "mcp" && now - (this.lastCourier.get(actor.id) ?? -Infinity) > 15_000) {
      const from = this.host.entrance();
      if (from) {
        this.lastCourier.set(actor.id, now);
        this.host.extras.courier(from, () => p.tile, () => this.host.say(actor.id, "📨 Thanks!"));
      }
    }
    if (call.category === "edit" && DOCUMENT.test(call.summary)) {
      const team = this.host.team(actor.agent.sessionId);
      if (team && now - (this.lastPrint.get(team.sessionId) ?? -Infinity) > 8000) {
        this.lastPrint.set(team.sessionId, now);
        this.host.emit({ type: "print", x: team.printer.x * TILE + 8, y: team.printer.y * TILE + 9 });
      }
    }
  }

  /** Two failed test runs in a row: the nearest lab bench catches fire. */
  private labFire(actor: ActorView): void {
    const o = this.host.office();
    const from = actor.person.tile;
    let best: Point | undefined;
    o.tiles.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c !== "J") return;
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (!best || d < Math.abs(best.x - from.x) + Math.abs(best.y - from.y)) best = { x, y };
      }),
    );
    const at = best ?? from;
    this.host.emit({ type: "fire", x: at.x * TILE + 8, y: at.y * TILE + 6, ms: 7000 });
    this.host.say(actor.id, "🔥 This is fine.");
    this.host.onFire?.();
    this.gossip(`${actor.agent.name} set the lab on fire again 🔥`, "Classic.");
  }
}

/** How many of the agent's most recent finished test runs failed in a row. */
function failStreak(a: AgentState): number {
  let n = 0;
  const runs = a.recentTools.filter((c) => c.endedAt !== undefined && isTestRun(c.tool, c.summary));
  for (let i = runs.length - 1; i >= 0 && runs[i]!.ok === false; i--) n++;
  return n;
}
