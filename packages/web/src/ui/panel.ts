import type { AgentState, OfficeState } from "@pixel-office/protocol";

/** Side panel with details for the selected agent. */
export class Panel {
  private agentId: string | undefined;
  privacy = false;

  constructor(
    private root: HTMLElement,
    private onClose: () => void,
  ) {}

  show(agentId: string | undefined, state: OfficeState): void {
    this.agentId = agentId;
    this.render(state);
  }

  render(state: OfficeState): void {
    const a = this.agentId ? state.agents[this.agentId] : undefined;
    this.root.classList.toggle("open", !!a);
    if (!a) {
      this.root.replaceChildren();
      return;
    }
    const parent = a.parentId ? state.agents[a.parentId] : undefined;
    const children = Object.values(state.agents).filter((x) => x.parentId === a.id);
    const now = Date.now();

    const close = button("×", "panel-close", this.onClose);
    const head = div("panel-head", [
      div("panel-title", [text(a.name), span(`badge badge-${badge(a.source)}`, a.source)]),
      close,
    ]);
    const rows: [string, Node | string][] = [
      ...(a.user ? [["Person", a.user] as [string, string]] : []),
      ["Project", a.project.name],
      ["Path", a.project.path],
      ["Status", `${a.status} · ${a.activity}`],
      ["Working for", duration(now - a.startedAt)],
      ["Last seen", `${duration(now - a.lastEventAt)} ago`],
    ];
    if (a.label) rows.push(["Role", a.label]);
    const call = a.openCalls[a.openCalls.length - 1];
    rows.push(["Doing now", call ? (this.privacy ? call.tool : call.summary) : a.activity]);
    if (a.context) {
      const pct = Math.round((a.context.tokens / a.context.limit) * 100);
      const bar = div("ctx", [span("ctx-fill", "")]);
      (bar.firstChild as HTMLElement).style.width = `${Math.min(100, pct)}%`;
      bar.classList.toggle("warn", pct > 60);
      bar.classList.toggle("hot", pct > 85);
      rows.push(["Context", div("ctx-row", [bar, span("muted", `${pct}% · ${Math.round(a.context.tokens / 1000)}k / ${Math.round(a.context.limit / 1000)}k`)])]);
    }
    if (a.waiting) rows.push(["Waiting on you", this.privacy ? a.waiting.reason : a.waiting.text ?? a.waiting.reason]);
    if (parent) rows.push(["Reports to", link(parent, () => this.show(parent.id, state))]);
    if (children.length)
      rows.push(["Team", div("links", children.map((c) => link(c, () => this.show(c.id, state))))]);

    const facts = div(
      "facts",
      rows.map(([k, v]) => div("fact", [span("fact-k", k), typeof v === "string" ? span("fact-v", v) : v])),
    );

    // "Why": a sub-agent's brief from its parent, or the prompt a main agent is on.
    const why = a.parentId ? (a.taskBrief ?? a.task) : a.prompt;
    const whyTitle = a.parentId ? `Task from ${parent?.name ?? "its parent"}` : "Working on";
    const prompt = why && !this.privacy ? div("panel-section", [span("section-title", whyTitle), div("prompt", [text(why)])]) : null;

    const tools = div(
      "tools",
      [...a.recentTools].reverse().map((t) =>
        div(`tool ${t.endedAt === undefined ? "running" : t.ok === false ? "failed" : "ok"}`, [
          span("tool-dot", ""),
          span("tool-summary", this.privacy ? t.tool : t.summary),
          span("tool-time", t.endedAt ? `${((t.endedAt - t.startedAt) / 1000).toFixed(1)}s` : "…"),
        ]),
      ),
    );

    const todos =
      a.todos?.length && !this.privacy
        ? div("panel-section", [
            span("section-title", `Todo · ${a.todos.filter((t) => t.status === "completed").length}/${a.todos.length} done`),
            div(
              "todos",
              a.todos.map((t) =>
                div(`todo ${t.status}`, [span("todo-mark", t.status === "completed" ? "☑" : t.status === "in_progress" ? "◐" : "☐"), span("todo-text", t.text)]),
              ),
            ),
          ])
        : null;

    this.root.replaceChildren(
      head,
      facts,
      ...(prompt ? [prompt] : []),
      ...(todos ? [todos] : []),
      div("panel-section", [span("section-title", "Recent tools"), a.recentTools.length ? tools : span("muted", "none yet")]),
    );
  }
}

function badge(source: string) {
  return source === "claude" || source === "opencode" ? source : "other";
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function text(s: string) {
  return document.createTextNode(s);
}
function span(cls: string, s: string) {
  const e = document.createElement("span");
  e.className = cls;
  e.textContent = s;
  return e;
}
function div(cls: string, kids: Node[]) {
  const e = document.createElement("div");
  e.className = cls;
  e.append(...kids);
  return e;
}
function button(label: string, cls: string, onClick: () => void) {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}
function link(a: AgentState, onClick: () => void) {
  const b = button(a.label ? `${a.name} (${a.label})` : a.name, "agent-link", onClick);
  return b;
}
