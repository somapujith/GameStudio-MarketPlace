// Street vehicles: Bajaj-style auto-rickshaw, scooter, motorbike. Origin = ground centre, front = +z, wheels are spinning sub-groups
// (out.setSpeed(m/s) rolls them), the canvas hood flutters a little. Real sizes: auto 2.6 x 1.3 x 1.75 m, scooter 1.8 m, bike 1.95 m.
import { LatheGeometry, PlaneGeometry } from 'three';
import { archGeometry, loftGeometry } from './street-kit.js';
import { autoRearArt, autoSideArt, meterFace, numberPlate } from './street-art.js';

const PI = Math.PI;

/** A spinning wheel sub-group at (x, y, z), radius R, tyre width w. tint = rim colour. */
function wheel(k, name, x, y, z, R, w, { tint = '#9aa0a5', spokes = 0, section = 0.5 } = {}) {
  const W = k.sub(name, [x, y, z]);
  const t = w * section; // tyre section radius
  W.tor('tyre', R - t, t, 6, 18, { p: [x, y, z], r: [0, PI / 2, 0], s: [1, 1, w / (2 * t)] });
  if (spokes) W.tor('stainless', R - t * 1.9, w * 0.07, 5, 28, { p: [x, y, z], r: [0, PI / 2, 0] });
  else W.cyl('paintWorn', R - t * 1.35, R - t * 1.35, w * 0.8, 14, { p: [x, y, z], r: [0, 0, PI / 2], tint });
  W.cyl('steelDark', R * 0.2, R * 0.2, w * 0.95, 12, { p: [x, y, z], r: [0, 0, PI / 2] });
  if (spokes) {
    for (let i = 0; i < spokes; i++) W.box('stainless', 0.004, (R - t * 1.9) * 2, 0.004, { p: [x, y, z], r: [(i * PI) / spokes, 0, 0], tint: '#c8cdd0' });
  } else {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      W.cyl('chrome', R * 0.035, R * 0.035, 0.012, 8, { p: [x + Math.sign(x || 1) * (w * 0.5 + 0.002), y + Math.cos(a) * R * 0.38, z + Math.sin(a) * R * 0.38], r: [0, 0, PI / 2] });
    }
  }
  return W;
}

/** Half wheel-arch fender (a lathe arc about the x axis). */
function fender(k, x, y, z, R, width, tint, mat = 'paint') {
  const hw = width / 2;
  k.add(new LatheGeometry([[R, -hw], [R + 0.014, -hw + 0.012], [R + 0.018, 0], [R + 0.014, hw - 0.012], [R, hw]].map((p) => ({ x: p[0], y: p[1] })), 14, 0, PI), mat, { p: [x, y, z], r: [0, 0, PI / 2], tint });
}

