import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isShipCommand,
  isTestRun,
  type AchievementId,
  type AgentEvent,
  type OfficeState,
  type OfficeStats,
  type StatCounters,
} from "@pixel-office/protocol";

/**
 * The numbers behind the production board and the achievements: today's and
 * all-time counters, tool calls per hour, and unlocked achievements. Fed every
 * applied event with the office state before and after it. Saved to
 * DATA_DIR/stats.json so a restart doesn't wipe the scoreboard.
 */

const COMMIT = /\bgit commit\b/i;
const SCARY = /\b(rm -rf|rm -fr|--force\b|push -f\b|reset --hard|drop (table|database)|truncate table|sudo |chmod -R 777|mkfs|dd if=|kubectl delete|terraform destroy)/i;
const TWO_HOURS = 2 * 60 * 60 * 1000;
const SAVE_EVERY_MS = 5000;

/** Server-local calendar parts of a timestamp. Injectable for tests. */
export type LocalParts = (ts: number) => { day: string; hour: number };

export const localParts: LocalParts = (ts) => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hour: d.getHours() };
};

function zeroCounters(): StatCounters {
  return { launches: 0, commits: 0, testRuns: 0, testPasses: 0, edits: 0, failures: 0, prompts: 0, toolCalls: 0, fires: 0, scary: 0 };
}

export function emptyStats(day = ""): OfficeStats {
  return {
    day,
    today: { ...zeroCounters(), peakWorking: 0 },
    hourly: Array.from({ length: 24 }, () => 0),
    allTime: { ...zeroCounters(), since: 0 },
    achievements: [],
  };
}

export interface StatsOptions {
  dataDir?: string | undefined;
  parts?: LocalParts;
}

export type StatsListener = (s: OfficeStats) => void;

export class StatsTracker {
  private stats: OfficeStats;
  private readonly parts: LocalParts;
  private readonly file: string | undefined;
  /** callId → the call, for test runs that end (tool.end carries no summary). */
  private readonly calls = new Map<string, { tool: string; summary: string; agentId: string }>();
  /** Consecutive failed test runs per agent. */
  private readonly failStreak = new Map<string, number>();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<StatsListener>();
  private version = 0;

  constructor(opts: StatsOptions = {}) {
    this.parts = opts.parts ?? localParts;
    this.file = opts.dataDir ? join(opts.dataDir, "stats.json") : undefined;
    this.stats = this.load();
  }

  get(): OfficeStats {
    return this.stats;
  }

  /** Increments on every change; lets the socket layer broadcast only when something moved. */
  get changes(): number {
    return this.version;
  }

  subscribe(l: StatsListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Count one applied event. `after` is the office state once it was reduced. */
  observe(e: AgentEvent, after: OfficeState): void {
    const { day, hour } = this.parts(e.ts);
    const s = this.stats;
    if (s.day !== day) {
      s.day = day;
      s.today = { ...zeroCounters(), peakWorking: 0 };
      s.hourly = Array.from({ length: 24 }, () => 0);
    }
    if (!s.allTime.since) s.allTime.since = e.ts;
    const bump = (k: keyof StatCounters, n = 1) => {
      s.today[k] += n;
      s.allTime[k] += n;
    };

    switch (e.kind) {
      case "tool.start": {
        this.calls.set(e.callId, { tool: e.tool, summary: e.summary ?? e.tool, agentId: e.agentId });
        if (this.calls.size > 5000) this.calls.delete(this.calls.keys().next().value!);
        const summary = e.summary ?? e.tool;
        bump("toolCalls");
        s.hourly[hour] = (s.hourly[hour] ?? 0) + 1;
        if (e.category === "edit") bump("edits");
        if (e.category === "shell" && COMMIT.test(summary)) bump("commits");
        if (isShipCommand(e.tool, summary)) bump("launches");
        if (SCARY.test(summary)) bump("scary");
        if (hour < 5) this.unlock("night-owl", e.ts);
        break;
      }
      case "tool.end": {
        const call = this.calls.get(e.callId);
        this.calls.delete(e.callId);
        if (!e.ok) bump("failures");
        if (call && isTestRun(call.tool, call.summary)) {
          bump("testRuns");
          const streak = this.failStreak.get(e.agentId) ?? 0;
          if (e.ok) {
            bump("testPasses");
            if (streak >= 3) this.unlock("bug-squasher", e.ts);
            this.failStreak.delete(e.agentId);
          } else {
            this.failStreak.set(e.agentId, streak + 1);
            if (streak + 1 >= 2) bump("fires");
          }
        }
        break;
      }
      case "error":
        bump("failures");
        break;
      case "prompt":
        bump("prompts");
        break;
    }

    const live = Object.values(after.agents).filter((a) => a.status !== "ended");
    const working = live.filter((a) => a.status === "working");
    s.today.peakWorking = Math.max(s.today.peakWorking, working.length);

    if (s.allTime.launches >= 1) this.unlock("first-launch", e.ts);
    if (s.today.launches >= 10) this.unlock("space-program", e.ts);
    if (s.allTime.fires >= 3) this.unlock("pyromaniac", e.ts);
    if (s.today.testPasses >= 20) this.unlock("green-wall", e.ts);
    if (working.length >= 5) this.unlock("crunch-time", e.ts);
    if (s.allTime.edits >= 1000) this.unlock("thousand-cuts", e.ts);
    if (s.allTime.scary >= 1) this.unlock("living-dangerously", e.ts);
    const children = new Map<string, number>();
    for (const a of live) if (a.parentId) children.set(a.parentId, (children.get(a.parentId) ?? 0) + 1);
    if ([...children.values()].some((n) => n >= 5)) this.unlock("delegator", e.ts);
    if (working.some((a) => e.ts - a.startedAt > TWO_HOURS)) this.unlock("marathon", e.ts);
    if (live.some((a) => a.context && a.context.tokens / a.context.limit > 0.8)) this.unlock("big-brain", e.ts);

    this.version++;
    this.dirty = true;
    this.scheduleSave();
    for (const l of this.listeners) l(s);
  }

  /** Write now (e.g. on shutdown). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(join(this.file, ".."), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.stats));
      renameSync(tmp, this.file);
    } catch {
      // A scoreboard isn't worth crashing over.
    }
  }

  private unlock(id: AchievementId, at: number): void {
    if (this.stats.achievements.some((a) => a.id === id)) return;
    this.stats.achievements.push({ id, at });
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, SAVE_EVERY_MS);
    this.saveTimer.unref?.();
  }

  private load(): OfficeStats {
    if (!this.file || !existsSync(this.file)) return emptyStats();
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<OfficeStats>;
      const base = emptyStats(typeof raw.day === "string" ? raw.day : "");
      return {
        day: base.day,
        today: { ...base.today, ...raw.today },
        hourly: Array.isArray(raw.hourly) && raw.hourly.length === 24 ? raw.hourly.map((n) => Number(n) || 0) : base.hourly,
        allTime: { ...base.allTime, ...raw.allTime },
        achievements: Array.isArray(raw.achievements) ? raw.achievements.filter((a) => a && typeof a.id === "string") : [],
      };
    } catch {
      return emptyStats();
    }
  }
}
