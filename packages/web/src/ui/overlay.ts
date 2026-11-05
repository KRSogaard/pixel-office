import type { Activity, AgentState, TodoItem, Utterance } from "@pixel-office/protocol";

/**
 * DOM text over the canvas: name tags, status icons, speech bubbles, pod labels.
 * DOM text stays crisp at any zoom, which canvas text at pixel scale doesn't.
 */

const STATUS_ICON: Record<Activity, string> = {
  thinking: "…",
  edit: "⌨",
  other: "⚙",
  read: "📖",
  shell: ">_",
  test: "🧪",
  git: "⎇",
  web: "🌐",
  mcp: "✉",
  delegate: "👥",
  message: "💬",
  compact: "🗄",
  waiting: "!",
  idle: "z",
  ended: "👋",
};

const BUBBLE_PREFIX: Record<Utterance["kind"], string> = {
  prompt: "☎ ",
  delegate: "",
  report: "✓ ",
  message: "",
  question: "? ",
  permission: "! ",
};

export interface ScreenPoint {
  x: number;
  y: number;
  /** Pixels per world pixel, so tags can scale with zoom. */
  scale: number;
}

interface Tag {
  root: HTMLDivElement;
  /** Name line + "why" line; its size is what de-cluttering measures. */
  stack: HTMLDivElement;
  card: HTMLDivElement;
  person: HTMLSpanElement;
  name: HTMLSpanElement;
  sub: HTMLSpanElement;
  icon: HTMLSpanElement;
  why: HTMLDivElement;
  project: HTMLElement;
  reason: HTMLSpanElement;
  bubble: HTMLDivElement;
  bubbleUntil: number;
  /** While crowded, the "why" line is hidden so tags fit; kept a moment to avoid flicker. */
  crowdedUntil: number;
}

export interface TagContext {
  /** Name of the agent this one works for (sub-agents only). */
  parentName?: string | undefined;
  /** The session's colour as 0xRRGGBB, shared by a main agent and its sub-agents. */
  sessionColor?: number | undefined;
}

export class Overlay {
  private tags = new Map<string, Tag>();
  private teamLabels = new Map<string, HTMLDivElement>();
  private boards = new Map<string, HTMLDivElement>();
  private signs = new Map<string, HTMLDivElement>();
  /** The whiteboard whose full todo list is open, if any. */
  private openBoard: string | undefined;
  private popup: HTMLDivElement | undefined;
  private popupKey = "";
  privacy = false;

  constructor(private root: HTMLElement) {}

  ensure(agent: AgentState, ctx: TagContext, onClick: () => void): void {
    let tag = this.tags.get(agent.id);
    if (!tag) {
      const root = el("div", "tag");
      const stack = el("div", "tag-stack");
      const card = el("div", "tag-card");
      const line = el("div", "tag-line");
      const person = el("span", "tag-person");
      const name = el("span", "tag-name");
      const sub = el("span", "tag-sub");
      const icon = el("span", "tag-icon");
      line.append(person, name, sub, icon);
      const why = el("div", "tag-why");
      const project = el("b", "tag-project");
      const reason = el("span", "tag-reason");
      why.append(project, reason);
      card.append(line, why);
      const bubble = el("div", "bubble");
      stack.append(bubble, card);
      root.append(stack);
      root.addEventListener("click", onClick);
      this.root.append(root);
      tag = { root, stack, card, person, name, sub, icon, why, project, reason, bubble, bubbleUntil: 0, crowdedUntil: 0 };
      this.tags.set(agent.id, tag);
    }
    // Whose agent: a chip in that person's own colour (visitors get a ★).
    const who = agent.source === "visitor" ? "★" : agent.user ?? "";
    tag.person.textContent = who;
    tag.person.hidden = !who;
    tag.person.style.setProperty("--person", agent.source === "visitor" ? "#c77dff" : personColor(agent.user ?? ""));
    tag.name.textContent = agent.name;
    tag.sub.textContent = agent.parentId ? `sub${agent.label ? ` · ${agent.label}` : ""}` : "";
    tag.sub.hidden = !agent.parentId;
    tag.icon.textContent = agent.source === "visitor" ? "" : STATUS_ICON[agent.activity];
    const color = ctx.sessionColor === undefined ? "transparent" : hex(ctx.sessionColor);
    tag.card.style.setProperty("--session", color);
    tag.root.style.setProperty("--session-line", ctx.sessionColor === undefined ? "rgba(255,255,255,.55)" : color);

    // Second line: the project first, then why it's working.
    const visitor = agent.source === "visitor";
    const why = visitor ? "" : this.whyText(agent, ctx);
    tag.project.textContent = visitor ? "" : agent.project.name;
    tag.reason.textContent = why ? ` · ${why}` : "";
    tag.why.hidden = visitor || agent.status === "ended";
    tag.why.classList.toggle("quiet", agent.status === "idle");
    tag.root.title = this.tooltip(agent, ctx);
    tag.root.classList.toggle("waiting", agent.status === "waiting");
    tag.root.classList.toggle("idle", agent.status === "idle");
  }

