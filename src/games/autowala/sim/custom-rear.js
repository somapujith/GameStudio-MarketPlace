// Bolt-on rear parts of the workshop catalogue: bumpers, ladder, whip antenna with a flag, chrome side guards. Same contract as
// custom-props.js: every builder returns { group, update(env), dispose() } and owns its geometry and materials.
// OWNER: customisation agent.
import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture } from '../render/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeTree } from './custom-props.js';

const chromeM = () => new MeshStandardMaterial({ color: '#e3e6f2', roughness: 0.14, metalness: 0.95 });
const prop = (group, update = () => {}) => ({ group, update, dispose: () => disposeTree(group) });

/** Merge a static, not-yet-mounted group into ONE mesh per material (one draw call instead of dozens). */
function bake(group) {
  group.updateMatrixWorld(true);
  const lists = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') geo.deleteAttribute(n);
    geo.applyMatrix4(o.matrixWorld);
    o.geometry.dispose();
    if (!lists.has(o.material)) lists.set(o.material, []);
    lists.get(o.material).push(geo);
  }
  group.clear();
  for (const [m, list] of lists) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) throw new Error('custom-rear: could not merge a static prop');
    if (list.length > 1) for (const l of list) l.dispose();
    const o = new Mesh(merged, m);
    o.castShadow = true;
    group.add(o);
  }
  return group;
}

function mesh(parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = true;
  parent.add(o);
  return o;
}

const BZ = -1.585; // the bumper's z (just behind the engine cover)

function brackets(g, m) {
  for (const s of [-1, 1]) mesh(g, new BoxGeometry(0.06, 0.07, 0.12), m, s * 0.5, 0.5, -1.53);
}

/** Rear bumper by id: stock | chrome-bar | double-chrome | spiked. Unknown ids give the stock bumper. */
export function buildBumper(id) {
  const g = new Group();
  const m = chromeM();
  brackets(g, m);
  switch (id) {
    case 'chrome-bar': {
      mesh(g, new CylinderGeometry(0.05, 0.05, 1.5, 10), m, 0, 0.5, BZ, 0, 0, Math.PI / 2);
      for (const s of [-1, 1]) {
        mesh(g, new SphereGeometry(0.05, 8, 6), m, s * 0.75, 0.5, BZ);
        mesh(g, new CylinderGeometry(0.035, 0.035, 0.14, 8), m, s * 0.75, 0.5, BZ + 0.08, Math.PI / 2, 0, 0);
      }
      break;
    }
    case 'double-chrome': {
      mesh(g, new CylinderGeometry(0.045, 0.045, 1.56, 10), m, 0, 0.55, BZ, 0, 0, Math.PI / 2);
      mesh(g, new CylinderGeometry(0.038, 0.038, 1.56, 10), m, 0, 0.36, BZ + 0.01, 0, 0, Math.PI / 2);
      for (const s of [-1, 1]) {
        mesh(g, new RoundedBoxGeometry(0.06, 0.28, 0.07, 1, 0.02), m, s * 0.78, 0.455, BZ);
        mesh(g, new SphereGeometry(0.05, 8, 6), m, s * 0.78, 0.55, BZ);
        mesh(g, new SphereGeometry(0.042, 8, 6), m, s * 0.78, 0.36, BZ + 0.01);
      }
      for (const x of [-0.3, 0.3]) mesh(g, new BoxGeometry(0.04, 0.2, 0.05), m, x, 0.455, BZ + 0.01);
      break;
    }
    case 'spiked': {
      mesh(g, new RoundedBoxGeometry(1.56, 0.1, 0.09, 1, 0.03), m, 0, 0.5, BZ);
      const cone = new ConeGeometry(0.026, 0.12, 8);
      for (let i = 0; i < 9; i++) mesh(g, cone, m, -0.7 + i * 0.175, 0.5, BZ - 0.1, -Math.PI / 2, 0, 0);
      for (const s of [-1, 1]) mesh(g, new ConeGeometry(0.03, 0.14, 8), m, s * 0.8, 0.5, BZ, 0, 0, -s * Math.PI / 2);
      break;
    }
    case 'stock':
    default:
      mesh(g, new RoundedBoxGeometry(1.5, 0.1, 0.1, 1, 0.04), m, 0, 0.5, BZ);
      break;
  }
  return prop(bake(g));
}

