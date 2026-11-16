import { describe, it, expect } from 'vitest';
import { validateName } from '../../../worker/validate.js';
import {
  cleanGuestName,
  GUEST_NAME_MAX,
  hashSeed,
  suggestGuestName,
  initialGuestName,
  inviteLoginTarget,
  inviteHeadline,
  joinProblemCopy,
  readJoinDraft,
  writeJoinDraft,
  clearJoinDraft,
} from './inviteModel.js';
import { safeNext } from '@/components/shell/nav/safeNext.js';

describe('cleanGuestName', () => {
  it('trims, collapses spaces and accepts a normal name', () => {
    expect(cleanGuestName('  Asha   Rao ')).toEqual({ ok: true, value: 'Asha Rao' });
  });
  it('rejects empty or whitespace-only input with a friendly sentence', () => {
    for (const v of ['', '   ', null, undefined, 42, '​​']) {
      const r = cleanGuestName(v);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/pick a name/i);
    }
  });
  it('strips invisible characters and rejects names that are too long', () => {
    expect(cleanGuestName('A​B‮c')).toEqual({ ok: true, value: 'A B c' });
    const r = cleanGuestName('x'.repeat(GUEST_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(GUEST_NAME_MAX));
    expect(cleanGuestName('x'.repeat(GUEST_NAME_MAX)).ok).toBe(true);
  });
  it('agrees with the Worker validator on what is acceptable', () => {
    for (const v of ['Asha', ' a  b ', '', '   ', 'x'.repeat(24), 'x'.repeat(25), 'Zero​Width', '\u0007bell', '日本語の名前']) {
      const mine = cleanGuestName(v);
      const theirs = validateName(v);
      expect(mine.ok).toBe(theirs.ok);
      if (mine.ok) expect(mine.value).toBe(theirs.value);
    }
  });
});

describe('suggestGuestName', () => {
  it('is friendly, valid and steady for the same seed', () => {
    const a = suggestGuestName('ABC234');
    expect(a).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(suggestGuestName('ABC234')).toBe(a);
    expect(cleanGuestName(a).ok).toBe(true);
  });
  it('varies with the seed', () => {
    const names = new Set(['ABC234', 'XYZ789', 'KJ47MN', 'QRS567', 'TUV892', 'WXY345', 'DEF678'].map(suggestGuestName));
    expect(names.size).toBeGreaterThan(2);
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('initialGuestName', () => {
  it('prefers what was typed, then the last used name, then a suggestion', () => {
    expect(initialGuestName({ draft: 'Typed Name', lastUsed: 'Old', seed: 'ABC234' })).toBe('Typed Name');
    expect(initialGuestName({ draft: '', lastUsed: 'Old Name', seed: 'ABC234' })).toBe('Old Name');
    expect(initialGuestName({ seed: 'ABC234' })).toBe(suggestGuestName('ABC234'));
  });
  it('ignores the placeholder "Guest" and unusable drafts', () => {
    expect(initialGuestName({ draft: '   ', lastUsed: 'Guest', seed: 'ABC234' })).toBe(suggestGuestName('ABC234'));
  });
});

describe('inviteLoginTarget', () => {
  it('sends sign-in back to the very same invite link', () => {
    const target = inviteLoginTarget('ABC234');
    expect(target).toBe('/login?next=%2Fjoin%2FABC234');
    const next = new URLSearchParams(target.split('?')[1]).get('next');
    expect(next).toBe('/join/ABC234');
    // and Login accepts it as a post-login destination
    expect(safeNext(next, '/')).toBe('/join/ABC234');
  });
});

describe('inviteHeadline', () => {
  it('names the host when known', () => {
    expect(inviteHeadline('Ravi')).toBe('Ravi invited you');
    expect(inviteHeadline('')).toBe("You're invited");
    expect(inviteHeadline(null)).toBe("You're invited");
  });
});

describe('joinProblemCopy', () => {
  it('has a title and a next step for every reason', () => {
    for (const k of ['missing', 'full', 'playing', 'finished', 'forbidden', 'wrongGame', 'something-else']) {
      const c = joinProblemCopy(k, 4);
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.body.length).toBeGreaterThan(20);
    }
  });
  it('says what to do next', () => {
    expect(joinProblemCopy('missing').body).toMatch(/ask the host for a new code/i);
    expect(joinProblemCopy('finished').body).toMatch(/new code|your own table/i);
    expect(joinProblemCopy('full', 4).body).toContain('All 4 seats');
    expect(joinProblemCopy('full').body).toMatch(/start your own table/i);
    expect(joinProblemCopy('playing').body).toMatch(/rejoin/i);
  });
});

describe('join draft (session memory)', () => {
  it('is empty and harmless without storage (node)', () => {
    expect(readJoinDraft()).toEqual({ code: '', name: '' });
    expect(() => writeJoinDraft({ code: 'ABC234' })).not.toThrow();
    expect(() => clearJoinDraft()).not.toThrow();
  });
  it('remembers a code and a name, and forgets an old code', () => {
    const data = new Map();
    const prev = globalThis.sessionStorage;
    globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
    try {
      writeJoinDraft({ code: 'ABC234' });
      writeJoinDraft({ name: 'Asha' });
      expect(readJoinDraft()).toEqual({ code: 'ABC234', name: 'Asha' });
      expect(readJoinDraft(Date.now() + 31 * 60 * 1000)).toEqual({ code: '', name: 'Asha' });
      clearJoinDraft();
      expect(readJoinDraft()).toEqual({ code: '', name: '' });
    } finally {
      if (prev === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = prev;
    }
  });
});
