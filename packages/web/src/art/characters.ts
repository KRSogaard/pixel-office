import { hash } from "@pixel-office/protocol";

/**
 * Builds a character sprite sheet from layered parts (skin, hair, shirt, pants),
 * picked deterministically from the agent id so every agent looks different and
 * always the same.
 */

export const FRAME_W = 16;
export const FRAME_H = 24;

/** Frame index ranges in the generated sheet. "Right" is "left" mirrored. */
export const FRAMES = {
  walkDown: [0, 1, 2, 3],
  walkUp: [4, 5, 6, 7],
  walkLeft: [8, 9, 10, 11],
  type: [12, 13],
  hand: [14, 15],
  lounge: [16, 17],
  station: [18, 19],
  /** Sitting still, then scratching the head now and then. */
  think: [20, 20, 20, 21, 22, 21],
} as const;
const FRAME_COUNT = 23;

export interface Appearance {
  skin: string;
  skinShade: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;
  shirt: string;
  shirtShade: string;
  pants: string;
  shoes: string;
}

const SKINS: [string, string][] = [
  ["#f6d3b3", "#e3b48f"],
  ["#eac09a", "#d19f77"],
  ["#c98e62", "#ad744c"],
  ["#9a6440", "#7f4f31"],
  ["#6e4529", "#57361f"],
];
const HAIRS = ["#2b2118", "#5a3a22", "#a5682f", "#e2b75c", "#b33a2b", "#d9d9d9", "#3d4a8a", "#7a3f8f"];
const SHIRTS: [string, string][] = [
  ["#4f81bd", "#3d6797"],
  ["#c0504d", "#9c3d3b"],
  ["#9bbb59", "#7d9a45"],
  ["#8064a2", "#664f84"],
  ["#4bacc6", "#3a8aa0"],
  ["#f79646", "#d17a33"],
  ["#e8e8e8", "#c4c4c4"],
  ["#3a3f4b", "#2b2f38"],
];
const PANTS = ["#2f3a56", "#3b3b3b", "#5a4632", "#46566e", "#2a2a2a"];

export function appearanceFor(agentId: string): Appearance {
  const h = hash(agentId);
  const pick = <T>(arr: readonly T[], shift: number): T => arr[(h >>> shift) % arr.length]!;
  const [skin, skinShade] = pick(SKINS, 0);
  const [shirt, shirtShade] = pick(SHIRTS, 7);
  return {
    skin,
    skinShade,
    hair: pick(HAIRS, 3),
    hairStyle: ((h >>> 11) % 4) as Appearance["hairStyle"],
    shirt,
    shirtShade,
    pants: pick(PANTS, 14),
    shoes: "#1e1e22",
  };
}

type View = "down" | "up" | "left";

interface PoseOpts {
  view: View;
  /** Walk phase: 0 stand, 1 left step, 2 stand, 3 right step. */
  step?: number;
  seated?: boolean;
  /** Arm animation for typing / station work: 0 or 1. */
  arms?: number;
  /** Raise the right arm (waving at reception). */
  raise?: number;
  /** Seated on a sofa, seen from the front. */
  lounging?: boolean;
  /** Hand up to the head, thinking hard (seated, from behind). 0/1 = scratch phase. */
  scratch?: number;
  bob?: number;
}

export function buildSheet(a: Appearance): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W * FRAME_COUNT;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d")!;
  const frames: PoseOpts[] = [
    ...[0, 1, 2, 3].map((step) => ({ view: "down" as const, step })),
    ...[0, 1, 2, 3].map((step) => ({ view: "up" as const, step })),
    ...[0, 1, 2, 3].map((step) => ({ view: "left" as const, step })),
    { view: "up", seated: true, arms: 0 },
    { view: "up", seated: true, arms: 1, bob: 1 },
    { view: "up", raise: 0 },
    { view: "up", raise: 1 },
    { view: "down", lounging: true },
    { view: "down", lounging: true, bob: 1 },
    { view: "up", arms: 0 },
    { view: "up", arms: 1 },
    { view: "up", seated: true },
    { view: "up", seated: true, scratch: 0 },
    { view: "up", seated: true, scratch: 1 },
  ];
  frames.forEach((opts, i) => drawCharacter(ctx, i * FRAME_W, a, opts));
  return canvas;
}

