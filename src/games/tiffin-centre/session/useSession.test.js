import { describe, expect, it } from 'vitest';
import { PULSE_HZ, pulseMs, sessionSnapshot } from './useSession.js';

describe('sessionSnapshot', () => {
  it('is a safe loading snapshot without a session', () => {
    const s = sessionSnapshot(null, 5);
    expect(s).toMatchObject({ state: null, status: 'loading', connection: 'open', result: null, lobby: false, players: [], now: 5 });
  });

  it('copies what a screen needs from a session (local or room) and stamps `now`', () => {
    const session = {
      mode: 'practice', meId: 'me', players: [{ id: 'me' }], state: { tick: 3 }, tickAt: 1200, status: 'playing', connection: 'open',
      result: null, lastError: 'busy', tutorial: { step: { id: 'cook' } },
    };
    const s = sessionSnapshot(session, 1700);
    expect(s).toMatchObject({ state: { tick: 3 }, tickAt: 1200, now: 1700, status: 'playing', lastError: 'busy', lobby: false, fatal: null, room: null, mode: 'practice', meId: 'me' });
    expect(s.tutorial.step.id).toBe('cook');
    const room = sessionSnapshot({ ...session, mode: 'online', lobby: true, fatal: { kind: 'kicked' }, room: { code: 'X' } }, 1);
    expect(room.lobby).toBe(true);
    expect(room.fatal.kind).toBe('kicked');
    expect(room.room.code).toBe('X');
  });

  it('the clock pulse is ~10 Hz', () => {
    expect(PULSE_HZ).toBe(10);
  });

  it('hz <= 0 (or garbage) means no pulses at all; otherwise the interval in ms, never faster than 1 Hz steps', () => {
    expect(pulseMs(PULSE_HZ)).toBe(100);
    expect(pulseMs(0)).toBe(0);
    expect(pulseMs(-5)).toBe(0);
    expect(pulseMs(NaN)).toBe(0);
    expect(pulseMs(undefined)).toBe(0);
    expect(pulseMs(0.5)).toBe(1000);
    expect(pulseMs(60)).toBe(17);
  });
});
