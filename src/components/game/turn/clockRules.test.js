// The decision clock follows the host rules `turnSeconds` / `tradeSeconds` of the room (state.cfg): the bar's full length
// and the warning point come from them, never from the fixed 60 s / 15 s.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { clockInfo, timerMs, warnTextFor, WARN_TEXT, WARN_MS, DECISION_MS } from './clock.js';
import { TimerBar } from './TurnTimer.jsx';
import { turnMsOf, tradeMsOf, warnMsFor, TRADE_MS } from '@shared/timing.js';

// the bar remembers the first reading of every deadline, so each test gets its own stretch of time
let NOW = 5_000_000_000;
beforeEach(() => { NOW += 10_000_000; });
const clockFor = (ms, who = 'me') => ({ deadline: NOW + ms, waitingFor: [who] });
const html = (node) => renderToString(node).replaceAll('<!-- -->', '');

describe('timerMs / turnMsOf / tradeMsOf', () => {
  it('turnSeconds sets the decision timer, tradeSeconds the offer timer, the defaults stay for an older game', () => {
    expect(turnMsOf({ turnSeconds: 15 })).toBe(15_000);
    expect(turnMsOf({ turnSeconds: 180 })).toBe(180_000);
    expect(turnMsOf({})).toBe(DECISION_MS);
    expect(turnMsOf(null)).toBe(DECISION_MS);
    expect(turnMsOf({ turnSeconds: 'x' })).toBe(DECISION_MS);
    expect(tradeMsOf({ tradeSeconds: 20 })).toBe(20_000);
    expect(tradeMsOf(undefined)).toBe(TRADE_MS);
    expect(timerMs({ turnSeconds: 25, tradeSeconds: 90 })).toBe(25_000);
    expect(timerMs({ turnSeconds: 25, tradeSeconds: 90 }, { trade: { id: 1 }, phase: 'roll' })).toBe(90_000);
    expect(timerMs({ turnSeconds: 25, tradeSeconds: 90 }, { trade: null })).toBe(25_000);
    expect(timerMs({ turnSeconds: 25, tradeSeconds: 90 }, { trade: { id: 1 }, phase: 'over' })).toBe(25_000);
  });

  it('the warning is WARN_MS, but never more than half of a short timer', () => {
    expect(warnMsFor(60_000)).toBe(WARN_MS);
    expect(warnMsFor(180_000)).toBe(WARN_MS);
    expect(warnMsFor(30_000)).toBe(15_000);
    expect(warnMsFor(20_000)).toBe(10_000);
    expect(warnMsFor(15_000)).toBe(7_500);
    expect(warnMsFor(1_000)).toBe(1_000);
  });
});

