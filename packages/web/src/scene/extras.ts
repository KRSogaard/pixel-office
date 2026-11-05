import Phaser from "phaser";
import type { Appearance } from "../art/characters.js";
import { TILE, type Office } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { Character, feet } from "./Character.js";

/**
 * Extras: people who aren't agents. A courier runs envelopes from the mailroom
 * when an agent uses a connected service, medics carry out a sub-agent that
 * failed, and a pizza arrives when the office is in crunch mode.
 */

const LOOKS: Record<"courier" | "medic" | "pizza", Appearance> = {
  courier: {
    skin: "#f6d3b3", skinShade: "#e3b48f", hair: "#3d4a8a", hairStyle: 0,
    shirt: "#3d4a8a", shirtShade: "#2b3566", pants: "#2b2f38", shoes: "#1e1e22",
  },
  medic: {
    skin: "#eac09a", skinShade: "#d19f77", hair: "#e8e8e8", hairStyle: 0,
    shirt: "#f4f4f4", shirtShade: "#ff5d5d", pants: "#f4f4f4", shoes: "#1e1e22",
  },
  pizza: {
    skin: "#f6d3b3", skinShade: "#e3b48f", hair: "#c0504d", hairStyle: 0,
    shirt: "#c0504d", shirtShade: "#9c3d3b", pants: "#2f3a56", shoes: "#1e1e22",
  },
};

type Item = "envelope" | "pizza" | "stretcher" | undefined;

interface Extra {
  c: Character;
  item: Item;
  gfx: Phaser.GameObjects.Graphics;
  /** Removed when its script runs out. */
  done: boolean;
}

export class Extras {
  private extras: Extra[] = [];
  private carrying: { patient: Character; medics: [Extra, Extra] }[] = [];
  private boxes: { gfx: Phaser.GameObjects.Graphics; until: number }[] = [];

  constructor(
    private scene: Phaser.Scene,
    private office: () => Office,
    private door: () => Point,
  ) {}

  /** A courier brings an envelope from the mailroom to an agent, and goes back. */
  courier(from: Point, to: () => Point | undefined, onArrive: () => void): void {
    const e = this.spawn("courier", from, "envelope");
    e.c.play([
      { type: "goto", dest: () => this.stand(to()) },
      { type: "do", fn: () => { e.item = undefined; onArrive(); } },
      { type: "hold", ms: 900 },
      { type: "goto", dest: () => this.stand(from) },
      { type: "do", fn: () => { e.done = true; } },
    ]);
  }

  /** Two medics carry `patient` out of the front door on a stretcher. */
  medics(patient: Character, onGone: () => void): void {
    const door = this.door();
    const a = this.spawn("medic", door, "stretcher");
    const b = this.spawn("medic", { x: door.x, y: door.y + 1 }, undefined);
    const beside = (dx: number) => () => this.stand({ x: patient.tile.x + dx, y: patient.tile.y });
    let arrived = 0;
    const pickUp = () => {
      if (++arrived < 2) return;
      patient.setLying(true);
      this.carrying.push({ patient, medics: [a, b] });
      for (const m of [a, b]) {
        m.c.play([
          { type: "goto", dest: () => this.stand(door) },
          {
            type: "do",
            fn: () => {
              m.done = true;
              if (m === a) {
                this.carrying = this.carrying.filter((x) => x.patient !== patient);
                onGone();
              }
            },
          },
        ]);
      }
    };
    a.c.play([{ type: "goto", dest: beside(-1) }, { type: "do", fn: pickUp }, { type: "hold", ms: 60_000 }]);
    b.c.play([{ type: "goto", dest: beside(1) }, { type: "do", fn: pickUp }, { type: "hold", ms: 60_000 }]);
  }

