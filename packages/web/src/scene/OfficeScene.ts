import Phaser from "phaser";
import type { AgentState, OfficeState, Utterance } from "@pixel-office/protocol";
import { paintOffice } from "../art/tiles.js";
import { Allocator } from "../office/allocator.js";
import { PlaceDebouncer, placeFor } from "../office/director.js";
import { TILE, buildOffice, type Facing, type Office, type Spot } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import type { OfficeStore } from "../net.js";
import type { Overlay, ScreenPoint } from "../ui/overlay.js";
import { Character, feet, type Destination } from "./Character.js";

interface Actor {
  c: Character;
  debounce: PlaceDebouncer;
  lastSaidAt?: number;
  lastErrorAt?: number;
  /** Last state we saw. Kept after the agent leaves the state so it can walk out. */
  agent: AgentState;
  gone: boolean;
}

/** How long to wait for more sub-agents before staging a delegation. */
const DELEGATION_BATCH_MS = 400;

export interface SceneDeps {
  store: OfficeStore;
  overlay: Overlay;
  onSelect: (agentId: string | undefined) => void;
}

/**
 * Turns office state into people walking around. Decides *where* each agent
 * goes (via the director + allocator) and stages the little scenes when agents
 * talk to each other.
 */
export class OfficeScene extends Phaser.Scene {
  private deps!: SceneDeps;
  private office!: Office;
  private allocator!: Allocator;
  private bg!: Phaser.GameObjects.Image;
  private actors = new Map<string, Actor>();
  private projectNames = new Map<string, string>();
  private firstSync = true;
  private selected: string | undefined;
  private delegations = new Map<string, { children: Actor[]; texts: string[] }>();
  private now = 0;

  constructor() {
    super("office");
  }

  init(deps: SceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    this.office = buildOffice(0);
    this.allocator = new Allocator(this.office);
    this.textures.addCanvas("office", paintOffice(this.office));
    this.bg = this.add.image(0, 0, "office").setOrigin(0, 0).setDepth(-1);
    this.setupCamera();
    this.deps.store.subscribe((state) => this.sync(state));
  }

  override update(time: number, delta: number): void {
    this.now = time;
    const cam = this.cameras.main;
    const points = new Map<string, ScreenPoint>();
    for (const [id, actor] of this.actors) {
      if (!actor.c.busyWithScript) this.direct(actor, time);
      actor.c.update(Math.min(delta, 100), time);
      if (actor.agent.status === "ended" && !actor.c.busyWithScript && actor.c.arrived && actor.c.destination?.pose === "stand" && this.isDoor(actor.c.tile)) {
        this.despawn(id);
        continue;
      }
      points.set(id, this.toScreen(actor.c.x, actor.c.y - 26, cam));
    }
    this.deps.overlay.placeAll(points, time);
    const projects = this.allocator.podProjects();
    for (const pod of this.office.pods) {
      const key = projects.get(pod.index);
      this.deps.overlay.podLabel(
        pod.index,
        key ? this.projectNames.get(key) : undefined,
        key ? this.toScreen((pod.x + pod.w / 2) * TILE, pod.y * TILE + 6, cam) : undefined,
      );
    }
  }

  /** Where each agent is and is heading — for debugging from the console. */
  debug(): { id: string; activity: string; tile: Point; dest?: Point; pose?: string; scripted: boolean }[] {
    return [...this.actors.values()].map((a) => ({
      id: a.agent.id,
      activity: a.agent.activity,
      tile: a.c.tile,
      ...(a.c.destination ? { dest: a.c.destination.tile, pose: a.c.destination.pose } : {}),
      scripted: a.c.busyWithScript,
    }));
  }

