import { describe, expect, it } from "vitest";
import { emptyState, reduceAll, type AgentEventInput, agentEventSchema, ENDED_RETENTION_MS, JOB_GIVE_UP_MS } from "../src/index.js";

const project = { path: "/code/app", name: "app" };
let t = 1_000;
type Omit2<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
function ev(e: Omit2<AgentEventInput, "ts" | "source" | "project" | "sessionId"> & { sessionId?: string }) {
  return agentEventSchema.parse({ source: "claude", project, sessionId: "s1", ts: (t += 100), ...e });
}

describe("reduce", () => {
  it("background jobs: the agent waits on them instead of going idle, and their end counts like a test run", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "prompt", agentId: "a", text: "build and test" }),
      ev({ kind: "tool.start", agentId: "a", callId: "c1", tool: "Bash", category: "shell", summary: "Bash: pnpm test" }),
      ev({ kind: "job.start", agentId: "a", callId: "c1", summary: "Bash: pnpm test", label: "testing" }),
      ev({ kind: "tool.end", agentId: "a", callId: "c1", ok: true }),
      ev({ kind: "idle", agentId: "a" }),
    ]);
    const a = s.agents.a!;
    expect(a.activity).toBe("background");
    expect(a.status).toBe("working");
    expect(a.jobs).toEqual([expect.objectContaining({ callId: "c1", label: "testing" })]);
    expect(a.lastWinAt).toBeUndefined(); // the tool call returning isn't the tests passing

    // The job ends (reported at the end of the turn it woke the agent for).
    const s2 = reduceAll(s, [ev({ kind: "job.end", agentId: "a", callId: "c1", ok: true })]);
    expect(s2.agents.a!.activity).toBe("idle");
    expect(s2.agents.a!.jobs![0]).toMatchObject({ ok: true });
    expect(s2.agents.a!.lastWinAt).toBeDefined();

    // Reported again on a later turn end: nothing new.
    const win = s2.agents.a!.lastWinAt;
    const s3 = reduceAll(s2, [ev({ kind: "job.end", agentId: "a", callId: "c1", ok: false })]);
    expect(s3.agents.a!.lastWinAt).toBe(win);
    expect(s3.agents.a!.lastErrorAt).toBeUndefined();
  });

  it("background jobs: a failed one is an error; jobs never heard from again stop counting", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "job.start", agentId: "a", callId: "j1", summary: "Bash: make" }),
      ev({ kind: "job.start", agentId: "a", callId: "j2", summary: "Bash: make docs" }),
      ev({ kind: "job.end", agentId: "a", callId: "j1", ok: false }),
      ev({ kind: "idle", agentId: "a" }),
    ]);
    expect(s.agents.a!.lastErrorAt).toBeDefined();
    expect(s.agents.a!.activity).toBe("background"); // j2 still runs
    t += JOB_GIVE_UP_MS;
    const later = reduceAll(s, [ev({ kind: "idle", agentId: "a" })]);
    expect(later.agents.a!.activity).toBe("idle");
  });

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
      ev({ kind: "tool.start", agentId: "p", callId: "d1", tool: "Agent", category: "delegate", summary: "Delegate: find usages", detail: "Find every caller of useAuth" }),
      ev({ kind: "session.start", agentId: "c", parentAgentId: "p", label: "Explore" }),
    ]);
    expect(s.agents.c!.status).toBe("working");
    expect(s.agents.p!.lastSaid).toMatchObject({ kind: "delegate", text: "find usages", withAgentId: "c" });
    expect(s.agents.p!.pendingDelegations).toEqual([]);
    expect(s.agents.c).toMatchObject({ task: "find usages", taskBrief: "Find every caller of useAuth" });

    const s2 = reduceAll(s, [ev({ kind: "session.end", agentId: "c", ok: true, report: "found 3" })]);
    expect(s2.agents.c!.status).toBe("ended");
    expect(s2.agents.c!.lastSaid).toMatchObject({ kind: "report", text: "found 3", withAgentId: "p" });
  });

  it("an approved permission: the tool it was about runs", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "a", callId: "c1", tool: "Bash", category: "shell", summary: "Bash: rm -rf dist" }),
      ev({ kind: "waiting", agentId: "a", reason: "permission", text: "Bash: rm -rf dist" }),
    ]);
    const since = s.agents.a!.waiting!.since;
    // Claude Code repeats the prompt as a notification a few seconds later: still the same wait.
    const again = reduceAll(s, [ev({ kind: "waiting", agentId: "a", reason: "permission" })]);
    expect(again.agents.a!.waiting).toMatchObject({ callId: "c1", since });
    const end = ev({ kind: "tool.end", agentId: "a", callId: "c1", ok: true });
    expect(reduceAll(again, [end]).agents.a!.lastAnswer).toEqual({ outcome: "approved", at: end.ts });
  });

  it("a denied permission: the wait ends without the tool running", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "a", callId: "c1", tool: "Bash", category: "shell", summary: "Bash: git push --force" }),
      ev({ kind: "waiting", agentId: "a", reason: "permission" }),
    ]);
    const prompt = ev({ kind: "prompt", agentId: "a", text: "no, don't force push" });
    expect(reduceAll(s, [prompt]).agents.a!.lastAnswer).toEqual({ outcome: "denied", at: prompt.ts });
    // Another call finishing while it waits is no answer at all.
    const other = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "b", callId: "x", tool: "Read", category: "read" }),
      ev({ kind: "tool.start", agentId: "b", callId: "y", tool: "Bash", category: "shell" }),
      ev({ kind: "waiting", agentId: "b", reason: "permission" }),
      ev({ kind: "tool.end", agentId: "b", callId: "x", ok: true }),
    ]);
    expect(other.agents.b!.lastAnswer).toBeUndefined();
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

  it("never gives two agents in the office the same name", () => {
    const events = Array.from({ length: 40 }, (_, i) => ev({ kind: "session.start", agentId: `agent-${i}` }));
    const s = reduceAll(emptyState(), events);
    const names = Object.values(s.agents).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("numbers names once all 50 are in use", () => {
    const s = reduceAll(emptyState(), Array.from({ length: 60 }, (_, i) => ev({ kind: "session.start", agentId: `n-${i}` })));
    const names = Object.values(s.agents).map((a) => a.name);
    expect(new Set(names).size).toBe(60);
    expect(names.some((n) => / \d+$/.test(n))).toBe(true);
  });

  it("tracks context use, assuming a 1M window once past 200k", () => {
    let s = reduceAll(emptyState(), [ev({ kind: "context", agentId: "a", tokens: 50_000 })]);
    expect(s.agents.a!.context).toMatchObject({ tokens: 50_000, limit: 200_000 });
    s = reduceAll(s, [ev({ kind: "context", agentId: "a", tokens: 300_000 })]);
    expect(s.agents.a!.context!.limit).toBe(1_000_000);
  });

  it("replaces and upserts todos", () => {
    let s = reduceAll(emptyState(), [
      ev({ kind: "todos", agentId: "a", items: [{ text: "write tests", status: "in_progress" }, { text: "ship", status: "pending" }] }),
    ]);
    expect(s.agents.a!.todos).toHaveLength(2);
    s = reduceAll(s, [ev({ kind: "todo", agentId: "a", item: { text: "write tests", status: "completed" } })]);
    expect(s.agents.a!.todos![0]!.status).toBe("completed");
    s = reduceAll(s, [ev({ kind: "todo", agentId: "a", item: { id: "t3", text: "docs", status: "pending" } })]);
    expect(s.agents.a!.todos).toHaveLength(3);
  });

  it("celebrates a passing test run and remembers turn errors", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "a", callId: "t", tool: "Bash", category: "shell", summary: "Bash: npm test" }),
      ev({ kind: "tool.end", agentId: "a", callId: "t", ok: true }),
      ev({ kind: "tool.start", agentId: "a", callId: "l", tool: "Bash", category: "shell", summary: "Bash: ls" }),
      ev({ kind: "tool.end", agentId: "a", callId: "l", ok: true }),
      ev({ kind: "error", agentId: "a", text: "rate_limit" }),
    ]);
    expect(s.agents.a!.lastWinAt).toBeDefined();
    expect(s.agents.a!.lastError?.text).toBe("rate_limit");
  });

  it("sends test runs to the lab, git work to the git room, other commands to the server room", () => {
    const s = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "a", callId: "t", tool: "Bash", category: "shell", summary: "Bash: pnpm vitest run" }),
      ev({ kind: "tool.start", agentId: "b", callId: "l", tool: "Bash", category: "shell", summary: "Bash: git commit -m wip" }),
    ]);
    expect(s.agents.a!.activity).toBe("test");
    expect(s.agents.b!.activity).toBe("git");
    const c = reduceAll(emptyState(), [
      ev({ kind: "tool.start", agentId: "c", callId: "x", tool: "Bash", category: "shell", summary: "Bash: ls -la" }),
    ]);
    expect(c.agents.c!.activity).toBe("shell");
  });

  it("remembers whose agent it is", () => {
    const s = reduceAll(emptyState(), [ev({ kind: "session.start", agentId: "a", user: "Morten" })]);
    expect(s.agents.a!.user).toBe("Morten");
  });
});
