import { describe, expect, it } from "vitest";
import { agentEventSchema, emptyState, reduceAll, type AgentEventInput } from "@pixel-office/protocol";
import { Allocator } from "../src/office/allocator.js";
import { MIN_DWELL_MS, PlaceDebouncer, placeFor, SETTLE_MS } from "../src/office/director.js";
import { MIN_ROOMS, generateOffice, type OfficePlan } from "../src/office/generate.js";
import { findPath } from "../src/office/pathfind.js";
import { OfficePlanner, SHRINK_AFTER_MS } from "../src/office/planner.js";

const quiet: OfficePlan = { rooms: MIN_ROOMS, teams: [] };
const team = (sessionId: string, project = "app", workerSlots = 3) => ({ sessionId, project, workerSlots });

describe("office generator", () => {
  it("builds a quiet office with every kind of spot except desks", () => {
    const office = generateOffice(quiet);
    const kinds = new Set(office.spots.map((s) => s.kind));
    for (const k of ["library", "server", "mail", "globe", "filing", "lab", "git", "lounge", "reception", "door"]) {
      expect(kinds, k).toContain(k);
    }
    expect(office.teams).toEqual([]);
  });

  it("gives each session a manager's chair and its worker desks", () => {
    const office = generateOffice({ ...quiet, teams: [team("s1", "app", 6), team("s2")] });
    expect(office.teams).toHaveLength(2);
    const [a, b] = office.teams;
    expect(a!.managerSeat.kind).toBe("manager");
    expect(a!.workerSeats).toHaveLength(6);
    expect(b!.workerSeats).toHaveLength(3);
    expect(office.tiles[a!.managerSeat.y - 1]![a!.managerSeat.x]).toBe("E");
  });

  it("makes rooms wider when more agents need them", () => {
    const small = generateOffice(quiet);
    const big = generateOffice({ ...quiet, rooms: { ...MIN_ROOMS, library: 14 } });
    const count = (o: typeof small) => o.spots.filter((s) => s.kind === "library").length;
    expect(count(small)).toBeGreaterThanOrEqual(MIN_ROOMS.library);
    expect(count(big)).toBeGreaterThanOrEqual(14);
  });

  it("wraps teams onto new rows and grows taller", () => {
    const few = generateOffice({ ...quiet, teams: [team("a")] });
    const many = generateOffice({ ...quiet, teams: ["a", "b", "c", "d", "e"].map((s) => team(s)) });
    expect(many.height).toBeGreaterThan(few.height);
    expect(new Set(many.teams.map((t) => t.y)).size).toBeGreaterThan(1);
  });

  it("has rows of equal width and every spot reachable from the door", () => {
    const office = generateOffice({ rooms: { ...MIN_ROOMS, server: 9, lounge: 14 }, teams: ["a", "b", "c", "d"].map((s, i) => team(s, "p", 3 + i * 3)) });
    for (const row of office.tiles) expect(row.length).toBe(office.width);
    const door = office.spots.find((s) => s.kind === "door")!;
    for (const s of office.spots) {
      if (s === door) continue;
      expect(findPath(office.walkable, door, s).length, `${s.kind} at ${s.x},${s.y}`).toBeGreaterThan(0);
    }
  });
});

describe("planner", () => {
  let t = 0;
  const ev = (e: Record<string, unknown>) =>
    agentEventSchema.parse({ source: "claude", project: { path: "/code/app", name: "app" }, sessionId: "s1", ts: (t += 10), ...e } as AgentEventInput);

  it("makes one team per session, sized for its sub-agents plus a free desk", () => {
    const state = reduceAll(emptyState(), [
      ev({ kind: "session.start", agentId: "main" }),
      ...[1, 2, 3].map((i) => ev({ kind: "session.start", agentId: `sub${i}`, parentAgentId: "main" })),
      ev({ kind: "session.start", agentId: "other", sessionId: "s2" }),
    ]);
    const plan = new OfficePlanner().plan(state, 0);
    expect(plan.teams.map((x) => [x!.sessionId, x!.workerSlots])).toEqual([
      ["s1", 6],
      ["s2", 3],
    ]);
  });

  it("grows rooms at once and shrinks them only after a quiet minute", () => {
    const planner = new OfficePlanner();
    const busy = reduceAll(
      emptyState(),
      [1, 2, 3, 4, 5, 6, 7].map((i) => ev({ kind: "tool.start", agentId: `a${i}`, sessionId: `s${i}`, callId: "c", tool: "Read", category: "read" })),
    );
    expect(planner.plan(busy, 0).rooms.library).toBe(8);
    const calm = reduceAll(busy, [1, 2, 3, 4, 5, 6, 7].map((i) => ev({ kind: "idle", agentId: `a${i}`, sessionId: `s${i}` })));
    expect(planner.plan(calm, 1000).rooms.library).toBe(8);
    expect(planner.plan(calm, 1000 + SHRINK_AFTER_MS).rooms.library).toBe(MIN_ROOMS.library);
  });

  it("sizes rooms for agents still holding a spot there, not just by activity", () => {
    const state = reduceAll(emptyState(), [ev({ kind: "tool.start", agentId: "a", callId: "c", tool: "Read", category: "read" })]);
    const holders = new Set(Array.from({ length: 9 }, (_, i) => `h${i}`));
    const rooms = new OfficePlanner().plan(state, 0, undefined, new Map([["library", new Set([...holders, "a"])]])).rooms;
    expect(rooms.library).toBeGreaterThanOrEqual(11); // 10 agents (a counted once) + a spare
  });
});

