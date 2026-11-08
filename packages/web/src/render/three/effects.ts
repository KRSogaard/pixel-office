import * as THREE from "three";

/**
 * One-off effects in 3D: small flat-shaded bits flying, rising and fading.
 * Everything cleans itself up.
 */

interface Bit {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: number;
  gravity: number;
  grow: number;
  born: number;
  life: number;
}

const CONFETTI = [0xff5d5d, 0xf0c45a, 0x5af07a, 0x5ab4f0, 0xd97757, 0xc77dff];

export class Effects {
  private bits: Bit[] = [];
  private fires: { mesh: THREE.Group; until: number; x: number; z: number; lastSmoke: number }[] = [];
  private geom = {
    cube: new THREE.BoxGeometry(1, 1, 1),
    ball: new THREE.IcosahedronGeometry(0.5, 0),
  };
  private now = 0;

  constructor(private scene: THREE.Scene) {}

  update(dtMs: number, now: number): void {
    this.now = now;
    const dt = dtMs / 1000;
    for (const b of [...this.bits]) {
      const age = (now - b.born) / b.life;
      if (age >= 1) {
        this.remove(b);
        continue;
      }
      b.vel.y -= b.gravity * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin * dt;
      b.mesh.rotation.z += b.spin * dt * 0.7;
      if (b.grow) b.mesh.scale.multiplyScalar(1 + b.grow * dt);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - age * age;
    }
    for (const f of [...this.fires]) {
      if (now > f.until) {
        f.mesh.removeFromParent();
        this.fires = this.fires.filter((x) => x !== f);
        continue;
      }
      f.mesh.children.forEach((c, i) => c.scale.set(1, 0.6 + 0.6 * Math.abs(Math.sin(now / 80 + i * 1.7)), 1));
      if (now - f.lastSmoke > 180) {
        f.lastSmoke = now;
        this.bit("ball", 0x555555, new THREE.Vector3(f.x, 1.3, f.z), new THREE.Vector3(rand(-0.2, 0.2), 0.8, rand(-0.2, 0.2)), 0.12, 900, { grow: 1 });
      }
    }
  }

  /** Grey smoke: a tool call failed. */
  puff(x: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      this.bit("ball", 0x888888, new THREE.Vector3(x + rand(-0.2, 0.2), 1.2, z + rand(-0.2, 0.2)), new THREE.Vector3(rand(-0.3, 0.3), rand(0.5, 0.9), rand(-0.3, 0.3)), 0.18, 900 + i * 120, { grow: 1.2 });
    }
  }

  confetti(x: number, z: number): void {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(1, 2.4);
      this.bit("cube", CONFETTI[i % CONFETTI.length]!, new THREE.Vector3(x, 1.4, z), new THREE.Vector3(Math.cos(a) * s * 0.5, rand(2, 3.5), Math.sin(a) * s * 0.5), 0.07, 1600, { gravity: 4, spin: 8, flat: true });
    }
  }

  poof(x: number, z: number, color: number): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.bit("cube", i % 2 ? 0xffffff : color, new THREE.Vector3(x, 0.8, z), new THREE.Vector3(Math.cos(a) * 1.2, rand(-0.3, 0.6), Math.sin(a) * 1.2), 0.07, 500, { spin: 6 });
    }
  }

  sweat(x: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      this.bit("ball", 0x8fd0f0, new THREE.Vector3(x + side * 0.2, 1.45, z), new THREE.Vector3(side * rand(0.3, 0.6), rand(0.4, 0.9), rand(-0.2, 0.2)), 0.06, 700, { gravity: 3 });
    }
  }

  scraps(x: number, y: number, z: number): void {
    for (let i = 0; i < 4; i++) {
      this.bit("cube", 0xf4f1e8, new THREE.Vector3(x, y, z), new THREE.Vector3(rand(-0.6, 0.6), rand(0.8, 1.4), rand(-0.6, 0.6)), 0.08, 600, { gravity: 3, spin: 6, flat: true });
    }
  }

  splat(x: number, z: number): void {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.22, 7), new THREE.MeshBasicMaterial({ color: 0x6fd08c, transparent: true }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    this.scene.add(m);
    this.bits.push({ mesh: m, vel: new THREE.Vector3(), spin: 0, gravity: 0, grow: 0, born: this.now, life: 2700 });
  }

  print(x: number, z: number): void {
    for (let i = 0; i < 3; i++) {
      const m = this.bit("cube", 0xfdfbf5, new THREE.Vector3(x, 0.62, z + 0.2), new THREE.Vector3(0, 0, 0.25), 0.01, 1200, { delay: i * 500 });
      m.scale.set(0.3, 0.01, 0.4);
    }
  }

  fire(x: number, z: number, ms: number): void {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb03c : 0xff5d2a }));
      c.position.set(-0.22 + i * 0.15, 0.95, (i % 2) * 0.1 - 0.05);
      c.geometry.translate(0, 0.2, 0);
      g.add(c);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.fires.push({ mesh: g, until: this.now + ms, x, z, lastSmoke: 0 });
  }

  /** Steam and smoke at the silo. */
  smoke(x: number, z: number, color: number, size: number, ms: number): void {
    this.bit("ball", color, new THREE.Vector3(x + rand(-0.8, 0.8), 0.2, z + rand(-0.8, 0.8)), new THREE.Vector3(rand(-1.2, 1.2), rand(0.3, 1), rand(-1.2, 1.2)), 0.25, ms, { grow: size * 0.6 });
  }

  /** Floating text (the cat's purr, the countdown) that drifts up and fades. */
  text(x: number, y: number, z: number, text: string, color: string, size = 0.5): void {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "bold 40px monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(size * 4, size, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 20;
    this.scene.add(sprite);
    const born = this.now;
    const tick = () => {
      const age = (this.now - born) / 1400;
      if (age >= 1) {
        sprite.removeFromParent();
        tex.dispose();
        sprite.material.dispose();
        return;
      }
      sprite.position.y = y + age * 0.6;
      sprite.material.opacity = 1 - age;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private bit(
    shape: "cube" | "ball",
    color: number,
    at: THREE.Vector3,
    vel: THREE.Vector3,
    size: number,
    life: number,
    o: { gravity?: number; spin?: number; grow?: number; flat?: boolean; delay?: number } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geom[shape], new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.copy(at);
    mesh.scale.setScalar(size);
    if (o.flat) mesh.scale.y = size * 0.3;
    const add = () => {
      this.scene.add(mesh);
      this.bits.push({ mesh, vel, spin: o.spin ?? 0, gravity: o.gravity ?? 0, grow: o.grow ?? 0, born: this.now, life });
    };
    if (o.delay) setTimeout(add, o.delay);
    else add();
    return mesh;
  }

  private remove(b: Bit): void {
    b.mesh.removeFromParent();
    (b.mesh.material as THREE.Material).dispose();
    if (b.mesh.geometry !== this.geom.cube && b.mesh.geometry !== this.geom.ball) b.mesh.geometry.dispose();
    this.bits = this.bits.filter((x) => x !== b);
  }
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
