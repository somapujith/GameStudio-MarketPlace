// Pacing: people need time to read cards and events, and the server must wait as long as the client plays.
import { describe, expect, it } from 'vitest';
import { ANIM_MS, DECISION_MS, MAX_ANIM_MS, TRADE_MS, WARN_MS, cardMs, eventMs, readMs } from './timing.js';

describe('readMs', () => {
  it('grows with the number of words and stays inside its bounds', () => {
    expect(readMs('one two three')).toBe(3500); // the minimum
    expect(readMs(Array(200).fill('word').join(' '))).toBe(9000); // the maximum
    expect(readMs(Array(12).fill('word').join(' '))).toBeGreaterThan(readMs(Array(8).fill('word').join(' ')));
  });
});

describe('cardMs / eventMs', () => {
  it('holds a card long enough to read its title and sentence', () => {
    const card = { title: 'Biryani franchise goes viral', text: 'Your food business has a blockbuster weekend. Collect ₹80,000.' };
    expect(cardMs(card)).toBeGreaterThanOrEqual(5000);
    expect(cardMs(card)).toBeLessThanOrEqual(9000);
    expect(cardMs({ title: 'Hi', text: 'Short.' })).toBeGreaterThanOrEqual(4000);
  });

  it('falls back to the table value when there is no text', () => {
    expect(cardMs({})).toBe(ANIM_MS.card);
    expect(eventMs({})).toBe(ANIM_MS.cityEvent);
  });

  it('holds a city event for at least 3.2 s', () => {
    expect(eventMs({ title: 'Rush hour', text: 'Cyberabad rents x1.5.' })).toBeGreaterThanOrEqual(3200);
  });
});

describe('the table', () => {
  it('gives the roll time to tumble and the number time to sink in', () => {
    expect(ANIM_MS.dice).toBeGreaterThanOrEqual(1000);
    expect(ANIM_MS.afterDice).toBeGreaterThanOrEqual(900);
  });

  it('gives people a minute to decide, a bit less for a trade, and warns early enough to act', () => {
    expect(DECISION_MS).toBe(60_000);
    expect(TRADE_MS).toBeLessThan(DECISION_MS);
    expect(WARN_MS).toBeGreaterThanOrEqual(15_000);
  });

  it('the server cap leaves room for a long card chain', () => {
    const chain = ANIM_MS.dice + ANIM_MS.afterDice + 12 * ANIM_MS.step + ANIM_MS.land + 9000 + 12 * ANIM_MS.step + ANIM_MS.rentOut + ANIM_MS.rentIn;
    expect(MAX_ANIM_MS).toBeGreaterThanOrEqual(chain);
  });
});
