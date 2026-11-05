import { appendFile } from "node:fs/promises";
import { emptyState, reduce, type AgentEvent, type OfficeState } from "@pixel-office/protocol";
import type { StatsTracker } from "./stats.js";

export type Listener = (e: AgentEvent) => void;

export const DEFAULT_HISTORY_MS = 2 * 60 * 60 * 1000;
export const MAX_HISTORY_EVENTS = 50_000;

export interface HubOptions {
  recordPath?: string | undefined;
  /** How far back replay can go. */
  historyMs?: number;
  /** Hard cap on retained events, whatever their age. */
  maxHistory?: number;
  /** Counts every applied event for the production board and achievements. */
  stats?: StatsTracker;
}

export interface History {
  /** The office as it was just before the first retained event. */
  base: OfficeState;
  events: AgentEvent[];
  now: number;
}

/**
 * Owns the authoritative office state, fans applied events out to listeners,
 * and keeps a rolling history for replay: the last `historyMs` of events plus
 * the state from just before them.
 */
export class Hub {
  private state: OfficeState = emptyState();
  private base: OfficeState = emptyState();
  private history: AgentEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private recordQueue: Promise<void> = Promise.resolve();
  private readonly recordPath: string | undefined;
  private readonly historyMs: number;
  private readonly maxHistory: number;
  private readonly stats: StatsTracker | undefined;

  constructor(opts: HubOptions | string = {}) {
    const o = typeof opts === "string" ? { recordPath: opts } : opts;
    this.recordPath = o.recordPath;
    this.historyMs = o.historyMs ?? DEFAULT_HISTORY_MS;
    this.maxHistory = o.maxHistory ?? MAX_HISTORY_EVENTS;
    this.stats = o.stats;
  }

  get snapshot(): OfficeState {
    return this.state;
  }

  apply(events: AgentEvent[]): void {
    for (const e of events) {
      this.state = reduce(this.state, e);
      this.stats?.observe(e, this.state);
      this.history.push(e);
      for (const l of this.listeners) l(e);
    }
    if (events.length) this.trim(this.state.now);
    if (this.recordPath && events.length) {
      const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const path = this.recordPath;
      this.recordQueue = this.recordQueue.then(() => appendFile(path, lines)).catch(() => {});
    }
  }

  /** Everything replay needs: the base state and the events since. */
  getHistory(now: number): History {
    this.trim(now);
    return { base: this.base, events: [...this.history], now };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Fold events that fell out of the window into the base state. */
  private trim(now: number): void {
    const cutoff = now - this.historyMs;
    let drop = 0;
    while (drop < this.history.length && (this.history[drop]!.ts < cutoff || this.history.length - drop > this.maxHistory)) {
      this.base = reduce(this.base, this.history[drop]!);
      drop++;
    }
    if (drop) this.history = this.history.slice(drop);
  }
}
