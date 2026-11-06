import type { OfficeState } from "@pixel-office/protocol";
import { STYLES, chooseStyle, chosenStyle, type StyleId } from "../art/style.js";
import type { ConnectionStatus } from "../net.js";
import { canFullscreen, isFullscreen, isInstalledApp, onFullscreenChange, toggleFullscreen } from "./fullscreen.js";
import { personColor } from "./overlay.js";

export interface HudActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  togglePrivacy: (on: boolean) => void;
  sound: { get: () => boolean; set: (on: boolean) => void };
  sfx: { get: () => boolean; set: (on: boolean) => void };
  desktop: { get: () => boolean; set: (on: boolean) => Promise<boolean> };
  replay: () => void;
  settings: () => void;
  help: () => void;
  list: () => void;
  stats: () => void;
  people: () => void;
  me: () => void;
}

/** Top bar: counts, connection, privacy toggle, zoom. Also drives the tab title + favicon. */
export class Hud {
  private counts: HTMLElement;
  private conn: HTMLElement;
  private replayFlag: HTMLElement;
  private meButton!: HTMLButtonElement;
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
        <button data-a="sfx" title="Sound effects: rockets, alarms, meows, keyboards">🔊</button>
        <button data-a="stats" title="Production stats and trophies (sidebar)">📊</button>
        <button data-a="list" title="List view: everyone as a table">☰</button>
        <button data-a="replay" title="Replay: what happened while you were away">⏪</button>
        <button data-a="settings" class="admin-only" title="Office layout settings">⚙</button>
        <button data-a="people" class="admin-only" title="People and TV links">👥</button>
        <button data-a="help" class="help-btn" title="What am I looking at?">?</button>
      </div>
      <select class="hud-style" title="Art style (this browser only)">
        ${STYLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}
      </select>
      <label class="hud-toggle" title="Hide prompts and messages (for screen sharing)">
        <input type="checkbox" class="privacy" /> privacy
      </label>
      <button class="hud-fs" data-a="fullscreen" title="Fullscreen">⛶</button>
      <div class="hud-zoom">
        <button data-a="out" title="Zoom out">−</button>
        <button data-a="fit" title="Fit">▣</button>
        <button data-a="in" title="Zoom in">+</button>
      </div>
      <button class="hud-me" title="You" hidden></button>
      <div class="hud-conn" title="Connection"></div>
      <form method="post" action="/logout" class="hud-logout"><button type="submit">log out</button></form>
    `;
    this.counts = root.querySelector(".hud-counts")!;
    this.conn = root.querySelector(".hud-conn")!;
    root.querySelector<HTMLButtonElement>('[data-a="in"]')!.onclick = actions.zoomIn;
    root.querySelector<HTMLButtonElement>('[data-a="out"]')!.onclick = actions.zoomOut;
    root.querySelector<HTMLButtonElement>('[data-a="fit"]')!.onclick = actions.fit;
    // Fullscreen: hidden where the browser can't (iPhone) or when already a home-screen app.
    const fs = root.querySelector<HTMLButtonElement>('[data-a="fullscreen"]')!;
    fs.hidden = !canFullscreen() || isInstalledApp();
    fs.onclick = () => void toggleFullscreen();
    onFullscreenChange(() => fs.classList.toggle("on", isFullscreen()));
    const sound = root.querySelector<HTMLButtonElement>('[data-a="sound"]')!;
    const desktop = root.querySelector<HTMLButtonElement>('[data-a="desktop"]')!;
    const sfx = root.querySelector<HTMLButtonElement>('[data-a="sfx"]')!;
    const paint = () => {
      sound.classList.toggle("on", actions.sound.get());
      desktop.classList.toggle("on", actions.desktop.get());
      sfx.classList.toggle("on", actions.sfx.get());
    };
    sfx.onclick = () => {
      actions.sfx.set(!actions.sfx.get());
      paint();
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
    root.querySelector<HTMLButtonElement>('[data-a="help"]')!.onclick = actions.help;
    root.querySelector<HTMLButtonElement>('[data-a="list"]')!.onclick = actions.list;
    root.querySelector<HTMLButtonElement>('[data-a="people"]')!.onclick = actions.people;
    this.meButton = root.querySelector(".hud-me")!;
    this.meButton.onclick = actions.me;
    root.querySelector<HTMLButtonElement>('[data-a="stats"]')!.onclick = actions.stats;
    this.replayFlag = root.querySelector(".hud-replay-flag")!;
    // Switching styles reloads the page, which redraws everything in the new style.
    const style = root.querySelector<HTMLSelectElement>(".hud-style")!;
    style.value = chosenStyle();
    style.onchange = () => chooseStyle(style.value as StyleId);
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

  /** Who's logged in: your name (or "admin" for the admin token), in your own colour. */
  setMe(name: string | undefined, role: string): void {
    if (role === "viewer") return;
    this.meButton.hidden = false;
    this.meButton.textContent = name ? `${name}${role === "admin" ? " ★" : ""}` : "admin token";
    this.meButton.style.setProperty("--person", name ? personColor(name) : "#f0c45a");
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
