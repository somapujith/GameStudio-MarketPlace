import { describe, expect, it } from 'vitest';
import { KIND_IDS } from './fare-kinds.js';
import { BARGAIN, HAGGLE, canMeet, dropPrice, evaluateOffer, openingAsks, overcharged, quoteFor, respond, roundTo, startNegotiation, termsOutcome } from './fare-bargain.js';

const REF = 200;

describe('prices', () => {
  it('rounds to Rs 5 and has a persona for every kind', () => {
    expect(roundTo(203)).toBe(205);
    expect(roundTo(1)).toBe(5);
    for (const k of KIND_IDS) expect(HAGGLE[k]).toBeTruthy();
  });

  it('quotes a fixed price per persona, and three ordered opening asks', () => {
    expect(quoteFor('tourist', REF)).toBeGreaterThan(quoteFor('regular', REF));
    expect(quoteFor('student', REF)).toBeLessThan(quoteFor('regular', REF));
    const [high, fair, low] = openingAsks(REF);
    expect(high.id).toBe('high');
    expect(high.price).toBeGreaterThan(fair.price);
    expect(fair.price).toBeGreaterThan(low.price);
  });
});

describe('how each customer answers a price', () => {
  it('everyone accepts the meter-ish price', () => {
    for (const k of KIND_IDS) expect(evaluateOffer(k, Math.round(REF * 0.8), REF).verdict).toBe('accept');
  });

  it('a tourist overpays: accepts what makes a student walk', () => {
    const ask = Math.round(REF * 1.45);
    expect(evaluateOffer('tourist', ask, REF).verdict).toBe('accept');
    expect(evaluateOffer('student', ask, REF).verdict).toBe('refuse');
    expect(evaluateOffer('regular', ask, REF).verdict).toBe('counter');
  });

  it('a student haggles hard: even a fair price gets a counter below the estimate', () => {
    const r = evaluateOffer('student', Math.round(REF * 1.2), REF);
    expect(r.verdict).toBe('counter');
    expect(r.price).toBeLessThan(REF);
  });

  it('an elder counters politely instead of walking away from a high price', () => {
    expect(evaluateOffer('elder', Math.round(REF * 1.5), REF).verdict).toBe('counter');
  });

  it('counters are always below the ask and never refuse inside the stretch band', () => {
    for (const k of KIND_IDS) {
      for (let ratio = 0.7; ratio < 3; ratio += 0.1) {
        const ask = Math.round(REF * ratio);
        const r = evaluateOffer(k, ask, REF, 0.5);
        if (r.verdict === 'counter') expect(r.price).toBeLessThan(ask);
        if (ratio <= HAGGLE[k].max * 0.97) expect(r.verdict).toBe('accept');
        if (ratio > HAGGLE[k].stretch * 1.1) expect(r.verdict).toBe('refuse');
      }
    }
  });

  it('the roll moves the thresholds a little (a customer in a good mood is easier)', () => {
    const edge = Math.round(REF * HAGGLE.regular.max);
    expect(evaluateOffer('regular', edge + 12, REF, 0.95).verdict).toBe('accept');
    expect(evaluateOffer('regular', edge + 12, REF, 0.05).verdict).not.toBe('accept');
  });
});

