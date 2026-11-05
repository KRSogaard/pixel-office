import type { OfficeState } from "@pixel-office/protocol";
import type { ConnectionStatus } from "../net.js";

export interface HudActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  togglePrivacy: (on: boolean) => void;
  sound: { get: () => boolean; set: (on: boolean) => void };
  desktop: { get: () => boolean; set: (on: boolean) => Promise<boolean> };
  replay: () => void;
  settings: () => void;
}

/** Top bar: counts, connection, privacy toggle, zoom. Also drives the tab title + favicon. */
export class Hud {
  private counts: HTMLElement;
  private conn: HTMLElement;
  private replayFlag: HTMLElement;
  private baseTitle = document.title;
  private lastWaiting = -1;

  constructor(root: HTMLElement, actions: HudActions) {
    root.innerHTML = `
      <div class="hud-brand"><span class="logo"></span>pixel-office</div>
      <div class="hud-counts"></div>
      <div class="hud-replay-flag" hidden>⏪ REPLAY</div>
      <div class="hud-spacer"></div>
      <div class="hud-tools">
        <button data-a="sound" title="Bell when an agent needs you or finishes">🔔</button>
        <button data-a="desktop" title="Desktop notifications while this tab is in the background">🖥</button>
        <button data-a="replay" title="Replay: what happened while you were away">⏪</button>
        <button data-a="settings" title="Office layout settings">⚙</button>
      </div>
      <label class="hud-toggle" title="Hide prompts and messages (for screen sharing)">
        <input type="checkbox" class="privacy" /> privacy
      </label>
      <div class="hud-zoom">
        <button data-a="out" title="Zoom out">−</button>
        <button data-a="fit" title="Fit">▣</button>
        <button data-a="in" title="Zoom in">+</button>
      </div>
      <div class="hud-conn" title="Connection"></div>
      <form method="post" action="/logout" class="hud-logout"><button type="submit">log out</button></form>
    `;
    this.counts = root.querySelector(".hud-counts")!;
    this.conn = root.querySelector(".hud-conn")!;
    root.querySelector<HTMLButtonElement>('[data-a="in"]')!.onclick = actions.zoomIn;
    root.querySelector<HTMLButtonElement>('[data-a="out"]')!.onclick = actions.zoomOut;
    root.querySelector<HTMLButtonElement>('[data-a="fit"]')!.onclick = actions.fit;
    const sound = root.querySelector<HTMLButtonElement>('[data-a="sound"]')!;
    const desktop = root.querySelector<HTMLButtonElement>('[data-a="desktop"]')!;
    const paint = () => {
      sound.classList.toggle("on", actions.sound.get());
      desktop.classList.toggle("on", actions.desktop.get());
    };
    sound.onclick = () => {
      actions.sound.set(!actions.sound.get());
      paint();
    };
    desktop.onclick = async () => {
      await actions.desktop.set(!actions.desktop.get());
      paint();
    };
    paint();
    root.querySelector<HTMLButtonElement>('[data-a="replay"]')!.onclick = actions.replay;
    root.querySelector<HTMLButtonElement>('[data-a="settings"]')!.onclick = actions.settings;
    this.replayFlag = root.querySelector(".hud-replay-flag")!;
    const privacy = root.querySelector<HTMLInputElement>(".privacy")!;
    privacy.checked = localStorage.getItem("po.privacy") === "1";
    privacy.onchange = () => {
      localStorage.setItem("po.privacy", privacy.checked ? "1" : "0");
      actions.togglePrivacy(privacy.checked);
    };
    if (privacy.checked) queueMicrotask(() => actions.togglePrivacy(true));
  }

  render(state: OfficeState): void {
    const agents = Object.values(state.agents).filter((a) => a.status !== "ended");
    const n = (s: string) => agents.filter((a) => a.status === s).length;
    const working = n("working");
    const waiting = n("waiting");
    const idle = n("idle");
    this.counts.innerHTML = `
      <span class="count working" title="Working">⌨ ${working}</span>
      <span class="count waiting ${waiting ? "hot" : ""}" title="Waiting on you">! ${waiting}</span>
      <span class="count idle" title="Idle">z ${idle}</span>
    `;
    if (waiting !== this.lastWaiting) {
      this.lastWaiting = waiting;
      document.title = waiting ? `(${waiting}) ${this.baseTitle}` : this.baseTitle;
      setFavicon(waiting > 0);
    }
  }

  setReplay(on: boolean): void {
    this.replayFlag.hidden = !on;
  }

  setConnection(s: ConnectionStatus): void {
    this.conn.className = `hud-conn ${s}`;
    this.conn.title = s === "live" ? "Connected" : s === "connecting" ? "Connecting…" : "Offline — retrying";
  }
}

function setFavicon(alert: boolean): void {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3b3f4a";
  g.fillRect(1, 3, 14, 12);
  g.fillStyle = "#4fa3d1";
  g.fillRect(3, 5, 10, 6);
  g.fillStyle = "#e8dcc6";
  g.fillRect(6, 12, 4, 2);
  if (alert) {
    g.fillStyle = "#ff4d4d";
    g.beginPath();
    g.arc(12, 4, 4, 0, Math.PI * 2);
    g.fill();
  }
  let link = document.querySelector<HTMLLinkElement>("link[rel=icon]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.href = c.toDataURL();
}
