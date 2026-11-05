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
 *  - shared spots (library, lounge, …) are reserved briefly so agents spread out.
 */
export class Allocator {
  private slotOf = new Map<string, { sessionId: string; slot: number }>();
  private reserved = new Map<string, string>(); // spotKey → agentId
  private reservationOf = new Map<string, string>(); // agentId → spotKey

  constructor(private office: Office) {}

  /** Swap in a regenerated office. Seats follow their slots; short reservations are dropped. */
  setOffice(office: Office): void {
    this.office = office;
    this.reserved.clear();
    this.reservationOf.clear();
  }

  seatFor(agent: Seatable): Spot | undefined {
    const team = this.office.teams.find((t) => t.sessionId === agent.sessionId);
    if (!team) return undefined;
    if (!agent.parentId) return team.managerSeat;
    let slot = this.slotOf.get(agent.id);
    if (!slot) {
      const taken = new Set([...this.slotOf.values()].filter((s) => s.sessionId === agent.sessionId).map((s) => s.slot));
      let i = 0;
      while (taken.has(i)) i++;
      slot = { sessionId: agent.sessionId, slot: i };
      this.slotOf.set(agent.id, slot);
    }
    // More sub-agents than desks (until the office grows): share the last desk.
    return team.workerSeats[slot.slot] ?? team.workerSeats[team.workerSeats.length - 1];
  }

  /**
   * Reserve the free spot of `kind` closest to `near`. Falls back to sharing the
   * closest spot when every one is taken.
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
    }
    return spot;
  }

  release(agentId: string): void {
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
