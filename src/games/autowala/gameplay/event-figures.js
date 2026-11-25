// Low-poly bodies for the city events: a standing person (two meshes that share ONE instance-matrix buffer: the clothes take the
// per-instance colour, skin and legs keep their own), a horse with a lit blanket, a generator cart, kites. Every geometry is a few
// dozen to ~150 triangles and merged, so a whole procession is a handful of draw calls.
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmp = new Color();

/** A box of one colour, centred at (x,y,z), as a non-indexed geometry with a colour attribute. */
export function colorBox(w, h, d, x, y, z, hex, rx = 0, rz = 0) {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, hex);
}

export function paint(g, hex, mul = 1) {
  tmp.set(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = tmp.r * mul;
    a[i * 3 + 1] = tmp.g * mul;
    a[i * 3 + 2] = tmp.b * mul;
  }
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g;
}

const merge = (parts) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach((p) => p.dispose());
  return g;
};

/** Person, clothes part (torso, arms): white, takes the instance colour. About 1.7 m tall, feet at y = 0. */
export function personClothesGeometry() {
  return merge([
    colorBox(0.44, 0.62, 0.27, 0, 1.1, 0, 0xffffff),
    colorBox(0.1, 0.52, 0.12, -0.28, 1.08, 0, 0xffffff, 0, 0.12),
    colorBox(0.1, 0.52, 0.12, 0.28, 1.08, 0, 0xffffff, 0, -0.12),
    colorBox(0.42, 0.34, 0.25, 0, 0.66, 0, 0xffffff), // kurta / skirt hem
  ]);
}
/** Person, skin and trousers (fixed colours). */
export function personSkinGeometry() {
  const head = new SphereGeometry(0.13, 7, 5).translate(0, 1.55, 0);
  return merge([
    paint(head, 0x8a5a3c),
    colorBox(0.12, 0.1, 0.1, -0.28, 0.78, 0, 0x8a5a3c),
    colorBox(0.12, 0.1, 0.1, 0.28, 0.78, 0, 0x8a5a3c),
    colorBox(0.15, 0.5, 0.17, -0.11, 0.25, 0, 0x2a2430),
    colorBox(0.15, 0.5, 0.17, 0.11, 0.25, 0, 0x2a2430),
    colorBox(0.2, 0.06, 0.3, -0.11, 0.03, 0.05, 0x1a1418),
    colorBox(0.2, 0.06, 0.3, 0.11, 0.03, 0.05, 0x1a1418),
  ]);
}

