import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { floorAt, isFloor, type Office } from "../../office/layout.js";

/**
 * The static office in low-poly 3D, built from the layout: floors, low walls
 * (cut down so you can see into the rooms), and furniture made of a few flat-
 * shaded shapes each. One tile is one unit; y is up; the layout's (x, y) is
 * the floor's (x, z).
 *
 * Everything static is merged into one mesh per colour, so a whole office is
 * a few dozen draw calls.
 */

/** How high the walls are cut (units). People are about 1.45. */
export const WALL_H = 0.9;
/** Desk top height (units). People are short-legged, so the furniture is low to match. */
export const DESK_H = 0.62;
/**
 * The two kinds of seat, measured from the middle of their tile in the
 * direction the sitter faces: the cushion's top, how far it reaches behind and
 * in front of the middle, its width, and the backrest (its front face is where
 * the cushion ends behind). People are fitted onto these (see people.ts), and
 * the furniture below is built from them, so the two always agree.
 */
export interface SeatShape {
  /** How far the seat sits from the middle of its tile, towards where the sitter faces (a desk chair is tucked in). */
  tucked: number;
  top: number;
  behind: number;
  ahead: number;
  width: number;
  backTop: number;
}
export const SEATS = {
  chair: { tucked: 0.2, top: 0.34, behind: 0.21, ahead: 0.13, width: 0.46, backTop: 0.76 },
  sofa: { tucked: 0, top: 0.26, behind: 0.21, ahead: 0.15, width: 0.6, backTop: 0.68 },
} satisfies Record<string, SeatShape>;

const FLOOR: Record<string, number> = { ".": 0xc8955f, ",": 0x56739a, ":": 0x8e98a5, ";": 0xe6eaed };

export const PALETTE = {
  wall: 0xe8dcc6,
  wallTop: 0x7a6a58,
  window: 0x9fd4ef,
  wood: 0x8a5a36,
  woodLight: 0xb07a4a,
  dark: 0x33363f,
  metal: 0x9aa3ad,
  white: 0xf2f2ee,
  screen: 0x1b2a3a,
  green: 0x4f9a52,
  red: 0xb84a47,
  pot: 0xb5653a,
  door: 0x6b4226,
};

const BOOKS = [0xb84a47, 0x3d6fa8, 0xd9a83a, 0x4f9a52, 0x8a5aa8, 0xe9e4d8];

/** A desk monitor's screen, keyed by the seat tile in front of it ("x,y"). */
export type Screens = Map<string, THREE.Mesh>;

export interface BuiltOffice {
  group: THREE.Group;
  /** Desk screens by seat tile, so typing can light them up. */
  screens: Screens;
  dispose(): void;
}

/** Collects static shapes per colour and merges them at the end. */
class Builder {
  private parts = new Map<number, THREE.BufferGeometry[]>();

  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    this.place(color, g, x, y + h / 2, z, rotY);
  }

  cylinder(color: number, x: number, y: number, z: number, rTop: number, rBottom: number, h: number, sides = 7): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, sides);
    this.place(color, g, x, y + h / 2, z);
  }

  blob(color: number, x: number, y: number, z: number, r: number): void {
    const g = new THREE.IcosahedronGeometry(r, 0);
    this.place(color, g, x, y, z);
  }

  cone(color: number, x: number, y: number, z: number, r: number, h: number, sides = 7): void {
    const g = new THREE.ConeGeometry(r, h, sides);
    this.place(color, g, x, y + h / 2, z);
  }

  private place(color: number, g: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): void {
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    // Merging needs matching attributes: drop UVs (flat colours only).
    g.deleteAttribute("uv");
    const list = this.parts.get(color) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    this.parts.set(color, list);
  }

  build(group: THREE.Group, materials: THREE.Material[]): void {
    for (const [color, geoms] of this.parts) {
      const merged = mergeGeometries(geoms);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      merged.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });
      materials.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

