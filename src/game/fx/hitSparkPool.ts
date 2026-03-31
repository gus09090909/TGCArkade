import Phaser from 'phaser';

type Particle = {
  circle: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
};

type Burst = {
  life: number;
  particles: Particle[];
};

/**
 * Pooled radial sparks (CreateJS explosion analogue: small circles, outward velocity, fade with life).
 */
export class HitSparkPool {
  private bursts: Burst[] = [];

  constructor(
    private scene: Phaser.Scene,
    depth: number,
    poolSize = 10,
    perBurst = 16
  ) {
    for (let b = 0; b < poolSize; b++) {
      const particles: Particle[] = [];
      for (let i = 0; i < perBurst; i++) {
        const circle = scene.add.circle(-2000, -2000, 2, 0xeeeeee, 1).setDepth(depth).setVisible(false);
        particles.push({ circle, vx: 0, vy: 0 });
      }
      this.bursts.push({ life: 0, particles });
    }
  }

  burst(x: number, y: number) {
    const slot = this.bursts.find((b) => b.life <= 0);
    if (!slot) return;
    slot.life = 1;
    for (const p of slot.particles) {
      const angle = Math.random() * Math.PI * 2;
      const mag = Math.random() * 220 + 40;
      p.vx = Math.cos(angle) * mag;
      p.vy = -Math.abs(Math.sin(angle) * mag) * 0.85 - 20;
      const r = Math.random() * 3 + 0.8;
      p.circle.setRadius(r);
      p.circle.setPosition(x, y);
      p.circle.setVisible(true);
      p.circle.setAlpha(1);
      p.circle.setScale(1);
    }
  }

  update(dtSec: number) {
    const decay = dtSec * 1.85;
    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      b.life -= decay;
      const life = Math.max(0, b.life);
      for (const p of b.particles) {
        if (life <= 0.02) {
          p.circle.setVisible(false);
          continue;
        }
        p.circle.x += p.vx * dtSec;
        p.circle.y += p.vy * dtSec;
        p.circle.setAlpha(life);
        p.circle.setScale(Math.max(0.05, life));
      }
      if (life <= 0) b.life = 0;
    }
  }

  destroy() {
    for (const b of this.bursts) {
      for (const p of b.particles) p.circle.destroy();
    }
    this.bursts = [];
  }
}
