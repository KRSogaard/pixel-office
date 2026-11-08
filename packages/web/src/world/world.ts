import { emptyState, type AgentState, type OfficeState, type Utterance } from "@pixel-office/protocol";
import { Allocator } from "../office/allocator.js";
import { PlaceDebouncer, placeFor } from "../office/director.js";
import { generateOffice } from "../office/generate.js";
import { TILE, type Facing, type Office, type Spot } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { OfficePlanner, planKey } from "../office/planner.js";
import type { OfficeStore } from "../net.js";
import type { Overlay } from "../ui/overlay.js";
import type { Sfx } from "../ui/sounds.js";
import { STUCK_MS } from "../ui/listview.js";
import { Antics } from "./antics.js";
import { Bugs } from "./bugs.js";
import { Clock } from "./clock.js";
import { Drones } from "./drones.js";
import type { WorldEvent, WorldListener } from "./events.js";
import { Extras } from "./extras.js";
import { Person, type Destination } from "./person.js";
import { Pet } from "./pet.js";
import { Seasonal } from "./seasonal.js";
import { RocketSilo } from "./silo.js";
import { Visitors, type VisitorKind } from "./visitors.js";

/** An agent in the office. */
export interface Actor {
  person: Person;
  debounce: PlaceDebouncer;
  lastSaidAt?: number;
  lastErrorAt?: number;
  lastWinAt?: number;
  lastErrorText?: number;
  /** Tool calls already looked at (for commit crates). */
  seenCalls?: Set<string>;
  /** Being carried out by medics: the world leaves it alone. */
  carried?: boolean;
  /** Last state we saw. Kept after the agent leaves the state so it can walk out. */
  agent: AgentState;
  gone: boolean;
}

/** An agent's wastepaper bin: fills up with its context window, stomped flat while it compacts. */
export interface Bin {
  agentId: string;
  /** The agent's seat; the bin stands on the floor tile to its right. */
  seat: Point;
  /** 0 → 1: how full the context window is. */
  fill: number;
  stomping: boolean;
}

/** The parts of the HTML overlay the world talks through: speech bubbles and name tags. */
export type Speech = Pick<Overlay, "say" | "ensure" | "remove" | "select">;

export interface WorldDeps {
  store: OfficeStore;
  speech: Speech;
  sfx: Sfx;
  onSelect: (agentId: string | undefined) => void;
  /** The visitors who drop by (each art style has its own cast). */
  cast: readonly string[];
}

/** How long to wait for more sub-agents before staging a delegation. */
const DELEGATION_BATCH_MS = 400;
/** Room resizes (not new teams) wait at least this long after the last rebuild. */
const REBUILD_COOLDOWN_MS = 4000;

/**
 * The office's brain, with no drawing in it: turns office state into people
 * walking around, decides *where* each agent goes (via the director and the
 * allocator), stages the little scenes when agents talk to each other, and runs
 * the gags. Renderers read its state every frame and listen for its one-off
 * events (`onEvent`); the world never waits on them.
 *
 * Positions are world pixels: `TILE` per tile.
 */
export class World {
  office: Office;
  readonly clock = new Clock();
  readonly bugs: Bugs;
  readonly drones: Drones;
  readonly silo: RocketSilo;
  readonly pet: Pet;
  readonly extras: Extras;
  readonly visitors: Visitors;
  readonly seasonal: Seasonal;
  readonly antics: Antics;
  readonly actors = new Map<string, Actor>();
  selected: string | undefined;

  private allocator: Allocator;
  private planner = new OfficePlanner();
  private listeners = new Set<WorldListener>();
  private builtKey: string;
  private builtTeams = "";
  private builtAt = -Infinity;
  private firstSync = true;
  /** Session id → colour index, handed out in order of appearance and kept for the page's life. */
  private sessionColors = new Map<string, number>();
  private delegations = new Map<string, { children: Actor[]; texts: string[] }>();

