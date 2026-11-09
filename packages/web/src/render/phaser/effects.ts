import Phaser from "phaser";
import { propImage } from "./textures.js";

/** One-off particle effects. Everything cleans itself up. */

const TOP = 100_000;

/** Grey smoke puff: a tool call failed. */
export function puff(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 5; i++) {
    const g = scene.add.circle(x + Phaser.Math.Between(-4, 4), y - 18, Phaser.Math.Between(2, 4), 0x888888, 0.8).setDepth(TOP);
    scene.tweens.add({
      targets: g,
      y: g.y - Phaser.Math.Between(8, 16),
      x: g.x + Phaser.Math.Between(-6, 6),
      alpha: 0,
      scale: 2,
      duration: 900 + i * 120,
      onComplete: () => g.destroy(),
    });
  }
}

const CONFETTI = [0xff5d5d, 0xf0c45a, 0x5af07a, 0x5ab4f0, 0xd97757, 0xc77dff];

/** Confetti burst: tests passed. */
export function confetti(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 26; i++) {
    const r = scene.add.rectangle(x, y - 22, 2, 2, CONFETTI[i % CONFETTI.length]!).setDepth(TOP);
    const angle = Phaser.Math.FloatBetween(-Math.PI * 0.95, -Math.PI * 0.05);
    const speed = Phaser.Math.Between(18, 42);
    scene.tweens.add({
      targets: r,
      x: x + Math.cos(angle) * speed,
      y: y - 22 + Math.sin(angle) * speed,
      duration: 450,
      ease: "Quad.easeOut",
      onComplete: () =>
        scene.tweens.add({
          targets: r,
          y: r.y + Phaser.Math.Between(14, 26),
          x: r.x + Phaser.Math.Between(-5, 5),
          angle: Phaser.Math.Between(-180, 180),
          alpha: 0,
          duration: 1100,
          ease: "Sine.easeIn",
          onComplete: () => r.destroy(),
        }),
    });
  }
}

/** A puff of sparkles: a sub-agent pops into existence next to its parent. */
export function poof(scene: Phaser.Scene, x: number, y: number, color: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = scene.add.rectangle(x, y - 10, 2, 2, i % 2 ? 0xffffff : color).setDepth(TOP);
    scene.tweens.add({
      targets: s,
      x: x + Math.cos(a) * 12,
      y: y - 10 + Math.sin(a) * 10,
      alpha: 0,
      duration: 500,
      ease: "Quad.easeOut",
      onComplete: () => s.destroy(),
    });
  }
}

/** Paper scraps flying out of a bin being stomped. */
export function scraps(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 4; i++) {
    const p = scene.add.rectangle(x, y - 6, 3, 2, 0xf4f1e8).setDepth(TOP);
    scene.tweens.add({
      targets: p,
      x: x + Phaser.Math.Between(-10, 10),
      y: y - Phaser.Math.Between(8, 16),
      angle: Phaser.Math.Between(-90, 90),
      alpha: 0,
      duration: 600,
      onComplete: () => p.destroy(),
    });
  }
}

/** A little rocket launching from a desk: something was shipped. */
export function rocket(scene: Phaser.Scene, x: number, y: number): void {
  const g = scene.add.graphics().setDepth(TOP);
  const draw = () => {
    g.clear();
    g.fillStyle(0xe9e4d8, 1).fillRect(-2, -7, 4, 8);
    g.fillStyle(0xc0504d, 1).fillRect(-2, -9, 4, 2).fillRect(-1, -10, 2, 1);
    g.fillStyle(0x4fa3d1, 1).fillRect(-1, -5, 2, 2);
    g.fillStyle(0xc0504d, 1).fillRect(-4, -1, 2, 3).fillRect(2, -1, 2, 3);
    g.fillStyle(Math.random() > 0.5 ? 0xffe066 : 0xff9a3c, 1).fillRect(-1, 1, 2, 3);
  };
  g.setPosition(x + 8, y - 8);
  const timer = scene.time.addEvent({ delay: 60, loop: true, callback: draw });
  draw();
  scene.tweens.add({
    targets: g,
    y: y - 90,
    duration: 1500,
    ease: "Cubic.easeIn",
    onUpdate: () => {
      if (Math.random() < 0.5) {
        const s = scene.add.circle(g.x + Phaser.Math.Between(-1, 1), g.y + 4, 2, 0xcccccc, 0.8).setDepth(TOP - 1);
        scene.tweens.add({ targets: s, alpha: 0, scale: 2.5, duration: 700, onComplete: () => s.destroy() });
      }
    },
    onComplete: () => {
      timer.remove();
      g.destroy();
    },
  });
}

/** Flames on a lab bench for a few seconds: tests keep failing. */
export function fire(scene: Phaser.Scene, x: number, y: number, ms = 7000): void {
  const g = scene.add.graphics().setDepth(TOP - 2);
  const timer = scene.time.addEvent({
    delay: 90,
    loop: true,
    callback: () => {
      g.clear();
      for (let i = 0; i < 4; i++) {
        const fx = x + i * 3 - 5;
        const h = Phaser.Math.Between(4, 9);
        g.fillStyle(0xff5d2a, 1).fillRect(fx, y - h, 3, h);
        g.fillStyle(0xffb03c, 1).fillRect(fx + 1, y - h + 2, 1, h - 2);
      }
      if (Math.random() < 0.4) {
        const s = scene.add.circle(x + Phaser.Math.Between(-4, 4), y - 10, 2, 0x555555, 0.7).setDepth(TOP - 3);
        scene.tweens.add({ targets: s, y: s.y - 14, alpha: 0, scale: 2, duration: 900, onComplete: () => s.destroy() });
      }
    },
  });
  scene.time.delayedCall(ms, () => {
    timer.remove();
    g.destroy();
  });
}

