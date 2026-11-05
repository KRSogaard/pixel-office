import Phaser from "phaser";
import { emptyState, isTestRun, type AgentState, type OfficeState, type Utterance } from "@pixel-office/protocol";
import { paintOffice } from "../art/tiles.js";
import { Allocator } from "../office/allocator.js";
import { PlaceDebouncer, placeFor } from "../office/director.js";
import { generateOffice } from "../office/generate.js";
import { TILE, type Facing, type Office, type Spot } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { OfficePlanner, planKey } from "../office/planner.js";
import type { OfficeStore } from "../net.js";
import type { Overlay, ScreenPoint } from "../ui/overlay.js";
import { Antics } from "./antics.js";
import { ContextBins } from "./bins.js";
import { Character, feet, type Destination } from "./Character.js";
import { confetti, poof, puff } from "./effects.js";
import { WallDecor } from "./decor.js";
import { Extras } from "./extras.js";
import { Lighting } from "./lighting.js";
import { Pet } from "./pet.js";
import { RocketSilo } from "./silo.js";
import { STUCK_MS } from "../ui/listview.js";

interface Actor {
  c: Character;
  debounce: PlaceDebouncer;
  lastSaidAt?: number;
  lastErrorAt?: number;
  lastWinAt?: number;
  lastErrorText?: number;
  /** Being carried out by medics: the scene leaves it alone. */
  carried?: boolean;
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
  private bins!: ContextBins;
  private lighting!: Lighting;
  private pet!: Pet;
  private extras!: Extras;
  private silo!: RocketSilo;
  private antics!: Antics;
  private decor!: WallDecor;
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
    const plan = this.planner.plan(emptyState(), 0, this.deps.store.settings);
    this.office = generateOffice(plan);
    this.builtKey = planKey(plan);
    this.allocator = new Allocator(this.office);
    this.textures.addCanvas("office", paintOffice(this.office, (id) => this.sessionColor(id), this.deps.store.settings.rugs));
    this.bg = this.add.image(0, 0, "office").setOrigin(0, 0).setDepth(-1);
    this.links = this.add.graphics().setDepth(99_999);
    this.bins = new ContextBins(this);
    this.lighting = new Lighting(this);
    this.lighting.resize(this.office.width * TILE, this.office.height * TILE);
    this.pet = new Pet(
      this,
      () => this.office,
      () => [...this.actors.values()].filter((a) => a.c.arrived).map((a) => a.c.tile),
      (tile) => {
        const victim = [...this.actors.values()].find((a) => a.c.tile.x === tile.x && a.c.tile.y === tile.y && a.c.destination?.pose === "type");
        if (victim) this.deps.overlay.say(victim.agent.id, { kind: "message", text: "Byte! Not the keyboard! 😾" }, this.now);
      },
    );
    this.extras = new Extras(this, () => this.office, () => this.doorSpot());
    this.silo = new RocketSilo(this, () => this.office.silo, (label) => {
      const who = [...this.actors.values()].find((a) => label.startsWith(`${a.agent.name}:`));
      if (who) this.deps.overlay.say(who.agent.id, { kind: "message", text: "🚀 Shipped!" }, this.now);
    });
    this.decor = new WallDecor(this, () => this.office);
    this.decor.relocate();
    this.antics = new Antics({
      scene: this,
      extras: this.extras,
      silo: this.silo,
      actors: () => [...this.actors.values()].filter((a) => !a.gone && !a.carried).map((a) => ({ id: a.agent.id, c: a.c, agent: a.agent })),
      say: (id, text) => this.deps.overlay.say(id, { kind: "message", text }, this.now),
      office: () => this.office,
      team: (sessionId) => this.office.teams.find((t) => t.sessionId === sessionId),
      mailroom: () => this.office.spots.find((s) => s.kind === "mail"),
      lounge: () => this.coffeeMachine(),
    });
    this.setupCamera();
    this.deps.store.subscribe((state) => this.sync(state));
    // Office settings changed (here or in another browser): rebuild right away.
    this.deps.store.onSettings(() => this.replan(this.deps.store.state, true));
  }

  /**
   * Forget everyone on screen and start over from the current state, placing
   * agents straight at their spots. Used when replay jumps in time.
   */
  reset(): void {
    for (const id of [...this.actors.keys()]) this.despawn(id);
    this.firstSync = true;
    this.sync(this.deps.store.state);
  }

  override update(time: number, delta: number): void {
    this.now = time;
    const cam = this.cameras.main;
    const points = new Map<string, ScreenPoint>();
    for (const [id, actor] of this.actors) {
      if (actor.carried) {
        // The medics move them; just keep the name tag on them.
        points.set(id, this.toScreen(actor.c.x, actor.c.y - 14, cam));
        continue;
      }
      if (!actor.c.busyWithScript) this.direct(actor, time);
      const open = actor.agent.openCalls[actor.agent.openCalls.length - 1];
      actor.c.setStuck(!!open && actor.agent.status === "working" && Date.now() - open.startedAt > STUCK_MS);
      const call = actor.agent.openCalls[actor.agent.openCalls.length - 1];
      actor.c.setActivity(actor.agent.activity, call?.callId ?? actor.agent.activity, time);
      actor.c.setFxSide(this.fxOnLeft(actor));
      actor.c.update(Math.min(delta, 100), time);
      this.bins.update(actor.agent, actor.gone ? undefined : this.allocator.seatFor(actor.agent), time);
      if (actor.agent.status === "ended" && !actor.c.busyWithScript && actor.c.arrived && actor.c.destination?.pose === "stand" && this.isDoor(actor.c.tile)) {
        this.despawn(id);
        continue;
      }
      points.set(id, this.toScreen(actor.c.x, actor.c.y - 27, cam));
    }
    this.deps.overlay.placeAll(points, time);
    this.drawTeamLinks(time);
    this.labelTeams(cam);
    this.pet.update(Math.min(delta, 100), time);
    this.extras.update(Math.min(delta, 100), time);
    this.antics.tick(time);
    this.decor.update(time);
    if (Math.floor(time / 500) !== Math.floor((time - delta) / 500)) this.lighting.update(this.lightSpots());
    // Shrinking happens on a timer, not on an event, so re-plan now and then.
    if (Math.floor(time / 1000) !== Math.floor((time - delta) / 1000)) this.replan(this.deps.store.state);
  }

  /** "project · Manager" above each team area, and its whiteboard with the manager's todo list. */
  private labelTeams(cam: Phaser.Cameras.Scene2D.Camera): void {
    const state = this.deps.store.state;
    const shown = new Set<string>();
    for (const t of this.office.teams) {
      shown.add(t.sessionId);
      const manager = Object.values(state.agents).find((a) => a.sessionId === t.sessionId && !a.parentId);
      const color = this.sessionColor(t.sessionId);
      this.deps.overlay.teamLabel(
        t.sessionId,
        `${manager ? `${t.project} · ${manager.name}` : t.project}${manager?.branch ? ` · ⎇ ${manager.branch}` : ""}`,
        color,
        this.toScreen((t.x + t.w / 2) * TILE, t.y * TILE + 7, cam),
      );
      this.deps.overlay.whiteboard(
        t.sessionId,
        manager ? `${manager.name} · ${t.project}` : t.project,
        manager?.todos,
        color,
        this.toScreen((t.whiteboard.x + 1) * TILE, (t.whiteboard.y + 1) * TILE, cam),
      );
    }
    this.deps.overlay.pruneTeamLabels(shown);
    this.signRooms(cam);
  }

  /** Name signs over the top rooms; the test lab's shows the latest test result in the office. */
  private signRooms(cam: Phaser.Cameras.Scene2D.Camera): void {
    const names = { library: "Library", server: "Server room", lab: "Test lab", git: "Git room", mail: "Mailroom" } as const;
    const keep = new Set<string>();
    for (const r of this.office.rooms) {
      keep.add(r.kind);
      let text: string = names[r.kind];
      let tone: "plain" | "running" | "pass" | "fail" = "plain";
      if (r.kind === "lab") {
        const result = this.latestTestResult();
        tone = result.tone;
        if (result.text) text += ` · ${result.text}`;
      }
      if (r.kind === "git" && this.silo.launches) {
        text += ` · 🚀 ×${this.silo.launches}`;
        if (Date.now() - this.silo.lastLaunchAt < 8000) tone = "pass";
      }
      this.deps.overlay.roomSign(r.kind, text, tone, this.toScreen((r.x + r.w / 2) * TILE, (r.y + r.h) * TILE + 9, cam));
    }
    this.deps.overlay.pruneRoomSigns(keep);
  }

  private latestTestResult(): { tone: "plain" | "running" | "pass" | "fail"; text: string } {
    const agents = Object.values(this.deps.store.state.agents);
    if (agents.some((a) => a.activity === "test")) return { tone: "running", text: "⏳ running" };
    let last: { at: number; ok: boolean } | undefined;
    for (const a of agents) {
      for (const c of a.recentTools) {
        if (c.endedAt === undefined || !isTestRun(c.tool, c.summary)) continue;
        if (!last || c.endedAt > last.at) last = { at: c.endedAt, ok: c.ok !== false };
      }
    }
    if (!last) return { tone: "plain", text: "" };
    return last.ok ? { tone: "pass", text: "✓ pass" } : { tone: "fail", text: "✗ fail" };
  }

  /** Light pools at night: every occupied desk's monitor, and every manager's desk lamp. */
  private lightSpots(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const t of this.office.teams) out.push({ x: (t.managerSeat.x - 1) * TILE + 4, y: (t.managerSeat.y - 1) * TILE + 6 });
    for (const a of this.actors.values()) {
      const pose = a.c.destination?.pose;
      if (a.c.arrived && (pose === "type" || pose === "think")) out.push({ x: a.c.tile.x * TILE + 16, y: (a.c.tile.y - 1) * TILE + 6 });
    }
    return out;
  }

  /** Icon on the left at a desk (keeps the monitor clear) or when someone stands to the right. */
  private fxOnLeft(actor: Actor): boolean {
    const pose = actor.c.destination?.pose;
    const seated = actor.c.arrived && (pose === "type" || pose === "think");
    const t = actor.c.tile;
    const busy = (dx: number) =>
      [...this.actors.values()].some((o) => o !== actor && Math.abs(o.c.tile.x - (t.x + dx)) === 0 && Math.abs(o.c.tile.y - t.y) <= 1);
    if (seated) return !busy(-1);
    return busy(1) && !busy(-1);
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
        if (!initial) puff(this, actor.c.x, actor.c.y);
      }
      this.antics.observe({ id: agent.id, c: actor.c, agent }, this.now, initial);
      if (agent.lastWinAt && agent.lastWinAt !== actor.lastWinAt) {
        actor.lastWinAt = agent.lastWinAt;
        if (!initial) {
          actor.c.cheer(this.now);
          confetti(this, actor.c.x, actor.c.y);
          this.deps.overlay.say(agent.id, { kind: "message", text: "Tests pass! 🎉" }, this.now);
        }
      }
      if (agent.lastError && agent.lastError.at !== actor.lastErrorText) {
        actor.lastErrorText = agent.lastError.at;
        if (!initial && /rate|limit|overload|quota|429/i.test(agent.lastError.text)) this.coffeeBreak(actor, agent.lastError.text);
      }
    }
  }

  private spawn(agent: AgentState, atDestination: boolean): Actor {
    this.ensureSeat(agent);
    // Sub-agents are conjured by their parent: they pop up right beside it
    // instead of walking in from the street.
    const parent = agent.parentId ? this.actors.get(agent.parentId) : undefined;
    const beside = parent && !atDestination ? this.nearestOpenTile(parent.c.tile, parent.c.tile) : undefined;
    const c = new Character(this, agent.id, beside ?? this.doorSpot(), () => this.office.walkable);
    if (beside) poof(this, c.x, c.y, this.sessionColor(agent.sessionId));
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
      ...(agent.lastWinAt ? { lastWinAt: agent.lastWinAt } : {}),
      ...(agent.lastError ? { lastErrorText: agent.lastError.at } : {}),
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
    this.bins.remove(id);
    this.antics.forget(id);
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
  private replan(state: OfficeState, force = false): void {
    const plan = this.planner.plan(state, this.now, this.deps.store.settings);
    const key = planKey(plan);
    if (key === this.builtKey) return;
    const teams = JSON.stringify(plan.teams.map((t) => t && [t.sessionId, t.workerSlots]));
    const teamsChanged = teams !== this.builtTeams;
    if (!force && !teamsChanged && this.now - this.builtAt < REBUILD_COOLDOWN_MS) return;
    this.builtKey = key;
    this.builtTeams = teams;
    this.builtAt = this.now;
    this.office = generateOffice(plan);
    this.allocator.setOffice(this.office);
    this.textures.remove("office");
    this.textures.addCanvas("office", paintOffice(this.office, (id) => this.sessionColor(id), this.deps.store.settings.rugs));
    this.bg.setTexture("office");
    this.updateBounds();
    this.lighting.resize(this.office.width * TILE, this.office.height * TILE);
    this.pet.relocate();
    this.extras.relocate();
    this.decor.relocate();
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

  /** The colour of a session, for UI outside the scene (list view). */
  colorOf(sessionId: string): number {
    return this.sessionColor(sessionId);
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
    let wanted = placeFor(agent.activity);
    // A manager whose sub-agents are still busy waits at its desk instead of going to the lounge.
    if (wanted.kind === "lounge" && !agent.parentId && this.hasBusyTeam(agent.id)) wanted = { kind: "seat", pose: "think" };
    const place = actor.debounce.decide(wanted, now);
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
        // A sub-agent that failed collapses on the spot and is carried out by medics.
        if (actor.agent.endedOk === false) return this.collapse(actor, u.text);
        if (!other) return say(actor, u.kind, u.text)();
        // The sub-agent walks over to its parent, hands over the result, high five, then leaves.
        actor.c.play([
          { type: "goto", dest: () => this.besideActor(other, actor) },
          { type: "do", fn: say(actor, "report", u.text) },
          { type: "hold", ms: 1500 },
          {
            type: "do",
            fn: () => {
              actor.c.cheer(this.now);
              other.c.cheer(this.now);
              say(other, "message", "✋ High five!")();
            },
          },
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
   * Sub-agents pop up beside their parent (see spawn), so the hand-off is a
   * quick huddle right there: the parent states the task, each sub-agent says
   * "On it!", and everyone gets to work. No walk to the meeting room, so no
   * real work is hidden behind the animation.
   */
  private stageDelegation(parent: Actor, batch: { children: Actor[]; texts: string[] }): void {
    const brief = batch.texts.length === 1 ? batch.texts[0]! : `Team: ${batch.texts.join(" · ")}`;
    this.deps.overlay.say(parent.agent.id, { kind: "delegate", text: brief }, this.now);
    if (!parent.c.busyWithScript) parent.c.play([{ type: "hold", ms: 1500 }]);
    for (const child of batch.children) {
      child.c.play([
        { type: "hold", ms: 300 },
        { type: "do", fn: () => this.deps.overlay.say(child.agent.id, { kind: "message", text: "On it!" }, this.now) },
        { type: "hold", ms: 1100 },
      ]);
    }
  }

  /** A failed sub-agent: smoke, a sad bubble, and the medics come with a stretcher. */
  private collapse(actor: Actor, text: string): void {
    actor.carried = true;
    actor.c.play([]);
    puff(this, actor.c.x, actor.c.y);
    this.deps.overlay.say(actor.agent.id, { kind: "message", text: `✗ ${text || "failed"}` }, this.now);
    this.time.delayedCall(900, () => {
      actor.c.setLying(true);
      this.extras.medics(actor.c, () => this.despawn(actor.agent.id));
    });
  }

  private hasBusyTeam(agentId: string): boolean {
    for (const a of this.actors.values()) {
      if (a.agent.parentId === agentId && (a.agent.status === "working" || a.agent.status === "waiting")) return true;
    }
    return false;
  }

  /** Rate-limited: off to the coffee machine for a bit. */
  private coffeeBreak(actor: Actor, reason: string): void {
    actor.c.play([
      {
        type: "goto",
        dest: () => {
          const spot = this.allocator.reserve(actor.agent.id, "lounge", this.coffeeMachine() ?? actor.c.tile);
          return spot && { tile: spot, facing: "up", pose: "stand" };
        },
      },
      { type: "do", fn: () => this.deps.overlay.say(actor.agent.id, { kind: "message", text: `☕ ${reason.replace(/_/g, " ")}` }, this.now) },
      { type: "hold", ms: 6000 },
    ]);
  }

  private coffeeMachine(): Point | undefined {
    for (let y = 0; y < this.office.height; y++) {
      const x = this.office.tiles[y]!.indexOf("K");
      if (x >= 0) return { x, y: y + 1 };
    }
    return undefined;
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
