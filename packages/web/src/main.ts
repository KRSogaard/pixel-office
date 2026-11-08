import { chosenStyle } from "./art/style.js";
import { OfficeStore } from "./net.js";
import { OfficeView } from "./office-view.js";
import { createRenderer } from "./render/index.js";
import { AchievementToasts, StatsBoard } from "./ui/board.js";
import { HelpPanel } from "./ui/help.js";
import { Sfx } from "./ui/sounds.js";
import { Hud } from "./ui/hud.js";
import { ListView } from "./ui/listview.js";
import { Overlay } from "./ui/overlay.js";
import { Notifier } from "./ui/notify.js";
import { Panel } from "./ui/panel.js";
import { MePanel, PeoplePanel } from "./ui/people.js";
import { startTvMode } from "./ui/tv.js";
import { Replay } from "./ui/replay.js";
import { SettingsPanel } from "./ui/settings.js";
import "./style.css";

const store = new OfficeStore();
const overlay = new Overlay(document.getElementById("overlay")!);
const sfx = new Sfx();
const board = new StatsBoard(document.getElementById("sidebar")!, () => {
  // The stage changed size: let the renderer pick it up (and fit the office again).
  requestAnimationFrame(() => office?.resize());
});
const toasts = new AchievementToasts(document.getElementById("toasts")!, () => sfx.fanfare());
store.onStats((s) => toasts.observe(s));

// The server has a new build: say so briefly, then reload (great for a TV nobody touches).
store.onNewVersion(() => {
  const note = document.createElement("div");
  note.className = "toast";
  note.innerHTML = `<span class="toast-icon">✨</span><div><b>New version</b><div class="muted">Reloading…</div></div>`;
  document.getElementById("toasts")!.append(note);
  setTimeout(() => location.reload(), 2000);
});
let selected: string | undefined;

const panel = new Panel(document.getElementById("panel")!, () => select(undefined));
/** The office on screen; set once the art style has loaded. */
let office: OfficeView | undefined;

function select(id: string | undefined) {
  selected = id;
  office?.select(id);
  panel.show(id, store.state);
}

const notifier = new Notifier();
const replay = new Replay(document.getElementById("replay")!, store, () => {
  office?.reset();
  hud.setReplay(store.mode === "replay");
});
const settings = new SettingsPanel(document.getElementById("settings")!, store);
const people = new PeoplePanel(document.getElementById("people")!);
const mePanel = new MePanel(document.getElementById("me")!);
const startParams = new URLSearchParams(location.search);
const help = new HelpPanel(document.getElementById("help")!, !startParams.has("people") && !startParams.has("tv"));
const list = new ListView(document.getElementById("list")!, (id) => select(id), (sessionId) => office?.colorOf(sessionId) ?? 0x888888);

const hud = new Hud(document.getElementById("hud")!, {
  zoomIn: () => office?.zoomBy(1.25),
  zoomOut: () => office?.zoomBy(0.8),
  fit: () => office?.fit(),
  togglePrivacy: (on) => {
    overlay.privacy = on;
    panel.privacy = on;
    list.privacy = on;
    overlay.refreshPrivacy();
    panel.render(store.state);
  },
  sound: { get: () => notifier.sound, set: (on) => notifier.setSound(on) },
  sfx: { get: () => sfx.enabled, set: (on) => sfx.set(on) },
  desktop: { get: () => notifier.desktop, set: (on) => notifier.setDesktop(on) },
  replay: () => {
    if (replay.open) replay.close();
    else void replay.openAt(30).catch((err) => console.warn("[pixel-office] replay", err));
  },
  settings: () => settings.toggle(),
  people: () => void people.toggle(),
  me: () => void mePanel.toggle(store.me, store.role),
  help: () => help.toggle(),
  list: () => list.toggle(store.state),
  stats: () => board.toggle(),
});

// The art style (its renderer and images) loads first; then the office starts.
void createRenderer(chosenStyle()).then((renderer) => {
  office = new OfficeView(renderer, { store, overlay, sfx, board, onSelect: select });
  office.start(document.getElementById("stage")!);
  (window as unknown as { pixelOffice: unknown }).pixelOffice = { store, office };
});

store.subscribe((state) => {
  hud.render(state);
  list.render(state);
  if (store.mode === "live") notifier.observe(state);
  if (selected) panel.render(state);
});
store.onStatus((s) => hud.setConnection(s));
store.connect();

// Admins manage people and settings; TV links (viewers) get the kiosk view.
const params = new URLSearchParams(location.search);
void store.loadRole().then((role) => {
  document.body.classList.toggle("admin", role === "admin");
  hud.setMe(store.me?.name, role);
  overlay.me = store.me?.name;
  if (role === "viewer" || params.has("tv")) startTvMode(() => office?.fit(), role);
  if (role === "admin" && params.has("people")) void people.toggle();
});

// The "working for" clock in the panel ticks even when no events arrive.
setInterval(() => selected && panel.render(store.state), 1000);

// Handle for poking at the office from the browser console (the office joins once it has loaded).
(window as unknown as { pixelOffice: unknown }).pixelOffice = { store };
