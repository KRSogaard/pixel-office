import Phaser from "phaser";
import type { Office } from "../office/layout.js";
import type { Appearance } from "./characters.js";

/**
 * Art styles: everything in the office that has a look — the office itself,
 * the people, the cat and the small props — comes from the active style. The
 * game logic doesn't change between styles, only how things are drawn.
 *
 * The style is picked per browser and applied by reloading the page, so no
 * code has to swap textures under a running scene.
 *
 * To add a style: implement `ArtStyle`, add it to `STYLES`, and give
 * `loadStyle` a case for it.
 */

export type StyleId = "pixel" | "toon";

export const STYLES: { id: StyleId; label: string }[] = [
  { id: "pixel", label: "Pixel" },
  { id: "toon", label: "Toon" },
];

/** A sprite sheet: one row of equally sized frames, drawn at `scale` texture pixels per world pixel. */
export interface Sheet {
  canvas: HTMLCanvasElement;
  frameW: number;
  frameH: number;
  scale: number;
}

/** Who a character is: an agent (looks picked from its id), or a named member of the style's cast. */
export type Look = { agent: string } | { cast: string; fallback: Appearance };

/** Small things that a style may draw as an image; without one, the pixel drawing is used. */
export type PropName =
  | "bug"
  | "drone"
  | "bin-empty"
  | "bin-half"
  | "bin-full"
  | "rocket"
  | "duck"
  | "envelope"
  | "pizza"
  | "stretcher"
  | "tree"
  | "pumpkin"
  | "balloons";

export interface Prop {
  image: HTMLImageElement;
  /** Texture pixels per world pixel. */
  scale: number;
}

export interface ArtStyle {
  id: StyleId;
  /** Smooth (linear) texture filtering instead of crisp pixels. */
  smooth: boolean;
  /** The whole static office: floors, walls, rugs and furniture. */
  paintOffice(office: Office, colorOf: (sessionId: string) => number, rugs: boolean): Sheet;
  /** A character's sheet in the `FRAMES` layout of characters.ts. */
  character(look: Look): Sheet;
  /** The cat's sheet: walk, walk, sit, sleep, sleep. */
  cat(): Sheet;
  prop(name: PropName): Prop | undefined;
  /** The visitors who drop by in this style. */
  visitors: readonly string[];
  /** Draw the small pixel props visitors carry (a clipboard, a briefcase) — sized for pixel figures. */
  pixelProps: boolean;
  /**
   * Where a worker desk's monitor screen is (world pixels, from the seat
   * tile's top-left corner) and how big, for the scrolling code while someone
   * types. Undefined: no screen animation.
   */
  screen: { dx: number; dy: number; w: number; h: number } | undefined;
}

const KEY = "po.style";

/** The style for this browser: `?style=toon` in the URL (for TVs, which have no top bar), else the dropdown's choice. */
export function chosenStyle(): StyleId {
  let id = new URLSearchParams(location.search).get("style");
  if (STYLES.some((s) => s.id === id)) return id as StyleId;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: use the default.
  }
  return STYLES.some((s) => s.id === id) ? (id as StyleId) : "pixel";
}

/** Switch styles: remembered for this browser, applied by reloading. */
export function chooseStyle(id: StyleId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: the reload below falls back to the default.
  }
  // A ?style= in the URL would override the new choice; drop it.
  const url = new URL(location.href);
  url.searchParams.delete("style");
  location.replace(url.toString());
}

let active: ArtStyle | undefined;

/** The active style. Set once at startup by `loadStyle`. */
export function artStyle(): ArtStyle {
  if (!active) throw new Error("art style not loaded yet");
  return active;
}

/** Load the chosen style (images included). Falls back to pixel art if the toon images can't be loaded. */
export async function loadStyle(id: StyleId): Promise<ArtStyle> {
  const { pixelStyle } = await import("./pixel.js");
  if (id === "toon") {
    try {
      const { loadToonStyle } = await import("./toon.js");
      active = await loadToonStyle();
      return active;
    } catch (e) {
      console.error("Toon art failed to load; using pixel art.", e);
    }
  }
  active = pixelStyle;
  return active;
}

/** Register a sheet as a Phaser texture with numbered frames. */
export function addSheet(scene: Phaser.Scene, key: string, sheet: Sheet): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.addCanvas(key, sheet.canvas)!;
  const n = Math.floor(sheet.canvas.width / sheet.frameW);
  for (let i = 0; i < n; i++) tex.add(i, 0, i * sheet.frameW, 0, sheet.frameW, sheet.frameH);
  if (artStyle().smooth) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/**
 * A prop as an image at world size (origin: bottom centre), or undefined when
 * the active style has no image for it and the caller draws it in pixels.
 */
export function propImage(scene: Phaser.Scene, name: PropName): Phaser.GameObjects.Image | undefined {
  const prop = artStyle().prop(name);
  if (!prop) return undefined;
  const key = `prop:${name}`;
  if (!scene.textures.exists(key)) scene.textures.addImage(key, prop.image)!.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(1 / prop.scale);
}

/** Whether the active style has an image for this prop. */
export function hasProp(name: PropName): boolean {
  return !!artStyle().prop(name);
}
