// Referral capture rules (docs/ENGAGEMENT.md section 2): which code a URL carries, first-one-wins for 30 days, never the
// viewer's own code, storage failures swallowed, and the Google sign-in body.
import { describe, expect, it } from 'vitest';
import {
  REF_KEY,
  REF_TTL_MS,
  captureRef,
  cleanRefCode,
  clearRef,
  googleSignInBody,
  hasRefParam,
  liveRef,
  readRef,
  refFromLocation,
  shouldStoreRef,
  stripRefParam,
} from './referral.js';

/** A Storage-like Map. */
function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}
const brokenStore = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('quota');
  },
  removeItem() {
    throw new Error('blocked');
  },
};
const NOW = Date.UTC(2026, 10, 22, 10, 0, 0);
const DAY = 86_400_000;

describe('cleanRefCode', () => {
  it('accepts friend codes in any case and spacing, rejects junk', () => {
    expect(cleanRefCode('HYD-7K2Q')).toBe('HYD-7K2Q');
    expect(cleanRefCode('hyd7k2q')).toBe('HYD-7K2Q');
    expect(cleanRefCode(' hyd-7k2q ')).toBe('HYD-7K2Q');
    expect(cleanRefCode('HYD-7K2')).toBe('');
    expect(cleanRefCode('hello world')).toBe('');
    expect(cleanRefCode('')).toBe('');
    expect(cleanRefCode(42)).toBe('');
    expect(cleanRefCode(`HYD-7K2Q${'x'.repeat(40)}`)).toBe('');
  });
});

describe('refFromLocation', () => {
  it('reads ?ref= on any page', () => {
    expect(refFromLocation({ pathname: '/', search: '?ref=HYD-7K2Q' })).toBe('HYD-7K2Q');
    expect(refFromLocation({ pathname: '/games/nawabi-raj', search: '?x=1&ref=hyd7k2q' })).toBe('HYD-7K2Q');
  });
  it('reads a /f/:code friend link', () => {
    expect(refFromLocation({ pathname: '/f/HYD-7K2Q', search: '' })).toBe('HYD-7K2Q');
    expect(refFromLocation({ pathname: '/f/hyd-7k2q/', search: '' })).toBe('HYD-7K2Q');
    expect(refFromLocation({ pathname: '/f/HYD%2D7K2Q', search: '' })).toBe('HYD-7K2Q');
  });
  it('?ref wins over the path; bad values are ignored', () => {
    expect(refFromLocation({ pathname: '/f/HYD-AAAA', search: '?ref=HYD-7K2Q' })).toBe('HYD-7K2Q');
    expect(refFromLocation({ pathname: '/f/HYD-AAAA', search: '?ref=nope' })).toBe('HYD-AAAA');
    expect(refFromLocation({ pathname: '/friends', search: '?add=HYD-7K2Q' })).toBe('');
    expect(refFromLocation({ pathname: '/', search: '?ref=' })).toBe('');
    expect(refFromLocation()).toBe('');
  });
});

describe('stripRefParam / hasRefParam', () => {
  it('removes only ref', () => {
    expect(stripRefParam('?ref=HYD-7K2Q')).toBe('');
    expect(stripRefParam('?game=nawabi-raj&ref=HYD-7K2Q')).toBe('?game=nawabi-raj');
    expect(stripRefParam('?a=1')).toBe('?a=1');
    expect(stripRefParam('')).toBe('');
    expect(hasRefParam('?ref=junk')).toBe(true);
    expect(hasRefParam('?a=1')).toBe(false);
  });
});

