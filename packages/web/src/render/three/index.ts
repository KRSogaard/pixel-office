import * as THREE from "three";
import { TILE, type TeamArea } from "../../office/layout.js";
import type { ScreenPoint } from "../../ui/overlay.js";
import type { WorldEvent } from "../../world/events.js";
import type { Person } from "../../world/person.js";
import type { World } from "../../world/world.js";
import { tintAt } from "../daylight.js";
import type { Renderer, RendererInput } from "../renderer.js";
import { Effects } from "./effects.js";
import { WALL_H, buildOffice, type BuiltOffice } from "./office.js";
import { Cast, Icons, PersonView } from "./people.js";
import { toFloor, toHeight } from "./space.js";
import { CatView, SiloView, binView, boxView, decorations, bugView, disposeObject, droneView, duckView, heldView } from "./things.js";

/** Camera: looking down at 50°, turned 35° from straight on — an isometric-ish view with the rooms at the back. */
const ELEVATION = (50 * Math.PI) / 180;
const AZIMUTH = (35 * Math.PI) / 180;
/** Screen pixels per unit at zoom 1. */
const BASE_PPU = 32;
/** The characters in public/art/lowpoly/ (Tripo models, made from FLUX.2 drawings): agents get one picked from their id. */
const AGENT_LOOKS = ["agent-00", "agent-01", "agent-02", "agent-03", "agent-04", "agent-05", "agent-06", "agent-07", "agent-08"] as const;
/** Who visits the 3D office, and the extras (each has a model of their own). */
const VISITORS = ["boss", "consultant", "intern", "auditor", "investor", "grandpa"] as const;
const EXTRAS = ["courier", "medic", "pizza"] as const;

/**
 * The low-poly 3D office, drawn with Three.js through an orthographic camera
 * (no perspective shrink, so it reads like an isometric game). People are
 * rigged models that walk, run, sit and cheer; the office is built from the
 * same layout as the flat styles.
 */
export class ThreeRenderer implements Renderer {
  readonly visitors = VISITORS;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  /** Where the camera looks (on the floor). */
  private target = new THREE.Vector3();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private sky = new THREE.HemisphereLight(0xdfefff, 0x8a6a4a, 1.4);
  private glows: THREE.Sprite[] = [];
  private glowTexture = glowTexture();
  private world!: World;
  private input!: RendererInput;
  private office: BuiltOffice | undefined;
  private people = new Map<string, PersonView>();
  private effects = new Effects(this.scene);
  private dynamic = new THREE.Group();
  private bins = binView(this.dynamic, () => this.now);
  private bugs = bugView(this.dynamic, () => this.now);
  private drones = droneView(this.dynamic, () => this.now);
  private held = heldView(this.dynamic);
  private boxes = boxView(this.dynamic);
  private ducks = duckView(this.dynamic);
  private cat: CatView | undefined;
  private silo: SiloView | undefined;
  private season: ReturnType<typeof decorations> | undefined;
  private links = new THREE.Group();
  private now = 0;
  private userMovedCamera = false;
  private shakeUntil = 0;
  private shakeAmount = 0;
  private lastSteam = 0;
  private lastSmoke = 0;
  private lastScrap = new Map<string, number>();
  private canvasSize = { w: 1, h: 1 };

  private icons = new Icons();

  private constructor(private cast: Cast) {}

  static async load(): Promise<ThreeRenderer> {
    return new ThreeRenderer(await Cast.load(AGENT_LOOKS, [...VISITORS, ...EXTRAS]));
  }

