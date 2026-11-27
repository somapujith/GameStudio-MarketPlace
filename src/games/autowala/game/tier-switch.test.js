import { describe, expect, it, vi } from 'vitest';
import { createTierSwitch } from './tier-switch.js';

/** A switch with a controllable clock and a warm-up the test resolves by hand. */
function setup({ tier = 'medium', maxWaitMs, warmImpl } = {}) {
  const calls = [];
  const holds = [];
  const resolvers = [];
  let now = 0;
  let current = tier;
  const sw = createTierSwitch({
    warm: (t) => {
      calls.push(['warm', t]);
      if (warmImpl) return warmImpl(t);
      return new Promise((res) => resolvers.push(res));
    },
    apply: (t, s) => {
      calls.push(['apply', t, s]);
      current = t;
    },
    hold: (ms) => holds.push(ms),
    getTier: () => current,
    maxWaitMs,
    now: () => now,
  });
  return { sw, calls, holds, resolvers, tick: (ms) => (now += ms), get tier() { return current; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createTierSwitch', () => {
  it('warms first and applies on the next frame boundary, never before', async () => {
    const t = setup();
    t.sw.request('low', 0.9);
    expect(t.calls).toEqual([['warm', 'low']]);
    expect(t.sw.pending).toMatchObject({ tier: 'low', ready: false });
    // frames while the warm-up runs: nothing is applied and the governor is told to keep quiet
    t.tick(100);
    expect(t.sw.frame()).toBe(false);
    t.tick(100);
    expect(t.sw.frame()).toBe(false);
    expect(t.holds).toEqual([400, 400]);
    expect(t.tier).toBe('medium');
    t.resolvers[0]('done');
    await flush();
    expect(t.sw.pending.ready).toBe(true);
    expect(t.sw.frame()).toBe(true);
    expect(t.calls.at(-1)).toEqual(['apply', 'low', 0.9]);
    expect(t.tier).toBe('low');
    expect(t.sw.pending).toBe(null);
    expect(t.holds.at(-1)).toBeGreaterThanOrEqual(1000); // the frames after the swap are not evidence
    expect(t.sw.stats.applied).toBe(1);
  });

  it('applies at once when the programs were already built (cached)', async () => {
    const t = setup({ warmImpl: () => Promise.resolve('cached') });
    t.sw.request('low', 1);
    await flush();
    expect(t.sw.frame()).toBe(true);
    expect(t.tier).toBe('low');
  });

  it('a cancelled warm-up does not make the swap ready', async () => {
    const t = setup();
    t.sw.request('low', 1);
    t.resolvers[0]('cancelled');
    await flush();
    expect(t.sw.pending.ready).toBe(false);
    expect(t.sw.frame()).toBe(false);
  });

  it('a warm-up that fails still swaps (the programs build on first use: a hitch, not a stuck tier)', async () => {
    const t = setup({ warmImpl: () => Promise.reject(new Error('compile failed')) });
    t.sw.request('low', 1);
    await flush();
    expect(t.sw.frame()).toBe(true);
    expect(t.tier).toBe('low');
  });

  it('a warm-up that never finishes is overruled after maxWaitMs', () => {
    const t = setup({ maxWaitMs: 5000 });
    t.sw.request('low', 1);
    t.tick(4900);
    expect(t.sw.frame()).toBe(false);
    t.tick(200);
    expect(t.sw.frame()).toBe(true);
    expect(t.sw.stats.forced).toBe(1);
    expect(t.tier).toBe('low');
  });

  it('a newer request replaces the older one, and the older warm-up result is ignored', async () => {
    const t = setup({ tier: 'high' });
    t.sw.request('medium', 1);
    t.sw.request('low', 0.8);
    expect(t.calls.filter((c) => c[0] === 'warm').map((c) => c[1])).toEqual(['medium', 'low']);
    t.resolvers[0]('done'); // the superseded one finishes first
    await flush();
    expect(t.sw.pending).toMatchObject({ tier: 'low', ready: false });
    t.resolvers[1]('done');
    await flush();
    expect(t.sw.frame()).toBe(true);
    expect(t.tier).toBe('low');
    expect(t.sw.stats.cancelled).toBe(1);
  });

  it('the same destination again only updates the scale', () => {
    const t = setup();
    t.sw.request('low', 1);
    t.sw.request('low', 0.7);
    expect(t.calls.filter((c) => c[0] === 'warm')).toHaveLength(1);
    expect(t.sw.pending.scale).toBe(0.7);
  });

  it('a request for the tier already applied drops a pending trip and applies the scale', async () => {
    const t = setup();
    t.sw.request('low', 1);
    t.sw.request('medium', 0.9);
    expect(t.sw.pending).toBe(null);
    expect(t.calls.at(-1)).toEqual(['apply', 'medium', 0.9]);
    t.resolvers[0]('done');
    await flush();
    expect(t.sw.frame()).toBe(false);
  });

  it('cancel() forgets the trip and ignores a late warm-up', async () => {
    const t = setup();
    t.sw.request('low', 1);
    t.sw.cancel();
    t.resolvers[0]('done');
    await flush();
    expect(t.sw.frame()).toBe(false);
    expect(t.tier).toBe('medium');
  });

  it('survives a warm() that throws synchronously', async () => {
    const hold = vi.fn();
    const applied = [];
    const sw = createTierSwitch({ warm: () => { throw new Error('boom'); }, apply: (t) => applied.push(t), hold, getTier: () => 'medium' });
    sw.request('low', 1);
    await flush();
    expect(sw.frame()).toBe(true);
    expect(applied).toEqual(['low']);
  });
});