describe('clockInfo with the room rules', () => {
  it('without a config it is the old 60 s bar with the 15 s warning', () => {
    const info = clockInfo(clockFor(60_000), 'me', NOW);
    expect(info.frac).toBe(1);
    expect(clockInfo(clockFor(30_000), 'me', NOW).frac).toBeCloseTo(0.5, 5);
    expect(clockInfo(clockFor(15_000), 'me', NOW).warn).toBe(true);
    expect(clockInfo(clockFor(15_001), 'me', NOW).warn).toBe(false);
  });

  it('a 15 s turn: the bar is full at 15 s and drains over 15 s; the warning starts at 7.5 s', () => {
    const cfg = { turnSeconds: 15 };
    expect(clockInfo(clockFor(15_000), 'me', NOW, cfg).frac).toBe(1);
    const half = clockInfo(clockFor(7_500, 'me'), 'me', NOW + 1, cfg);
    const c = clockFor(15_000);
    expect(clockInfo(c, 'me', NOW + 7_500, cfg).frac).toBeCloseTo(0.5, 5);
    expect(clockInfo(c, 'me', NOW + 7_000, cfg).warn).toBe(false);
    expect(clockInfo(c, 'me', NOW + 7_500, cfg).warn).toBe(true);
    expect(half.secs).toBe(8);
    // never a warning for somebody else's clock
    expect(clockInfo(c, 'rav', NOW + 14_000, cfg).warn).toBe(false);
  });

  it('a 120 s turn: half-way is 0.5, the warning is still the last 15 s', () => {
    const cfg = { turnSeconds: 120 };
    const c = clockFor(120_000);
    expect(clockInfo(c, 'me', NOW, cfg).frac).toBe(1);
    expect(clockInfo(c, 'me', NOW + 60_000, cfg).frac).toBeCloseTo(0.5, 5);
    expect(clockInfo(c, 'me', NOW + 104_000, cfg).warn).toBe(false);
    expect(clockInfo(c, 'me', NOW + 105_000, cfg).warn).toBe(true);
  });

  it('the animation time is added on top: the bar still starts full and drains over the longer span', () => {
    const cfg = { turnSeconds: 30 };
    const c = clockFor(30_000 + 4_000);
    expect(clockInfo(c, 'me', NOW, cfg).frac).toBe(1);
    expect(clockInfo(c, 'me', NOW + 17_000, cfg).frac).toBeCloseTo(0.5, 5);
  });

  it('a pending trade offer counts the tradeSeconds of the room', () => {
    const cfg = { turnSeconds: 60, tradeSeconds: 20 };
    const state = { trade: { id: 'x', from: 'a', to: 'me' }, phase: 'roll', cfg };
    const c = clockFor(20_000);
    expect(clockInfo(c, 'me', NOW, cfg, state).frac).toBe(1); // full bar for a 20 s offer (a 60 s bar would start at a third)
    expect(clockInfo(c, 'me', NOW + 10_000, cfg, state).frac).toBeCloseTo(0.5, 5);
    expect(clockInfo(c, 'me', NOW + 10_001, cfg, state).warn).toBe(true); // half of 20 s is 10 s
    expect(clockInfo(clockFor(20_001), 'me', NOW, cfg).frac).toBeCloseTo(20_001 / 60_000, 5); // not a trade: the 60 s bar
  });

  it('WARN_TEXT follows the room timer', () => {
    expect(WARN_TEXT).toBe('15 seconds left');
    expect(warnTextFor(null)).toBe('15 seconds left');
    expect(warnTextFor({ turnSeconds: 180 })).toBe('15 seconds left');
    expect(warnTextFor({ turnSeconds: 20 })).toBe('10 seconds left');
    expect(warnTextFor({ turnSeconds: 15 })).toBe('8 seconds left');
    expect(warnTextFor({ turnSeconds: 60, tradeSeconds: 30 }, { trade: { id: 1 }, phase: 'manage' })).toBe('15 seconds left');
  });
});

describe('<TimerBar> reads the room rules from the session', () => {
  afterEach(() => vi.useRealTimers());

  const session = (cfg, msLeft, extra = {}) => ({
    me: 'me',
    view: { phase: 'roll', turn: 0, round: 2, players: [{ id: 'me', name: 'Asha' }, { id: 'rav', name: 'Ravi' }], cfg, ...extra },
    display: { phase: 'roll' },
    clock: { deadline: Date.now() + msLeft, waitingFor: ['me'] },
  });
  const fill = (out) => Number(/scaleX\(([\d.]+)\)/.exec(out)[1]);

  it('a fresh 15 s timer shows a full bar (not 25 %) and is already in its warning half', () => {
    const out = html(createElement(TimerBar, { session: session({ turnSeconds: 15 }, 15_000) }));
    expect(fill(out)).toBeCloseTo(1, 1);
    expect(out).toContain('Your move');
    expect(out).not.toContain('is-warn');
    const late = html(createElement(TimerBar, { session: session({ turnSeconds: 15 }, 6_000) }));
    expect(late).toContain('is-warn'); // 6 s <= 7.5 s
    const stock = html(createElement(TimerBar, { session: session({}, 20_000) }));
    expect(stock).not.toContain('is-warn'); // 20 s left of the default 60 s: no warning yet
    expect(html(createElement(TimerBar, { session: session({}, 14_000) }))).toContain('is-warn');
  });

  it('a 3 minute timer drains over 3 minutes', () => {
    const out = html(createElement(TimerBar, { session: session({ turnSeconds: 180 }, 90_000) }));
    expect(fill(out)).toBeCloseTo(0.5, 1); // 90 s left of a 180 s bar
    const full = html(createElement(TimerBar, { session: session({ turnSeconds: 180 }, 180_000) }));
    expect(fill(full)).toBeCloseTo(1, 1);
    expect(DECISION_MS).toBe(60_000);
  });
});
