import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { buildCustomer, buildCustomerSteps } from './customers.js';
import { buildPerson, buildPersonSteps, runSteps } from './person.js';
import { setCharacterDrawMode, setCharacterQuality } from './charquality.js';
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

/** Runs a generator one step at a time, returning how many times it yielded and what it returned. */
function drive(gen) {
  let yields = 0;
  let r = gen.next();
  while (!r.done) {
    yields++;
    r = gen.next();
  }
  return { yields, value: r.value };
}

describe('sliced builds (a customer is built a stage per frame mid-shift)', () => {
  it('runSteps runs a generator to its value', () => {
    function* g() {
      yield;
      yield;
      return 7;
    }
    expect(runSteps(g())).toBe(7);
  });

  it('buildPersonSteps yields between head, body, hair and clothes and builds the same person as buildPerson', () => {
    const spec = { kind: 'office', seed: 5, quality: 'medium', hair: { style: 'short' } };
    const a = drive(buildPersonSteps(spec));
    expect(a.yields).toBeGreaterThanOrEqual(3);
    const b = buildPerson(spec);
    expect(a.value.triangles ?? 0).toBe(b.triangles ?? 0);
    let na = 0;
    let nb = 0;
    a.value.group.traverse(() => na++);
    b.group.traverse(() => nb++);
    expect(na).toBe(nb);
    a.value.dispose();
    b.dispose();
  });

  for (const kind of Object.keys(CUSTOMER_KINDS)) {
    it(`${kind}: buildCustomerSteps yields several stages and returns a customer equal to buildCustomer's`, () => {
      const s = drive(buildCustomerSteps(kind, 11));
      expect(s.yields).toBeGreaterThanOrEqual(kind === 'family' ? 8 : 5);
      const one = buildCustomer(kind, 11);
      expect(s.value.triangles).toBe(one.triangles);
      expect(s.value.packs?.length).toBe(one.packs?.length);
      // the sliced one is fully alive: moods, patience, a spoken line and updates run
      s.value.setMood('angry');
      s.value.setPatience(0.1);
      s.value.setSpeaking(500, 1);
      for (let i = 0; i < 4; i++) s.value.update(0.04, i * 0.04);
      s.value.dispose();
      one.dispose();
    });
  }
});
