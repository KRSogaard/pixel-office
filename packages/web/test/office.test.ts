import { describe, expect, it } from "vitest";
import { Allocator } from "../src/office/allocator.js";
import { MIN_DWELL_MS, PlaceDebouncer, placeFor, SETTLE_MS } from "../src/office/director.js";
import { buildOffice, podsPerRow } from "../src/office/layout.js";
import { findPath } from "../src/office/pathfind.js";

describe("office layout", () => {
  it("builds with the minimum pod rows and grows on demand", () => {
    const small = buildOffice(0);
    expect(small.pods.length).toBe(2 * podsPerRow());
    expect(small.pods.every((p) => p.seats.length === 6)).toBe(true);
    const big = buildOffice(10);
    expect(big.pods.length).toBe(4 * podsPerRow());
    expect(big.height).toBeGreaterThan(small.height);
  });

  it("has every kind of spot the director can ask for", () => {
    const kinds = new Set(buildOffice(0).spots.map((s) => s.kind));
    for (const k of ["library", "server", "mail", "globe", "filing", "meeting", "lounge", "reception", "seat", "door"]) {
      expect(kinds, k).toContain(k);
    }
  });

  it("can walk from the door to every spot", () => {
    const office = buildOffice(7);
    const door = office.spots.find((s) => s.kind === "door")!;
    for (const s of office.spots) {
      if (s === door) continue;
      const path = findPath(office.walkable, door, s);
      expect(path.length, `${s.kind} at ${s.x},${s.y}`).toBeGreaterThan(0);
      // Every step except the goal must be walkable.
      for (const p of path.slice(0, -1)) expect(office.walkable[p.y]![p.x]).toBe(true);
    }
  });
});

describe("allocator", () => {
  it("seats agents of one project in one pod and opens a new pod per project", () => {
    const office = buildOffice(0);
    const a = new Allocator(office);
    const s1 = a.seatFor("a1", "/p1")!;
    const s2 = a.seatFor("a2", "/p1")!;
    const s3 = a.seatFor("b1", "/p2")!;
    expect(s1.pod).toBe(s2.pod);
    expect(s3.pod).not.toBe(s1.pod);
    expect(a.seatFor("a1", "/p1")).toBe(s1); // sticky
  });

  it("overflows a full pod into a second pod for the same project", () => {
    const a = new Allocator(buildOffice(0));
    const pods = new Set<number | undefined>();
    for (let i = 0; i < 7; i++) pods.add(a.seatFor(`a${i}`, "/big")!.pod);
    expect(pods.size).toBe(2);
  });

  it("frees the pod when its last agent leaves", () => {
    const a = new Allocator(buildOffice(0));
    a.seatFor("a", "/p");
    expect(a.podProjects().size).toBe(1);
    a.remove("a");
    expect(a.podProjects().size).toBe(0);
  });

  it("asks for a bigger office when every pod is taken", () => {
    const office = buildOffice(0);
    const a = new Allocator(office);
    for (let i = 0; i < office.pods.length; i++) a.seatFor(`x${i}`, `/p${i}`);
    expect(a.seatFor("late", "/new")).toBeUndefined();
    expect(a.podsNeededFor("/new")).toBe(office.pods.length + 1);
    a.setOffice(buildOffice(office.pods.length + 1));
    expect(a.seatFor("late", "/new")).toBeDefined();
  });

  it("spreads agents over shared spots", () => {
    const a = new Allocator(buildOffice(0));
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
