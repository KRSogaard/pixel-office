import { describe, expect, it } from "vitest";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";

const NOW = 1_700_000_000_000;
const directory = "/Users/dev/code/pixel-office";
const session = (id: string, parentID?: string) => ({
  id,
  projectID: "p",
  directory,
  ...(parentID ? { parentID } : {}),
  title: parentID ? "explore task (@explore subagent)" : "New session",
  version: "1",
  time: { created: 1, updated: 1 },
});

describe("opencode adapter", () => {
  it("maps root session lifecycle", () => {
    const a = new OpenCodeAdapter();
    const [start] = a.toEvents({ directory, type: "event", event: { type: "session.created", properties: { info: session("s1") } } }, NOW);
    expect(start).toMatchObject({ kind: "session.start", agentId: "opencode:s1", sessionId: "opencode:s1", project: { name: "pixel-office" } });
    expect(a.toEvents({ directory, type: "event", event: { type: "session.idle", properties: { sessionID: "s1" } } }, NOW)[0]).toMatchObject({ kind: "idle" });
    expect(
      a.toEvents({ directory, type: "event", event: { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } } }, NOW)[0],
    ).toMatchObject({ kind: "busy" });
    expect(
      a.toEvents({ directory, type: "event", event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } }, NOW)[0],
    ).toMatchObject({ kind: "idle" });
    expect(a.toEvents({ directory, type: "event", event: { type: "session.compacted", properties: { sessionID: "s1" } } }, NOW)[0]).toMatchObject({ kind: "compact" });
    expect(
      a.toEvents({ directory, type: "event", event: { type: "session.error", properties: { sessionID: "s1", error: { name: "APIError" } } } }, NOW)[0],
    ).toMatchObject({ kind: "error", text: "APIError" });
    expect(a.toEvents({ directory, type: "event", event: { type: "session.deleted", properties: { info: session("s1") } } }, NOW)[0]).toMatchObject({ kind: "session.end" });
  });

  it("treats a child session going idle as finished, with a parent link", () => {
    const a = new OpenCodeAdapter();
    a.toEvents({ directory, type: "event", event: { type: "session.created", properties: { info: session("root") } } }, NOW);
    const [start] = a.toEvents({ directory, type: "event", event: { type: "session.created", properties: { info: session("kid", "root") } } }, NOW);
    expect(start).toMatchObject({ agentId: "opencode:kid", parentAgentId: "opencode:root", sessionId: "opencode:root", label: "explore task (@explore subagent)" });
    const [tool] = a.toEvents({ directory, type: "tool.before", input: { tool: "grep", sessionID: "kid", callID: "c1" }, args: { pattern: "x" } }, NOW);
    expect(tool).toMatchObject({ kind: "tool.start", parentAgentId: "opencode:root", category: "read" });
    const [end] = a.toEvents({ directory, type: "event", event: { type: "session.idle", properties: { sessionID: "kid" } } }, NOW);
    expect(end).toMatchObject({ kind: "session.end", ok: true, agentId: "opencode:kid" });
  });

  it("maps tools, questions, prompts and permissions", () => {
    const a = new OpenCodeAdapter();
    expect(a.toEvents({ directory, type: "tool.before", input: { tool: "bash", sessionID: "s", callID: "c" }, args: { command: "pnpm test" } }, NOW)[0]).toMatchObject({
      kind: "tool.start",
      category: "shell",
      summary: "bash: pnpm test",
    });
    expect(a.toEvents({ directory, type: "tool.after", input: { tool: "bash", sessionID: "s", callID: "c" }, ok: false }, NOW)[0]).toMatchObject({
      kind: "tool.end",
      ok: false,
    });
    const q = a.toEvents({ directory, type: "tool.before", input: { tool: "question", sessionID: "s", callID: "q" }, args: { questions: [{ question: "Tabs or spaces?" }] } }, NOW);
    expect(q[1]).toMatchObject({ kind: "waiting", reason: "question", text: "Tabs or spaces?" });
    expect(a.toEvents({ directory, type: "chat.message", sessionID: "s", text: "hello" }, NOW)[0]).toMatchObject({ kind: "prompt", text: "hello" });
    const perm = { id: "p", type: "bash", sessionID: "s", messageID: "m", title: "Run rm -rf dist", metadata: {}, time: { created: 1 } };
    expect(a.toEvents({ directory, type: "event", event: { type: "permission.updated", properties: perm } }, NOW)[0]).toMatchObject({
      kind: "waiting",
      reason: "permission",
      text: "Run rm -rf dist",
    });
    expect(a.toEvents({ directory, type: "event", event: { type: "permission.replied", properties: { sessionID: "s", permissionID: "p", response: "once" } } }, NOW)[0]).toMatchObject({
      kind: "busy",
    });
  });

  it("ignores junk", () => {
    const a = new OpenCodeAdapter();
    expect(a.toEvents({ directory, type: "event", event: { type: "message.part.updated", properties: {} } }, NOW)).toEqual([]);
    expect(a.toEvents(42, NOW)).toEqual([]);
  });
});
