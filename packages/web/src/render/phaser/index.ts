import Phaser from "phaser";
import type { ArtPack } from "../../art/pack.js";
import { TILE, type TeamArea } from "../../office/layout.js";
import type { ScreenPoint } from "../../ui/overlay.js";
import type { WorldEvent } from "../../world/events.js";
import type { World } from "../../world/world.js";
import type { Renderer, RendererInput, Sign } from "../renderer.js";
import { BinsView } from "./bins.js";
import { BotsView } from "./bots.js";
import { BugsView, DronesView, PetView } from "./critters.js";
import { WallDecor } from "./decor.js";
import { blessed, storm, confetti, fire, poof, printPages, puff, sweat } from "./effects.js";
import { Lighting } from "./lighting.js";
import { PersonView } from "./person.js";
import { Ducks, HeldItem, PizzaBoxes, VisitorProp } from "./props.js";
import { Offerings } from "./offerings.js";
import { SeasonalView } from "./seasonal.js";
import { SignsView } from "./signs.js";
import { SiloView } from "./silo.js";
import { addSheet, pack, usePack } from "./textures.js";

/** The flat pixel-art office, drawn with Phaser. */
export class PhaserRenderer implements Renderer {
  private game: Phaser.Game | undefined;
  private scene: FlatOffice;
  readonly visitors: readonly string[];

  constructor(art: ArtPack) {
    usePack(art);
    this.visitors = art.visitors;
    this.scene = new FlatOffice();
  }

  start(parent: HTMLElement, world: World, input: RendererInput, frame: (dtMs: number, now: number) => void): void {
    const scene = this.scene;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: "#1d1f27",
      // Every sound is synthesized through ui/audio.ts. Phaser's own sound system
      // would open the audio output on the first click and hold it, pulling
      // AirPods away from a phone that's playing something.
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
      scene: [],
      callbacks: {
        postBoot: (game) => {
          game.scene.add("office", scene, true, { world, input, frame });
        },
      },
    });
    // Phaser only notices window resizes; the stage also changes size when the sidebar opens or closes.
    new ResizeObserver(() => this.resize()).observe(parent);
  }

  toScreen(x: number, y: number, lift: number): ScreenPoint {
    return this.scene.toScreen(x, y - lift);
  }

  fit(): void {
    this.scene.fit();
  }

  zoomBy(factor: number): void {
    this.scene.zoomBy(factor);
  }

  signs(signs: readonly Sign[]): void {
    this.scene.signs(signs);
  }

  resize(): void {
    this.game?.scale.refresh();
    // The camera takes the new size on Phaser's next step: fit after it.
    requestAnimationFrame(() => this.scene.fit());
  }
}

interface SceneData {
  world: World;
  input: RendererInput;
  frame: (dtMs: number, now: number) => void;
}

/** People on screen, with what they carry (and, for visitors, their prop). */
interface Figure {
  view: PersonView;
  held: HeldItem;
  prop?: VisitorProp;
}

class FlatOffice extends Phaser.Scene {
  private world!: World;
  private input_!: RendererInput;
  private frame!: (dtMs: number, now: number) => void;
  private bg!: Phaser.GameObjects.Image;
  private links!: Phaser.GameObjects.Graphics;
  private figures = new Map<string, Figure>();
  private bins!: BinsView;
  private bots!: BotsView;
  private bugs!: BugsView;
  private drones!: DronesView;
  private pet!: PetView;
  private silo!: SiloView;
  private boxes!: PizzaBoxes;
  private ducks!: Ducks;
  private seasonal!: SeasonalView;
  private offerings!: Offerings;
  private plates: SignsView | undefined;
  private decor!: WallDecor;
  private lighting!: Lighting;
  /** Once the user pans or zooms, a rebuilt office no longer re-fits the camera. */
  private userMovedCamera = false;
  private ready = false;

  constructor() {
    super("office");
  }

  init(data: SceneData): void {
    this.world = data.world;
    this.input_ = data.input;
    this.frame = data.frame;
  }

