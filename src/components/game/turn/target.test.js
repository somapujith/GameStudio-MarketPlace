// The net worth target: progress maths, labels, the 80% / 95% heads-up bookkeeping and the log notes.
import { describe, expect, it } from 'vitest';
import {
  TARGET_STEPS, alertNote, alertText, anyoneHot, compactTarget, isHot, mergeLogNotes, podTarget, targetAlerts, targetBadge, targetFraction,
  targetOf, targetPct, targetRuleText, targetStep, targetSummary,
} from './target.js';

const T = 5000000; // ₹50L

describe('targetOf', () => {
  it('reads cfg.targetWorth and treats everything else as "no target" (old rooms)', () => {
    expect(targetOf({ targetWorth: 5000000 })).toBe(5000000);
    expect(targetOf({ targetWorth: null })).toBeNull();
    expect(targetOf({})).toBeNull();
    expect(targetOf(undefined)).toBeNull();
    expect(targetOf({ targetWorth: 0 })).toBeNull();
    expect(targetOf({ targetWorth: -5 })).toBeNull();
    expect(targetOf({ targetWorth: 'lots' })).toBeNull();
  });
});

describe('progress', () => {
  it('is the share of the target, clamped to 0..1', () => {
    expect(targetFraction(1250000, T)).toBeCloseTo(0.25, 5);
    expect(targetFraction(T, T)).toBe(1);
    expect(targetFraction(T * 2, T)).toBe(1);
    expect(targetFraction(-100, T)).toBe(0);
    expect(targetFraction(100, null)).toBe(0);
    expect(targetFraction(NaN, T)).toBe(0);
  });

  it('rounds the percentage down so a bar never claims a step it has not reached', () => {
    expect(targetPct(2500000, T)).toBe(50);
    expect(targetPct(3999999, T)).toBe(79);
    expect(targetPct(4000000, T)).toBe(80);
    expect(targetPct(4749999, T)).toBe(94);
    expect(targetPct(4750000, T)).toBe(95);
    expect(targetPct(T * 3, T)).toBe(100);
    expect(targetPct(0.8 * 5000000, T)).toBe(80); // floating point: 0.8 * 5e6 stays on 80
  });

  it('knows the heads-up steps and the hot zone', () => {
    expect(TARGET_STEPS).toEqual([80, 95]);
    expect([0, 50, 79, 80, 94, 95, 100].map(targetStep)).toEqual([0, 0, 0, 80, 80, 95, 95]);
    expect(isHot(3999999, T)).toBe(false);
    expect(isHot(4000000, T)).toBe(true);
  });

  it('anyoneHot only counts live players', () => {
    const players = [{ id: 'a' }, { id: 'b', bankrupt: true }];
    expect(anyoneHot(players, { a: 1000000, b: 4900000 }, T)).toBe(false);
    expect(anyoneHot(players, { a: 4100000, b: 0 }, T)).toBe(true);
    expect(anyoneHot(players, { a: 4100000 }, null)).toBe(false);
  });
});

describe('labels', () => {
  it('writes targets the way hosts pick them', () => {
    expect(compactTarget(2500000)).toBe('₹25L');
    expect(compactTarget(5000000)).toBe('₹50L');
    expect(compactTarget(7500000)).toBe('₹75L');
    expect(compactTarget(10000000)).toBe('₹1Cr');
    expect(compactTarget(15000000)).toBe('₹1.5Cr');
    expect(compactTarget('x')).toBe('');
  });

  it('top bar chip, summary line and rule sentence', () => {
    expect(targetBadge({ targetWorth: T })).toMatchObject({ text: 'First to ₹50L', short: '₹50L', target: T });
    expect(targetBadge({ targetWorth: T }).sr).toContain('₹50,00,000');
    expect(targetBadge({})).toBeNull();
    expect(targetBadge(null)).toBeNull();
    expect(targetSummary({ targetWorth: T })).toBe('First to ₹50L');
    expect(targetSummary({ targetWorth: null })).toBe('');
    expect(targetRuleText(T)).toBe('Net worth target: the first player to reach ₹50,00,000 in net worth wins straight away, even before the last round.');
  });
});

describe('podTarget', () => {
  it('is null without a target or for a player who is out', () => {
    expect(podTarget({ worth: 1, target: null })).toBeNull();
    expect(podTarget({ worth: 1, target: T, bankrupt: true })).toBeNull();
  });

  it('gives your pod the sentence and the others the percentage', () => {
    const me = podTarget({ worth: 1260000, target: T, isMe: true });
    expect(me).toMatchObject({ pct: 25, hot: false, lead: false, text: '25%', label: 'Worth ₹12.6L of ₹50L' });
    expect(me.frac).toBeCloseTo(0.252, 3);
    expect(me.sr).toBe('25% of the ₹50L net worth target');
    const other = podTarget({ worth: 4200000, target: T, isLeader: true });
    expect(other).toMatchObject({ pct: 84, hot: true, lead: true, text: '84%' });
    expect(other.label).toBe('₹42L of ₹50L');
  });
});

const players = [{ id: 'me', name: 'Nithin' }, { id: 'sana', name: 'Sana' }, { id: 'rav', name: 'Ravi' }];
const worths = (me, sana, rav) => ({ me: (me * T) / 100, sana: (sana * T) / 100, rav: (rav * T) / 100 });

