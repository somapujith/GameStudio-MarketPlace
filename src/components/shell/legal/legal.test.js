import { describe, it, expect } from 'vitest';
import { cleanContactEmail, LEGAL_UPDATED } from './contact.js';
import { FAQ, FAQ_GROUPS } from './faq.js';
import { plainText } from './rich.jsx';

describe('contact email', () => {
  it('accepts a plain address and trims it', () => {
    expect(cleanContactEmail('  help@example.org ')).toBe('help@example.org');
  });
  it('rejects empty, malformed and unsafe values (so no contact line renders)', () => {
    for (const bad of [undefined, null, '', 'nope', 'a b@c.d', 'a[@b.co', 'x@y', '<a@b.co>', 'a@b.co,c@d.ef']) {
      expect(cleanContactEmail(bad)).toBe('');
    }
  });
});

describe('help content', () => {
  it('has unique ids and every entry belongs to a real group', () => {
    const ids = FAQ.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(FAQ_GROUPS.map((g) => g.id));
    for (const f of FAQ) {
      expect(groups.has(f.group), f.id).toBe(true);
      expect(f.q.length).toBeGreaterThan(5);
      expect(f.a.length).toBeGreaterThan(0);
    }
  });
  it('every in-page link points at an existing answer', () => {
    const ids = new Set(FAQ.map((f) => f.id));
    const text = JSON.stringify(FAQ);
    for (const m of text.matchAll(/\]\(#([a-z-]+)\)/g)) expect(ids.has(m[1]), m[1]).toBe(true);
  });
  it('plainText strips markup', () => {
    expect(plainText('Go to [Help](/help), **now** `x`')).toBe('Go to Help, now x');
    expect(plainText({ ul: ['**a**', 'b'] })).toBe('a b');
  });
});

describe('legal date', () => {
  it('is today at launch', () => {
    expect(LEGAL_UPDATED.iso).toBe('2026-11-15');
  });
});
