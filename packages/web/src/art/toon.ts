import { hash } from "@pixel-office/protocol";
import { TILE, isFloor, floorAt, type Floor, type Office } from "../office/layout.js";
import type { Look } from "../world/person.js";
import type { ArtPack, Prop, PropName, Sheet } from "./pack.js";

/**
 * "Toon": a 1940s-cartoon look. Furniture, people, the cat and props are
 * images generated with Nano Banana by scripts/toon-art.py (public/art/toon/);
 * floors, walls and rugs are painted here in the same flat, outlined style.
 *
 * Images are drawn at ART_RES texture pixels per world pixel and scaled down,
 * with smooth filtering instead of crisp pixels.
 */

const ART_RES = 4;
/** Each pose in a character image sits in a cell this big (texture pixels). */
const CELL_W = 128;
const CELL_H = 96;
/** Pose order in a character image (see POSES in scripts/toon-art.py). */
const POSE = { front: 0, back: 1, side: 2, sit: 3, think: 4, hand: 5, lounge: 6, cheer: 7 } as const;
const CAT_CELL = 64;
const CAT_POSE = { walk: 0, sit: 1, sleep: 2 } as const;
/** Largest texture edge we paint the office into; most GPUs take 4096. */
const MAX_TEXTURE = 4096;

const FURNITURE = [
  "desk",
  "manager-desk",
  "bookshelf",
  "server-rack",
  "mail-shelf",
  "coffee",
  "armchair",
  "plant",
  "filing",
  "globe-desk",
  "counter",
  "console",
  "silo",
  "printer",
  "flask-shelf",
  "lab-bench",
  "whiteboard",
  "water-cooler",
  "chair",
] as const;
const PROPS: readonly PropName[] = ["bug", "drone", "bin-empty", "bin-half", "bin-full", "rocket", "duck", "envelope", "pizza", "stretcher", "tree", "pumpkin", "balloons"];
const AGENT_LOOKS = 12;
const CAST = ["boss", "consultant", "intern", "auditor", "investor", "grandpa", "courier", "medic", "pizza"] as const;

type Furniture = (typeof FURNITURE)[number];

/** Which image a layout character becomes, and how many tiles wide it is. */
const THINGS: Record<string, { img: Furniture; w: number; h?: number }> = {
  B: { img: "bookshelf", w: 1 },
  R: { img: "server-rack", w: 1 },
  M: { img: "mail-shelf", w: 1 },
  K: { img: "coffee", w: 1 },
  k: { img: "armchair", w: 1 },
  S: { img: "armchair", w: 1 },
  P: { img: "plant", w: 1 },
  F: { img: "filing", w: 1 },
  G: { img: "globe-desk", w: 1 },
  X: { img: "counter", w: 1 },
  U: { img: "console", w: 1 },
  Y: { img: "printer", w: 1 },
  Q: { img: "flask-shelf", w: 1 },
  J: { img: "lab-bench", w: 1 },
  w: { img: "water-cooler", w: 1 },
  a: { img: "chair", w: 1 },
  q: { img: "chair", w: 1 },
  d: { img: "desk", w: 1 },
  E: { img: "manager-desk", w: 3 },
  W: { img: "whiteboard", w: 2 },
  O: { img: "silo", w: 3, h: 3 },
};

const INK = "#1d1b26";

function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`missing toon image ${name}`));
    img.src = `${import.meta.env.BASE_URL}art/toon/${name}.png`;
  });
}

