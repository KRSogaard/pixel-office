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
  line: HTMLDivElement;
  name: HTMLSpanElement;
  icon: HTMLSpanElement;
  bubble: HTMLDivElement;
  bubbleUntil: number;
}

export class Overlay {
  private tags = new Map<string, Tag>();
  private podLabels = new Map<number, HTMLDivElement>();
  privacy = false;

  constructor(private root: HTMLElement) {}

  ensure(agent: AgentState, onClick: () => void): void {
    let tag = this.tags.get(agent.id);
    if (!tag) {
      const root = el("div", "tag");
      const line = el("div", "tag-line");
      const badge = el("span", `badge badge-${badgeClass(agent.source)}`);
      badge.textContent = agent.source === "claude" ? "C" : agent.source === "opencode" ? "O" : "•";
      badge.title = agent.source;
      const name = el("span", "tag-name");
      const icon = el("span", "tag-icon");
      line.append(badge, name, icon);
      const bubble = el("div", "bubble");
      root.append(bubble, line);
      root.addEventListener("click", onClick);
      this.root.append(root);
      tag = { root, line, name, icon, bubble, bubbleUntil: 0 };
      this.tags.set(agent.id, tag);
    }
    tag.name.textContent = agent.label && agent.parentId ? `${agent.name} · ${agent.label}` : agent.name;
    tag.icon.textContent = STATUS_ICON[agent.activity];
    tag.root.classList.toggle("waiting", agent.status === "waiting");
    tag.root.classList.toggle("idle", agent.status === "idle");
  }

  say(agentId: string, u: Pick<Utterance, "kind" | "text">, now: number): void {
    const tag = this.tags.get(agentId);
    if (!tag) return;
    const text = this.privacy ? "" : u.text;
    tag.bubble.textContent = BUBBLE_PREFIX[u.kind] + (text || iconOnly(u.kind));
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
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...points.entries()].sort((a, b) => b[1].y - a[1].y);
    for (const [id, p] of ordered) {
      const tag = this.tags.get(id);
      if (!tag) continue;
      const w = tag.line.offsetWidth || 60;
      const h = tag.line.offsetHeight || 14;
      let y = p.y;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((r) => Math.abs(r.x - p.x) < (r.w + w) / 2 && Math.abs(r.y - y) < h);
        if (!hit) break;
        y = hit.y - h - 1;
      }
      placed.push({ x: p.x, y, w, h });
      tag.root.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px)`;
      tag.root.style.setProperty("--zoom", String(p.scale));
      if (tag.bubbleUntil && now > tag.bubbleUntil) {
        tag.bubble.classList.remove("show");
        tag.bubbleUntil = 0;
      }
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

function badgeClass(source: string): string {
  return source === "claude" || source === "opencode" ? source : "other";
}

function iconOnly(kind: Utterance["kind"]): string {
  return kind === "report" ? "done" : kind === "delegate" ? "👥" : kind === "message" ? "💬" : "";
}