  start(parent: HTMLElement, world: World, input: RendererInput, frame: (dtMs: number, now: number) => void): void {
    this.world = world;
    this.input = input;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    parent.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1d1f27);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.sky, this.dynamic, this.links);
    this.cat = new CatView(world.pet);
    this.scene.add(this.cat.group);
    this.silo = new SiloView(world.silo);
    this.scene.add(this.silo.group);
    this.rebuild();
    world.onEvent((e) => this.onEvent(e));

    this.resize();
    new ResizeObserver(() => this.resize()).observe(parent);
    this.setupInput(this.renderer.domElement);

    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      frame(dt, t);
      this.draw(dt, t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  toScreen(x: number, y: number, lift: number): ScreenPoint {
    const f = toFloor(x, y);
    const v = new THREE.Vector3(f.x, toHeight(lift), f.z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.canvasSize.w,
      y: ((1 - v.y) / 2) * this.canvasSize.h,
      // The tags size themselves by screen pixels per world pixel.
      scale: (BASE_PPU * this.camera.zoom) / TILE,
    };
  }

  fit(): void {
    if (!this.world) return;
    this.userMovedCamera = false;
    const o = this.world.office;
    this.target.set(o.width / 2, 0, o.height / 2);
    this.placeCamera();
    // Fit the office's bounding box (floor to wall tops) in view.
    const view = new THREE.Matrix4().copy(this.camera.matrixWorldInverse);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [0, o.width]) for (const z of [0, o.height]) for (const y of [0, WALL_H]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(view);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // The camera looks at the office's middle; slide it so the box is centred, then zoom to fill the screen.
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.panBy(right.multiplyScalar((minX + maxX) / 2).add(up.multiplyScalar((minY + maxY) / 2)));
    const w = this.canvasSize.w / BASE_PPU;
    const h = this.canvasSize.h / BASE_PPU;
    this.camera.zoom = Math.max(0.3, Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.96);
    this.camera.updateProjectionMatrix();
  }

  zoomBy(factor: number): void {
    this.userMovedCamera = true;
    this.camera.zoom = Math.min(6, Math.max(0.3, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    if (!this.renderer) return;
    const el = this.renderer.domElement.parentElement!;
    this.canvasSize = { w: el.clientWidth, h: el.clientHeight };
    this.renderer.setSize(this.canvasSize.w, this.canvasSize.h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    const w = this.canvasSize.w / BASE_PPU / 2;
    const h = this.canvasSize.h / BASE_PPU / 2;
    Object.assign(this.camera, { left: -w, right: w, top: h, bottom: -h });
    this.camera.updateProjectionMatrix();
    if (!this.userMovedCamera) this.fit();
  }

  // --- drawing ----------------------------------------------------------------

  private draw(dt: number, now: number): void {
    this.now = now;
    const w = this.world;
    this.syncPeople(dt, now);
    this.bins.update(w.bins());
    for (const b of w.bins()) if (b.stomping && now - (this.lastScrap.get(b.agentId) ?? 0) > 500) {
      this.lastScrap.set(b.agentId, now);
      this.effects.scraps(b.seat.x + 1.5, 0.4, b.seat.y + 0.5);
    }
    this.bugs.update(w.bugs.list);
    this.drones.update(w.drones.list);
    this.held.update(w.people().filter((p) => p.item));
    this.boxes.update(w.extras.boxes);
    this.ducks.update(w.antics.ducks.entries());
    this.cat?.update(now);
    this.silo?.update(now);
    this.siloSmoke(now);
    this.season?.update();
    this.drawLinks(now);
    this.effects.update(dt, now);
    if (Math.floor(now / 500) !== Math.floor((now - dt) / 500)) this.light();

    // Screen shake (rocket lift-off).
    const shaking = now < this.shakeUntil;
    const offset = shaking ? new THREE.Vector3((Math.random() - 0.5) * this.shakeAmount, 0, (Math.random() - 0.5) * this.shakeAmount) : new THREE.Vector3();
    this.camera.position.add(offset);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(offset);
  }

  private syncPeople(dt: number, now: number): void {
    const live = new Set<string>();
    for (const p of this.world.people()) {
      live.add(p.id);
      let v = this.people.get(p.id);
      if (!v) {
        v = new PersonView(this.cast, this.icons, p);
        this.people.set(p.id, v);
        this.scene.add(v.group);
      }
      v.update(dt, now);
    }
    for (const [id, v] of this.people) {
      if (live.has(id)) continue;
      v.destroy();
      this.people.delete(id);
    }
    // Monitors light up (scrolling code) while someone types at them.
    if (!this.office) return;
    const typing = new Set<THREE.Mesh>();
    for (const p of this.world.people()) {
      if (p.pose !== "type" || !p.arrived) continue;
      const s = this.office.screens.get(`${p.tile.x},${p.tile.y}`);
      if (s) typing.add(s);
    }
    for (const s of new Set(this.office.screens.values())) {
      const m = s.material as THREE.MeshStandardMaterial;
      if (typing.has(s)) m.emissive.setHex(Math.floor(now / 220) % 2 ? 0x2c6a8a : 0x24587a);
      else m.emissive.setHex(0x000000);
    }
  }

  private siloSmoke(now: number): void {
    const f = this.world.silo.flight;
    const at = this.world.office.silo;
    if (!f || !at) return;
    const cx = at.x + 1.5;
    const cz = at.y + 1.5;
    if (f.steaming && now - this.lastSteam > 120) {
      this.lastSteam = now;
      this.effects.smoke(cx, cz, 0xe9e4d8, 1.6, 900);
    }
    if (f.smoking && now - this.lastSmoke > 40) {
      this.lastSmoke = now;
      this.effects.smoke(cx, cz, 0xbfc5cc, 4, 2200);
    }
  }

  /** Dashed lines from the selected agent to its parent and sub-agents. */
  private drawLinks(now: number): void {
    for (const c of [...this.links.children]) disposeObject(c);
    const march = (now / 600) % 1;
    for (const { from, to, color } of this.world.teamLinks()) {
      const a = point(from);
      const b = point(to);
      const len = a.distanceTo(b);
      for (let d = march * 0.35; d < len; d += 0.35) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), new THREE.MeshBasicMaterial({ color }));
        dot.position.lerpVectors(a, b, d / len);
        this.links.add(dot);
      }
    }
  }

  /** Daylight from the viewer's clock (same curve as the flat office), and lamp glows at night. */
  private light(): void {
    const forced = new URLSearchParams(location.search).get("hour");
    const d = new Date();
    const hour = forced !== null && forced !== "" ? Number(forced) : d.getHours() + d.getMinutes() / 60;
    const tint = tintAt(hour);
    const k = tint.strength;
    const c = new THREE.Color(tint.color);
    this.sun.intensity = 2.2 * (1 - k * 1.1);
    this.sun.color.setRGB(1 + (c.r - 1) * k, 1 + (c.g - 1) * k, 1 + (c.b - 1) * k);
    this.sky.intensity = 1.4 * (1 - k * 0.8);
    this.sky.color.set(0xdfefff).lerp(c, k);
    const glow = Math.max(0, (k - 0.2) / 0.42);
    const spots = this.world.lightSpots();
    while (this.glows.length < spots.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.set(2.4, 2.4, 1);
      this.scene.add(s);
      this.glows.push(s);
    }
    this.glows.forEach((s, i) => {
      const l = spots[i];
      s.visible = !!l && glow > 0;
      if (l) {
        s.position.set(l.x / TILE, 0.9, l.y / TILE + 0.6);
        s.material.opacity = 0.8 * glow;
      }
    });
  }

  // --- the world's events -------------------------------------------------

  private onEvent(e: WorldEvent): void {
    const at = "x" in e ? toFloor(e.x, e.y) : { x: 0, z: 0 };
    switch (e.type) {
      case "office":
        return this.rebuild();
      case "season":
        return this.redecorate();
      case "puff":
        return this.effects.puff(at.x, at.z);
      case "confetti":
        return this.effects.confetti(at.x, at.z);
      case "poof":
        return this.effects.poof(at.x, at.z, e.color);
      case "sweat":
        return this.effects.sweat(at.x, at.z);
      case "fire":
        return this.effects.fire(e.x / TILE, e.y / TILE, e.ms);
      case "print":
        return this.effects.print(e.x / TILE, e.y / TILE);
      case "splat":
        return this.effects.splat(at.x, at.z);
      case "purr":
        return this.effects.text(at.x, 0.8, at.z, "♥ purr", "#ff7a9a", 0.35);
      case "countdown": {
        const s = this.world.office.silo;
        if (s) this.effects.text(s.x + 3, 1.6, s.y + 1.5, e.text, "#ff5d2a", 0.6);
        return;
      }
      case "shake":
        this.shakeUntil = this.now + e.ms;
        this.shakeAmount = e.intensity * 60;
        return;
    }
  }

  /** The world built a new office: rebuild the static meshes and re-place what hangs off them. */
  private rebuild(): void {
    const o = this.world.office;
    if (this.office) {
      this.office.group.removeFromParent();
      this.office.dispose();
    }
    this.office = buildOffice(o, (id) => this.world.colorOf(id), this.world.rugs);
    this.scene.add(this.office.group);
    this.silo?.place(o.silo);
    this.redecorate();
    // Shadows cover the whole office.
    const s = this.sun.shadow.camera;
    const r = Math.max(o.width, o.height) * 0.75;
    Object.assign(s, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: 200 });
    s.updateProjectionMatrix();
    this.sun.target.position.set(o.width / 2, 0, o.height / 2);
    this.sun.position.set(o.width / 2 - 20, 40, o.height / 2 + 25);
    this.light();
    if (!this.userMovedCamera) this.fit();
  }

  private redecorate(): void {
    if (this.season) disposeObject(this.season.group);
    this.season = decorations(this.world.seasonal.decorations, () => this.now);
    this.scene.add(this.season.group);
  }

  // --- camera & input -------------------------------------------------------

  private placeCamera(): void {
    const d = 100;
    const off = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION)).multiplyScalar(d);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Slide the camera (and what it looks at) along the floor. */
  private panBy(v: THREE.Vector3): void {
    // Move along the floor so the same screen shift is kept, whatever the tilt.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const t = v.clone();
    if (Math.abs(t.y) > 1e-6) t.addScaledVector(dir, -t.y / dir.y);
    t.y = 0;
    this.target.add(t);
    this.placeCamera();
  }

  private setupInput(canvas: HTMLCanvasElement): void {
    let down: { x: number; y: number } | undefined;
    let moved = 0;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!down) {
        canvas.style.cursor = this.hit(e) ? "pointer" : "";
        return;
      }
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      down = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 4) return;
      this.userMovedCamera = true;
      // Drag the floor: screen pixels to world units along the camera's right and up.
      const k = 1 / (BASE_PPU * this.camera.zoom);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.panBy(right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k)));
    });
    canvas.addEventListener("pointerup", (e) => {
      if (down && moved < 4) {
        const hit = this.hit(e);
        if (hit?.person) this.input.pick(hit.person.id);
        else if (hit?.pet) this.world.pet.purr();
        else if (hit?.board) this.input.board(hit.board.sessionId);
        else this.input.pick(undefined);
      }
      down = undefined;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY > 0 ? 1 / 1.15 : 1.15);
      },
      { passive: false },
    );
  }

  /** What's under the pointer: an agent, the cat, or a team's whiteboard. */
  private hit(e: PointerEvent): { person?: Person; pet?: true; board?: TeamArea } | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [...[...this.people.values()].filter((v) => v.person.clickable).map((v) => v.group)];
    if (this.cat) targets.push(this.cat.group);
    for (const h of ray.intersectObjects(targets, true)) {
      if (h.object.userData.pet) return { pet: true };
      const id = h.object.userData.personId as string | undefined;
      const v = id ? this.people.get(id) : undefined;
      if (v?.person.clickable) return { person: v.person };
    }
    // Whiteboards: the tile the ray hits at board height.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!p) return undefined;
    const x = Math.floor(p.x);
    const y = Math.floor(p.z);
    const board = this.world.office.teams.find((t) => (x === t.whiteboard.x || x === t.whiteboard.x + 1) && y === t.whiteboard.y);
    return board ? { board } : undefined;
  }
}

function point(p: Person): THREE.Vector3 {
  const f = toFloor(p.x, p.y);
  return new THREE.Vector3(f.x, 0.7, f.z);
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,230,170,0.9)");
  grad.addColorStop(0.5, "rgba(255,210,140,0.35)");
  grad.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