describe("allocator", () => {
  const office = generateOffice({ ...quiet, teams: [team("s1", "app", 6), team("s2")] });

  it("seats a main agent in its manager chair and sub-agents in their team", () => {
    const a = new Allocator(office);
    expect(a.seatFor({ id: "m", sessionId: "s1" })).toBe(office.teams[0]!.managerSeat);
    const w1 = a.seatFor({ id: "w1", sessionId: "s1", parentId: "m" });
    const w2 = a.seatFor({ id: "w2", sessionId: "s1", parentId: "m" });
    expect(w1).toBe(office.teams[0]!.workerSeats[0]);
    expect(w2).toBe(office.teams[0]!.workerSeats[1]);
    expect(a.seatFor({ id: "w1", sessionId: "s1", parentId: "m" })).toBe(w1); // sticky
  });

  it("keeps a sub-agent's slot when the office is rebuilt, and frees it on leave", () => {
    const a = new Allocator(office);
    a.seatFor({ id: "w1", sessionId: "s2", parentId: "m" });
    const rebuilt = generateOffice({ ...quiet, teams: [team("s0"), team("s1", "app", 6), team("s2")] });
    a.setOffice(rebuilt);
    expect(a.seatFor({ id: "w1", sessionId: "s2", parentId: "m" })).toBe(rebuilt.teams[2]!.workerSeats[0]);
    a.remove("w1");
    expect(a.seatFor({ id: "w9", sessionId: "s2", parentId: "m" })).toBe(rebuilt.teams[2]!.workerSeats[0]);
  });

  it("has no seat for a session the office doesn't have yet", () => {
    expect(new Allocator(office).seatFor({ id: "x", sessionId: "nope" })).toBeUndefined();
  });

  it("moves a sub-agent to a free desk when its desk goes away, never onto someone else's", () => {
    const a = new Allocator(generateOffice({ ...quiet, teams: [team("s1", "app", 9)] }));
    const sub = (id: string) => ({ id, sessionId: "s1", parentId: "m" });
    for (let i = 0; i < 9; i++) a.seatFor(sub(`w${i}`));
    for (let i = 0; i < 7; i++) a.remove(`w${i}`); // w7 and w8 are left, on desks 8 and 9
    const shrunk = generateOffice({ ...quiet, teams: [team("s1", "app", 3)] });
    a.setOffice(shrunk);
    const seats = ["w7", "w8", "n1"].map((id) => a.seatFor(sub(id)));
    expect(new Set(seats).size).toBe(3);
    for (const s of seats) expect(shrunk.teams[0]!.workerSeats).toContain(s);
  });

  it("notes who found a room full, so the planner can grow it", () => {
    const a = new Allocator(office);
    const n = office.spots.filter((s) => s.kind === "globe").length;
    for (let i = 0; i < n; i++) a.reserve(`a${i}`, "globe", { x: 0, y: 0 });
    expect(a.shortage).toBe(false);
    a.reserve("late", "globe", { x: 0, y: 0 });
    expect(a.shortage).toBe(true);
    expect(a.claimants().get("globe")?.size).toBe(n + 1);
    a.release("late");
    expect(a.shortage).toBe(false);
  });

  it("spreads agents over shared spots", () => {
    const a = new Allocator(office);
    const s1 = a.reserve("a", "library", { x: 0, y: 0 })!;
    const s2 = a.reserve("b", "library", { x: 0, y: 0 })!;
    expect(`${s1.x},${s1.y}`).not.toBe(`${s2.x},${s2.y}`);
  });
});

describe("place debouncer", () => {
  it("holds a short burst at the current place, then moves once settled", () => {
    const d = new PlaceDebouncer();
    expect(d.decide(placeFor("edit"), 0).kind).toBe("seat");
    expect(d.decide(placeFor("read"), 100).kind).toBe("seat");
    expect(d.decide(placeFor("edit"), 300).kind).toBe("seat");
    expect(d.decide(placeFor("read"), 400).kind).toBe("seat");
    expect(d.decide(placeFor("read"), 400 + SETTLE_MS).kind).toBe("library");
  });

  it("moves right away after dwelling long enough", () => {
    const d = new PlaceDebouncer();
    d.decide(placeFor("edit"), 0);
    d.arrived(500);
    expect(d.decide(placeFor("shell"), 500 + MIN_DWELL_MS).kind).toBe("server");
  });

  it("doesn't count time spent walking as dwelling", () => {
    const d = new PlaceDebouncer();
    d.decide(placeFor("edit"), 0);
    // Still walking to the desk at 5 s; a brief shell call shouldn't turn it around.
    expect(d.decide(placeFor("shell"), 5000).kind).toBe("seat");
  });

  it("never delays going to reception or leaving the lounge", () => {
    const d = new PlaceDebouncer();
    d.decide(placeFor("edit"), 0);
    expect(d.decide(placeFor("waiting"), 10).kind).toBe("reception");
    const d2 = new PlaceDebouncer();
    d2.decide(placeFor("idle"), 0);
    expect(d2.decide(placeFor("thinking"), 10).kind).toBe("seat");
  });

  it("changes pose at the same place immediately", () => {
    const d = new PlaceDebouncer();
    d.decide(placeFor("thinking"), 0);
    expect(d.decide(placeFor("edit"), 10).pose).toBe("type");
  });
});