export const PROPS_VEH = {
  // ---------------------------------------------------------------------------------------------------------------------------
  'auto-rickshaw': {
    key: (o) => `${o.body || ''}:${o.roof || ''}:${o.plate || ''}`,
    build(k, o) {
      const Y = o.body || '#f2c20f';
      const K = o.roof || '#1b1a19';
      const BLK = '#141312';
      // main (static): floor, lower body, nose, front dash
      k.rbox('paintWorn', 1.16, 0.06, 1.75, 0.01, { p: [0, 0.3, -0.35], tint: BLK }, 1);
      for (const sx of [-1, 1]) {
        k.rbox('paint', 0.06, 0.33, 1.42, 0.02, { p: [sx * 0.625, 0.5, -0.5], tint: Y, vary: 0.02 }, 2); // side sill panels
        k.rbox('paint', 0.1, 0.62, 0.7, 0.03, { p: [sx * 0.6, 0.62, -0.95], tint: Y }, 2); // rear quarter
        k.rbox('paintWorn', 0.12, 0.05, 0.22, 0.01, { p: [sx * 0.66, 0.32, -0.05], tint: BLK }, 1); // step
      }
      k.rbox('paint', 1.28, 0.55, 0.1, 0.04, { p: [0, 0.6, -1.26], tint: Y }, 2); // rear panel
      k.rbox('paint', 1.22, 0.3, 0.55, 0.06, { p: [0, 0.86, -1.0], tint: Y }, 2); // engine shoulder
      k.rbox('paint', 1.0, 0.5, 0.08, 0.03, { p: [0, 0.7, 0.48], r: [-0.28, 0, 0], tint: Y }, 2); // dash / leg shield
      // the nose: one lofted snout, narrow at the tip, flowing back into the broad dash
      k.add(loftGeometry([[1.33, 0.5, 0.05, 0.05], [1.25, 0.52, 0.11, 0.1], [1.1, 0.56, 0.22, 0.16], [0.9, 0.6, 0.34, 0.21], [0.7, 0.64, 0.46, 0.25], [0.5, 0.67, 0.55, 0.27]], { around: 20, pow: 2.3 }), 'paint', { tint: Y, proj: 'box' });
      fender(k, 0, 0.215, 1.12, 0.235, 0.17, Y);
      for (const sx of [-1, 1]) fender(k, sx * 0.64, 0.215, -0.62, 0.24, 0.18, Y);
      // headlamp on a bracket above the front mudguard
      k.cyl('stainless', 0.012, 0.012, 0.2, 8, { p: [0, 0.78, 0.98] });
      k.cyl('chrome', 0.082, 0.09, 0.075, 18, { p: [0, 0.9, 1.04], r: [PI / 2, 0, 0] });
      k.tor('chrome', 0.082, 0.01, 6, 18, { p: [0, 0.9, 1.08] });
      k.cap('glow', 0.075, 1.25, 14, 4, { p: [0, 0.9, 1.065], r: [PI / 2, 0, 0], tint: '#fff2c0' });
      k.rbox('stainless', 0.36, 0.012, 0.012, 0.004, { p: [0, 0.5, 1.26] }, 1); // bumper strip
      // seats (vinyl) and the bench frame
      k.rbox('vinyl', 0.6, 0.11, 0.44, 0.03, { p: [0, 0.58, 0.18] }, 2);
      k.rbox('vinyl', 0.6, 0.3, 0.08, 0.03, { p: [0, 0.78, -0.08], r: [-0.12, 0, 0] }, 2);
      k.rbox('vinyl', 1.12, 0.12, 0.5, 0.035, { p: [0, 0.58, -0.62] }, 2);
      k.rbox('vinyl', 1.12, 0.44, 0.1, 0.04, { p: [0, 0.88, -1.02], r: [-0.1, 0, 0] }, 2);
      // hood: canvas on bows, with visor lip
      const hood = k.sub('hood', [0, 1.5, 0]);
      hood.add(archGeometry(1.4, 0.26, 1.78, { across: 12, along: 6, zSlope: -0.07 }), 'canvas', { p: [0, 1.5, -0.4], tint: K, proj: 'box', vary: 0.02 });
      hood.add(archGeometry(1.4, 0.26, 0.32, { across: 12, along: 1, zSlope: 0 }), 'vinyl', { p: [0, 1.46, 0.6], r: [0.5, 0, 0], tint: K });
      for (const z of [-1.1, -0.4, 0.28]) {
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const a = -PI / 2 + (i / 8) * PI;
          pts.push([0.68 * Math.sin(a), 1.5 + 0.255 * Math.cos(a), z]);
        }
        hood.tube('steelDark', pts, 0.008, { tint: '#2a2826' }, 14, 4);
      }
      // canvas drops: rear curtain and side quarters (roll-ups), black
      hood.add(new PlaneGeometry(1.34, 0.5), 'canvas', { p: [0, 1.27, -1.27], r: [0.04, 0, 0], tint: K });
      for (const sx of [-1, 1]) hood.add(new PlaneGeometry(0.62, 0.46), 'canvas', { p: [sx * 0.675, 1.29, -0.95], r: [0, sx * (PI / 2) + 0.02 * sx, 0], tint: K });
      // pillars, windscreen
      for (const sx of [-1, 1]) {
        k.cyl('steelDark', 0.016, 0.016, 0.78, 8, { p: [sx * 0.6, 1.25, 0.42], r: [-0.23, 0, 0], tint: BLK });
        k.cyl('steelDark', 0.016, 0.016, 0.74, 8, { p: [sx * 0.62, 1.15, -1.1], tint: BLK });
        k.cyl('stainless', 0.01, 0.01, 0.55, 8, { p: [sx * 0.64, 1.0, -0.4], r: [PI / 2, 0, 0] }); // grab rail
      }
      k.add(new PlaneGeometry(1.1, 0.72), 'glass', { p: [0, 1.28, 0.44], r: [-0.23, 0, 0], tint: '#dcefee', proj: 'keep' });
      k.rbox('steelDark', 1.14, 0.03, 0.03, 0.006, { p: [0, 0.93, 0.5], tint: BLK }, 1);
      // steering: fork tube, handlebar, grips, cluster, mirrors
      k.cyl('stainless', 0.018, 0.018, 0.7, 8, { p: [0, 0.78, 1.0], r: [0.42, 0, 0] });
      k.cyl('stainless', 0.012, 0.012, 0.72, 8, { p: [0, 1.0, 0.7], r: [0, 0, PI / 2] });
      for (const sx of [-1, 1]) {
        k.cyl('rubber', 0.017, 0.017, 0.12, 8, { p: [sx * 0.34, 1.0, 0.7], r: [0, 0, PI / 2] });
        k.cyl('stainless', 0.005, 0.005, 0.34, 6, { p: [sx * 0.52, 1.14, 0.56], r: [0.2, 0, sx * -0.3] });
        k.cyl('chrome', 0.045, 0.045, 0.012, 14, { p: [sx * 0.55, 1.28, 0.55], r: [PI / 2 - 0.3, 0, 0] });
      }
      k.cyl('enamel', 0.05, 0.055, 0.04, 14, { p: [0, 1.04, 0.72], r: [-0.7, 0, 0], tint: '#101010' }); // speedo
      k.rbox('enamel', 0.14, 0.1, 0.06, 0.012, { p: [-0.3, 1.0, 0.54], r: [-0.4, 0, 0], tint: '#15130f' }, 1); // taxi meter
      k.add(new PlaneGeometry(0.1, 0.05), meterFace(), { p: [-0.3, 1.03, 0.51], r: [-0.4, 0, 0], proj: 'keep' });
      // rear: tail lights, plate, stickers, exhaust, number
      for (const sx of [-1, 1]) {
        k.rbox('enamel', 0.1, 0.055, 0.03, 0.01, { p: [sx * 0.5, 0.82, -1.32], tint: '#b8141a' }, 1);
        if (sx > 0) k.cyl('stainless', 0.032, 0.032, 0.26, 10, { p: [0.4, 0.27, -1.38], r: [PI / 2, 0, 0], tint: '#6b6762' });
      }
      k.add(new PlaneGeometry(0.46, 0.12), numberPlate(o.plate || 'TS 09 UB 4382'), { p: [0, 0.4, -1.318], r: [0, PI, 0], proj: 'keep' });
      k.add(new PlaneGeometry(0.85, 0.42), autoRearArt(), { p: [0, 0.68, -1.316], r: [0, PI, 0], proj: 'keep' });
      for (const sx of [-1, 1]) k.add(new PlaneGeometry(0.5, 0.125), autoSideArt(), { p: [sx * 0.656, 0.5, -0.5], r: [0, sx * PI / 2, 0], proj: 'keep' });
      // wheels (spin) - front fork leg stays static above
      wheel(k, 'wF', 0, 0.215, 1.12, 0.215, 0.115, { tint: '#8d9399' });
      wheel(k, 'wL', -0.64, 0.215, -0.62, 0.215, 0.12, { tint: '#8d9399' });
      wheel(k, 'wR', 0.64, 0.215, -0.62, 0.215, 0.12, { tint: '#8d9399' });
      k.cyl('stainless', 0.016, 0.016, 0.34, 8, { p: [0, 0.4, 1.12], r: [0, 0, 0] });
      return { ao: 0.45, aoH: 0.3 };
    },
    rig({ sub, out }, o, api) {
      let speed = 0;
      out.setSpeed = (v) => (speed = v);
      api.anim((dt, t) => {
        for (const n of ['wF', 'wL', 'wR']) if (sub[n]) sub[n].rotation.x -= (speed * dt) / 0.215;
        if (sub.hood) sub.hood.rotation.z = Math.sin(t * 7.1) * 0.0012 + (speed ? Math.sin(t * 19) * 0.002 : 0);
      });
    },
  },

  // ---------------------------------------------------------------------------------------------------------------------------
  scooter: {
    key: (o) => o.body || '',
    build(k, o) {
      const C = o.body || '#2a6fd0';
      k.rbox('paintWorn', 0.4, 0.05, 0.72, 0.012, { p: [0, 0.3, 0.02], tint: '#222' }, 1); // floor frame
      k.rbox('rubber', 0.34, 0.012, 0.5, 0.004, { p: [0, 0.332, 0.04] }, 1); // floor mat
      k.rbox('paint', 0.4, 0.66, 0.07, 0.03, { p: [0, 0.66, 0.46], r: [-0.22, 0, 0], tint: C }, 1); // leg shield
      k.rbox('paint', 0.4, 0.36, 0.78, 0.07, { p: [0, 0.52, -0.5], r: [-0.05, 0, 0], tint: C }, 3); // side cowls / rear body
      k.rbox('paint', 0.28, 0.2, 0.3, 0.05, { p: [0, 0.4, -0.88], tint: C }, 2);
      k.rbox('paint', 0.34, 0.1, 0.28, 0.04, { p: [0, 0.52, 0.5], tint: C }, 2); // front apron
      k.rbox('vinyl', 0.31, 0.09, 0.74, 0.035, { p: [0, 0.755, -0.5], r: [0.04, 0, 0] }, 2); // seat
      k.rbox('paint', 0.3, 0.08, 0.22, 0.03, { p: [0, 0.77, -0.95], tint: C }, 2); // tail
      k.rbox('enamel', 0.18, 0.04, 0.03, 0.01, { p: [0, 0.78, -1.06], tint: '#b8141a' }, 1);
      k.add(new PlaneGeometry(0.2, 0.05), numberPlate('TS 07 EQ 2214'), { p: [0, 0.66, -1.09], r: [0.1, PI, 0], proj: 'keep' });
      k.tube('stainless', [[-0.1, 0.72, -0.95], [-0.12, 0.84, -0.9], [-0.12, 0.84, -0.7], [-0.1, 0.78, -0.6]], 0.007, undefined, 8, 5); // grab rail
      // steering head, bars, lamp, cluster, mirrors
      k.cyl('stainless', 0.016, 0.016, 0.86, 8, { p: [0, 0.62, 0.57], r: [-0.14, 0, 0] });
      k.cyl('stainless', 0.012, 0.012, 0.6, 8, { p: [0, 1.02, 0.52], r: [0, 0, PI / 2] });
      k.rbox('paint', 0.34, 0.2, 0.18, 0.06, { p: [0, 1.04, 0.54], tint: C }, 1);
      k.cap('glow', 0.07, 1.3, 12, 4, { p: [0, 1.06, 0.625], r: [PI / 2, 0, 0], tint: '#fff2c0' });
      k.rbox('enamel', 0.16, 0.08, 0.1, 0.02, { p: [0, 1.17, 0.5], r: [-0.4, 0, 0], tint: '#111' }, 1);
      for (const sx of [-1, 1]) {
        k.cyl('rubber', 0.016, 0.016, 0.1, 8, { p: [sx * 0.27, 1.02, 0.52], r: [0, 0, PI / 2] });
        k.cyl('stainless', 0.004, 0.004, 0.28, 6, { p: [sx * 0.28, 1.16, 0.52], r: [0.1, 0, sx * -0.3] });
        k.rbox('enamel', 0.1, 0.06, 0.01, 0.004, { p: [sx * 0.34, 1.3, 0.5], r: [-0.4, 0, 0], tint: '#222' }, 1);
        k.cyl('stainless', 0.012, 0.012, 0.62, 8, { p: [sx * 0.09, 0.42, 0.6], r: [-0.14, 0, 0] }); // fork legs
      }
      fender(k, 0, 0.22, 0.62, 0.25, 0.14, C);
      fender(k, 0, 0.22, -0.58, 0.25, 0.15, C);
      // exhaust, stand, footrest
      k.cyl('stainless', 0.045, 0.04, 0.42, 12, { p: [0.19, 0.26, -0.6], r: [PI / 2 - 0.08, 0, 0], tint: '#7d7a76' });
      k.cyl('enamel', 0.05, 0.05, 0.24, 12, { p: [0.19, 0.285, -0.62], r: [PI / 2 - 0.08, 0, 0], tint: '#1a1a1a' }, true);
      k.cyl('steelDark', 0.012, 0.012, 0.34, 6, { p: [0, 0.1, -0.35], r: [0, 0, PI / 2] });
      wheel(k, 'wF', 0, 0.22, 0.62, 0.22, 0.09, { tint: '#6c7278' });
      wheel(k, 'wR', 0, 0.22, -0.58, 0.22, 0.1, { tint: '#6c7278' });
      return { ao: 0.45, aoH: 0.3 };
    },
    rig({ sub, out }, o, api) {
      let speed = 0;
      out.setSpeed = (v) => (speed = v);
      api.anim((dt) => {
        for (const n of ['wF', 'wR']) if (sub[n]) sub[n].rotation.x -= (speed * dt) / 0.22;
      });
    },
  },

  motorbike: {
    key: (o) => o.body || '',
    build(k, o) {
      const C = o.body || '#1c1c1e';
      const R = 0.3;
      // frame: down tube, backbone, seat rails, swingarm
      k.tube('steelDark', [[0, 0.72, 0.42], [0, 0.55, 0.28], [0, 0.34, 0.05], [0, 0.32, -0.2], [0, 0.4, -0.52]], 0.017, { tint: '#2a2928' }, 14, 6);
      k.tube('steelDark', [[0, 0.78, 0.4], [0, 0.82, 0.0], [0, 0.78, -0.42], [0, 0.8, -0.78]], 0.015, { tint: '#2a2928' }, 14, 6);
      for (const sx of [-1, 1]) k.tube('steelDark', [[sx * 0.07, 0.3, -0.1], [sx * 0.08, 0.3, -0.55], [sx * 0.08, 0.3, -0.98]], 0.014, { tint: '#2a2928' }, 10, 5);
      // tank, seat, side covers, fenders
      k.sph('paint', 1, 20, 12, { p: [0, 0.9, 0.24], s: [0.17, 0.14, 0.34], tint: C });
      k.rbox('paint', 0.18, 0.04, 0.16, 0.02, { p: [0, 0.8, 0.5], tint: C }, 2);
      k.rbox('vinyl', 0.29, 0.085, 0.72, 0.035, { p: [0, 0.86, -0.4], r: [0.03, 0, 0] }, 2);
      for (const sx of [-1, 1]) k.rbox('paint', 0.04, 0.2, 0.34, 0.015, { p: [sx * 0.1, 0.6, -0.35], tint: C }, 2);
      fender(k, 0, R, 0.82, R + 0.03, 0.12, C);
      k.rbox('paint', 0.14, 0.012, 0.34, 0.004, { p: [0, 0.7, -1.08], r: [-0.25, 0, 0], tint: C }, 1);
      k.rbox('enamel', 0.12, 0.035, 0.03, 0.01, { p: [0, 0.77, -1.2], tint: '#b8141a' }, 1);
      k.add(new PlaneGeometry(0.2, 0.05), numberPlate('TS 10 FH 3321'), { p: [0, 0.62, -1.17], r: [0.12, PI, 0], proj: 'keep' });
      // engine: block, cylinder fins, crankcase cover, exhaust
      k.rbox('steelDark', 0.24, 0.26, 0.3, 0.03, { p: [0, 0.38, -0.02], tint: '#8a8e92' }, 2);
      k.cyl('steelDark', 0.09, 0.09, 0.2, 14, { p: [0, 0.6, 0.12], r: [-0.7, 0, 0], tint: '#6c7074' });
      for (let i = 0; i < 6; i++) k.cyl('steelDark', 0.108, 0.108, 0.01, 14, { p: [0, 0.54 + i * 0.026 * 0.65, 0.14 - i * 0.018 * 0.65 + 0.0], r: [-0.7, 0, 0], tint: '#6c7074' });
      for (const sx of [-1, 1]) k.cyl('steelDark', 0.1, 0.1, 0.03, 16, { p: [sx * 0.135, 0.36, -0.04], r: [0, 0, PI / 2], tint: '#8d9195' });
      k.tube('chrome', [[0.06, 0.55, 0.3], [0.1, 0.34, 0.34], [0.12, 0.24, 0.1], [0.13, 0.24, -0.4], [0.13, 0.26, -0.9]], 0.022, undefined, 18, 8);
      k.cyl('chrome', 0.05, 0.055, 0.5, 14, { p: [0.14, 0.27, -0.72], r: [PI / 2 - 0.02, 0, 0] });
      k.rbox('steelDark', 0.04, 0.12, 0.34, 0.01, { p: [-0.16, 0.3, -0.3], tint: '#222' }, 1); // chain guard
      // forks, headlamp, bars, cluster, mirrors
      for (const sx of [-1, 1]) {
        k.cyl('stainless', 0.017, 0.017, 0.52, 10, { p: [sx * 0.085, 0.58, 0.7], r: [-0.4, 0, 0] });
        k.cyl('rubber', 0.026, 0.024, 0.3, 10, { p: [sx * 0.085, 0.8, 0.6], r: [-0.4, 0, 0], tint: '#17120e' });
        k.cyl('stainless', 0.015, 0.015, 0.3, 8, { p: [sx * 0.085, 0.4, 0.76], r: [-0.4, 0, 0] });
        k.cyl('rubber', 0.017, 0.017, 0.11, 8, { p: [sx * 0.33, 1.08, 0.42], r: [0, 0, PI / 2] });
        k.cyl('stainless', 0.004, 0.004, 0.26, 6, { p: [sx * 0.36, 1.2, 0.4], r: [0.1, 0, sx * -0.4] });
        k.sph('chrome', 0.045, 10, 8, { p: [sx * 0.43, 1.31, 0.38], s: [1, 0.8, 0.25] });
        k.rbox('stainless', 0.02, 0.01, 0.1, 0.003, { p: [sx * 0.17, 0.26, -0.1] }, 1); // footpeg
      }
      k.cyl('stainless', 0.012, 0.012, 0.7, 8, { p: [0, 1.06, 0.45], r: [0, 0, PI / 2] });
      k.cyl('chrome', 0.095, 0.095, 0.1, 16, { p: [0, 0.98, 0.66], r: [PI / 2, 0, 0] });
      k.cap('glow', 0.085, 1.35, 14, 4, { p: [0, 0.98, 0.72], r: [PI / 2, 0, 0], tint: '#fff2c0' });
      k.cyl('enamel', 0.06, 0.06, 0.04, 14, { p: [0, 1.14, 0.42], r: [-0.8, 0, 0], tint: '#101010' });
      // rear shocks and stand
      for (const sx of [-1, 1]) {
        k.cyl('stainless', 0.01, 0.01, 0.32, 8, { p: [sx * 0.1, 0.55, -0.8], r: [0.25, 0, 0] });
        k.cyl('steelDark', 0.022, 0.022, 0.18, 10, { p: [sx * 0.1, 0.55, -0.8], r: [0.25, 0, 0], tint: '#17120e' });
      }
      k.cyl('steelDark', 0.012, 0.012, 0.4, 6, { p: [0.06, 0.12, -0.3], r: [0, 0, PI / 2 - 0.3] });
      wheel(k, 'wF', 0, R, 0.82, R, 0.075, { tint: '#aab0b5', spokes: 10, section: 0.45 });
      wheel(k, 'wR', 0, R, -0.9, R, 0.09, { tint: '#aab0b5', spokes: 10, section: 0.5 });
      return { ao: 0.45, aoH: 0.3 };
    },
    rig({ sub, out }, o, api) {
      let speed = 0;
      out.setSpeed = (v) => (speed = v);
      api.anim((dt) => {
        for (const n of ['wF', 'wR']) if (sub[n]) sub[n].rotation.x -= (speed * dt) / 0.3;
      });
    },
  },
};
