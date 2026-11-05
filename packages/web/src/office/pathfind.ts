export interface Point {
  x: number;
  y: number;
}

/**
 * A* over a 4-connected grid. Returns the path from start to goal, excluding
 * the start tile, or [] if unreachable. Start and goal are always treated as
 * walkable so agents can leave and enter furniture-adjacent spots.
 */
export function findPath(walkable: boolean[][], start: Point, goal: Point): Point[] {
  if (start.x === goal.x && start.y === goal.y) return [];
  const h = walkable.length;
  const w = walkable[0]?.length ?? 0;
  const key = (x: number, y: number) => y * w + x;
  const open = new MinHeap();
  const came = new Map<number, number>();
  const g = new Map<number, number>();
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  g.set(startKey, 0);
  open.push(startKey, manhattan(start, goal));

  while (open.size) {
    const cur = open.pop()!;
    if (cur === goalKey) return rebuild(came, cur, w, startKey);
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = key(nx, ny);
      if (!walkable[ny]![nx] && nk !== goalKey) continue;
      const cost = g.get(cur)! + 1;
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        came.set(nk, cur);
        open.push(nk, cost + manhattan({ x: nx, y: ny }, goal));
      }
    }
  }
  return [];
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function rebuild(came: Map<number, number>, end: number, w: number, startKey: number): Point[] {
  const out: Point[] = [];
  let cur: number | undefined = end;
  while (cur !== undefined && cur !== startKey) {
    out.push({ x: cur % w, y: Math.floor(cur / w) });
    cur = came.get(cur);
  }
  return out.reverse();
}

class MinHeap {
  private items: { k: number; p: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(k: number, p: number) {
    const a = this.items;
    a.push({ k, p });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.p <= a[i]!.p) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0]!.k;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.p < a[m]!.p) m = l;
        if (r < a.length && a[r]!.p < a[m]!.p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