  create(): void {
    const w = this.world;
    this.bg = this.add.image(0, 0, "__DEFAULT").setOrigin(0, 0).setDepth(-1);
    this.paintBackground();
    this.links = this.add.graphics().setDepth(99_999);
    this.bins = new BinsView(this);
    this.bots = new BotsView(this, (id) => this.world.colorOf(id));
    this.lighting = new Lighting(this);
    this.lighting.resize(w.office.width * TILE, w.office.height * TILE);
    this.pet = new PetView(this, w.pet);
    this.silo = new SiloView(this, w.silo, () => this.world.office.silo);
    this.drones = new DronesView(this);
    this.bugs = new BugsView(this);
    this.boxes = new PizzaBoxes(this);
    this.ducks = new Ducks(this);
    this.seasonal = new SeasonalView(this);
    this.offerings = new Offerings(this);
    this.seasonal.relocate(w.seasonal.decorations);
    this.decor = new WallDecor(this, () => this.world.office, () => this.world.seasonal.season.snow);
    this.decor.relocate();
    w.onEvent((e) => this.onEvent(e));
    this.setupCamera();
    this.ready = true;
  }

  override update(time: number, delta: number): void {
    this.frame(delta, time);
    const w = this.world;
    this.syncFigures(delta, time);
    this.bins.update(w.bins(), time);
    this.bots.update(w.bots.list, time);
    this.drawTeamLinks(time);
    this.pet.update(time);
    this.boxes.update(w.extras.boxes);
    this.ducks.update(w.antics.ducks);
    this.decor.update(time);
    this.bugs.update(w.bugs.list, time);
    this.drones.update(w.drones.list, time);
    this.silo.update(time);
    this.seasonal.update(time);
    this.offerings.update(this.world.shrine.offerings());
    if (Math.floor(time / 500) !== Math.floor((time - delta) / 500)) this.lighting.update(w.lightSpots());
  }

  /** The team offices' name plates (made once the scene exists). */
  signs(signs: readonly Sign[]): void {
    if (!this.ready) return;
    (this.plates ??= new SignsView(this)).update(signs);
  }

