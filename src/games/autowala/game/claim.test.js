import { describe, expect, it, vi } from 'vitest';
import { STALE, abandonable, claimCanvas } from './claim.js';

const run = (gen) => {
  const seen = [];
  let r = gen.next();
  while (!r.done) {
    seen.push(r.value);
    r = gen.next();
  }
  return { seen, value: r.value };
};

describe('claimCanvas', () => {
  it('cancels the older claim on the same canvas, and only that one', () => {
    const a = {};
    const b = {};
    const c1 = claimCanvas(a);
    const other = claimCanvas(b);
    const c2 = claimCanvas(a);
    expect(c1.cancelled).toBe(true);
    expect(c2.cancelled).toBe(false);
    expect(other.cancelled).toBe(false);
  });

  it('survives a missing canvas', () => {
    expect(() => claimCanvas(null)).not.toThrow();
  });
});

describe('abandonable', () => {
  function* build(log) {
    log.push('a');
    yield 'one';
    log.push('b');
    yield 'two';
    log.push('c');
    return { game: true };
  }

  it('runs a build to its end when nobody claimed the canvas after it', () => {
    const log = [];
    const { seen, value } = run(abandonable(build(log), claimCanvas({})));
    expect(seen).toEqual(['one', 'two']);
    expect(value).toEqual({ game: true });
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('stops at the next stage after being cancelled, runs the cleanup once and resolves to the stale stub', () => {
    const canvas = {};
    const first = claimCanvas(canvas);
    first.cleanup = vi.fn();
    const log = [];
    const gen = abandonable(build(log), first);
    expect(gen.next().value).toBe('one'); // the first stage runs
    claimCanvas(canvas); // StrictMode's second build claims the canvas
    const r = gen.next();
    expect(r.done).toBe(true);
    expect(r.value).toBe(STALE);
    expect(log).toEqual(['a']); // nothing of the second stage ran
    expect(first.cleanup).toHaveBeenCalledTimes(1);
  });

  it('the stale stub can be started, stopped, resized and disposed without effect', () => {
    for (const k of ['start', 'stop', 'resize', 'dispose']) expect(() => STALE[k]()).not.toThrow();
  });

  it('a failing cleanup does not break the abandon', () => {
    const c = claimCanvas({});
    c.cleanup = () => {
      throw new Error('context gone');
    };
    const gen = abandonable(build([]), c);
    gen.next();
    c.cancelled = true;
    expect(gen.next().value).toBe(STALE);
  });
});
