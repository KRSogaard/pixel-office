import type { AgentState, OfficeState } from "@pixel-office/protocol";
import { placeFor } from "./director.js";
import { MIN_ROOMS, WORKERS_PER_ROW, type OfficePlan, type RoomCapacities, type TeamPlan } from "./generate.js";

/** Rooms and team areas only shrink after being too big for this long. */
export const SHRINK_AFTER_MS = 60_000;

type RoomKind = keyof RoomCapacities;
const ROOM_KINDS = Object.keys(MIN_ROOMS) as RoomKind[];
const SPOT_TO_ROOM: Partial<Record<string, RoomKind>> = {
  library: "library",
  server: "server",
  meeting: "meeting",
  mail: "mail",
  lounge: "lounge",
  reception: "reception",
  globe: "globe",
  filing: "filing",
};

interface Sized {
  size: number;
  /** When the wanted size first dropped below `size` (for delayed shrinking). */
  smallerSince?: number;
}

/**
 * Turns live agent state into an office plan: which session teams exist (and in
 * what order), how many worker desks each needs, and how big each room should be.
 * Growth is immediate; shrinking waits SHRINK_AFTER_MS so rooms don't flicker.
 */
export class OfficePlanner {
  private sessionOrder: string[] = [];
  private projectOrder: string[] = [];
  private teamSize = new Map<string, Sized>();
  private roomSize = new Map<RoomKind, Sized>();

  plan(state: OfficeState, now: number): OfficePlan {
    const live = Object.values(state.agents).filter((a) => a.status !== "ended");
    return { rooms: this.rooms(live, now), teams: this.teams(live, now) };
  }

  private teams(live: AgentState[], now: number): TeamPlan[] {
    const sessions = new Map<string, { project: string; subs: number }>();
    for (const a of live) {
      const s = sessions.get(a.sessionId) ?? { project: a.project.name, subs: 0 };
      if (!a.parentId) s.project = a.project.name;
      if (a.parentId) s.subs++;
      sessions.set(a.sessionId, s);
      if (!this.sessionOrder.includes(a.sessionId)) this.sessionOrder.push(a.sessionId);
      if (!this.projectOrder.includes(s.project)) this.projectOrder.push(s.project);
    }
    this.sessionOrder = this.sessionOrder.filter((id) => sessions.has(id));
    for (const id of this.teamSize.keys()) if (!sessions.has(id)) this.teamSize.delete(id);

    const teams = this.sessionOrder.map((sessionId) => {
      const s = sessions.get(sessionId)!;
      // Always one free desk, so the next sub-agent has somewhere to sit.
      const wanted = Math.max(WORKERS_PER_ROW, Math.ceil((s.subs + 1) / WORKERS_PER_ROW) * WORKERS_PER_ROW);
      return { sessionId, project: s.project, workerSlots: this.settle(this.teamSize, sessionId, wanted, now) };
    });
    const projectRank = (p: string) => this.projectOrder.indexOf(p);
    return teams.sort(
      (a, b) => projectRank(a.project) - projectRank(b.project) || this.sessionOrder.indexOf(a.sessionId) - this.sessionOrder.indexOf(b.sessionId),
    );
  }

  private rooms(live: AgentState[], now: number): RoomCapacities {
    const demand: RoomCapacities = { library: 0, server: 0, meeting: 0, mail: 0, lounge: 0, reception: 0, globe: 0, filing: 0 };
    for (const a of live) {
      const room = SPOT_TO_ROOM[placeFor(a.activity).kind];
      if (room) demand[room]++;
    }
    const out = { ...MIN_ROOMS };
    for (const k of ROOM_KINDS) {
      // One spare spot, rounded up to an even number so sizes change in steps.
      const wanted = Math.max(MIN_ROOMS[k], Math.ceil((demand[k] + 1) / 2) * 2);
      out[k] = this.settle(this.roomSize, k, wanted, now);
    }
    return out;
  }

  private settle<K>(sizes: Map<K, Sized>, key: K, wanted: number, now: number): number {
    const cur = sizes.get(key);
    if (!cur || wanted >= cur.size) {
      sizes.set(key, { size: wanted });
      return wanted;
    }
    cur.smallerSince ??= now;
    if (now - cur.smallerSince >= SHRINK_AFTER_MS) {
      sizes.set(key, { size: wanted });
      return wanted;
    }
    return cur.size;
  }
}

/** A stable string for comparing plans. */
export function planKey(plan: OfficePlan): string {
  return JSON.stringify(plan);
}
