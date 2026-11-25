import { afterAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AU, AU_NAMES, EXPRESSION_NAMES, EXPRESSIONS, ExpressionState, expressionForMood } from './expressions.js';
import { makeFaceParams, makeShape } from './facegen.js';
import { buildHead } from './face.js';
import { buildHair, HAIR_STYLES, HEADWEAR } from './hair.js';
import { disposeModelCache, countTriangles } from './util.js';
import { TIERS } from './charquality.js';

afterAll(() => disposeModelCache());

function trackOwned(obj) {
  const owned = [];
  const seen = new Set();
  const add = (x) => {
    if (!x || seen.has(x) || x.userData?.shared) return;
    seen.add(x);
    owned.push(x);
    const orig = x.dispose.bind(x);
    x.__disposed = false;
    x.dispose = () => {
      x.__disposed = true;
      orig();
    };
  };
  obj.traverse((o) => {
    add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) add(m);
  });
  return owned;
}

describe('expressions', () => {
  it('has the twelve named expressions', () => {
    expect(EXPRESSION_NAMES).toEqual(['neutral', 'bored', 'impatient', 'angry', 'happy', 'delighted', 'eating', 'paying', 'sheepish', 'surprised', 'laughing', 'sad']);
    for (const n of EXPRESSION_NAMES) expect(EXPRESSIONS[n]).toBeTruthy();
  });
  it('blends to the target within the blend time and weights scale from neutral', () => {
    const e = new ExpressionState(3);
    e.setExpression('angry', 1, 200);
    let t = 0;
    for (let i = 0; i < 60; i++) e.update(0.016, (t += 0.016));
    expect(e.au[AU.browDownL]).toBeGreaterThan(0.9);
    expect(e.au[AU.noseWrinkle]).toBeGreaterThan(0.45);
    expect(e.flush).toBeGreaterThan(0.7);
    e.setExpression('angry', 0.5, 0);
    e.update(0.016, (t += 0.016));
    expect(e.au[AU.browDownL]).toBeCloseTo(0.5, 1);
    e.setExpression('happy', 1, 100);
    for (let i = 0; i < 60; i++) e.update(0.016, (t += 0.016));
    expect(e.au[AU.smileL]).toBeGreaterThan(0.7);
    expect(e.au[AU.browDownL]).toBeLessThan(0.05);
  });
  it('speech opens the jaw while speaking and stops after', () => {
    const e = new ExpressionState(5);
    e.setSpeaking(1000, 1);
    let t = 0;
    let maxJaw = 0;
    for (let i = 0; i < 70; i++) {
      e.update(0.016, (t += 0.016));
      maxJaw = Math.max(maxJaw, e.au[AU.jawOpen]);
    }
    expect(maxJaw).toBeGreaterThan(0.25);
    for (let i = 0; i < 120; i++) e.update(0.016, (t += 0.016));
    expect(e.au[AU.jawOpen]).toBeLessThan(0.05);
  });
  it('blinks every 2 to 6 seconds', () => {
    const e = new ExpressionState(11);
    let t = 0;
    let blinks = 0;
    let was = 0;
    for (let i = 0; i < 60 * 30; i++) {
      e.update(1 / 60, (t += 1 / 60));
      if (e.blink > 0.5 && was <= 0.5) blinks += 1;
      was = e.blink;
    }
    expect(blinks).toBeGreaterThanOrEqual(5);
    expect(blinks).toBeLessThanOrEqual(16);
  });
  it('is safe against NaN input and unknown names', () => {
    const e = new ExpressionState(1);
    e.setExpression('nope', NaN, NaN);
    e.setSpeaking(NaN, NaN);
    e.update(NaN, NaN);
    for (const v of e.au) expect(Number.isFinite(v)).toBe(true);
    expect(e.name).toBe('neutral');
  });
  it('maps moods and patience to expressions', () => {
    expect(expressionForMood('waiting', 1)).toBe('neutral');
    expect(expressionForMood('waiting', 0.5)).toBe('bored');
    expect(expressionForMood('waiting', 0.3)).toBe('impatient');
    expect(expressionForMood('waiting', 0.05)).toBe('angry');
    expect(expressionForMood('paying')).toBe('paying');
    expect(expressionForMood('eating')).toBe('eating');
  });
});

