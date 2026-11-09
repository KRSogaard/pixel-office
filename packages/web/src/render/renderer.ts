import type { ScreenPoint } from "../ui/overlay.js";
import type { World } from "../world/world.js";

/**
 * Draws the world. Each art style has one: the pixel style draws it flat with
 * Phaser, the 3D style with Three.js. A renderer owns the canvas, the
 * camera and the animation loop; the world owns everything that happens.
 *
 * World positions are world pixels (`TILE` per tile) on the floor; `lift`
 * raises a point straight up off the floor by that many world pixels.
 */
export interface Renderer {
  /** The visitors who drop by in this style (each style has its own cast). */
  readonly visitors: readonly string[];
  /**
   * Start drawing `world` into `parent`. Calls `frame(dtMs, now)` once per
   * animation frame, before drawing it (that's where the world is advanced).
   */
  start(parent: HTMLElement, world: World, input: RendererInput, frame: (dtMs: number, now: number) => void): void;
  /** Where a world point lands on screen (CSS pixels in the stage), for the HTML tags and labels. */
  toScreen(x: number, y: number, lift: number): ScreenPoint;
  /** Fit the whole office on screen (and keep fitting it as it changes). */
  fit(): void;
  zoomBy(factor: number): void;
  /** The stage changed size. */
  resize(): void;
  /** The name plates on the team offices (called every frame; redraw only what changed). */
  signs(signs: readonly Sign[]): void;
}

/** A team office's name plate, on the wall tiles from (x, y), `w` wide. */
export interface Sign {
  /** The team's session. */
  key: string;
  x: number;
  y: number;
  w: number;
  /** Big: the project. */
  title: string;
  /** Small: manager · person · ⎇ branch. */
  subtitle: string;
  /** The session's colour. */
  color: number;
}

/** What the player clicked. */
export interface RendererInput {
  /** An agent was clicked; `undefined`: empty floor (closes the panel). */
  pick(agentId: string | undefined): void;
  /** A team's whiteboard was clicked. */
  board(sessionId: string): void;
}
