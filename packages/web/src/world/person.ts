import type { Activity } from "@pixel-office/protocol";
import type { Pose } from "../office/director.js";
import { TILE, type Facing } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";

const WALK_SPEED = 72; // world pixels per second
const RUN_SPEED = 120;

export interface Destination {
  tile: Point;
  facing: Facing;
  pose: Pose;
  run?: boolean;
}

/** One step of a scripted scene (delegation, report back, …). */
export type Step =
  | { type: "goto"; dest: () => Destination | undefined }
  | { type: "hold"; ms: number }
  | { type: "do"; fn: () => void };

/** Who a person is: an agent (its look comes from its id) or a named member of the cast (visitors, couriers…). */
export type Look = { agent: string } | { cast: string };

/** Things a person can carry in front of them. */
export type Item = "envelope" | "pizza" | "stretcher";

/**
 * Someone in the office: where they are, where they're walking, how they hold
 * themselves, and the little scripted scenes they act out. Knows nothing about
 * agent state (the world tells it where to go) and nothing about drawing (each
 * renderer reads these fields every frame).
 *
 * Positions are in world pixels: `TILE` per tile, `(x, y)` is where the feet are.
 */
export class Person {
  x: number;
  y: number;
  /** Current tile (the one the feet are on, or heading into). */
  tile: Point;
  facing: Facing = "right";
  /** What the body is doing right now: walking, or the destination's pose once there. */
  pose: Pose | "walk" = "stand";
  /** Can be clicked to open its panel (agents; not extras or visitors). */
  readonly clickable: boolean;

  // --- how it looks right now (set by the world, read by renderers) ---
  activity: Activity = "idle";
  /** Changes with every new tool call, so the activity icon pops even for the same kind of tool twice. */
  activityKey = "";
  /** When the current activity started (world clock), for the icon's pop-in. */
  activitySince = 0;
  /** Show the activity icon on the left of the head (a neighbour is on the right). */
  fxLeft = false;
  /** Lying flat (carried out on a stretcher). */
  lying = false;
  /** Party hat (the office's birthday). */
  hat = false;
  /** On one tool call far too long: a flame over the head. */
  stuck = false;
  /** The session's colour (ring under the feet), shared with its sub-agents. */
  sessionColor: number | undefined;
  /** What it carries in front of it. */
  item: Item | undefined;
  cheerUntil = 0;

  private path: Point[] = [];
  private dest: Destination | undefined;
  private script: Step[] = [];
  private holdUntil = 0;
  private stepStarted = false;

  constructor(
    readonly id: string,
    readonly look: Look,
    start: Point,
    private walkable: () => boolean[][],
  ) {
    this.tile = { ...start };
    [this.x, this.y] = feet(start);
    this.clickable = "agent" in look;
    // Extras and visitors have no activity, so no activity icon.
    if (!this.clickable) this.activity = "ended";
  }

  get busyWithScript(): boolean {
    return this.script.length > 0;
  }
  get arrived(): boolean {
    return this.path.length === 0;
  }
  get destination(): Destination | undefined {
    return this.dest;
  }
  /** Seated at a desk (typing or thinking) and there. */
  get seated(): boolean {
    return this.pose === "type" || this.pose === "think";
  }
  cheering(now: number): boolean {
    return now < this.cheerUntil && this.pose !== "walk";
  }

  /** What the agent is doing; `key` changes with every new tool call. */
  setActivity(activity: Activity, key: string, now: number): void {
    if (activity === this.activity && key === this.activityKey) return;
    this.activity = activity;
    this.activityKey = key;
    this.activitySince = now;
  }

  /** Throw both arms in the air for a moment (tests passed). */
  cheer(now: number): void {
    this.cheerUntil = now + 2200;
  }

  /** Move without pathfinding (carried along by someone else). */
  moveTo(x: number, y: number): void {
    this.path = [];
    this.x = x;
    this.y = y;
    this.tile = { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
  }

  /** Walk to a destination (no-op if already going there). */
  goTo(dest: Destination): void {
    const same = this.dest && this.dest.tile.x === dest.tile.x && this.dest.tile.y === dest.tile.y;
    this.dest = dest;
    if (same) return;
    this.path = findPath(this.walkable(), this.tile, dest.tile);
    if (!this.path.length && (this.tile.x !== dest.tile.x || this.tile.y !== dest.tile.y)) {
      // Unreachable: teleport rather than get stuck.
      this.placeAt(dest.tile);
    }
  }

  /** Jump to a tile (e.g. the office was rebuilt around us). */
  placeAt(tile: Point): void {
    this.tile = { ...tile };
    this.path = [];
    [this.x, this.y] = feet(tile);
  }

  /** Recompute the path to the current destination (the walls may have moved). */
  repath(): void {
    const dest = this.dest;
    if (!dest) return;
    this.dest = undefined;
    this.goTo(dest);
  }

  /** Replace whatever scripted scene is running with a new one. */
  play(steps: Step[]): void {
    this.script = [...steps];
    this.stepStarted = false;
  }

  /** Append to the running scene. */
  queue(steps: Step[]): void {
    this.script.push(...steps);
  }

  update(dtMs: number, now: number): void {
    this.runScript(now);
    this.move(dtMs);
  }

  private runScript(now: number): void {
    while (this.script.length) {
      const step = this.script[0]!;
      if (step.type === "do") {
        this.script.shift();
        step.fn();
        continue;
      }
      if (step.type === "goto") {
        if (!this.stepStarted) {
          const d = step.dest();
          this.stepStarted = true;
          if (!d) {
            this.script.shift();
            this.stepStarted = false;
            continue;
          }
          this.dest = undefined;
          this.goTo(d);
        }
        if (!this.arrived) return;
        this.script.shift();
        this.stepStarted = false;
        continue;
      }
      // hold
      if (!this.stepStarted) {
        this.holdUntil = now + step.ms;
        this.stepStarted = true;
      }
      if (now < this.holdUntil) return;
      this.script.shift();
      this.stepStarted = false;
    }
  }

  private move(dtMs: number): void {
    let budget = ((this.dest?.run ? RUN_SPEED : WALK_SPEED) * dtMs) / 1000;
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const [tx, ty] = feet(next);
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
      else if (d > 0) this.facing = dy > 0 ? "down" : "up";
      this.tile = { ...next };
      if (d <= budget) {
        this.x = tx;
        this.y = ty;
        this.path.shift();
        budget -= d;
      } else {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        budget = 0;
      }
    }
    if (this.path.length) {
      this.pose = "walk";
    } else if (this.dest) {
      this.pose = this.dest.pose;
      this.facing = this.dest.facing;
    }
  }
}

/** World position of the feet when standing on a tile. */
export function feet(t: Point): [number, number] {
  return [t.x * TILE + TILE / 2, t.y * TILE + TILE - 1];
}