  constructor(private deps: WorldDeps) {
    const plan = this.planner.plan(emptyState(), 0, deps.store.settings);
    this.office = generateOffice(plan);
    this.builtKey = planKey(plan);
    this.allocator = new Allocator(this.office);
    const emit = (e: WorldEvent) => this.emit(e);
    this.silo = new RocketSilo(this.clock, emit, (label) => {
      const who = [...this.actors.values()].find((a) => label.startsWith(`${a.agent.name}:`));
      if (who) this.say(who.agent.id, "🚀 Shipped!");
      deps.sfx.rocket();
    });
    this.pet = new Pet(
      () => this.office,
      () => [...this.actors.values()].filter((a) => a.person.arrived).map((a) => a.person.tile),
      emit,
      (tile) => {
        const victim = [...this.actors.values()].find((a) => a.person.tile.x === tile.x && a.person.tile.y === tile.y && a.person.destination?.pose === "type");
        if (victim) {
          this.say(victim.agent.id, "Byte! Not the keyboard! 😾");
          deps.sfx.meow();
        }
      },
    );
    this.extras = new Extras(() => this.office, () => this.doorSpot());
    this.drones = new Drones(this.clock, () => this.office, () => this.silo.addCargo());
    this.bugs = new Bugs(this.clock, () => this.office, emit);
    this.seasonal = new Seasonal(() => this.office, () => deps.store.stats?.allTime.since, emit);
    this.seasonal.relocate();
    deps.store.onStats(() => {
      const before = JSON.stringify(this.seasonal.season);
      this.seasonal.relocate();
      if (JSON.stringify(this.seasonal.season) === before) return;
      for (const a of this.actors.values()) a.person.hat = this.seasonal.season.birthday;
      this.emit({ type: "season" });
    });
    this.antics = new Antics({
      clock: this.clock,
      emit,
      extras: this.extras,
      silo: this.silo,
      actors: () => [...this.actors.values()].filter((a) => !a.gone && !a.carried).map((a) => ({ id: a.agent.id, person: a.person, agent: a.agent })),
      say: (id, text) => this.say(id, text),
      office: () => this.office,
      team: (sessionId) => this.office.teams.find((t) => t.sessionId === sessionId),
      mailroom: () => this.office.spots.find((s) => s.kind === "mail"),
      lounge: () => this.coffeeMachine(),
      onFire: () => deps.sfx.alarm(),
      onScary: (agentId) => this.visitors.audit(agentId),
    });
    this.visitors = new Visitors(
      this.clock,
      {
        office: () => this.office,
        besideAgent: (agentId, from) => {
          const target = this.actors.get(agentId);
          if (!target || target.gone || target.carried) return undefined;
          return this.nearestOpenTile(target.person.destination?.tile ?? target.person.tile, from);
        },
        agents: () => [...this.actors.values()].filter((a) => !a.gone && !a.carried && a.agent.status !== "ended").map((a) => a.agent),
        stats: () => deps.store.stats,
        say: (id, text) => this.say(id, text),
        onLeave: (kind) => {
          const [line, reply] = VISITOR_GOSSIP[kind];
          this.antics.gossip(line, reply);
        },
      },
      deps.cast,
    );
    deps.store.subscribe((state) => this.sync(state));
    // Office settings changed (here or in another browser): rebuild right away.
    deps.store.onSettings(() => this.replan(deps.store.state, true));
  }

