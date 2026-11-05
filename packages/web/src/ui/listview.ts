import type { AgentState, OfficeState } from "@pixel-office/protocol";

/**
 * The office as a table: one row per agent, grouped by session (manager first,
 * then its sub-agents), sessions that need you first. Handy on a phone or when
 * the office gets crowded. Click a row to open that agent's details.
 */
export class ListView {
  private lastRender = 0;
  privacy = false;

  constructor(
    private root: HTMLElement,
    private onSelect: (agentId: string) => void,
    private colorOf: (sessionId: string) => number,
  ) {}

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  toggle(state: OfficeState): void {
    this.root.classList.toggle("open");
    if (this.isOpen) this.render(state, true);
  }

  render(state: OfficeState, force = false): void {
    if (!this.isOpen) return;
    const now = Date.now();
    if (!force && now - this.lastRender < 500) return;
    this.lastRender = now;

    const agents = Object.values(state.agents).filter((a) => a.status !== "ended");
    const sessions = new Map<string, AgentState[]>();
    for (const a of agents) sessions.set(a.sessionId, [...(sessions.get(a.sessionId) ?? []), a]);
    const rank = (list: AgentState[]) => (list.some((a) => a.status === "waiting") ? 0 : list.some((a) => a.status === "working") ? 1 : 2);
    const groups = [...sessions.values()]
      .map((list) => list.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || a.startedAt - b.startedAt))
      .sort((a, b) => rank(a) - rank(b) || a[0]!.startedAt - b[0]!.startedAt);

    const rows = groups.flat().map((a) => this.row(a, state, now)).join("");
    this.root.innerHTML = `
      <table class="list">
        <thead><tr><th></th><th>Agent</th><th>Person</th><th>Project</th><th>Status</th><th>Doing now</th><th>Why</th><th>Context</th><th>Todo</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="muted">Nobody in the office yet.</td></tr>`}</tbody>
      </table>`;
    this.root.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((tr) => {
      tr.onclick = () => this.onSelect(tr.dataset.id!);
    });
  }

  private row(a: AgentState, state: OfficeState, now: number): string {
    const color = `#${this.colorOf(a.sessionId).toString(16).padStart(6, "0")}`;
    const call = a.openCalls[a.openCalls.length - 1];
    const parent = a.parentId ? state.agents[a.parentId] : undefined;
    const why = this.privacy ? "" : a.parentId ? `↳ ${parent?.name ?? "parent"}: ${a.task ?? ""}` : a.waiting?.text ?? a.prompt ?? "";
    const doing = call ? `${esc(this.privacy ? call.tool : call.summary)} <span class="muted">${ago(now - call.startedAt)}</span>` : a.activity;
    const ctx = a.context ? `${Math.round((a.context.tokens / a.context.limit) * 100)}%` : "";
    const todo = a.todos?.length ? `${a.todos.filter((t) => t.status === "completed").length}/${a.todos.length}` : "";
    const stuck = call && now - call.startedAt > STUCK_MS ? ` <span title="On this call for a long time">🔥</span>` : "";
    return `
      <tr data-id="${esc(a.id)}" class="${a.status}${a.parentId ? " sub" : ""}">
        <td><span class="dot" style="background:${color}"></span></td>
        <td>${a.parentId ? "↳ " : ""}<b>${esc(a.name)}</b>${a.label && a.parentId ? ` <span class="muted">${esc(a.label)}</span>` : ""}</td>
        <td>${a.user ? esc(a.user) : '<span class="muted">–</span>'}</td>
        <td>${esc(a.project.name)}${a.branch ? ` <span class="muted">⎇ ${esc(a.branch)}</span>` : ""}</td>
        <td class="st">${a.status}</td>
        <td>${doing}${stuck}</td>
        <td class="why">${esc(why)}</td>
        <td>${ctx}</td>
        <td>${todo}</td>
      </tr>`;
  }
}

/** An open tool call older than this counts as stuck (flame over the head). */
export const STUCK_MS = 10 * 60_000;

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
