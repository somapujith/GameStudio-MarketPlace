import { describe, expect, it } from 'vitest';
import { LOOP_ORDER, MAX_NOISE_LOOPS, NOISE_COST, adjustAmbience, eventIdsOf, flagsKey, gasUsable, opsTargets, pickLoops, prepJobsOf, prepKindOf } from './opsMix.js';
import { layerLevels } from './mix.js';

const prep = (...items) => ({ stations: { prep1: { slots: items.map((item) => (item ? { st: 'cooking', item } : { st: 'empty' })) } } });

describe('eventIdsOf', () => {
  it('lists the running event ids, tolerating junk', () => {
    expect(eventIdsOf({ events: [{ id: 'rain', until: 9 }, { id: 'power' }, { id: 'rain' }, null, {}, 'cricket'] })).toEqual(['rain', 'power', 'cricket']);
    expect(eventIdsOf(null)).toEqual([]);
    expect(eventIdsOf({})).toEqual([]);
    expect(eventIdsOf({ events: 'rain' })).toEqual([]);
  });
});

describe('prepKindOf', () => {
  it('maps ingredients to the prep sound', () => {
    expect(prepKindOf('batter_dosa')).toBe('batter');
    expect(prepKindOf('vada_batter')).toBe('batter');
    expect(prepKindOf('coconut_chutney')).toBe('stone');
    expect(prepKindOf('poori_dough')).toBe('dough');
    expect(prepKindOf('sambar')).toBe('pot');
    expect(prepKindOf('tea_decoction_milk')).toBe('pot');
    expect(prepKindOf('oil')).toBe('tin');
    expect(prepKindOf('who-knows')).toBe('pot');
    expect(prepKindOf(undefined)).toBe('pot');
  });
});

describe('opsTargets', () => {
  it('is all zero for a level without operations (and for junk)', () => {
    for (const s of [null, undefined, {}, { cfg: {} }, { events: [], stations: {} }, 'x', 3]) {
      const t = opsTargets(s);
      expect(Object.values(t).every((v) => v === 0), JSON.stringify(s)).toBe(true);
    }
  });

  it('reads the six events', () => {
    const t = opsTargets({ events: [{ id: 'rain' }, { id: 'cricket' }, { id: 'festival' }, { id: 'delivery' }, { id: 'inspector' }] });
    expect(t).toMatchObject({ rain: 1, cricket: 1, festival: 1, delivery: 1, power: 0 });
  });

  it('a batter job runs the grinder, a chutney job does not, and a power cut stops it', () => {
    expect(opsTargets(prep('batter_dosa')).grinder).toBe(1);
    expect(opsTargets(prep('coconut_chutney')).grinder).toBe(0);
    expect(opsTargets({ ...prep('batter_dosa'), events: [{ id: 'power' }] }).grinder).toBe(0);
    expect(opsTargets(prep(null, 'vada_batter')).grinder).toBe(1);
    expect(opsTargets({ stations: { prep1: { slots: [{ st: 'ready', item: 'batter_dosa' }] } } }).grinder).toBe(0);
  });

  it('a gas prep job simmers unless the gas is out or being changed', () => {
    const cfg = { gas: 400 };
    expect(opsTargets({ ...prep('sambar'), cfg, gas: { u: 300, sw: 0 } }).simmer).toBe(1);
    expect(opsTargets({ ...prep('sambar'), cfg, gas: { u: 0, sw: 0 } }).simmer).toBe(0);
    expect(opsTargets({ ...prep('sambar'), cfg, gas: { u: 300, sw: 3 } }).simmer).toBe(0);
    expect(opsTargets({ ...prep('sambar') }).simmer).toBe(1); // a level without a cylinder always has gas
    expect(opsTargets({ ...prep('coconut_chutney'), cfg, gas: { u: 300, sw: 0 } }).simmer).toBe(0);
    expect(gasUsable({ cfg: { gas: 1 } })).toBe(false);
  });

  it('the regulator hisses at 20% and below, not at zero or while swapping', () => {
    const cfg = { gas: 400 };
    expect(opsTargets({ cfg, gas: { u: 200, sw: 0 } }).gasHiss).toBe(1);
    expect(opsTargets({ cfg, gas: { u: 50, sw: 0 } }).gasHiss).toBe(1);
    expect(opsTargets({ cfg, gas: { u: 201, sw: 0 } }).gasHiss).toBe(0);
    expect(opsTargets({ cfg, gas: { u: 0, sw: 0 } }).gasHiss).toBe(0);
    expect(opsTargets({ cfg, gas: { u: 100, sw: 2 } }).gasHiss).toBe(0);
    expect(opsTargets({ gas: { u: 100, sw: 0 } }).gasHiss).toBe(0); // no cylinder on this level
  });

  it('the generator needs a power cut, a generator on the level, and the delay to have passed', () => {
    const base = { events: [{ id: 'power' }], cfg: { generator: true } };
    expect(opsTargets(base, { generatorReady: false }).generator).toBe(0);
    expect(opsTargets(base, { generatorReady: true }).generator).toBe(1);
    expect(opsTargets({ events: [{ id: 'power' }] }, { generatorReady: true }).generator).toBe(0);
    expect(opsTargets({ cfg: { inverter: true } }, { generatorReady: true }).generator).toBe(0); // no cut
    expect(opsTargets({ events: [{ id: 'power' }], cfg: { inverter: 1 } }, { generatorReady: true }).generator).toBe(1);
  });

  it('prepJobsOf lists only cooking jobs', () => {
    expect(prepJobsOf(prep('sambar', null)).map((j) => j.kind)).toEqual(['pot']);
    expect(prepJobsOf({}).length).toBe(0);
  });
});

describe('pickLoops', () => {
  it('keeps the most important loops under the noise-source cap', () => {
    const all = Object.fromEntries(LOOP_ORDER.map((id) => [id, 1]));
    const keep = pickLoops(all);
    const noise = [...keep].reduce((n, id) => n + NOISE_COST[id], 0);
    expect(noise).toBeLessThanOrEqual(MAX_NOISE_LOOPS);
    expect(keep.has('rain')).toBe(true);
    expect(keep.has('grinder')).toBe(true);
    expect(keep.has('gasHiss')).toBe(true);
    expect(keep.has('cricket')).toBe(false); // 2 + 1 + 1 = 4 already
    expect(keep.has('delivery')).toBe(true); // tonal loops cost no noise source
    expect(pickLoops({}).size).toBe(0);
    expect(pickLoops(null).size).toBe(0);
  });
});

describe('adjustAmbience', () => {
  const dry = layerLevels(22.5, 0.5);
  it('a power cut silences the radio and the tabla, rain thins the dry-weather beds, neither mutates', () => {
    const copy = JSON.stringify(dry);
    const pw = adjustAmbience(dry, { power: true });
    expect(pw.radio).toBe(0);
    expect(pw.tabla).toBe(0);
    expect(pw.traffic).toBe(dry.traffic);
    const rain = adjustAmbience(dry, { rain: true });
    expect(rain.cicadas).toBe(0);
    expect(rain.birds).toBe(0);
    expect(rain.crickets).toBeLessThan(dry.crickets);
    expect(rain.radio).toBe(dry.radio);
    expect(JSON.stringify(dry)).toBe(copy);
    expect(adjustAmbience(dry, {})).toEqual(dry);
    expect(adjustAmbience(null, null)).toEqual({});
  });
  it('flagsKey tells the combinations apart', () => {
    const keys = new Set([{}, { rain: true }, { power: true }, { rain: true, power: true }].map(flagsKey));
    expect(keys.size).toBe(4);
  });
});
