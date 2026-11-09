import type { Office } from "../office/layout.js";
import type { Point } from "../office/pathfind.js";
import { Person, type Destination, type Item } from "./person.js";

/**
 * Extras: people who aren't agents. A courier brings an envelope in from the
 * front door when an agent uses a connected service, medics carry out a sub-agent that
 * failed, and a pizza arrives when the office is in crunch mode.
 */

export type ExtraKind = "courier" | "medic" | "pizza";

interface Extra {
  person: Person;
  /** Removed when its script runs out. */
  done: boolean;
}

/** A pizza box left in the lounge. */
export interface PizzaBox {
  id: number;
  tile: Point;
  until: number;
}

const BOX_MS = 120_000;

export class Extras {
  boxes: PizzaBox[] = [];
  private extras: Extra[] = [];
  private carrying: { patient: Person; medics: [Extra, Extra] }[] = [];
  private n = 0;
  private now = 0;

  constructor(
    private office: () => Office,
    private door: () => Point,
  ) {}

  /** Everyone on duty right now. */
  get people(): Person[] {
    return this.extras.map((e) => e.person);
  }

  /** A courier brings an envelope from `from` (the front door) to an agent, and leaves the same way. */
  courier(from: Point, to: () => Point | undefined, onArrive: () => void): void {
    const e = this.spawn("courier", from, "envelope");
    e.person.play([
      { type: "goto", dest: () => this.stand(to()) },
      { type: "do", fn: () => { e.person.item = undefined; onArrive(); } },
      { type: "hold", ms: 900 },
      { type: "goto", dest: () => this.stand(from) },
      { type: "do", fn: () => { e.done = true; } },
    ]);
  }

  /** Two medics carry `patient` out of the front door on a stretcher. */
  medics(patient: Person, onGone: () => void): void {
    const door = this.door();
    const a = this.spawn("medic", door, "stretcher");
    const b = this.spawn("medic", { x: door.x, y: door.y + 1 }, undefined);
    const beside = (dx: number) => () => this.stand({ x: patient.tile.x + dx, y: patient.tile.y });
    let arrived = 0;
    const pickUp = () => {
      if (++arrived < 2) return;
      patient.lying = true;
      this.carrying.push({ patient, medics: [a, b] });
      for (const m of [a, b]) {
        m.person.play([
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
    a.person.play([{ type: "goto", dest: beside(-1) }, { type: "do", fn: pickUp }, { type: "hold", ms: 60_000 }]);
    b.person.play([{ type: "goto", dest: beside(1) }, { type: "do", fn: pickUp }, { type: "hold", ms: 60_000 }]);
  }

  /** Pizza delivered to the lounge; the box stays there for a couple of minutes. */
  pizza(to: Point, onArrive: () => void): void {
    const door = this.door();
    const e = this.spawn("pizza", door, "pizza");
    e.person.play([
      { type: "goto", dest: () => this.stand(to) },
      {
        type: "do",
        fn: () => {
          e.person.item = undefined;
          this.boxes.push({ id: ++this.n, tile: { ...to }, until: this.now + BOX_MS });
          onArrive();
        },
      },
      { type: "hold", ms: 1200 },
      { type: "goto", dest: () => this.stand(door) },
      { type: "do", fn: () => { e.done = true; } },
    ]);
  }

  update(dtMs: number, now: number): void {
    this.now = now;
    for (const e of this.extras) e.person.update(dtMs, now);
    for (const { patient, medics } of this.carrying) {
      const [a, b] = medics;
      patient.moveTo((a.person.x + b.person.x) / 2, (a.person.y + b.person.y) / 2 - 6);
      patient.update(0, now);
    }
    this.extras = this.extras.filter((x) => !x.done);
    this.boxes = this.boxes.filter((b) => now <= b.until);
  }

  /** The office was rebuilt: anyone caught in a wall just leaves, and the pizza boxes are cleared. */
  relocate(): void {
    const w = this.office().walkable;
    for (const e of this.extras) if (!w[e.person.tile.y]?.[e.person.tile.x]) e.done = true;
    this.boxes = [];
  }

  private spawn(kind: ExtraKind, at: Point, item: Item | undefined): Extra {
    const person = new Person(`extra:${kind}:${++this.n}`, { cast: kind }, at, () => this.office().passable);
    person.item = item;
    const e: Extra = { person, done: false };
    this.extras.push(e);
    return e;
  }

  private stand(p: Point | undefined): Destination | undefined {
    if (!p) return undefined;
    const w = this.office().passable;
    const near = [p, { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }].find(
      (q) => w[q.y]?.[q.x],
    );
    return near ? { tile: near, facing: "down", pose: "stand", run: true } : undefined;
  }
}
