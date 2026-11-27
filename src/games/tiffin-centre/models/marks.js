// Small marks the scene hangs on customers (the operations layer), built from primitives, node-safe, each with dispose():
//   buildParcelBag(seed)   a packed takeaway bag: a white carry bag with red handles and the tiffin boxes bulging in it (customers with `parcel`)
//   buildRegularStar()     a small gold five-pointed star that floats and turns above a regular's head
// Both are shared-geometry groups: { group, update(dt, t), dispose() }. The bag's origin is the grip (hangs along -y), the star's the point above the head.
import { AdditiveBlending, BoxGeometry, CircleGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Shape, TorusGeometry } from 'three';
import { disposeObject, num, sharedGeo, sharedMat } from './util.js';

const mat = (key, color, rough = 0.7, extra = {}) => sharedMat(`marks:${key}`, () => new MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));

/** The takeaway bag: ~22 x 26 x 12 cm of white plastic, red twisted handles, a round lid showing through. Origin at the handle top. */
export function buildParcelBag(seed = 0) {
  const group = new Group();
  group.name = 'parcel-bag';
  const body = new Mesh(sharedGeo('marks:bag', () => new BoxGeometry(0.22, 0.26, 0.12).translate(0, -0.2, 0)), mat('bagPlastic', '#f1efe8', 0.35, { transparent: true, opacity: 0.94 }));
  group.add(body);
  // two tiffin lids and a foil-wrapped parcel showing at the top
  const lidM = mat('bagLid', '#c9ced2', 0.3, { metalness: 0.9 });
  for (const [x, z] of [[-0.045, 0.0], [0.05, 0.01]]) {
    const lid = new Mesh(sharedGeo('marks:lid', () => new CylinderGeometry(0.055, 0.055, 0.012, 14).translate(0, -0.085, 0)), lidM);
    lid.position.set(x, 0, z);
    group.add(lid);
  }
  const handleM = mat('bagHandle', '#d3281c', 0.5);
  for (const s of [-1, 1]) {
    const h = new Mesh(sharedGeo('marks:handle', () => new TorusGeometry(0.045, 0.006, 4, 12, Math.PI)), handleM);
    h.position.set(s * 0.05, -0.065, 0);
    group.add(h);
  }
  // a printed red stripe so it reads as a shop bag from across the counter
  const stripe = new Mesh(sharedGeo('marks:stripe', () => new PlaneGeometry(0.22, 0.04)), mat('bagStripe', '#d3281c', 0.5, { side: DoubleSide }));
  stripe.position.set(0, -0.17, 0.0605);
  group.add(stripe);
  group.rotation.y = (num(seed, 0) % 7) * 0.1;
  return { group, update() {}, dispose: () => disposeObject(group) };
}

const starGeo = () =>
  sharedGeo('marks:star', () => {
    const s = new Shape();
    const n = 5;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? 0.075 : 0.032;
      const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 1 });
    g.translate(0, 0, -0.011);
    return g;
  });

/** The regular's star: gold, a little glow plate behind it, turning slowly and bobbing. Origin = centre of the star. */
export function buildRegularStar() {
  const group = new Group();
  group.name = 'regular-star';
  const starM = sharedMat('marks:starGold', () => new MeshStandardMaterial({ color: '#ffc83d', emissive: '#ffb020', emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 }));
  // the owner places `group` (above a head); the bobbing is on an inner group, so update() never moves the place
  const inner = new Group();
  group.add(inner);
  const star = new Mesh(starGeo(), starM);
  inner.add(star);
  const glowM = new MeshBasicMaterial({ color: '#ffd35a', transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
  // a round halo: the old 26 cm square plane showed as a translucent rectangle behind the star (tf-ui QA, docs/perf/tf-ui.md)
  const glow = new Mesh(sharedGeo('marks:glowDisc', () => new CircleGeometry(0.13, 24)), glowM);
  glow.position.z = -0.03;
  inner.add(glow);
  return {
    group,
    update(dt, t) {
      const tt = num(t, 0);
      star.rotation.y = Math.sin(tt * 1.3) * 0.9;
      inner.position.y = Math.sin(tt * 2.1) * 0.012;
      glowM.opacity = 0.18 + 0.08 * Math.sin(tt * 3.1);
    },
    dispose() {
      glowM.dispose();
      disposeObject(group);
    },
  };
}
