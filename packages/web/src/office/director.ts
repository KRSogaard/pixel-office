import type { Activity } from "@pixel-office/protocol";
import type { SpotKind } from "./layout.js";

/** How the character holds itself once it arrives. */
export type Pose = "type" | "think" | "station" | "lounge" | "hand" | "stand" | "stomp" | "cheer";

export interface Place {
  kind: SpotKind;
  pose: Pose;
}

const PLACE_BY_ACTIVITY: Record<Activity, Place> = {
  thinking: { kind: "seat", pose: "think" },
  edit: { kind: "seat", pose: "type" },
  other: { kind: "seat", pose: "type" },
  delegate: { kind: "seat", pose: "think" },
  message: { kind: "seat", pose: "think" },
  read: { kind: "library", pose: "station" },
  shell: { kind: "server", pose: "station" },
  test: { kind: "lab", pose: "station" },
  web: { kind: "globe", pose: "station" },
  mcp: { kind: "mail", pose: "station" },
  // Compaction: back at the desk, stomping the overflowing wastepaper bin flat.
  compact: { kind: "seat", pose: "stomp" },
  waiting: { kind: "reception", pose: "hand" },
  idle: { kind: "lounge", pose: "lounge" },
  ended: { kind: "door", pose: "stand" },
};

export function placeFor(activity: Activity): Place {
  return PLACE_BY_ACTIVITY[activity];
}

/** A new location must be wanted for this long before the agent walks there… */
export const SETTLE_MS = 1500;
/** …unless the agent has already been standing at its current place this long. */
export const MIN_DWELL_MS = 3000;

/**
 * Agents fire tools in bursts (Grep, Read, Edit, Read inside two seconds).
 * Walking to the library for every 50 ms Grep would be chaos, so a change of
 * *location* is held back until it has settled. Pose changes at the same
 * location apply at once.
 */
export class PlaceDebouncer {
  private current: Place | undefined;
  /** When the character actually reached the current place; undefined while walking. */
  private arrivedAt: number | undefined;
  private pending: Place | undefined;
  private pendingSince = 0;

  /** The character reached the place last returned by `decide`. */
  arrived(now: number): void {
    this.arrivedAt ??= now;
  }

  decide(desired: Place, now: number): Place {
    if (!this.current) return this.commit(desired);
    if (desired.kind === this.current.kind) {
      this.pending = undefined;
      this.current = desired;
      return desired;
    }
    if (isUrgent(desired, this.current)) return this.commit(desired);
    if (!this.pending || this.pending.kind !== desired.kind) {
      this.pending = desired;
      this.pendingSince = now;
    } else {
      this.pending = desired;
    }
    const settled = now - this.pendingSince >= SETTLE_MS;
    const dwelled = this.arrivedAt !== undefined && now - this.arrivedAt >= MIN_DWELL_MS;
    if (settled || dwelled) return this.commit(desired);
    return this.current;
  }

  private commit(place: Place): Place {
    this.current = place;
    this.arrivedAt = undefined;
    this.pending = undefined;
    return place;
  }
}

function isUrgent(desired: Place, current: Place): boolean {
  // Needing the human, leaving the building, and getting off the sofa for a new prompt never wait.
  return desired.kind === "reception" || desired.kind === "door" || current.kind === "lounge";
}
