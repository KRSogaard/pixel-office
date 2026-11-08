import Phaser from "phaser";
import type { Activity } from "@pixel-office/protocol";
import { FRAMES, FRAME_H } from "../../art/characters.js";
import { FX_SIZE, buildFxSheet, type FxStrip } from "../../art/fx.js";
import { TILE } from "../../office/layout.js";
import type { Person } from "../../world/person.js";
import { addSheet, pack } from "./textures.js";

const FX_KEY = "fx";
let fxStrips: Partial<Record<Activity, FxStrip>> | undefined;

function ensureFx(scene: Phaser.Scene): Partial<Record<Activity, FxStrip>> {
  if (!fxStrips || !scene.textures.exists(FX_KEY)) {
    const { canvas, strips } = buildFxSheet();
    const tex = scene.textures.addCanvas(FX_KEY, canvas)!;
    for (let i = 0; i < canvas.width / FX_SIZE; i++) tex.add(i, 0, i * FX_SIZE, 0, FX_SIZE, FX_SIZE);
    fxStrips = strips;
  }
  return fxStrips;
}

/**
 * How a person looks in the flat office: their sprite, the activity icon by
 * the head, the code scrolling on their monitor while they type, the coloured
 * ring under the feet, a flame when stuck, and a party hat on the office's
 * birthday. Reads the person every frame; changes nothing about it.
 */