/** Sweat drops flying off someone's head: they just ran something scary. */
export function sweat(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const d = scene.add.rectangle(x + side * 5, y - 22, 1, 2, 0x8fd0f0).setDepth(TOP);
    scene.tweens.add({
      targets: d,
      x: d.x + side * Phaser.Math.Between(4, 8),
      y: d.y + Phaser.Math.Between(4, 10),
      alpha: 0,
      delay: i * 120,
      duration: 500,
      onComplete: () => d.destroy(),
    });
  }
}

/** A rubber duck to explain the problem to. Returns it so the caller can remove it. */
export function duck(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Graphics | Phaser.GameObjects.Image {
  const image = propImage(scene, "duck");
  if (image) return image.setPosition(x + 4, y + 5).setDepth(y + 2);
  const g = scene.add.graphics().setDepth(y + 2);
  g.fillStyle(0xffd23f, 1).fillRect(x, y + 2, 6, 3).fillRect(x + 3, y, 3, 3);
  g.fillStyle(0xff8c1a, 1).fillRect(x + 6, y + 1, 2, 1);
  g.fillStyle(0x1d1f27, 1).fillRect(x + 4, y + 1, 1, 1);
  return g;
}

/** Pages sliding out of a printer at (x, y), the printer's paper slot. */
export function printPages(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    const p = scene.add.rectangle(x, y, 6, 2, 0xfdfbf5).setOrigin(0.5, 0).setDepth(TOP - 2);
    scene.tweens.add({
      targets: p,
      height: 7,
      y: y + 1,
      delay: i * 500,
      duration: 400,
      onComplete: () =>
        scene.tweens.add({ targets: p, y: y + 6, alpha: 0, delay: 300, duration: 400, onComplete: () => p.destroy() }),
    });
  }
}

/**
 * The Almighty Prompter approves: the statue's eyes glow and a beam of light
 * falls from above onto the agent at (x, y), with a few motes drifting down.
 * `statue`: the middle of the statue's top tile (its eyes are just above it).
 */
export function blessed(scene: Phaser.Scene, x: number, y: number, statue?: { x: number; y: number }): void {
  if (statue) {
    for (const dx of [-1.5, 1.5]) {
      const eye = scene.add.circle(statue.x + dx, statue.y - 10.5, 1.2, 0xfff7c0).setDepth(TOP).setBlendMode(Phaser.BlendModes.ADD);
      const halo = scene.add.circle(statue.x + dx, statue.y - 10.5, 4, 0xffe27a, 0.5).setDepth(TOP).setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({ targets: [eye, halo], alpha: 0, delay: 1300, duration: 500, onComplete: () => (eye.destroy(), halo.destroy()) });
    }
  }
  const beam = scene.add.rectangle(x, y - 40, 14, 80, 0xfff2a8, 0).setDepth(TOP).setBlendMode(Phaser.BlendModes.ADD);
  const core = scene.add.rectangle(x, y - 40, 6, 80, 0xffffff, 0).setDepth(TOP).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: beam,
    fillAlpha: 0.45,
    duration: 350,
    yoyo: true,
    hold: 900,
    onComplete: () => beam.destroy(),
  });
  scene.tweens.add({
    targets: core,
    fillAlpha: 0.35,
    duration: 350,
    yoyo: true,
    hold: 900,
    onComplete: () => core.destroy(),
  });
  for (let i = 0; i < 10; i++) {
    const mote = scene.add.rectangle(x + Phaser.Math.Between(-6, 6), y - Phaser.Math.Between(50, 75), 1, 1, 0xfff7c0).setDepth(TOP);
    scene.tweens.add({
      targets: mote,
      y: y - Phaser.Math.Between(10, 20),
      alpha: 0,
      delay: i * 90,
      duration: 1100,
      onComplete: () => mote.destroy(),
    });
  }
}

/**
 * The Almighty Prompter denies: a little storm cloud rains on the agent for a
 * few seconds, following it as it walks off. `follow`: where the agent is now.
 */
export function storm(scene: Phaser.Scene, x: number, y: number, follow: () => { x: number; y: number } | undefined): void {
  const cloud = scene.add.container(x, y - 38).setDepth(TOP);
  for (const [cx, cy, r] of [[-5, 1, 4], [0, -1, 5], [5, 1, 4], [0, 2, 4]] as const) cloud.add(scene.add.circle(cx, cy, r, 0x5c6170));
  cloud.add(scene.add.circle(-1, -2, 2.5, 0x7a8090));
  const drops: Phaser.GameObjects.Rectangle[] = [];
  const until = scene.time.now + 4500;
  const tick = scene.time.addEvent({
    delay: 70,
    loop: true,
    callback: () => {
      const at = follow() ?? { x: cloud.x, y: cloud.y + 38 };
      cloud.setPosition(at.x, at.y - 38 + Math.sin(scene.time.now / 300));
      if (scene.time.now > until) {
        tick.remove();
        scene.tweens.add({ targets: cloud, alpha: 0, duration: 400, onComplete: () => cloud.destroy() });
        return;
      }
      const d = scene.add.rectangle(at.x + Phaser.Math.Between(-7, 7), at.y - 33, 1, 3, 0x8fd0f0).setDepth(TOP);
      drops.push(d);
      scene.tweens.add({ targets: d, y: at.y - 6, duration: 380, onComplete: () => d.destroy() });
      // A flash of lightning now and then.
      if (Math.random() < 0.04) {
        const bolt = scene.add.rectangle(at.x + 2, at.y - 28, 1, 8, 0xfff27a).setDepth(TOP).setAngle(15);
        scene.time.delayedCall(90, () => bolt.destroy());
      }
    },
  });
}