/** Add a share of a material's own (vertex / instance tinted) colour as light, so festive things stay readable after dark. */
export function selfLit(mat, key, k) {
  mat.customProgramCacheKey = () => `${key}-${k}`;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * ${k.toFixed(2)};`);
  };
  return mat;
}

/** A set of people: the shirt InstancedMesh and the skin InstancedMesh sharing one matrix buffer. Add `.meshes` to a parent. */
export function createPeople(count, { emissive = 0x2a1a30 } = {}) {
  const clothesGeo = personClothesGeometry();
  const skinGeo = personSkinGeometry();
  const clothesMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, emissive, emissiveIntensity: 0.6 });
  selfLit(clothesMat, 'event-clothes', 0.38); // festive clothes are never dark: saris stay saturated at night
  const skinMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const clothes = new InstancedMesh(clothesGeo, clothesMat, count);
  const skin = new InstancedMesh(skinGeo, skinMat, count);
  skin.instanceMatrix = clothes.instanceMatrix; // one buffer, two draws
  clothes.instanceMatrix.setUsage(35048);
  for (const m of [clothes, skin]) {
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.count = 0;
  }
  return {
    clothes,
    skin,
    meshes: [clothes, skin],
    setCount(n) { clothes.count = skin.count = n; },
    setColor(i, c) { clothes.setColorAt(i, tmp.set(c)); if (clothes.instanceColor) clothes.instanceColor.needsUpdate = true; },
    dispose() {
      clothesGeo.dispose();
      skinGeo.dispose();
      clothesMat.dispose();
      skinMat.dispose();
      clothes.dispose?.();
      skin.dispose?.();
    },
  };
}

/** The wedding horse, white with a red and gold blanket. Faces +z, 1.9 m long. */
export function horseGeometry() {
  const cream = 0xf0e8da;
  const parts = [
    colorBox(0.62, 0.78, 1.7, 0, 1.15, 0, cream), // body
    colorBox(0.3, 0.82, 0.34, 0, 1.55, 0.95, cream, -0.5), // neck
    colorBox(0.26, 0.28, 0.6, 0, 1.92, 1.28, cream, 0.35), // head
    colorBox(0.5, 0.06, 1.2, 0, 1.56, -0.05, 0xd8202e), // blanket (red)
    colorBox(0.66, 0.5, 1.1, 0, 1.2, -0.05, 0xd8202e),
    colorBox(0.68, 0.06, 1.14, 0, 0.93, -0.05, 0xffc23a), // gold hem
    colorBox(0.3, 0.1, 0.34, 0, 2.06, 1.1, 0xffc23a), // headpiece
    colorBox(0.16, 0.14, 0.5, 0, 1.78, 0.6, 0xffc23a),
    colorBox(0.14, 0.7, 0.14, -0.2, 0.4, 0.62, cream), // legs
    colorBox(0.14, 0.7, 0.14, 0.2, 0.4, 0.62, cream),
    colorBox(0.14, 0.7, 0.14, -0.2, 0.4, -0.62, cream),
    colorBox(0.14, 0.7, 0.14, 0.2, 0.4, -0.62, cream),
    colorBox(0.1, 0.6, 0.18, 0, 1.2, -1.0, 0x3a2a20, 0.4), // tail
  ];
  return merge(parts);
}

/** The bulbs round the horse (at u = hu) and on the cart's rear (at u = cu): an unlit mesh with colours above 1 so the bloom picks them up. */
export function bulbGeometry(hu = 0, cu = -16) {
  const parts = [];
  const warm = [0xffd27a, 0xff5fa8, 0x6be8ff, 0xffd27a];
  let k = 0;
  for (let i = 0; i < 7; i++) {
    const z = hu - 0.55 + i * 0.18;
    parts.push(colorBox(0.09, 0.09, 0.09, -0.36, 0.9, z, warm[k++ % 4]));
    parts.push(colorBox(0.09, 0.09, 0.09, 0.36, 0.9, z, warm[k++ % 4]));
  }
  parts.push(colorBox(0.14, 0.14, 0.14, 0, 2.08, hu + 1.3, 0xffd27a));
  const rear = cu - 1.18;
  parts.push(colorBox(1.5, 0.12, 0.1, 0, 1.2, rear, 0xffd27a));
  parts.push(colorBox(1.5, 0.12, 0.1, 0, 0.42, rear, 0xff5fa8));
  parts.push(colorBox(0.1, 0.9, 0.1, -0.76, 0.85, rear, 0x6be8ff));
  parts.push(colorBox(0.1, 0.9, 0.1, 0.76, 0.85, rear, 0x6be8ff));
  return merge(parts);
}

/** A generator cart on two wheels, behind the band. Local origin at the cart's centre on the ground. */
export function cartGeometry() {
  return merge([
    colorBox(1.5, 0.9, 2.2, 0, 0.75, 0, 0x4a3a58),
    colorBox(1.4, 0.7, 0.9, 0, 1.55, 0.5, 0x2a2438),
    colorBox(0.2, 0.7, 0.7, -0.85, 0.35, 0.2, 0x181420),
    colorBox(0.2, 0.7, 0.7, 0.85, 0.35, 0.2, 0x181420),
  ]);
}

/** Lamp carried on a head: a thin stick and a glowing round shade (one unlit mesh, instance-coloured). */
export function lampGeometry() {
  const shade = new SphereGeometry(0.3, 8, 6).translate(0, 0.45, 0);
  return merge([paint(shade, 0xffffff), colorBox(0.06, 0.4, 0.06, 0, 0.1, 0, 0xffffff, 0, 0)]);
}

export function glowMaterial(boost = 2.2) {
  return new MeshBasicMaterial({ vertexColors: true, color: new Color(boost, boost, boost), toneMapped: true });
}

/** A kite: a diamond on its bridle plus a wiggling tail, drawn from both sides. Faces +z, ~1 m wide before scaling. */
export function kiteGeometry() {
  const p = [
    0, 0.7, 0, -0.5, 0.1, 0, 0, -0.55, 0,
    0, 0.7, 0, 0, -0.55, 0, 0.5, 0.1, 0,
    // tail: a thin zigzag ribbon hanging from the bottom corner
    -0.04, -0.55, 0, 0.04, -0.55, 0, -0.16, -1.25, 0.05,
    0.04, -0.55, 0, 0.18, -1.25, 0.05, -0.16, -1.25, 0.05,
    -0.16, -1.25, 0.05, 0.18, -1.25, 0.05, 0.0, -2.0, 0,
    0.18, -1.25, 0.05, 0.1, -2.0, 0, 0.0, -2.0, 0,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

export const kiteMaterial = () => new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, fog: true });
