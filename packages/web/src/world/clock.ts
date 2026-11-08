/**
 * The world's own timers and tweens, driven by `tick(now)` from whichever
 * renderer is running. `now` is the renderer's clock in milliseconds, the same
 * one the world's `update` gets, so everything stays in step (and pauses with
 * the page).
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  sineOut: (t: number) => Math.sin((t * Math.PI) / 2),
  cubicIn: (t: number) => t * t * t,
} satisfies Record<string, Ease>;

export interface Timer {
  cancel(): void;
}

interface Job {
  at: number;
  every?: number;
  fn: () => void;
  cancelled: boolean;
}

interface Tween {
  from: number;
  ms: number;
  ease: Ease;
  onUpdate: (t: number) => void;
  done: () => void;
}

export class Clock {
  now = 0;
  private jobs: Job[] = [];
  private tweens: Tween[] = [];

  /** Run `fn` once, `ms` from now. */
  after(ms: number, fn: () => void): Timer {
    return this.add({ at: this.now + ms, fn, cancelled: false });
  }

  /** Run `fn` every `ms` until cancelled. */
  every(ms: number, fn: () => void): Timer {
    return this.add({ at: this.now + ms, every: ms, fn, cancelled: false });
  }

  /** A promise that resolves `ms` from now. */
  wait(ms: number): Promise<void> {
    return new Promise((done) => this.after(ms, done));
  }

  /** Run 0 → 1 over `ms` (eased), calling `onUpdate` every tick; resolves at the end. */
  tween(ms: number, easing: Ease, onUpdate: (t: number) => void): Promise<void> {
    return new Promise((done) => this.tweens.push({ from: this.now, ms, ease: easing, onUpdate, done }));
  }

  tick(now: number): void {
    this.now = now;
    for (const tw of [...this.tweens]) {
      const t = Math.min(1, (now - tw.from) / tw.ms);
      tw.onUpdate(tw.ease(t));
      if (t >= 1) {
        this.tweens = this.tweens.filter((x) => x !== tw);
        tw.done();
      }
    }
    const due = this.jobs.filter((j) => !j.cancelled && j.at <= now);
    for (const j of due) {
      if (j.cancelled) continue;
      j.fn();
      if (j.every !== undefined) j.at = now + j.every;
      else j.cancelled = true;
    }
    this.jobs = this.jobs.filter((j) => !j.cancelled);
  }

  private add(job: Job): Timer {
    this.jobs.push(job);
    return { cancel: () => (job.cancelled = true) };
  }
}
