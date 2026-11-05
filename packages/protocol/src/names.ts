const NAMES = [
  "Ada", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun",
  "Kai", "Lena", "Milo", "Nia", "Otto", "Pia", "Quin", "Rui", "Sana", "Theo",
  "Uma", "Vik", "Wren", "Xia", "Yara", "Zed", "Asha", "Bo", "Cyra", "Dax",
  "Edda", "Finn", "Gia", "Hugo", "Ines", "Jax", "Kira", "Leo", "Mira", "Noor",
  "Odin", "Pax", "Rhea", "Sol", "Tove", "Ula", "Vera", "Wim", "Yuki", "Zara",
];

/** FNV-1a 32-bit. Stable across server and browser. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A first name for an agent, stable per id. Skips names already used by agents
 * in the office, so two people on screen never share a name (until all 50 are taken).
 */
export function nameFor(agentId: string, taken: ReadonlySet<string> = new Set()): string {
  const start = hash(agentId) % NAMES.length;
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[(start + i) % NAMES.length]!;
    if (!taken.has(name)) return name;
  }
  return NAMES[start]!;
}
