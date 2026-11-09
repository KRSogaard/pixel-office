import { isTestRun, runningJobs, type AgentState, type Job } from "@pixel-office/protocol";
import type { Allocator } from "../office/allocator.js";
import type { Office, SpotKind } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { Person, type Destination } from "./person.js";

/**
 * Job robots: every command an agent leaves running in the background (a
 * build, a test run) is a little robot. It rolls from the agent's desk to
 * where that kind of work happens — the test lab for tests, the server room
 * for anything else — and works there while the agent waits at its desk. When
 * the job finishes it rolls back and hands over the result (✓ or ✗).
 */

export interface Bot {
  /** `job:` + the tool call that started the job. */
  id: string;
  agentId: string;
  sessionId: string;
  job: Job;
  /** Where it works: the test lab or the server room. */
  room: SpotKind;
  /** Walks (rolls) like a person; drawn as a robot. */
  person: Person;
  /** Working at its station (vs rolling there or back). */
  working: boolean;
  /** The job's result, once it's on its way back with it. */
  result: boolean | undefined;
  done: boolean;
}

export interface BotHost {
  office(): Office;
  allocator: Allocator;
  /** Where the agent is now (its tile), if it's still in the office. */
  agentTile(agentId: string): Point | undefined;
  say(id: string, text: string): void;
}

export class Bots {
  list: Bot[] = [];
  /** Jobs that already have (or had) a robot. */
  private seen = new Set<string>();

  constructor(private host: BotHost) {}

  /**
   * Keep a robot for every running job. `initial`: the page just loaded, so
   * robots start at their station instead of rolling out of the desk.
   */
  sync(agents: Iterable<{ agent: AgentState; from: Point }>, initial: boolean): void {
    const now = Date.now();
    for (const { agent, from } of agents) {
      for (const job of agent.jobs ?? []) {
        const id = `job:${job.callId}`;
        const bot = this.list.find((b) => b.id === id);
        if (bot) {
          if (job.endedAt !== undefined && bot.result === undefined) this.finish(bot, job.ok ?? false);
          continue;
        }
        if (this.seen.has(id) || !runningJobs({ jobs: [job] }, now).length) continue;
        this.seen.add(id);
        this.spawn(id, agent, job, from, initial);
      }
    }
  }

  update(dtMs: number, now: number): void {
    for (const b of this.list) b.person.update(dtMs, now);
    for (const b of this.list.filter((x) => x.done)) this.host.allocator.remove(b.id);
    this.list = this.list.filter((b) => !b.done);
  }

  /** The office was rebuilt: robots re-route (to the same kind of room). */
  relocate(): void {
    for (const b of this.list) {
      const t = b.person.tile;
      if (!this.host.office().walkable[t.y]?.[t.x]) b.person.placeAt(this.host.agentTile(b.agentId) ?? t);
      b.person.repath();
    }
  }

  private spawn(id: string, agent: AgentState, job: Job, from: Point, initial: boolean): void {
    const room: SpotKind = isTestRun("Bash", job.summary) ? "lab" : "server";
    const person = new Person(id, { cast: "robot" }, from, () => this.host.office().passable);
    const bot: Bot = { id, agentId: agent.id, sessionId: agent.sessionId, job, room, person, working: false, result: undefined, done: false };
    this.list.push(bot);
    const station = (): Destination | undefined => {
      const spot = this.host.allocator.reserve(id, room, person.tile);
      return spot && { tile: { x: spot.x, y: spot.y }, facing: spot.facing, pose: "station" };
    };
    if (initial) {
      const d = station();
      if (d) person.placeAt(d.tile);
    }
    person.play([
      { type: "goto", dest: station },
      { type: "do", fn: () => (bot.working = true) },
      // Works until the job ends (finish() replaces this).
      { type: "hold", ms: 24 * 60 * 60_000 },
    ]);
  }

  /** The job ended: roll back to the agent with the result, then off. */
  private finish(bot: Bot, ok: boolean): void {
    bot.result = ok;
    bot.working = false;
    this.host.allocator.release(bot.id);
    const label = bot.job.label ?? bot.job.summary.replace(/^\w+: /, "");
    bot.person.play([
      {
        type: "goto",
        dest: () => {
          const at = this.host.agentTile(bot.agentId);
          const w = this.host.office().passable;
          const near = at && [{ x: at.x + 1, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x, y: at.y + 1 }, { x: at.x, y: at.y - 1 }].find((q) => w[q.y]?.[q.x]);
          return near ? { tile: near, facing: "up", pose: "stand", run: true } : undefined;
        },
      },
      { type: "do", fn: () => this.host.say(bot.id, ok ? `✓ ${label}` : `✗ ${label}`) },
      { type: "hold", ms: 2200 },
      { type: "do", fn: () => (bot.done = true) },
    ]);
  }
}
