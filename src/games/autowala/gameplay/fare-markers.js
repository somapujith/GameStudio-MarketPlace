// Glowing map markers in the 3D world: ground rings, floating diamonds, tall beams. Three InstancedMeshes in total (one draw call each),
// written straight into their matrix / colour arrays every frame, so a frame allocates nothing. Additive and unlit, with colour
// multipliers kept <= 1.3 so the bloom (threshold 1.05) only kisses them.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  OctahedronGeometry,
} from 'three';

/** A flat glowing ring (unit radius, on the xz plane): a soft inner glow, a bright band, a faded rim. */
function ringGeometry(segments = 64) {
  const radii = [0.0, 0.78, 0.88, 0.94, 0.985, 1.0];
  const glow = [0.0, 0.1, 0.55, 1.0, 0.5, 0.0];
  const pos = [];
  const col = [];
  const idx = [];
  for (let r = 0; r < radii.length; r++) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[r], 0, Math.sin(a) * radii[r]);
      col.push(glow[r], glow[r], glow[r]);
    }
  }
  for (let r = 0; r < radii.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const a = r * segments + i;
      const b = r * segments + ((i + 1) % segments);
      const c = (r + 1) * segments + i;
      const d = (r + 1) * segments + ((i + 1) % segments);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  return g;
}

/** An open tube of unit radius and height 1 whose glow fades out toward the top. */
function beamGeometry() {
  const g = new CylinderGeometry(1, 1, 1, 18, 1, true);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = Math.pow(1 - p.getY(i), 1.4) * 0.8;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

function additive(depthTest) {
  const m = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest, side: DoubleSide, fog: false, toneMapped: false, forceSinglePass: true }); // (additive: the back-face and front-face passes would add up to the same picture in half the draws)
  if (depthTest) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  return m;
}

function instanced(geo, mat, n, order) {
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false; // the instances are all over the map, the bounding sphere is not
  mesh.renderOrder = order;
  mesh.count = 0;
  return mesh;
}

export function createMarkerKit(scene, { rings = 44, diamonds = 44, beams = 14 } = {}) {
  const ringGeo = ringGeometry();
  const beamGeo = beamGeometry();
  const diaGeo = new OctahedronGeometry(1, 0);
  const ringMat = additive(true);
  const beamMat = additive(true);
  const diaMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const ringMesh = instanced(ringGeo, ringMat, rings, 20);
  const beamMesh = instanced(beamGeo, beamMat, beams, 21);
  const diaMesh = instanced(diaGeo, diaMat, diamonds, 60);
  scene.add(ringMesh, beamMesh, diaMesh);

  let nr = 0;
  let nb = 0;
  let nd = 0;
  const painters = [];

  const put = (mesh, i, x, y, z, sx, sy, sz, rot, r, g, b) => {
    const m = mesh.instanceMatrix.array;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const o = i * 16;
    m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s * sz; m[o + 9] = 0; m[o + 10] = c * sz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const k = mesh.instanceColor.array;
    k[i * 3] = r; k[i * 3 + 1] = g; k[i * 3 + 2] = b;
  };

  const kit = {
    ringMesh, beamMesh, diaMesh,
    /** Register a function (kit, time) that draws markers each frame. */
    addPainter: (fn) => { painters.push(fn); },
    begin() { nr = nb = nd = 0; },
    /** A ground ring of `radius` metres at (x, y, z), colour (r, g, b) already multiplied by its brightness. */
    ring(x, y, z, radius, r, g, b) {
      if (nr < rings) put(ringMesh, nr++, x, y, z, radius, 1, radius, 0, r, g, b);
    },
    /** A diamond of half-width `w` and half-height `h`, spinning by `spin` radians. */
    diamond(x, y, z, w, h, spin, r, g, b) {
      if (nd < diamonds) put(diaMesh, nd++, x, y, z, w, h, w, spin, r, g, b);
    },
    /** A beam of `radius` and `height` standing on (x, y, z). */
    beam(x, y, z, radius, height, r, g, b) {
      if (nb < beams) put(beamMesh, nb++, x, y, z, radius, height, radius, 0, r, g, b);
    },
    end() {
      ringMesh.count = nr; beamMesh.count = nb; diaMesh.count = nd;
      for (const m of [ringMesh, beamMesh, diaMesh]) {
        m.visible = m.count > 0; // an empty instanced mesh still costs a program switch
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }
    },
    /** Run every painter between begin() and end(). */
    frame(time) {
      kit.begin();
      for (const p of painters) p(kit, time);
      kit.end();
    },
    dispose() {
      scene.remove(ringMesh, beamMesh, diaMesh);
      for (const m of [ringMesh, beamMesh, diaMesh]) m.dispose();
      ringGeo.dispose(); beamGeo.dispose(); diaGeo.dispose();
      ringMat.dispose(); beamMat.dispose(); diaMat.dispose();
      painters.length = 0;
    },
  };
  return kit;
}