  /** Listen for one-off moments (smoke, confetti…) and office rebuilds. Returns an unsubscribe. */
  onEvent(fn: WorldListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Everyone on screen: agents, extras and visitors. */
  people(): Person[] {
    return [...[...this.actors.values()].map((a) => a.person), ...this.extras.people, ...this.visitors.list.map((v) => v.person)];
  }

  /**
   * Forget everyone and start over from the current state, placing agents
   * straight at their spots. Used when replay jumps in time.
   */
  reset(): void {
    for (const id of [...this.actors.keys()]) this.despawn(id);
    this.firstSync = true;
    this.sync(this.deps.store.state);
  }

  /** Advance the world to `now` (milliseconds, the renderer's clock). */
  update(dtMs: number, now: number): void {
    const dt = Math.min(dtMs, 100);
    this.clock.tick(now);
    for (const [id, actor] of this.actors) {
      // The medics move them.
      if (actor.carried) continue;
      const p = actor.person;
      if (!p.busyWithScript) this.direct(actor, now);
      const open = actor.agent.openCalls[actor.agent.openCalls.length - 1];
      p.stuck = !!open && actor.agent.status === "working" && Date.now() - open.startedAt > STUCK_MS;
      p.setActivity(actor.agent.activity, open?.callId ?? actor.agent.activity, now);
      p.fxLeft = this.fxOnLeft(actor);
      p.update(dt, now);
      if (actor.agent.status === "ended" && !p.busyWithScript && p.arrived && p.destination?.pose === "stand" && this.isDoor(p.tile)) {
        this.despawn(id);
        continue;
      }
      if (p.destination?.pose === "type" && p.arrived && Math.random() < 0.05) this.deps.sfx.click();
    }
    // Someone found a room full: grow it now rather than have them share a spot.
    if (this.allocator.shortage) this.replan(this.deps.store.state, true);
    this.visitors.update(dt, now);
    this.pet.update(dt, now);
    this.extras.update(dt, now);
    this.antics.tick(now);
    this.bugs.update(dt, now);
    this.seasonal.update(now);
    // Shrinking happens on a timer, not on an event, so re-plan now and then.
    if (Math.floor(now / 1000) !== Math.floor((now - dtMs) / 1000)) this.replan(this.deps.store.state);
  }

  /** Rugs under the team areas (an office setting). */
  get rugs(): boolean {
    return this.deps.store.settings.rugs;
  }

  select(agentId: string | undefined): void {
    this.selected = agentId;
    this.deps.speech.select(agentId);
  }

  /** The colour of a session: rings, tags, rugs. */
  colorOf(sessionId: string): number {
    let i = this.sessionColors.get(sessionId);
    if (i === undefined) {
      i = this.sessionColors.size;
      this.sessionColors.set(sessionId, i);
    }
    return sessionColorAt(i);
  }

  /** Each agent's wastepaper bin (agents with a seat and a known context size). */
  bins(): Bin[] {
    const out: Bin[] = [];
    for (const a of this.actors.values()) {
      const seat = a.gone ? undefined : this.allocator.seatFor(a.agent);
      if (!seat || !a.agent.context) continue;
      out.push({ agentId: a.agent.id, seat, fill: Math.min(1, a.agent.context.tokens / a.agent.context.limit), stomping: a.agent.activity === "compact" });
    }
    return out;
  }

  /** Dotted lines from the selected agent to its parent and sub-agents. */
  teamLinks(): { from: Person; to: Person; color: number }[] {
    const sel = this.selected ? this.actors.get(this.selected) : undefined;
    if (!sel) return [];
    const color = this.colorOf(sel.agent.sessionId);
    return [...this.actors.values()]
      .filter((a) => a !== sel && (a.agent.id === sel.agent.parentId || a.agent.parentId === sel.agent.id))
      .map((a) => ({ from: sel.person, to: a.person, color }));
  }

  /** Light pools at night: every occupied desk's monitor, and every manager's desk lamp (world pixels). */
  lightSpots(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const t of this.office.teams) out.push({ x: (t.managerSeat.x - 1) * TILE + 4, y: (t.managerSeat.y - 1) * TILE + 6 });
    for (const a of this.actors.values()) {
      const pose = a.person.destination?.pose;
      if (a.person.arrived && (pose === "type" || pose === "think")) out.push({ x: a.person.tile.x * TILE + 16, y: (a.person.tile.y - 1) * TILE + 6 });
    }
    return out;
  }

  /** Where each agent is and is heading — for debugging from the console. */
  debug(): { id: string; activity: string; tile: Point; dest?: Point; pose?: string; scripted: boolean }[] {
    return [...this.actors.values()].map((a) => ({
      id: a.agent.id,
      activity: a.agent.activity,
      tile: a.person.tile,
      ...(a.person.destination ? { dest: a.person.destination.tile, pose: a.person.destination.pose } : {}),
      scripted: a.person.busyWithScript,
    }));
  }