describe('targetAlerts', () => {
  it('only seeds on the first look: a reload or a finished game announces nothing', () => {
    const first = targetAlerts(null, players, worths(10, 85, 97), T);
    expect(first.alerts).toEqual([]);
    expect(first.seen).toEqual({ sana: 80, rav: 95 });
    // a later look at the same table is still quiet
    expect(targetAlerts(first.seen, players, worths(10, 85, 97), T).alerts).toEqual([]);
  });

  it('announces 80% and then 95% once per player', () => {
    let st = targetAlerts(null, players, worths(10, 50, 50), T).seen;
    let r = targetAlerts(st, players, worths(10, 79, 50), T);
    expect(r.alerts).toEqual([]);
    st = r.seen;
    r = targetAlerts(st, players, worths(10, 82, 50), T);
    expect(r.alerts).toEqual([{ id: 'sana', name: 'Sana', step: 80, pct: 82 }]);
    st = r.seen;
    r = targetAlerts(st, players, worths(10, 90, 50), T);
    expect(r.alerts).toEqual([]); // 90 is still the 80 step
    st = r.seen;
    r = targetAlerts(st, players, worths(10, 96, 50), T);
    expect(r.alerts).toEqual([{ id: 'sana', name: 'Sana', step: 95, pct: 96 }]);
  });

  it('never repeats a step, even if the worth drops and climbs again', () => {
    let st = targetAlerts(null, players, worths(0, 50, 0), T).seen;
    let r = targetAlerts(st, players, worths(0, 85, 0), T);
    expect(r.alerts).toHaveLength(1);
    st = r.seen;
    st = targetAlerts(st, players, worths(0, 60, 0), T).seen;
    r = targetAlerts(st, players, worths(0, 88, 0), T);
    expect(r.alerts).toEqual([]);
  });

  it('a jump over both steps says only the higher one, and several players can speak in one look', () => {
    const st = targetAlerts(null, players, worths(10, 10, 10), T).seen;
    const r = targetAlerts(st, players, worths(81, 97, 10), T);
    expect(r.alerts.map((a) => [a.id, a.step])).toEqual([['me', 80], ['sana', 95]]);
    expect(targetAlerts(r.seen, players, worths(81, 97, 10), T).alerts).toEqual([]);
  });

  it('skips players who are out and does nothing without a target', () => {
    const st = targetAlerts(null, players, worths(10, 10, 10), T).seen;
    const out = [{ id: 'me', name: 'Nithin' }, { id: 'sana', name: 'Sana', bankrupt: true }, { id: 'rav', name: 'Ravi' }];
    expect(targetAlerts(st, out, worths(10, 90, 10), T).alerts).toEqual([]);
    expect(targetAlerts(st, players, worths(90, 90, 90), null).alerts).toEqual([]);
  });
});

describe('alert texts', () => {
  it('says whose it is', () => {
    expect(alertText({ name: 'Sana', isMe: false, pct: 90 }, T)).toBe('Sana is at 90% of the ₹50L target');
    expect(alertText({ name: 'Sana', isMe: true, pct: 81 }, T)).toBe('You are at 81% of the ₹50L target');
    expect(alertText({ pct: 80 }, 7500000)).toBe('Someone is at 80% of the ₹75L target');
  });

  it('makes the log note', () => {
    const n = alertNote({ id: 'sana', name: 'Sana', step: 95, pct: 96 }, T, 'me', 12);
    expect(n).toMatchObject({ id: 'target:sana:95', note: true, text: 'Sana is at 96% of the ₹50L target', tone: 'warn', after: 12 });
    expect(alertNote({ id: 'me', name: 'Nithin', step: 80, pct: 80 }, T, 'me', null)).toMatchObject({ tone: 'good', after: null });
    expect(alertNote({ id: 'sana', name: 'Sana', step: 80, pct: 80 }, T, 'me').tone).toBe('info');
  });
});

describe('mergeLogNotes', () => {
  const log = [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }];
  const note = (id, after) => ({ id, note: true, text: id, after });

  it('returns the log itself when there is nothing to add', () => {
    expect(mergeLogNotes(log, [])).toBe(log);
    expect(mergeLogNotes(undefined, undefined)).toEqual([]);
  });

  it('keeps a note right after the line it followed while newer lines arrive after it', () => {
    const out = mergeLogNotes(log, [note('n1', 2)]);
    expect(out.map((e) => e.id)).toEqual([1, 2, 'n1', 3]);
    expect(log).toHaveLength(3); // the input is not mutated
  });

  it('keeps several notes after one line in the order they were added', () => {
    expect(mergeLogNotes(log, [note('n1', 3), note('n2', 3)]).map((e) => e.id)).toEqual([1, 2, 3, 'n1', 'n2']);
  });

  it('puts an unanchored note first and drops one whose line has scrolled out of the log', () => {
    expect(mergeLogNotes(log, [note('n0', null)]).map((e) => e.id)).toEqual(['n0', 1, 2, 3]);
    expect(mergeLogNotes(log, [note('gone', 99)]).map((e) => e.id)).toEqual([1, 2, 3]);
  });
});
