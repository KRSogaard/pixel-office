/** A whole number from `min` to `max`, both included. */
export function between(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** A number from `min` up to (not including) `max`. */
export function floatBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

export function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
