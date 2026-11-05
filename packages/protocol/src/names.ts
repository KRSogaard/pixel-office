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

export function nameFor(agentId: string): string {
  return NAMES[hash(agentId) % NAMES.length]!;
}