export function buildOffice(office: Office, colorOf: (sessionId: string) => number, rugs: boolean): BuiltOffice {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const b = new Builder();
  const screens: Screens = new Map();
  const { tiles } = office;

  // Floor: one plane with a canvas texture, one texel per tile (plus a faint grid).
  const floor = floorMesh(office, colorOf, rugs);
  group.add(floor.mesh);
  materials.push(floor.material);

  const runs = new Set<string>();
  tiles.forEach((row, y) =>
    row.forEach((c, x) => {
      const cx = x + 0.5;
      const cz = y + 0.5;
      const north = tiles[y - 1]?.[x];
      switch (c) {
        case "#":
          b.box(PALETTE.wall, cx, 0, cz, 1, WALL_H, 1);
          b.box(PALETTE.wallTop, cx, WALL_H, cz, 1, 0.06, 1);
          break;
        case "=": {
          b.box(PALETTE.wall, cx, 0, cz, 1, WALL_H * 0.45, 1);
          b.box(PALETTE.window, cx, WALL_H * 0.45, cz, 0.9, WALL_H * 0.5, 0.3);
          b.box(PALETTE.wallTop, cx, WALL_H * 0.95, cz, 1, 0.08, 1);
          break;
        }
        case "D":
          b.box(PALETTE.door, cx, 0, cz, 1, 0.02, 1);
          break;
        case "B":
          shelf(b, cx, cz, (i) => BOOKS[(x * 3 + i) % BOOKS.length]!);
          break;
        case "Q":
          shelf(b, cx, cz, (i) => [0x7fd1c7, 0xd98fb5, 0xe6d27a][(x + i) % 3]!);
          break;
        case "M":
          shelf(b, cx, cz, () => 0xf4f1e8);
          break;
        case "R":
          b.box(PALETTE.dark, cx, 0, cz - 0.05, 0.8, 1.7, 0.7);
          for (let i = 0; i < 5; i++) b.box(i % 2 ? 0x5af07a : 0x3d8a52, cx - 0.2, 0.3 + i * 0.28, cz + 0.31, 0.25, 0.05, 0.02);
          break;
        case "J":
          table(b, cx, cz, 0.95, 0.6, 0.85, PALETTE.white, PALETTE.metal);
          b.cylinder(0x7fd1c7, cx - 0.2, 0.85, cz, 0.06, 0.08, 0.2);
          b.cylinder(0xd98fb5, cx + 0.15, 0.85, cz + 0.1, 0.05, 0.07, 0.16);
          break;
        case "U":
          table(b, cx, cz, 0.95, 0.6, 0.75, PALETTE.dark, PALETTE.dark);
          b.box(PALETTE.screen, cx, 0.75, cz - 0.15, 0.7, 0.4, 0.05);
          b.box(0x5af07a, cx, 0.85, cz - 0.12, 0.5, 0.05, 0.01);
          break;
        case "K":
          b.box(PALETTE.woodLight, cx, 0, cz, 0.9, 0.9, 0.7);
          b.box(PALETTE.dark, cx, 0.9, cz - 0.05, 0.45, 0.5, 0.4);
          b.cylinder(PALETTE.white, cx, 0.9, cz + 0.22, 0.06, 0.05, 0.1);
          break;
        case "P":
          b.cylinder(PALETTE.pot, cx, 0, cz, 0.2, 0.15, 0.32);
          b.blob(PALETTE.green, cx, 0.62, cz, 0.36);
          b.blob(0x3b7a3c, cx + 0.12, 0.85, cz - 0.05, 0.22);
          break;
        case "F":
          b.box(PALETTE.metal, cx, 0, cz, 0.7, 1.1, 0.6);
          for (let i = 0; i < 3; i++) b.box(PALETTE.dark, cx, 0.2 + i * 0.33, cz + 0.3, 0.3, 0.04, 0.02);
          break;
        case "G":
          table(b, cx, cz, 0.8, 0.6, 0.7, PALETTE.woodLight, PALETTE.wood);
          b.blob(0x4fa3d1, cx, 0.95, cz, 0.18);
          break;
        case "X":
          b.box(PALETTE.woodLight, cx, 0, cz, 1, 1.0, 0.8);
          b.box(PALETTE.wood, cx, 1.0, cz, 1.04, 0.06, 0.9);
          break;
        case "Y":
          b.box(PALETTE.metal, cx, 0, cz, 0.6, 0.55, 0.5);
          b.box(PALETTE.white, cx, 0.55, cz, 0.62, 0.15, 0.52);
          b.box(PALETTE.white, cx, 0.4, cz + 0.27, 0.4, 0.02, 0.1);
          break;
        case "w":
          b.box(PALETTE.white, cx, 0, cz, 0.4, 0.8, 0.4);
          b.cylinder(0x8fd0f0, cx, 0.8, cz, 0.18, 0.18, 0.45);
          break;
        case "a":
        case "q":
          chair(b, cx, cz, north === "d" || north === "E" ? "up" : "down", c === "q" ? 0x2b2f38 : 0x3d4a5c);
          break;
        case "k":
        case "S":
          armchair(b, cx, cz);
          break;
        case "d":
        case "E":
        case "W": {
          // Multi-tile things: build each horizontal run once, from its first tile.
          if (row[x - 1] === c) break;
          let w = 1;
          while (row[x + w] === c) w++;
          const key = `${x},${y}`;
          if (runs.has(key)) break;
          runs.add(key);
          if (c === "W") whiteboard(b, x, y, w);
          else desk(b, x, y, w, c === "E", screens, tiles, group, materials);
          break;
        }
      }
    }),
  );

  if (office.silo) siloPit(b, office.silo.x, office.silo.y);

  b.build(group, materials);
  return {
    group,
    screens,
    dispose: () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      floor.texture.dispose();
    },
  };
}

