import Phaser from "phaser";

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