/** A vertical chrome ladder on the rear corner (rear-view left), from the bumper up to the roof edge. */
export function buildLadder() {
  const g = new Group();
  const m = chromeM();
  const x = 0.73;
  const z = -1.585;
  const y0 = 0.62;
  const y1 = 1.95;
  const rail = new CylinderGeometry(0.014, 0.014, y1 - y0, 8);
  for (const dx of [-0.045, 0.045]) mesh(g, rail, m, x + dx, (y0 + y1) / 2, z);
  const rung = new CylinderGeometry(0.01, 0.01, 0.09, 6);
  for (let y = y0 + 0.1; y < y1 - 0.02; y += 0.19) mesh(g, rung, m, x, y, z, 0, 0, Math.PI / 2);
  const stand = new CylinderGeometry(0.01, 0.01, 0.1, 6);
  for (const y of [0.75, 1.3, 1.85]) for (const dx of [-0.045, 0.045]) mesh(g, stand, m, x + dx, y, z + 0.05, Math.PI / 2, 0, 0);
  return prop(bake(g));
}

function pennantTexture() {
  return canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#ff9933';
    g.fillRect(0, 0, w, h / 3);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h / 3, w, h / 3);
    g.fillStyle = '#138808';
    g.fillRect(0, (2 * h) / 3, w, h / 3);
    g.strokeStyle = '#1a2a8c';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w / 2, h / 2, 9, 0, Math.PI * 2);
    g.stroke();
  });
}

/** A tall whip antenna at the rear corner with a small flag that streams back and flutters with speed. */
export function buildAntenna() {
  const g = new Group();
  const m = chromeM();
  const a = -0.1;
  const base = new Vector3(0.8, 2.07, -1.5);
  const len = 1.7;
  mesh(g, new CylinderGeometry(0.03, 0.04, 0.05, 10), m, base.x, base.y + 0.02, base.z);
  mesh(g, new CylinderGeometry(0.0045, 0.008, len, 6), m, base.x, base.y + (Math.cos(a) * len) / 2, base.z + (Math.sin(a) * len) / 2, a, 0, 0);
  const tip = new Vector3(base.x, base.y + Math.cos(a) * len, base.z + Math.sin(a) * len);
  mesh(g, new SphereGeometry(0.012, 8, 6), new MeshStandardMaterial({ color: '#e9b64a', metalness: 0.8, roughness: 0.3 }), tip.x, tip.y, tip.z);
  const W = 0.34;
  const H = 0.18;
  const geo = new PlaneGeometry(W, H, 10, 2);
  const fm = new MeshStandardMaterial({ map: pennantTexture(), side: DoubleSide, roughness: 0.7 });
  const flag = mesh(g, geo, fm, tip.x, tip.y - 0.1, tip.z - W / 2 - 0.01, 0, Math.PI / 2, 0);
  flag.castShadow = false;
  flag.frustumCulled = false;
  const pos = geo.attributes.position;
  const rest = Float32Array.from(pos.array);
  let phase = 0;
  const update = (env) => {
    phase += env.dt * (5 + Math.min(env.speed, 28) * 0.6);
    const amp = 0.03 + Math.min(env.speed, 28) * 0.003;
    for (let i = 0; i < pos.count; i++) {
      const u = (rest[i * 3] + W / 2) / W;
      pos.setZ(i, Math.sin(u * 8 - phase) * amp * u);
    }
    pos.needsUpdate = true;
  };
  return prop(g, update);
}

/** Chrome guard rails that wrap round both rear corners and meet the bumper ends. */
export function buildSideGuards() {
  const g = new Group();
  const m = chromeM();
  for (const s of [-1, 1]) {
    const pts = [
      new Vector3(s * 0.9, 0.5, -0.4),
      new Vector3(s * 0.9, 0.5, -1.1),
      new Vector3(s * 0.87, 0.5, -1.45),
      new Vector3(s * 0.76, 0.5, -1.62),
      new Vector3(s * 0.55, 0.5, -1.66),
    ];
    const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    mesh(g, new TubeGeometry(curve, 16, 0.022, 5, false), m);
    mesh(g, new SphereGeometry(0.03, 8, 6), m, s * 0.9, 0.5, -0.4);
    for (const z of [-0.55, -1.0]) mesh(g, new CylinderGeometry(0.014, 0.014, 0.16, 6), m, s * 0.82, 0.5, z, 0, 0, Math.PI / 2);
  }
  return prop(bake(g));
}

export const BUMPER_IDS = ['stock', 'chrome-bar', 'double-chrome', 'spiked'];