  zoomBy(factor: number): void {
    if (!this.ready) return;
    this.userMovedCamera = true;
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.5, 6));
  }

  /** Fit the whole office on screen. Called by the "fit" button: re-enables auto-fit. */
  fit(): void {
    if (!this.ready) return;
    this.userMovedCamera = false;
    const cam = this.cameras.main;
    const w = this.world.office.width * TILE;
    const h = this.world.office.height * TILE;
    const zoom = Math.max(0.5, Math.min(cam.width / w, cam.height / h));
    cam.setZoom(zoom);
    cam.centerOn(w / 2, h / 2);
  }

  toScreen(x: number, y: number): ScreenPoint {
    if (!this.ready) return { x: -1000, y: -1000, scale: 1 };
    const cam = this.cameras.main;
    const ox = cam.width * cam.originX;
    const oy = cam.height * cam.originY;
    return {
      x: cam.x + ox + cam.zoom * (x - cam.scrollX - ox),
      y: cam.y + oy + cam.zoom * (y - cam.scrollY - oy),
      scale: cam.zoom,
    };
  }

  /** Make, update and remove the views of everyone on screen. */
  private syncFigures(delta: number, time: number): void {
    const w = this.world;
    const live = new Set<string>();
    const visitors = new Map(w.visitors.list.map((v) => [v.person.id, v.kind]));
    for (const p of w.people()) {
      live.add(p.id);
      let f = this.figures.get(p.id);
      if (!f) {
        const kind = visitors.get(p.id);
        f = {
          view: new PersonView(this, p, () => this.input_.pick(p.id)),
          held: new HeldItem(this),
          ...(kind ? { prop: new VisitorProp(this) } : {}),
        };
        this.figures.set(p.id, f);
      }
      f.view.update(delta, time);
      f.held.update(p);
      const kind = visitors.get(p.id);
      if (f.prop && kind) f.prop.update(kind, p, time);
    }
    for (const [id, f] of this.figures) {
      if (live.has(id)) continue;
      f.view.destroy();
      f.held.destroy();
      f.prop?.destroy();
      this.figures.delete(id);
    }
  }

  private onEvent(e: WorldEvent): void {
    switch (e.type) {
      case "office":
        return this.rebuilt();
      case "season":
        this.seasonal.relocate(this.world.seasonal.decorations);
        this.decor.relocate();
        return;
      case "puff":
        return puff(this, e.x, e.y);
      case "confetti":
        return confetti(this, e.x, e.y);
      case "poof":
        return poof(this, e.x, e.y, e.color);
      case "sweat":
        return sweat(this, e.x, e.y);
      case "fire":
        return fire(this, e.x, e.y, e.ms);
      case "print":
        return printPages(this, e.x, e.y);
      case "splat":
        return this.bugs.splat(e.x, e.y);
      case "purr":
        return this.pet.purr(e.x, e.y);
      case "countdown":
        return this.silo.countdown(e.text);
      case "shake":
        this.cameras.main.shake(e.ms, e.intensity);
        return;
      case "blessed":
        return blessed(this, e.x, e.y, e.statue);
      case "storm":
        return storm(this, e.x, e.y, () => this.world.people().find((p) => p.id === e.id));
    }
  }

  /** The world built a new office: repaint it and re-place what hangs off it. */
  private rebuilt(): void {
    const o = this.world.office;
    this.paintBackground();
    this.updateBounds();
    this.lighting.resize(o.width * TILE, o.height * TILE);
    this.decor.relocate();
    this.silo.relocate();
    this.seasonal.relocate(this.world.seasonal.decorations);
    if (!this.userMovedCamera) this.fit();
  }

  /** Paint the static office with the art pack and show it. */
  private paintBackground(): void {
    const sheet = pack().paintOffice(this.world.office, (id) => this.world.colorOf(id), this.world.rugs);
    if (this.textures.exists("office")) this.textures.remove("office");
    addSheet(this, "office", sheet);
    this.bg.setTexture("office", 0).setScale(1 / sheet.scale);
  }

  /** Dotted lines from the selected agent to its parent and sub-agents. */
  private drawTeamLinks(now: number): void {
    const g = this.links;
    g.clear();
    const march = Math.floor(now / 120) % 6;
    for (const { from, to, color } of this.world.teamLinks()) {
      const x1 = from.x;
      const y1 = from.y - 10;
      const x2 = to.x;
      const y2 = to.y - 10;
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = march; d < len; d += 6) {
        const t = d / len;
        g.fillStyle(color, 0.9).fillRect(Math.round(x1 + (x2 - x1) * t) - 1, Math.round(y1 + (y2 - y1) * t) - 1, 2, 2);
      }
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor("#1d1f27");
    cam.setRoundPixels(true);
    this.updateBounds();
    this.fit();
    this.scale.on("resize", () => this.fit());

    let dragging = false;
    let moved = 0;
    this.input.on("pointerdown", () => {
      dragging = true;
      moved = 0;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (dragging && moved < 4) {
        // A click on a team's whiteboard opens its todo list; anywhere else closes the agent panel.
        const team = this.whiteboardAt(p);
        if (team) this.input_.board(team.sessionId);
        else this.input_.pick(undefined);
      }
      dragging = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.game.canvas.style.cursor = !dragging && this.whiteboardAt(p) ? "pointer" : "";
      if (!dragging || !p.isDown) return;
      this.userMovedCamera = true;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.userMovedCamera = true;
      this.zoomBy(dy > 0 ? 1 / 1.15 : 1.15);
    });
  }

  /** The team whose whiteboard (two tiles wide) is under the pointer. */
  private whiteboardAt(p: Phaser.Input.Pointer): TeamArea | undefined {
    const x = Math.floor(p.worldX / TILE);
    const y = Math.floor(p.worldY / TILE);
    return this.world.office.teams.find((t) => (x === t.whiteboard.x || x === t.whiteboard.x + 1) && y === t.whiteboard.y);
  }

  private updateBounds(): void {
    const o = this.world.office;
    const pad = 4 * TILE;
    this.cameras.main.setBounds(-pad, -pad, o.width * TILE + pad * 2, o.height * TILE + pad * 2);
  }
}
