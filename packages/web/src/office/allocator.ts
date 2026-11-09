import type { Office, Spot, SpotKind } from "./layout.js";

export interface Seatable {
  id: string;
  sessionId: string;
  parentId?: string | undefined;
}

/**
 * Hands out places in the office:
 *  - a main agent sits in its session's manager chair;
 *  - a sub-agent gets a worker slot in its session's team area, kept for life
 *    (the slot index survives the office being regenerated; only its
 *    coordinates change);
 *  - shared spots (internet room, lounge, …) are reserved briefly so agents spread out.
 *
 * One agent per desk and per spot. The planner sizes the office from
 * `claimants()`, so when a room runs out of spots it grows instead of agents
 * doubling up.
 */
export class Allocator {
  private slotOf = new Map<string, { sessionId: string; slot: number }>();
  private reserved = new Map<string, string>(); // spotKey → agentId
  private reservationOf = new Map<string, string>(); // agentId → spotKey
  private wanting = new Map<string, SpotKind>(); // agentId → kind it found full

  constructor(private office: Office) {}

  /** Swap in a regenerated office. Seats follow their slots; short reservations are dropped. */
  setOffice(office: Office): void {
    this.office = office;
    this.reserved.clear();
    this.reservationOf.clear();
    this.wanting.clear();
  }

  seatFor(agent: Seatable): Spot | undefined {
    const team = this.office.teams.find((t) => t.sessionId === agent.sessionId);
    if (!team) return undefined;
    if (!agent.parentId) return team.managerSeat;
    const seats = team.workerSeats;
    let slot = this.slotOf.get(agent.id);
    // A new sub-agent, or one whose desk went away when the team area shrank:
    // take the first free desk.
    if (!slot || slot.slot >= seats.length) {
      const taken = new Set(
        [...this.slotOf.entries()].filter(([id, s]) => id !== agent.id && s.sessionId === agent.sessionId).map(([, s]) => s.slot),
      );
      let i = 0;
      while (taken.has(i)) i++;
      slot = { sessionId: agent.sessionId, slot: i };
      this.slotOf.set(agent.id, slot);
    }
    // The planner always leaves a free desk, so this only happens for a moment
    // while the office catches up: share the last desk until it grows.
    return seats[slot.slot] ?? seats[seats.length - 1];
  }

  /**
   * Reserve the free spot of `kind` closest to `near`. When every one is taken
   * the agent is noted as wanting one (see `shortage`) and shares the closest
   * spot until the office grows.
   */
  reserve(agentId: string, kind: SpotKind, near: { x: number; y: number }): Spot | undefined {
    const current = this.reservationOf.get(agentId);
    if (current) {
      const spot = this.spotByKey(current);
      if (spot?.kind === kind) return spot;
    }
    this.release(agentId);
    const candidates = this.office.spots.filter((s) => s.kind === kind);
    if (!candidates.length) return undefined;
    const byDistance = (a: Spot, b: Spot) => dist(a, near) - dist(b, near);
    const free = candidates.filter((s) => !this.reserved.has(key(s))).sort(byDistance);
    const spot = free[0] ?? candidates.sort(byDistance)[0]!;
    if (free[0]) {
      this.reserved.set(key(spot), agentId);
      this.reservationOf.set(agentId, key(spot));
    } else {
      this.wanting.set(agentId, kind);
    }
    return spot;
  }

  /** Some agent asked for a spot and found every one taken. */
  get shortage(): boolean {
    return this.wanting.size > 0;
  }

  /** Who holds or wants a shared spot, by kind: what the rooms must fit. */
  claimants(): Map<SpotKind, Set<string>> {
    const out = new Map<SpotKind, Set<string>>();
    const add = (kind: SpotKind, agentId: string) => {
      let ids = out.get(kind);
      if (!ids) out.set(kind, (ids = new Set()));
      ids.add(agentId);
    };
    for (const [agentId, k] of this.reservationOf) {
      const spot = this.spotByKey(k);
      if (spot) add(spot.kind, agentId);
    }
    for (const [agentId, kind] of this.wanting) add(kind, agentId);
    return out;
  }

  release(agentId: string): void {
    this.wanting.delete(agentId);
    const k = this.reservationOf.get(agentId);
    if (k) {
      this.reserved.delete(k);
      this.reservationOf.delete(agentId);
    }
  }

  /** The agent left the office: free its desk slot and any reservation. */
  remove(agentId: string): void {
    this.release(agentId);
    this.slotOf.delete(agentId);
  }

  private spotByKey(k: string): Spot | undefined {
    return this.office.spots.find((s) => key(s) === k);
  }
}

function key(s: { x: number; y: number }): string {
  return `${s.x},${s.y}`;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
