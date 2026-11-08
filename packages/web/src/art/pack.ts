import type { Office } from "../office/layout.js";
import type { Look } from "../world/person.js";

/**
 * An art pack for the flat (Phaser) renderer: everything in the office that
 * has a look — the office itself, the people, the cat and the small props —
 * as canvases and images. The pixel pack draws them in code; the toon pack
 * loads pictures.
 */

/** A sprite sheet: one row of equally sized frames, drawn at `scale` texture pixels per world pixel. */
export interface Sheet {
  canvas: HTMLCanvasElement;
  frameW: number;
  frameH: number;
  scale: number;
}

/** Small things that a pack may draw as an image; without one, the pixel drawing is used. */
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

export interface ArtPack {
  id: "pixel" | "toon";
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

/** Load a pack (images included). Falls back to pixel art if the toon images can't be loaded. */
export async function loadPack(id: "pixel" | "toon"): Promise<ArtPack> {
  const { pixelPack } = await import("./pixel.js");
  if (id === "toon") {
    try {
      const { loadToonPack } = await import("./toon.js");
      return await loadToonPack();
    } catch (e) {
      console.error("Toon art failed to load; using pixel art.", e);
    }
  }
  return pixelPack;
}