function floorMesh(office: Office, colorOf: (sessionId: string) => number, rugs: boolean) {
  const S = 8; // texels per tile
  const c = document.createElement("canvas");
  c.width = office.width * S;
  c.height = office.height * S;
  const g = c.getContext("2d")!;
  office.tiles.forEach((row, y) =>
    row.forEach((ch, x) => {
      const f = isFloor(ch) ? ch : floorAt(office.tiles, x, y);
      let color = FLOOR[f] ?? FLOOR["."]!;
      // A little variation tile to tile (wood planks, carpet tiles).
      const jitter = ((x * 7 + y * 13) % 5) - 2;
      color = shade(color, jitter * 0.018);
      g.fillStyle = hex(color);
      g.fillRect(x * S, y * S, S, S);
      g.fillStyle = "rgba(0,0,0,0.08)";
      g.fillRect(x * S, y * S + S - 1, S, 1);
      g.fillRect(x * S + S - 1, y * S, 1, S);
    }),
  );
  if (rugs) {
    for (const t of office.teams) {
      g.fillStyle = hex(colorOf(t.sessionId));
      g.globalAlpha = 0.28;
      g.fillRect(t.x * S + 2, t.y * S + 2, t.w * S - 4, t.h * S - 4);
      g.globalAlpha = 0.9;
      g.strokeStyle = hex(colorOf(t.sessionId));
      g.lineWidth = 2;
      g.strokeRect(t.x * S + 3, t.y * S + 3, t.w * S - 6, t.h * S - 6);
      g.globalAlpha = 1;
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(office.width, office.height), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(office.width / 2, 0, office.height / 2);
  mesh.receiveShadow = true;
  mesh.name = "floor";
  return { mesh, material, texture };
}

/** A shelf unit against the wall behind it, with rows of things on it. */
function shelf(b: Builder, cx: number, cz: number, item: (i: number) => number): void {
  const z = cz - 0.25;
  b.box(PALETTE.wood, cx, 0, z, 0.95, 1.6, 0.45);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4; i++) {
      const h = 0.22 + ((i * 5 + r * 3) % 3) * 0.04;
      b.box(item(i + r * 4), cx - 0.33 + i * 0.22, 0.2 + r * 0.48, z + 0.1, 0.16, h, 0.3);
    }
  }
}

function table(b: Builder, cx: number, cz: number, w: number, d: number, h: number, top: number, legs: number): void {
  b.box(top, cx, h - 0.06, cz, w, 0.06, d);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.box(legs, cx + dx * (w / 2 - 0.06), 0, cz + dz * (d / 2 - 0.06), 0.06, h - 0.06, 0.06);
  }
}

function chair(b: Builder, cx: number, cz: number, facing: "up" | "down", color: number): void {
  // The sitter faces the desk; the back is on the far side.
  const back = facing === "up" ? 1 : -1;
  const s = SEATS.chair;
  const depth = s.behind + s.ahead;
  const z = cz - back * s.tucked;
  b.cylinder(PALETTE.dark, cx, 0, z, 0.03, 0.03, s.top - 0.07, 5);
  b.box(color, cx, s.top - 0.07, z + (back * (s.behind - s.ahead)) / 2, s.width, 0.07, depth);
  b.box(color, cx, s.top, z + back * (s.behind + 0.03), s.width, s.backTop - s.top, 0.06);
}

