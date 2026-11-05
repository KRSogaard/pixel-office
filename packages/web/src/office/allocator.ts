import type { Office, Spot, SpotKind } from "./layout.js";

/**
 * Hands out places in the office: one desk pod per project, one seat per agent,
 * and short-term reservations on shared spots (library, lounge, …) so agents
 * don't pile onto the same tile.
 *
 * Assignments are sticky for the life of the page: an agent keeps its desk even
 * when the state changes around it.
 */
export class Allocator {
  private podProject = new Map<number, string>();
  private seatOf = new Map<string, Spot>();
  private reserved = new Map<string, string>(); // spotKey → agentId
  private reservationOf = new Map<string, string>(); // agentId → spotKey

  constructor(private office: Office) {}

  /** Swap in a rebuilt office (more pod rows). Existing seats keep their coordinates. */
  setOffice(office: Office): void {
    this.office = office;
  }

  /** How many pods are in use, plus one if `project` would need a new one. */
  podsNeededFor(project: string): number {
    const used = this.podProject.size;
    const hasFree = [...this.podProject.entries()].some(
      ([pod, p]) => p === project && this.freeSeatsIn(pod).length > 0,
    );
    return hasFree ? used : used + 1;
  }

  seatFor(agentId: string, project: string): Spot | undefined {
    const existing = this.seatOf.get(agentId);
    if (existing) return existing;
    const pod = this.podWithRoom(project);
    if (pod === undefined) return undefined;
    const seat = this.freeSeatsIn(pod)[0];
    if (!seat) return undefined;
    this.podProject.set(pod, project);
    this.seatOf.set(agentId, seat);
    return seat;
  }

  /** The project sitting in each pod, for labels. */
  podProjects(): ReadonlyMap<number, string> {
    return this.podProject;
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

  /** Reserve a specific spot if it's free (used to seat two agents side by side). */
  reserveExact(agentId: string, spot: Spot): boolean {
    const k = key(spot);
    const holder = this.reserved.get(k);
    if (holder && holder !== agentId) return false;
    this.release(agentId);
    this.reserved.set(k, agentId);
    this.reservationOf.set(agentId, k);
    return true;
  }

  isFree(spot: Spot): boolean {
    return !this.reserved.has(key(spot));
  }

  release(agentId: string): void {
    const k = this.reservationOf.get(agentId);
    if (k) {
      this.reserved.delete(k);
      this.reservationOf.delete(agentId);
    }
  }

  /** The agent left the office: free its seat, and its pod if that was the last one. */
  remove(agentId: string): void {
    this.release(agentId);
    const seat = this.seatOf.get(agentId);
    this.seatOf.delete(agentId);
    if (seat?.pod !== undefined && this.occupantsOf(seat.pod) === 0) this.podProject.delete(seat.pod);
  }

  private podWithRoom(project: string): number | undefined {
    for (const [pod, p] of this.podProject) {
      if (p === project && this.freeSeatsIn(pod).length) return pod;
    }
    return this.office.pods.find((pod) => !this.podProject.has(pod.index))?.index;
  }

  private freeSeatsIn(podIndex: number): Spot[] {
    const pod = this.office.pods.find((p) => p.index === podIndex);
    if (!pod) return [];
    const taken = new Set([...this.seatOf.values()].map(key));
    return pod.seats.filter((s) => !taken.has(key(s)));
  }

  private occupantsOf(podIndex: number): number {
    return [...this.seatOf.values()].filter((s) => s.pod === podIndex).length;
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
