import { reduce, type AgentEvent, type OfficeState } from "@pixel-office/protocol";
import type { OfficeStore } from "../net.js";

interface History {
  base: OfficeState;
  events: AgentEvent[];
  now: number;
}

const SPEEDS = [1, 4, 16, 64];

/**
 * "What happened while I was away": a timeline over the server's recent
 * history (last ~2 hours). Scrub to any moment, or play it back at 1–64×.
 * The live office keeps updating in the background; "Live" jumps back.
 */
export class Replay {
  private history: History | undefined;
  private t = 0;
  private start = 0;
  private end = 0;
  private index = 0;
  private state: OfficeState | undefined;
  private playing = false;
  private speed = 4;
  private raf = 0;
  private lastFrame = 0;
  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;

  constructor(
    private root: HTMLElement,
    private store: OfficeStore,
    /** Clear the scene and re-place everyone (after a jump in time). */
    private resetScene: () => void,
  ) {
    root.innerHTML = `
      <span class="replay-label">⏪ Replay</span>
      <button class="replay-play" title="Play / pause">▶</button>
      <button class="replay-speed" title="Playback speed">4×</button>
      <input class="replay-slider" type="range" min="0" max="1000" value="1000" />
      <span class="replay-clock"></span>
      <button class="replay-live" title="Back to the live office">● Live</button>
    `;
    this.slider = root.querySelector(".replay-slider")!;
    this.clock = root.querySelector(".replay-clock")!;
    this.playBtn = root.querySelector(".replay-play")!;
    this.speedBtn = root.querySelector(".replay-speed")!;
    this.slider.oninput = () => this.seek(this.start + (Number(this.slider.value) / 1000) * (this.end - this.start));
    this.playBtn.onclick = () => this.setPlaying(!this.playing);
    this.speedBtn.onclick = () => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]!;
      this.speedBtn.textContent = `${this.speed}×`;
    };
    root.querySelector<HTMLButtonElement>(".replay-live")!.onclick = () => this.close();
  }

  get open(): boolean {
    return this.root.classList.contains("open");
  }

  async openAt(minutesAgo = 30): Promise<void> {
    const res = await fetch("/api/history", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`history: ${res.status}`);
    this.history = (await res.json()) as History;
    const first = this.history.events[0]?.ts ?? this.history.now;
    this.start = Math.min(first, this.history.now);
    this.end = this.history.now;
    this.root.classList.add("open");
    this.seek(Math.max(this.start, this.end - minutesAgo * 60_000));
    this.setPlaying(true);
  }

  close(): void {
    this.setPlaying(false);
    this.root.classList.remove("open");
    this.history = undefined;
    this.store.backToLive();
    this.resetScene();
  }

  /** Jump: rebuild the state at time `t` from the base snapshot. */
  private seek(t: number): void {
    if (!this.history) return;
    this.t = t;
    let s = this.history.base;
    let i = 0;
    const evs = this.history.events;
    while (i < evs.length && evs[i]!.ts <= t) s = reduce(s, evs[i++]!);
    this.index = i;
    this.state = s;
    this.store.showPast(s);
    this.resetScene();
    this.render();
  }

  private setPlaying(on: boolean): void {
    this.playing = on;
    this.playBtn.textContent = on ? "❚❚" : "▶";
    cancelAnimationFrame(this.raf);
    if (on) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame((n) => this.tick(n));
    }
  }

  /** Play forward: apply events one at a time so the office acts them out. */
  private tick(now: number): void {
    if (!this.history || !this.state || !this.playing) return;
    const dt = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    this.t = Math.min(this.end, this.t + dt * this.speed);
    const evs = this.history.events;
    while (this.index < evs.length && evs[this.index]!.ts <= this.t) {
      const e = evs[this.index++]!;
      this.state = reduce(this.state, e);
      this.store.showPast(this.state, e);
    }
    this.render();
    if (this.t >= this.end) {
      this.setPlaying(false);
      return;
    }
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  private render(): void {
    const span = Math.max(1, this.end - this.start);
    this.slider.value = String(Math.round(((this.t - this.start) / span) * 1000));
    const ago = Math.round((this.end - this.t) / 60_000);
    this.clock.textContent = `${new Date(this.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${ago > 0 ? ` · ${ago} min ago` : ""}`;
  }
}
