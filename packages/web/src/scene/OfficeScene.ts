import Phaser from "phaser";
import { emptyState, type AgentState, type OfficeState, type Utterance } from "@pixel-office/protocol";
import { paintOffice } from "../art/tiles.js";
import { Allocator } from "../office/allocator.js";
import { PlaceDebouncer, placeFor } from "../office/director.js";
import { generateOffice } from "../office/generate.js";
import { TILE, type Facing, type Office, type Spot } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { OfficePlanner, planKey } from "../office/planner.js";
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
/** Room resizes (not new teams) wait at least this long after the last rebuild. */
const REBUILD_COOLDOWN_MS = 4000;

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
  private links!: Phaser.GameObjects.Graphics;
  private actors = new Map<string, Actor>();
  private planner = new OfficePlanner();
  private builtKey = "";
  private builtTeams = "";
  private builtAt = -Infinity;
  /** Once the user pans or zooms, a rebuilt office no longer re-fits the camera. */
  private userMovedCamera = false;
  private firstSync = true;
  private selected: string | undefined;
  /** Session id → colour index, handed out in order of appearance and kept for the page's life. */
  private sessionColors = new Map<string, number>();
  private delegations = new Map<string, { children: Actor[]; texts: string[] }>();
  private now = 0;

  constructor() {
    super("office");
  }

  init(deps: SceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    const plan = this.planner.plan(emptyState(), 0);
    this.office = generateOffice(plan);
    this.builtKey = planKey(plan);
    this.allocator = new Allocator(this.office);
    this.textures.addCanvas("office", paintOffice(this.office, (id) => this.sessionColor(id)));
    this.bg = this.add.image(0, 0, "office").setOrigin(0, 0).setDepth(-1);
    this.links = this.add.graphics().setDepth(99_999);
    this.setupCamera();
    this.deps.store.subscribe((state) => this.sync(state));
  }

  override update(time: number, delta: number): void {
    this.now = time;
    const cam = this.cameras.main;
    const points = new Map<string, ScreenPoint>();
    for (const [id, actor] of this.actors) {
      if (!actor.c.busyWithScript) this.direct(actor, time);
      const call = actor.agent.openCalls[actor.agent.openCalls.length - 1];
      actor.c.setActivity(actor.agent.activity, call?.callId ?? actor.agent.activity, time);
      actor.c.update(Math.min(delta, 100), time);
      if (actor.agent.status === "ended" && !actor.c.busyWithScript && actor.c.arrived && actor.c.destination?.pose === "stand" && this.isDoor(actor.c.tile)) {
        this.despawn(id);
        continue;
      }
      points.set(id, this.toScreen(actor.c.x, actor.c.y - 27, cam));
    }
    this.deps.overlay.placeAll(points, time);
    this.drawTeamLinks(time);
    this.labelTeams(cam);
    // Shrinking happens on a timer, not on an event, so re-plan now and then.
    if (Math.floor(time / 1000) !== Math.floor((time - delta) / 1000)) this.replan(this.deps.store.state);
  }

  /** "project · Manager" above each team area, in the session's colour. */
  private labelTeams(cam: Phaser.Cameras.Scene2D.Camera): void {
    const state = this.deps.store.state;
    const shown = new Set<string>();
    for (const t of this.office.teams) {
      shown.add(t.sessionId);
      const manager = Object.values(state.agents).find((a) => a.sessionId === t.sessionId && !a.parentId);
      this.deps.overlay.teamLabel(
        t.sessionId,
        manager ? `${t.project} · ${manager.name}` : t.project,
        this.sessionColor(t.sessionId),
        this.toScreen((t.x + t.w / 2) * TILE, t.y * TILE + 7, cam),
      );
    }
    this.deps.overlay.pruneTeamLabels(shown);
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
    this.userMovedCamera = true;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.5, 6));
  }

  /** Fit the whole office on screen. Called by the "fit" button: re-enables auto-fit. */
  fit(): void {
    this.userMovedCamera = false;
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
    this.replan(state);

    for (const agent of Object.values(state.agents)) {
      let actor = this.actors.get(agent.id);
      if (!actor) {
        if (agent.status === "ended") continue;
        actor = this.spawn(agent, initial);
      }
      actor.agent = agent;
      actor.gone = false;
    }

    // Every session gets its own colour (ring under the feet, tag stripe); a
    // main agent and its sub-agents share it, so you can see who belongs to whom.
    for (const agent of Object.values(state.agents)) {
      const actor = this.actors.get(agent.id);
      if (!actor) continue;
      const color = this.sessionColor(agent.sessionId);
      actor.c.setSessionColor(color);
      const parent = agent.parentId ? state.agents[agent.parentId] : undefined;
      this.deps.overlay.ensure(agent, { parentName: parent?.name, sessionColor: color }, () => this.deps.onSelect(agent.id));
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

  private ensureSeat(agent: AgentState): Spot | undefined {
    return this.allocator.seatFor(agent);
  }

  /**
   * Re-plan the office from the state and regenerate it when the plan changed.
   * A new or removed team rebuilds at once (someone needs a desk); room
   * resizes wait for a short cooldown so the office doesn't twitch.
   */
  private replan(state: OfficeState): void {
    const plan = this.planner.plan(state, this.now);
    const key = planKey(plan);
    if (key === this.builtKey) return;
    const teams = JSON.stringify(plan.teams.map((t) => [t.sessionId, t.workerSlots]));
    const teamsChanged = teams !== this.builtTeams;
    if (!teamsChanged && this.now - this.builtAt < REBUILD_COOLDOWN_MS) return;
    this.builtKey = key;
    this.builtTeams = teams;
    this.builtAt = this.now;
    this.office = generateOffice(plan);
    this.allocator.setOffice(this.office);
    this.textures.remove("office");
    this.textures.addCanvas("office", paintOffice(this.office, (id) => this.sessionColor(id)));
    this.bg.setTexture("office");
    this.updateBounds();
    if (!this.userMovedCamera) this.fit();
    // Anyone now standing inside furniture or a wall steps out; everyone re-routes.
    for (const actor of this.actors.values()) {
      const t = actor.c.tile;
      if (!this.office.walkable[t.y]?.[t.x]) {
        const free = this.nearestWalkable(t);
        if (free) actor.c.placeAt(free);
      }
      actor.c.repath();
    }
  }

  private nearestWalkable(from: Point): Point | undefined {
    const w = this.office.walkable;
    const seen = new Set<string>([`${from.x},${from.y}`]);
    let frontier = [from];
    while (frontier.length) {
      const next: Point[] = [];
      for (const p of frontier) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const q = { x: p.x + dx, y: p.y + dy };
          const k = `${q.x},${q.y}`;
          if (seen.has(k) || q.x < 0 || q.y < 0 || q.y >= this.office.height || q.x >= this.office.width) continue;
          seen.add(k);
          if (w[q.y]![q.x]) return q;
          next.push(q);
        }
      }
      frontier = next;
    }
    return undefined;
  }

  /** Dotted lines from the selected agent to its parent and sub-agents. */
  private drawTeamLinks(now: number): void {
    const g = this.links;
    g.clear();
    const sel = this.selected ? this.actors.get(this.selected) : undefined;
    if (!sel) return;
    const team = [...this.actors.values()].filter(
      (a) => a !== sel && (a.agent.id === sel.agent.parentId || a.agent.parentId === sel.agent.id),
    );
    const color = this.sessionColor(sel.agent.sessionId);
    const march = Math.floor(now / 120) % 6;
    for (const other of team) {
      const x1 = sel.c.x;
      const y1 = sel.c.y - 10;
      const x2 = other.c.x;
      const y2 = other.c.y - 10;
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = march; d < len; d += 6) {
        const t = d / len;
        g.fillStyle(color, 0.9).fillRect(Math.round(x1 + (x2 - x1) * t) - 1, Math.round(y1 + (y2 - y1) * t) - 1, 2, 2);
      }
    }
  }

  private sessionColor(sessionId: string): number {
    let i = this.sessionColors.get(sessionId);
    if (i === undefined) {
      i = this.sessionColors.size;
      this.sessionColors.set(sessionId, i);
    }
    return sessionColorAt(i);
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
      this.userMovedCamera = true;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.userMovedCamera = true;
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

/**
 * The i-th session colour. Hues step by the golden angle, so consecutive
 * sessions land far apart on the colour wheel and never look alike.
 */
export function sessionColorAt(i: number): number {
  const hue = ((i * 137.508 + 18) % 360) / 360;
  const lightness = i % 2 ? 0.55 : 0.65;
  return Phaser.Display.Color.HSLToColor(hue, 0.85, lightness).color;
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
