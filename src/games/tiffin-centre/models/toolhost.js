// Late-bound access to tools.js (written by another artist): `makeTool(id, opts)` returns { group, grip, tip, set, dispose } and falls back to a
// tiny stub when tools.js is missing or throws, so people still build (and tests still run) without it.
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry } from 'three';
import { sharedMat } from './util.js';

let mod = null;
try {
  // import.meta.glob is replaced by Vite at build time; the empty object means "file absent".
  const found = import.meta.glob('./tools.js', { eager: true });
  mod = found['./tools.js'] || null;
} catch {
  mod = null;
}

const STUB = {
  plate: { w: 0.22, h: 0.012, d: 0.22, c: '#c9d1d6' },
  note: { w: 0.15, h: 0.002, d: 0.07, c: '#8fc58a' },
};

function stubTool(id) {
  const group = new Group();
  const grip = new Object3D();
  const tip = new Object3D();
  const s = STUB[id];
  let geo;
  let mat;
  if (s) {
    geo = new BoxGeometry(s.w, s.h, s.d);
    geo.translate(0, 0, -s.d / 2);
    mat = new MeshStandardMaterial({ color: s.c, roughness: 0.5, metalness: 0.5 });
    tip.position.set(0, 0, -s.d);
  } else {
    geo = new CylinderGeometry(0.008, 0.008, 0.3, 6);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.15);
    mat = new MeshStandardMaterial({ color: '#c9d1d6', roughness: 0.4, metalness: 0.9 });
    tip.position.set(0, 0, -0.3);
  }
  group.add(new Mesh(geo, mat), grip, tip);
  return {
    group,
    grip,
    tip,
    set() {},
    dispose() {
      geo.dispose();
      mat.dispose();
      group.removeFromParent();
    },
    stub: true,
  };
}

export const hasTools = () => !!(mod && typeof mod.buildTool === 'function');

export function makeTool(id, opts) {
  if (mod && typeof mod.buildTool === 'function') {
    try {
      const t = mod.buildTool(id, opts);
      if (t && t.group) return t;
    } catch {
      /* fall through to the stub */
    }
  }
  return stubTool(id);
}

/**
 * Put tool `t` in a hand: the tool's grip point goes to the hand's grip frame, with the tool's working end (-z) pointing along `dir`
 * (hand-local, unmirrored group frame) and its up (+y) along `up`.
 */
export function holdTool(hand, t, dir = [0.7071, 0.7071, 0], up = [0, 0, -1], gripPos = null) {
  const g = hand.grip;
  const z = [-dir[0], -dir[1], -dir[2]];
  const y = up;
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  t.group.matrixAutoUpdate = true;
  t.group.matrix.set(x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1);
  t.group.quaternion.setFromRotationMatrix(t.group.matrix);
  // bring the tool's own grip point onto the hand's grip frame (the tool group origin is the grip for tools.js)
  t.group.position.set(0, 0, 0);
  if (gripPos) t.group.position.set(gripPos[0], gripPos[1], gripPos[2]);
  g.add(t.group);
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Far LOD: tiny proxies of the tools (30-150 triangles) for characters seen from a distance (the real tools from tools.js are 1-3k
// triangles each). Same frame as tools.js: the grip is the origin, the working end points along -z, +y is up.
const farSteel = () => sharedMat('far:steel', () => new MeshStandardMaterial({ color: '#c9d1d6', roughness: 0.35, metalness: 0.9 }));
const farDark = () => sharedMat('far:dark', () => new MeshStandardMaterial({ color: '#3a3430', roughness: 0.6, metalness: 0.4 }));
const farWood = () => sharedMat('far:wood', () => new MeshStandardMaterial({ color: '#8a5a2c', roughness: 0.7 }));
const farNote = () => sharedMat('far:note', () => new MeshStandardMaterial({ color: '#8fc58a', roughness: 0.7, side: 2 }));
const farChai = () => sharedMat('far:chai', () => new MeshStandardMaterial({ color: '#b8742f', roughness: 0.2 }));

export function makeFarTool(id) {
  const group = new Group();
  const geos = [];
  const part = (g, m, x = 0, y = 0, z = 0) => {
    g.translate(x, y, z);
    geos.push(g);
    const mesh = new Mesh(g, m);
    group.add(mesh);
    return mesh;
  };
  const along = (g) => {
    g.rotateX(Math.PI / 2); // cylinder axis y -> z
    return g;
  };
  let tipZ = -0.2;
  switch (id) {
    case 'plate':
      part(new CylinderGeometry(0.12, 0.095, 0.022, 14), farSteel(), 0, 0.01, -0.1);
      tipZ = -0.1;
      break;
    case 'steel-glass':
      part(new CylinderGeometry(0.036, 0.029, 0.095, 10, 1, true), farSteel(), 0, 0.04, 0);
      part(new CylinderGeometry(0.033, 0.033, 0.004, 10), farChai(), 0, 0.075, 0);
      break;
    case 'chai-kettle': {
      part(new CylinderGeometry(0.07, 0.085, 0.16, 12), farSteel(), 0, 0.0, -0.06);
      part(along(new CylinderGeometry(0.012, 0.02, 0.14, 6)), farSteel(), 0, 0.03, -0.185);
      part(new TorusGeometry(0.05, 0.007, 4, 8, Math.PI), farDark(), 0, 0.0, 0.03).rotation.y = Math.PI / 2;
      tipZ = -0.255;
      break;
    }
    case 'ladle':
      part(along(new CylinderGeometry(0.007, 0.007, 0.34, 5)), farSteel(), 0, 0, -0.17);
      part(new SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), farSteel(), 0, 0.005, -0.37);
      tipZ = -0.4;
      break;
    case 'spatula':
      part(along(new CylinderGeometry(0.008, 0.008, 0.22, 5)), farWood(), 0, 0, -0.11);
      part(new BoxGeometry(0.09, 0.004, 0.11), farSteel(), 0, 0, -0.275);
      tipZ = -0.33;
      break;
    case 'jhara':
      part(along(new CylinderGeometry(0.007, 0.007, 0.3, 5)), farSteel(), 0, 0, -0.15);
      part(new CylinderGeometry(0.06, 0.04, 0.012, 10), farSteel(), 0, 0.0, -0.34);
      tipZ = -0.4;
      break;
    case 'money-box':
      part(new BoxGeometry(0.2, 0.12, 0.16), farDark(), 0, 0.0, -0.08);
      break;
    case 'note':
      part(new BoxGeometry(0.15, 0.002, 0.07), farNote(), 0, 0, -0.035);
      tipZ = -0.07;
      break;
    default:
      part(along(new CylinderGeometry(0.008, 0.008, 0.3, 5)), farSteel(), 0, 0, -0.15);
  }
  const grip = new Object3D();
  const tip = new Object3D();
  tip.position.set(0, 0, tipZ);
  group.add(grip, tip);
  return {
    group,
    grip,
    tip,
    far: true,
    set() {},
    dispose() {
      for (const g of geos) g.dispose();
      group.removeFromParent();
    },
  };
}