  /** Pizza delivered to the lounge; the box stays there for a couple of minutes. */
  pizza(to: Point, onArrive: () => void): void {
    const door = this.door();
    const e = this.spawn("pizza", door, "pizza");
    e.c.play([
      { type: "goto", dest: () => this.stand(to) },
      {
        type: "do",
        fn: () => {
          e.item = undefined;
          const box = this.scene.add.graphics().setDepth(to.y * TILE + 2);
          drawPizzaBox(box, to.x * TILE + 3, to.y * TILE + 9);
          this.boxes.push({ gfx: box, until: this.scene.time.now + 120_000 });
          onArrive();
        },
      },
      { type: "hold", ms: 1200 },
      { type: "goto", dest: () => this.stand(door) },
      { type: "do", fn: () => { e.done = true; } },
    ]);
  }

  update(dtMs: number, now: number): void {
    for (const e of this.extras) {
      e.c.update(dtMs, now);
      this.drawItem(e);
    }
    for (const { patient, medics } of this.carrying) {
      const [a, b] = medics;
      patient.moveTo((a.c.x + b.c.x) / 2, (a.c.y + b.c.y) / 2 - 6);
      patient.update(0, now);
    }
    for (const e of this.extras.filter((x) => x.done)) {
      e.c.destroy();
      e.gfx.destroy();
    }
    this.extras = this.extras.filter((x) => !x.done);
    for (const box of this.boxes.filter((b) => now > b.until)) box.gfx.destroy();
    this.boxes = this.boxes.filter((b) => now <= b.until);
  }

  /** The office was rebuilt: anyone caught in a wall just leaves. */
  relocate(): void {
    const w = this.office().walkable;
    for (const e of this.extras) if (!w[e.c.tile.y]?.[e.c.tile.x]) e.done = true;
    for (const box of this.boxes) box.gfx.destroy();
    this.boxes = [];
  }

  isCarried(c: Character): boolean {
    return this.carrying.some((x) => x.patient === c);
  }

  private spawn(kind: keyof typeof LOOKS, at: Point, item: Item): Extra {
    const c = new Character(this.scene, `extra:${kind}`, at, () => this.office().walkable, LOOKS[kind]);
    c.sprite.disableInteractive();
    c.sprite.setPosition(...feet(at));
    const e: Extra = { c, item, gfx: this.scene.add.graphics(), done: false };
    this.extras.push(e);
    return e;
  }

  private stand(p: Point | undefined): { tile: Point; facing: "down"; pose: "stand"; run: boolean } | undefined {
    if (!p) return undefined;
    const w = this.office().walkable;
    const near = [p, { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }].find(
      (q) => w[q.y]?.[q.x],
    );
    return near ? { tile: near, facing: "down", pose: "stand", run: true } : undefined;
  }

  private drawItem(e: Extra): void {
    const g = e.gfx.clear().setDepth(e.c.y + 1);
    const x = Math.round(e.c.x);
    const y = Math.round(e.c.y);
    if (e.item === "envelope") {
      g.fillStyle(0xfdfbf5, 1).fillRect(x + 3, y - 14, 8, 5);
      g.fillStyle(0x9097a6, 1).fillRect(x + 3, y - 14, 8, 1).fillRect(x + 6, y - 13, 2, 1);
      g.fillStyle(0xc0504d, 1).fillRect(x + 6, y - 11, 2, 1);
    } else if (e.item === "pizza") {
      drawPizzaBox(g, x - 5, y - 17);
    } else if (e.item === "stretcher") {
      g.fillStyle(0xc9d0d8, 1).fillRect(x + 4, y - 12, 2, 10);
      g.fillStyle(0x5c6370, 1).fillRect(x + 4, y - 12, 2, 1);
    }
  }
}

function drawPizzaBox(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0xc89b5b, 1).fillRect(x, y, 11, 6);
  g.fillStyle(0xe2b97a, 1).fillRect(x, y, 11, 2);
  g.fillStyle(0xc0504d, 1).fillRect(x + 3, y + 3, 5, 2);
}
