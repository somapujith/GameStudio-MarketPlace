// Small shared helpers for the rules agent's meshes (signals, cops, cameras, signs, barricades): vertex coloured boxes merged into
// one geometry, a soft glow texture, and the disposal of a whole group. Everything here is tiny (a few hundred triangles at most).
import { BoxGeometry, BufferAttribute, CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A box centred at (x, y, z) painted `rgb` ([r, g, b] 0..1, linear-ish); only position, normal and colour (merge-compatible). */
export function colorBox(w, h, d, x, y, z, rgb) {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}

/** Merge parts (disposing the sources) into one geometry. */
export function mergeParts(parts) {
  const out = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return out;
}

/** Re-paint a plain geometry with one colour (adds a `color` attribute). */
export function tint(g, rgb) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  return g;
}

/** A 64 px radial glow (white centre fading out); null where there is no DOM (unit tests). */
export function glowTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Remove a group from its parent and free every geometry, material and texture under it. */
export function disposeGroup(group) {
  group.removeFromParent();
  const seen = new Set();
  group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.map) m.map.dispose();
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
}

/** A traffic policeman standing, facing +z, one arm out (about 90 triangles, vertex coloured). */
export function copGeometry() {
  const shirt = [0.82, 0.82, 0.78];
  const khaki = [0.5, 0.4, 0.26];
  const skin = [0.55, 0.38, 0.26];
  const cap = [0.93, 0.93, 0.9];
  const vest = [1.0, 0.45, 0.05];
  return mergeParts([
    colorBox(0.17, 0.85, 0.2, -0.11, 0.425, 0, khaki),
    colorBox(0.17, 0.85, 0.2, 0.11, 0.425, 0, khaki),
    colorBox(0.46, 0.62, 0.26, 0, 1.16, 0, shirt),
    colorBox(0.48, 0.14, 0.28, 0, 1.2, 0, vest),
    colorBox(0.12, 0.6, 0.14, -0.3, 1.14, 0, shirt),
    colorBox(0.5, 0.12, 0.14, 0.5, 1.4, 0.05, shirt), // the raised arm, out to the side
    colorBox(0.1, 0.1, 0.1, 0.78, 1.4, 0.05, skin),
    colorBox(0.22, 0.24, 0.22, 0, 1.6, 0, skin),
    colorBox(0.25, 0.1, 0.25, 0, 1.76, 0, cap),
  ]);
}
