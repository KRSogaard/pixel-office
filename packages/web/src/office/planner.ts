import { DEFAULT_SETTINGS, type AgentState, type OfficeSettings, type OfficeState } from "@pixel-office/protocol";
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
 * Turns live agent state into an office plan: which session teams exist (and where
 * they sit), how many worker desks each needs, and how big each room should be.
 * Growth is immediate; shrinking waits SHRINK_AFTER_MS so rooms don't flicker.
 */
export class OfficePlanner {
  /**
   * Team spots by session id, in display order. A team that goes home leaves
   * `null` behind; the next new session takes the first free spot, so the
   * other teams (and the people sitting in them) never move.
   */
  private slots: (string | null)[] = [];
  private teamSize = new Map<string, Sized>();
  private roomSize = new Map<RoomKind, Sized>();

  plan(state: OfficeState, now: number, settings: OfficeSettings = DEFAULT_SETTINGS): OfficePlan {
    const live = Object.values(state.agents).filter((a) => a.status !== "ended");
    return { rooms: this.rooms(live, now, settings), teams: this.teams(live, now), settings };
  }

  private teams(live: AgentState[], now: number): (TeamPlan | null)[] {
    const sessions = new Map<string, { project: string; subs: number; firstSeen: number }>();
    for (const a of live) {
      const s = sessions.get(a.sessionId) ?? { project: a.project.name, subs: 0, firstSeen: a.startedAt };
      if (!a.parentId) s.project = a.project.name;
      if (a.parentId) s.subs++;
      s.firstSeen = Math.min(s.firstSeen, a.startedAt);
      sessions.set(a.sessionId, s);
    }
    // Teams that went home leave a gap…
    this.slots = this.slots.map((id) => (id && sessions.has(id) ? id : null));
    for (const id of this.teamSize.keys()) if (!sessions.has(id)) this.teamSize.delete(id);
    // …which new teams fill first, oldest session first.
    const newcomers = [...sessions.entries()]
      .filter(([id]) => !this.slots.includes(id))
      .sort((a, b) => a[1].firstSeen - b[1].firstSeen)
      .map(([id]) => id);
    for (const id of newcomers) {
      const gap = this.slots.indexOf(null);
      if (gap >= 0) this.slots[gap] = id;
      else this.slots.push(id);
    }
    while (this.slots.length && this.slots[this.slots.length - 1] === null) this.slots.pop();

    return this.slots.map((sessionId) => {
      if (!sessionId) return null;
      const s = sessions.get(sessionId)!;
      // Always one free desk, so the next sub-agent has somewhere to sit.
      const wanted = Math.max(WORKERS_PER_ROW, Math.ceil((s.subs + 1) / WORKERS_PER_ROW) * WORKERS_PER_ROW);
      return { sessionId, project: s.project, workerSlots: this.settle(this.teamSize, sessionId, wanted, now) };
    });
  }

  private rooms(live: AgentState[], now: number, settings: OfficeSettings): RoomCapacities {
    const demand: RoomCapacities = { library: 0, server: 0, meeting: 0, mail: 0, lounge: 0, reception: 0, globe: 0, filing: 0 };
    for (const a of live) {
      const room = SPOT_TO_ROOM[placeFor(a.activity).kind];
      if (room) demand[room]++;
    }
    const out = { ...settings.minRooms };
    for (const k of ROOM_KINDS) {
      // One spare spot, rounded up to an even number so sizes change in steps.
      const wanted = Math.max(settings.minRooms[k], Math.ceil((demand[k] + 1) / 2) * 2);
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