/** Load every image; optional ones (props, cast) may be missing. Throws if the core art is missing. */
export async function loadToonPack(): Promise<ArtPack> {
  const optional = async (name: string) => loadImage(name).catch(() => undefined);
  const [furniture, agents, cast, props, cat] = await Promise.all([
    Promise.all(FURNITURE.map((n) => loadImage(n))),
    Promise.all(Array.from({ length: AGENT_LOOKS }, (_, i) => optional(`char-${String(i).padStart(2, "0")}`))),
    Promise.all(CAST.map((n) => optional(`cast-${n}`))),
    Promise.all(PROPS.map((n) => optional(n))),
    loadImage("cat"),
  ]);
  const looks = agents.filter((a): a is HTMLImageElement => !!a);
  if (!looks.length) throw new Error("no toon characters");
  const images = new Map<string, HTMLImageElement>(FURNITURE.map((n, i) => [n, furniture[i]!]));
  const castImages = new Map(CAST.flatMap((n, i) => (cast[i] ? [[n as string, cast[i]!] as const] : [])));
  const propImages = new Map(PROPS.flatMap((n, i) => (props[i] ? [[n, props[i]!] as const] : [])));
  const sheets = new Map<HTMLImageElement, HTMLCanvasElement>();
  const sheetFor = (img: HTMLImageElement) => {
    let s = sheets.get(img);
    if (!s) sheets.set(img, (s = characterSheet(img)));
    return s;
  };

  return {
    id: "toon",
    smooth: true,
    paintOffice: (office, colorOf, rugs) => paintOffice(office, colorOf, rugs, images),
    character: (look: Look): Sheet => {
      const img = "agent" in look ? looks[hash(look.agent) % looks.length]! : (castImages.get(look.cast) ?? looks[hash(look.cast) % looks.length]!);
      return { canvas: sheetFor(img), frameW: CELL_W, frameH: CELL_H, scale: ART_RES };
    },
    cat: () => ({ canvas: catSheet(cat), frameW: CAT_CELL, frameH: CAT_CELL, scale: ART_RES }),
    prop: (name: PropName): Prop | undefined => {
      const image = propImages.get(name);
      return image && { image, scale: ART_RES };
    },
    visitors: ["boss", "consultant", "intern", "auditor", "investor", "grandpa"],
    pixelProps: false,
    // Measured on desk.png: the screen of the monitor in the middle of the desk.
    screen: { dx: 6.5, dy: -22, w: 3, h: 5.5 },
  };
}

// --- people ------------------------------------------------------------------------

interface Pose {
  pose: number;
  /** Lift (negative) or drop, in texture pixels. */
  dy?: number;
  /** Tilt in degrees, around the feet. */
  rot?: number;
  /** Squash and stretch, around the feet. */
  sx?: number;
  sy?: number;
  flip?: boolean;
}

/**
 * The 25 frames of characters.ts's FRAMES layout, built from 8 drawn poses.
 * Pixel art animates frame by frame; cartoons bounce: steps are a bob and a
 * waddle, breathing is a squash, cheering is a stretch.
 */
const FRAME_POSES: Pose[] = [
  // walkDown
  { pose: POSE.front },
  { pose: POSE.front, dy: -4, rot: -4, sy: 1.02 },
  { pose: POSE.front, sy: 0.98, sx: 1.02 },
  { pose: POSE.front, dy: -4, rot: 4, sy: 1.02 },
  // walkUp
  { pose: POSE.back },
  { pose: POSE.back, dy: -4, rot: -4, sy: 1.02 },
  { pose: POSE.back, sy: 0.98, sx: 1.02 },
  { pose: POSE.back, dy: -4, rot: 4, sy: 1.02 },
  // walkLeft (mirrored for right)
  { pose: POSE.side },
  { pose: POSE.side, dy: -5, rot: -3, sy: 1.03 },
  { pose: POSE.side, sy: 0.97, sx: 1.03 },
  { pose: POSE.side, dy: -5, rot: 3, sy: 1.03 },
  // type
  { pose: POSE.sit },
  { pose: POSE.sit, dy: -2, sy: 1.02 },
  // hand
  { pose: POSE.hand },
  { pose: POSE.hand, rot: 4 },
  // lounge
  { pose: POSE.lounge },
  { pose: POSE.lounge, sy: 1.03, sx: 0.99 },
  // station: busy at a machine, back to us
  { pose: POSE.back, rot: -2 },
  { pose: POSE.back, rot: 2, dy: -2 },
  // think
  { pose: POSE.sit },
  { pose: POSE.think },
  { pose: POSE.think, rot: 3 },
  // cheer
  { pose: POSE.cheer, dy: -2 },
  { pose: POSE.cheer, dy: -8, sy: 1.06, sx: 0.96 },
];

