import { describe, expect, it } from "vitest";
import { emptyState, reduceAll, type AgentEventInput, agentEventSchema, ENDED_RETENTION_MS } from "../src/index.js";

const project = { path: "/code/app", name: "app" };
let t = 1_000;
type Omit2<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
function ev(e: Omit2<AgentEventInput, "ts" | "source" | "project" | "sessionId"> & { sessionId?: string }) {
  return agentEventSchema.parse({ source: "claude", project, sessionId: "s1", ts: (t += 100), ...e });
}

describe("reduce", () => {
  it("creates an agent on first event and tracks a prompt → tool → idle turn", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "session.start", agentId: "a" }),
      ev({ kind: "prompt", agentId: "a", text: "fix the login bug" }),
      ev({ kind: "tool.start", agentId: "a", callId: "c1", tool: "Read", category: "read", summary: "Read login.ts" }),
    ]);
    const a = s.agents.a!;
    expect(a.status).toBe("working");
    expect(a.activity).toBe("read");
    expect(a.prompt).toBe("fix the login bug");
    expect(a.lastSaid?.kind).toBe("prompt");

    const s2 = reduceAll(s, [ev({ kind: "tool.end", agentId: "a", callId: "c1", ok: true }), ev({ kind: "idle", agentId: "a" })]);
    expect(s2.agents.a!.activity).toBe("idle");
    expect(s2.agents.a!.recentTools[0]).toMatchObject({ tool: "Read", ok: true });
    expect(s.agents.a!.activity).toBe("read"); // input not mutated
  });

  it("falls back to the newest still-running call when one of several ends", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "a", callId: "c1", tool: "Bash", category: "shell" }),
      ev({ kind: "tool.start", agentId: "a", callId: "c2", tool: "WebFetch", category: "web" }),
      ev({ kind: "tool.end", agentId: "a", callId: "c2", ok: false }),
    ]);
    expect(s.agents.a!.activity).toBe("shell");
    expect(s.agents.a!.lastErrorAt).toBeDefined();
  });

  it("links a sub-agent to its parent's delegation and reports back on end", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "prompt", agentId: "p", text: "go" }),
      ev({ kind: "tool.start", agentId: "p", callId: "d1", tool: "Agent", category: "delegate", summary: "Delegate: find usages" }),
      ev({ kind: "session.start", agentId: "c", parentAgentId: "p", label: "Explore" }),
    ]);
    expect(s.agents.c!.status).toBe("working");
    expect(s.agents.p!.lastSaid).toMatchObject({ kind: "delegate", text: "find usages", withAgentId: "c" });
    expect(s.agents.p!.pendingDelegations).toEqual([]);

    const s2 = reduceAll(s, [ev({ kind: "session.end", agentId: "c", ok: true, report: "found 3" })]);
    expect(s2.agents.c!.status).toBe("ended");
    expect(s2.agents.c!.lastSaid).toMatchObject({ kind: "report", text: "found 3", withAgentId: "p" });
  });

  it("waiting is cleared by the next tool event", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "waiting", agentId: "a", reason: "permission", text: "Bash: rm -rf dist" }),
    ]);
    expect(s.agents.a!.status).toBe("waiting");
    const s2 = reduceAll(s, [ev({ kind: "tool.start", agentId: "a", callId: "x", tool: "Bash", category: "shell" })]);
    expect(s2.agents.a!.status).toBe("working");
    expect(s2.agents.a!.waiting).toBeUndefined();
  });

  it("resolves a message recipient by label within the session", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "session.start", agentId: "lead" }),
      ev({ kind: "session.start", agentId: "r", parentAgentId: "lead", label: "researcher" }),
      ev({ kind: "message", agentId: "lead", to: "researcher", text: "check the docs" }),
    ]);
    expect(s.agents.lead!.lastSaid).toMatchObject({ kind: "message", withAgentId: "r" });
  });

  it("ignores session.end for unknown agents and prunes ended agents after retention", () => {
    let s = reduceAll(emptyState(), [ev({ kind: "session.end", agentId: "ghost" })]);
    expect(s.agents.ghost).toBeUndefined();
    s = reduceAll(s, [ev({ kind: "session.start", agentId: "a" }), ev({ kind: "session.end", agentId: "a" })]);
    expect(s.agents.a!.status).toBe("ended");
    t += ENDED_RETENTION_MS + 1;
    s = reduceAll(s, [ev({ kind: "idle", agentId: "b" })]);
    expect(s.agents.a).toBeUndefined();
  });

  it("revives an ended agent that sends a new event", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "session.start", agentId: "a" }),
      ev({ kind: "session.end", agentId: "a" }),
      ev({ kind: "prompt", agentId: "a", text: "again" }),
    ]);
    expect(s.agents.a!.status).toBe("working");
    expect(s.agents.a!.endedAt).toBeUndefined();
  });

  it("clips long text to one short line", () => {
    const e = ev({ kind: "prompt", agentId: "a", text: "x\n".repeat(1000) });
    expect(e.kind === "prompt" && e.text.length).toBeLessThanOrEqual(280);
  });
});
