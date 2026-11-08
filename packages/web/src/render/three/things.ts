import * as THREE from "three";
import type { Point } from "../../office/pathfind.js";
import type { Bug } from "../../world/bugs.js";
import type { Drone } from "../../world/drones.js";
import type { PizzaBox } from "../../world/extras.js";
import type { Item, Person } from "../../world/person.js";
import type { Pet } from "../../world/pet.js";
import type { Decorations } from "../../world/seasonal.js";
import type { RocketSilo } from "../../world/silo.js";
import type { Bin } from "../../world/world.js";
import { DESK_H } from "./office.js";
import { toFloor, toHeight } from "./space.js";

/** A flat-shaded mesh in one colour. */
export function solid(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 }));
  m.castShadow = true;
  return m;
}

function part(group: THREE.Object3D, geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = solid(geometry, color);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function dispose(o: THREE.Object3D): void {
  o.removeFromParent();
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
  });
}

/** Keeps one object per id in step with a list: makes new ones, removes gone ones, updates the rest. */
export class Keyed<K, T> {
  private objects = new Map<K, THREE.Object3D>();

  constructor(
    private parent: THREE.Object3D,
    private key: (item: T) => K,
    private make: (item: T) => THREE.Object3D,
    private place: (object: THREE.Object3D, item: T) => void = () => {},
  ) {}

  update(items: Iterable<T>): void {
    const live = new Set<K>();
    for (const item of items) {
      const k = this.key(item);
      live.add(k);
      let o = this.objects.get(k);
      if (!o) {
        o = this.make(item);
        this.parent.add(o);
        this.objects.set(k, o);
      }
      this.place(o, item);
    }
    for (const [k, o] of this.objects) {
      if (live.has(k)) continue;
      dispose(o);
      this.objects.delete(k);
    }
  }

  clear(): void {
    this.update([]);
  }
}

/** Wastepaper bins: a wire basket whose paper rises and turns amber, then red, with the context window. */
export function binView(parent: THREE.Object3D, now: () => number): Keyed<string, Bin> {
  return new Keyed<string, Bin>(
    parent,
    (b) => b.agentId,
    () => {
      const g = new THREE.Group();
      part(g, new THREE.CylinderGeometry(0.16, 0.12, 0.38, 7, 1, true), 0x7d8590, 0, 0.19, 0);
      const paper = part(g, new THREE.CylinderGeometry(0.14, 0.11, 1, 7), 0x6fd08c, 0, 0, 0);
      paper.name = "paper";
      return g;
    },
    (g, b) => {
      g.position.set(b.seat.x + 1.5, 0, b.seat.y + 0.5);
      const squash = b.stomping ? (Math.floor(now() / 160) % 2 ? 0.6 : 0.85) : 1;
      g.scale.set(2 - squash, squash, 2 - squash);
      const paper = g.getObjectByName("paper") as THREE.Mesh;
      const h = Math.max(0.02, 0.36 * b.fill);
      paper.scale.y = h;
      paper.position.y = h / 2 + 0.01;
      (paper.material as THREE.MeshStandardMaterial).color.setHex(b.fill > 0.85 ? 0xff5d5d : b.fill > 0.6 ? 0xf0c45a : 0x6fd08c);
    },
  );
}

/** Bugs: little dark beetles, wobbling as they scuttle. */
export function bugView(parent: THREE.Object3D, now: () => number): Keyed<number, Bug> {
  return new Keyed<number, Bug>(
    parent,
    (b) => b.id,
    (b) => {
      const g = new THREE.Group();
      const body = part(g, new THREE.IcosahedronGeometry(0.12, 0), b.hue, 0, 0.08, 0);
      body.scale.set(1.3, 0.6, 1);
      part(g, new THREE.BoxGeometry(0.04, 0.04, 0.04), 0xff3b3b, 0.15, 0.1, 0);
      return g;
    },
    (g, b) => {
      const { x, z } = toFloor(b.x, b.y);
      g.position.set(x, 0, z);
      g.rotation.y = b.dx < 0 ? Math.PI : 0;
      g.rotation.z = Math.floor(now() / 90) % 2 ? 0.15 : -0.15;
    },
  );
}

/** Logistics drones with a crate, flying over everything. */
export function droneView(parent: THREE.Object3D, now: () => number): Keyed<number, Drone> {
  return new Keyed<number, Drone>(
    parent,
    (d) => d.id,
    () => {
      const g = new THREE.Group();
      part(g, new THREE.BoxGeometry(0.4, 0.14, 0.3), 0x7d8590, 0, 0.3, 0);
      part(g, new THREE.BoxGeometry(0.3, 0.24, 0.26), 0x8a5a36, 0, 0.08, 0);
      for (const [dx, dz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]] as const) {
        part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.02, 8), 0xc9d0d8, dx, 0.4, dz);
      }
      return g;
    },
    (g, d) => {
      const { x, z } = toFloor(d.x, d.y);
      g.position.set(x, 1.6 + toHeight(d.lift) + Math.sin(now() / 120) * 0.05, z);
      g.rotation.y = d.right ? 0 : Math.PI;
    },
  );
}

