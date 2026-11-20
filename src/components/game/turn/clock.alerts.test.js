import { describe, expect, it } from 'vitest';
import { alertStep, clockInfo } from './clock.js';

const mineInfo = (leftMs, deadline = 1_000_000) => ({ deadline, leftMs, secs: Math.ceil(leftMs / 1000), mine: true, warn: leftMs <= 15000 });

describe('alertStep (the alert loop that no longer re-renders the table)', () => {
  it('does nothing without a clock', () => {
    const r = alertStep(null, false, { warned: 0, tickKey: '' });
    expect(r.warn).toBe(false);
    expect(r.tick).toBe(null);
  });

  it('warns once per deadline, only for me', () => {
    let mem = { warned: 0, tickKey: '' };
    let r = alertStep(mineInfo(20000), false, mem);
    expect(r.warn).toBe(false);
    r = alertStep(mineInfo(14000), false, r.mem);
    expect(r.warn).toBe(true);
    r = alertStep(mineInfo(13000), false, r.mem);
    expect(r.warn).toBe(false); // same deadline: already warned
    r = alertStep(mineInfo(14000, 2_000_000), false, r.mem);
    expect(r.warn).toBe(true); // a new deadline warns again
    mem = { warned: 0, tickKey: '' };
    r = alertStep({ ...mineInfo(5000), mine: false, warn: false }, false, mem);
    expect(r.warn).toBe(false);
    expect(r.tick).toBe(null);
  });

  it('ticks once per displayed second in the last 10 s', () => {
    let r = alertStep(mineInfo(10500), false, { warned: 0, tickKey: '' });
    expect(r.tick).toBe(null); // 11 s left: no tick yet
    r = alertStep(mineInfo(9800), false, r.mem);
    expect(r.tick).toEqual({ secs: 10 });
    r = alertStep(mineInfo(9500), false, r.mem);
    expect(r.tick).toBe(null); // same second, polled again
    r = alertStep(mineInfo(8900), false, r.mem);
    expect(r.tick).toEqual({ secs: 9 });
  });

  it('is silent during a Snatch window and after the time is up', () => {
    let r = alertStep(mineInfo(5000), true, { warned: 0, tickKey: '' });
    expect(r.warn).toBe(false);
    expect(r.tick).toBe(null);
    r = alertStep(mineInfo(0), false, { warned: 0, tickKey: '' });
    expect(r.warn).toBe(false);
    expect(r.tick).toBe(null);
  });

  it('works on a real clockInfo', () => {
    const now = 1_000_000;
    const info = clockInfo({ deadline: now + 8000, waitingFor: ['me'] }, 'me', now);
    const r = alertStep(info, false, { warned: 0, tickKey: '' });
    expect(r.warn).toBe(true);
    expect(r.tick).toEqual({ secs: 8 });
  });
});