  /** The short "why" under the name: the sub-agent's task, or the prompt the agent is on. */
  private whyText(agent: AgentState, ctx: TagContext): string {
    const manager = agent.parentId ? `↳ ${ctx.parentName ?? "parent"}` : "";
    if (this.privacy) return manager;
    if (agent.status === "waiting" && agent.waiting?.text) return `needs you: ${agent.waiting.text}`;
    const reason = agent.parentId ? agent.task : agent.prompt;
    if (!reason) return manager;
    return manager ? `${manager}: ${reason}` : reason;
  }

  private tooltip(agent: AgentState, ctx: TagContext): string {
    const call = agent.openCalls[agent.openCalls.length - 1];
    const lines = [
      `${agent.name}${agent.label ? ` (${agent.label})` : ""} — ${agent.project.name}${agent.user ? ` · ${agent.user}'s agent` : ""}`,
      agent.source === "claude" ? "Claude Code" : agent.source === "opencode" ? "OpenCode" : "",
      agent.parentId ? `Sub-agent of ${ctx.parentName ?? agent.parentId}` : "",
      call ? `Now: ${this.privacy ? call.tool : call.summary}` : `Now: ${agent.activity}`,
    ];
    if (!this.privacy) {
      if (agent.parentId && (agent.taskBrief || agent.task)) lines.push(`Task: ${agent.taskBrief ?? agent.task}`);
      else if (agent.prompt) lines.push(`Prompt: ${agent.prompt}`);
    }
    return lines.filter(Boolean).join("\n");
  }

  say(agentId: string, u: Pick<Utterance, "kind" | "text">, now: number): void {
    const tag = this.tags.get(agentId);
    if (!tag) return;
    const text = this.privacy ? "" : u.text;
    const shown = text.length > 90 ? `${text.slice(0, 89)}…` : text;
    tag.bubble.textContent = BUBBLE_PREFIX[u.kind] + (shown || iconOnly(u.kind));
    tag.bubble.className = `bubble show bubble-${u.kind}`;
    tag.bubbleUntil = now + Math.min(7000, 2500 + text.length * 45);
  }

  select(agentId: string | undefined): void {
    for (const [id, tag] of this.tags) tag.root.classList.toggle("selected", id === agentId);
  }