export class PersonView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly fx: Phaser.GameObjects.Sprite;
  private readonly screen: Phaser.GameObjects.Graphics;
  private readonly ring: Phaser.GameObjects.Ellipse;
  private readonly flame: Phaser.GameObjects.Graphics;
  private hat: Phaser.GameObjects.Graphics | undefined;
  private animTime = Math.random() * 1000;
  private ringColor: number | undefined = undefined;

  constructor(
    scene: Phaser.Scene,
    readonly person: Person,
    onClick: () => void,
  ) {
    const look = person.look;
    const key = "agent" in look ? `char:${look.agent}` : `char:cast:${look.cast}`;
    const sheet = pack().character(look);
    addSheet(scene, key, sheet);
    this.sprite = scene.add.sprite(person.x, person.y, key, 0).setOrigin(0.5, 1).setScale(1 / sheet.scale);
    if (person.clickable) {
      this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
      this.sprite.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        // Phaser's own propagation, not the DOM event's: keeps the scene's
        // "click on empty floor closes the panel" handler from firing too.
        ev.stopPropagation();
        onClick();
      });
    }
    ensureFx(scene);
    this.fx = scene.add.sprite(0, 0, FX_KEY, 0).setOrigin(0.5, 1).setVisible(false);
    this.screen = scene.add.graphics().setVisible(false);
    this.ring = scene.add.ellipse(0, 0, 14, 5).setVisible(false);
    this.flame = scene.add.graphics().setVisible(false);
  }

  update(dtMs: number, now: number): void {
    const p = this.person;
    this.sprite.setPosition(p.x, p.y);
    this.animate(Math.min(dtMs, 100), now);
    this.sprite.setDepth(p.y);
    this.updateRing();
    this.ring.setPosition(p.x, p.y - 1).setDepth(p.y - 0.5);
    this.updateFx(now);
    this.updateScreen(now);
    this.updateFlame(now);
    this.updateHat();
    if (p.lying) {
      this.sprite.setAngle(-90).setOrigin(0.5, 0.5);
    } else if (this.sprite.angle !== 0) {
      this.sprite.setAngle(0);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.fx.destroy();
    this.screen.destroy();
    this.ring.destroy();
    this.flame.destroy();
    this.hat?.destroy();
  }

  private updateRing(): void {
    const color = this.person.sessionColor;
    if (color === this.ringColor) return;
    this.ringColor = color;
    if (color === undefined) this.ring.setVisible(false);
    else this.ring.setStrokeStyle(1.5, color, 0.95).setFillStyle(color, 0.25).setVisible(true);
  }

  private updateHat(): void {
    const p = this.person;
    if (p.hat && !this.hat) this.hat = this.sprite.scene.add.graphics();
    if (!p.hat && this.hat) {
      this.hat.destroy();
      this.hat = undefined;
    }
    if (!this.hat) return;
    const x = Math.round(p.x) - 2;
    const y = Math.round(p.y) - 25 - (p.seated ? 3 : 0);
    this.hat.clear().setDepth(p.y + 0.6).setVisible(!p.lying);
    this.hat.fillStyle(0xc77dff, 1).fillRect(x, y + 2, 5, 2).fillRect(x + 1, y, 3, 2).fillRect(x + 2, y - 2, 1, 2);
    this.hat.fillStyle(0xf0c45a, 1).fillRect(x + 1, y + 2, 1, 1).fillRect(x + 3, y + 1, 1, 1).fillRect(x + 2, y - 3, 1, 1);
  }

  private updateFlame(now: number): void {
    const p = this.person;
    const g = this.flame;
    g.setVisible(p.stuck && !p.lying);
    if (!p.stuck) return;
    const x = Math.round(p.x - 1);
    const y = Math.round(p.y - 31);
    const f = Math.floor(now / 120) % 3;
    g.clear().setDepth(p.y + 1);
    g.fillStyle(0xff5d2a, 1).fillRect(x - 2, y + 2, 5, 4);
    g.fillStyle(0xff9a3c, 1).fillRect(x - 1, y + (f === 0 ? 0 : 1), 3, 4);
    g.fillStyle(0xffe066, 1).fillRect(x, y + 3 - (f === 2 ? 1 : 0), 1, 2);
    if (f === 1) g.fillStyle(0xff9a3c, 1).fillRect(x + 2, y, 1, 2);
  }

  private updateFx(now: number): void {
    const p = this.person;
    const strip = fxStrips?.[p.activity];
    // Shown while walking too: half the time agents are on their way to the tool they're using.
    const show = !!strip && p.activity !== "ended";
    this.fx.setVisible(show);
    if (!show || !strip) return;
    const t = (now - p.activitySince) / 1000;
    this.fx.setFrame(strip.start + (Math.floor(t * strip.fps) % strip.frames));
    // Pop in, then bob gently.
    const pop = t < 0.18 ? 0.6 + (t / 0.18) * 0.6 : t < 0.3 ? 1.2 - ((t - 0.18) / 0.12) * 0.2 : 1;
    const bob = Math.round(Math.sin(t * 3) * 1);
    this.fx
      .setScale(pop)
      // Beside the head, below the name tag; the world picks the side (left at desks, away from neighbours).
      .setPosition(Math.round(p.x + (p.fxLeft ? -12 : 12)), Math.round(p.y - (p.seated ? 11 : 8) + bob))
      .setDepth(p.y + 0.5);
  }

  /** While typing at a desk, the monitor above the seat scrolls lines of code. */
  private updateScreen(now: number): void {
    const p = this.person;
    const monitor = pack().screen;
    const typing = p.pose === "type" && p.arrived && !!monitor;
    this.screen.setVisible(typing);
    if (!typing || !monitor) return;
    const sx = p.tile.x * TILE + monitor.dx;
    const sy = p.tile.y * TILE + monitor.dy;
    const g = this.screen;
    g.clear();
    g.fillStyle(0x1b2a3a, 1).fillRect(sx, sy, monitor.w, monitor.h);
    // Three lines of code scrolling up, drawn on a 12×7 grid scaled to the monitor.
    const kx = monitor.w / 12;
    const ky = monitor.h / 7;
    const scroll = Math.floor(now / 220);
    const colors = [0x8fd0f0, 0xf0c45a, 0x9bbb59, 0xe9e4d8];
    for (let row = 0; row < 3; row++) {
      const n = scroll + row;
      const indent = (n * 7) % 3;
      const w = 3 + ((n * 5) % 7);
      g.fillStyle(colors[n % colors.length]!, 1).fillRect(sx + (1 + indent) * kx, sy + (1 + row * 2) * ky, Math.min(w, 10 - indent) * kx, ky);
    }
    if (Math.floor(now / 400) % 2) g.fillStyle(0xffffff, 1).fillRect(sx + kx, sy + 6 * ky, 2 * kx, ky);
    g.setDepth(p.y - 1);
  }

  private animate(dtMs: number, now: number): void {
    const p = this.person;
    this.animTime += dtMs;
    const t = this.animTime / 1000;
    const cycle = (frames: readonly number[], fps: number) => frames[Math.floor(t * fps) % frames.length]!;
    let frame: number;
    let flip = false;
    let yOffset = 0;
    const walkFrames = p.facing === "up" ? FRAMES.walkUp : p.facing === "down" ? FRAMES.walkDown : FRAMES.walkLeft;
    switch (p.cheering(now) ? "cheer" : p.pose) {
      case "cheer":
        frame = cycle(FRAMES.cheer, 5);
        yOffset = Math.floor(t * 5) % 2 ? -2 : 0;
        break;
      case "stomp":
        // Hopping on the wastepaper bin to squash it down.
        frame = FRAMES.walkDown[Math.floor(t * 6) % 2 ? 1 : 3]!;
        yOffset = Math.floor(t * 6) % 2 ? -4 : 0;
        break;
      case "walk":
        frame = cycle(walkFrames, 8);
        flip = p.facing === "right";
        break;
      case "type":
        frame = cycle(FRAMES.type, 6);
        yOffset = -3;
        break;
      case "think":
        frame = cycle(FRAMES.think, 1.6);
        yOffset = -3;
        break;
      case "station":
        frame = cycle(FRAMES.station, 3);
        break;
      case "hand":
        frame = cycle(FRAMES.hand, 3);
        break;
      case "lounge":
        frame = cycle(FRAMES.lounge, 0.7);
        yOffset = -4;
        break;
      default:
        frame = walkFrames[0]!;
        flip = p.facing === "right";
    }
    this.sprite.setFrame(frame);
    this.sprite.setFlipX(flip);
    // Negative yOffset lifts the sprite (e.g. tucked in at a desk or sunk into a sofa).
    if (!p.lying) this.sprite.setOrigin(0.5, 1 - yOffset / FRAME_H);
  }
}