/** Byte the cat: a little low-poly ginger cat that walks, sits and curls up asleep. */
export class CatView {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Group;
  private tail: THREE.Mesh;
  private heading = 0;
  private last: { x: number; z: number } | undefined;

  constructor(private pet: Pet) {
    const ginger = 0xe08a3c;
    this.body = part(this.group, new THREE.BoxGeometry(0.42, 0.2, 0.2), ginger, 0, 0.2, 0);
    this.head = new THREE.Group();
    this.head.position.set(0.25, 0.32, 0);
    part(this.head, new THREE.BoxGeometry(0.18, 0.16, 0.18), ginger, 0, 0, 0);
    part(this.head, new THREE.ConeGeometry(0.04, 0.08, 4), ginger, 0, 0.1, -0.05);
    part(this.head, new THREE.ConeGeometry(0.04, 0.08, 4), ginger, 0, 0.1, 0.05);
    this.group.add(this.head);
    this.tail = part(this.group, new THREE.BoxGeometry(0.05, 0.25, 0.05), 0xb86a2a, -0.24, 0.32, 0);
    for (const [dx, dz] of [[-0.14, -0.06], [-0.14, 0.06], [0.14, -0.06], [0.14, 0.06]] as const) part(this.group, new THREE.BoxGeometry(0.05, 0.12, 0.05), ginger, dx, 0.06, dz);
    this.group.traverse((o) => (o.userData.pet = true));
  }

  update(now: number): void {
    const p = this.pet;
    const { x, z } = toFloor(p.x, p.y + 1);
    this.group.position.set(x, 0, z);
    if (this.last && p.mode === "walk") {
      const dx = x - this.last.x;
      const dz = z - this.last.z;
      if (Math.hypot(dx, dz) > 1e-4) this.heading = Math.atan2(-dz, dx);
    }
    this.last = { x, z };
    this.group.rotation.y = this.heading;
    const asleep = p.mode === "sleep";
    this.group.scale.y = asleep ? 0.55 : 1;
    this.body.position.y = 0.2 + (p.mode === "walk" ? Math.abs(Math.sin(now / 90)) * 0.03 : 0);
    this.head.position.y = asleep ? 0.22 : 0.32;
    this.tail.rotation.z = Math.sin(now / 300) * 0.5;
  }
}

/** The rocket silo's moving parts: blast doors and the rocket with its flame. */
export class SiloView {
  readonly group = new THREE.Group();
  private doors: [THREE.Mesh, THREE.Mesh];
  private rocket = new THREE.Group();
  private flame: THREE.Mesh;
  private gauge: THREE.Mesh[] = [];

  constructor(private silo: RocketSilo) {
    this.doors = [
      part(this.group, new THREE.BoxGeometry(1, 0.06, 2), 0x5c6370, -0.5, 0.04, 0),
      part(this.group, new THREE.BoxGeometry(1, 0.06, 2), 0x5c6370, 0.5, 0.04, 0),
    ];
    part(this.rocket, new THREE.CylinderGeometry(0.28, 0.28, 1.6, 8), 0xe9e4d8, 0, 0.8, 0);
    part(this.rocket, new THREE.ConeGeometry(0.28, 0.6, 8), 0xc0504d, 0, 1.9, 0);
    part(this.rocket, new THREE.CylinderGeometry(0.29, 0.29, 0.1, 8), 0xc0504d, 0, 1.2, 0);
    for (let i = 0; i < 3; i++) {
      const fin = part(this.rocket, new THREE.BoxGeometry(0.04, 0.4, 0.3), 0xc0504d, 0, 0.2, 0);
      fin.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.3, 0.2, Math.sin((i / 3) * Math.PI * 2) * 0.3);
      fin.rotation.y = -(i / 3) * Math.PI * 2;
    }
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffb03c }));
    this.flame.rotation.x = Math.PI;
    this.rocket.add(this.flame);
    this.group.add(this.rocket);
    // Ten-segment cargo gauge beside the pit.
    for (let i = 0; i < 10; i++) this.gauge.push(part(this.group, new THREE.BoxGeometry(0.2, 0.1, 0.1), 0x3b3f4a, 1.75, 0.1 + i * 0.13, 0));
  }

  place(at: Point | undefined): void {
    this.group.visible = !!at;
    if (at) this.group.position.set(at.x + 1.5, 0, at.y + 1.5);
  }

  update(now: number): void {
    const f = this.silo.flight;
    const open = f?.open ?? 0;
    this.doors[0].position.x = -0.5 - open;
    this.doors[1].position.x = 0.5 + open;
    this.rocket.visible = !!f && f.rise > 0;
    if (f) this.rocket.position.y = -2.2 + f.rise * 2.2 + f.fly * f.fly * 40;
    this.flame.visible = !!f && f.fly > 0;
    if (f && f.fly > 0) {
      const len = 0.6 + f.fly * 2;
      this.flame.scale.set(1, len, 1);
      this.flame.position.y = -len / 2;
      (this.flame.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(now / 70) % 2 ? 0xffb03c : 0xff5d2a);
    }
    const filled = Math.min(10, this.silo.cargo);
    this.gauge.forEach((g, i) => (g.material as THREE.MeshStandardMaterial).color.setHex(i < filled ? (filled >= 10 ? 0x5af07a : 0xd9a83a) : 0x3b3f4a));
  }
}

