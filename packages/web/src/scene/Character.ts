import Phaser from "phaser";
import { FRAMES, FRAME_H, FRAME_W, appearanceFor, buildSheet } from "../art/characters.js";
import type { Pose } from "../office/director.js";
import { TILE, type Facing } from "../office/layout.js";
import { findPath, type Point } from "../office/pathfind.js";

const WALK_SPEED = 72; // px per second
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

/**
 * One agent on screen: sprite, walking along a path, posing on arrival.
 * Knows nothing about agent state — the scene tells it where to go.
 */
export class Character {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Current tile (the one the feet are on, or heading into). */
  tile: Point;
  private path: Point[] = [];
  private dest: Destination | undefined;
  private facing: Facing = "right";
  private pose: Pose | "walk" = "stand";
  private animTime = Math.random() * 1000;
  private script: Step[] = [];
  private holdUntil = 0;
  private stepStarted = false;
  leaving = false;

  constructor(
    scene: Phaser.Scene,
    readonly id: string,
    start: Point,
    private walkable: () => boolean[][],
  ) {
    const key = `char:${id}`;
    if (!scene.textures.exists(key)) {
      const tex = scene.textures.addCanvas(key, buildSheet(appearanceFor(id)))!;
      for (let i = 0; i < tex.source[0]!.width / FRAME_W; i++) tex.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
    }
    this.tile = { ...start };
    this.sprite = scene.add.sprite(...feet(start), key, 0).setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
  }

  get x(): number {
    return this.sprite.x;
  }
  get y(): number {
    return this.sprite.y;
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

  /** Walk to a destination (no-op if already going there). */
  goTo(dest: Destination): void {
    const same = this.dest && this.dest.tile.x === dest.tile.x && this.dest.tile.y === dest.tile.y;
    this.dest = dest;
    if (same) return;
    this.path = findPath(this.walkable(), this.tile, dest.tile);
    if (!this.path.length && (this.tile.x !== dest.tile.x || this.tile.y !== dest.tile.y)) {
      // Unreachable: teleport rather than get stuck.
      this.tile = { ...dest.tile };
      this.sprite.setPosition(...feet(dest.tile));
    }
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
    this.animate(dtMs);
    this.sprite.setDepth(this.sprite.y);
  }

  destroy(): void {
    this.sprite.destroy();
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
      const dx = tx - this.sprite.x;
      const dy = ty - this.sprite.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
      else if (d > 0) this.facing = dy > 0 ? "down" : "up";
      this.tile = { ...next };
      if (d <= budget) {
        this.sprite.setPosition(tx, ty);
        this.path.shift();
        budget -= d;
      } else {
        this.sprite.setPosition(this.sprite.x + (dx / d) * budget, this.sprite.y + (dy / d) * budget);
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

  private animate(dtMs: number): void {
    this.animTime += dtMs;
    const t = this.animTime / 1000;
    const cycle = (frames: readonly number[], fps: number) => frames[Math.floor(t * fps) % frames.length]!;
    let frame: number;
    let flip = false;
    let yOffset = 0;
    const walkFrames = this.facing === "up" ? FRAMES.walkUp : this.facing === "down" ? FRAMES.walkDown : FRAMES.walkLeft;
    switch (this.pose) {
      case "walk":
        frame = cycle(walkFrames, 8);
        flip = this.facing === "right";
        break;
      case "type":
        frame = cycle(FRAMES.type, 6);
        yOffset = -3;
        break;
      case "think":
        frame = FRAMES.think[0];
        yOffset = -3;
        break;
      case "station":
        frame = cycle(FRAMES.station, 3);
        break;
      case "hand":
        frame = cycle(FRAMES.hand, 3);
        break;
      case "lounge":
        frame = cycle(FRAMES.lounge, 0.7);
        yOffset = -4;
        break;
      default:
        frame = walkFrames[0]!;
        flip = this.facing === "right";
    }
    this.sprite.setFrame(frame);
    this.sprite.setFlipX(flip);
    // Negative yOffset lifts the sprite (e.g. tucked in at a desk or sunk into a sofa).
    this.sprite.setOrigin(0.5, 1 - yOffset / FRAME_H);
  }
}

/** Pixel position of the feet when standing on a tile. */
export function feet(t: Point): [number, number] {
  return [t.x * TILE + TILE / 2, t.y * TILE + TILE - 1];
}
