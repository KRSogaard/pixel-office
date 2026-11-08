/**
 * Art styles: how the office looks. The office logic (the world) is the same
 * in every style; each style comes with its own renderer and art. The flat
 * styles (pixel, toon) are drawn by the Phaser renderer from an art pack (see
 * `pack.ts`); the low-poly 3D style is drawn with Three.js.
 *
 * The style is picked per browser and applied by reloading the page, so no
 * code has to swap renderers under a running office.
 *
 * To add a style: add it here, and give `render/index.ts` a case for it.
 */

export type StyleId = "pixel" | "toon" | "lowpoly";

export const STYLES: { id: StyleId; label: string }[] = [
  { id: "pixel", label: "Pixel" },
  { id: "toon", label: "Toon" },
  { id: "lowpoly", label: "3D" },
];

const KEY = "po.style";

/** The style for this browser: `?style=toon` in the URL (for TVs, which have no top bar), else the dropdown's choice. */
export function chosenStyle(): StyleId {
  let id = new URLSearchParams(location.search).get("style");
  if (STYLES.some((s) => s.id === id)) return id as StyleId;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: use the default.
  }
  return STYLES.some((s) => s.id === id) ? (id as StyleId) : "pixel";
}

/** Switch styles: remembered for this browser, applied by reloading. */
export function chooseStyle(id: StyleId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: the reload below falls back to the default.
  }
  // A ?style= in the URL would override the new choice; drop it.
  const url = new URL(location.href);
  url.searchParams.delete("style");
  location.replace(url.toString());
}