/** A lounge armchair facing +z: a shallow seat (knees hang over the front), a backrest and two arms. */
function armchair(b: Builder, cx: number, cz: number): void {
  const red = 0xb84a47;
  const dark = 0x9c3d3b;
  const s = SEATS.sofa;
  b.box(red, cx, 0, cz + (s.ahead - s.behind) / 2, s.width, s.top, s.behind + s.ahead);
  b.box(dark, cx, 0, cz - s.behind - 0.09, 0.86, s.backTop, 0.18);
  b.box(dark, cx - 0.37, 0, cz, 0.12, s.top + 0.16, 0.66);
  b.box(dark, cx + 0.37, 0, cz, 0.12, s.top + 0.16, 0.66);
}

function whiteboard(b: Builder, x: number, y: number, w: number): void {
  const cx = x + w / 2;
  const cz = y + 0.5;
  b.box(PALETTE.metal, cx - w / 2 + 0.15, 0, cz, 0.05, 1.0, 0.05);
  b.box(PALETTE.metal, cx + w / 2 - 0.15, 0, cz, 0.05, 1.0, 0.05);
  b.box(PALETTE.metal, cx, 0.75, cz, w - 0.1, 0.85, 0.06);
  b.box(PALETTE.white, cx, 0.8, cz + 0.035, w - 0.2, 0.75, 0.01);
  b.box(0xb84a47, cx - 0.3, 1.25, cz + 0.045, 0.4, 0.03, 0.005);
  b.box(0x3d6fa8, cx - 0.2, 1.1, cz + 0.045, 0.6, 0.03, 0.005);
  b.box(0x3d6fa8, cx - 0.25, 0.95, cz + 0.045, 0.5, 0.03, 0.005);
}

/** A worker's desk (2 wide) or the manager's (3 wide, two monitors and a lamp). */
function desk(b: Builder, x: number, y: number, w: number, manager: boolean, screens: Screens, tiles: string[][], group: THREE.Group, materials: THREE.Material[]): void {
  const cx = x + w / 2;
  const cz = y + 0.5;
  table(b, cx, cz, w - 0.08, 0.8, DESK_H, manager ? PALETTE.wood : PALETTE.woodLight, manager ? 0x5a3a22 : PALETTE.wood);
  const monitors = manager ? [cx - 0.45, cx + 0.45] : [cx];
  for (const mx of monitors) {
    b.box(PALETTE.dark, mx, DESK_H, cz - 0.15, 0.08, 0.2, 0.08);
    b.box(PALETTE.dark, mx, DESK_H + 0.18, cz - 0.18, 0.62, 0.4, 0.05);
    // The screen is its own mesh so it can light up while someone types.
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.screen, emissive: 0x000000, flatShading: true });
    materials.push(mat);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32), mat);
    screen.position.set(mx, DESK_H + 0.38, cz - 0.153);
    group.add(screen);
    // Seats in front of this desk (the row below) use this screen.
    for (let sx = x; sx < x + w; sx++) {
      for (const sy of [y + 1, y - 1]) if (tiles[sy]?.[sx] === "a" || tiles[sy]?.[sx] === "q") screens.set(`${sx},${sy}`, screen);
    }
  }
  b.box(PALETTE.white, cx, DESK_H, cz + 0.15, 0.45, 0.03, 0.15);
  if (manager) {
    b.cylinder(PALETTE.dark, cx + w / 2 - 0.3, DESK_H, cz - 0.2, 0.02, 0.08, 0.35, 5);
    b.cone(0xf0c45a, cx + w / 2 - 0.3, DESK_H + 0.32, cz - 0.2, 0.13, 0.15, 6);
  }
}

/** The rocket silo's pit (3×3), with hazard stripes; the doors and rocket move, so they're not here. */
function siloPit(b: Builder, x: number, y: number): void {
  const cx = x + 1.5;
  const cz = y + 1.5;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.box(i % 2 ? 0xf0c45a : 0x1d1f27, cx + Math.cos(a) * 1.25, 0, cz + Math.sin(a) * 1.25, 0.45, 0.12, 0.25, -a);
  }
  b.cylinder(0x0b0c10, cx, 0, cz, 1.05, 1.05, 0.03, 16);
}

function shade(color: number, k: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 0xff) * (1 + k))));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
