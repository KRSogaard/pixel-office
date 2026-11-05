import Phaser from "phaser";
import { OfficeStore } from "./net.js";
import { OfficeScene } from "./scene/OfficeScene.js";
import { Hud } from "./ui/hud.js";
import { Overlay } from "./ui/overlay.js";
import { Panel } from "./ui/panel.js";
import "./style.css";

const store = new OfficeStore();
const overlay = new Overlay(document.getElementById("overlay")!);
let selected: string | undefined;

const panel = new Panel(document.getElementById("panel")!, () => select(undefined));
const scene = new OfficeScene();

function select(id: string | undefined) {
  selected = id;
  scene.select(id);
  panel.show(id, store.state);
}

const hud = new Hud(document.getElementById("hud")!, {
  zoomIn: () => scene.zoomBy(1.25),
  zoomOut: () => scene.zoomBy(0.8),
  fit: () => scene.fit(),
  togglePrivacy: (on) => {
    overlay.privacy = on;
    panel.privacy = on;
    overlay.refreshPrivacy();
    panel.render(store.state);
  },
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
      game.scene.add("office", scene, true, { store, overlay, onSelect: select });
    },
  },
});

store.subscribe((state) => {
  hud.render(state);
  if (selected) panel.render(state);
});
store.onStatus((s) => hud.setConnection(s));
store.connect();

// The "working for" clock in the panel ticks even when no events arrive.
setInterval(() => selected && panel.render(store.state), 1000);

// Handle for poking at the office from the browser console.
(window as unknown as { pixelOffice: unknown }).pixelOffice = { store, scene };
