import { describe, expect, it } from 'vitest';
import { clockInfo, nextSecondDelay } from './clock.js';

describe('nextSecondDelay: the countdown redraws once per displayed second, not 4x a second', () => {
  it('waits for just after the next whole second of what is left', () => {
    expect(nextSecondDelay(59_400)).toBe(400 + 8);
    expect(nextSecondDelay(12_001)).toBe(1 + 8);
    expect(nextSecondDelay(5_000)).toBe(0 + 8); // exactly on a boundary: a short wait, never a zero-length spin
  });

  it('lands after the boundary, so the shown seconds are right when it fires', () => {
    const deadline = 1_000_000;
    for (const left of [59_990, 30_500, 10_001, 3_250, 1_001]) {
      const now = deadline - left;
      const at = now + nextSecondDelay(left); // the tick fires here
      const info = clockInfo({ deadline, waitingFor: ['me'] }, 'me', at);
      expect(info.secs).toBe(Math.floor(left / 1000)); // one second boundary has passed since `now`
    }
  });

  it('stops (0) when there is nothing left to count', () => {
    expect(nextSecondDelay(0)).toBe(0);
    expect(nextSecondDelay(-5)).toBe(0);
    expect(nextSecondDelay(NaN)).toBe(0);
  });
});
