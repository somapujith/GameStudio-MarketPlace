import { describe, expect, it } from 'vitest';
import { createVehicleKit } from './street-vehicles.js';
import { createKit } from './kit.js';
import { createTracker } from './tracker.js';

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('the instanced traffic geometry (street-vehicles.js)', () => {
  const k = createKit(createTracker());
  const V = createVehicleKit(k);
  const types = ['auto', 'bike', 'car', 'bus', 'bicycle'];

  it('builds every vehicle and pedestrian as ONE merged body (+ lights) with the attributes the instanced material needs', () => {
    for (const t of types) {
      const g = V[t]();
      expect(g.body, t).toBeTruthy();
      for (const n of ['position', 'normal', 'color', 'uv']) expect(g.body.attributes[n], `${t}.${n}`).toBeTruthy();
      // the per-instance tint reads uv.x (1 on the parts painted white, 0 elsewhere)
      const uv = g.body.attributes.uv;
      let tint = 0;
      for (let i = 0; i < uv.count; i++) {
        expect([0, 1]).toContain(uv.getX(i));
        tint += uv.getX(i);
      }
      if (t === 'bus' || t === 'bike' || t === 'auto' || t === 'car') expect(tint, `${t} has tintable parts`).toBeGreaterThan(0);
    }
    for (const w of [V.walkerTorso(), V.walkerLeg()]) expect(w.body.attributes.position.count).toBeGreaterThan(0);
  });

  it('big body panels are rounded (more triangles than a plain box has), and the whole bus stays light', () => {
    // a bus of plain boxes is ~ 80 boxes = ~1000 triangles; with softened panels it is some thousands: instanced, so the GPU cost is nil
    const bus = tris(V.bus().body);
    expect(bus).toBeGreaterThan(1500);
    expect(bus).toBeLessThan(40000);
    for (const t of types) expect(tris(V[t]().body), t).toBeLessThan(40000);
  });

  it('shades the lower part of vehicles darker than the roof, but leaves pedestrians as painted', () => {
    const lum = (g, lo, hi) => {
      const p = g.attributes.position;
      const c = g.attributes.color;
      let s = 0;
      let n = 0;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y >= lo && y < hi && c.getX(i) > 0.5) {
          s += c.getX(i);
          n++;
        }
      }
      return n ? s / n : 0;
    };
    const bus = V.bus().body; // painted '#ffffff' panels: low ones are darker than the roof
    expect(lum(bus, 0.9, 1.1)).toBeLessThan(lum(bus, 2.6, 3.0));
    const torso = V.walkerTorso().body;
    expect(lum(torso, 1.1, 1.3)).toBeGreaterThan(0.9); // the shirt is still white, to be tinted per walker
  });
});
