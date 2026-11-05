/**
 * Office tile model: what a generated office looks like to the rest of the app.
 * The office itself is built by `generate.ts` from room templates.
 *
 * Tile legend — structure (blocks movement unless noted):
 *   #  wall              =  wall with window     D  entrance door (walkable, agents spawn here)
 *   .  wood floor        ,  carpet               :  server-room tiles
 *   B  bookshelf         R  server rack          J  lab bench
 *   M  mail shelves      K  coffee machine       P  plant
 *   Q  shelf of flasks   ;  test-lab floor (walkable)
 *   F  filing cabinet    G  globe desk           X  reception counter
 *   d  work desk         E  manager's desk       w  water cooler
 *   W  whiteboard
 *
 * Tile legend — spots (walkable, agents stand or sit there):
 *   l  library           r  server rack terminal m  mailroom
 *   g  globe desk        f  filing cabinet       j  lab bench spot
 *   k  lounge sofa seat  x  reception (waiting on you)
 *   a  worker desk seat  q  manager's chair
 */

export const TILE = 16;

export type SpotKind =
  | "library"
  | "server"
  | "mail"
  | "globe"
  | "filing"
  | "lab"
  | "lounge"
  | "reception"
  | "seat"
  | "manager"
  | "door";

export type Facing = "up" | "down" | "left" | "right";

export interface Spot {
  kind: SpotKind;
  x: number;
  y: number;
  /** Which way an agent faces when it's on this spot. */
  facing: Facing;
}

/** One session's corner of the office: a manager's desk with worker desks in front. */
export interface TeamArea {
  sessionId: string;
  project: string;
  /** Tile bounds of the whole area (for the rug and the label). */
  x: number;
  y: number;
  w: number;
  h: number;
  managerSeat: Spot;
  /** Left tile of the 2-wide whiteboard that shows the team's todo list. */
  whiteboard: { x: number; y: number };
  /** Worker seats in a stable order: slot 0, 1, 2, … */
  workerSeats: Spot[];
}

/** A room along the top, for signs and labels. */
export interface RoomArea {
  kind: "library" | "server" | "lab" | "mail";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Office {
  width: number;
  height: number;
  rooms: RoomArea[];
  /** Layout chars, [y][x]. */
  tiles: string[][];
  walkable: boolean[][];
  spots: Spot[];
  teams: TeamArea[];
}

export const BLOCKING = new Set("#=BRJQMKPFGXdEwW");

export const SPOT_KIND: Record<string, SpotKind> = {
  l: "library",
  r: "server",
  m: "mail",
  g: "globe",
  f: "filing",
  j: "lab",
  k: "lounge",
  x: "reception",
  a: "seat",
  q: "manager",
  D: "door",
};

/** Walkability and spots for a grid of layout chars. */
export function analyze(tiles: string[][]): { walkable: boolean[][]; spots: Spot[] } {
  const walkable = tiles.map((row) => row.map((c) => !BLOCKING.has(c)));
  const spots: Spot[] = [];
  tiles.forEach((row, y) =>
    row.forEach((c, x) => {
      const kind = SPOT_KIND[c];
      if (kind) spots.push({ kind, x, y, facing: facingFor(tiles, x, y, kind) });
    }),
  );
  return { walkable, spots };
}

/** The floor under a spot or furniture tile, picked from its neighbours. */
export type Floor = "." | "," | ":" | ";";

export function isFloor(c: string): c is Floor {
  return c === "." || c === "," || c === ":" || c === ";";
}

/** The floor under a spot or furniture tile: the most common floor among its neighbours. */
export function floorAt(tiles: string[][], x: number, y: number): Floor {
  const counts: Record<Floor, number> = { ".": 0, ",": 0, ":": 0, ";": 0 };
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [1, -1], [-1, 1]] as const) {
    const c = tiles[y + dy]?.[x + dx];
    if (c && isFloor(c)) counts[c]++;
  }
  let best: Floor = ".";
  for (const f of [",", ":", ";"] as const) if (counts[f] > counts[best]) best = f;
  return best;
}

function facingFor(tiles: string[][], x: number, y: number, kind: SpotKind): Facing {
  if (kind === "door") return "right";
  if (kind === "lounge") return "down";
  if (BLOCKING.has(tiles[y - 1]?.[x] ?? "#")) return "up";
  if (BLOCKING.has(tiles[y + 1]?.[x] ?? "#")) return "down";
  return "up";
}
