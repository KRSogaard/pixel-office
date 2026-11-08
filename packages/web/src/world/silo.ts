import { ease, type Clock } from "./clock.js";
import type { WorldListener } from "./events.js";

/**
 * The rocket silo in the git room, Factorio-style: on every push or PR the
 * blast doors slide open, the rocket rises slowly out of the pit, a countdown
 * runs, and it lifts off in a column of flame and billowing smoke. Launches
 * queue up if several pushes land at once.
 */

/** Where a launch is: each 0 → 1. */
export interface Flight {
  open: number;
  rise: number;
  fly: number;
  /** Steam curling out of the pit while the rocket rises. */
  steaming: boolean;
  /** Smoke billowing at lift-off. */
  smoking: boolean;
}

export class RocketSilo {
  launches = 0;
  lastLaunchAt = 0;
  /** Crates (commits) loaded since the last launch. */
  cargo = 0;
  /** The launch in progress, if any. */
  flight: Flight | undefined;
  private queued: string[] = [];

  constructor(
    private clock: Clock,
    private emit: WorldListener,
    private onLaunched: (label: string) => void,
  ) {}

  /** A crate arrived: load it. */
  addCargo(): void {
    this.cargo++;
  }

  launch(label: string): void {
    this.queued.push(label);
    if (!this.flight) void this.next();
  }

  private async next(): Promise<void> {
    const label = this.queued.shift();
    if (label === undefined) {
      this.flight = undefined;
      return;
    }
    const f: Flight = { open: 0, rise: 0, fly: 0, steaming: false, smoking: false };
    this.flight = f;
    const to = (key: "open" | "rise" | "fly", target: number, ms: number, easing: (t: number) => number) => {
      const from = f[key];
      return this.clock.tween(ms, easing, (t) => (f[key] = from + (target - from) * t));
    };
    await to("open", 1, 800, ease.sineInOut);
    f.steaming = true;
    await to("rise", 1, 1800, ease.sineOut);
    for (const n of ["3", "2", "1"]) {
      this.emit({ type: "countdown", text: n });
      await this.clock.wait(450);
    }
    f.steaming = false;
    this.emit({ type: "shake", ms: 600, intensity: 0.004 });
    f.smoking = true;
    await to("fly", 1, 1500, ease.cubicIn);
    f.smoking = false;
    this.launches++;
    this.lastLaunchAt = Date.now();
    this.cargo = 0;
    this.onLaunched(label);
    f.rise = 0;
    f.fly = 0;
    await to("open", 0, 700, ease.sineInOut);
    await this.next();
  }
}
