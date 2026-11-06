import { CAT_H, CAT_W, buildCatSheet } from "./cat.js";
import { FRAME_H, FRAME_W, appearanceFor, buildSheet } from "./characters.js";
import type { ArtStyle } from "./style.js";
import { paintOffice } from "./tiles.js";

/** The original look: everything drawn with rectangles at 16 pixels per tile. */
export const pixelStyle: ArtStyle = {
  id: "pixel",
  smooth: false,
  paintOffice: (office, colorOf, rugs) => {
    const canvas = paintOffice(office, colorOf, rugs);
    return { canvas, frameW: canvas.width, frameH: canvas.height, scale: 1 };
  },
  character: (look) => ({
    canvas: buildSheet("agent" in look ? appearanceFor(look.agent) : look.fallback),
    frameW: FRAME_W,
    frameH: FRAME_H,
    scale: 1,
  }),
  cat: () => ({ canvas: buildCatSheet(), frameW: CAT_W, frameH: CAT_H, scale: 1 }),
  prop: () => undefined,
  visitors: ["ceo", "trump", "consultant", "intern", "auditor", "investor", "grandpa"],
  pixelProps: true,
  screen: { dx: 10, dy: -14, w: 12, h: 7 },
};
