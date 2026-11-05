import { DEFAULT_SETTINGS, type OfficeSettings, type TopRoom } from "@pixel-office/protocol";
import { analyze, type Office, type RoomArea, type Spot, type TeamArea } from "./layout.js";

/**
 * Builds the office from room templates sized to what's needed right now.
 *
 *   ┌ library ┬ server room ┬ test lab ┬ git room ┬ mailroom ┐   ← top band: rooms sized by capacity
 *   D reception · lounge · globe desks · filing       │   ← service strip, sized by capacity
 *   │ [team A] [team B] [team C]                      │   ← one area per session: manager's
 *   │ [team D] …                                      │     desk + worker desks for sub-agents
 *   └─────────────────────────────────────────────────┘
 *
 * Pure: same plan in, same office out.
 */

export interface RoomCapacities {
  library: number;
  server: number;
  lab: number;
  git: number;
  mail: number;
  lounge: number;
  reception: number;
  globe: number;
  filing: number;
}

export interface TeamPlan {
  sessionId: string;
  project: string;
  /** Worker desks to provide (a multiple of WORKERS_PER_ROW). */
  workerSlots: number;
}

export interface OfficePlan {
  rooms: RoomCapacities;
  /**
   * Team areas in display order. `null` is an empty spot left by a team that
   * went home, kept so the other teams don't all shift over.
   */
  teams: (TeamPlan | null)[];
  settings?: OfficeSettings;
}

export const WORKERS_PER_ROW = 3;
const TEAM_W = 12;
const ROOM_H = 7;
const MIN_WIDTH = 45;

/** Smallest capacities, so a quiet office still has every room (overridable in settings). */
export const MIN_ROOMS: RoomCapacities = { ...DEFAULT_SETTINGS.minRooms };

// --- room templates ------------------------------------------------------------
// Each takes an interior width and returns ROOM_H rows of that width.

type Room = (w: number) => string[];

const row = (w: number, f: (x: number) => string) => Array.from({ length: w }, (_, x) => f(x)).join("");

const library: Room = (w) => {
  const shelf = (x: number) => x > 0 && x < w - 1 && (x - 1) % 5 < 4;
  return [
    "B".repeat(w),
    row(w, (x) => (x % 2 ? "l" : ",")),
    ",".repeat(w),
    row(w, (x) => (shelf(x) ? "B" : ",")),
    row(w, (x) => (shelf(x) && x % 2 ? "l" : ",")),
    ",".repeat(w),
    row(w, (x) => (x === 0 || x === w - 1 ? "P" : ",")),
  ];
};

const serverRoom: Room = (w) => {
  const rack = (x: number) => x > 0 && x < w - 1 && (x - 1) % 4 < 2;
  return [
    "R".repeat(w),
    row(w, (x) => (x % 2 ? ":" : "r")),
    ":".repeat(w),
    row(w, (x) => (rack(x) ? "R" : ":")),
    row(w, (x) => (rack(x) && (x - 1) % 4 === 0 ? "r" : ":")),
    ":".repeat(w),
    ":".repeat(w),
  ];
};

/** Test lab: shelves of flasks along the wall, benches with test tubes, light tiled floor. */
const testLab: Room = (w) => {
  const bench = (x: number) => x > 0 && x < w - 1 && (x - 1) % 4 < 3;
  return [
    "Q".repeat(w),
    row(w, (x) => (x % 2 ? "j" : ";")),
    ";".repeat(w),
    row(w, (x) => (bench(x) ? "J" : ";")),
    row(w, (x) => (bench(x) && x % 2 ? "j" : ";")),
    ";".repeat(w),
    ";".repeat(w),
  ];
};

/** Git room: mission-control consoles along the wall and a rocket silo in the middle. */
const gitRoom: Room = (w) => {
  const c = Math.floor(w / 2) - 1; // silo's left column
  const silo = (x: number) => x >= c && x <= c + 2;
  return [
    "U".repeat(w),
    row(w, (x) => (x % 2 ? "z" : ":")),
    ":".repeat(w),
    row(w, (x) => (silo(x) ? "O" : ":")),
    row(w, (x) => (silo(x) ? "O" : ":")),
    row(w, (x) => (silo(x) ? "O" : ":")),
    ":".repeat(w),
  ];
};

const mailroom: Room = (w) => [
  "M".repeat(w),
  row(w, (x) => (x % 2 ? "." : "m")),
  ".".repeat(w),
  ".".repeat(w),
  ".".repeat(w),
  ".".repeat(w),
  row(w, (x) => (x === 0 || x === w - 1 ? "P" : ".")),
];

