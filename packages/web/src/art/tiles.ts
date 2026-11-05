import { floorAt, TILE, type Office } from "../office/layout.js";

/**
 * Paints the static office (floors, walls, furniture) into one canvas.
 * Everything is drawn with rectangles at 16×16 per tile — no image assets.
 */

const C = {
  wood: "#c8a26e",
  woodDark: "#b28a58",
  woodLine: "#a07a4b",
  carpet: "#5d7a8c",
  carpetDot: "#55707f",
  tile: "#8d97a3",
  tileLine: "#7c8693",
  wallTop: "#3b3f4a",
  wallFace: "#e8dcc6",
  wallFaceShade: "#d4c6ad",
  wallBase: "#9c8e76",
  glass: "#9fd3e8",
  glassShine: "#d9f2fb",
  frame: "#6a5a45",
  shelf: "#6e4b2e",
  shelfDark: "#543820",
  rack: "#2b2f38",
  rackLight: "#3c4250",
  ledG: "#5af07a",
  ledA: "#f0c45a",
  ledB: "#5ab4f0",
  table: "#8a5a36",
  tableTop: "#a06a40",
  desk: "#d9c3a0",
  deskEdge: "#b49c78",
  monitor: "#23262e",
  screen: "#4fa3d1",
  screenGlow: "#8fd0f0",
  plantPot: "#b5654a",
  leaf: "#4f9a4f",
  leafDark: "#3b7a3c",
  sofa: "#c0504d",
  sofaDark: "#9c3d3b",
  metal: "#a9b0ba",
  metalDark: "#7d8590",
  paper: "#f4f1e8",
  counter: "#7a5236",
  counterTop: "#caa27a",
  door: "#8b5e3c",
  mat: "#6b4a3a",
  water: "#7cc7f0",
  globe: "#3f8fd1",
  land: "#58b06a",
};

const BOOK_COLORS = ["#c0504d", "#4f81bd", "#9bbb59", "#f2c14e", "#8064a2", "#4bacc6", "#e07b39"];

type Ctx = CanvasRenderingContext2D;

export function paintOffice(office: Office): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = office.width * TILE;
  canvas.height = office.height * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < office.height; y++) {
    for (let x = 0; x < office.width; x++) {
      const c = office.tiles[y]![x]!;
      const px = x * TILE;
      const py = y * TILE;
      if (c === "#" || c === "=") {
        paintWall(ctx, office, x, y, c === "=");
        continue;
      }
      paintFloor(ctx, px, py, isFloor(c) ? (c as "." | "," | ":") : floorAt(office.tiles, x, y), x, y);
      paintThing(ctx, office, c, x, y, px, py);
    }
  }
  return canvas;
}

function isFloor(c: string): boolean {
  return c === "." || c === "," || c === ":";
}

function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function paintFloor(ctx: Ctx, px: number, py: number, kind: "." | "," | ":", x: number, y: number) {
  if (kind === ".") {
    rect(ctx, C.wood, px, py, TILE, TILE);
    // Planks: horizontal boards, staggered seams.
    for (let row = 0; row < 4; row++) {
      rect(ctx, C.woodLine, px, py + row * 4 + 3, TILE, 1);
      const seam = ((x * 7 + row * 5 + y * 3) % 4) * 4;
      rect(ctx, C.woodLine, px + seam, py + row * 4, 1, 3);
      if (noise(x * 4 + row, y) > 0.7) rect(ctx, C.woodDark, px + ((seam + 6) % 16), py + row * 4 + 1, 3, 1);
    }
  } else if (kind === ",") {
    rect(ctx, C.carpet, px, py, TILE, TILE);
    for (let i = 0; i < 6; i++) {
      const nx = Math.floor(noise(x * 13 + i, y * 7) * 16);
      const ny = Math.floor(noise(x * 5, y * 11 + i) * 16);
      rect(ctx, C.carpetDot, px + nx, py + ny, 1, 1);
    }
  } else {
    rect(ctx, C.tile, px, py, TILE, TILE);
    rect(ctx, C.tileLine, px, py + 15, TILE, 1);
    rect(ctx, C.tileLine, px + 15, py, 1, TILE);
    rect(ctx, C.tileLine, px + 7, py + 7, 2, 2);
  }
}

