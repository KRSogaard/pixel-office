import { describe, expect, it } from "vitest";
import { agentEventSchema, emptyState, reduceAll, type AgentEventInput } from "@pixel-office/protocol";
import { Allocator } from "../src/office/allocator.js";
import { MIN_DWELL_MS, PlaceDebouncer, placeFor, SETTLE_MS } from "../src/office/director.js";
import { MIN_ROOMS, WORKERS_PER_ROW, generateOffice, type OfficePlan } from "../src/office/generate.js";
import { findPath } from "../src/office/pathfind.js";
import { SEATS } from "../src/office/layout.js";
import { OfficePlanner, SHRINK_AFTER_MS } from "../src/office/planner.js";

const quiet: OfficePlan = { rooms: MIN_ROOMS, teams: [] };
const team = (sessionId: string, project = "app", workerSlots = 3) => ({ sessionId, project, workerSlots });

describe("office generator", () => {
  it("builds a quiet office with every kind of spot except desks", () => {
    const office = generateOffice(quiet);
    const kinds = new Set(office.spots.map((s) => s.kind));
    for (const k of ["web", "server", "mail", "filing", "lab", "git", "lounge", "reception", "door"]) {
      expect(kinds, k).toContain(k);
    }
    expect(office.teams).toEqual([]);
  });

  it("gives each team its own glass-walled office, entered through its doorway", () => {
    const office = generateOffice({ ...quiet, teams: [team("s1", "app", 2 * WORKERS_PER_ROW), team("s2"), team("s3"), team("s4"), team("s5")] });
    const tile = (x: number, y: number) => office.tiles[y]![x]!;
    for (const t of office.teams) {
      // Glass all round the inside, except the two-tile doorway in the front.
      for (let x = t.x - 1; x <= t.x + t.w; x++) {
        const doorway = x === t.door.x || x === t.door.x + 1;
        expect(tile(x, t.y - 1)).toBe(doorway ? "." : "H");
        expect(tile(x, t.y + t.h)).toBe("H");
      }
      // Side walls: glass, with a doorway onto the aisle at the walkway behind each row of desks.
      const walkways = new Set(t.workerSeats.map((s) => s.y + 1));
      for (let y = t.y; y < t.y + t.h; y++) {
        const side = walkways.has(y) ? "." : "H";
        expect([tile(t.x - 1, y), tile(t.x + t.w, y)]).toEqual([side, side]);
        // A side doorway never sits right by a corner: there's glass below it before the back wall.
        if (walkways.has(y)) expect(y + 1).toBeLessThan(t.y + t.h);
      }
      // The name plate is on the glass front.
      for (let x = t.sign.x; x < t.sign.x + t.sign.w; x++) expect(tile(x, t.sign.y)).toBe("H");
      // Everyone can walk in from the corridor in front and reach every seat.
      const outside = { x: t.door.x, y: t.door.y - 1 };
      expect(office.walkable[outside.y]![outside.x]).toBe(true);
      for (const seat of [t.managerSeat, ...t.workerSeats]) {
        expect(findPath(office.walkable, outside, seat).length).toBeGreaterThan(0);
      }
    }
  });

  it("leaves aisles between the offices, so the walk from any desk to the rooms is short", () => {
    const office = generateOffice({ ...quiet, teams: [team("s1", "app", 2 * WORKERS_PER_ROW), team("s2"), team("s3"), team("s4"), team("s5"), team("s6")] });
    for (const t of office.teams) {
      for (const seat of [t.managerSeat, ...t.workerSeats]) {
        for (const room of office.rooms) {
          const path = findPath(office.walkable, seat, room.door);
          const straight = Math.abs(seat.x - room.door.x) + Math.abs(seat.y - room.door.y);
          // Out of the nearest office door and up an aisle: at most a few seconds' walk more than a straight line
          // (a desk in the middle of a row steps back to the walkway, out the side door and up).
          expect(path.length - straight, `${t.sessionId} seat ${seat.x},${seat.y} → ${room.kind}`).toBeLessThanOrEqual(14);
        }
      }
    }
  });

  it("walks round chairs, sofas and stools: only the one sitting down steps onto a seat", () => {
    const office = generateOffice({ ...quiet, teams: [team("s1", "app", 2 * WORKERS_PER_ROW), team("s2"), team("s3")] });
    const seats = office.spots.filter((s) => SEATS.has(office.tiles[s.y]![s.x]!));
    const places = [...office.rooms.map((r) => r.door), ...office.spots.filter((s) => s.kind === "door"), ...seats];
    for (const from of places) {
      for (const to of places) {
        const path = findPath(office.passable, from, to);
        for (const step of path.slice(0, -1)) {
          expect(SEATS.has(office.tiles[step.y]![step.x]!), `${from.x},${from.y} → ${to.x},${to.y} crosses ${step.x},${step.y}`).toBe(false);
        }
      }
    }
  });

  it("has a café (coffee and sofas) and an internet room (laptops and stools) along the top", () => {
    const office = generateOffice({ ...quiet, teams: [] });
    const room = (kind: string) => office.rooms.find((r) => r.kind === kind)!;
    const inside = (r: { x: number; y: number; w: number; h: number }) => (s: { x: number; y: number }) =>
      s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h;
    const cafe = room("cafe");
    const web = room("web");
    expect(office.spots.filter((s) => s.kind === "lounge").every(inside(cafe))).toBe(true);
    expect(office.spots.filter((s) => s.kind === "lounge").length).toBeGreaterThanOrEqual(quiet.rooms.lounge);
    expect(office.tiles.flat().filter((c) => c === "K")).toHaveLength(1);
    const stools = office.spots.filter((s) => s.kind === "web");
    expect(stools.every(inside(web))).toBe(true);
    expect(stools.length).toBeGreaterThanOrEqual(quiet.rooms.web);
    // Every stool is right in front of a laptop bar.
    for (const s of stools) expect(office.tiles[s.y - 1]![s.x]).toBe("L");
  });

  it("gives each session a manager's chair and its worker desks", () => {
    const office = generateOffice({ ...quiet, teams: [team("s1", "app", 2 * WORKERS_PER_ROW), team("s2")] });
    expect(office.teams).toHaveLength(2);
    const [a, b] = office.teams;
    expect(a!.managerSeat.kind).toBe("manager");
    expect(a!.workerSeats).toHaveLength(2 * WORKERS_PER_ROW);
    expect(b!.workerSeats).toHaveLength(WORKERS_PER_ROW);
    // Each worker sits right in front of their own one-monitor desk.
    for (const s of a!.workerSeats) expect(office.tiles[s.y - 1]![s.x]).toBe("d");
    expect(office.tiles[a!.managerSeat.y - 1]![a!.managerSeat.x]).toBe("E");
  });

  it("makes rooms wider when more agents need them", () => {
    const small = generateOffice(quiet);
    const big = generateOffice({ ...quiet, rooms: { ...MIN_ROOMS, web: 14 } });
    const count = (o: typeof small) => o.spots.filter((s) => s.kind === "web").length;
    expect(count(small)).toBeGreaterThanOrEqual(MIN_ROOMS.web);
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
      // One more agent than a row of desks holds: a second row.
      ...Array.from({ length: WORKERS_PER_ROW }, (_, i) => ev({ kind: "session.start", agentId: `sub${i}`, parentAgentId: "main" })),
      ev({ kind: "session.start", agentId: "other", sessionId: "s2" }),
    ]);
    const plan = new OfficePlanner().plan(state, 0);
    expect(plan.teams.map((x) => [x!.sessionId, x!.workerSlots])).toEqual([
      ["s1", 2 * WORKERS_PER_ROW],
      ["s2", WORKERS_PER_ROW],
    ]);
  });

  it("grows rooms at once and shrinks them only after a quiet minute", () => {
    const planner = new OfficePlanner();
    const busy = reduceAll(
      emptyState(),
      [1, 2, 3, 4, 5, 6, 7].map((i) => ev({ kind: "tool.start", agentId: `a${i}`, sessionId: `s${i}`, callId: "c", tool: "WebFetch", category: "web" })),
    );
    expect(planner.plan(busy, 0).rooms.web).toBe(8);
    const calm = reduceAll(busy, [1, 2, 3, 4, 5, 6, 7].map((i) => ev({ kind: "idle", agentId: `a${i}`, sessionId: `s${i}` })));
    expect(planner.plan(calm, 1000).rooms.web).toBe(8);
    expect(planner.plan(calm, 1000 + SHRINK_AFTER_MS).rooms.web).toBe(MIN_ROOMS.web);
  });

  it("sizes rooms for agents still holding a spot there, not just by activity", () => {
    const state = reduceAll(emptyState(), [ev({ kind: "tool.start", agentId: "a", callId: "c", tool: "WebFetch", category: "web" })]);
    const holders = new Set(Array.from({ length: 9 }, (_, i) => `h${i}`));
    const rooms = new OfficePlanner().plan(state, 0, undefined, new Map([["web", new Set([...holders, "a"])]])).rooms;
    expect(rooms.web).toBeGreaterThanOrEqual(11); // 10 agents (a counted once) + a spare
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
    const n = office.spots.filter((s) => s.kind === "web").length;
    for (let i = 0; i < n; i++) a.reserve(`a${i}`, "web", { x: 0, y: 0 });
    expect(a.shortage).toBe(false);
    a.reserve("late", "web", { x: 0, y: 0 });
    expect(a.shortage).toBe(true);
    expect(a.claimants().get("web")?.size).toBe(n + 1);
    a.release("late");
    expect(a.shortage).toBe(false);
  });

  it("spreads agents over shared spots", () => {
    const a = new Allocator(office);
    const s1 = a.reserve("a", "server", { x: 0, y: 0 })!;
    const s2 = a.reserve("b", "server", { x: 0, y: 0 })!;
    expect(`${s1.x},${s1.y}`).not.toBe(`${s2.x},${s2.y}`);
  });
});

describe("place debouncer", () => {
  it("reads and searches code at the desk", () => {
    expect(placeFor("read")).toEqual({ kind: "seat", pose: "think" });
  });

  it("holds a short burst at the current place, then moves once settled", () => {
    const d = new PlaceDebouncer();
    expect(d.decide(placeFor("edit"), 0).kind).toBe("seat");
    expect(d.decide(placeFor("shell"), 100).kind).toBe("seat");
    expect(d.decide(placeFor("edit"), 300).kind).toBe("seat");
    expect(d.decide(placeFor("shell"), 400).kind).toBe("seat");
    expect(d.decide(placeFor("shell"), 400 + SETTLE_MS).kind).toBe("server");
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
