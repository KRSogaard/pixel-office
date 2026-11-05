import { ACHIEVEMENTS, type OfficeStats } from "@pixel-office/protocol";

/**
 * The production board, Factorio-style, in a sidebar next to the office: today's
 * launches, commits, test runs and pass rate, edits, bugs loose, prompts, a
 * sparkline of tool calls per hour, the all-time numbers and the trophy cabinet.
 * The 📊 button shows or hides it.
 */
export class StatsBoard {
  private key = "";

  constructor(
    private root: HTMLElement,
    /** Called after the sidebar opens or closes, so the office can re-fit. */
    private onToggle: () => void,
  ) {
    root.classList.toggle("open", localStorage.getItem("po.sidebar") !== "0");
  }

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  toggle(): void {
    this.root.classList.toggle("open");
    localStorage.setItem("po.sidebar", this.isOpen ? "1" : "0");
    this.key = "";
    this.onToggle();
  }

  render(stats: OfficeStats | undefined, bugs: number): void {
    if (!this.isOpen) return;
    const key = JSON.stringify([stats, bugs]);
    if (key === this.key) return;
    this.key = key;
    if (!stats) {
      this.root.innerHTML = `<div class="sb-head">PRODUCTION</div><p class="muted">Waiting for the server…</p>`;
      return;
    }

    const t = stats.today;
    const pass = t.testRuns ? `${Math.round((t.testPasses / t.testRuns) * 100)}%` : "–";
    const rows: [string, string, string][] = [
      ["🚀", "launches", String(t.launches)],
      ["📦", "commits", String(t.commits)],
      ["🧪", "tests", `${t.testPasses}/${t.testRuns} · ${pass}`],
      ["✏", "edits", String(t.edits)],
      ["🐛", "bugs loose", String(bugs)],
      ["🔥", "lab fires", String(t.fires)],
      ["💬", "prompts", String(t.prompts)],
      ["👥", "peak working", String(t.peakWorking)],
    ];
    const max = Math.max(1, ...stats.hourly);
    const spark = stats.hourly
      .map((v, h) => `<i style="height:${Math.max(1, Math.round((v / max) * 28))}px" title="${h}:00 — ${v} tool calls"></i>`)
      .join("");
    const a = stats.allTime;
    const unlocked = new Map(stats.achievements.map((x) => [x.id, x.at]));
    this.root.innerHTML = `
      <div class="sb-head">PRODUCTION · today</div>
      <div class="sb-rows">${rows.map(([i, l, v]) => `<span>${i}</span><span>${l}</span><b>${v}</b>`).join("")}</div>
      <div class="sb-sub">Tool calls per hour</div>
      <div class="sb-spark">${spark}</div>
      <div class="sb-hours"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <div class="sb-sub">All time · since ${new Date(a.since).toLocaleDateString()}</div>
      <div class="sb-rows">
        <span>🚀</span><span>launches</span><b>${a.launches}</b>
        <span>📦</span><span>commits</span><b>${a.commits}</b>
        <span>🧪</span><span>tests passed</span><b>${a.testPasses}/${a.testRuns}</b>
        <span>✏</span><span>edits</span><b>${a.edits}</b>
        <span>🔥</span><span>lab fires</span><b>${a.fires}</b>
        <span>😱</span><span>scary commands</span><b>${a.scary}</b>
      </div>
      <div class="sb-sub">Trophy cabinet · ${unlocked.size}/${ACHIEVEMENTS.length}</div>
      <div class="sb-trophies">${ACHIEVEMENTS.map((x) => {
        const at = unlocked.get(x.id);
        const when = at ? ` — won ${new Date(at).toLocaleDateString()}` : " — locked";
        return `<div class="${at ? "won" : ""}" title="${x.desc}${when}"><span>${x.icon}</span><span>${x.title}</span></div>`;
      }).join("")}</div>`;
  }
}

/** "🏆 Achievement unlocked" banners for achievements this browser hasn't seen. */
export class AchievementToasts {
  private seen: Set<string>;
  private primed = false;

  constructor(
    private root: HTMLElement,
    private onUnlock: () => void,
  ) {
    this.seen = new Set(JSON.parse(localStorage.getItem("po.trophies") ?? "[]") as string[]);
  }

  observe(stats: OfficeStats): void {
    const fresh = stats.achievements.filter((a) => !this.seen.has(a.id));
    for (const a of fresh) this.seen.add(a.id);
    localStorage.setItem("po.trophies", JSON.stringify([...this.seen]));
    // On the very first load, don't replay a backlog of old trophies — just remember them.
    if (!this.primed && this.seen.size > fresh.length) {
      this.primed = true;
    } else if (!this.primed) {
      this.primed = true;
      if (fresh.length > 2) return;
    }
    fresh.forEach((a, i) => setTimeout(() => this.show(a.id), i * 2500));
  }

  private show(id: string): void {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="toast-icon">${a.icon}</span><div><div class="toast-kicker">🏆 Achievement unlocked</div><b>${a.title}</b><div class="muted">${a.desc}</div></div>`;
    this.root.append(el);
    this.onUnlock();
    setTimeout(() => el.classList.add("leave"), 5200);
    setTimeout(() => el.remove(), 5800);
  }
}
