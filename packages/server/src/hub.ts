import { appendFile } from "node:fs/promises";
import { emptyState, reduce, type AgentEvent, type OfficeState } from "@pixel-office/protocol";

export type Listener = (e: AgentEvent) => void;

/** Owns the authoritative office state and fans applied events out to listeners. */
export class Hub {
  private state: OfficeState = emptyState();
  private readonly listeners = new Set<Listener>();
  private recordQueue: Promise<void> = Promise.resolve();

  constructor(private readonly recordPath?: string) {}

  get snapshot(): OfficeState {
    return this.state;
  }

  apply(events: AgentEvent[]): void {
    for (const e of events) {
      this.state = reduce(this.state, e);
      for (const l of this.listeners) l(e);
    }
    if (this.recordPath && events.length) {
      const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const path = this.recordPath;
      this.recordQueue = this.recordQueue.then(() => appendFile(path, lines)).catch(() => {});
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
