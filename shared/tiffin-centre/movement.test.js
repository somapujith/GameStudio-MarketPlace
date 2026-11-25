import { describe, it, expect } from 'vitest';
import { validTarget, standX, walkSeconds, stepWalker, workTarget, WALK_SPEED } from './movement.js';
import { LAYOUT, STATIONS } from './catalog.js';

describe('movement', () => {
  it('validates targets against the level', () => {
    expect(validTarget(null)).toBe(true);
    expect(validTarget('bin')).toBe(true);
    expect(validTarget('tawa1')).toBe(true);
    expect(validTarget('tawa2', ['tawa1'])).toBe(false);
    expect(validTarget('spot:2', ['tawa1'], 3)).toBe(true);
    expect(validTarget('spot:3', ['tawa1'], 3)).toBe(false);
    expect(validTarget('spot:12')).toBe(false);
    for (const bad of [undefined, 5, {}, [], '__proto__', 'constructor', 'spot:-1', 'spot:a']) expect(validTarget(bad)).toBe(false);
  });

  it('the back counter and the LPG cylinder are stand targets (the cylinder only on levels that have one)', () => {
    expect(validTarget('prep1')).toBe(true);
    expect(validTarget('prep1', ['tawa1'], 3)).toBe(false); // a level without stock has no prep counter
    expect(validTarget('prep1', ['tawa1', 'prep1'], 3)).toBe(true);
    expect(validTarget('gas')).toBe(true);
    expect(validTarget('gas', ['tawa1'], 3, true)).toBe(true);
    expect(validTarget('gas', ['tawa1'], 3, false)).toBe(false);
    expect(validTarget('gas', ['tawa1'], 3, 0)).toBe(false);
    expect(validTarget('Gas')).toBe(false);
    expect(standX('prep1')).toBe(STATIONS.prep1.x);
    expect(standX('gas')).toBeCloseTo(LAYOUT.gas.x + 0.4, 6);
    expect(LAYOUT.gas.x).toBeLessThan(STATIONS.tawa1.x); // the cylinder stands at the left end
    expect(STATIONS.prep1.z).toBeGreaterThan(LAYOUT.cookZ); // the prep counter is behind the cook
  });

  it('maps targets to x', () => {
    expect(standX('chai1')).toBe(STATIONS.chai1.x);
    expect(standX('spot:0')).toBe(LAYOUT.spotX(0));
    expect(standX(null)).toBe(0);
    expect(standX('nonsense')).toBe(0);
  });

  it('walks at a constant speed and arrives exactly', () => {
    expect(walkSeconds(0, WALK_SPEED)).toBeCloseTo(1);
    let x = -3, t = 0;
    for (;;) {
      const r = stepWalker(x, 3, 1 / 60);
      x = r.x; t += 1 / 60;
      if (r.arrived) break;
      expect(t).toBeLessThan(5);
    }
    expect(x).toBe(3);
    expect(t).toBeCloseTo(walkSeconds(-3, 3), 1);
  });

  it('finds where an action is worked from', () => {
    const state = { customers: [{ id: 'c1', spot: 4 }] };
    expect(workTarget({ type: 'cook', station: 'tawa1' }, state)).toBe('tawa1');
    expect(workTarget({ type: 'serve', customer: 'c1' }, state)).toBe('spot:4');
    expect(workTarget({ type: 'collect', customer: 'zz' }, state)).toBe(null);
    expect(workTarget({ type: 'discard' }, state)).toBe('bin');
    expect(workTarget({ type: 'prep', station: 'prep1', slot: 0, item: 'oil' }, state)).toBe('prep1');
    expect(workTarget({ type: 'collectPrep', station: 'prep1', slot: 1 }, state)).toBe('prep1');
    expect(workTarget({ type: 'tend', station: 'tawa1' }, state)).toBe('tawa1');
    expect(workTarget({ type: 'swapGas' }, state)).toBe('gas');
    expect(workTarget({ type: 'board', dish: 'dosa', on: false }, state)).toBe(null);
    expect(workTarget({ type: 'buy', item: 'oil', n: 2 }, state)).toBe(null);
    expect(workTarget({ type: 'tend', station: 5 }, state)).toBe(null);
    expect(workTarget(null, state)).toBe(null);
  });
});
