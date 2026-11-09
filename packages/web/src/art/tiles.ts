import { floorAt, isFloor, TILE, type Floor, type Office } from "../office/layout.js";

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
  land: "#58b06a",
};

const BOOK_COLORS = ["#c0504d", "#4f81bd", "#9bbb59", "#f2c14e", "#8064a2", "#4bacc6", "#e07b39"];

type Ctx = CanvasRenderingContext2D;

/**
 * @param colorOf session colour (0xRRGGBB) for a team's rug.
 */
export function paintOffice(office: Office, colorOf: (sessionId: string) => number, rugs = true): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = office.width * TILE;
  canvas.height = office.height * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Three passes so rugs sit on the floor but under the furniture.
  for (let y = 0; y < office.height; y++) {
    for (let x = 0; x < office.width; x++) {
      const c = office.tiles[y]![x]!;
      if (c === "#" || c === "=") paintWall(ctx, office, x, y, c === "=");
      else paintFloor(ctx, x * TILE, y * TILE, isFloor(c) ? c : floorAt(office.tiles, x, y), x, y);
    }
  }
  if (rugs) for (const team of office.teams) paintRug(ctx, team.x, team.y, team.w, team.h, colorOf(team.sessionId));
  for (let y = 0; y < office.height; y++) {
    for (let x = 0; x < office.width; x++) {
      const c = office.tiles[y]![x]!;
      if (c !== "#" && c !== "=") paintThing(ctx, office, c, x, y, x * TILE, y * TILE);
    }
  }
  return canvas;
}

/**
 * The Almighty Prompter in gold, on a stone plinth: one finger raised high over
 * the Enter key of a keyboard on a lectern. `mx`, `py`: the statue's left tile.
 * (The eyes are at mx + 14 and mx + 17, py - 11: the renderer makes them glow.)
 */
