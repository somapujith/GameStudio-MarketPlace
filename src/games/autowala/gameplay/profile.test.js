import { afterEach, describe, expect, it, vi } from 'vitest';
import { START_WALLET, createProfile, defaultProfile, mergeProfiles, normalizeProfile } from './profile.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const KEY = 'jalebi.autowala.v1:u1';

describe('normalizeProfile', () => {
  it('turns anything that is not an object into a fresh profile', () => {
    for (const bad of [null, undefined, 7, 'x', [], true]) expect(normalizeProfile(bad)).toEqual(defaultProfile());
  });

  it('keeps good values and clamps the rest', () => {
    const p = normalizeProfile({ wallet: 1234.9, rides: 3, totalEarned: -5, bestFare: '77', distance: 1e15 });
    expect(p).toMatchObject({ wallet: 1234, rides: 3, totalEarned: 0, bestFare: 77, distance: 1e9 });
  });

  it('a null, empty, boolean or object wallet falls back to the start money (it used to become Rs 0)', () => {
    for (const bad of [null, '', ' ', true, {}, [], NaN, 'abc']) expect(normalizeProfile({ wallet: bad }).wallet, String(bad)).toBe(START_WALLET);
    expect(normalizeProfile({ wallet: 0 }).wallet).toBe(0); // a real zero stays zero
  });

  it('never lets an infinite rating sum through', () => {
    expect(normalizeProfile(JSON.parse('{"ratingSum":1e999,"ratingCount":2}')).ratingSum).toBe(0);
    expect(normalizeProfile({ ratingSum: 17.5, ratingCount: 4 }).ratingSum).toBe(17.5);
  });

  it('keeps the career block for career.js to sanitise, and nothing else unknown', () => {
    const p = normalizeProfile({ career: { damage: 0.4, ladder: {} }, evil: { a: 1 }, wallet: 5 });
    expect(p.career).toEqual({ damage: 0.4, ladder: {} });
    expect(p.evil).toBeUndefined();
    expect(normalizeProfile({ career: [1, 2] }).career).toBeUndefined();
    expect(normalizeProfile({ career: 'x' }).career).toBeUndefined();
  });

  it('only low / medium / high count as a chosen quality', () => {
    for (const bad of [{}, [], true, 'ultra', 3, 'LOW']) expect(normalizeProfile({ settings: { quality: bad } }).settings.quality, JSON.stringify(bad)).toBeNull();
    expect(normalizeProfile({ settings: { quality: 'high', sound: false } }).settings).toMatchObject({ quality: 'high', sound: false });
  });

  it('does not let a hostile owned map or settings array through', () => {
    const p = normalizeProfile({ owned: { 'paint.body:ok': true, '<script>': true, 'x': 'yes' }, settings: [1] });
    expect(p.owned).toEqual({ 'paint.body:ok': true });
    expect(p.settings.sound).toBe(true);
  });
});

describe('createProfile', () => {
  const real = globalThis.localStorage;
  afterEach(() => {
    vi.useRealTimers();
    if (real === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = real;
  });

  it('reads corrupt JSON as a fresh profile and saves over it', () => {
    const st = memory({ [KEY]: '{not json' });
    const p = createProfile('u1', st);
    expect(p.data).toEqual(defaultProfile());
    p.flush();
    expect(JSON.parse(st.m.get(KEY)).wallet).toBe(START_WALLET);
  });

  it('survives storage that throws on read and on write', () => {
    const st = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    const p = createProfile('u1', st);
    p.data.wallet = 5;
    expect(() => p.flush()).not.toThrow();
  });

  it('boots when merely touching window.localStorage throws (cookies blocked)', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    const p = createProfile('u1');
    expect(p.data.wallet).toBe(START_WALLET);
    expect(() => p.flush()).not.toThrow();
  });

  it('saves debounced and flushes on demand', () => {
    vi.useFakeTimers();
    const st = memory();
    const p = createProfile('u1', st);
    p.data.wallet = 999;
    p.save();
    expect(st.m.has(KEY)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(JSON.parse(st.m.get(KEY)).wallet).toBe(999);
  });

  it('reset keeps the same data object (state.upgrades aliases it)', () => {
    const st = memory();
    const p = createProfile('u1', st);
    const d = p.data;
    const up = d.upgrades;
    d.wallet = 5;
    d.rides = 9;
    st.setItem(KEY, JSON.stringify({ ...d, rides: 50 }));
    p.reset();
    expect(p.data).toBe(d);
    expect(d.wallet).toBe(START_WALLET);
    expect(d.rides).toBe(0);
    expect(JSON.parse(st.m.get(KEY)).rides).toBe(0);
    expect(Object.keys(d)).toEqual(Object.keys(defaultProfile()));
    expect(up).toBeDefined();
  });
});

describe('two tabs of one account', () => {
  it('a stale tab that saves later does not wipe the other tab\'s progress', () => {
    const st = memory();
    const a = createProfile('u1', st); // opened first
    const b = createProfile('u1', st);
    b.data.wallet = 1600;
    b.data.rides = 3;
    b.data.totalEarned = 1000;
    b.data.owned['paint.body:x'] = true;
    b.data.upgrades.engine = 2;
    b.flush();
    a.flush(); // a is stale: it still thinks rides = 0
    const stored = JSON.parse(st.m.get(KEY));
    expect(stored.rides).toBe(3);
    expect(stored.totalEarned).toBe(1000);
    expect(stored.owned['paint.body:x']).toBe(true);
    expect(stored.upgrades.engine).toBe(2);
  });

  it('adopts the other tab\'s wallet and upgrades live, in place', () => {
    const st = memory();
    const a = createProfile('u1', st);
    const up = a.data.upgrades;
    const theirs = { ...defaultProfile(), wallet: 80, rides: 4, upgrades: { ...defaultProfile().upgrades, tank: 3 } };
    expect(a.adopt(JSON.stringify(theirs))).toBe(true);
    expect(a.data.wallet).toBe(80);
    expect(a.data.rides).toBe(4);
    expect(up.tank).toBe(3); // the same object state.upgrades points at
    expect(a.adopt('garbage')).toBe(false);
  });

  it('mergeProfiles never lowers a counter and adds only what is new', () => {
    const mine = { ...defaultProfile(), rides: 10, bestFare: 200, owned: { a: true } };
    expect(mergeProfiles(mine, { ...defaultProfile(), rides: 2, bestFare: 50, owned: { a: true } })).toBe(false);
    expect(mine.rides).toBe(10);
    expect(mergeProfiles(mine, { ...defaultProfile(), rides: 12, owned: { a: true, b: true } })).toBe(true);
    expect(mine).toMatchObject({ rides: 12, bestFare: 200, owned: { a: true, b: true } });
  });
});
