/**
 * Which decorations are up on a given day. Pure (no Phaser), so it's testable.
 * `?date=2026-12-24` in the URL previews a date.
 */

export function today(): Date {
  const forced = new URLSearchParams(location.search).get("date");
  const d = forced ? new Date(`${forced}T12:00:00`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface Season {
  christmas: boolean;
  halloween: boolean;
  newYear: boolean;
  snow: boolean;
  birthday: boolean;
}

/** Pure, for tests. `since` is the office's first event (epoch ms), if known. */
export function seasonOn(d: Date, since?: number): Season {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const first = since ? new Date(since) : undefined;
  return {
    christmas: m === 12,
    halloween: (m === 10 && day >= 15) || (m === 11 && day === 1),
    newYear: (m === 12 && day === 31) || (m === 1 && day === 1),
    snow: m === 12 || m === 1 || m === 2,
    birthday: !!first && first.getMonth() === d.getMonth() && first.getDate() === day && first.getFullYear() < d.getFullYear(),
  };
}