  private emit(e: WorldEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private say(id: string, text: string, kind: Utterance["kind"] = "message"): void {
    this.deps.speech.say(id, { kind, text }, this.clock.now);
  }

  // --- state → actors -------------------------------------------------------

  private sync(state: OfficeState): void {
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
      const color = this.colorOf(agent.sessionId);
      actor.person.sessionColor = color;
      const parent = agent.parentId ? state.agents[agent.parentId] : undefined;
      this.deps.speech.ensure(agent, { parentName: parent?.name, sessionColor: color }, () => this.deps.onSelect(agent.id));
    }

    // Agents that vanished from the state walk out.
    for (const actor of this.actors.values()) {
      if (!state.agents[actor.agent.id] && !actor.gone) {
        actor.gone = true;
        actor.agent = { ...actor.agent, status: "ended", activity: "ended" };
      }
    }

    // Speech and scenes — after all actors exist, so both sides of a scene are on screen.
    const now = this.clock.now;
    for (const agent of Object.values(state.agents)) {
      const actor = this.actors.get(agent.id);
      if (!actor) continue;
      const p = actor.person;
      if (agent.lastSaid && agent.lastSaid.at !== actor.lastSaidAt) {
        actor.lastSaidAt = agent.lastSaid.at;
        if (!initial) this.stage(actor, agent.lastSaid);
      }
      if (agent.lastErrorAt && agent.lastErrorAt !== actor.lastErrorAt) {
        actor.lastErrorAt = agent.lastErrorAt;
        if (!initial) {
          this.emit({ type: "puff", x: p.x, y: p.y });
          this.bugs.spawn(agent.sessionId, p.x, p.y, now);
        }
      }
      this.antics.observe({ id: agent.id, person: p, agent }, now, initial);
      if (!initial) this.shipCommits(actor, agent);
      if (agent.lastWinAt && agent.lastWinAt !== actor.lastWinAt) {
        actor.lastWinAt = agent.lastWinAt;
        if (!initial) {
          p.cheer(now);
          this.emit({ type: "confetti", x: p.x, y: p.y });
          const squashed = this.bugs.squash(agent.sessionId);
          this.say(agent.id, squashed ? `Tests pass! 🎉 Squashed ${squashed} 🐛` : "Tests pass! 🎉");
          if (squashed) {
            this.deps.sfx.squash();
            this.antics.gossip(`${agent.name} squashed ${squashed} bug${squashed > 1 ? "s" : ""} 🐛`, "Finally.");
          }
        }
      }
      if (agent.lastError && agent.lastError.at !== actor.lastErrorText) {
        actor.lastErrorText = agent.lastError.at;
        if (!initial && /rate|limit|overload|quota|429/i.test(agent.lastError.text)) this.coffeeBreak(actor, agent.lastError.text);
      }
    }
  }

  private spawn(agent: AgentState, atDestination: boolean): Actor {
    this.allocator.seatFor(agent);
    // Sub-agents are conjured by their parent: they pop up right beside it
    // instead of walking in from the street.
    const parent = agent.parentId ? this.actors.get(agent.parentId) : undefined;
    const beside = parent && !atDestination ? this.nearestOpenTile(parent.person.tile, parent.person.tile) : undefined;
    const p = new Person(agent.id, { agent: agent.id }, beside ?? this.doorSpot(), () => this.office.walkable);
    if (beside) this.emit({ type: "poof", x: p.x, y: p.y, color: this.colorOf(agent.sessionId) });
    p.hat = this.seasonal.season.birthday;
    const actor: Actor = {
      person: p,
      debounce: new PlaceDebouncer(),
      agent,
      gone: false,
      ...(agent.lastSaid ? { lastSaidAt: agent.lastSaid.at } : {}),
      ...(agent.lastErrorAt ? { lastErrorAt: agent.lastErrorAt } : {}),
      ...(agent.lastWinAt ? { lastWinAt: agent.lastWinAt } : {}),
      ...(agent.lastError ? { lastErrorText: agent.lastError.at } : {}),
      seenCalls: new Set(agent.recentTools.map((c) => c.callId)),
    };
    this.actors.set(agent.id, actor);
    if (atDestination) {
      const dest = this.destinationFor(actor, this.clock.now);
      if (dest) {
        p.placeAt(dest.tile);
        p.goTo(dest);
      }
    }
    return actor;
  }

  private despawn(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.antics.forget(id);
    this.allocator.remove(id);
    this.deps.speech.remove(id);
    this.actors.delete(id);
    if (this.selected === id) this.deps.onSelect(undefined);
  }

