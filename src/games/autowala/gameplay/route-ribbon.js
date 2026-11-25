// OWNER: minimap agent. The glowing route ribbon on the road: one merged dynamic BufferGeometry, rebuilt in place every frame
// from the (trimmed) route polyline. Flat quads ~2.2 m wide, 0.25 m above the road, cyan -> pink, with chevrons that run ahead.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from 'three';

export const RIBBON = { width: 2.2, lift: 0.28, reach: 300, maxPoints: 160 };

/**
 * Write the ribbon strip for `points` into the typed arrays (pure; unit-tested).
 *   pos  : Float32Array(3 * 2 * maxPoints)  x,y,z of the left/right vertex of every strip step
 *   attr : Float32Array(2 * 2 * maxPoints)  (u across -1..1, v = metres along the route from the first point)
 * Only the first `reach` metres are used; the last step is cut exactly at `reach`. Corners are mitred.
 * Returns the number of strip steps written (vertices = 2 * steps); < 2 means nothing to draw.
 */
export function fillRibbon(points, pos, attr, { width = RIBBON.width, lift = RIBBON.lift, reach = RIBBON.reach, maxPoints = RIBBON.maxPoints } = {}) {
  const n = points?.length || 0;
  if (n < 2) return 0;
  const half = width / 2;
  let steps = 0;
  let along = 0;
  // direction of the leg that leaves vertex i
  let px = points[0].x;
  let pz = points[0].z;
  let inX = 0;
  let inZ = 0;
  for (let i = 0; i < n && steps < maxPoints; i++) {
    let cx = points[i].x;
    let cz = points[i].z;
    let last = false;
    if (i > 0) {
      const dx = cx - px;
      const dz = cz - pz;
      const l = Math.hypot(dx, dz);
      if (l < 1e-4) continue;
      if (along + l >= reach) {
        const k = (reach - along) / l;
        cx = px + dx * k;
        cz = pz + dz * k;
        along = reach;
        last = true;
      } else along += l;
    }
    // outgoing direction (towards the next vertex) and incoming direction (from the previous one)
    let oX = 0;
    let oZ = 0;
    if (!last && i < n - 1) {
      const nx = points[i + 1].x - cx;
      const nz = points[i + 1].z - cz;
      const l = Math.hypot(nx, nz);
      if (l > 1e-4) {
        oX = nx / l;
        oZ = nz / l;
      }
    }
    let iX = 0;
    let iZ = 0;
    if (i > 0) {
      const dx = cx - px;
      const dz = cz - pz;
      const l = Math.hypot(dx, dz);
      iX = dx / l;
      iZ = dz / l;
    }
    if (!oX && !oZ) {
      oX = iX;
      oZ = iZ;
    }
    if (!iX && !iZ) {
      iX = oX;
      iZ = oZ;
    }
    // mitre: the normal of the averaged direction, stretched so the strip keeps its width round a corner
    let mx = iX + oX;
    let mz = iZ + oZ;
    let ml = Math.hypot(mx, mz);
    if (ml < 1e-3) {
      mx = oX;
      mz = oZ;
      ml = 1;
    }
    mx /= ml;
    mz /= ml;
    const nxm = mz; // left normal of (mx, mz) is (mz, -mx)
    const nzm = -mx;
    const cosHalf = Math.max(0.55, nxm * (oZ) + nzm * (-oX)); // normal . normal-of-outgoing-leg
    const w = half / cosHalf;
    const o = steps * 6;
    pos[o] = cx + nxm * w;
    pos[o + 1] = lift;
    pos[o + 2] = cz + nzm * w;
    pos[o + 3] = cx - nxm * w;
    pos[o + 4] = lift;
    pos[o + 5] = cz - nzm * w;
    const a = steps * 4;
    attr[a] = -1;
    attr[a + 1] = along;
    attr[a + 2] = 1;
    attr[a + 3] = along;
    steps++;
    px = cx;
    pz = cz;
    if (last) break;
  }
  return steps >= 2 ? steps : 0;
}

const VERT = /* glsl */ `
attribute vec2 aRoute;
varying vec2 vR;
void main() {
  vR = aRoute;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Output stays at or under ~1.3x so only the chevron peaks touch the bloom threshold (1.05).
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uReach;
uniform vec3 uCyan;
uniform vec3 uPink;
varying vec2 vR;
void main() {
  float au = abs(vR.x);
  float side = 1.0 - smoothstep(0.55, 1.0, au);
  float t = clamp(vR.y / uReach, 0.0, 1.0);
  vec3 base = mix(uCyan, uPink, smoothstep(0.05, 0.95, t));
  float f = fract((vR.y + 1.7 * au - uTime * 7.0) / 9.0);
  float chev = smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.14, 0.36, f));
  float pulse = 0.9 + 0.1 * sin(uTime * 2.4 + vR.y * 0.04);
  float fadeIn = smoothstep(0.5, 5.0, vR.y);
  float fadeOut = 1.0 - smoothstep(uReach * 0.7, uReach, vR.y);
  float a = side * (0.5 + 0.5 * chev) * fadeIn * fadeOut * 0.9;
  vec3 col = base * (0.82 + 0.46 * chev) * pulse;
  gl_FragColor = vec4(col, a);
}`;

/** The 3D ribbon. `update(points, time)` refills the buffers; nothing is allocated per frame. */
export function createRouteRibbon(scene) {
  const maxPoints = RIBBON.maxPoints;
  const pos = new Float32Array(maxPoints * 2 * 3);
  const attr = new Float32Array(maxPoints * 2 * 2);
  const index = new Uint16Array((maxPoints - 1) * 6);
  for (let i = 0; i < maxPoints - 1; i++) {
    const v = i * 2;
    const k = i * 6;
    index[k] = v;
    index[k + 1] = v + 1;
    index[k + 2] = v + 2;
    index[k + 3] = v + 1;
    index[k + 4] = v + 3;
    index[k + 5] = v + 2;
  }
  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const routeAttr = new BufferAttribute(attr, 2);
  posAttr.setUsage(35048); // DynamicDrawUsage
  routeAttr.setUsage(35048);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aRoute', routeAttr);
  geo.setIndex(new BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uReach: { value: RIBBON.reach },
      uCyan: { value: new Color('#37e6ff') },
      uPink: { value: new Color('#ff3d9a') },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false; // the buffers change every frame, so the bounds would be stale
  mesh.renderOrder = 4;
  mesh.visible = false;
  mesh.name = 'aw-route-ribbon';
  scene.add(mesh);

  return {
    mesh,
    /** Refill from the route polyline (first point = the player's position on the route). Returns true when something is drawn. */
    update(points, time) {
      const steps = points && points.length > 1 ? fillRibbon(points, pos, attr) : 0;
      mat.uniforms.uTime.value = time;
      if (!steps) {
        mesh.visible = false;
        return false;
      }
      posAttr.needsUpdate = true;
      routeAttr.needsUpdate = true;
      geo.setDrawRange(0, (steps - 1) * 6);
      mesh.visible = true;
      return true;
    },
    hide() {
      mesh.visible = false;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
