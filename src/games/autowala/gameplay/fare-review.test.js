import { describe, expect, it } from 'vitest';
import { FLAG_REVIEWS, REVIEWS, ROUTE, complaintEffect, detourOf, detourStage, makeReview, pushReview } from './fare-review.js';
import { LINES, fmt, pickLine } from './fare-lines.js';
import { TALKS, TALK, nextTalkIn, pickTalk, talkEffect } from './fare-talk.js';
import { KIND_IDS } from './fare-kinds.js';

const TELUGU = /[ఀ-౿]/;

describe('wrong route', () => {
  it('the detour is what was driven plus what is left, minus the ideal', () => {
    expect(detourOf(500, 0, 400, 800)).toBe(100);
    expect(detourOf(1200, 300, 100, 800)).toBe(200);
  });

  it('stages: quiet, grumble, furious, with a floor for short rides', () => {
    expect(detourStage(50, 800)).toBe(0);
    expect(detourStage(ROUTE.t1Min + 5, 300)).toBe(1); // short ride: the floor applies
    expect(detourStage(0.31 * 1000, 1000)).toBe(1);
    expect(detourStage(0.5 * 1000, 1000)).toBe(1);
    expect(detourStage(0.75 * 1000, 1000)).toBe(2);
    expect(detourStage(90, 100)).toBe(0); // 90 m extra on a 100 m ride is below the floor
  });

  it('a shortcut they asked for gives allowance', () => {
    expect(detourStage(300, 800, 0)).toBe(1);
    expect(detourStage(300, 800, ROUTE.graceM + 60)).toBe(0);
  });

  it('costs mood and fare, more at stage 2, and rushers mind most', () => {
    const a = complaintEffect(1, 'regular');
    const b = complaintEffect(2, 'regular');
    expect(a.mood).toBeLessThan(0);
    expect(b.mood).toBeLessThan(a.mood);
    expect(b.fareMul).toBeLessThan(a.fareMul);
    expect(complaintEffect(1, 'rusher').mood).toBeLessThan(a.mood);
    expect(complaintEffect(0, 'regular')).toEqual({ mood: 0, fareMul: 1 });
  });
});

describe('reviews', () => {
  it('has English and Telugu for every pool', () => {
    for (const list of [...Object.values(REVIEWS), ...Object.values(FLAG_REVIEWS).map((f) => f.lines)]) {
      for (const r of list) {
        expect(r.en.length).toBeGreaterThan(5);
        expect(TELUGU.test(r.te)).toBe(true);
      }
    }
  });

  it('is 1-5 stars with a one-line comment', () => {
    for (let s = 1; s <= 5; s++) {
      const r = makeReview({ stars: s, n: s });
      expect(r.stars).toBe(s);
      expect(r.text.length).toBeGreaterThan(3);
      expect(r.text).not.toContain('\n');
    }
    expect(makeReview({ stars: 9 }).stars).toBe(5);
    expect(makeReview({ stars: 0 }).stars).toBe(1);
  });

  it('a low rating names the worst thing that happened', () => {
    expect(FLAG_REVIEWS.wrongRoute.lines.map((l) => l.en)).toContain(makeReview({ stars: 2, flags: { wrongRoute: true, late: true }, n: 0 }).text);
    expect(FLAG_REVIEWS.crashed.lines.map((l) => l.en)).toContain(makeReview({ stars: 1, flags: { crashed: true, wrongRoute: true }, n: 0 }).text);
    expect(FLAG_REVIEWS.late.lines.map((l) => l.en)).toContain(makeReview({ stars: 3, flags: { late: true }, n: 1 }).text);
  });

  it('a high rating praises what went well', () => {
    expect(FLAG_REVIEWS.urgentOk.lines.map((l) => l.en)).toContain(makeReview({ stars: 5, flags: { urgentOk: true, honest: true }, n: 0 }).text);
    expect(FLAG_REVIEWS.honest.lines.map((l) => l.en)).toContain(makeReview({ stars: 5, flags: { honest: true }, n: 0 }).text);
    // negative flags do not leak into a happy review (even n)
    expect(FLAG_REVIEWS.wrongRoute.lines.map((l) => l.en)).not.toContain(makeReview({ stars: 5, flags: { wrongRoute: true }, n: 0 }).text);
  });

  it('keeps a short history', () => {
    const h = [];
    for (let i = 0; i < 10; i++) pushReview(h, { stars: 5, text: String(i) }, 4);
    expect(h.map((x) => x.text)).toEqual(['6', '7', '8', '9']);
  });
});

