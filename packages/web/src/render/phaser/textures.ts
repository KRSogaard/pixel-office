import Phaser from "phaser";
import type { ArtPack, PropName, Sheet } from "../../art/pack.js";

let active: ArtPack | undefined;

/** The art pack the Phaser renderer draws with. Set once at startup. */
export function pack(): ArtPack {
  if (!active) throw new Error("art pack not loaded yet");
  return active;
}

export function usePack(p: ArtPack): void {
  active = p;
}

/** Register a sheet as a Phaser texture with numbered frames. */
export function addSheet(scene: Phaser.Scene, key: string, sheet: Sheet): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.addCanvas(key, sheet.canvas)!;
  const n = Math.floor(sheet.canvas.width / sheet.frameW);
  for (let i = 0; i < n; i++) tex.add(i, 0, i * sheet.frameW, 0, sheet.frameW, sheet.frameH);
}

/**
 * A prop as an image at world size (origin: bottom centre), or undefined when
 * the pack has no image for it and the caller draws it in pixels.
 */
export function propImage(scene: Phaser.Scene, name: PropName): Phaser.GameObjects.Image | undefined {
  const prop = pack().prop(name);
  if (!prop) return undefined;
  const key = `prop:${name}`;
  if (!scene.textures.exists(key)) scene.textures.addImage(key, prop.image)!.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(1 / prop.scale);
}
