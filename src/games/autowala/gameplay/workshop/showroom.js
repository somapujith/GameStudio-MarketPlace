// The garage's three.js bits: the neon entry ring on the road (always there, so you can spot the garage from afar) and the
// showroom set (a turntable, a key spot and two coloured rim lights) that exists only while the workshop is open.
import {
  AdditiveBlending, BufferAttribute, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PointLight, RingGeometry, SpotLight, TorusGeometry, Object3D,
} from 'three';

const PINK = 0xff3d9a;
const CYAN = 0x37e6ff;
const MAX_EMISSIVE = 1.25; // the bloom threshold is 1.05: this glows gently, it does not flare

const disposeTree = (root) => {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
    else m?.dispose?.();
  });
};

/** The glowing ring + light column at the garage's road front. update(t) pulses it; dispose() removes it. */
export function createEntryRing(scene, x, y, z) {
  const g = new Group();
  g.position.set(x, y + 0.14, z);
  // The two rings are all emissive (their lit base is near black), so they are unlit: a lit transparent double-sided material was 4 draws
  // of ~11 GL calls each (every light of the scene is uploaded per program); unlit and single pass (flat) it is 2 draws of ~4.
  const ringMat = new MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.95, side: DoubleSide, forceSinglePass: true });
  ringMat.color.multiplyScalar(MAX_EMISSIVE);
  const ring = new Mesh(new RingGeometry(3.15, 3.95, 56), ringMat);
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const innerMat = new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9, side: DoubleSide, forceSinglePass: true });
  innerMat.color.multiplyScalar(MAX_EMISSIVE);
  const inner = new Mesh(new RingGeometry(2.45, 2.7, 56), innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.01;
  g.add(inner);

  // a tall translucent column (brighter at the bottom) so the ring shows over the rooftops
  const H = 26;
  const col = new CylinderGeometry(3.55, 3.55, H, 40, 1, true);
  col.translate(0, H / 2, 0);
  const pos = col.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.pow(1 - Math.min(1, pos.getY(i) / H), 2.2) * 0.55;
    colors[i * 3] = k * 1.0;
    colors[i * 3 + 1] = k * 0.24;
    colors[i * 3 + 2] = k * 0.6;
  }
  col.setAttribute('color', new BufferAttribute(colors, 3));
  const colMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, fog: false });
  const column = new Mesh(col, colMat);
  column.renderOrder = 2;
  g.add(column);

  scene.add(g);
  return {
    group: g,
    update(t) {
      const p = 0.5 + 0.5 * Math.sin(t * 2.2);
      ringMat.color.setHex(PINK).multiplyScalar(MAX_EMISSIVE * (0.78 + 0.22 * p));
      innerMat.color.setHex(CYAN).multiplyScalar(MAX_EMISSIVE * (0.7 + 0.3 * (1 - p)));
      inner.rotation.z = t * 0.5;
      colMat.opacity = 0.36 + 0.14 * p;
    },
    setVisible(v) { g.visible = v; },
    dispose() {
      scene.remove(g);
      disposeTree(g);
    },
  };
}

/**
 * The showroom set around (x, y, z): a turntable disc and three lights. heading orients the key light to the auto's nose.
 * `bank` (light-bank.js `borrowLights`): the three lights are borrowed from the street (the pool and the auto's headlight) instead of added, so the
 * workshop is not a new light set (new shader programs); without it the set adds its own, as before.
 */
export function createSet(scene, x, y, z, heading, bank = null) {
  const g = new Group();
  g.position.set(x, y, z);
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);

  const disc = new Group();
  const base = new Mesh(
    new CylinderGeometry(2.45, 2.6, 0.16, 56),
    new MeshStandardMaterial({ color: 0x130d1c, metalness: 0.7, roughness: 0.32 }),
  );
  base.position.y = 0.08;
  disc.add(base);
  const rimMat = new MeshStandardMaterial({ color: 0x1a0612, emissive: PINK, emissiveIntensity: MAX_EMISSIVE });
  const rim = new Mesh(new TorusGeometry(2.5, 0.05, 8, 72), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.17;
  disc.add(rim);
  const rim2Mat = new MeshStandardMaterial({ color: 0x06161c, emissive: CYAN, emissiveIntensity: MAX_EMISSIVE });
  const rim2 = new Mesh(new TorusGeometry(1.95, 0.035, 8, 64), rim2Mat);
  rim2.rotation.x = Math.PI / 2;
  rim2.position.y = 0.165;
  disc.add(rim2);
  // spokes, so the disc is seen to turn
  const spokeMat = new MeshStandardMaterial({ color: 0x120a1c, emissive: CYAN, emissiveIntensity: 0.9 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = new Mesh(new RingGeometry(2.05, 2.32, 3, 1, a, 0.12), spokeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.168;
    disc.add(s);
  }
  g.add(disc);

  const keyAt = [fx * 4.2 + rx * 3.2, 7.2, fz * 4.2 + rz * 3.2];
  const pinkAt = [-fx * 3.2 + rx * 3.6, 2.4, -fz * 3.2 + rz * 3.6];
  const cyanAt = [-fx * 3.2 - rx * 3.6, 2.4, -fz * 3.2 - rz * 3.6];
  let key;
  if (bank) {
    // borrowed lights live in the scene, not in the group: world positions, the same numbers
    key = bank.key;
    key.color.setHex(0xfff0dc);
    key.intensity = 120;
    key.distance = 34;
    key.angle = 0.62;
    key.penumbra = 0.55;
    key.decay = 2;
    key.castShadow = false;
    key.position.set(x + keyAt[0], y + keyAt[1], z + keyAt[2]);
    key.target.position.set(x, y + 0.6, z);
    for (const [light, color, at] of [[bank.pink, PINK, pinkAt], [bank.cyan, CYAN, cyanAt]]) {
      light.color.setHex(color);
      light.intensity = 22;
      light.distance = 14;
      light.decay = 2;
      light.position.set(x + at[0], y + at[1], z + at[2]);
    }
  } else {
    key = new SpotLight(0xfff0dc, 120, 34, 0.62, 0.55, 2);
    key.position.set(...keyAt);
    const keyTarget = new Object3D();
    keyTarget.position.set(0, 0.6, 0);
    g.add(keyTarget);
    key.target = keyTarget;
    key.castShadow = false;
    g.add(key);
    const pinkLight = new PointLight(PINK, 22, 14, 2);
    pinkLight.position.set(...pinkAt);
    g.add(pinkLight);
    const cyanLight = new PointLight(CYAN, 22, 14, 2);
    cyanLight.position.set(...cyanAt);
    g.add(cyanLight);
  }

  scene.add(g);
  return {
    group: g,
    update(t, dt) {
      disc.rotation.y += dt * 0.35;
      const p = 0.5 + 0.5 * Math.sin(t * 1.6);
      rimMat.emissiveIntensity = MAX_EMISSIVE * (0.85 + 0.15 * p);
    },
    dispose() {
      scene.remove(g);
      disposeTree(g);
      if (bank) bank.release();
      else key.dispose?.();
    },
  };
}
