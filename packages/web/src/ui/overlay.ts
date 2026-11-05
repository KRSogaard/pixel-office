import type { Activity, AgentState, Utterance } from "@pixel-office/protocol";

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
  name: HTMLSpanElement;
  sub: HTMLSpanElement;
  icon: HTMLSpanElement;
  why: HTMLDivElement;
  bubble: HTMLDivElement;
  bubbleUntil: number;
}

export interface TagContext {
  /** Name of the agent this one works for (sub-agents only). */
  parentName?: string | undefined;
  /** The session's colour as 0xRRGGBB, shared by a main agent and its sub-agents. */
  sessionColor?: number | undefined;
}

export class Overlay {
  private tags = new Map<string, Tag>();
  private podLabels = new Map<number, HTMLDivElement>();
  privacy = false;

  constructor(private root: HTMLElement) {}

  ensure(agent: AgentState, ctx: TagContext, onClick: () => void): void {
    let tag = this.tags.get(agent.id);
    if (!tag) {
      const root = el("div", "tag");
      const stack = el("div", "tag-stack");
      const card = el("div", "tag-card");
      const line = el("div", "tag-line");
      const badge = el("span", `badge badge-${badgeClass(agent.source)}`);
      badge.textContent = agent.source === "claude" ? "C" : agent.source === "opencode" ? "O" : "•";
      badge.title = agent.source;
      const name = el("span", "tag-name");
      const sub = el("span", "tag-sub");
      const icon = el("span", "tag-icon");
      line.append(badge, name, sub, icon);
      const why = el("div", "tag-why");
      card.append(line, why);
      const bubble = el("div", "bubble");
      stack.append(bubble, card);
      root.append(stack);
      root.addEventListener("click", onClick);
      this.root.append(root);
      tag = { root, stack, card, name, sub, icon, why, bubble, bubbleUntil: 0 };
      this.tags.set(agent.id, tag);
    }
    tag.name.textContent = agent.name;
    tag.sub.textContent = agent.parentId ? `sub${agent.label ? ` · ${agent.label}` : ""}` : "";
    tag.sub.hidden = !agent.parentId;
    tag.icon.textContent = STATUS_ICON[agent.activity];
    const color = ctx.sessionColor === undefined ? "transparent" : hex(ctx.sessionColor);
    tag.card.style.setProperty("--session", color);
    tag.root.style.setProperty("--session-line", ctx.sessionColor === undefined ? "rgba(255,255,255,.55)" : color);

    const why = this.whyText(agent, ctx);
    tag.why.textContent = why;
    tag.why.hidden = !why || agent.status === "idle" || agent.status === "ended";
    tag.root.title = this.tooltip(agent, ctx);
    tag.root.classList.toggle("waiting", agent.status === "waiting");
    tag.root.classList.toggle("idle", agent.status === "idle");
  }

  /** The short "why" under the name: the sub-agent's task, or the prompt the agent is on. */
  private whyText(agent: AgentState, ctx: TagContext): string {
    const boss = agent.parentId ? `↳ ${ctx.parentName ?? "parent"}` : "";
    if (this.privacy) return boss;
    if (agent.status === "waiting" && agent.waiting?.text) return `needs you: ${agent.waiting.text}`;
    const reason = agent.parentId ? agent.task : agent.prompt;
    if (!reason) return boss;
    return boss ? `${boss}: ${reason}` : reason;
  }

  private tooltip(agent: AgentState, ctx: TagContext): string {
    const call = agent.openCalls[agent.openCalls.length - 1];
    const lines = [
      `${agent.name}${agent.label ? ` (${agent.label})` : ""} — ${agent.project.name}`,
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

  podLabel(index: number, project: string | undefined, p: ScreenPoint | undefined): void {
    let label = this.podLabels.get(index);
    if (!project || !p) {
      label?.remove();
      this.podLabels.delete(index);
      return;
    }
    if (!label) {
      label = el("div", "pod-label");
      this.root.append(label);
      this.podLabels.set(index, label);
    }
    label.textContent = project;
    label.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    label.style.setProperty("--zoom", String(p.scale));
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

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function badgeClass(source: string): string {
  return source === "claude" || source === "opencode" ? source : "other";
}

function iconOnly(kind: Utterance["kind"]): string {
  return kind === "report" ? "done" : kind === "delegate" ? "👥" : kind === "message" ? "💬" : "";
}
