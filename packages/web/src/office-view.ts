import { isTestRun, type AgentState } from "@pixel-office/protocol";
import { TILE } from "./office/layout.js";
import type { Point } from "./office/pathfind.js";
import type { OfficeStore } from "./net.js";
import type { Renderer, Sign } from "./render/renderer.js";
import type { StatsBoard } from "./ui/board.js";
import type { Overlay, ScreenPoint } from "./ui/overlay.js";
import type { Sfx } from "./ui/sounds.js";
import { World } from "./world/world.js";

export interface OfficeViewDeps {
  store: OfficeStore;
  overlay: Overlay;
  sfx: Sfx;
  board: StatsBoard;
  onSelect: (agentId: string | undefined) => void;
}

/** How high above the feet a person's name tag floats (world pixels). */
const TAG_LIFT = 27;
/** …and for someone lying on a stretcher. */
const TAG_LIFT_LYING = 14;
/** …and over a job robot (they're small). */
const TAG_LIFT_BOT = 16;

/**
 * The office on screen: the world (what happens), a renderer (how it looks)
 * and the HTML layer on top (name tags, speech bubbles, team labels, room
 * signs). Runs them in step: every frame the world moves on, the renderer
 * draws it, and the tags follow the people.
 */
export class OfficeView {
  readonly world: World;
  private shownVisitors = new Set<string>();

  constructor(
    private renderer: Renderer,
    private deps: OfficeViewDeps,
  ) {
    this.world = new World({ store: deps.store, speech: deps.overlay, sfx: deps.sfx, onSelect: deps.onSelect, cast: renderer.visitors });
  }

  start(parent: HTMLElement): void {
    this.renderer.start(
      parent,
      this.world,
      {
        pick: (id) => this.deps.onSelect(id),
        board: (sessionId) => this.deps.overlay.showBoard(sessionId),
      },
      (dt, now) => {
        this.world.update(dt, now);
        this.label(now);
      },
    );
  }

  select(agentId: string | undefined): void {
    this.world.select(agentId);
  }

  /** The colour of a session, for UI outside the office (list view). */
  colorOf(sessionId: string): number {
    return this.world.colorOf(sessionId);
  }

  /** Forget everyone on screen and start over from the current state (replay jumped in time). */
  reset(): void {
    this.world.reset();
  }

  fit(): void {
    this.renderer.fit();
  }

  zoomBy(factor: number): void {
    this.renderer.zoomBy(factor);
  }

  /** The stage changed size. */
  resize(): void {
    this.renderer.resize();
  }

  debug(): ReturnType<World["debug"]> {
    return this.world.debug();
  }

  // --- the HTML layer ---------------------------------------------------------

  private at(x: number, y: number, lift = 0): ScreenPoint {
    return this.renderer.toScreen(x, y, lift);
  }

  private label(now: number): void {
    const w = this.world;
    const { overlay } = this.deps;
    const points = new Map<string, ScreenPoint>();
    for (const [id, a] of w.actors) points.set(id, this.at(a.person.x, a.person.y, a.carried ? TAG_LIFT_LYING : TAG_LIFT));

    // Visitors get a name tag like an agent's.
    const visiting = new Set<string>();
    for (const v of w.visitors.list) {
      visiting.add(v.id);
      if (!this.shownVisitors.has(v.id)) overlay.ensure(visitorRecord(v.id, v.name), {}, () => {});
      points.set(v.id, this.at(v.person.x, v.person.y, TAG_LIFT));
    }
    // Job robots: what the job is and how long it's been going.
    for (const b of w.bots.list) {
      visiting.add(b.id);
      const owner = w.actors.get(b.agentId)?.agent;
      const what = b.job.label ?? b.job.summary.replace(/^\w+: /, "");
      const ran = b.result === undefined ? ` · ${elapsed(Date.now() - b.job.startedAt)}` : "";
      overlay.ensure({ ...visitorRecord(b.id, `🤖 ${what}${ran}`), ...(owner?.user ? { user: owner.user } : {}) }, { sessionColor: w.colorOf(b.sessionId) }, () => this.deps.onSelect(b.agentId));
      points.set(b.id, this.at(b.person.x, b.person.y, TAG_LIFT_BOT));
    }
    for (const id of this.shownVisitors) if (!visiting.has(id)) overlay.remove(id);
    this.shownVisitors = visiting;

    overlay.placeAll(points, now);
    this.labelTeams();
    this.signRooms();
    this.deps.board.render(this.deps.store.stats, w.bugs.count);
  }

  /** Each team office's name plate (drawn by the renderer), and its whiteboard with the manager's todo list. */
  private labelTeams(): void {
    const { overlay, store } = this.deps;
    const office = this.world.office;
    const state = store.state;
    const signs: Sign[] = [];
    for (const t of office.teams) {
      const manager = Object.values(state.agents).find((a) => a.sessionId === t.sessionId && !a.parentId);
      const color = this.world.colorOf(t.sessionId);
      const who = [manager?.name, manager?.user, manager?.branch && `⎇ ${manager.branch}`].filter(Boolean).join(" · ");
      signs.push({ key: t.sessionId, ...t.sign, title: t.project, subtitle: who, color });
      overlay.whiteboard(t.sessionId, manager ? `${manager.name} · ${t.project}` : t.project, manager?.todos, color, this.at(...whiteboardCorner(t.whiteboard)));
    }
    this.renderer.signs(signs);
    overlay.pruneBoards(new Set(office.teams.map((t) => t.sessionId)));
  }

  /** Name signs over the top rooms; the test lab's shows the latest test result in the office. */
  private signRooms(): void {
    const names = { web: "Internet room", server: "Server room", cafe: "Café", lab: "Test lab", git: "Git room", mail: "Mailroom" } as const;
    const silo = this.world.silo;
    const keep = new Set<string>();
    for (const r of this.world.office.rooms) {
      keep.add(r.kind);
      let text: string = names[r.kind];
      let tone: "plain" | "running" | "pass" | "fail" = "plain";
      if (r.kind === "lab") {
        const result = this.latestTestResult();
        tone = result.tone;
        if (result.text) text += ` · ${result.text}`;
      }
      if (r.kind === "git" && silo.launches) {
        text += ` · 🚀 ×${silo.launches}`;
        if (Date.now() - silo.lastLaunchAt < 8000) tone = "pass";
      }
      this.deps.overlay.roomSign(r.kind, text, tone, this.at((r.x + r.w / 2) * TILE, (r.y + r.h) * TILE + 9));
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
}

/** The bottom middle of a whiteboard (two tiles wide), where its todo badge sits. */
function whiteboardCorner(wb: Point): [number, number] {
  return [(wb.x + 1) * TILE, (wb.y + 1) * TILE];
}

/** "42s", "12m", "1h05". */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** A visitor as an agent-shaped record, so it gets a regular name tag. */
function visitorRecord(id: string, name: string): AgentState {
  return {
    id,
    source: "visitor",
    sessionId: id,
    name,
    project: { path: "", name: "visitor" },
    status: "working",
    activity: "message",
    activitySince: 0,
    openCalls: [],
    recentTools: [],
    pendingDelegations: [],
    startedAt: 0,
    lastEventAt: 0,
  };
}
