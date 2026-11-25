// Small allocation-free animated effects shared by stations, customers and street props.
// `Puffs` is the original cheap sphere-puff emitter (customers and street props still use it); the station models use the soft
// shader particles of shaders/steam.js instead. `ReadyRing` is the faint "take me" halo under a finished dish.
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import { unit } from './util.js';

export class Puffs {
  /** `count` shared-geometry spheres that rise and swell, then vanish. */
  constructor(parent, mat, count, { x = 0, y = 0, z = 0, rise = 0.3, size = 0.04, speed = 0.5, drift = 0.03 } = {}) {
    this.items = [];
    this.o = { x, y, z, rise, size, speed, drift };
    for (let i = 0; i < count; i++) {
      const m = new Mesh(unit.sphere(5), mat);
      m.visible = false;
      m.scale.setScalar(0.001);
      parent.add(m);
      this.items.push(m);
    }
  }
  update(t, on, phase = 0) {
    const { x, y, z, rise, size, speed, drift } = this.o;
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const m = this.items[i];
      if (!on) {
        m.visible = false;
        continue;
      }
      const ph = (t * speed + phase + i / n) % 1;
      const s = size * Math.sin(Math.PI * ph) * (0.6 + 0.8 * ph);
      m.visible = s > 0.004;
      m.position.set(x + Math.sin(t * 1.3 + i * 2.1 + phase) * drift * ph, y + rise * ph, z + Math.cos(t * 1.1 + i * 1.7) * drift * 0.5 * ph);
      m.scale.setScalar(s);
    }
  }
}

/** A soft additive ring lying on a surface; pulses while `on`. Owns its material (dispose() frees it). */
export class ReadyRing {
  constructor(parent, x, y, z, r = 0.15, color = '#ffe27a') {
    this.mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide, blending: AdditiveBlending });
    this.mesh = new Mesh(unit.ring(r, r + 0.012, 28), this.mat);
    this.mesh.position.set(x, y, z);
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  update(t, on) {
    this.mesh.visible = on;
    if (on) this.mat.opacity = 0.12 + 0.1 * Math.sin(t * 5);
  }
  dispose() {
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