describe('face parameters and sculpt', () => {
  it('are deterministic per kind and seed and vary between seeds', () => {
    expect(JSON.stringify(makeFaceParams('office', 4))).toBe(JSON.stringify(makeFaceParams('office', 4)));
    const s = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((i) => JSON.stringify([makeFaceParams('student', i).W, makeFaceParams('student', i).noseTip, makeFaceParams('student', i).lipFull])));
    expect(s.size).toBeGreaterThan(5);
  });
  it('age ranges follow the kind', () => {
    for (let i = 0; i < 12; i++) {
      expect(makeFaceParams('uncle', i).age).toBeGreaterThan(55);
      expect(makeFaceParams('student', i).age).toBeLessThan(25);
      expect(makeFaceParams('child', i).child).toBeGreaterThan(0.3);
    }
  });
  it('the head surface is finite and sensibly proportioned', () => {
    const shape = makeShape(makeFaceParams('office', 2));
    const out = { x: 0, y: 0, z: 0 };
    let minY = 9;
    let maxY = -9;
    let maxX = 0;
    for (let k = 0; k < 48; k++) {
      for (const y of [0.1, 0.06, 0.0, -0.05, -0.0745, -0.11]) {
        shape.point(-Math.PI + (k / 48) * 2 * Math.PI, y, out);
        expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        minY = Math.min(minY, out.y);
        maxY = Math.max(maxY, out.y);
        maxX = Math.max(maxX, Math.abs(out.x));
      }
    }
    expect(maxY - minY).toBeGreaterThan(0.17);
    expect(maxX).toBeGreaterThan(0.06);
    expect(maxX).toBeLessThan(0.09);
  });
});

describe('head', () => {
  for (const kind of ['office', 'student', 'family', 'uncle', 'autowala', 'techie', 'child', 'cook']) {
    it(`${kind}: builds, animates all expressions, disposes`, () => {
      const head = buildHead({ kind, seed: 7 });
      const owned = trackOwned(head.group);
      expect(head.skinMesh.morphTargetInfluences.length).toBeGreaterThan(8);
      let t = 0;
      head.lookAt(new Vector3(0.3, 0.2, 3));
      for (const n of EXPRESSION_NAMES) {
        head.setExpression(n, 1, 60);
        if (n === 'laughing') head.setSpeaking(500, 1);
        for (let i = 0; i < 10; i++) head.update(0.016, (t += 0.016));
        for (const v of head.skinMesh.morphTargetInfluences) expect(Number.isFinite(v)).toBe(true);
        for (const e of head.eyes) expect(Number.isFinite(e.pivot.rotation.x + e.pivot.rotation.y + e.lidU.rotation.x + e.lidL.rotation.x)).toBe(true);
      }
      head.setExpression('surprised', 1, 0);
      head.update(0.016, (t += 0.016));
      expect(head.skinMesh.morphTargetInfluences[head.morphAU.indexOf(AU.jawOpen)]).toBeGreaterThan(0.4);
      head.lookAt(null);
      head.update(0.016, t + 0.1);
      expect(countTriangles(head.group)).toBeLessThan(6500);
      head.dispose();
      head.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }
  it('expression morph moves the mouth corners up for a smile and down for a frown', () => {
    const head = buildHead({ kind: 'office', seed: 2, face: { gender: 'm' } });
    const pos = head.skinMesh.geometry.attributes.position;
    const names = head.skinMesh.geometry.userData.morphAU;
    let best = 0;
    let bd = 9;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - 0.027, pos.getY(i) - head.shape.vwarp(-0.0745), pos.getZ(i) - 0.075);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const dy = (au) => head.skinMesh.geometry.morphAttributes.position[names.indexOf(AU[au])].getY(best);
    expect(dy('smileL')).toBeGreaterThan(0.003);
    expect(dy('frownL')).toBeLessThan(-0.002);
    expect(dy('jawOpen')).toBeLessThanOrEqual(0.0001);
  });
  it('lower tiers have fewer triangles and fewer morph targets', () => {
    const hi = buildHead({ kind: 'office', seed: 1, quality: 'high' });
    const lo = buildHead({ kind: 'office', seed: 1, quality: 'low' });
    expect(countTriangles(lo.group)).toBeLessThan(countTriangles(hi.group));
    expect(lo.skinMesh.morphTargetInfluences.length).toBeLessThan(hi.skinMesh.morphTargetInfluences.length);
    expect(TIERS.low.normalMaps).toBe(false);
  });
  it('is deterministic per seed and differs between seeds', () => {
    const sig = (s) => {
      const h = buildHead({ kind: 'techie', seed: s });
      const a = h.skinMesh.geometry.attributes.position.array;
      let x = 0;
      for (let i = 0; i < a.length; i += 7) x += a[i] * (i % 13);
      return x.toFixed(5);
    };
    expect(sig(3)).toBe(sig(3));
    expect(new Set([1, 2, 3, 4, 5].map(sig)).size).toBeGreaterThan(3);
  });
});

describe('hair and headwear', () => {
  it('every style and headwear builds on a head and disposes', () => {
    const head = buildHead({ kind: 'office', seed: 1 });
    for (const style of HAIR_STYLES) {
      for (const wear of HEADWEAR) {
        const h = buildHair({ shape: head.shape, style, headwear: wear });
        head.group.add(h.group);
        const tris = countTriangles(h.group);
        expect(tris).toBeLessThan(3200);
        h.group.traverse((o) => {
          const p = o.geometry?.attributes?.position;
          if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) throw new Error(`NaN in ${style}/${wear}`);
        });
        h.dispose();
      }
    }
  });
});