function drawCharacter(ctx: CanvasRenderingContext2D, ox: number, a: Appearance, o: PoseOpts) {
  const px = (color: string, x: number, y: number, w = 1, h = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, y, w, h);
  };
  const bob = o.bob ?? 0;
  const walking = o.step === 1 || o.step === 3;
  const lift = walking ? 1 : 0; // body rises on steps
  const top = 2 + bob - lift + (o.seated ? 2 : 0) + (o.lounging ? 3 : 0);

  // Shadow
  if (!o.seated && !o.lounging) px("rgba(0,0,0,0.25)", 4, 22, 8, 2);

  if (o.view === "left") {
    drawSide(px, a, o, top);
    return;
  }
  const back = o.view === "up";

  // Legs
  if (o.lounging) {
    px(a.pants, 5, top + 15, 6, 2);
    px(a.pants, 5, top + 17, 2, 2);
    px(a.pants, 9, top + 17, 2, 2);
    px(a.shoes, 5, top + 19, 2, 1);
    px(a.shoes, 9, top + 19, 2, 1);
  } else if (!o.seated) {
    const l = o.step === 1 ? -1 : 0;
    const r = o.step === 3 ? -1 : 0;
    px(a.pants, 5, top + 15, 3, 5 + l);
    px(a.pants, 8, top + 15, 3, 5 + r);
    px(a.shoes, 5, top + 20 + l, 3, 2);
    px(a.shoes, 8, top + 20 + r, 3, 2);
  }

  // Body
  px(a.shirt, 4, top + 8, 8, 8);
  px(a.shirtShade, 4, top + 14, 8, 2);
  if (!back) {
    px(a.shirtShade, 7, top + 8, 2, 2); // collar
  }

  // Arms
  const swing = o.step === 1 ? 1 : o.step === 3 ? -1 : 0;
  const armY = top + 9;
  if (o.scratch !== undefined) {
    px(a.shirt, 3, armY, 1, 5);
    px(a.skin, 3, armY + 5, 1, 1);
    // Right arm bent up, hand at the side of the head.
    px(a.shirt, 12, top + 5, 1, 5);
    px(a.skin, 11 + o.scratch, top + 3, 2, 2);
  } else if (o.raise !== undefined) {
    px(a.shirt, 3, armY, 1, 5);
    px(a.skin, 3, armY + 5, 1, 1);
    const wave = o.raise ? 1 : 0;
    px(a.shirt, 12 + wave, top + 2, 1, 7);
    px(a.skin, 12 + wave, top, 1, 2);
  } else if (o.arms !== undefined) {
    // Elbows out, hands forward: typing / working at a terminal.
    const lo = o.arms ? 1 : 0;
    px(a.shirt, 3, armY + lo, 1, 4);
    px(a.shirt, 12, armY + (1 - lo), 1, 4);
    px(a.skin, 3, armY + 4 + lo, 1, 1);
    px(a.skin, 12, armY + 5 - lo, 1, 1);
  } else {
    px(a.shirt, 3, armY + swing, 1, 5);
    px(a.shirt, 12, armY - swing, 1, 5);
    px(a.skin, 3, armY + 5 + swing, 1, 1);
    px(a.skin, 12, armY + 5 - swing, 1, 1);
  }

  // Head
  px(a.skin, 5, top + 1, 6, 7);
  px(a.skinShade, 5, top + 7, 6, 1);
  drawHair(px, a, top, back);
  if (!back) {
    px("#1b1b1f", 6, top + 4, 1, 2);
    px("#1b1b1f", 9, top + 4, 1, 2);
    px(a.skinShade, 7, top + 6, 2, 1);
  }

  // Chair back when seated at a desk (seen from behind).
  if (o.seated) {
    px("#3b3f4a", 3, top + 13, 10, 6);
    px("#4c5160", 4, top + 14, 8, 4);
  }
}

function drawHair(px: (c: string, x: number, y: number, w?: number, h?: number) => void, a: Appearance, top: number, back: boolean) {
  const h = a.hair;
  px(h, 5, top, 6, 2);
  px(h, 4, top + 1, 1, 3);
  px(h, 11, top + 1, 1, 3);
  if (back) {
    px(h, 5, top + 1, 6, 5);
    if (a.hairStyle === 1 || a.hairStyle === 3) px(h, 5, top + 6, 6, 2);
    if (a.hairStyle === 3) px(h, 6, top + 8, 4, 3);
    return;
  }
  switch (a.hairStyle) {
    case 0: // short
      px(h, 5, top + 1, 6, 1);
      break;
    case 1: // long
      px(h, 5, top + 1, 6, 2);
      px(h, 4, top + 4, 1, 5);
      px(h, 11, top + 4, 1, 5);
      break;
    case 2: // fringe
      px(h, 5, top + 1, 6, 2);
      px(h, 5, top + 3, 2, 1);
      break;
    case 3: // bun / ponytail
      px(h, 7, top - 1, 2, 1);
      px(h, 5, top + 1, 6, 1);
      break;
  }
}

function drawSide(px: (c: string, x: number, y: number, w?: number, h?: number) => void, a: Appearance, o: PoseOpts, top: number) {
  const step = o.step ?? 0;
  // Legs: alternate forward/back.
  const fwd = step === 1 ? -1 : step === 3 ? 1 : 0;
  px(a.pants, 6 + fwd, top + 15, 2, 5);
  px(a.pants, 8 - fwd, top + 15, 2, 5);
  px(a.shoes, 5 + fwd, top + 20, 3, 2);
  px(a.shoes, 7 - fwd, top + 20, 3, 2);
  // Body
  px(a.shirt, 5, top + 8, 6, 8);
  px(a.shirtShade, 5, top + 14, 6, 2);
  // Arm
  px(a.shirtShade, 7 + fwd, top + 9, 2, 5);
  px(a.skin, 7 + fwd, top + 14, 2, 1);
  // Head (facing left)
  px(a.skin, 5, top + 1, 6, 7);
  px(a.skinShade, 5, top + 7, 6, 1);
  px(a.hair, 5, top, 6, 2);
  px(a.hair, 8, top + 1, 3, 4);
  if (a.hairStyle === 1) px(a.hair, 9, top + 5, 2, 4);
  if (a.hairStyle === 3) px(a.hair, 11, top + 2, 1, 3);
  px("#1b1b1f", 6, top + 4, 1, 2);
  px(a.skin, 4, top + 4, 1, 2); // nose
}
