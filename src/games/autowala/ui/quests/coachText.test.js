import { describe, expect, it } from 'vitest';
import { coachStepText } from './coachText.js';

describe('coachStepText', () => {
  it('keeps the keyboard wording and the key badge on a keyboard device', () => {
    const s = { label: 'Honk the horn. Press H', te: 'x', key: 'H' };
    expect(coachStepText(s, false)).toEqual({ label: 'Honk the horn. Press H', te: 'x', key: 'H' });
  });
  it('re-words drive / horn / pause for the on-screen controls and drops the key badge', () => {
    expect(coachStepText({ label: 'Drive. W or the up arrow to go, A and D to steer', key: 'W' }, true).label).toContain('GAS');
    expect(coachStepText({ label: 'Honk the horn. Press H', key: 'H' }, true).label).toBe('Honk the horn: tap HORN');
    expect(coachStepText({ label: 'Press Esc to pause, then Esc again to resume', key: 'Esc' }, true).label).toContain('pause button');
    for (const k of ['W', 'H', 'Esc']) expect(coachStepText({ label: 'x', key: k }, true).key).toBe('');
  });
  it('turns "press E" inside a longer sentence into "tap E" and leaves other steps alone', () => {
    expect(coachStepText({ label: "Drive to Mama's Garage and press E to open the workshop", key: 'E' }, true).label).toBe("Drive to Mama's Garage and tap E to open the workshop");
    expect(coachStepText({ label: 'Drop them at the next marker to get paid', te: 't' }, true)).toEqual({ label: 'Drop them at the next marker to get paid', te: 't', key: '' });
  });
  it('survives a missing step', () => {
    expect(coachStepText(null, true)).toEqual({ label: '', te: '', key: '' });
    expect(coachStepText(undefined, false)).toEqual({ label: '', te: '', key: '' });
  });
});
