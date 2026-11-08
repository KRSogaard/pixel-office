import { TILE } from "../../office/layout.js";

/**
 * From world pixels to 3D units. A tile is one unit; the world's (x, y) on the
 * floor becomes (x, z). A person's feet sit at the bottom of their tile in
 * world pixels (see `feet`), so y is shifted half a tile up to put them in the
 * middle of it.
 */
export function toFloor(px: number, py: number): { x: number; z: number } {
  return { x: px / TILE, z: (py - TILE / 2 + 1) / TILE };
}

/** World pixels of height to units. */
export function toHeight(px: number): number {
  return px / TILE;
}
