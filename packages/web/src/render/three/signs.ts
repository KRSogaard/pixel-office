import * as THREE from "three";
import type { Sign } from "../renderer.js";
import { GLASS_H, hex } from "./office.js";

/** Plate height (units). */
const PLATE_H = 0.5;
/** Leaned back towards the camera (radians), like a name plate on a desk, so it reads from above. */
const LEAN = 0.7;
/** Canvas pixels per unit of plate. */
const RES = 96;

/**
 * The name plates on the team offices: a panel on top of the glass front,
 * facing the camera, with the project in bold and manager · person · branch
 * under it, edged in the session's colour. A plate's texture is redrawn only
 * when its text or colour changes.
 */
export class Signs {
  readonly group = new THREE.Group();
  private plates = new Map<string, { id: string; mesh: THREE.Mesh; texture: THREE.CanvasTexture }>();

  update(signs: readonly Sign[]): void {
    const live = new Set(signs.map((s) => s.key));
    for (const [k, p] of this.plates) {
      if (live.has(k)) continue;
      this.remove(k, p);
    }
    for (const s of signs) {
      const id = `${s.x},${s.y},${s.w},${s.color},${s.title},${s.subtitle}`;
      const old = this.plates.get(s.key);
      if (old?.id === id) continue;
      if (old) this.remove(s.key, old);
      this.plates.set(s.key, { id, ...this.make(s) });
    }
  }

  private make(s: Sign): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
    const c = document.createElement("canvas");
    c.width = Math.round(s.w * RES);
    c.height = Math.round(PLATE_H * RES);
    const g = c.getContext("2d")!;
    g.fillStyle = "#1d1f27";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = hex(s.color);
    g.fillRect(0, 0, 10, c.height);
    g.fillRect(0, c.height - 4, c.width, 4);
    const fit = (text: string, font: string, max: number) => {
      g.font = font;
      let t = text;
      while (g.measureText(t).width > max && t.length > 3) t = `${t.slice(0, -2)}…`;
      return t;
    };
    const max = c.width - 26;
    g.textBaseline = "top";
    g.fillStyle = "#f2e6c9";
    g.fillText(fit(s.title, "bold 24px monospace", max), 18, 5);
    g.fillStyle = "#c9cfdb";
    g.fillText(fit(s.subtitle, "17px monospace", max), 18, 28);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // Unlit, so it reads at night too.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, PLATE_H), new THREE.MeshBasicMaterial({ map: texture }));
    // Hinged on the top rail of the glass front, leaning back.
    mesh.geometry.translate(0, PLATE_H / 2, 0);
    mesh.position.set(s.x + s.w / 2, GLASS_H, s.y + 0.5 + 0.03);
    mesh.rotation.x = -LEAN;
    this.group.add(mesh);
    return { mesh, texture };
  }

  private remove(key: string, p: { mesh: THREE.Mesh; texture: THREE.CanvasTexture }): void {
    p.mesh.removeFromParent();
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    p.texture.dispose();
    this.plates.delete(key);
  }
}