describe('negotiation rounds', () => {
  it('a tourist agrees to the fixed quote at once; a student never does', () => {
    const n = startNegotiation('tourist', REF, quoteFor('tourist', REF), 0.5);
    expect(n.status).toBe('agreed');
    expect(n.price).toBe(quoteFor('tourist', REF));
    expect(startNegotiation('student', REF, quoteFor('student', REF), 0.9).status).toBe('countered');
  });

  it('accepting a counter pays the counter', () => {
    const n = startNegotiation('regular', REF, Math.round(REF * 1.4), 0.5);
    expect(n.status).toBe('countered');
    const c = n.counter;
    respond(n, 'accept');
    expect(n.status).toBe('agreed');
    expect(n.price).toBe(c);
  });

  it('meeting in the middle usually closes the deal, between the counter and the ask', () => {
    const n = startNegotiation('regular', REF, Math.round(REF * 1.4), 0.5);
    const { counter, ask } = n;
    respond(n, 'meet', 0.5);
    expect(['agreed', 'countered']).toContain(n.status);
    if (n.status === 'agreed') {
      expect(n.price).toBeGreaterThanOrEqual(counter);
      expect(n.price).toBeLessThanOrEqual(ask);
    } else {
      expect(n.counter).toBeGreaterThan(counter);
      expect(n.counter).toBeLessThan(n.ask);
    }
  });

  it('two rounds of meeting always end (agreed or refused), never loop', () => {
    for (const k of KIND_IDS) {
      for (const f of [1.3, 1.5, 1.8, 2.2]) {
        const n = startNegotiation(k, REF, Math.round(REF * f), 0.5);
        let guard = 0;
        while (n.status === 'countered' && guard++ < 6) respond(n, 'meet', 0.5);
        expect(guard).toBeLessThan(6);
        expect(['agreed', 'refused']).toContain(n.status);
      }
    }
  });

  it('holding a price: a tourist concedes, a student walks', () => {
    const t = startNegotiation('tourist', REF, Math.round(REF * 2.0), 0.5);
    expect(t.status).toBe('countered');
    respond(t, 'hold', 0.5);
    expect(t.status).toBe('agreed');
    expect(t.conceded).toBe(true);
    const s = startNegotiation('student', REF, Math.round(REF * 1.2), 0.5);
    respond(s, 'hold', 0.5);
    expect(s.status).toBe('refused');
  });

  it('canMeet is false once the rounds are used', () => {
    const n = startNegotiation('rusher', REF, Math.round(REF * 2.0), 0.5);
    expect(n.status).toBe('countered');
    expect(canMeet(n)).toBe(true);
    n.round = n.rounds + 1;
    expect(canMeet(n)).toBe(false);
  });

  it('a price dropped after a refusal is always accepted', () => {
    for (const k of KIND_IDS) {
      const p = dropPrice(k, REF);
      expect(evaluateOffer(k, p, REF, 0.05).verdict).toBe('accept');
    }
  });
});

describe('what terms do to the ride', () => {
  it('the meter calms elders and women most', () => {
    const e = termsOutcome('elder', { mode: 'meter' }, REF);
    const r = termsOutcome('regular', { mode: 'meter' }, REF);
    expect(e.mood).toBeGreaterThan(r.mood);
    expect(e.tipMul).toBeGreaterThan(1);
    expect(r.tipMul).toBe(1);
  });

  it('a high fixed price hurts a student more than a tourist, and tourists keep tipping', () => {
    const terms = { mode: 'fixed', fixedFare: Math.round(REF * 1.3), rounds: 1 };
    const s = termsOutcome('student', terms, REF);
    const t = termsOutcome('tourist', terms, REF);
    expect(s.mood).toBeLessThan(t.mood);
    expect(s.tipMul).toBeLessThan(1);
    expect(t.tipMul).toBeGreaterThan(s.tipMul);
    expect(s.premium).toBeCloseTo(0.3, 1);
  });

  it('a discount makes them happy, a long haggle costs goodwill, and a gouged tourist regrets it', () => {
    const cheap = termsOutcome('regular', { mode: 'fixed', fixedFare: Math.round(REF * 0.8), rounds: 1 }, REF);
    expect(cheap.mood).toBeGreaterThan(0);
    const long = termsOutcome('regular', { mode: 'fixed', fixedFare: REF, rounds: 3 }, REF);
    const short = termsOutcome('regular', { mode: 'fixed', fixedFare: REF, rounds: 1 }, REF);
    expect(long.mood).toBeLessThan(short.mood);
    const fair = termsOutcome('tourist', { mode: 'fixed', fixedFare: Math.round(REF * 1.3), rounds: 1 }, REF);
    const gouged = termsOutcome('tourist', { mode: 'fixed', fixedFare: Math.round(REF * 1.8), rounds: 1 }, REF);
    expect(gouged.mood).toBeLessThan(fair.mood);
  });

  it('keeps every outcome inside sane bounds and flags overcharging', () => {
    for (const k of KIND_IDS) {
      for (const f of [0.5, 1, 1.5, 2.5]) {
        const o = termsOutcome(k, { mode: 'fixed', fixedFare: Math.round(REF * f), rounds: 2 }, REF);
        expect(o.mood).toBeGreaterThanOrEqual(-0.4);
        expect(o.mood).toBeLessThanOrEqual(0.2);
        expect(o.tipMul).toBeGreaterThanOrEqual(0);
        expect(o.tipMul).toBeLessThanOrEqual(BARGAIN.tipMax);
      }
    }
    expect(overcharged('regular', 0.4)).toBe(true);
    expect(overcharged('tourist', 0.4)).toBe(false);
  });
});
