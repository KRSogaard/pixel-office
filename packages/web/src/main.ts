import Phaser from "phaser";
import { OfficeStore } from "./net.js";
import { OfficeScene } from "./scene/OfficeScene.js";
import { AchievementToasts, StatsBoard } from "./ui/board.js";
import { HelpPanel } from "./ui/help.js";
import { Sfx } from "./ui/sounds.js";
import { Hud } from "./ui/hud.js";
import { ListView } from "./ui/listview.js";
import { Overlay } from "./ui/overlay.js";
import { Notifier } from "./ui/notify.js";
import { Panel } from "./ui/panel.js";
import { Replay } from "./ui/replay.js";
import { SettingsPanel } from "./ui/settings.js";
import "./style.css";

const store = new OfficeStore();
const overlay = new Overlay(document.getElementById("overlay")!);
const sfx = new Sfx();
const board = new StatsBoard(document.getElementById("overlay")!);
const toasts = new AchievementToasts(document.getElementById("toasts")!, () => sfx.fanfare());
store.onStats((s) => toasts.observe(s));
let selected: string | undefined;

const panel = new Panel(document.getElementById("panel")!, () => select(undefined));
const scene = new OfficeScene();

function select(id: string | undefined) {
  selected = id;
  scene.select(id);
  panel.show(id, store.state);
}

const notifier = new Notifier();
const replay = new Replay(document.getElementById("replay")!, store, () => {
  scene.reset();
  hud.setReplay(store.mode === "replay");
});
const settings = new SettingsPanel(document.getElementById("settings")!, store);
const help = new HelpPanel(document.getElementById("help")!);
const list = new ListView(document.getElementById("list")!, (id) => select(id), (sessionId) => scene.colorOf(sessionId));

const hud = new Hud(document.getElementById("hud")!, {
  zoomIn: () => scene.zoomBy(1.25),
  zoomOut: () => scene.zoomBy(0.8),
  fit: () => scene.fit(),
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
  help: () => help.toggle(),
  list: () => list.toggle(store.state),
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "stage",
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#1d1f27",
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  scene: [],
  callbacks: {
    postBoot: (game) => {
      game.scene.add("office", scene, true, { store, overlay, onSelect: select, sfx, board });
    },
  },
});

store.subscribe((state) => {
  hud.render(state);
  list.render(state);
  if (store.mode === "live") notifier.observe(state);
  if (selected) panel.render(state);
});
store.onStatus((s) => hud.setConnection(s));
store.connect();

// The "working for" clock in the panel ticks even when no events arrive.
setInterval(() => selected && panel.render(store.state), 1000);

// Handle for poking at the office from the browser console.
(window as unknown as { pixelOffice: unknown }).pixelOffice = { store, scene };