function capacityOf(room: string[], spot: string): number {
  return room.reduce((n, r) => n + [...r].filter((c) => c === spot).length, 0);
}

/** The narrowest width whose room fits `cap` agents. */
function widthFor(room: Room, spot: string, cap: number, min: number, max = 40): number {
  for (let w = min; w <= max; w++) if (capacityOf(room(w), spot) >= cap) return w;
  return max;
}

// --- the office -----------------------------------------------------------------

class Grid {
  readonly cells: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
    fill: string,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  }
  put(x: number, y: number, s: string) {
    [...s].forEach((c, i) => {
      const r = this.cells[y];
      if (r && x + i >= 0 && x + i < this.w) r[x + i] = c;
    });
  }
  block(x: number, y: number, rows: string[]) {
    rows.forEach((r, i) => this.put(x, y + i, r));
  }
}

export function generateOffice(plan: OfficePlan): Office {
  const settings = plan.settings ?? DEFAULT_SETTINGS;
  const cap = { ...plan.rooms };
  for (const k of Object.keys(MIN_ROOMS) as (keyof RoomCapacities)[]) cap[k] = Math.max(cap[k], settings.minRooms[k]);

  // Top band widths.
  const lw = widthFor(library, "l", cap.library, 8);
  const sw = widthFor(serverRoom, "r", cap.server, 7);
  let tw = widthFor(testLab, "j", cap.lab, 6);
  const gw = widthFor(gitRoom, "z", cap.git, 7);
  const aw = widthFor(mailroom, "m", cap.mail, 5);

  // Service strip widths.
  const rw = Math.max(5, Math.ceil((cap.reception * 2) / 3));
  const loungeRow = Math.max(6, Math.ceil(cap.lounge / 2));
  const gc = Math.max(2, cap.globe);
  const fc = Math.max(3, cap.filing);
  const stripW = 1 + 2 + rw + 3 + (2 + loungeRow) + 3 + gc * 2 + 2 + fc * 2 + 1 + 1;

  const topW = 1 + lw + 1 + sw + 1 + tw + 1 + gw + 1 + aw + 1;
  // Wide enough for the rooms, the strip, and the configured number of teams side by side.
  const perRow = Math.min(4, Math.max(1, settings.teamsPerRow));
  const W = Math.max(MIN_WIDTH, topW, stripW, 3 + perRow * (TEAM_W + 1));
  tw += W - topW; // the test lab takes up any slack in the top band

  const teamRows: (TeamPlan | null)[][] = [];
  for (let i = 0; i < plan.teams.length; i += perRow) teamRows.push(plan.teams.slice(i, i + perRow));
  const teamHeight = (t: TeamPlan | null) => 4 + 3 * Math.max(1, Math.ceil((t?.workerSlots ?? WORKERS_PER_ROW) / WORKERS_PER_ROW));
  const bandHeights = teamRows.map((r) => Math.max(...r.map(teamHeight)));
  const teamBandH = Math.max(7, bandHeights.reduce((a, b) => a + b, 0)) + 1;

  const TOP = 1 + ROOM_H + 1;
  const STRIP = 6;
  const H = TOP + STRIP + teamBandH + 1;
  const g = new Grid(W, H, ".");

  // Outer walls.
  g.put(0, 0, row(W, (x) => (x > 1 && x < W - 2 && x % 4 < 2 ? "=" : "#")));
  g.put(0, H - 1, row(W, (x) => (x > 1 && x < W - 2 && x % 4 < 2 ? "=" : "#")));
  for (let y = 0; y < H; y++) {
    g.put(0, y, "#");
    g.put(W - 1, y, "#");
  }

  // Top band: rooms separated by walls, a wall below with a door into each room.
  const byName: Record<TopRoom, [Room, number]> = {
    library: [library, lw],
    server: [serverRoom, sw],
    lab: [testLab, tw],
    git: [gitRoom, gw],
    mail: [mailroom, aw],
  };
  const valid = settings.roomOrder.length === 5 && settings.roomOrder.every((r) => r in byName);
  const order = valid ? settings.roomOrder : DEFAULT_SETTINGS.roomOrder;
  const rooms = order.map((r) => [r, ...byName[r]] as const);
  const roomAreas: RoomArea[] = [];
  let silo: { x: number; y: number } | undefined;
  let x = 1;
  g.put(0, TOP - 1, "#".repeat(W));
  for (const [kind, room, w] of rooms) {
    g.block(x, 1, room(w));
    roomAreas.push({ kind, x, y: 1, w, h: ROOM_H });
    if (kind === "git") silo = { x: x + Math.floor(w / 2) - 1, y: 4 };
    const door = x + Math.floor(w / 2) - 1;
    g.put(door, TOP - 1, w >= 6 ? ".." : ".");
    x += w;
    if (x < W - 1) for (let y = 0; y < TOP; y++) g.put(x, y, "#");
    x += 1;
  }

  // Service strip: entrance, reception, lounge, globe desks, filing cabinets.
  const sy = TOP;
  g.put(0, sy + 2, "D");
  g.put(0, sy + 3, "D");
  let sx = 3;
  g.put(sx, sy + 1, "X".repeat(rw));
  g.put(sx, sy + 2, "x".repeat(rw));
  g.put(sx, sy + 3, row(rw, (i) => (i % 2 ? "." : "x")));
  sx += rw + 3;
  g.put(sx, sy + 1, `K.${"k".repeat(loungeRow)}`);
  g.put(sx, sy + 2, "k");
  g.put(sx + 2, sy + 4, "k".repeat(loungeRow));
  g.put(sx + 2 + loungeRow, sy + 5, "w");
  sx += 2 + loungeRow + 3;
  g.put(sx, sy + 1, "G.".repeat(gc));
  g.put(sx, sy + 2, "g.".repeat(gc));
  sx += gc * 2 + 2;
  g.put(sx, sy + 1, "F".repeat(fc * 2 - 1));
  g.put(sx, sy + 2, row(fc * 2 - 1, (i) => (i % 2 ? "." : "f")));
  g.put(1, sy + 5, "P");
  g.put(W - 2, sy + 5, "P");

  // Team band.
  const teams: TeamArea[] = [];
  let ty = TOP + STRIP;
  teamRows.forEach((teamRow, ri) => {
    teamRow.forEach((t, ci) => {
      if (!t) return; // an empty spot, kept so neighbours don't move
      const tx = 2 + ci * (TEAM_W + 1);
      teams.push(placeTeam(g, t, tx, ty));
    });
    ty += bandHeights[ri]!;
  });
  if (!teamRows.length) {
    g.put(Math.floor(W / 2), TOP + STRIP + 3, "P");
  }

  if (!settings.plants) {
    for (const r of g.cells) for (let i = 0; i < r.length; i++) if (r[i] === "P") r[i] = ".";
  }
  const { walkable, spots } = analyze(g.cells);
  // Spots in team areas come from placeTeam with stable slot order; re-point them at the analyzed spot objects.
  const at = new Map(spots.map((s) => [`${s.x},${s.y}`, s]));
  for (const t of teams) {
    t.managerSeat = at.get(`${t.managerSeat.x},${t.managerSeat.y}`) ?? t.managerSeat;
    t.workerSeats = t.workerSeats.map((s) => at.get(`${s.x},${s.y}`) ?? s);
  }
  return { width: W, height: H, rooms: roomAreas, ...(silo ? { silo } : {}), tiles: g.cells, walkable, spots, teams };
}

