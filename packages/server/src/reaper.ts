import type { AgentEvent, OfficeState } from "@pixel-office/protocol";
import type { Hub } from "./hub.js";

export interface ReaperOptions {
  idleAfterMs: number;
  leaveAfterMs: number;
}

/**
 * Covers events that never arrive (killed sessions, a server that was down):
 * - working agents silent for idleAfterMs go idle,
 * - any agent silent for leaveAfterMs walks out.
 * Waiting agents are left alone until leaveAfterMs — you may simply be away.
 */
export function reap(state: OfficeState, now: number, opts: ReaperOptions): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const a of Object.values(state.agents)) {
    if (a.status === "ended") continue;
    const silent = now - a.lastEventAt;
    const base = {
      source: a.source,
      agentId: a.id,
      sessionId: a.sessionId,
      ...(a.parentId ? { parentAgentId: a.parentId } : {}),
      project: a.project,
      ts: now,
    };
    if (silent >= opts.leaveAfterMs) out.push({ ...base, kind: "session.end", ok: true });
    else if (a.status === "working" && silent >= opts.idleAfterMs) out.push({ ...base, kind: "idle" });
  }
  return out;
}

export function startReaper(hub: Hub, opts: ReaperOptions, intervalMs = 30_000, clock = Date.now): () => void {
  const timer = setInterval(() => {
    const events = reap(hub.snapshot, clock(), opts);
    if (events.length) hub.apply(events);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