function paintWall(ctx: Ctx, office: Office, x: number, y: number, window: boolean) {
  const px = x * TILE;
  const py = y * TILE;
  const below = office.tiles[y + 1]?.[x];
  const facesRoom = below !== undefined && below !== "#" && below !== "=";
  if (!facesRoom) {
    rect(ctx, C.wallTop, px, py, TILE, TILE);
    rect(ctx, "#444956", px, py, TILE, 1);
    return;
  }
  // Front-facing wall: dark cap, light face, skirting board.
  rect(ctx, C.wallTop, px, py, TILE, 4);
  rect(ctx, C.wallFace, px, py + 4, TILE, 10);
  rect(ctx, C.wallFaceShade, px, py + 12, TILE, 2);
  rect(ctx, C.wallBase, px, py + 14, TILE, 2);
  if (window) {
    rect(ctx, C.frame, px + 2, py + 5, 12, 8);
    rect(ctx, C.glass, px + 3, py + 6, 10, 6);
    rect(ctx, C.glassShine, px + 4, py + 7, 2, 1);
    rect(ctx, C.glassShine, px + 4, py + 8, 1, 1);
    rect(ctx, C.frame, px + 7, py + 6, 2, 6);
  }
}

function paintThing(ctx: Ctx, office: Office, c: string, x: number, y: number, px: number, py: number) {
  const t = office.tiles;
  switch (c) {
    case "B": {
      rect(ctx, C.shelfDark, px, py + 1, TILE, 15);
      rect(ctx, C.shelf, px + 1, py + 2, 14, 13);
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = py + 3 + shelf * 4;
        let bx = px + 2;
        while (bx < px + 14) {
          const w = 1 + Math.floor(noise(bx, sy + y) * 2);
          const h = 2 + Math.floor(noise(bx + 3, sy) * 2);
          rect(ctx, BOOK_COLORS[Math.floor(noise(bx * 3, sy * 5 + x) * BOOK_COLORS.length)]!, bx, sy + (3 - h), w, h);
          bx += w + (noise(bx, sy) > 0.85 ? 1 : 0);
        }
        rect(ctx, C.shelfDark, px + 1, sy + 3, 14, 1);
      }
      break;
    }
    case "R": {
      rect(ctx, C.rack, px + 1, py, 14, 16);
      rect(ctx, C.rackLight, px + 2, py + 1, 12, 14);
      for (let i = 0; i < 4; i++) {
        rect(ctx, C.rack, px + 3, py + 2 + i * 3, 10, 2);
        const n = noise(x * 9 + i, y);
        rect(ctx, n > 0.6 ? C.ledG : n > 0.3 ? C.ledB : C.ledA, px + 11, py + 2 + i * 3, 1, 1);
        rect(ctx, C.ledG, px + 9, py + 3 + i * 3, 1, 1);
      }
      break;
    }
    case "T": {
      const up = t[y - 1]?.[x] === "T";
      const down = t[y + 1]?.[x] === "T";
      const left = t[y]?.[x - 1] === "T";
      const right = t[y]?.[x + 1] === "T";
      rect(ctx, C.tableTop, px + (left ? 0 : 1), py + (up ? 0 : 2), TILE - (left ? 0 : 1) - (right ? 0 : 1), TILE - (up ? 0 : 2) - (down ? 0 : 3));
      if (!down) rect(ctx, C.table, px + (left ? 0 : 1), py + 13, TILE - (left ? 0 : 1) - (right ? 0 : 1), 2);
      if ((x + y) % 3 === 0) {
        rect(ctx, C.paper, px + 5, py + 6, 5, 4);
        rect(ctx, "#b8b4a8", px + 6, py + 7, 3, 1);
      }
      break;
    }
    case "M": {
      rect(ctx, C.shelfDark, px, py + 1, TILE, 15);
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 3; k++) {
          rect(ctx, C.shelf, px + 1 + k * 5, py + 2 + r * 5, 4, 4);
          if (noise(x * 3 + k, y * 3 + r) > 0.4) rect(ctx, C.paper, px + 2 + k * 5, py + 3 + r * 5, 3, 2);
        }
      }
      break;
    }
    case "K": {
      rect(ctx, C.metalDark, px + 3, py + 2, 10, 13);
      rect(ctx, C.metal, px + 4, py + 3, 8, 5);
      rect(ctx, "#222", px + 6, py + 9, 4, 3);
      rect(ctx, C.paper, px + 7, py + 11, 2, 2);
      rect(ctx, C.ledA, px + 10, py + 4, 1, 1);
      break;
    }
    case "k":
    case "S": {
      const sofa = (ch: string | undefined) => ch === "S" || ch === "k";
      const left = sofa(t[y]?.[x - 1]);
      const right = sofa(t[y]?.[x + 1]);
      // A lone lounge spot (by the coffee machine) is just floor.
      if (c === "k" && !left && !right) break;
      rect(ctx, C.sofaDark, px + (left ? 0 : 1), py + 3, TILE - (left ? 0 : 1) - (right ? 0 : 1), 12);
      rect(ctx, C.sofa, px + (left ? 0 : 2), py + 4, TILE - (left ? 0 : 2) - (right ? 0 : 2), 6);
      rect(ctx, C.sofa, px + (left ? 0 : 1), py + 11, TILE - (left ? 0 : 1) - (right ? 0 : 1), 3);
      if (!left) rect(ctx, C.sofaDark, px + 1, py + 3, 2, 12);
      if (!right) rect(ctx, C.sofaDark, px + 13, py + 3, 2, 12);
      break;
    }
    case "P": {
      rect(ctx, C.plantPot, px + 5, py + 10, 6, 5);
      rect(ctx, "#8f4c37", px + 5, py + 10, 6, 1);
      rect(ctx, C.leafDark, px + 3, py + 4, 10, 6);
      rect(ctx, C.leaf, px + 4, py + 2, 8, 6);
      rect(ctx, C.leaf, px + 2, py + 5, 3, 3);
      rect(ctx, C.leaf, px + 11, py + 5, 3, 3);
      rect(ctx, "#7cc47c", px + 6, py + 3, 2, 2);
      break;
    }
    case "F": {
      rect(ctx, C.metalDark, px + 2, py + 1, 12, 15);
      for (let i = 0; i < 3; i++) {
        rect(ctx, C.metal, px + 3, py + 2 + i * 5, 10, 4);
        rect(ctx, C.metalDark, px + 6, py + 3 + i * 5, 4, 1);
      }
      break;
    }
    case "G": {
      paintDeskBase(ctx, px, py, false, false);
      rect(ctx, C.frame, px + 7, py + 8, 2, 3);
      rect(ctx, C.globe, px + 4, py + 1, 8, 8);
      rect(ctx, C.land, px + 5, py + 3, 3, 2);
      rect(ctx, C.land, px + 8, py + 5, 3, 2);
      rect(ctx, C.glassShine, px + 5, py + 2, 1, 1);
      break;
    }
    case "X": {
      rect(ctx, C.counter, px, py + 4, TILE, 12);
      rect(ctx, C.counterTop, px, py + 3, TILE, 3);
      if (t[y]?.[x - 1] !== "X") rect(ctx, C.counter, px, py + 3, 1, 13);
      if (t[y]?.[x + 1] !== "X") rect(ctx, C.counter, px + 15, py + 3, 1, 13);
      if (t[y]?.[x - 1] === "X" && t[y]?.[x + 1] === "X" && t[y]?.[x - 2] !== "X") {
        // A bell on the counter.
        rect(ctx, C.ledA, px + 6, py + 1, 4, 2);
        rect(ctx, "#b8902f", px + 5, py + 3, 6, 1);
      }
      break;
    }
    case "d": {
      const leftHalf = t[y]?.[x + 1] === "d" && t[y]?.[x - 1] !== "d";
      paintDeskBase(ctx, px, py, !leftHalf, leftHalf);
      if (leftHalf) {
        // Desk phone.
        rect(ctx, "#333", px + 2, py + 9, 4, 3);
        rect(ctx, "#555", px + 2, py + 8, 4, 1);
      } else {
        // Monitor straddles both halves. Tiles paint left to right, so the right
        // half draws it, reaching back over the already-painted left half.
        const mx = px - 8;
        rect(ctx, C.monitor, mx + 1, py + 1, 14, 9);
        rect(ctx, C.screen, mx + 2, py + 2, 12, 7);
        rect(ctx, C.screenGlow, mx + 3, py + 3, 4, 1);
        rect(ctx, C.screenGlow, mx + 3, py + 5, 7, 1);
        rect(ctx, C.monitor, mx + 7, py + 10, 2, 1);
        rect(ctx, C.monitor, mx + 5, py + 11, 6, 1);
        rect(ctx, "#e2e2e2", mx + 3, py + 12, 10, 2);
        rect(ctx, "#f2e6c9", px + 9, py + 9, 4, 3);
      }
      break;
    }
    case "w": {
      rect(ctx, C.metal, px + 5, py + 8, 6, 7);
      rect(ctx, C.water, px + 5, py + 1, 6, 7);
      rect(ctx, C.glassShine, px + 6, py + 2, 1, 4);
      rect(ctx, C.metalDark, px + 7, py + 10, 2, 1);
      break;
    }
    case "D": {
      rect(ctx, C.door, px, py, 4, TILE);
      rect(ctx, C.mat, px + 4, py + 1, 10, 14);
      rect(ctx, "#7d5a48", px + 5, py + 2, 8, 12);
      break;
    }
  }
}

function paintDeskBase(ctx: Ctx, px: number, py: number, closeRight: boolean, closeLeft: boolean) {
  const x0 = px + (closeLeft ? 1 : 0);
  const w = TILE - (closeLeft ? 1 : 0) - (closeRight ? 1 : 0);
  rect(ctx, C.desk, x0, py + 4, w, 10);
  rect(ctx, C.deskEdge, x0, py + 13, w, 2);
  rect(ctx, C.deskEdge, x0 + (closeLeft ? 1 : 0), py + 15, 2, 1);
}
