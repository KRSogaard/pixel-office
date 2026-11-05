import { emptyState, reduceAll, agentEventSchema } from "@pixel-office/protocol";
import { describe, expect, it, vi } from "vitest";
import { Hub } from "../src/hub.js";
import { reap, startReaper } from "../src/reaper.js";

const opts = { idleAfterMs: 10_000, leaveAfterMs: 30_000 };
const base = { source: "claude", sessionId: "s", project: { path: "/p", name: "p" } };
const ev = (e: Record<string, unknown>) => agentEventSchema.parse({ ...base, ...e });

describe("reaper", () => {
  const state = reduceAll(emptyState(), [
    ev({ agentId: "working", kind: "tool.start", callId: "c", tool: "Bash", category: "shell", ts: 0 }),
    ev({ agentId: "waiting", kind: "waiting", reason: "permission", ts: 0 }),
    ev({ agentId: "idle", kind: "idle", ts: 0 }),
  ]);

  it("does nothing before the thresholds", () => {
    expect(reap(state, 9_999, opts)).toEqual([]);
  });

  it("idles silent working agents but leaves waiting and idle ones alone", () => {
    const out = reap(state, 10_000, opts);
    expect(out.map((e) => [e.agentId, e.kind])).toEqual([["working", "idle"]]);
  });

  it("walks everyone out after leaveAfterMs", () => {
    const out = reap(state, 30_000, opts);
    expect(out.map((e) => e.kind)).toEqual(["session.end", "session.end", "session.end"]);
  });

  it("runs on an interval through the hub", () => {
    vi.useFakeTimers();
    const hub = new Hub();
    let now = 0;
    hub.apply([ev({ agentId: "a", kind: "prompt", text: "hi", ts: 0 })]);
    const stop = startReaper(hub, opts, 1_000, () => now);
    now = 10_500;
    vi.advanceTimersByTime(1_000);
    expect(hub.snapshot.agents.a!.status).toBe("idle");
    stop();
    vi.useRealTimers();
  });
});
