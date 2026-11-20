// A device with a wrong clock must still see the right countdown: the deadline is moved into local time.
import { describe, expect, it } from 'vitest';
import { clockInfo, localClock, DECISION_MS } from './clock.js';

const SERVER_NOW = 1_800_000_000_000;

describe('localClock', () => {
  it('shifts the deadline by the difference between the server clock and this device', () => {
    const clock = { deadline: SERVER_NOW + 60_000, waitingFor: ['a'] };
    // this phone is 111 s behind the server
    const out = localClock(clock, SERVER_NOW, SERVER_NOW - 111_000);
    expect(out.deadline).toBe(SERVER_NOW - 111_000 + 60_000);
    expect(out.waitingFor).toEqual(['a']);
    // ... and a phone that is 2 minutes ahead
    expect(localClock(clock, SERVER_NOW, SERVER_NOW + 120_000).deadline).toBe(SERVER_NOW + 120_000 + 60_000);
  });

  it('shows the real remaining time on a skewed device', () => {
    const clock = { deadline: SERVER_NOW + 60_000, waitingFor: ['a'] };
    const behind = SERVER_NOW - 111_000;
    const info = clockInfo(localClock(clock, SERVER_NOW, behind), 'a', behind);
    expect(info.secs).toBe(60);
    expect(info.frac).toBeCloseTo(60_000 / Math.max(DECISION_MS, 60_000), 5);
    // without the fix the same device would read 171 s
    expect(clockInfo(clock, 'a', behind).secs).toBe(171);
  });

  it('leaves ordinary drift, a missing server time and an idle clock alone', () => {
    const clock = { deadline: SERVER_NOW + 60_000, waitingFor: [] };
    expect(localClock(clock, SERVER_NOW, SERVER_NOW - 800)).toBe(clock);
    expect(localClock(clock, undefined, SERVER_NOW)).toBe(clock);
    expect(localClock(clock, 'nope', SERVER_NOW)).toBe(clock);
    expect(localClock({ deadline: null, waitingFor: [] }, SERVER_NOW, 0)).toEqual({ deadline: null, waitingFor: [] });
    expect(localClock(null, SERVER_NOW, 0)).toBe(null);
  });
});
