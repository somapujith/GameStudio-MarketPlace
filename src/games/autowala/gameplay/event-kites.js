// Kite season: a few dozen kites high over the city, ONE instanced mesh (a diamond with a tail, ~16 triangles each). The field is a
// fixed square of positions that repeats around the player (event-logic wrapDelta), so there are always kites near whichever street you
// are on and nothing ever pops in view. Colours are per instance. They drift with the wind, bob and tilt toward the viewer.
import { Color, InstancedMesh, Object3D } from 'three';
import { kiteField, kiteFraction, wrapDelta } from './event-logic.js';
import { kiteGeometry, kiteMaterial } from './event-figures.js';

const COLORS = [0xff3d8a, 0x37e6ff, 0xffc400, 0x8a4dff, 0xff7a1a, 0x7dff6a];
const SIZE = 260;
export const KITES = { low: 14, medium: 30, high: 48 };
const o = new Object3D();

export function createKites(ctx) {
  const field = kiteField(KITES.high, SIZE).sort((a, b) => a.after - b.after);
  const geo = kiteGeometry();
  const mat = kiteMaterial();
  const mesh = new InstancedMesh(geo, mat, field.length);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(35048);
  const tint = new Color();
  field.forEach((k, i) => mesh.setColorAt(i, tint.set(COLORS[k.color])));
  mesh.instanceColor.needsUpdate = true;
  mesh.count = 0;
  ctx.scene.add(mesh);
  let max = KITES.medium;

  return {
    mesh,
    setQuality(q) {
      max = KITES[q] ?? KITES.medium;
    },
    end() {
      mesh.count = 0;
      mesh.visible = false;
    },
    start() {
      mesh.visible = true;
      return true;
    },
    /** Per frame. Returns how many kites are up. */
    update(dt, t, hour, focus, camera) {
      const frac = kiteFraction(hour);
      const n = Math.min(max, Math.round(frac * max));
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) return 0;
      const wind = t * 1.4;
      for (let i = 0; i < n; i++) {
        const k = field[i];
        const gx = k.x + wind * k.drift + Math.sin(t * 0.37 + k.phase) * 3;
        const gz = k.z + wind * 0.35 * k.drift + Math.cos(t * 0.29 + k.phase) * 3;
        const dx = wrapDelta(gx - focus.x, SIZE);
        const dz = wrapDelta(gz - focus.z, SIZE);
        const x = focus.x + dx;
        const z = focus.z + dz;
        // a kite lifts off over the first minutes of its day: rise from the rooftops
        const y = k.y * (0.55 + 0.45 * frac) + Math.sin(t * 0.8 + k.phase * 2) * 1.8;
        o.position.set(x, y, z);
        const yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
        o.rotation.set(-0.3 + Math.sin(t * 1.1 + k.phase) * 0.12, yaw, Math.sin(t * 0.9 + k.phase * 3) * 0.35, 'YXZ');
        o.scale.setScalar(k.scale);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return n;
    },
    dispose() {
      ctx.scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose?.();
    },
  };
}
