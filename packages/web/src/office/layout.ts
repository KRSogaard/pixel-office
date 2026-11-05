import { FOOTER, HEADER, MIN_POD_ROWS, POD_ROW } from "./layout.data.js";

export const TILE = 16;

export type SpotKind = "library" | "server" | "mail" | "globe" | "filing" | "meeting" | "lounge" | "reception" | "seat" | "door";

export interface Spot {
  kind: SpotKind;
  x: number;
  y: number;
  /** Which way an agent faces when it's on this spot. */
  facing: Facing;
  /** For seats: global pod index. */
  pod?: number;
}

export type Facing = "up" | "down" | "left" | "right";

export interface Pod {
  index: number;
  seats: Spot[];
  /** Tile bounds, for drawing the project name above the pod. */
  x: number;
  y: number;
  w: number;
}

export interface Office {
  width: number;
  height: number;
  /** Raw layout chars, [y][x]. */
  tiles: string[][];
  walkable: boolean[][];
  spots: Spot[];
  pods: Pod[];
  podRows: number;
}

const BLOCKING = new Set("#=BRTMKSPFGXdw");
const SPOT_KIND: Record<string, SpotKind> = {
  l: "library",
  r: "server",
  m: "mail",
  g: "globe",
  f: "filing",
  t: "meeting",
  k: "lounge",
  x: "reception",
  D: "door",
};
const POD_LETTERS = "abc";
const PODS_PER_ROW = POD_LETTERS.length;

export function podsPerRow(): number {
  return PODS_PER_ROW;
}

/** Builds the office with enough pod rows for `podsNeeded` pods. */
export function buildOffice(podsNeeded: number): Office {
  const podRows = Math.max(MIN_POD_ROWS, Math.ceil(podsNeeded / PODS_PER_ROW));
  const rows = [...HEADER];
  for (let i = 0; i < podRows; i++) rows.push(...POD_ROW);
  rows.push(...FOOTER);

  const width = rows[0]!.length;
  rows.forEach((r, y) => {
    if (r.length !== width) throw new Error(`layout row ${y} is ${r.length} wide, expected ${width}`);
  });

  const tiles = rows.map((r) => [...r]);
  const walkable = tiles.map((row) => row.map((c) => !BLOCKING.has(c)));
  const spots: Spot[] = [];
  const podMap = new Map<number, Pod>();

  tiles.forEach((row, y) => {
    row.forEach((c, x) => {
      const kind = SPOT_KIND[c];
      if (kind) {
        spots.push({ kind, x, y, facing: facingFor(tiles, x, y, kind) });
        return;
      }
      const podLetter = POD_LETTERS.indexOf(c);
      if (podLetter >= 0 && y >= HEADER.length) {
        const rowIndex = Math.floor((y - HEADER.length) / POD_ROW.length);
        const index = rowIndex * PODS_PER_ROW + podLetter;
        const seat: Spot = { kind: "seat", x, y, facing: "up", pod: index };
        spots.push(seat);
        let pod = podMap.get(index);
        if (!pod) {
          pod = { index, seats: [], x, y: y - 2, w: 0 };
          podMap.set(index, pod);
        }
        pod.seats.push(seat);
        pod.x = Math.min(pod.x, x);
        pod.y = Math.min(pod.y, y - 2);
        pod.w = Math.max(pod.w, x - pod.x + 2);
      }
    });
  });

  const pods = [...podMap.values()].sort((a, b) => a.index - b.index);
  return { width, height: rows.length, tiles, walkable, spots, pods, podRows };
}

/** The floor under a spot or furniture tile, picked from its neighbours. */
export function floorAt(tiles: string[][], x: number, y: number): "." | "," | ":" {
  const counts = { ".": 0, ",": 0, ":": 0 };
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [1, -1], [-1, 1]] as const) {
    const c = tiles[y + dy]?.[x + dx];
    if (c === "." || c === "," || c === ":") counts[c]++;
  }
  if (counts[","] > counts["."] && counts[","] >= counts[":"]) return ",";
  if (counts[":"] > counts["."]) return ":";
  return ".";
}

function facingFor(tiles: string[][], x: number, y: number, kind: SpotKind): Facing {
  if (kind === "door") return "right";
  if (kind === "lounge") return "down";
  if (kind === "meeting") return tiles[y + 1]?.[x] === "T" ? "down" : "up";
  // Face the furniture next to the spot, preferring the one above.
  if (BLOCKING.has(tiles[y - 1]?.[x] ?? "#")) return "up";
  if (BLOCKING.has(tiles[y + 1]?.[x] ?? "#")) return "down";
  return "up";
}
