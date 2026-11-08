import Phaser from "phaser";
import type { Bug } from "../../world/bugs.js";
import type { Drone } from "../../world/drones.js";
import type { Pet } from "../../world/pet.js";
import { addSheet, pack, propImage } from "./textures.js";

/** Draws one item per id each frame: makes views for new ids and destroys views whose id is gone. */
class Keyed<T extends { id: number }, V extends { destroy(): void }> {
  private views = new Map<number, V>();

  constructor(
    private make: (item: T) => V,
    private draw: (view: V, item: T) => void,
  ) {}

  update(items: readonly T[]): void {
    const live = new Set(items.map((i) => i.id));
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      v.destroy();
      this.views.delete(id);
    }
    for (const item of items) {
      let v = this.views.get(item.id);
      if (!v) this.views.set(item.id, (v = this.make(item)));
      this.draw(v, item);
    }
  }
}

/** One graphics object, plus the pack's image when it has one. */
class Pair {
  constructor(
    readonly gfx: Phaser.GameObjects.Graphics,
    readonly img: Phaser.GameObjects.Image | undefined,
  ) {}
  destroy(): void {
    this.gfx.destroy();
    this.img?.destroy();
  }
}

/** Bugs scuttling across the floor; a green splat where one is squashed. */
export class BugsView {
  private keyed: Keyed<Bug, Pair>;
  private now = 0;

  constructor(private scene: Phaser.Scene) {
    this.keyed = new Keyed(
      () => new Pair(scene.add.graphics(), propImage(scene, "bug")),
      (v, b) => drawBug(v, b, this.now),
    );
  }

  update(bugs: readonly Bug[], now: number): void {
    this.now = now;
    this.keyed.update(bugs);
  }

  splat(x: number, y: number): void {
    const s = this.scene.add.graphics().setDepth(y);
    s.fillStyle(0x6fd08c, 0.8).fillRect(x - 3, y - 1, 6, 2).fillRect(x - 1, y - 3, 2, 6);
    s.fillStyle(0x3b7a3c, 1).fillRect(x - 1, y - 1, 2, 2);
    this.scene.tweens.add({ targets: s, alpha: 0, delay: 1500, duration: 1200, onComplete: () => s.destroy() });
  }
}

/** A 7×4 beetle with scuttling legs, or the pack's bug image scuttling (a wobble) in its direction. */
function drawBug(v: Pair, b: Bug, now: number): void {
  if (v.img) {
    const wobble = Math.floor(now / 90) % 2 ? 8 : -8;
    v.img.setPosition(b.x, b.y + 3).setDepth(b.y).setFlipX(b.dx > 0).setAngle(wobble);
    return;
  }
  const g = v.gfx.clear().setDepth(b.y);
  const x = Math.round(b.x) - 3;
  const y = Math.round(b.y) - 2;
  const leg = Math.floor(now / 90) % 2;
  g.fillStyle(0x1d1f27, 1);
  for (let i = 0; i < 3; i++) {
    g.fillRect(x + 1 + i * 2, y - 1 + (i % 2 === leg ? 0 : 1), 1, 1);
    g.fillRect(x + 1 + i * 2, y + 4 - (i % 2 === leg ? 0 : 1), 1, 1);
  }
  g.fillStyle(b.hue, 1).fillRect(x, y, 7, 4);
  g.fillStyle(0x8a6a4a, 1).fillRect(x + 1, y, 5, 1);
  g.fillStyle(0x1d1f27, 1).fillRect(b.dx < 0 ? x - 1 : x + 7, y + 1, 1, 2);
  g.fillStyle(0xff3b3b, 1).fillRect(b.dx < 0 ? x : x + 6, y + 1, 1, 1);
}

/** Little robots flying crates to the silo, above everything. */
export class DronesView {
  private keyed: Keyed<Drone, Pair>;
  private now = 0;

  constructor(scene: Phaser.Scene) {
    this.keyed = new Keyed(
      () => new Pair(scene.add.graphics().setDepth(95_000), propImage(scene, "drone")?.setDepth(95_000)),
      (v, d) => {
        const y = d.y - d.lift;
        if (v.img) v.img.setPosition(d.x, y + 8 + Math.sin(this.now / 120)).setFlipX(d.right);
        else drawDrone(v.gfx, d.x, y, this.now);
      },
    );
  }

  update(drones: readonly Drone[], now: number): void {
    this.now = now;
    this.keyed.update(drones);
  }
}

function drawDrone(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  g.clear();
  // Rotors (blinking), body, status light, and the crate underneath.
  const spin = Math.floor(now / 60) % 2;
  g.fillStyle(0xc9d0d8, 0.8).fillRect(cx - 6, cy - 5, spin ? 4 : 2, 1).fillRect(cx + 3 - (spin ? 1 : 0), cy - 5, spin ? 4 : 2, 1);
  g.fillStyle(0x7d8590, 1).fillRect(cx - 4, cy - 4, 8, 4);
  g.fillStyle(0xa9b0ba, 1).fillRect(cx - 3, cy - 4, 6, 1);
  g.fillStyle(Math.floor(now / 300) % 2 ? 0xf0c45a : 0xd9a83a, 1).fillRect(cx - 1, cy - 3, 2, 1);
  g.fillStyle(0x3b3f4a, 1).fillRect(cx - 1, cy, 1, 2).fillRect(cx, cy, 1, 2);
  g.fillStyle(0x8a5a36, 1).fillRect(cx - 3, cy + 2, 6, 5);
  g.fillStyle(0xb07a4a, 1).fillRect(cx - 2, cy + 3, 4, 3);
}

const CAT_KEY = "cat";
const CAT_FRAMES = { walk: [0, 1], sit: [2], sleep: [3, 4] } as const;

/** Byte the cat; click for a purr. */
export class PetView {
  private sprite: Phaser.GameObjects.Sprite;

  constructor(
    private scene: Phaser.Scene,
    private pet: Pet,
  ) {
    const sheet = pack().cat();
    addSheet(scene, CAT_KEY, sheet);
    this.sprite = scene.add.sprite(pet.x, pet.y, CAT_KEY, 2).setOrigin(0.5, 1).setScale(1 / sheet.scale).setInteractive({ useHandCursor: true });
    this.sprite.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      // Keeps the scene's "click on empty floor closes the panel" handler from firing too.
      ev.stopPropagation();
      pet.purr();
    });
  }

  update(now: number): void {
    const { pet } = this;
    const mode = pet.mode;
    const t = now / 1000;
    const frames = CAT_FRAMES[mode];
    const fps = mode === "walk" ? 6 : mode === "sleep" ? 0.8 : 1;
    this.sprite.setPosition(pet.x, pet.y);
    this.sprite.setFrame(frames[Math.floor(t * fps) % frames.length]!);
    this.sprite.setFlipX(mode === "walk" && pet.right);
    this.sprite.setDepth(pet.y);
  }

  purr(x: number, y: number): void {
    const heart = this.scene.add
      .text(x, y - 14, "♥ purr", { fontFamily: "monospace", fontSize: "8px", color: "#ff7a9a", resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(100_000);
    this.scene.tweens.add({ targets: heart, y: heart.y - 12, alpha: 0, duration: 1400, onComplete: () => heart.destroy() });
  }
}
