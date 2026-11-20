import { describe, expect, it } from 'vitest';
import { gateOptions } from './gateOptions.js';

// `session.options.power` (docs/POWER_CARDS.md section 2) comes from getOptions through gateOptions unchanged when the table is idle.
const power = { canPlay: true, cards: [{ uid: 'u1', id: 'swap', exp: 5, ok: true, targets: ['b'] }, { uid: 'u2', id: 'shield', exp: 5, ok: true }] };
const real = { roll: true, endTurn: false, upgrade: [], sets: [], power };

describe('options.power through gateOptions', () => {
  it('passes the very same object through when idle and connected', () => {
    const out = gateOptions(real, { phase: 'roll' });
    expect(out).toBe(real);
    expect(out.power).toBe(power);
  });

  it('is blanked (null: nothing can be played) while the presenter animates, a request is in flight, or offline', () => {
    for (const flags of [{ busy: true }, { awaiting: true }, { connection: 'closed' }]) {
      expect(gateOptions(real, { phase: 'roll' }, flags).power ?? null, JSON.stringify(flags)).toBeNull();
    }
  });

  it('is absent when the rule is off (options carry no power key)', () => {
    const { power: _p, ...off } = real;
    expect(gateOptions(off, { phase: 'roll' }).power).toBeUndefined();
    expect(gateOptions(off, { phase: 'roll' }, { busy: true }).power ?? null).toBeNull();
  });
});