  select(agentId: string | undefined): void {
    this.selected = agentId;
    this.deps.overlay.select(agentId);
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.5, 6));
  }

  fit(): void {
    const cam = this.cameras.main;
    const w = this.office.width * TILE;
    const h = this.office.height * TILE;
    const zoom = Math.max(0.5, Math.min(cam.width / w, cam.height / h));
    cam.setZoom(zoom);
    cam.centerOn(w / 2, h / 2);
  }

  // --- state → actors -------------------------------------------------------

  private sync(state: OfficeState): void {
    if (!this.office) return;
    const initial = this.firstSync;
    this.firstSync = false;

    for (const agent of Object.values(state.agents)) {
      this.projectNames.set(agent.project.path, agent.project.name);
      let actor = this.actors.get(agent.id);
      if (!actor) {
        if (agent.status === "ended") continue;
        actor = this.spawn(agent, initial);
      }
      actor.agent = agent;
      actor.gone = false;
      this.deps.overlay.ensure(agent, () => this.deps.onSelect(agent.id));
    }

    // Agents that vanished from the state walk out.
    for (const actor of this.actors.values()) {
      if (!state.agents[actor.agent.id] && !actor.gone) {
        actor.gone = true;
        actor.agent = { ...actor.agent, status: "ended", activity: "ended" };
      }
    }

    // Speech and scenes — after all actors exist, so both sides of a scene are on screen.
    for (const agent of Object.values(state.agents)) {
      const actor = this.actors.get(agent.id);
      if (!actor) continue;
      if (agent.lastSaid && agent.lastSaid.at !== actor.lastSaidAt) {
        actor.lastSaidAt = agent.lastSaid.at;
        if (!initial) this.stage(actor, agent.lastSaid);
      }
      if (agent.lastErrorAt && agent.lastErrorAt !== actor.lastErrorAt) {
        actor.lastErrorAt = agent.lastErrorAt;
        if (!initial) this.puff(actor.c);
      }
    }
  }

  private spawn(agent: AgentState, atDestination: boolean): Actor {
    this.ensureSeat(agent);
    const door = this.doorSpot();
    const c = new Character(this, agent.id, door, () => this.office.walkable);
    c.sprite.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.deps.onSelect(agent.id);
    });
    const actor: Actor = {
      c,
      debounce: new PlaceDebouncer(),
      agent,
      gone: false,
      ...(agent.lastSaid ? { lastSaidAt: agent.lastSaid.at } : {}),
      ...(agent.lastErrorAt ? { lastErrorAt: agent.lastErrorAt } : {}),
    };
    this.actors.set(agent.id, actor);
    if (atDestination) {
      const dest = this.destinationFor(actor, this.now);
      if (dest) {
        c.tile = { ...dest.tile };
        c.sprite.setPosition(...feet(dest.tile));
        c.goTo(dest);
      }
    }
    return actor;
  }

  private despawn(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.c.destroy();
    this.allocator.remove(id);
    this.deps.overlay.remove(id);
    this.actors.delete(id);
    if (this.selected === id) this.deps.onSelect(undefined);
  }

  /** Make sure the agent has a desk, growing the office if every pod is taken. */
  private ensureSeat(agent: AgentState): Spot | undefined {
    let seat = this.allocator.seatFor(agent.id, agent.project.path);
    if (seat) return seat;
    const needed = this.allocator.podsNeededFor(agent.project.path);
    this.office = buildOffice(needed);
    this.allocator.setOffice(this.office);
    this.textures.remove("office");
    this.textures.addCanvas("office", paintOffice(this.office));
    this.bg.setTexture("office");
    this.updateBounds();
    seat = this.allocator.seatFor(agent.id, agent.project.path);
    return seat;
  }

  // --- where should each agent be? -----------------------------------------

  private direct(actor: Actor, now: number): void {
    if (actor.c.arrived) actor.debounce.arrived(now);
    const dest = this.destinationFor(actor, now);
    if (dest) actor.c.goTo(dest);
  }

  private destinationFor(actor: Actor, now: number): Destination | undefined {
    const { agent, c } = actor;
    const wasLounging = c.destination?.pose === "lounge";
    const place = actor.debounce.decide(placeFor(agent.activity), now);
    let spot: Spot | undefined;
    if (place.kind === "seat") {
      this.allocator.release(agent.id);
      spot = this.ensureSeat(agent);
    } else if (place.kind === "door") {
      this.allocator.release(agent.id);
      spot = { kind: "door", ...this.doorSpot(), facing: "left" };
    } else {
      spot = this.allocator.reserve(agent.id, place.kind, c.tile);
    }
    if (!spot) return undefined;
    return {
      tile: { x: spot.x, y: spot.y },
      facing: spot.facing,
      pose: place.pose,
      run: place.kind === "reception" || (wasLounging && place.kind !== "lounge"),
    };
  }

  // --- scenes ---------------------------------------------------------------

  private stage(actor: Actor, u: Utterance): void {
    const other = u.withAgentId ? this.actors.get(u.withAgentId) : undefined;
    const say = (a: Actor, kind: Utterance["kind"], text: string) => () => this.deps.overlay.say(a.agent.id, { kind, text }, this.now);

    switch (u.kind) {
      case "delegate": {
        if (!other) return say(actor, u.kind, u.text)();
        // Parallel sub-agents start within milliseconds of each other. Collect them
        // briefly so a fan-out gets one kickoff meeting instead of several.
        let batch = this.delegations.get(actor.agent.id);
        if (!batch) {
          batch = { children: [], texts: [] };
          this.delegations.set(actor.agent.id, batch);
          this.time.delayedCall(DELEGATION_BATCH_MS, () => {
            this.delegations.delete(actor.agent.id);
            this.stageDelegation(actor, batch!);
          });
        }
        batch.children.push(other);
        batch.texts.push(u.text);
        return;
      }
      case "report": {
        if (!other) return say(actor, u.kind, u.text)();
        // The sub-agent walks over to its parent, hands over the result, then leaves.
        actor.c.play([
          { type: "goto", dest: () => this.besideActor(other, actor) },
          { type: "do", fn: say(actor, "report", u.text) },
          { type: "hold", ms: 1500 },
          { type: "do", fn: say(other, "message", "👍 thanks") },
          { type: "hold", ms: 1800 },
        ]);
        return;
      }
      case "message": {
        if (!other || other === actor) return say(actor, u.kind, u.text)();
        actor.c.play([
          { type: "goto", dest: () => this.besideActor(other, actor) },
          { type: "do", fn: say(actor, "message", u.text) },
          { type: "hold", ms: 2800 },
        ]);
        return;
      }
      default:
        say(actor, u.kind, u.text)();
    }
  }

  /**
   * One sub-agent: it walks to the parent's desk to get briefed, then goes to work.
   * Several at once: everyone meets at the meeting table for a quick kickoff.
   */
  private stageDelegation(parent: Actor, batch: { children: Actor[]; texts: string[] }): void {
    const say = (a: Actor, kind: Utterance["kind"], text: string) => () => this.deps.overlay.say(a.agent.id, { kind, text }, this.now);
    const brief = batch.texts.length === 1 ? batch.texts[0]! : `Team: ${batch.texts.join(" · ")}`;

    if (batch.children.length === 1) {
      const child = batch.children[0]!;
      say(parent, "delegate", brief)();
      child.c.play([
        { type: "goto", dest: () => this.besideActor(parent, child) },
        { type: "do", fn: say(child, "message", "On it!") },
        { type: "hold", ms: 1200 },
      ]);
      return;
    }

    const table = this.allocator.reserve(parent.agent.id, "meeting", parent.c.tile);
    if (!table) {
      say(parent, "delegate", brief)();
      return;
    }
    parent.c.play([
      { type: "goto", dest: () => ({ tile: table, facing: table.facing, pose: "stand" }) },
      { type: "do", fn: say(parent, "delegate", brief) },
      { type: "hold", ms: 2500 },
      { type: "do", fn: () => this.allocator.release(parent.agent.id) },
    ]);
    for (const child of batch.children) {
      child.c.play([
        {
          type: "goto",
          dest: () => {
            const seat = this.allocator.reserve(child.agent.id, "meeting", table);
            return seat && { tile: seat, facing: seat.facing, pose: "stand" };
          },
        },
        { type: "do", fn: say(child, "message", "On it!") },
        { type: "hold", ms: 1200 },
        { type: "do", fn: () => this.allocator.release(child.agent.id) },
      ]);
    }
  }

  /** A free walkable tile next to where `target` is (or is heading), facing it. */
  private besideActor(target: Actor, visitor: Actor): Destination | undefined {
    const at = target.c.destination?.tile ?? target.c.tile;
    const tile = this.nearestOpenTile(at, visitor.c.tile);
    if (!tile) return undefined;
    return { tile, facing: faceToward(tile, at), pose: "stand" };
  }

  private nearestOpenTile(around: Point, from: Point): Point | undefined {
    const w = this.office.walkable;
    const seen = new Set<string>([`${around.x},${around.y}`]);
    let frontier: Point[] = [around];
    for (let r = 0; r < 4 && frontier.length; r++) {
      const next: Point[] = [];
      const found: Point[] = [];
      for (const p of frontier) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = `${q.x},${q.y}`;
          if (seen.has(k) || !w[q.y]?.[q.x]) continue;
          seen.add(k);
          next.push(q);
          if (!this.occupied(q)) found.push(q);
        }
      }
      if (found.length) {
        return found.sort((a, b) => dist(a, from) - dist(b, from))[0];
      }
      frontier = next;
    }
    return undefined;
  }

  private occupied(t: Point): boolean {
    for (const a of this.actors.values()) {
      const d = a.c.destination?.tile ?? a.c.tile;
      if (d.x === t.x && d.y === t.y) return true;
    }
    return false;
  }

  private puff(c: Character): void {
    for (let i = 0; i < 5; i++) {
      const g = this.add.circle(c.x + Phaser.Math.Between(-4, 4), c.y - 18, Phaser.Math.Between(2, 4), 0x888888, 0.8);
      g.setDepth(100_000);
      this.tweens.add({
        targets: g,
        y: g.y - Phaser.Math.Between(8, 16),
        x: g.x + Phaser.Math.Between(-6, 6),
        alpha: 0,
        scale: 2,
        duration: 900 + i * 120,
        onComplete: () => g.destroy(),
      });
    }
  }

  // --- camera & helpers -----------------------------------------------------

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor("#1d1f27");
    cam.setRoundPixels(true);
    this.updateBounds();
    this.fit();
    this.scale.on("resize", () => this.fit());

    let dragging = false;
    let moved = 0;
    this.input.on("pointerdown", () => {
      dragging = true;
      moved = 0;
    });
    this.input.on("pointerup", () => {
      if (dragging && moved < 4) this.deps.onSelect(undefined);
      dragging = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!dragging || !p.isDown) return;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomBy(dy > 0 ? 1 / 1.15 : 1.15);
    });
  }

  private updateBounds(): void {
    const pad = 4 * TILE;
    this.cameras.main.setBounds(-pad, -pad, this.office.width * TILE + pad * 2, this.office.height * TILE + pad * 2);
  }

  private toScreen(x: number, y: number, cam: Phaser.Cameras.Scene2D.Camera): ScreenPoint {
    const ox = cam.width * cam.originX;
    const oy = cam.height * cam.originY;
    return {
      x: cam.x + ox + cam.zoom * (x - cam.scrollX - ox),
      y: cam.y + oy + cam.zoom * (y - cam.scrollY - oy),
      scale: cam.zoom,
    };
  }

  private doorSpot(): Point {
    const doors = this.office.spots.filter((s) => s.kind === "door");
    const d = doors[Math.floor(Math.random() * doors.length)] ?? { x: 0, y: 0 };
    return { x: d.x, y: d.y };
  }

  private isDoor(t: Point): boolean {
    return this.office.tiles[t.y]?.[t.x] === "D";
  }
}

function faceToward(from: Point, to: Point): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function dist(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