  /**
   * Re-plan the office from the state and regenerate it when the plan changed.
   * A new or removed team rebuilds at once (someone needs a desk); room
   * resizes wait for a short cooldown so the office doesn't twitch.
   */
  private replan(state: OfficeState, force = false): void {
    const now = this.clock.now;
    const plan = this.planner.plan(state, now, this.deps.store.settings, this.allocator.claimants());
    const key = planKey(plan);
    if (key === this.builtKey) return;
    const teams = JSON.stringify(plan.teams.map((t) => t && [t.sessionId, t.workerSlots]));
    const teamsChanged = teams !== this.builtTeams;
    if (!force && !teamsChanged && now - this.builtAt < REBUILD_COOLDOWN_MS) return;
    this.builtKey = key;
    this.builtTeams = teams;
    this.builtAt = now;
    this.office = generateOffice(plan);
    this.allocator.setOffice(this.office);
    this.pet.relocate();
    this.extras.relocate();
    this.visitors.relocate();
    this.bugs.relocate();
    this.seasonal.relocate();
    // Anyone now standing inside furniture or a wall steps out; everyone re-routes.
    for (const actor of this.actors.values()) {
      const t = actor.person.tile;
      if (!this.office.walkable[t.y]?.[t.x]) {
        const free = this.nearestWalkable(t);
        if (free) actor.person.placeAt(free);
      }
      actor.person.repath();
    }
    this.emit({ type: "office" });
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

  // --- where should each agent be? -----------------------------------------

  /** Icon on the left at a desk (keeps the monitor clear) or when someone stands to the right. */
  private fxOnLeft(actor: Actor): boolean {
    const p = actor.person;
    const pose = p.destination?.pose;
    const seated = p.arrived && (pose === "type" || pose === "think");
    const t = p.tile;
    const busy = (dx: number) =>
      [...this.actors.values()].some((o) => o !== actor && Math.abs(o.person.tile.x - (t.x + dx)) === 0 && Math.abs(o.person.tile.y - t.y) <= 1);
    if (seated) return !busy(-1);
    return busy(1) && !busy(-1);
  }

  private direct(actor: Actor, now: number): void {
    if (actor.person.arrived) actor.debounce.arrived(now);
    const dest = this.destinationFor(actor, now);
    if (dest) actor.person.goTo(dest);
  }

  private destinationFor(actor: Actor, now: number): Destination | undefined {
    const { agent, person } = actor;
    const wasLounging = person.destination?.pose === "lounge";
    let wanted = placeFor(agent.activity);
    // A manager whose sub-agents are still busy waits at its desk instead of going to the lounge.
    if (wanted.kind === "lounge" && !agent.parentId && this.hasBusyTeam(agent.id)) wanted = { kind: "seat", pose: "think" };
    const place = actor.debounce.decide(wanted, now);
    let spot: Spot | undefined;
    if (place.kind === "seat") {
      this.allocator.release(agent.id);
      spot = this.allocator.seatFor(agent);
    } else if (place.kind === "door") {
      this.allocator.release(agent.id);
      spot = { kind: "door", ...this.doorSpot(), facing: "left" };
    } else {
      spot = this.allocator.reserve(agent.id, place.kind, person.tile);
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
    const say = (a: Actor, kind: Utterance["kind"], text: string) => () => this.say(a.agent.id, text, kind);

    switch (u.kind) {
      case "delegate": {
        if (!other) return say(actor, u.kind, u.text)();
        // Parallel sub-agents start within milliseconds of each other. Collect them
        // briefly so a fan-out gets one kickoff meeting instead of several.
        let batch = this.delegations.get(actor.agent.id);
        if (!batch) {
          batch = { children: [], texts: [] };
          this.delegations.set(actor.agent.id, batch);
          this.clock.after(DELEGATION_BATCH_MS, () => {
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
        actor.person.play([
          { type: "goto", dest: () => this.besideActor(other, actor) },
          { type: "do", fn: say(actor, "report", u.text) },
          { type: "hold", ms: 1500 },
          {
            type: "do",
            fn: () => {
              actor.person.cheer(this.clock.now);
              other.person.cheer(this.clock.now);
              say(other, "message", "✋ High five!")();
            },
          },
          { type: "hold", ms: 1800 },
        ]);
        return;
      }
      case "message": {
        if (!other || other === actor) return say(actor, u.kind, u.text)();
        actor.person.play([
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
    this.say(parent.agent.id, brief, "delegate");
    if (!parent.person.busyWithScript) parent.person.play([{ type: "hold", ms: 1500 }]);
    for (const child of batch.children) {
      child.person.play([
        { type: "hold", ms: 300 },
        { type: "do", fn: () => this.say(child.agent.id, "On it!") },
        { type: "hold", ms: 1100 },
      ]);
    }
  }

  /** Every new `git commit` sends a robot with a crate from the agent's desk to the silo. */
  private shipCommits(actor: Actor, agent: AgentState): void {
    for (const call of agent.recentTools) {
      if (actor.seenCalls?.has(call.callId)) continue;
      (actor.seenCalls ??= new Set()).add(call.callId);
      if (!/\bgit commit\b/i.test(call.summary)) continue;
      const seat = this.allocator.seatFor(agent);
      const from = seat ? { x: seat.x * TILE + 8, y: (seat.y - 1) * TILE + 8 } : { x: actor.person.x, y: actor.person.y };
      this.drones.ship(from);
    }
  }

  /** A failed sub-agent: smoke, a sad bubble, and the medics come with a stretcher. */
  private collapse(actor: Actor, text: string): void {
    actor.carried = true;
    actor.person.play([]);
    this.emit({ type: "puff", x: actor.person.x, y: actor.person.y });
    this.say(actor.agent.id, `✗ ${text || "failed"}`);
    this.antics.gossip(`Poor ${actor.agent.name}, carried out on a stretcher`, "Gone too soon. 🪦");
    this.clock.after(900, () => {
      actor.person.lying = true;
      this.extras.medics(actor.person, () => this.despawn(actor.agent.id));
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
    actor.person.play([
      {
        type: "goto",
        dest: () => {
          const spot = this.allocator.reserve(actor.agent.id, "lounge", this.coffeeMachine() ?? actor.person.tile);
          return spot && { tile: spot, facing: "up", pose: "stand" };
        },
      },
      { type: "do", fn: () => this.say(actor.agent.id, `☕ ${reason.replace(/_/g, " ")}`) },
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
    const at = target.person.destination?.tile ?? target.person.tile;
    const tile = this.nearestOpenTile(at, visitor.person.tile);
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
      const d = a.person.destination?.tile ?? a.person.tile;
      if (d.x === t.x && d.y === t.y) return true;
    }
    return false;
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

/** What the office says after each kind of visitor leaves. */
const VISITOR_GOSSIP: Record<VisitorKind, [string, string]> = {
  ceo: ["Did Elon just say Mars again?", "Q3. Sure."],
  trump: ["Donald Trump says our code is the best.", "Tremendous. Everyone says so."],
  boss: ["The Big Boss came by. Somebody's getting docked.", "Not it."],
  consultant: ["Who let the consultant in?", "That chat cost us $2,000."],
  intern: ["Did anyone help the intern find the exit?", "He's in the silo."],
  auditor: ["The Auditor was here 😬", "Act natural."],
  investor: ["The Investor was here. Look busy next time.", "We ARE busy."],
  grandpa: ["Grandpa Cobol fell asleep on the sofa again", "Let him rest. He earned it."],
};

/**
 * The i-th session colour. Hues step by the golden angle, so consecutive
 * sessions land far apart on the colour wheel and never look alike.
 */
export function sessionColorAt(i: number): number {
  const hue = ((i * 137.508 + 18) % 360) / 360;
  const lightness = i % 2 ? 0.55 : 0.65;
  return hslToColor(hue, 0.85, lightness);
}

/** HSL (each 0–1) to a 0xRRGGBB number, rounding like Phaser's HSLToColor. */
function hslToColor(h: number, s: number, l: number): number {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.floor(hue(p, q, h + 1 / 3) * 255);
  const g = Math.floor(hue(p, q, h) * 255);
  const b = Math.floor(hue(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
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