function characterSheet(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * FRAME_POSES.length;
  canvas.height = CELL_H;
  const ctx = canvas.getContext("2d")!;
  FRAME_POSES.forEach((p, i) => drawPose(ctx, img, p, i * CELL_W, CELL_W, CELL_H));
  return canvas;
}

function drawPose(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: Pose, ox: number, w: number, h: number) {
  ctx.save();
  // Clip to the frame so a tilt can't bleed into the neighbouring frame.
  ctx.beginPath();
  ctx.rect(ox, 0, w, h);
  ctx.clip();
  ctx.translate(ox + w / 2, h + (p.dy ?? 0));
  ctx.rotate(((p.rot ?? 0) * Math.PI) / 180);
  ctx.scale((p.sx ?? 1) * (p.flip ? -1 : 1), p.sy ?? 1);
  ctx.drawImage(img, p.pose * w, 0, w, h, -w / 2, -h, w, h);
  ctx.restore();
}

/** Cat frames as in pet.ts: walk, walk, sit, sleep, sleep. */
function catSheet(img: HTMLImageElement): HTMLCanvasElement {
  const frames: Pose[] = [
    { pose: CAT_POSE.walk },
    { pose: CAT_POSE.walk, dy: -3, rot: -3 },
    { pose: CAT_POSE.sit },
    { pose: CAT_POSE.sleep },
    { pose: CAT_POSE.sleep, sy: 1.05, sx: 1.02 },
  ];
  const canvas = document.createElement("canvas");
  canvas.width = CAT_CELL * frames.length;
  canvas.height = CAT_CELL;
  const ctx = canvas.getContext("2d")!;
  frames.forEach((p, i) => drawPose(ctx, img, p, i * CAT_CELL, CAT_CELL, CAT_CELL));
  return canvas;
}