describe('lines', () => {
  it('every line has English and Telugu, and every kind has an opening line', () => {
    for (const group of Object.values(LINES)) {
      for (const list of Object.values(group)) {
        for (const l of list) {
          expect(l.en.length).toBeGreaterThan(2);
          expect(TELUGU.test(l.te)).toBe(true);
        }
      }
    }
    for (const k of KIND_IDS) expect(pickLine('open', k, 0)).toBeTruthy();
  });

  it('keeps the same placeholders in both languages', () => {
    for (const group of Object.values(LINES)) {
      for (const list of Object.values(group)) {
        for (const l of list) {
          const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
          expect(ph(l.te)).toBe(ph(l.en));
        }
      }
    }
  });

  it('fills placeholders, using the Telugu name for the Telugu text', () => {
    const f = fmt({ en: 'To {dest}: Rs {price}', te: '{dest} కి ₹{price}' }, { dest: 'Charminar', destTe: 'చార్మినార్', price: 150 });
    expect(f.en).toBe('To Charminar: Rs 150');
    expect(f.te).toBe('చార్మినార్ కి ₹150');
  });

  it('falls back to a generic line, and null for an unknown key', () => {
    expect(pickLine('quote', 'elder', 0)).toBeTruthy();
    expect(pickLine('nothing', 'elder', 0)).toBeNull();
  });
});

describe('small talk', () => {
  it('has Telugu on every question and option, and effects for every kind', () => {
    for (const t of TALKS) {
      expect(TELUGU.test(t.ask.te)).toBe(true);
      expect(t.options.length).toBeGreaterThanOrEqual(2);
      expect(t.options.length).toBeLessThanOrEqual(3);
      for (const o of t.options) {
        expect(TELUGU.test(o.label.te)).toBe(true);
        for (const k of KIND_IDS) expect(Number.isFinite(o.fx[k] ?? 0)).toBe(true);
      }
    }
  });

  it('radio: a student likes it, an elder does not', () => {
    expect(talkEffect('radio', 'on', 'student').mood).toBeGreaterThan(0);
    expect(talkEffect('radio', 'on', 'elder').mood).toBeLessThan(0);
    expect(talkEffect('radio', 'off', 'elder').mood).toBeGreaterThan(0);
  });

  it('shortcut: yes grants route allowance', () => {
    expect(talkEffect('shortcut', 'yes', 'regular').grace).toBeGreaterThan(0);
    expect(talkEffect('shortcut', 'no', 'regular').grace).toBe(0);
    expect(talkEffect('nope', 'x', 'regular')).toBeNull();
  });

  it('every effect is small: talk never makes or breaks a ride', () => {
    for (const t of TALKS) for (const o of t.options) for (const k of KIND_IDS) expect(Math.abs(o.fx[k] ?? 0)).toBeLessThanOrEqual(0.1);
  });

  it('never repeats a question, never asks when time is tight', () => {
    const used = [];
    for (let i = 0; i < 10; i++) {
      const t = pickTalk('regular', used, i);
      if (!t) break;
      expect(used).not.toContain(t.id);
      used.push(t.id);
    }
    expect(pickTalk('regular', used, 0)).toBeNull();
    expect(pickTalk('regular', [], 0, { urgentSoon: true })).toBeNull();
    expect(pickTalk('student', [], 0)).toBeTruthy();
  });

  it('schedules the first question before the later ones', () => {
    expect(nextTalkIn(true, 0)).toBe(TALK.firstAfter[0]);
    expect(nextTalkIn(true, 1)).toBe(TALK.firstAfter[1]);
    expect(nextTalkIn(false, 0.5)).toBeGreaterThan(TALK.gap[0]);
    expect(nextTalkIn(false, NaN)).toBeGreaterThan(0);
  });
});
