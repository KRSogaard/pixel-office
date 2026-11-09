import { DEFAULT_SETTINGS, type OfficeSettings, type TopRoom } from "@pixel-office/protocol";
import { analyze, type Office, type RoomArea, type Spot, type TeamArea } from "./layout.js";

/**
 * Builds the office from room templates sized to what's needed right now.
 *
 *   ┌ internet room ┬ server room ┬ café ┬ test lab ┬ git room ┬ meeting room ┐   ← top band: rooms sized by capacity
 *   D corridor, with the front door on the left     │
 *   │ [team A] [team B] [team C]                      │   ← one area per session: manager's
 *   │ [team D] …                                      │     desk + worker desks for sub-agents
 *   └─────────────────────────────────────────────────┘
 *
 * Pure: same plan in, same office out.
 */

export interface RoomCapacities {
  web: number;
  server: number;
  lab: number;
  git: number;
  meeting: number;
  lounge: number;
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

export const WORKERS_PER_ROW = 5;
const TEAM_W = 12;
/** Walkway between team offices (and along the outer walls), so the back rows get to the rooms quickly. */
const AISLE = 2;
/** One office from wall to wall, plus the aisle on its left. */
const OFFICE_STEP = TEAM_W + 2 + AISLE;
const ROOM_H = 7;
const MIN_WIDTH = 45;

/** Smallest capacities, so a quiet office still has every room (overridable in settings). */
export const MIN_ROOMS: RoomCapacities = { ...DEFAULT_SETTINGS.minRooms };

// --- room templates ------------------------------------------------------------
// Each takes an interior width and returns ROOM_H rows of that width.

type Room = (w: number) => string[];

const row = (w: number, f: (x: number) => string) => Array.from({ length: w }, (_, x) => f(x)).join("");

/**
 * Internet room: where agents browse the web (WebFetch, WebSearch). A laptop
 * bar along the back wall and an island bar in the middle, each with stools,
 * and an aisle from the door.
 */
const webRoom: Room = (w) => {
  const mid = Math.floor(w / 2) - 1; // the aisle (and the door below it): mid, mid + 1
  const island = (x: number) => x >= 1 && x <= w - 2 && x !== mid && x !== mid + 1;
  return [
    "L".repeat(w),
    row(w, (x) => (x % 2 && x < w - 1 ? "g" : ",")),
    ",".repeat(w),
    row(w, (x) => (island(x) ? "L" : ",")),
    row(w, (x) => (island(x) && x % 2 ? "g" : ",")),
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

/**
 * Café: where idle agents wait and rate-limited ones take a coffee break. The
 * coffee machine in the corner, two groups of sofas either side of an aisle
 * from the door, a plant and a water cooler.
 */
const cafe: Room = (w) => {
  const mid = Math.floor(w / 2) - 1; // the aisle (and the door below it): mid, mid + 1
  // Two matching groups of sofas, either side of the aisle.
  const sofa = (x: number) => (x >= 1 && x <= mid - 1) || (x >= mid + 2 && x <= w - 2);
  return [
    row(w, (x) => (x === 0 ? "K" : x === w - 1 ? "P" : ".")),
    ".".repeat(w),
    row(w, (x) => (sofa(x) ? "k" : ".")),
    ".".repeat(w),
    row(w, (x) => (sofa(x) ? "k" : ".")),
    ".".repeat(w),
    row(w, (x) => (x === 0 ? "P" : x === w - 1 ? "w" : ".")),
  ];
};

/**
 * Meeting room: where an agent that needs you (a permission prompt, a
 * question) sits and waits for you to join. Against the back wall stands a
 * golden statue of the Almighty Prompter (you), with room to kneel in front of
 * it; two long tables face it, chairs in front of each, and an aisle runs
 * from the door.
 */
const meetingRoom: Room = (w) => {
  const mid = Math.floor(w / 2) - 1; // the aisle (and the door below it): mid, mid + 1
  const table = (x: number) => x >= 1 && x <= w - 2 && x !== mid && x !== mid + 1;
  const chair = table;
  return [
    row(w, (x) => (x === 0 || x === w - 1 ? "P" : x === mid || x === mid + 1 ? "V" : ".")),
    row(w, (x) => (x >= mid - 1 && x <= mid + 2 ? "s" : ".")),
    row(w, (x) => (table(x) ? "T" : ".")),
    row(w, (x) => (chair(x) ? "n" : ".")),
    ".".repeat(w),
    row(w, (x) => (table(x) ? "T" : ".")),
    row(w, (x) => (chair(x) ? "n" : ".")),
  ];
};

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
  const lw = widthFor(webRoom, "g", cap.web, 8);
  const sw = widthFor(serverRoom, "r", cap.server, 7);
  let tw = widthFor(testLab, "j", cap.lab, 6);
  const gw = widthFor(gitRoom, "z", cap.git, 7);
  const mw = widthFor(meetingRoom, "n", cap.meeting, 8);
  const cw = widthFor(cafe, "k", cap.lounge, 8);

  const topW = 1 + lw + 1 + sw + 1 + cw + 1 + tw + 1 + gw + 1 + mw + 1;
  // Wide enough for the rooms, the strip, and the configured number of teams side by side.
  const perRow = Math.min(4, Math.max(1, settings.teamsPerRow));
  // Offices side by side, with an aisle before, between and after them.
  const W = Math.max(MIN_WIDTH, topW, 2 + perRow * OFFICE_STEP + AISLE);
  tw += W - topW; // the test lab takes up any slack in the top band

  const teamRows: (TeamPlan | null)[][] = [];
  for (let i = 0; i < plan.teams.length; i += perRow) teamRows.push(plan.teams.slice(i, i + perRow));
  // The inside: entry row, manager's desk, chair, printer, three rows per desk row, and a last empty row
  // (so the side doorways never sit right by a corner).
  const teamHeight = (t: TeamPlan | null) => 5 + 3 * Math.max(1, Math.ceil((t?.workerSlots ?? WORKERS_PER_ROW) / WORKERS_PER_ROW));
  // A row of offices: glass front, inside, glass back, then a corridor to the next row.
  const bandHeights = teamRows.map((r) => Math.max(...r.map(teamHeight)) + 3);
  const teamBandH = Math.max(7, bandHeights.reduce((a, b) => a + b, 0)) + 1;

  const TOP = 1 + ROOM_H + 1;
  // The corridor between the rooms and the team offices, with the front door.
  const STRIP = 3;
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
    web: [webRoom, lw],
    server: [serverRoom, sw],
    cafe: [cafe, cw],
    lab: [testLab, tw],
    git: [gitRoom, gw],
    meeting: [meetingRoom, mw],
  };
  const valid = settings.roomOrder.length === Object.keys(byName).length && settings.roomOrder.every((r) => r in byName);
  const order = valid ? settings.roomOrder : DEFAULT_SETTINGS.roomOrder;
  const rooms = order.map((r) => [r, ...byName[r]] as const);
  const roomAreas: RoomArea[] = [];
  let silo: { x: number; y: number } | undefined;
  let statue: { x: number; y: number } | undefined;
  let x = 1;
  g.put(0, TOP - 1, "#".repeat(W));
  for (const [kind, room, w] of rooms) {
    g.block(x, 1, room(w));
    roomAreas.push({ kind, x, y: 1, w, h: ROOM_H, door: { x: x + Math.floor(w / 2) - 1, y: TOP - 1 } });
    if (kind === "git") silo = { x: x + Math.floor(w / 2) - 1, y: 4 };
    if (kind === "meeting") statue = { x: x + Math.floor(w / 2) - 1, y: 1 };
    const door = x + Math.floor(w / 2) - 1;
    g.put(door, TOP - 1, w >= 6 ? ".." : ".");
    x += w;
    if (x < W - 1) for (let y = 0; y < TOP; y++) g.put(x, y, "#");
    x += 1;
  }

  // The front door, on the left of the corridor.
  g.put(0, TOP + 1, "D");
  g.put(0, TOP + 2, "D");

  // Team band.
  const teams: TeamArea[] = [];
  let ty = TOP + STRIP;
  teamRows.forEach((teamRow, ri) => {
    const inside = bandHeights[ri]! - 3;
    teamRow.forEach((t, ci) => {
      if (!t) return; // an empty spot, kept so neighbours don't move
      // The inside starts after the outer wall, the aisle and the office's own glass wall.
      const tx = 1 + AISLE + ci * OFFICE_STEP + 1;
      teams.push(placeTeam(g, t, tx, ty + 1, inside));
    });
    ty += bandHeights[ri]!;
  });
  if (!teamRows.length) {
    g.put(Math.floor(W / 2), TOP + STRIP + 3, "P");
  }

  if (!settings.plants) {
    for (const r of g.cells) for (let i = 0; i < r.length; i++) if (r[i] === "P") r[i] = ".";
  }
  const { walkable, passable, spots } = analyze(g.cells);
  // Spots in team areas come from placeTeam with stable slot order; re-point them at the analyzed spot objects.
  const at = new Map(spots.map((s) => [`${s.x},${s.y}`, s]));
  for (const t of teams) {
    t.managerSeat = at.get(`${t.managerSeat.x},${t.managerSeat.y}`) ?? t.managerSeat;
    t.workerSeats = t.workerSeats.map((s) => at.get(`${s.x},${s.y}`) ?? s);
  }
  return {
    width: W,
    height: H,
    rooms: roomAreas,
    ...(silo ? { silo } : {}),
    ...(statue ? { statue } : {}),
    tiles: g.cells,
    walkable,
    passable,
    spots,
    teams,
  };
}

/**
 * A team's office. Glass walls (H) go around the inside, with an aisle
 * between neighbours; the doorway is in the front (top) wall, the name plate
 * over the manager's desk:
 *
 *  H..HHHHHHHHHHH   glass front: doorway, name plate over the manager's desk
 *  H............H   just inside the door
 *  HP...EEE.WW.PH   manager's desk, whiteboard (the team's todo list)
 *   .....q......   manager's chair
 *   ...........Y   printer
 *  H.d.d.d.d.d..H   worker desks (one monitor each), five per row
 *  H.a.a.a.a.a..H   worker chairs, right in front (slot order: left to right, top to bottom)
 *  ..............   walkway, with doorways onto the aisles on both sides
 *  H............H
 *  HHHHHHHHHHHHHH   glass back
 *
 * `y` is the first row inside; `h` the inside height (the tallest office in
 * the row, so the backs line up).
 */
function placeTeam(g: Grid, t: TeamPlan, x: number, y: number, h: number): TeamArea {
  const rows = Math.max(1, Math.ceil(t.workerSlots / WORKERS_PER_ROW));
  // Glass walls round the inside, with a two-tile doorway in the front.
  g.put(x - 1, y - 1, "H".repeat(TEAM_W + 2));
  g.put(x - 1, y + h, "H".repeat(TEAM_W + 2));
  for (let r = y; r < y + h; r++) {
    g.put(x - 1, r, "H");
    g.put(x + TEAM_W, r, "H");
  }
  g.put(x + 1, y - 1, "..");
  // Side doorways onto the aisles, from the walkway behind each row of desks.
  for (let r = 0; r < rows; r++) {
    const walkway = y + 6 + r * 3;
    g.put(x - 1, walkway, ".");
    g.put(x + TEAM_W, walkway, ".");
  }
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
      const cx = x + 1 + c * 2;
      g.put(cx, ry, "d");
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
    door: { x: x + 1, y: y - 1 },
    sign: { x: x + 4, y: y - 1, w: 7 },
    workerSeats,
  };
}
