/**
 * Day and night, following the viewer's local clock: daylight from 8 to 17,
 * warm dusk and dawn, a dark blue night. Shared by every renderer.
 */

export interface Tint {
  color: number;
  /** 0 = no tint, 1 = full. */
  strength: number;
}

/** The tint for a fractional hour of the day (0–24). Pure, for tests. */
export function tintAt(hour: number): Tint {
  const night = { color: 0x2c3566, strength: 0.62 };
  const dusk = { color: 0xffb37a, strength: 0.28 };
  const day = { color: 0xffffff, strength: 0 };
  const mix = (a: Tint, b: Tint, t: number): Tint => {
    const ch = (v: number, shift: number) => (v >> shift) & 0xff;
    const blend = (shift: number) => Math.round(ch(a.color, shift) + (ch(b.color, shift) - ch(a.color, shift)) * t);
    return { color: (blend(16) << 16) | (blend(8) << 8) | blend(0), strength: a.strength + (b.strength - a.strength) * t };
  };
  const lerp = (from: Tint, to: Tint, h0: number, h1: number) => mix(from, to, (hour - h0) / (h1 - h0));
  if (hour < 5 || hour >= 21) return night;
  if (hour < 7) return lerp(night, dusk, 5, 7);
  if (hour < 8) return lerp(dusk, day, 7, 8);
  if (hour < 17) return day;
  if (hour < 19) return lerp(day, dusk, 17, 19);
  return lerp(dusk, night, 19, 21);
}
