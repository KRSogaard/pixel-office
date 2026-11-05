import { agentEventSchema, type AgentEventInput } from "@pixel-office/protocol";
import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub.js";

const ev = (agentId: string, ts: number, extra: Partial<AgentEventInput> = {}) =>
  agentEventSchema.parse({ source: "generic", agentId, sessionId: agentId, project: { path: "/p", name: "p" }, ts, kind: "session.start", ...extra } as AgentEventInput);

describe("hub history", () => {
  it("keeps events inside the window and folds older ones into the base state", () => {
    const hub = new Hub({ historyMs: 1000 });
    hub.apply([ev("old", 0), ev("mid", 500)]);
    hub.apply([ev("new", 2000)]);
    const h = hub.getHistory(2000);
    expect(h.events.map((e) => e.agentId)).toEqual(["new"]);
    expect(Object.keys(h.base.agents).sort()).toEqual(["mid", "old"]);
    expect(Object.keys(hub.snapshot.agents).sort()).toEqual(["mid", "new", "old"]);
  });

  it("caps the number of retained events", () => {
    const hub = new Hub({ historyMs: 1e12, maxHistory: 3 });
    hub.apply([1, 2, 3, 4, 5].map((i) => ev(`a${i}`, i)));
    const h = hub.getHistory(5);
    expect(h.events).toHaveLength(3);
    expect(Object.keys(h.base.agents).sort()).toEqual(["a1", "a2"]);
  });
});