describe('liveRef / shouldStoreRef', () => {
  it('keeps a ref for 30 days', () => {
    expect(liveRef({ code: 'HYD-7K2Q', at: NOW - 29 * DAY }, NOW)).toEqual({ code: 'HYD-7K2Q', at: NOW - 29 * DAY });
    expect(liveRef({ code: 'HYD-7K2Q', at: NOW - REF_TTL_MS }, NOW)).toBeNull();
    expect(liveRef({ code: 'bad', at: NOW }, NOW)).toBeNull();
    expect(liveRef({ code: 'HYD-7K2Q', at: 'x' }, NOW)).toBeNull();
    expect(liveRef({ code: 'HYD-7K2Q', at: NOW + 3 * DAY }, NOW)).toBeNull(); // from the future: clock junk
    expect(liveRef(null, NOW)).toBeNull();
  });
  it('the first unexpired ref wins; never your own code', () => {
    expect(shouldStoreRef(null, 'HYD-7K2Q', { now: NOW })).toBe(true);
    expect(shouldStoreRef({ code: 'HYD-AAAA', at: NOW - DAY }, 'HYD-7K2Q', { now: NOW })).toBe(false);
    expect(shouldStoreRef({ code: 'HYD-AAAA', at: NOW - 31 * DAY }, 'HYD-7K2Q', { now: NOW })).toBe(true);
    expect(shouldStoreRef(null, 'HYD-7K2Q', { now: NOW, ownCode: 'HYD-7K2Q' })).toBe(false);
    expect(shouldStoreRef(null, 'hyd7k2q', { now: NOW, ownCode: 'HYD-7K2Q' })).toBe(false);
    expect(shouldStoreRef(null, 'not a code', { now: NOW })).toBe(false);
  });
});

describe('captureRef / readRef / clearRef', () => {
  it('stores { code, at } under jg-ref and reads it back while fresh', () => {
    const s = memStore();
    expect(captureRef('hyd-7k2q', { now: NOW, storage: s })).toBe(true);
    expect(JSON.parse(s.raw.get(REF_KEY))).toEqual({ code: 'HYD-7K2Q', at: NOW });
    expect(readRef({ now: NOW + DAY, storage: s })).toBe('HYD-7K2Q');
    expect(readRef({ now: NOW + 31 * DAY, storage: s })).toBe('');
  });
  it('does not overwrite an unexpired ref, replaces an expired one', () => {
    const s = memStore({ [REF_KEY]: JSON.stringify({ code: 'HYD-AAAA', at: NOW - DAY }) });
    expect(captureRef('HYD-7K2Q', { now: NOW, storage: s })).toBe(false);
    expect(readRef({ now: NOW, storage: s })).toBe('HYD-AAAA');
    const old = memStore({ [REF_KEY]: JSON.stringify({ code: 'HYD-AAAA', at: NOW - 40 * DAY }) });
    expect(captureRef('HYD-7K2Q', { now: NOW, storage: old })).toBe(true);
    expect(readRef({ now: NOW, storage: old })).toBe('HYD-7K2Q');
  });
  it('skips your own code and tolerates junk JSON', () => {
    const s = memStore({ [REF_KEY]: '{not json' });
    expect(captureRef('HYD-7K2Q', { now: NOW, ownCode: 'HYD-7K2Q', storage: s })).toBe(false);
    expect(readRef({ now: NOW, storage: s })).toBe('');
    expect(captureRef('HYD-AAAA', { now: NOW, storage: s })).toBe(true);
  });
  it('clearRef forgets it; blocked storage never throws', () => {
    const s = memStore();
    captureRef('HYD-7K2Q', { now: NOW, storage: s });
    clearRef({ storage: s });
    expect(readRef({ now: NOW, storage: s })).toBe('');
    expect(captureRef('HYD-7K2Q', { now: NOW, storage: brokenStore })).toBe(false);
    expect(readRef({ now: NOW, storage: brokenStore })).toBe('');
    expect(() => clearRef({ storage: brokenStore })).not.toThrow();
    expect(captureRef('HYD-7K2Q', { now: NOW, storage: null })).toBe(false);
  });
});

describe('googleSignInBody', () => {
  it('adds ref only when there is a clean one', () => {
    expect(googleSignInBody('tok', 'HYD-7K2Q')).toEqual({ credential: 'tok', ref: 'HYD-7K2Q' });
    expect(googleSignInBody('tok', '')).toEqual({ credential: 'tok' });
    expect(googleSignInBody('tok', 'not a code')).toEqual({ credential: 'tok' });
    expect(googleSignInBody('tok')).toEqual({ credential: 'tok' });
  });
});
