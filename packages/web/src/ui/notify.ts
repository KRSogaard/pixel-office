import type { AgentState, OfficeState } from "@pixel-office/protocol";
import { audioFor } from "./audio.js";

/**
 * Tells you when an agent needs you, or when a main agent finishes its turn:
 * a little synthesized bell, and a desktop notification while the tab is in
 * the background. Both are opt-in from the HUD and remembered per browser.
 */
export class Notifier {
  sound = localStorage.getItem("po.sound") === "1";
  desktop = localStorage.getItem("po.desktop") === "1";
  private prev = new Map<string, Pick<AgentState, "status" | "activitySince">>();
  private primed = false;

  setSound(on: boolean): void {
    this.sound = on;
    localStorage.setItem("po.sound", on ? "1" : "0");
    if (on) this.chime("done"); // also unlocks audio on this user gesture
  }

  async setDesktop(on: boolean): Promise<boolean> {
    if (on && "Notification" in window && Notification.permission !== "granted") {
      on = (await Notification.requestPermission()) === "granted";
    }
    this.desktop = on;
    localStorage.setItem("po.desktop", on ? "1" : "0");
    return on;
  }

  /** Compare with the previous state and announce what changed. Live state only. */
  observe(state: OfficeState): void {
    const agents = Object.values(state.agents);
    if (this.primed) {
      for (const a of agents) {
        const before = this.prev.get(a.id);
        if (!before) continue;
        if (a.status === "waiting" && before.status !== "waiting") {
          const what = a.waiting?.reason === "question" ? "has a question" : "needs permission";
          this.announce("waiting", `${a.name} ${what}`, `${a.project.name}${a.waiting?.text ? ` — ${a.waiting.text}` : ""}`, a.id);
        } else if (!a.parentId && a.status === "idle" && before.status === "working" && a.activitySince - before.activitySince > 3000) {
          this.announce("done", `${a.name} is done`, `${a.project.name}${a.prompt ? ` — ${a.prompt}` : ""}`, a.id);
        }
      }
    }
    this.primed = true;
    this.prev = new Map(agents.map((a) => [a.id, { status: a.status, activitySince: a.activitySince }]));
  }

  private announce(kind: "waiting" | "done", title: string, body: string, tag: string): void {
    if (this.sound) this.chime(kind);
    if (this.desktop && document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag, silent: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }

  /** "waiting": a two-tone desk bell. "done": a soft rising chime. */
  private chime(kind: "waiting" | "done"): void {
    const notes = kind === "waiting" ? [1318.5, 1046.5] : [659.3, 880, 1174.7];
    const step = kind === "waiting" ? 0.14 : 0.09;
    const ctx = audioFor(notes.length * step + 0.65);
    if (!ctx) return; // no audio available; stay quiet
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "waiting" ? "triangle" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }
}