/** What people carry: the courier's envelope, the medic's stretcher, the pizza box. */
export function heldView(parent: THREE.Object3D): Keyed<string, Person> {
  const look: Record<Item, () => THREE.Object3D> = {
    envelope: () => solid(new THREE.BoxGeometry(0.3, 0.2, 0.03), 0xfdfbf5),
    pizza: () => solid(new THREE.BoxGeometry(0.45, 0.08, 0.45), 0xc89b5b),
    stretcher: () => solid(new THREE.BoxGeometry(0.5, 0.05, 1.6), 0xc9d0d8),
  };
  return new Keyed<string, Person>(
    parent,
    (p) => `${p.id}:${p.item}`,
    (p) => look[p.item!](),
    (o, p) => {
      const { x, z } = toFloor(p.x, p.y);
      o.position.set(x + (p.item === "stretcher" ? 0 : 0.25), p.item === "stretcher" ? 0.5 : 0.95, z + (p.item === "stretcher" ? 0 : 0.2));
    },
  );
}

/** Pizza boxes left in the lounge. */
export function boxView(parent: THREE.Object3D): Keyed<number, PizzaBox> {
  return new Keyed<number, PizzaBox>(
    parent,
    (b) => b.id,
    () => {
      const g = new THREE.Group();
      part(g, new THREE.BoxGeometry(0.45, 0.08, 0.45), 0xc89b5b, 0, 0.04, 0);
      part(g, new THREE.BoxGeometry(0.2, 0.01, 0.12), 0xc0504d, 0, 0.085, 0);
      return g;
    },
    (g, b) => g.position.set(b.tile.x + 0.5, 0, b.tile.y + 0.5),
  );
}

/** Rubber ducks on desks. */
export function duckView(parent: THREE.Object3D): Keyed<string, [string, Point]> {
  return new Keyed<string, [string, Point]>(
    parent,
    ([id]) => id,
    () => {
      const g = new THREE.Group();
      part(g, new THREE.IcosahedronGeometry(0.1, 0), 0xffd23f, 0, 0.08, 0).scale.set(1.3, 0.8, 1);
      part(g, new THREE.IcosahedronGeometry(0.065, 0), 0xffd23f, 0.07, 0.17, 0);
      part(g, new THREE.BoxGeometry(0.06, 0.02, 0.04), 0xff8c1a, 0.14, 0.16, 0);
      return g;
    },
    (g, [, t]) => g.position.set(t.x + 0.25, DESK_H, t.y + 0.6),
  );
}

/** The date's decorations: pumpkins, a Christmas tree, balloons. */
export function decorations(d: Decorations, now: () => number): { group: THREE.Group; update(): void } {
  const group = new THREE.Group();
  const bulbs: THREE.Mesh[] = [];
  for (const p of d.pumpkins) {
    const pk = part(group, new THREE.IcosahedronGeometry(0.16, 0), 0xe07b39, p.x + 0.75, 0.14, p.y + 0.75);
    pk.scale.set(1.2, 0.9, 1.2);
  }
  if (d.tree) {
    const { x, y } = d.tree;
    part(group, new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6), 0x6b4226, x + 0.5, 0.15, y + 0.5);
    for (let i = 0; i < 3; i++) part(group, new THREE.ConeGeometry(0.55 - i * 0.14, 0.6, 7), 0x2e7d3a, x + 0.5, 0.55 + i * 0.4, y + 0.5);
    part(group, new THREE.OctahedronGeometry(0.1, 0), 0xffe066, x + 0.5, 1.75, y + 0.5);
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4;
      const h = 0.45 + (i / 10) * 1.0;
      const r = 0.5 - (i / 10) * 0.35;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), new THREE.MeshBasicMaterial({ color: 0xff5d5d }));
      bulb.position.set(x + 0.5 + Math.cos(a) * r, h, y + 0.5 + Math.sin(a) * r);
      group.add(bulb);
      bulbs.push(bulb);
    }
  }
  if (d.balloons) {
    for (const t of [d.balloons.left, d.balloons.right]) {
      [0xff5d5d, 0x5ab4f0, 0xf0c45a].forEach((c, i) => {
        const bx = t.x + 0.5 + (i - 1) * 0.25;
        part(group, new THREE.IcosahedronGeometry(0.16, 1), c, bx, 1.9 + (i % 2) * 0.15, t.y + 0.5);
        part(group, new THREE.CylinderGeometry(0.005, 0.005, 0.9, 3), 0x9097a6, bx, 1.3, t.y + 0.5);
      });
    }
  }
  const colors = [0xff5d5d, 0x5ab4f0, 0xf0c45a, 0xc77dff];
  return {
    group,
    update: () => {
      const f = Math.floor(now() / 450);
      bulbs.forEach((b, i) => (b.material as THREE.MeshBasicMaterial).color.setHex(colors[(i + f) % colors.length]!));
    },
  };
}

export { dispose as disposeObject };