// --- the office --------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function paintOffice(office: Office, colorOf: (sessionId: string) => number, rugs: boolean, images: Map<string, HTMLImageElement>): Sheet {
  const worldW = office.width * TILE;
  const worldH = office.height * TILE;
  const res = Math.min(ART_RES, MAX_TEXTURE / Math.max(worldW, worldH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(worldW * res);
  canvas.height = Math.ceil(worldH * res);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Everything below is in world pixels (16 per tile).
  ctx.setTransform(res, 0, 0, res, 0, 0);

  const t = office.tiles;
  for (let y = 0; y < office.height; y++) {
    for (let x = 0; x < office.width; x++) {
      const c = t[y]![x]!;
      if (c === "#" || c === "=") paintWall(ctx, office, x, y, c === "=");
      else paintFloor(ctx, x, y, isFloor(c) ? c : floorAt(t, x, y));
      if (c === "D") paintDoorway(ctx, x, y);
    }
  }
  if (rugs) for (const team of office.teams) paintRug(ctx, team, colorOf(team.sessionId));

  // Furniture row by row, so things lower on screen overlap the ones behind them.
  for (let y = 0; y < office.height; y++) {
    for (let x = 0; x < office.width; x++) {
      const c = t[y]![x]!;
      const thing = THINGS[c];
      if (!thing) continue;
      // A wide piece is drawn once, from its left (and top) tile.
      if (thing.w > 1 && t[y]![x - 1] === c) continue;
      if (thing.h && t[y - 1]?.[x] === c) continue;
      const img = images.get(thing.img)!;
      const w = img.width / ART_RES;
      const h = img.height / ART_RES;
      const cx = (x + thing.w / 2) * TILE;
      const bottom = (y + (thing.h ?? 1)) * TILE;
      ctx.drawImage(img, cx - w / 2, bottom - h, w, h);
    }
  }
  return { canvas, frameW: canvas.width, frameH: canvas.height, scale: res };
}

const FLOORS: Record<Floor, { base: string; line: string }> = {
  ".": { base: "#e2b47c", line: "#b9844c" },
  ",": { base: "#79a7b8", line: "#5f8b9c" },
  ":": { base: "#5b6273", line: "#454b59" },
  ";": { base: "#f1f4f6", line: "#c7d1da" },
};

function paintFloor(ctx: Ctx, x: number, y: number, kind: Floor) {
  const px = x * TILE;
  const py = y * TILE;
  const { base, line } = FLOORS[kind];
  ctx.fillStyle = base;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.strokeStyle = line;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  if (kind === ".") {
    // Wide planks with staggered ends.
    for (let row = 0; row < 2; row++) {
      const ly = py + row * 8 + 8;
      ctx.moveTo(px, ly);
      ctx.lineTo(px + TILE, ly);
      const seam = px + (((x * 5 + y * 3 + row * 7) % 4) * 4 + 2);
      ctx.moveTo(seam, py + row * 8);
      ctx.lineTo(seam, py + row * 8 + 8);
    }
  } else if (kind === ",") {
    // Carpet: a soft diamond pattern.
    ctx.moveTo(px + 8, py + 2);
    ctx.lineTo(px + 14, py + 8);
    ctx.lineTo(px + 8, py + 14);
    ctx.lineTo(px + 2, py + 8);
    ctx.closePath();
  } else {
    // Tiles: server room large, test lab small.
    const n = kind === ";" ? 2 : 1;
    for (let i = 0; i <= n; i++) {
      ctx.moveTo(px, py + (i * TILE) / n);
      ctx.lineTo(px + TILE, py + (i * TILE) / n);
      ctx.moveTo(px + (i * TILE) / n, py);
      ctx.lineTo(px + (i * TILE) / n, py + TILE);
    }
  }
  ctx.stroke();
}

function paintWall(ctx: Ctx, office: Office, x: number, y: number, window: boolean) {
  const px = x * TILE;
  const py = y * TILE;
  const below = office.tiles[y + 1]?.[x];
  const facesRoom = below !== undefined && below !== "#" && below !== "=";
  ctx.fillStyle = "#3a3346";
  ctx.fillRect(px, py, TILE, TILE);
  if (!facesRoom) return;
  // Wall face: cream plaster, a bold ink line on top, a skirting board below.
  ctx.fillStyle = "#f4e2bd";
  ctx.fillRect(px, py + 4, TILE, 12);
  ctx.fillStyle = "#e3c995";
  ctx.fillRect(px, py + 11, TILE, 2);
  ctx.fillStyle = "#a0673d";
  ctx.fillRect(px, py + 13, TILE, 3);
  ctx.fillStyle = INK;
  ctx.fillRect(px, py + 3.4, TILE, 0.8);
  ctx.fillRect(px, py + 15.4, TILE, 0.6);
  if (window) {
    // Same opening as the pixel walls, so the wall decor's sky fits behind it.
    ctx.fillStyle = "#9fd3e8";
    ctx.fillRect(px + 3, py + 6, 10, 6);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(px + 2.4, py + 5.4, 11.2, 7.2);
  }
}

function paintDoorway(ctx: Ctx, x: number, y: number) {
  const px = x * TILE;
  const py = y * TILE;
  ctx.fillStyle = "#b8423c";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.7;
  roundRect(ctx, px + 1, py + 1, TILE - 2, TILE - 2, 2);
  ctx.fill();
  ctx.stroke();
}

function paintRug(ctx: Ctx, team: { x: number; y: number; w: number; h: number }, color: number) {
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = hex;
  roundRect(ctx, team.x * TILE + 3, (team.y + 1) * TILE + 3, team.w * TILE - 6, (team.h - 1) * TILE - 6, 6);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
