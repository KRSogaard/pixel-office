import { TILE, type Office } from "../office/layout.js";
import { ease, type Clock } from "./clock.js";

/**
 * Logistic robots, Factorio-style: every `git commit` sends a little flying
 * robot from the agent's desk to the rocket silo, carrying a crate. It flies
 * over everything, so it needs no floor space. The crate loads into the silo's
 * cargo gauge (commits not pushed yet); the next launch empties it.
 */

export interface Drone {
  id: number;
  /** Ground position under the drone (world pixels). */
  x: number;
  y: number;
  /** Height above the ground (world pixels). */
  lift: number;
  /** Flying right (towards larger x). */
  right: boolean;
}

export class Drones {
  list: Drone[] = [];
  private n = 0;

  constructor(
    private clock: Clock,
    private office: () => Office,
    private onDelivered: () => void,
  ) {}

  /** Fly a crate from `from` (world pixels) to the silo. */
  ship(from: { x: number; y: number }): void {
    const silo = this.office().silo;
    if (!silo) return;
    const to = { x: (silo.x + 1.5) * TILE, y: (silo.y + 1.5) * TILE };
    const drone: Drone = { id: ++this.n, x: from.x, y: from.y, lift: 8, right: to.x > from.x };
    this.list.push(drone);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    void this.clock
      .tween(Math.max(1200, (dist / 80) * 1000), ease.sineInOut, (t) => {
        // Take off, cruise a little higher, and set down on the silo.
        drone.lift = Math.sin(t * Math.PI) * 26 + 8;
        drone.x = from.x + (to.x - from.x) * t;
        drone.y = from.y + (to.y - from.y) * t;
      })
      .then(() => {
        this.list = this.list.filter((d) => d !== drone);
        this.onDelivered();
      });
  }
}
