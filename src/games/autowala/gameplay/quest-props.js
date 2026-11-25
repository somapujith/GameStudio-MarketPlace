// OWNER: quests agent. The little 3D things missions put in the world: stunt ramps, cows standing in the road, the baraat convoy,
// the rival auto and the job board sign at Mama's Garage. All of it tiny (merged geometry, one draw call each, a few hundred
// triangles), created only while a mission needs it, and disposed with it. Nothing here allocates per frame.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../render/textures.js';
import { buildAuto } from '../sim/autoModel.js';
import { DROP, LIP, rampMesh } from './quest-ramps.js';

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3(1, 1, 1);
const tmpP = new Vector3();
const UP = new Vector3(0, 1, 0);

/** A box part with a vertex colour, moved to (x, y, z) (and optionally turned about y). */
function part(w, h, d, color, x, y, z, ry = 0) {
  const g = new BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}
const merge = (parts) => {
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  parts.forEach((p) => p.dispose());
  return g;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Cows (instanced): standing still in the road. Collision is done by the runtime (quest-world.js) with a plain circle test.

function cowGeometry() {
  const p = [
    part(0.85, 0.8, 1.9, '#f1ebdd', 0, 1.05, 0),
    part(0.42, 0.46, 0.62, '#efe6d2', 0, 1.25, 1.2),
    part(0.3, 0.2, 0.2, '#b9a58a', 0, 1.1, 1.55),
    part(0.88, 0.45, 0.7, '#8a5a35', 0, 1.1, -0.4),
    part(0.1, 0.1, 0.5, '#5a4030', 0, 0.9, -1.05),
  ];
  for (const sx of [-1, 1]) for (const z of [-0.65, 0.65]) p.push(part(0.15, 0.7, 0.16, '#cfc6ae', sx * 0.3, 0.35, z));
  for (const sx of [-1, 1]) p.push(part(0.07, 0.07, 0.3, '#e8dcc6', sx * 0.2, 1.52, 1.25));
  return merge(p);
}

export function createCows(scene, cows) {
  const geo = cowGeometry();
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const mesh = new InstancedMesh(geo, mat, Math.max(1, cows.length));
  mesh.frustumCulled = false;
  mesh.count = cows.length;
  cows.forEach((c, i) => {
    tmpQ.setFromAxisAngle(UP, c.h || 0);
    tmpM.compose(tmpP.set(c.x, 0, c.z), tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return {
    mesh,
    dispose() {
      scene.remove(mesh);
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ramps: one merged mesh for all of them, painted orange with a bright lip.

export function createRamps(scene, ramps) {
  const geos = ramps.map((r) => {
    const g = new BufferGeometry();
    const pos = rampMesh(r);
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const col = new Float32Array(pos.length);
    const slope = new Color('#ff7a1a');
    const lip = new Color('#ffe14d');
    const climb = r.len / 2 - LIP - DROP;
    for (let i = 0; i < pos.length / 3; i++) {
      const c = pos[i * 3 + 2] >= climb - 0.01 && pos[i * 3 + 1] > 0.01 ? lip : slope;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.rotateY(Math.atan2(r.dx, r.dz));
    g.translate(r.x, 0.02, r.z);
    return g;
  });
  const geo = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  geo.computeVertexNormals();
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: new Color('#ff5a00'), emissiveIntensity: 0.35, side: DoubleSide });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The baraat: a groom on a white horse, the dhol band, a lit flower cart. Origin at the middle, facing +z, about 12 m long.

export function createConvoy(scene) {
  const solid = [
    part(0.6, 0.95, 2.1, '#f4f1ea', 0, 1.15, 5.2), // horse body
    part(0.3, 0.5, 0.7, '#f4f1ea', 0, 1.7, 6.5), // horse head
    part(0.18, 0.7, 0.18, '#e6e0d4', -0.2, 0.35, 5.8),
    part(0.18, 0.7, 0.18, '#e6e0d4', 0.2, 0.35, 5.8),
    part(0.18, 0.7, 0.18, '#e6e0d4', -0.2, 0.35, 4.6),
    part(0.18, 0.7, 0.18, '#e6e0d4', 0.2, 0.35, 4.6),
    part(0.55, 0.95, 0.5, '#d8a423', 0, 2.05, 5.2), // the groom, in gold
    part(0.34, 0.34, 0.34, '#c68a5e', 0, 2.75, 5.2),
    part(0.4, 0.3, 0.4, '#e83a6a', 0, 3.05, 5.2), // turban
    part(2.2, 0.35, 4.2, '#5b2a86', 0, 0.55, -3.4), // flower cart
    part(0.28, 0.28, 0.28, '#222', -1.15, 0.28, -2.4),
    part(0.28, 0.28, 0.28, '#222', 1.15, 0.28, -2.4),
    part(0.28, 0.28, 0.28, '#222', -1.15, 0.28, -4.4),
    part(0.28, 0.28, 0.28, '#222', 1.15, 0.28, -4.4),
  ];
  const shirts = ['#ff3d9a', '#37e6ff', '#a6ff3d', '#ffc857', '#8f6bff'];
  for (let i = 0; i < 5; i++) {
    const x = (i % 2 ? 1 : -1) * 0.8 * (i > 1 ? 1.4 : 1);
    const z = 3.1 - i * 0.9;
    solid.push(part(0.5, 0.9, 0.4, shirts[i], x, 1.15, z), part(0.3, 0.3, 0.3, '#b87b53', x, 1.8, z));
  }
  const solidGeo = merge(solid);
  const lit = [
    part(0.12, 2.2, 0.12, '#ffd36b', -1, 1.7, -1.5),
    part(0.12, 2.2, 0.12, '#ffd36b', 1, 1.7, -1.5),
    part(0.12, 2.2, 0.12, '#ffd36b', -1, 1.7, -5.3),
    part(0.12, 2.2, 0.12, '#ffd36b', 1, 1.7, -5.3),
    part(2.4, 0.18, 4.2, '#ff5fb0', 0, 2.85, -3.4),
    part(0.5, 0.18, 0.18, '#fff2c0', 0, 3.1, -3.4),
  ];
  const litGeo = merge(lit);
  const solidMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const litMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  litMat.color = new Color(1.15, 1.15, 1.15);
  const group = new Group();
  group.add(new Mesh(solidGeo, solidMat), new Mesh(litGeo, litMat));
  group.visible = false;
  scene.add(group);
  return {
    group,
    /** Put the convoy's middle at (x, z) facing `heading` (0 faces +z). */
    place(x, z, heading) {
      group.position.set(x, 0, z);
      group.rotation.y = heading;
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      scene.remove(group);
      solidGeo.dispose();
      litGeo.dispose();
      solidMat.dispose();
      litMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The rival auto: a plain traffic-style auto driven along a path by the runtime (position and heading set each frame).

export function createRival(scene, color = '#37e6ff') {
  const auto = buildAuto({ color, player: false });
  auto.visible = false;
  scene.add(auto);
  const wheels = auto.userData.wheels || [];
  let spin = 0;
  return {
    auto,
    place(x, z, heading, speed, dt) {
      auto.position.set(x, 0, z);
      auto.rotation.set(0, heading, 0);
      auto.visible = true;
      spin += (speed * dt) / 0.34;
      for (const w of wheels) w.rotation.x = spin;
    },
    hide() {
      auto.visible = false;
    },
    // Only detach it: the traffic autos share their geometry and materials, disposing them would break the traffic.
    dispose() {
      scene.remove(auto);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The job board: a neon sign on two posts. Own canvas texture (disposed with it).

export function createBoardSign(scene, x, y, z, yaw) {
  const tex = canvasTexture(512, 320, (g, w, h) => {
    g.fillStyle = '#160a2b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#37e6ff';
    g.lineWidth = 10;
    g.shadowColor = '#37e6ff';
    g.shadowBlur = 20;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.shadowBlur = 14;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffc857';
    g.shadowColor = '#ffc857';
    g.font = '800 74px "Bricolage Grotesque Variable", Impact, sans-serif';
    g.fillText('JOB BOARD', w / 2, 100);
    g.fillStyle = '#ff7ab8';
    g.shadowColor = '#ff3d9a';
    g.font = '800 54px "Noto Sans Telugu Variable", sans-serif';
    g.fillText('పని బోర్డు', w / 2, 176);
    g.fillStyle = '#fff3d6';
    g.shadowBlur = 6;
    g.font = '700 32px "Bricolage Grotesque Variable", sans-serif';
    g.fillText("Mama's Garage  |  Press E", w / 2, 252);
  }, { anisotropy: 4 });
  const panelGeo = new PlaneGeometry(3.4, 2.125);
  const panelMat = new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false });
  panelMat.color = new Color(1.1, 1.1, 1.1);
  const panel = new Mesh(panelGeo, panelMat);
  panel.position.y = 2.6;
  const postGeo = merge([part(0.14, 2.7, 0.14, '#3a2a55', -1.5, 1.35, 0), part(0.14, 2.7, 0.14, '#3a2a55', 1.5, 1.35, 0), part(3.4, 0.12, 0.12, '#3a2a55', 0, 1.5, 0)]);
  const postMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const post = new Mesh(postGeo, postMat);
  const group = new Group();
  group.add(panel, post);
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  scene.add(group);
  return {
    group,
    dispose() {
      scene.remove(group);
      panelGeo.dispose();
      panelMat.dispose();
      tex.dispose();
      postGeo.dispose();
      postMat.dispose();
    },
  };
}
