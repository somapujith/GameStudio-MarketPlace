// Road surface (one merged mesh for every edge), junction patches, and raised sidewalk slabs for every block.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { asphaltTexture } from '../render/textures.js';
import { LATE } from './terrain.js';

export function buildRoads(scene, city, shared) {
  const pos = [];
  const uv = [];
  const idx = [];
  const patchPos = [];
  const patchIdx = [];

  const Y = 0.03;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const nx = -e.dz * (e.w / 2);
    const nz = e.dx * (e.w / 2);
    const base = pos.length / 3;
    pos.push(a.x + nx, Y, a.z + nz, a.x - nx, Y, a.z - nz, b.x - nx, Y, b.z - nz, b.x + nx, Y, b.z + nz);
    const v = e.len / 16;
    uv.push(0, 0, 1, 0, 1, v, 0, v);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  for (const n of city.nodes) {
    if (!n.w) continue;
    const base = patchPos.length / 3;
    if (n.curve) {
      // discs smooth the joints of the curved promenade
      const R = n.w / 2;
      patchPos.push(n.x, Y, n.z);
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        patchPos.push(n.x + Math.cos(t) * R, Y, n.z + Math.sin(t) * R);
      }
      for (let i = 1; i <= 12; i++) patchIdx.push(base, base + i + 1, base + i);
    } else {
      const h = n.w / 2;
      patchPos.push(n.x - h, Y, n.z - h, n.x + h, Y, n.z - h, n.x + h, Y, n.z + h, n.x - h, Y, n.z + h);
      patchIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // quads were wound clockwise from above: make the normals point up
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);

  const roadMat = new MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0.0, color: 0xffffff });
  roadMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.uWet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.22, uWet);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, uWet);')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.62, uWet);');
  };
  roadMat.customProgramCacheKey = () => 'road';
  const road = new Mesh(geo, roadMat);
  road.receiveShadow = true;
  road.renderOrder = LATE; // after the buildings: the depth test rejects the road pixels behind them (see terrain.js)
  scene.add(road);

  const pg = new BufferGeometry();
  pg.setAttribute('position', new BufferAttribute(new Float32Array(patchPos), 3));
  pg.setIndex(patchIdx);
  pg.computeVertexNormals();
  const pn = pg.getAttribute('normal');
  for (let i = 0; i < pn.count; i++) pn.setXYZ(i, 0, 1, 0);
  const patchMat = new MeshStandardMaterial({ color: 0x38333f, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  patchMat.onBeforeCompile = roadMat.onBeforeCompile;
  patchMat.customProgramCacheKey = () => 'roadpatch';
  const patches = new Mesh(pg, patchMat);
  patches.receiveShadow = true;
  patches.renderOrder = LATE;
  scene.add(patches);

  // ---- sidewalk slabs
  const slabBlocks = city.blocks.filter((b) => b.type !== 'water' && b.type !== 'park'); // park blocks spread over Necklace Road
  const slabs = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0xffffff }), slabBlocks.length);
  slabs.receiveShadow = true;
  slabs.renderOrder = LATE;
  const o = new Object3D();
  const col = new Color();
  slabBlocks.forEach((b, i) => {
    o.position.set(b.cx, 0.1, b.cz);
    o.scale.set(b.w, 0.2, b.d);
    o.updateMatrix();
    slabs.setMatrixAt(i, o.matrix);
    // pink-grey pavement; parks and landmark plazas are greener / paler
    const g = b.type === 'park' ? '#8fb072' : b.type === 'landmark' ? '#e9cfc4' : '#d8b4ae';
    slabs.setColorAt(i, col.set(g).offsetHSL(0, 0, (((i * 37) % 10) - 5) * 0.004));
  });
  slabs.instanceColor.needsUpdate = true;
  slabs.instanceMatrix.needsUpdate = true;
  scene.add(slabs);

  return { road, patches, slabs, dispose() { geo.dispose(); pg.dispose(); roadMat.dispose(); patchMat.dispose(); } };
}

/** Is (x,z) on a road? Uses edge distance, so it is exact for axis-aligned and curved edges. Linear; cache results. */
export function onRoad(city, x, z, pad = 0) {
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    const px = a.x + e.dx * e.len * t;
    const pz = a.z + e.dz * e.len * t;
    if (Math.hypot(x - px, z - pz) <= e.w / 2 + pad) return e;
  }
  return null;
}