/**
 *   ............   label row
 *   P...EEE.WW.P   manager's desk, whiteboard (the team's todo list)
 *   .....q......   manager's chair
 *   ...........Y   printer
 *   .dd..dd..dd.   worker desks, three per row
 *   .a...a...a..   worker chairs (slot order: left to right, top to bottom)
 *   ............
 */
function placeTeam(g: Grid, t: TeamPlan, x: number, y: number): TeamArea {
  const rows = Math.max(1, Math.ceil(t.workerSlots / WORKERS_PER_ROW));
  const h = 4 + rows * 3;
  g.put(x + 4, y + 1, "EEE");
  g.put(x + 8, y + 1, "WW");
  g.put(x + 11, y + 3, "Y");
  g.put(x + 5, y + 2, "q");
  g.put(x, y + 1, "P");
  g.put(x + 11, y + 1, "P");
  const workerSeats: Spot[] = [];
  for (let r = 0; r < rows; r++) {
    const ry = y + 4 + r * 3;
    for (let c = 0; c < WORKERS_PER_ROW; c++) {
      const cx = x + 1 + c * 4;
      g.put(cx, ry, "dd");
      g.put(cx, ry + 1, "a");
      workerSeats.push({ kind: "seat", x: cx, y: ry + 1, facing: "up" });
    }
  }
  return {
    sessionId: t.sessionId,
    project: t.project,
    x,
    y,
    w: TEAM_W,
    h,
    managerSeat: { kind: "manager", x: x + 5, y: y + 2, facing: "up" },
    whiteboard: { x: x + 8, y: y + 1 },
    printer: { x: x + 11, y: y + 3 },
    workerSeats,
  };
}
