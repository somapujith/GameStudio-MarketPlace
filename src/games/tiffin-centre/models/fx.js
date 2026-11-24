// Small allocation-free animated effects shared by stations, customers and street props.
import { Mesh } from 'three';
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
