import * as THREE from "three";
import type { Offering } from "../../world/shrine.js";
import { toFloor } from "./space.js";

/**
 * Today's offerings at the feet of the statue in the meeting room (coffee
 * cups, crashed rockets, red ✗'s), as little emoji standing on the floor.
 * Rebuilt only when the pile changes.
 */
export class OfferingsView {
  private sprites: THREE.Sprite[] = [];
  private key = "";
  private textures = new Map<string, THREE.CanvasTexture>();

  constructor(private scene: THREE.Scene) {}

  update(list: Offering[]): void {
    const key = list.map((o) => `${o.emoji}${o.x},${o.y}`).join("|");
    if (key === this.key) return;
    this.key = key;
    for (const s of this.sprites) {
      s.removeFromParent();
      s.material.dispose();
    }
    this.sprites = list.map((o) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(o.emoji), transparent: true, rotation: (-o.angle * Math.PI) / 180 }));
      const at = toFloor(o.x, o.y);
      sprite.scale.setScalar(0.24);
      sprite.position.set(at.x, 0.12, at.z);
      this.scene.add(sprite);
      return sprite;
    });
  }

  private texture(emoji: string): THREE.CanvasTexture {
    let tex = this.textures.get(emoji);
    if (!tex) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      g.font = "52px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(emoji, 32, 36);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(emoji, tex);
    }
    return tex;
  }
}
