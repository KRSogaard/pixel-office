import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentEventSchema, type AgentEventInput } from "@pixel-office/protocol";
import { Hub } from "../src/hub.js";
import { StatsTracker, type LocalParts } from "../src/stats.js";

// Deterministic "server-local" clock: day = UTC date, hour = UTC hour.
const parts: LocalParts = (ts) => {
  const d = new Date(ts);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};

const T0 = Date.UTC(2026, 10, 4, 10, 0, 0); // 2026-11-04 10:00
let t = T0;
let n = 0;
type Omit2<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
const ev = (e: Omit2<AgentEventInput, "ts" | "source" | "project" | "sessionId"> & { sessionId?: string; ts?: number }) =>
  agentEventSchema.parse({ source: "claude", project: { path: "/p", name: "p" }, sessionId: "s", ts: (t += 1000), ...e });

/** A tool call that starts and ends. */
const call = (agentId: string, summary: string, ok = true, category: "shell" | "edit" | "read" = "shell") => {
  const callId = `c${++n}`;
  return [
    ev({ kind: "tool.start", agentId, callId, tool: category === "shell" ? "Bash" : category === "edit" ? "Edit" : "Read", category, summary }),
    ev({ kind: "tool.end", agentId, callId, ok }),
  ];
};

function setup(dataDir?: string) {
  const stats = new StatsTracker({ parts, dataDir });
  const hub = new Hub({ stats });
  return { stats, hub };
}

describe("stats tracker", () => {
  it("counts tool calls, edits, commits, launches, prompts and failures, today and all time", () => {
    const { stats, hub } = setup();
    hub.apply([
      ev({ kind: "prompt", agentId: "a", text: "go" }),
      ...call("a", "Edit app.ts", true, "edit"),
      ...call("a", "Bash: git commit -m fix"),
      ...call("a", "Bash: git push origin main"),
      ...call("a", "Bash: ls", false),
      ev({ kind: "error", agentId: "a", text: "rate_limit" }),
    ]);
    const s = stats.get();
    expect(s.day).toBe("2026-11-04");
    expect(s.today).toMatchObject({ toolCalls: 4, edits: 1, commits: 1, launches: 1, prompts: 1, failures: 2 });
    expect(s.allTime).toMatchObject({ toolCalls: 4, launches: 1, since: T0 + 1000 });
    expect(s.hourly[10]).toBe(4);
    expect(s.achievements.map((x) => x.id)).toContain("first-launch");
  });

  it("tracks test runs, passes, lab fires and bug squashing", () => {
    const { stats, hub } = setup();
    hub.apply([
      ...call("a", "Bash: pnpm test", false),
      ...call("a", "Bash: pnpm test", false), // fire 1
      ...call("a", "Bash: pnpm test", false), // fire 2
      ...call("a", "Bash: pnpm test", true), // squashed after 3 failures
      ...call("b", "Bash: vitest run", false),
      ...call("b", "Bash: vitest run", false), // fire 3
    ]);
    const s = stats.get();
    expect(s.today).toMatchObject({ testRuns: 6, testPasses: 1, fires: 3 });
    const ids = s.achievements.map((x) => x.id);
    expect(ids).toContain("bug-squasher");
    expect(ids).toContain("pyromaniac");
  });

  it("resets today (but not all time) when the day changes", () => {
    const { stats, hub } = setup();
    hub.apply(call("a", "Bash: git push"));
    t = Date.UTC(2026, 10, 5, 9, 0, 0);
    hub.apply(call("a", "Bash: ls"));
    const s = stats.get();
    expect(s.day).toBe("2026-11-05");
    expect(s.today.launches).toBe(0);
    expect(s.today.toolCalls).toBe(1);
    expect(s.allTime.launches).toBe(1);
    expect(s.hourly[9]).toBe(1);
    expect(s.hourly[10]).toBe(0);
    t = T0;
  });

  it("unlocks crowd, delegation, night, marathon, context and danger achievements", () => {
    const { stats, hub } = setup();
    const busy = ["a", "b", "c", "d", "e"].map((id) =>
      ev({ kind: "tool.start", agentId: id, callId: `w-${id}`, tool: "Read", category: "read", summary: "Read x" }),
    );
    const kids = [1, 2, 3, 4, 5].map((i) => ev({ kind: "session.start", agentId: `k${i}`, parentAgentId: "a" }));
    hub.apply([...busy, ...kids]);
    hub.apply([ev({ kind: "context", agentId: "a", tokens: 170_000 })]);
    hub.apply(call("a", "Bash: rm -rf dist"));
    t = Date.UTC(2026, 10, 4, 12, 30, 0); // agent "a" started ~10:00, now past 2 h
    hub.apply([ev({ kind: "tool.start", agentId: "a", callId: "late", tool: "Read", category: "read", summary: "Read y" })]);
    t = Date.UTC(2026, 10, 5, 2, 0, 0); // 02:00
    hub.apply([ev({ kind: "tool.start", agentId: "z", callId: "night", tool: "Read", category: "read", summary: "Read z" })]);
    const ids = stats.get().achievements.map((x) => x.id);
    for (const id of ["crunch-time", "delegator", "big-brain", "living-dangerously", "marathon", "night-owl"]) expect(ids, id).toContain(id);
    t = T0;
  });

  it("unlocks each achievement once", () => {
    const { stats, hub } = setup();
    hub.apply([...call("a", "Bash: git push"), ...call("a", "Bash: git push")]);
    expect(stats.get().achievements.filter((x) => x.id === "first-launch")).toHaveLength(1);
  });

  it("persists to the data dir and survives a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "po-stats-"));
    const { stats, hub } = setup(dir);
    hub.apply(call("a", "Bash: git push"));
    stats.flush();
    const again = new StatsTracker({ parts, dataDir: dir }).get();
    expect(again.allTime.launches).toBe(1);
    expect(again.achievements.map((x) => x.id)).toContain("first-launch");

    const bad = mkdtempSync(join(tmpdir(), "po-stats-"));
    writeFileSync(join(bad, "stats.json"), "{not json");
    expect(new StatsTracker({ parts, dataDir: bad }).get().allTime.launches).toBe(0);
  });

  it("doesn't disturb replay history", () => {
    const { hub } = setup();
    hub.apply(call("a", "Bash: git push"));
    expect(hub.getHistory(t).events).toHaveLength(2);
  });
});
