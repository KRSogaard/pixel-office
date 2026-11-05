import Phaser from "phaser";
import type { Activity } from "@pixel-office/protocol";
import { FRAMES, FRAME_H, FRAME_W, appearanceFor, buildSheet, type Appearance } from "../art/characters.js";
import { FX_SIZE, buildFxSheet, type FxStrip } from "../art/fx.js";
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
const FX_KEY = "fx";
let fxStrips: Partial<Record<Activity, FxStrip>> | undefined;

function ensureFx(scene: Phaser.Scene): Partial<Record<Activity, FxStrip>> {
  if (!fxStrips || !scene.textures.exists(FX_KEY)) {
    const { canvas, strips } = buildFxSheet();
    const tex = scene.textures.addCanvas(FX_KEY, canvas)!;
    for (let i = 0; i < canvas.width / FX_SIZE; i++) tex.add(i, 0, i * FX_SIZE, 0, FX_SIZE, FX_SIZE);
    fxStrips = strips;
  }
  return fxStrips;
}

export class Character {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Animated icon by the head: what the agent is doing right now. */
  private readonly fx: Phaser.GameObjects.Sprite;
  /** Code scrolling on the desk monitor while typing. */
  private readonly screen: Phaser.GameObjects.Graphics;
  /** Coloured ring under the feet: the session's colour, shared with its sub-agents. */
  private readonly ring: Phaser.GameObjects.Ellipse;
  private activity: Activity = "idle";
  private fxLeft = false;
  private lying = false;
  /** Small flame over the head: stuck on one tool call for a long time. */
  private readonly flame: Phaser.GameObjects.Graphics;
  private stuck = false;
  private cheerUntil = 0;
  private clock = 0;
  private activityKey = "";
  private fxStartedAt = 0;
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
    /** Fixed look for extras (couriers, medics…); agents get one from their id. */
    appearance?: Appearance,
  ) {
    const key = `char:${id}`;
    if (!scene.textures.exists(key)) {
      const tex = scene.textures.addCanvas(key, buildSheet(appearance ?? appearanceFor(id)))!;
      for (let i = 0; i < tex.source[0]!.width / FRAME_W; i++) tex.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
    }
    this.tile = { ...start };
    this.sprite = scene.add.sprite(...feet(start), key, 0).setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    ensureFx(scene);
    this.fx = scene.add.sprite(0, 0, FX_KEY, 0).setOrigin(0.5, 1).setVisible(false);
    this.screen = scene.add.graphics().setVisible(false);
    this.ring = scene.add.ellipse(0, 0, 14, 5).setVisible(false);
    this.flame = scene.add.graphics().setVisible(false);
  }

  /**
   * What the agent is doing. `key` changes with every new tool call, so the
   * icon pops even when the same kind of tool runs twice in a row.
   */
  setActivity(activity: Activity, key: string, now: number): void {
    if (activity === this.activity && key === this.activityKey) return;
    this.activity = activity;
    this.activityKey = key;
    this.fxStartedAt = now;
  }

  /** Put the activity icon on the left of the head (a neighbour is on the right). */
  setFxSide(left: boolean): void {
    this.fxLeft = left;
  }

  /** Lie flat (carried out on a stretcher). */
  setLying(on: boolean): void {
    this.lying = on;
  }

  /** Show a flickering flame: this agent has been on one tool call far too long. */
  setStuck(on: boolean): void {
    this.stuck = on;
  }

  /** Move without pathfinding (carried along by someone else). */
  moveTo(x: number, y: number): void {
    this.path = [];
    this.sprite.setPosition(x, y);
    this.tile = { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
  }

  /** Throw both arms in the air for a moment (tests passed). */
  cheer(now: number): void {
    this.cheerUntil = now + 2200;
  }

  setSessionColor(color: number | undefined): void {
    if (color === undefined) {
      this.ring.setVisible(false);
      return;
    }
    this.ring.setStrokeStyle(1.5, color, 0.95).setFillStyle(color, 0.25).setVisible(true);
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

  /** Jump to a tile (e.g. the office was rebuilt around us). */
  placeAt(tile: Point): void {
    this.tile = { ...tile };
    this.path = [];
    this.sprite.setPosition(...feet(tile));
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
    this.clock = now;
    this.runScript(now);
    this.move(dtMs);
    this.animate(dtMs);
    this.sprite.setDepth(this.sprite.y);
    this.ring.setPosition(this.sprite.x, this.sprite.y - 1).setDepth(this.sprite.y - 0.5);
    this.updateFx(now);
    this.updateScreen(now);
    this.updateFlame(now);
    if (this.lying) {
      this.sprite.setAngle(-90).setOrigin(0.5, 0.5);
    } else if (this.sprite.angle !== 0) {
      this.sprite.setAngle(0);
    }
  }

  private updateFlame(now: number): void {
    const g = this.flame;
    g.setVisible(this.stuck && !this.lying);
    if (!this.stuck) return;
    const x = Math.round(this.sprite.x - 1);
    const y = Math.round(this.sprite.y - 31);
    const f = Math.floor(now / 120) % 3;
    g.clear().setDepth(this.sprite.y + 1);
    g.fillStyle(0xff5d2a, 1).fillRect(x - 2, y + 2, 5, 4);
    g.fillStyle(0xff9a3c, 1).fillRect(x - 1, y + (f === 0 ? 0 : 1), 3, 4);
    g.fillStyle(0xffe066, 1).fillRect(x, y + 3 - (f === 2 ? 1 : 0), 1, 2);
    if (f === 1) g.fillStyle(0xff9a3c, 1).fillRect(x + 2, y, 1, 2);
  }

  destroy(): void {
    this.sprite.destroy();
    this.fx.destroy();
    this.screen.destroy();
    this.ring.destroy();
    this.flame.destroy();
  }

  private updateFx(now: number): void {
    const strip = fxStrips?.[this.activity];
    // Shown while walking too: half the time agents are on their way to the tool they're using.
    const show = !!strip && this.activity !== "ended";
    this.fx.setVisible(show);
    if (!show || !strip) return;
    const t = (now - this.fxStartedAt) / 1000;
    this.fx.setFrame(strip.start + (Math.floor(t * strip.fps) % strip.frames));
    // Pop in, then bob gently.
    const pop = t < 0.18 ? 0.6 + (t / 0.18) * 0.6 : t < 0.3 ? 1.2 - ((t - 0.18) / 0.12) * 0.2 : 1;
    const bob = Math.round(Math.sin(t * 3) * 1);
    const seated = this.pose === "type" || this.pose === "think";
    this.fx
      .setScale(pop)
      // Beside the head, below the name tag; the scene picks the side (left at desks, away from neighbours).
      .setPosition(Math.round(this.sprite.x + (this.fxLeft ? -12 : 12)), Math.round(this.sprite.y - (seated ? 11 : 8) + bob))
      .setDepth(this.sprite.y + 0.5);
  }

  /** While typing at a desk, the monitor above the seat scrolls lines of code. */
  private updateScreen(now: number): void {
    const typing = this.pose === "type" && this.arrived;
    this.screen.setVisible(typing);
    if (!typing) return;
    const sx = this.tile.x * TILE + 10;
    const sy = (this.tile.y - 1) * TILE + 2;
    const g = this.screen;
    g.clear();
    g.fillStyle(0x1b2a3a, 1).fillRect(sx, sy, 12, 7);
    const scroll = Math.floor(now / 220);
    const colors = [0x8fd0f0, 0xf0c45a, 0x9bbb59, 0xe9e4d8];
    for (let row = 0; row < 3; row++) {
      const n = scroll + row;
      const indent = (n * 7) % 3;
      const w = 3 + ((n * 5) % 7);
      g.fillStyle(colors[n % colors.length]!, 1).fillRect(sx + 1 + indent, sy + 1 + row * 2, Math.min(w, 10 - indent), 1);
    }
    if (Math.floor(now / 400) % 2) g.fillStyle(0xffffff, 1).fillRect(sx + 1, sy + 6, 2, 1);
    g.setDepth(this.sprite.y - 1);
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
    const cheering = this.clock < this.cheerUntil && this.pose !== "walk";
    switch (cheering ? "cheer" : this.pose) {
      case "cheer":
        frame = cycle(FRAMES.cheer, 5);
        yOffset = Math.floor(t * 5) % 2 ? -2 : 0;
        break;
      case "stomp":
        // Hopping on the wastepaper bin to squash it down.
        frame = FRAMES.walkDown[Math.floor(t * 6) % 2 ? 1 : 3]!;
        yOffset = Math.floor(t * 6) % 2 ? -4 : 0;
        break;
      case "walk":
        frame = cycle(walkFrames, 8);
        flip = this.facing === "right";
        break;
      case "type":
        frame = cycle(FRAMES.type, 6);
        yOffset = -3;
        break;
      case "think":
        frame = cycle(FRAMES.think, 1.6);
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
    if (!this.lying) this.sprite.setOrigin(0.5, 1 - yOffset / FRAME_H);
  }
}

/** Pixel position of the feet when standing on a tile. */
export function feet(t: Point): [number, number] {
  return [t.x * TILE + TILE / 2, t.y * TILE + TILE - 1];
}