function paintStatue(ctx: Ctx, mx: number, py: number) {
  const gold = "#e0b84a";
  const shade = "#a8862a";
  const light = "#f6dc8a";
  // Plinth, with a brass plate on the front.
  rect(ctx, "#6d6a63", mx + 5, py + 9, 22, 7);
  rect(ctx, "#a8a49a", mx + 4, py + 8, 24, 2);
  rect(ctx, "#57544e", mx + 5, py + 15, 22, 1);
  rect(ctx, "#c9a23a", mx + 11, py + 11, 10, 3);
  // Lectern and keyboard on the left.
  rect(ctx, shade, mx + 7, py - 1, 2, 9);
  rect(ctx, gold, mx + 4, py - 3, 8, 2);
  for (const k of [5, 7, 9]) rect(ctx, shade, mx + k, py - 3, 1, 1);
  rect(ctx, light, mx + 10, py - 3, 2, 1); // the Enter key, worn shiny
  // Legs.
  rect(ctx, shade, mx + 13, py + 2, 2, 6);
  rect(ctx, gold, mx + 17, py + 2, 2, 6);
  // Body (lit from the left).
  rect(ctx, gold, mx + 12, py - 7, 8, 9);
  rect(ctx, shade, mx + 18, py - 7, 2, 9);
  rect(ctx, light, mx + 12, py - 7, 1, 9);
  // Left arm reaching down towards the keyboard.
  rect(ctx, gold, mx + 10, py - 6, 2, 4);
  rect(ctx, gold, mx + 11, py - 3, 1, 1);
  // Right arm raised, one finger pointing at the sky.
  rect(ctx, gold, mx + 20, py - 14, 2, 8);
  rect(ctx, shade, mx + 21, py - 14, 1, 8);
  rect(ctx, light, mx + 20, py - 17, 1, 3);
  // Head.
  rect(ctx, gold, mx + 13, py - 13, 6, 6);
  rect(ctx, light, mx + 13, py - 13, 2, 2);
  rect(ctx, shade, mx + 13, py - 8, 6, 1);
  rect(ctx, shade, mx + 14, py - 11, 1, 1);
  rect(ctx, shade, mx + 17, py - 11, 1, 1);
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

function paintFloor(ctx: Ctx, px: number, py: number, kind: Floor, x: number, y: number) {
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
  } else if (kind === ";") {
    // Test lab: clean white tiles, 8×8.
    rect(ctx, "#e4e8ec", px, py, TILE, TILE);
    rect(ctx, "#cfd5dc", px, py + 7, TILE, 1);
    rect(ctx, "#cfd5dc", px + 7, py, 1, TILE);
    rect(ctx, "#cfd5dc", px, py + 15, TILE, 1);
    rect(ctx, "#cfd5dc", px + 15, py, 1, TILE);
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
    case "H": {
      // Glass partition of a team's office: aluminium-framed pale glass, drawn
      // from the middle of the tile towards each glass neighbour, so corners
      // are clean L shapes and junctions clean T's.
      const glass = (gx: number, gy: number) => t[gy]?.[gx] === "H";
      const frame = "#8a94a3";
      const pane = "rgba(190, 228, 248, 0.55)";
      const left = glass(x - 1, y);
      const right = glass(x + 1, y);
      const up = glass(x, y - 1);
      const down = glass(x, y + 1);
      const across = left || right || (!up && !down);
      // Left-right: a pane between a top rail and a kick plate, 9 px tall.
      if (across) {
        const x0 = left || (!right && !up && !down) ? 0 : 8;
        const x1 = right || (!left && !up && !down) ? TILE : 8;
        rect(ctx, pane, px + x0, py + 5, x1 - x0, 9);
        rect(ctx, frame, px + x0, py + 4, x1 - x0, 1);
        rect(ctx, frame, px + x0, py + 14, x1 - x0, 2);
        if ((x + y) % 3 === 0 && x1 - x0 === TILE) rect(ctx, "rgba(255, 255, 255, 0.7)", px + 4, py + 7, 3, 1);
      }
      // Up-down: a thin pane between two mullions, from the middle up and/or down.
      if (up || down) {
        const y0 = up ? 0 : 4;
        const y1 = down ? TILE : across ? 16 : 12;
        rect(ctx, pane, px + 6, py + y0, 4, y1 - y0);
        rect(ctx, frame, px + 5, py + y0, 1, y1 - y0);
        rect(ctx, frame, px + 10, py + y0, 1, y1 - y0);
      }
      // A post at the middle (thicker where the wall ends at a doorway).
      const ends = [left, right, up, down].filter(Boolean).length === 1;
      if (ends || (across && (up || down))) rect(ctx, frame, px + 6, py + 3, 4, 13);
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
    case "L": {
      // The café's laptop bar: a wooden counter along the wall, with a laptop
      // over each stool (its screen is where the code scrolls while browsing).
      rect(ctx, "#6b4a32", px, py + 2, TILE, 13);
      rect(ctx, "#a8754c", px, py + 2, TILE, 10);
      rect(ctx, "#c48f62", px, py + 2, TILE, 1);
      if (t[y]?.[x - 1] !== "L") rect(ctx, "#6b4a32", px, py + 2, 1, 13);
      if (t[y]?.[x + 1] !== "L") rect(ctx, "#6b4a32", px + 15, py + 2, 1, 13);
      if (t[y + 1]?.[x] === "g") {
        rect(ctx, "#3b3f4a", px + 2, py + 1, 12, 9);
        rect(ctx, C.screen, px + 3, py + 2, 10, 7);
        rect(ctx, C.screenGlow, px + 4, py + 3, 5, 1);
        rect(ctx, C.screenGlow, px + 4, py + 5, 3, 1);
        rect(ctx, "#a9b0ba", px + 1, py + 10, 14, 2);
      } else if ((x * 3 + y) % 4 === 0) {
        // A coffee cup now and then.
        rect(ctx, "#f4f1e8", px + 6, py + 5, 4, 4);
        rect(ctx, "#6b4226", px + 7, py + 5, 2, 1);
      }
      break;
    }
    case "g": {
      // A bar stool.
      rect(ctx, "#3b3f4a", px + 7, py + 8, 2, 7);
      rect(ctx, "#3b3f4a", px + 5, py + 14, 6, 1);
      rect(ctx, "#c0504d", px + 4, py + 5, 8, 3);
      rect(ctx, "#e07b7b", px + 4, py + 5, 8, 1);
      break;
    }
    case "V": {
      // The statue of the Almighty Prompter, two tiles wide: drawn once from the
      // right tile, reaching back over the left one and up the wall behind it.
      if (t[y]?.[x - 1] !== "V") break;
      paintStatue(ctx, px - TILE, py);
      break;
    }
    case "n": {
      // A meeting chair, seen from behind: seat, back and a post.
      rect(ctx, "#2b2f38", px + 7, py + 11, 2, 4);
      rect(ctx, "#2b2f38", px + 4, py + 14, 8, 1);
      rect(ctx, "#4a5468", px + 3, py + 8, 10, 3);
      rect(ctx, "#5c6a82", px + 4, py + 2, 8, 6);
      rect(ctx, "#6f7f9a", px + 4, py + 2, 8, 1);
      break;
    }
    case "d": {
      if (t[y]?.[x + 1] !== "d" && t[y]?.[x - 1] !== "d") {
        // A one-monitor desk: monitor in the middle, keyboard in front.
        paintDeskBase(ctx, px, py, true, true);
        rect(ctx, C.monitor, px + 2, py + 1, 12, 9);
        rect(ctx, C.screen, px + 3, py + 2, 10, 7);
        rect(ctx, C.screenGlow, px + 4, py + 3, 3, 1);
        rect(ctx, C.screenGlow, px + 4, py + 5, 6, 1);
        rect(ctx, C.monitor, px + 7, py + 10, 2, 1);
        rect(ctx, C.monitor, px + 5, py + 11, 6, 1);
        rect(ctx, "#e2e2e2", px + 3, py + 12, 10, 2);
        break;
      }
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
    case "U": {
      // Mission-control console: dark desk, green readouts, a big red button now and then.
      rect(ctx, "#2b2f38", px, py + 2, TILE, 14);
      rect(ctx, "#3c4250", px + 1, py + 3, 14, 8);
      rect(ctx, "#0f1a12", px + 2, py + 4, 12, 6);
      const n = noise(x, y);
      rect(ctx, "#5af07a", px + 3, py + 5, 3 + Math.floor(n * 6), 1);
      rect(ctx, "#5af07a", px + 3, py + 7, 2 + Math.floor(noise(x + 9, y) * 8), 1);
      rect(ctx, "#f0c45a", px + 11, py + 5, 2, 1);
      rect(ctx, "#5c6370", px, py + 12, TILE, 2);
      if (x % 3 === 0) rect(ctx, "#ff3b3b", px + 6, py + 12, 4, 2);
      break;
    }
    case "O": {
      // Rocket silo, 3×3 tiles, drawn once from its top-left tile.
      if (t[y]?.[x - 1] === "O" || t[y - 1]?.[x] === "O") break;
      paintSilo(ctx, px, py);
      break;
    }
    case "Y": {
      // Office printer.
      rect(ctx, "#c9d0d8", px + 1, py + 5, 14, 9);
      rect(ctx, "#a9b0ba", px + 1, py + 12, 14, 2);
      rect(ctx, "#3b3f4a", px + 3, py + 7, 10, 2); // paper slot
      rect(ctx, "#fdfbf5", px + 4, py + 2, 8, 4); // paper tray
      rect(ctx, "#5af07a", px + 12, py + 10, 1, 1);
      rect(ctx, "#7d8590", px + 2, py + 14, 2, 2);
      rect(ctx, "#7d8590", px + 12, py + 14, 2, 2);
      break;
    }
    case "Q": {
      // Wall shelf of flasks with coloured liquids.
      rect(ctx, "#8f99a6", px, py + 1, TILE, 15);
      rect(ctx, "#b8c0ca", px + 1, py + 2, 14, 13);
      for (let shelf = 0; shelf < 2; shelf++) {
        const sy = py + 3 + shelf * 6;
        for (let k = 0; k < 3; k++) {
          const fx = px + 2 + k * 5;
          const liquid = ["#5af07a", "#5ab4f0", "#f0c45a", "#ff7a9a", "#c77dff"][Math.floor(noise(x * 3 + k, y + shelf) * 5)]!;
          rect(ctx, "#e9f6fb", fx + 1, sy, 1, 2); // neck
          rect(ctx, "#e9f6fb", fx, sy + 2, 3, 3); // body
          rect(ctx, liquid, fx, sy + 3, 3, 2);
        }
        rect(ctx, "#7d8590", px + 1, sy + 5, 14, 1);
      }
      break;
    }
    case "J": {
      // Lab bench: white top, steel legs, test-tube rack, beaker, a little result screen.
      const left = t[y]?.[x - 1] === "J";
      const right = t[y]?.[x + 1] === "J";
      const x0 = px + (left ? 0 : 1);
      const w = TILE - (left ? 0 : 1) - (right ? 0 : 1);
      rect(ctx, "#f4f6f8", x0, py + 4, w, 9);
      rect(ctx, "#c9d0d8", x0, py + 12, w, 2);
      if (!left) rect(ctx, "#7d8590", px + 2, py + 14, 1, 2);
      if (!right) rect(ctx, "#7d8590", px + 13, py + 14, 1, 2);
      const kind = (x + y) % 3;
      if (kind === 0) {
        rect(ctx, "#7d8590", px + 3, py + 8, 10, 2); // rack
        for (let i = 0; i < 4; i++) {
          rect(ctx, "#e9f6fb", px + 4 + i * 2, py + 3, 1, 5);
          rect(ctx, ["#5af07a", "#5ab4f0", "#ff7a9a", "#f0c45a"][i]!, px + 4 + i * 2, py + 6, 1, 2);
        }
      } else if (kind === 1) {
        rect(ctx, "#e9f6fb", px + 5, py + 3, 6, 6); // beaker
        rect(ctx, "#5ab4f0", px + 5, py + 6, 6, 3);
        rect(ctx, "#ffffff", px + 6, py + 4, 1, 2);
      } else {
        rect(ctx, C.monitor, px + 4, py + 2, 8, 7); // result screen
        rect(ctx, "#1b2a1e", px + 5, py + 3, 6, 5);
        rect(ctx, "#5af07a", px + 6, py + 4, 4, 1);
        rect(ctx, "#5af07a", px + 6, py + 6, 3, 1);
      }
      break;
    }
    case "W": {
      // Whiteboard on a stand: two tiles wide, drawn from the left half.
      if (t[y]?.[x - 1] === "W") break;
      rect(ctx, "#7d8590", px + 2, py + 11, 2, 5);
      rect(ctx, "#7d8590", px + 28, py + 11, 2, 5);
      rect(ctx, "#a9b0ba", px + 1, py, 30, 12);
      rect(ctx, "#fdfbf5", px + 2, py + 1, 28, 10);
      rect(ctx, "#4f81bd", px + 4, py + 3, 9, 1);
      rect(ctx, "#9097a6", px + 4, py + 5, 14, 1);
      rect(ctx, "#9097a6", px + 4, py + 7, 11, 1);
      rect(ctx, "#c0504d", px + 20, py + 4, 6, 4);
      rect(ctx, "#7d8590", px + 2, py + 11, 28, 1);
      break;
    }
    case "E": {
      // Manager's desk: three tiles of dark wood; the middle tile carries two monitors and a nameplate.
      const left = t[y]?.[x - 1] === "E";
      const right = t[y]?.[x + 1] === "E";
      const x0 = px + (left ? 0 : 1);
      const w = TILE - (left ? 0 : 1) - (right ? 0 : 1);
      rect(ctx, "#6b4226", x0, py + 3, w, 11);
      rect(ctx, "#8a5a36", x0, py + 3, w, 3);
      rect(ctx, "#4e2f1a", x0, py + 13, w, 2);
      if (!left) rect(ctx, "#4e2f1a", px + 1, py + 15, 2, 1);
      if (!right) rect(ctx, "#4e2f1a", px + 13, py + 15, 2, 1);
      if (left && right) {
        for (const mx of [px - 6, px + 8]) {
          rect(ctx, C.monitor, mx, py - 4, 13, 9);
          rect(ctx, C.screen, mx + 1, py - 3, 11, 7);
          rect(ctx, C.screenGlow, mx + 2, py - 2, 5, 1);
          rect(ctx, C.screenGlow, mx + 2, py, 7, 1);
          rect(ctx, C.monitor, mx + 5, py + 5, 3, 2);
        }
        rect(ctx, "#e2e2e2", px + 2, py + 9, 12, 2);
        // Gold nameplate.
        rect(ctx, "#b8902f", px + 4, py + 12, 8, 2);
        rect(ctx, "#f0c45a", px + 5, py + 12, 6, 1);
      } else if (!left) {
        // Lamp and a coffee mug.
        rect(ctx, "#333", px + 4, py + 5, 1, 5);
        rect(ctx, C.ledA, px + 2, py + 3, 5, 2);
        rect(ctx, "#f4f1e8", px + 9, py + 8, 3, 3);
      } else {
        // In-tray with papers.
        rect(ctx, "#3b3f4a", px + 3, py + 6, 8, 5);
        rect(ctx, C.paper, px + 4, py + 5, 6, 4);
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

/**
 * Rocket silo (48×48): concrete apron with hazard stripes around closed blast
 * doors. The launch animation draws the opening doors and rocket on top.
 */
export const SILO_DOORS = { x: 10, y: 10, w: 28, h: 28 };

function paintSilo(ctx: Ctx, px: number, py: number) {
  const S = TILE * 3;
  rect(ctx, "#7d8590", px, py, S, S);
  rect(ctx, "#8d97a3", px + 2, py + 2, S - 4, S - 4);
  // Hazard ring.
  for (let i = 0; i < S - 8; i += 4) {
    const c = (i / 4) % 2 ? "#1d1f27" : "#f0c45a";
    rect(ctx, c, px + 4 + i, py + 4, 4, 3);
    rect(ctx, c, px + 4 + i, py + S - 7, 4, 3);
    rect(ctx, c, px + 4, py + 4 + i, 3, 4);
    rect(ctx, c, px + S - 7, py + 4 + i, 3, 4);
  }
  // Pit and closed doors.
  const d = SILO_DOORS;
  rect(ctx, "#11131a", px + d.x - 1, py + d.y - 1, d.w + 2, d.h + 2);
  rect(ctx, "#5c6370", px + d.x, py + d.y, d.w / 2 - 1, d.h);
  rect(ctx, "#5c6370", px + d.x + d.w / 2 + 1, py + d.y, d.w / 2 - 1, d.h);
  rect(ctx, "#4c5160", px + d.x + 3, py + d.y + 3, d.w / 2 - 7, d.h - 6);
  rect(ctx, "#4c5160", px + d.x + d.w / 2 + 4, py + d.y + 3, d.w / 2 - 7, d.h - 6);
  // Corner lights.
  for (const [cx, cy] of [[2, 2], [S - 4, 2], [2, S - 4], [S - 4, S - 4]] as const) rect(ctx, "#ff5d2a", px + cx, py + cy, 2, 2);
}

/** A team's rug in its session colour, with a stitched border. */
function paintRug(ctx: Ctx, tx: number, ty: number, tw: number, th: number, color: number) {
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const x = tx * TILE + 4;
  const y = (ty + 1) * TILE - 4;
  const w = tw * TILE - 8;
  const h = (th - 1) * TILE;
  ctx.save();
  ctx.globalAlpha = 0.13;
  rect(ctx, hex, x, y, w, h);
  ctx.globalAlpha = 0.6;
  rect(ctx, hex, x, y, w, 2);
  rect(ctx, hex, x, y + h - 2, w, 2);
  rect(ctx, hex, x, y, 2, h);
  rect(ctx, hex, x + w - 2, y, 2, h);
  ctx.globalAlpha = 0.45;
  for (let i = x + 6; i < x + w - 6; i += 6) {
    rect(ctx, hex, i, y + 4, 3, 1);
    rect(ctx, hex, i, y + h - 5, 3, 1);
  }
  ctx.restore();
}

function paintDeskBase(ctx: Ctx, px: number, py: number, closeRight: boolean, closeLeft: boolean) {
  const x0 = px + (closeLeft ? 1 : 0);
  const w = TILE - (closeLeft ? 1 : 0) - (closeRight ? 1 : 0);
  rect(ctx, C.desk, x0, py + 4, w, 10);
  rect(ctx, C.deskEdge, x0, py + 13, w, 2);
  rect(ctx, C.deskEdge, x0 + (closeLeft ? 1 : 0), py + 15, 2, 1);
}
