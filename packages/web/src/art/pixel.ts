import { CAT_H, CAT_W, buildCatSheet } from "./cat.js";
import { FRAME_H, FRAME_W, appearanceFor, buildSheet, type Appearance } from "./characters.js";
import type { ArtPack } from "./pack.js";
import { paintOffice } from "./tiles.js";

/** The original look: everything drawn with rectangles at 16 pixels per tile. */
export const pixelPack: ArtPack = {
  id: "pixel",
  smooth: false,
  paintOffice: (office, colorOf, rugs) => {
    const canvas = paintOffice(office, colorOf, rugs);
    return { canvas, frameW: canvas.width, frameH: canvas.height, scale: 1 };
  },
  character: (look) => ({
    canvas: buildSheet("agent" in look ? appearanceFor(look.agent) : (CAST[look.cast] ?? appearanceFor(look.cast))),
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

const skin = { skin: "#f6d3b3", skinShade: "#e3b48f" };

/** How the extras and visitors look in pixels. */
const CAST: Record<string, Appearance> = {
  courier: { ...skin, hair: "#3d4a8a", hairStyle: 0, shirt: "#3d4a8a", shirtShade: "#2b3566", pants: "#2b2f38", shoes: "#1e1e22" },
  medic: { skin: "#eac09a", skinShade: "#d19f77", hair: "#e8e8e8", hairStyle: 0, shirt: "#f4f4f4", shirtShade: "#ff5d5d", pants: "#f4f4f4", shoes: "#1e1e22" },
  pizza: { ...skin, hair: "#c0504d", hairStyle: 0, shirt: "#c0504d", shirtShade: "#9c3d3b", pants: "#2f3a56", shoes: "#1e1e22" },
  ceo: { ...skin, hair: "#2b2118", hairStyle: 0, shirt: "#1d1f27", shirtShade: "#111216", pants: "#3d4a8a", shoes: "#e8e8e8" },
  trump: { ...skin, hair: "#e2b75c", hairStyle: 2, shirt: "#2f3a56", shirtShade: "#e8e8e8", pants: "#2f3a56", shoes: "#1e1e22" },
  boss: { ...skin, hair: "#2b2118", hairStyle: 0, shirt: "#3b3f4a", shirtShade: "#c0504d", pants: "#3b3f4a", shoes: "#1e1e22" },
  consultant: { ...skin, hair: "#5a3a22", hairStyle: 2, shirt: "#2f3a56", shirtShade: "#e8e8e8", pants: "#2f3a56", shoes: "#1e1e22" },
  intern: { ...skin, hair: "#a5682f", hairStyle: 1, shirt: "#6fbf73", shirtShade: "#4f9a52", pants: "#46566e", shoes: "#e8e8e8" },
  auditor: { skin: "#eac09a", skinShade: "#d19f77", hair: "#7d8590", hairStyle: 0, shirt: "#5c6370", shirtShade: "#3b3f4a", pants: "#3b3f4a", shoes: "#1e1e22" },
  investor: { ...skin, hair: "#f6d3b3", hairStyle: 0, shirt: "#c8a26e", shirtShade: "#a07a4b", pants: "#2b2f38", shoes: "#5a3a22" },
  grandpa: { skin: "#eac09a", skinShade: "#d19f77", hair: "#e8e8e8", hairStyle: 0, shirt: "#8a5a36", shirtShade: "#6b4226", pants: "#5a4632", shoes: "#2b2118" },
};