  /**
   * Position every tag for this frame. Tags that would overlap a neighbour are
   * nudged upward so names stay readable when agents stand side by side.
   */
  placeAll(points: Map<string, ScreenPoint>, now: number): void {
    const placed: { x: number; top: number; bottom: number; w: number }[] = [];
    // Lowest agents first: they keep their spot, the ones above make way upward.
    const ordered = [...points.entries()].sort((a, b) => b[1].y - a[1].y);
    for (const [id, p] of ordered) {
      const tag = this.tags.get(id);
      if (!tag) continue;
      if (tag.bubbleUntil && now > tag.bubbleUntil) {
        tag.bubble.classList.remove("show");
        tag.bubbleUntil = 0;
      }
      // Measure the whole stack (bubble + card) so bubbles don't pile up either.
      const w = Math.max(tag.card.offsetWidth, tag.bubble.offsetWidth) || 60;
      const h = tag.stack.offsetHeight || 14;
      let bottom = p.y;
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((r) => Math.abs(r.x - p.x) < (r.w + w) / 2 + 2 && bottom > r.top && bottom - h < r.bottom);
        if (!hit) break;
        bottom = hit.top - 2;
      }
      // Never push a tag off the top of the screen; overlapping beats unreadable.
      bottom = Math.max(bottom, h + 4);
      placed.push({ x: p.x, top: bottom - h, bottom, w });
      const lift = Math.max(0, Math.round(p.y - bottom));
      // Crowded (e.g. a kickoff huddle): drop to name-only tags for a while.
      if (lift > 3) tag.crowdedUntil = now + 2500;
      tag.root.classList.toggle("crowded", now < tag.crowdedUntil);
      tag.root.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      tag.root.style.setProperty("--zoom", String(p.scale));
      tag.root.style.setProperty("--lift", `${lift}px`);
      tag.root.classList.toggle("lifted", lift > 3);
    }
  }

  remove(agentId: string): void {
    this.tags.get(agentId)?.root.remove();
    this.tags.delete(agentId);
  }

  /** A label above a team area: "project · Manager", with the session colour. */
  teamLabel(key: string, text: string, color: number, p: ScreenPoint): void {
    let label = this.teamLabels.get(key);
    if (!label) {
      label = el("div", "team-label");
      this.root.append(label);
      this.teamLabels.set(key, label);
    }
    label.textContent = text;
    label.style.setProperty("--session", hex(color));
    label.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    label.style.setProperty("--zoom", String(p.scale));
  }

  /**
   * The team whiteboard: progress through the manager's todo list and what's
   * being worked on now. Hover for the whole list.
   */
  whiteboard(key: string, title: string, todos: TodoItem[] | undefined, color: number, p: ScreenPoint): void {
    let board = this.boards.get(key);
    if (!todos?.length) {
      board?.remove();
      this.boards.delete(key);
      if (this.openBoard === key) this.closeBoard();
      return;
    }
    if (!board) {
      board = el("div", "board");
      board.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.openBoard === key) this.closeBoard();
        else {
          this.openBoard = key;
          this.popupKey = "";
        }
      });
      this.root.append(board);
      this.boards.set(key, board);
    }
    const done = todos.filter((t) => t.status === "completed").length;
    const now = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending");
    board.replaceChildren(
      Object.assign(el("div", "board-head"), { textContent: `☑ ${done}/${todos.length}` }),
      el("div", "board-bar"),
      ...(now && !this.privacy ? [Object.assign(el("div", "board-now"), { textContent: `${mark(now)} ${now.text}` })] : []),
    );
    (board.children[1] as HTMLElement).style.setProperty("--done", `${Math.round((done / todos.length) * 100)}%`);
    board.title = "Click to see the whole list";
    board.classList.toggle("open", this.openBoard === key);
    board.style.setProperty("--session", hex(color));
    board.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    board.style.setProperty("--zoom", String(p.scale));
    if (this.openBoard === key) this.renderPopup(title, todos, color, p);
  }

  /** The full todo list for the clicked whiteboard, pinned under it. */
  private renderPopup(title: string, todos: TodoItem[], color: number, p: ScreenPoint): void {
    if (!this.popup) {
      this.popup = el("div", "board-popup");
      this.popup.addEventListener("click", (ev) => ev.stopPropagation());
      this.root.append(this.popup);
      // Clicking anywhere else closes it.
      document.addEventListener("pointerdown", (ev) => {
        if (this.popup && !this.popup.contains(ev.target as Node) && !(ev.target as HTMLElement).closest?.(".board")) this.closeBoard();
      });
    }
    const key = JSON.stringify([title, todos, this.privacy]);
    if (key !== this.popupKey) {
      this.popupKey = key;
      const done = todos.filter((t) => t.status === "completed").length;
      const close = Object.assign(el("button", "board-popup-close"), { textContent: "×", title: "Close" });
      close.onclick = () => this.closeBoard();
      const list = el("ol", "board-popup-list");
      for (const t of todos) {
        const li = el("li", `todo ${t.status}`);
        li.append(
          Object.assign(el("span", "todo-mark"), { textContent: mark(t) }),
          Object.assign(el("span", "todo-text"), { textContent: this.privacy ? (t.status === "completed" ? "done" : "…") : t.text }),
        );
        list.append(li);
      }
      const head = el("div", "board-popup-head");
      head.append(Object.assign(el("b", ""), { textContent: title }), Object.assign(el("span", "muted"), { textContent: ` ${done}/${todos.length} done` }), close);
      this.popup.replaceChildren(head, list);
    }
    this.popup.style.setProperty("--session", hex(color));
    this.popup.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    this.popup.classList.add("show");
  }

  private closeBoard(): void {
    this.openBoard = undefined;
    this.popup?.classList.remove("show");
    for (const b of this.boards.values()) b.classList.remove("open");
  }

  /** A sign over a room's door, e.g. "Test lab · ✓ pass". */
  roomSign(key: string, text: string, tone: "plain" | "running" | "pass" | "fail", p: ScreenPoint): void {
    let sign = this.signs.get(key);
    if (!sign) {
      sign = el("div", "room-sign");
      this.root.append(sign);
      this.signs.set(key, sign);
    }
    if (sign.textContent !== text) sign.textContent = text;
    sign.className = `room-sign ${tone}`;
    sign.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    sign.style.setProperty("--zoom", String(p.scale));
  }

  pruneRoomSigns(keep: Set<string>): void {
    for (const [key, node] of this.signs) {
      if (keep.has(key)) continue;
      node.remove();
      this.signs.delete(key);
    }
  }

  /** Remove labels and boards for teams that are no longer in the office. */
  pruneTeamLabels(keep: Set<string>): void {
    for (const map of [this.teamLabels, this.boards]) {
      for (const [key, node] of map) {
        if (keep.has(key)) continue;
        node.remove();
        map.delete(key);
      }
    }
  }

  refreshPrivacy(): void {
    for (const tag of this.tags.values()) if (this.privacy) tag.bubble.classList.remove("show");
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function mark(t: TodoItem): string {
  return t.status === "completed" ? "☑" : t.status === "in_progress" ? "◐" : "☐";
}

/** A stable, readable colour per person (same name → same colour in every browser). */
export function personColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 68%)`;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}


function iconOnly(kind: Utterance["kind"]): string {
  return kind === "report" ? "done" : kind === "delegate" ? "👥" : kind === "message" ? "💬" : "";
}
