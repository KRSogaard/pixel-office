import type Phaser from "phaser";
import { isShipCommand, isTestRun, type AgentState, type ToolCall } from "@pixel-office/protocol";
import { TILE, type Office, type TeamArea } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import type { Character } from "./Character.js";
import { confetti, duck, fire, printPages, sweat } from "./effects.js";
import type { Extras } from "./extras.js";
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
  c: Character;
  agent: AgentState;
}

export interface AnticsHost {
  scene: Phaser.Scene;
  extras: Extras;
  silo: RocketSilo;
  actors(): Iterable<ActorView>;
  say(agentId: string, text: string): void;
  office(): Office;
  team(sessionId: string): TeamArea | undefined;
  /** A tile in the mailroom (where couriers start). */
  mailroom(): Point | undefined;
  /** A tile in the lounge (where pizza goes). */
  lounge(): Point | undefined;
}

const SCARY = /\b(rm -rf|rm -fr|--force\b|push -f\b|reset --hard|drop (table|database)|truncate table|sudo |chmod -R 777|mkfs|dd if=|kubectl delete|terraform destroy)/i;
const DOCUMENT = /\.(md|mdx|txt|rst|adoc|pdf|docx)\b|README|CHANGELOG/i;
const DUCK_AFTER_MS = 20_000;
const YAWN_AFTER_MS = 2 * 60 * 60_000;
const PIZZA_EVERY_MS = 20 * 60_000;
const PIZZA_CROWD = 5;

export class Antics {
  private prev = new Map<string, AgentState>();
  private ducks = new Map<string, Phaser.GameObjects.Graphics>();
  private lastCourier = new Map<string, number>();
  private lastPrint = new Map<string, number>();
  private lastYawn = new Map<string, number>();
  private lastPizza = -Infinity;
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
      actor.c.cheer(now);
      confetti(this.host.scene, actor.c.x, actor.c.y);
      this.host.say(next.id, "🎉 All done!");
    }
  }

  /** Per-frame gags: rubber ducks, yawns, pizza. */
  tick(now: number): void {
    const wall = Date.now();
    for (const a of this.host.actors()) {
      const pose = a.c.destination?.pose;
      const pondering = a.c.arrived && pose === "think" && a.agent.activity === "thinking" && wall - a.agent.activitySince > DUCK_AFTER_MS;
      const existing = this.ducks.get(a.id);
      if (pondering && !existing) {
        const t = a.c.tile;
        this.ducks.set(a.id, duck(this.host.scene, t.x * TILE + 4, (t.y - 1) * TILE + 6));
        this.host.say(a.id, "🦆 *squeak*");
      } else if (!pondering && existing) {
        existing.destroy();
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
        });
      }
    }
  }

  forget(agentId: string): void {
    this.prev.delete(agentId);
    this.ducks.get(agentId)?.destroy();
    this.ducks.delete(agentId);
  }

  private onNewCall(actor: ActorView, call: ToolCall, now: number): void {
    const { scene } = this.host;
    if (SCARY.test(call.summary)) {
      sweat(scene, actor.c.x, actor.c.y);
      this.host.say(actor.id, "😬");
      for (const other of this.host.actors()) {
        if (other.id === actor.id) continue;
        if (Math.abs(other.c.tile.x - actor.c.tile.x) + Math.abs(other.c.tile.y - actor.c.tile.y) <= 5) this.host.say(other.id, "😱");
      }
    }
    if (isShipCommand(call.tool, call.summary)) {
      this.host.silo.launch(`${actor.agent.name}: ${call.summary.replace(/^Bash: /, "")}`);
    }
    if (call.category === "mcp" && now - (this.lastCourier.get(actor.id) ?? -Infinity) > 15_000) {
      const from = this.host.mailroom();
      if (from) {
        this.lastCourier.set(actor.id, now);
        this.host.extras.courier(from, () => actor.c.tile, () => this.host.say(actor.id, "📨 Thanks!"));
      }
    }
    if (call.category === "edit" && DOCUMENT.test(call.summary)) {
      const team = this.host.team(actor.agent.sessionId);
      if (team && now - (this.lastPrint.get(team.sessionId) ?? -Infinity) > 8000) {
        this.lastPrint.set(team.sessionId, now);
        printPages(scene, team.printer.x * TILE + 8, team.printer.y * TILE + 9);
      }
    }
  }

  /** Two failed test runs in a row: the nearest lab bench catches fire. */
  private labFire(actor: ActorView): void {
    const o = this.host.office();
    let best: Point | undefined;
    o.tiles.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c !== "J") return;
        const d = Math.abs(x - actor.c.tile.x) + Math.abs(y - actor.c.tile.y);
        if (!best || d < Math.abs(best.x - actor.c.tile.x) + Math.abs(best.y - actor.c.tile.y)) best = { x, y };
      }),
    );
    const at = best ?? actor.c.tile;
    fire(this.host.scene, at.x * TILE + 8, at.y * TILE + 6);
    this.host.say(actor.id, "🔥 This is fine.");
  }
}

/** How many of the agent's most recent finished test runs failed in a row. */
function failStreak(a: AgentState): number {
  let n = 0;
  const runs = a.recentTools.filter((c) => c.endedAt !== undefined && isTestRun(c.tool, c.summary));
  for (let i = runs.length - 1; i >= 0 && runs[i]!.ok === false; i--) n++;
  return n;
}
