import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { CUSTOMER_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { buildCustomer, MOODS } from './customers.js';
import { setCharacterDrawMode, setCharacterQuality } from './charquality.js';
import { classifyForPack, packPerson } from './pack.js';
import { disposeModelCache } from './util.js';
import { disposeUberMaterials } from './merge.js';

vi.setConfig({ testTimeout: 60000 });

beforeAll(() => {
  setCharacterQuality('medium');
  setCharacterDrawMode({ merge: false, baked: false, limitShadows: true, pack: true });
});
afterAll(() => {
  setCharacterDrawMode({ pack: false, limitShadows: false });
  disposeUberMaterials();
  disposeModelCache();
});

/** Draw calls of a model: live meshes (retired sources are not meshes) that are visible all the way up. */
function liveMeshes(root) {
  const out = [];
  root.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
}

const _m = new Matrix4();
const _v = new Vector3();

/** The world-space-relative-to-root position a source vertex must have in the packed buffer. */
function expectedPosition(root, src, i, out) {
  const g = src.mesh.geometry;
  const p = g.attributes.position;
  out.set(p.getX(i), p.getY(i), p.getZ(i));
  const morphs = g.morphAttributes?.position;
  const infl = src.mesh.morphTargetInfluences;
  if (morphs && infl) {
    for (let k = 0; k < morphs.length; k++) if (infl[k]) out.add(_v.set(morphs[k].getX(i), morphs[k].getY(i), morphs[k].getZ(i)).multiplyScalar(infl[k]));
  }
  _m.copy(root.matrixWorld).invert().multiply(src.mesh.matrixWorld);
  return out.applyMatrix4(_m);
}

describe('packed people', () => {
  for (const kind of Object.keys(CUSTOMER_KINDS)) {
    it(`${kind}: a customer is a handful of draw calls, and the packed buffers equal the rig's own meshes in every mood`, () => {
      const c = buildCustomer(kind, 7);
      expect(c.packs?.length).toBe(kind === 'family' ? 2 : 1);
      const live = liveMeshes(c.group);
      // measured 62 to 89 visible meshes before packing
      expect(live.length).toBeLessThan(kind === 'family' ? 22 : 15);
      let t = 0;
      const want = new Vector3();
      for (const mood of MOODS) {
        c.setMood(mood);
        c.setPatience(mood === 'angry' ? 0.05 : 0.8);
        c.setSpeaking(900, 0.9);
        for (let i = 0; i < 8; i++) c.update(0.04, (t += 0.04));
        let worst = 0;
        let checked = 0;
        for (const pk of c.packs) {
          const root = pk.outs[0].mesh.parent;
          root.updateMatrixWorld(true);
          for (const o of pk.outs) {
            const P = o.geo.attributes.position.array;
            for (const s of o.srcs) {
              if (!s.shown) continue;
              for (let i = 0; i < s.n; i += 7) {
                expectedPosition(root, s, i, want);
                const k = (s.off + i) * 3;
                worst = Math.max(worst, Math.abs(P[k] - want.x), Math.abs(P[k + 1] - want.y), Math.abs(P[k + 2] - want.z));
                checked++;
              }
            }
          }
        }
        expect(checked).toBeGreaterThan(200);
        expect(worst).toBeLessThan(2e-5);
        c.group.traverse((o) => {
          const a = o.isMesh && o.geometry?.attributes?.position?.array;
          if (a) for (let i = 0; i < a.length; i += 5) if (!Number.isFinite(a[i])) throw new Error(`NaN in ${o.name}`);
        });
      }
      c.dispose();
    });
  }

  it('classifies: the face skin and held props stay live, parts of the same class share a bucket', () => {
    const c = buildCustomer('office', 3);
    const kept = [];
    c.group.traverse((o) => {
      if (o.name === 'face-skin') kept.push(o);
    });
    expect(kept.length).toBe(1);
    expect(kept[0].isMesh).toBe(true); // morph targets run on the GPU
    expect(classifyForPack(kept[0], c.group)).toBe(null);
    const classes = new Set(c.packs[0].outs.map((o) => o.b.cls));
    for (const need of ['skin', 'eye', 'hair', 'uber']) expect(classes.has(need)).toBe(true);
    // every skin part (limbs, hands, feet, ears, lids, torso) is ONE mesh
    expect(c.packs[0].outs.filter((o) => o.b.cls === 'skin').length).toBe(1);
    expect(c.packs[0].outs.filter((o) => o.b.cls === 'eye').length).toBe(1);
    c.dispose();
  });

  it('collapses a hidden part and brings it back (the teeth follow the expression)', () => {
    const c = buildCustomer('student', 5);
    const pk = c.packs[0];
    const rig = c.people[0].p;
    c.update(0.016, 1);
    // a packed source that is hidden right now (the teeth while the mouth is shut): its vertices are collapsed
    let target = null;
    for (const o of pk.outs) for (const s of o.srcs) if (!target && s.chain.some((p) => p.visible === false)) target = { o, s };
    expect(target).not.toBe(null);
    const { o, s } = target;
    const P = o.geo.attributes.position.array;
    for (let i = 0; i < s.n * 3; i++) expect(P[s.off * 3 + i]).toBe(0);
    s.chain.forEach((p) => {
      p.visible = true;
    });
    pk.update();
    let nonzero = 0;
    for (let i = 0; i < s.n * 3; i++) if (P[s.off * 3 + i] !== 0) nonzero++;
    expect(nonzero).toBeGreaterThan(s.n);
    void rig;
    c.dispose();
  });

  it('dispose gives the rig its meshes back and removes the packed ones', () => {
    const c = buildCustomer('uncle', 9);
    const rigMeshesBefore = c.people[0].p.group.children.length;
    c.packs[0].dispose();
    let packed = 0;
    c.group.traverse((o) => {
      if (/^packed-/.test(o.name)) packed++;
    });
    expect(packed).toBe(0);
    expect(c.people[0].p.group.children.length).toBeLessThanOrEqual(rigMeshesBefore);
    const face = [];
    c.group.traverse((o) => o.name === 'hand-mesh' && face.push(o));
    expect(face.length).toBeGreaterThan(0);
    expect(face.every((o) => o.isMesh === true)).toBe(true);
    c.packs.length = 0;
    c.dispose();
  });

  it('packPerson on an empty group packs nothing', () => {
    const c = buildCustomer('office', 1);
    const empty = { updateMatrixWorld() {}, matrixWorld: new Matrix4(), traverse() {} };
    expect(packPerson(empty)).toBe(null);
    c.dispose();
  });
});
