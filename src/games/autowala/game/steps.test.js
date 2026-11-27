import { describe, expect, it } from 'vitest';
import { SLICE, drain, drainAsync, timedSteps } from './steps.js';

function* build(log) {
  log.push('a');
  yield 'layout';
  log.push('b');
  yield SLICE;
  log.push('c');
  yield SLICE;
  yield Promise.resolve().then(() => log.push('async'));
  log.push('d');
  yield 'roads';
  return 42;
}

describe('drain', () => {
  it('runs a staged generator to the end without waiting and returns its value', () => {
    const log = [];
    expect(drain(build(log))).toBe(42);
    expect(log.slice(0, 4)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('drainAsync', () => {
  it('pauses a frame at each named stage, takes a short break at each SLICE and awaits promises', async () => {
    const log = [];
    const steps = [];
    let frames = 0;
    let breaks = 0;
    const v = await drainAsync(build(log), (name, n) => steps.push([name, n]), async () => { frames++; }, async () => { breaks++; });
    expect(v).toBe(42);
    expect(steps).toEqual([['layout', 0], ['roads', 1]]); // slices and promises are not loading-bar steps
    expect(frames).toBe(2);
    expect(breaks).toBe(2);
    expect(log).toEqual(['a', 'b', 'c', 'async', 'd']);
  });
});

describe('timedSteps', () => {
  it('forwards every step and records the total and the longest piece of work', () => {
    // the clock is read before and after each piece of work: pieces of 5, 40, 10 and 7 ms
    const reads = [0, 5, 5, 45, 45, 55, 55, 62];
    let i = 0;
    function* inner() {
      yield SLICE;
      yield SLICE;
      yield SLICE;
      return 'done';
    }
    const rec = {};
    const out = [];
    const gen = timedSteps(inner(), rec, () => reads[i++]);
    let r = gen.next();
    while (!r.done) {
      out.push(r.value);
      r = gen.next();
    }
    expect(r.value).toBe('done');
    expect(out).toEqual([SLICE, SLICE, SLICE]);
    expect(rec.total).toBe(62);
    expect(rec.longest).toBe(40);
  });
});
