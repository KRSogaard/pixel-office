import { loadPack } from "../art/pack.js";
import type { StyleId } from "../art/style.js";
import type { Renderer } from "./renderer.js";

/** The renderer for an art style, with its art loaded. Each style's code is only downloaded when it's picked. */
export async function createRenderer(style: StyleId): Promise<Renderer> {
  switch (style) {
    case "lowpoly": {
      const { ThreeRenderer } = await import("./three/index.js");
      return ThreeRenderer.load();
    }
    case "pixel": {
      const [{ PhaserRenderer }, art] = await Promise.all([import("./phaser/index.js"), loadPack()]);
      return new PhaserRenderer(art);
    }
  }
}
