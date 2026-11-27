import { describe, expect, it } from 'vitest';
import { MEMORY_PREFIX, MEMORY_VERSION, createTierMemory, viewportClass } from './tierMemory.js';

const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
};
const KEY = `${MEMORY_PREFIX}tiffin`;
const clock = (t0 = 1_700_000_000_000) => {
  let t = t0;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; };
  return fn;
};

describe('viewportClass', () => {
  it('buckets by device pixel load, not by css size', () => {
    expect(viewportClass(1536, 864, 1.25)).toBe(viewportClass(1920, 1080, 1));
    expect(viewportClass(640, 360, 1)).toBe('xs');
    expect(viewportClass(844, 390, 3)).toBe('l'); // a phone in landscape: 2.96 MP of device pixels
    expect(viewportClass(1024, 768, 1)).toBe('s');
  });
  it('is monotonic in pixels', () => {
    const order = ['xs', 's', 'm', 'l', 'xl'];
    let last = -1;
    for (const w of [320, 640, 1024, 1366, 1920, 2560, 3840]) {
      const i = order.indexOf(viewportClass(w, Math.round((w * 9) / 16), 1));
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
  });
  it('survives nonsense', () => {
    expect(viewportClass(NaN, undefined, 'x')).toBe('xs');
    expect(viewportClass(1000, 1000, 99)).toBe('xl');
  });
});

describe('createTierMemory: round trip', () => {
  it('returns null before anything is stored, then what was stored', () => {
    const st = fakeStorage();
    const mem = createTierMemory({ game: 'tiffin', storage: st });
    expect(mem.get('amd|radeon graphics', 'l')).toBeNull();
    expect(mem.set('amd|radeon graphics', 'l', { tier: 'medium', scale: 0.8 })).toBe(true);
    expect(mem.get('amd|radeon graphics', 'l')).toMatchObject({ tier: 'medium', scale: 0.8 });
    // a new instance (the next session) sees it
    expect(createTierMemory({ game: 'tiffin', storage: st }).get('amd|radeon graphics', 'l')).toMatchObject({ tier: 'medium', scale: 0.8 });
    expect(JSON.parse(st.getItem(KEY))).toMatchObject({ v: MEMORY_VERSION });
  });
  it('keeps separate entries per GPU and per viewport class, and per game', () => {
    const st = fakeStorage();
    const a = createTierMemory({ game: 'a', storage: st });
    const b = createTierMemory({ game: 'b', storage: st });
    a.set('gpu1', 'l', { tier: 'high' });
    a.set('gpu1', 's', { tier: 'low' });
    a.set('gpu2', 'l', { tier: 'medium' });
    expect(a.get('gpu1', 'l').tier).toBe('high');
    expect(a.get('gpu1', 's').tier).toBe('low');
    expect(a.get('gpu2', 'l').tier).toBe('medium');
    expect(b.get('gpu1', 'l')).toBeNull();
  });
  it('expires stale entries', () => {
    const now = clock();
    const mem = createTierMemory({ game: 'x', storage: fakeStorage(), now, ttlMs: 1000 });
    mem.set('g', 'm', { tier: 'low', scale: 1 });
    now.advance(999);
    expect(mem.get('g', 'm')).not.toBeNull();
    now.advance(2);
    expect(mem.get('g', 'm')).toBeNull();
  });
  it('does not rewrite storage when nothing changed', () => {
    const st = fakeStorage();
    let writes = 0;
    const orig = st.setItem;
    st.setItem = (k, v) => { writes++; orig(k, v); };
    const now = clock();
    const mem = createTierMemory({ game: 'x', storage: st, now });
    mem.set('g', 'm', { tier: 'low', scale: 0.9 });
    mem.set('g', 'm', { tier: 'low', scale: 0.9 });
    mem.set('g', 'm', { tier: 'low', scale: 0.9 });
    expect(writes).toBe(1);
    mem.set('g', 'm', { tier: 'low', scale: 0.8 });
    expect(writes).toBe(2);
  });
  it('clamps the scale and rejects bad tier names', () => {
    const mem = createTierMemory({ game: 'x', storage: fakeStorage() });
    mem.set('g', 'm', { tier: 'low', scale: 7 });
    expect(mem.get('g', 'm').scale).toBe(1);
    mem.set('g', 'm', { tier: 'low', scale: -3 });
    expect(mem.get('g', 'm').scale).toBe(0.25);
    expect(mem.set('g', 'm', { tier: '<script>' })).toBe(false);
    expect(mem.set('g', 'm', { tier: '' })).toBe(false);
  });
});

describe('failed tiers', () => {
  it('markFailed is remembered, survives set(), and expires', () => {
    const now = clock();
    const st = fakeStorage();
    const mem = createTierMemory({ game: 'x', storage: st, now, failTtlMs: 5000 });
    mem.set('g', 'm', { tier: 'medium', scale: 1 });
    mem.markFailed('g', 'm', 'high');
    expect(mem.isFailed('g', 'm', 'high')).toBe(true);
    expect(mem.isFailed('g', 'm', 'medium')).toBe(false);
    now.advance(70000);
    mem.set('g', 'm', { tier: 'medium', scale: 0.9 });
    expect(mem.get('g', 'm').failed).toHaveProperty('high');
    expect(createTierMemory({ game: 'x', storage: st, now, failTtlMs: 5000 }).isFailed('g', 'm', 'high')).toBe(false); // 70 s later: past the 5 s ttl
  });
  it('a failure recorded before any stable tier does not invent a tier', () => {
    const mem = createTierMemory({ game: 'x', storage: fakeStorage() });
    mem.markFailed('g', 'm', 'high');
    expect(mem.get('g', 'm')).toBeNull();
    expect(mem.isFailed('g', 'm', 'high')).toBe(true);
  });
});

describe('hostile storage', () => {
  it('private mode: localStorage access throws -> in-memory only, no exception', () => {
    const boom = new Proxy({}, { get() { throw new Error('SecurityError'); } });
    const mem = createTierMemory({ game: 'x', storage: boom });
    expect(() => mem.get('g', 'm')).not.toThrow();
    expect(mem.supported).toBe(false);
    mem.set('g', 'm', { tier: 'low', scale: 0.7 });
    expect(mem.get('g', 'm')).toMatchObject({ tier: 'low', scale: 0.7 }); // the same page still remembers
  });
  it('no storage at all (node / sandbox)', () => {
    const mem = createTierMemory({ game: 'x', storage: null });
    expect(() => mem.set('g', 'm', { tier: 'low' })).not.toThrow();
    expect(mem.get('g', 'm')?.tier).toBe('low');
  });
  it('quota exceeded: retries once with fewer entries, then degrades without throwing', () => {
    const st = fakeStorage();
    let calls = 0;
    st.setItem = () => { calls++; throw new DOMException('quota', 'QuotaExceededError'); };
    const mem = createTierMemory({ game: 'x', storage: st });
    expect(() => mem.set('g', 'm', { tier: 'low' })).not.toThrow();
    expect(calls).toBe(2);
    expect(mem.supported).toBe(false);
    expect(mem.get('g', 'm')?.tier).toBe('low');
  });
  it('quota that clears after dropping old entries succeeds', () => {
    const st = fakeStorage();
    const now = clock();
    const mem = createTierMemory({ game: 'x', storage: st, now });
    for (let i = 0; i < 6; i++) mem.set(`g${i}`, 'm', { tier: 'low' });
    let first = true;
    const orig = st.setItem;
    st.setItem = (k, v) => { if (first) { first = false; throw new Error('quota'); } orig(k, v); };
    mem.set('new', 'm', { tier: 'high' });
    expect(mem.supported).toBe(true);
    expect(createTierMemory({ game: 'x', storage: st, now }).get('new', 'm')?.tier).toBe('high');
  });
  it('corrupt JSON is discarded and the key removed', () => {
    const st = fakeStorage({ [KEY]: '{not json' });
    const mem = createTierMemory({ game: 'tiffin', storage: st });
    expect(mem.get('g', 'm')).toBeNull();
    expect(st.m.has(KEY)).toBe(false);
    mem.set('g', 'm', { tier: 'low' });
    expect(mem.get('g', 'm').tier).toBe('low');
  });
  it('a wrong version is ignored', () => {
    const st = fakeStorage({ [KEY]: JSON.stringify({ v: 99, e: { 'g|m': { t: 'high', s: 1, at: Date.now() } } }) });
    expect(createTierMemory({ game: 'tiffin', storage: st }).get('g', 'm')).toBeNull();
  });
  it('malformed entries are dropped one by one, good ones kept', () => {
    const good = { t: 'medium', s: 0.9, at: Date.now() };
    const st = fakeStorage({ [KEY]: JSON.stringify({ v: 1, e: { 'g|m': good, 'bad1|m': { t: 42 }, 'bad2|m': 'str', 'bad3|m': { t: '<img onerror=x>', s: 1, at: 1 }, ['k'.repeat(300)]: good, 'bad4|m': null } }) });
    const mem = createTierMemory({ game: 'tiffin', storage: st });
    expect(mem.get('g', 'm')).toMatchObject({ tier: 'medium', scale: 0.9 });
    expect(mem.get('bad1', 'm')).toBeNull();
    expect(mem.get('bad3', 'm')).toBeNull();
    expect(Object.keys(mem.dump())).toEqual(['g|m']);
  });
  it('arrays / numbers / null as the whole value are tolerated', () => {
    for (const v of ['null', '[]', '5', '"x"', '{"v":1}', '{"v":1,"e":[]}', '{"v":1,"e":5}']) {
      const mem = createTierMemory({ game: 'tiffin', storage: fakeStorage({ [KEY]: v }) });
      expect(mem.get('g', 'm')).toBeNull();
      expect(() => mem.set('g', 'm', { tier: 'low' })).not.toThrow();
    }
  });
  it('getItem throwing mid-session degrades gracefully', () => {
    const st = fakeStorage();
    st.getItem = () => { throw new Error('denied'); };
    const mem = createTierMemory({ game: 'x', storage: st });
    expect(mem.get('g', 'm')).toBeNull();
    expect(mem.supported).toBe(false);
  });
});

describe('size bounds', () => {
  it('keeps at most maxEntries, dropping the least recently written', () => {
    const now = clock();
    const st = fakeStorage();
    const mem = createTierMemory({ game: 'x', storage: st, now, maxEntries: 5 });
    for (let i = 0; i < 12; i++) {
      mem.set(`gpu${i}`, 'm', { tier: 'low' });
      now.advance(1000);
    }
    const keys = Object.keys(JSON.parse(st.getItem(`${MEMORY_PREFIX}x`)).e);
    expect(keys).toHaveLength(5);
    expect(keys).toContain('gpu11|m');
    expect(keys).not.toContain('gpu0|m');
  });
  it('keeps the serialized value under maxBytes even with long keys', () => {
    const now = clock();
    const st = fakeStorage();
    const mem = createTierMemory({ game: 'x', storage: st, now, maxBytes: 600, maxEntries: 100 });
    for (let i = 0; i < 30; i++) {
      mem.set(`vendor|some very long gpu model name number ${i} ${'x'.repeat(40)}`, 'xl', { tier: 'medium', scale: 0.8 });
      now.advance(1000);
    }
    expect(st.getItem(`${MEMORY_PREFIX}x`).length).toBeLessThanOrEqual(600);
  });
  it('forget and clear', () => {
    const st = fakeStorage();
    const mem = createTierMemory({ game: 'x', storage: st });
    mem.set('a', 'm', { tier: 'low' });
    mem.set('b', 'm', { tier: 'low' });
    mem.forget('a', 'm');
    expect(mem.get('a', 'm')).toBeNull();
    expect(mem.get('b', 'm')).not.toBeNull();
    mem.clear();
    expect(st.m.size).toBe(0);
    expect(mem.get('b', 'm')).toBeNull();
  });
});
