import { ACHIEVEMENTS, type OfficeStats } from "@pixel-office/protocol";
import type { ScreenPoint } from "./overlay.js";

/**
 * The production board on the lobby wall, Factorio-style: today's launches,
 * commits, test runs and pass rate, edits, bugs on the floor, prompts, and a
 * sparkline of tool calls per hour. Click it for the all-time numbers and the
 * trophy cabinet.
 */
export class StatsBoard {
  private el: HTMLDivElement;
  private expanded = false;
  private key = "";

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "stats-board";
    this.el.title = "Production stats — click for all time and trophies";
    this.el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.expanded = !this.expanded;
      this.key = "";
    });
    root.append(this.el);
  }

  render(stats: OfficeStats | undefined, bugs: number, p: ScreenPoint | undefined): void {
    if (!stats || !p) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    this.el.style.setProperty("--zoom", String(p.scale));
    const key = JSON.stringify([stats, bugs, this.expanded]);
    if (key === this.key) return;
    this.key = key;

    const t = stats.today;
    const pass = t.testRuns ? `${Math.round((t.testPasses / t.testRuns) * 100)}%` : "–";
    const rows: [string, string, string][] = [
      ["🚀", "launches", String(t.launches)],
      ["📦", "commits", String(t.commits)],
      ["🧪", "tests", `${t.testPasses}/${t.testRuns} · ${pass}`],
      ["✏", "edits", String(t.edits)],
      ["🐛", "bugs loose", String(bugs)],
      ["💬", "prompts", String(t.prompts)],
    ];
    const max = Math.max(1, ...stats.hourly);
    const spark = stats.hourly
      .map((v, h) => `<i style="height:${Math.max(1, Math.round((v / max) * 18))}px" title="${h}:00 — ${v} tool calls"></i>`)
      .join("");
    let more = "";
    if (this.expanded) {
      const a = stats.allTime;
      const unlocked = new Set(stats.achievements.map((x) => x.id));
      more = `
        <div class="sb-sub">All time · since ${new Date(a.since).toLocaleDateString()}</div>
        <div class="sb-grid">
          <span>🚀 ${a.launches}</span><span>📦 ${a.commits}</span><span>🧪 ${a.testPasses}/${a.testRuns}</span>
          <span>✏ ${a.edits}</span><span>🔥 ${a.fires}</span><span>😱 ${a.scary}</span>
        </div>
        <div class="sb-sub">Trophy cabinet · ${unlocked.size}/${ACHIEVEMENTS.length}</div>
        <div class="sb-trophies">${ACHIEVEMENTS.map(
          (x) => `<span class="${unlocked.has(x.id) ? "won" : ""}" title="${x.title} — ${x.desc}">${x.icon}</span>`,
        ).join("")}</div>`;
    }
    this.el.innerHTML = `
      <div class="sb-head">PRODUCTION · today <span class="sb-peak">peak ${t.peakWorking} working</span></div>
      <div class="sb-rows">${rows.map(([i, l, v]) => `<span>${i}</span><span>${l}</span><b>${v}</b>`).join("")}</div>
      <div class="sb-spark">${spark}</div>
      ${more}`;
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
