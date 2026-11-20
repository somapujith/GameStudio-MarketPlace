import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEW_PLAYER_DAYS, _resetAutoSession, autoToursDone, canAutoStart, claimAuto, createdAtOf, gamesPlayedOf, hasSeen, isNewPlayer, markAutoToursDone,
  markSeen, resetAllTours, resetTour, tourKey,
} from './tourState.js';

function fakeStorage() {
  const m = new Map();
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('tourState', () => {
  let ls;
  beforeEach(() => {
    ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    resetAllTours();
  });
  afterEach(() => { vi.unstubAllGlobals(); resetAllTours(); });

  it('keys are versioned per tour', () => {
    expect(tourKey('game')).toBe('tour:v1:game');
    expect(tourKey('game', 'v2')).toBe('tour:v2:game');
  });

  it('remembers a seen tour and can forget it', () => {
    expect(hasSeen('game')).toBe(false);
    markSeen('game');
    expect(hasSeen('game')).toBe(true);
    expect(ls.getItem('tour:v1:game')).toBe('1');
    expect(hasSeen('lobby')).toBe(false);
    resetTour('game');
    expect(hasSeen('game')).toBe(false);
    expect(ls.getItem('tour:v1:game')).toBe(null);
  });

  it('a new tour id (a revision) is shown again', () => {
    markSeen('game');
    expect(hasSeen('game@2')).toBe(false);
  });

  it('resetAllTours only removes tour keys', () => {
    markSeen('a');
    markSeen('b');
    ls.setItem('hyd.settings.v1', '{}');
    resetAllTours();
    expect(hasSeen('a')).toBe(false);
    expect(hasSeen('b')).toBe(false);
    expect(ls.getItem('hyd.settings.v1')).toBe('{}');
  });

  it('never throws when storage throws, and keeps the answer in memory for the visit', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { return boom(); } });
    expect(() => hasSeen('x')).not.toThrow();
    expect(hasSeen('x')).toBe(false);
    expect(() => markSeen('x')).not.toThrow();
    expect(hasSeen('x')).toBe(true);
    expect(() => resetTour('x')).not.toThrow();
    expect(hasSeen('x')).toBe(false);
    markSeen('y');
    expect(() => resetAllTours()).not.toThrow();
    expect(hasSeen('y')).toBe(false);
  });

  it('works with no localStorage at all (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(hasSeen('z')).toBe(false);
    markSeen('z');
    expect(hasSeen('z')).toBe(true);
  });

  it('ignores an empty id', () => {
    expect(hasSeen('')).toBe(false);
    expect(() => markSeen('')).not.toThrow();
    expect(() => resetTour(undefined)).not.toThrow();
  });
});

describe('new-player gate', () => {
  const DAY = 86400000;
  const NOW = Date.UTC(2026, 5, 1);
  let ls;
  beforeEach(() => { ls = fakeStorage(); vi.stubGlobal('localStorage', ls); resetAllTours(); _resetAutoSession(); });
  afterEach(() => { vi.unstubAllGlobals(); resetAllTours(); _resetAutoSession(); });

  it('reads games played from stats, else from the per-game stats, else unknown', () => {
    expect(gamesPlayedOf({ stats: { games: 3 } })).toBe(3);
    expect(gamesPlayedOf({ stats: { games: 0 } })).toBe(0);
    expect(gamesPlayedOf({ gameStats: { a: { games: 2 }, b: { games: 1 } } })).toBe(3);
    expect(gamesPlayedOf({})).toBe(null);
    expect(gamesPlayedOf(null)).toBe(null);
  });

  it('reads the account age from createdAt / created_at (ms or ISO)', () => {
    expect(createdAtOf({ createdAt: 123 })).toBe(123);
    expect(createdAtOf({ created_at: '2026-06-01T00:00:00Z' })).toBe(NOW);
    expect(createdAtOf({ createdAt: 'nope' })).toBe(null);
    expect(createdAtOf({})).toBe(null);
  });

  it('a new account with 0 games is new; an old account or one that played is not', () => {
    const base = { stats: { games: 0 } };
    expect(isNewPlayer({ ...base, createdAt: NOW - 1 * DAY }, { now: NOW })).toBe(true);
    expect(isNewPlayer({ ...base, createdAt: NOW - (NEW_PLAYER_DAYS + 1) * DAY }, { now: NOW })).toBe(false);
    expect(isNewPlayer({ stats: { games: 1 }, createdAt: NOW - DAY }, { now: NOW })).toBe(false);
    expect(isNewPlayer({ gameStats: { x: { games: 4 } }, createdAt: NOW - DAY }, { now: NOW })).toBe(false);
  });

  it('missing data is NOT new (user not loaded, no stats, junk)', () => {
    expect(isNewPlayer(undefined, { now: NOW })).toBe(false);
    expect(isNewPlayer({}, { now: NOW })).toBe(false);
    expect(isNewPlayer({ id: 'u1', createdAt: NOW }, { now: NOW })).toBe(false);
    expect(isNewPlayer('x', { now: NOW })).toBe(false);
  });

  it('without an account age the browser first-seen stamp decides (guests and signed-out visitors included)', () => {
    const guest = { isGuest: true, stats: { games: 0 } };
    expect(isNewPlayer(guest, { now: NOW })).toBe(true); // stamps now
    expect(ls.getItem('tour:v1:firstSeen')).toBe(String(NOW));
    expect(isNewPlayer(guest, { now: NOW + 3 * DAY })).toBe(true);
    expect(isNewPlayer(guest, { now: NOW + 9 * DAY })).toBe(false);
    expect(isNewPlayer(null, { now: NOW + 9 * DAY })).toBe(false);
    expect(isNewPlayer(null, { now: NOW + 2 * DAY })).toBe(true);
  });

  it('a browser that already holds tour keys but no stamp is an old browser', () => {
    markSeen('home');
    expect(isNewPlayer(null, { now: NOW })).toBe(false);
    expect(isNewPlayer({ stats: { games: 0 } }, { now: NOW })).toBe(false);
  });

  it('a throwing or missing storage is never new', () => {
    const boom = () => { throw new Error('denied'); };
    const bad = { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { return boom(); } };
    expect(isNewPlayer(null, { now: NOW, storage: bad })).toBe(false);
    expect(isNewPlayer({ stats: { games: 0 } }, { now: NOW, storage: bad })).toBe(false);
    vi.stubGlobal('localStorage', undefined);
    expect(isNewPlayer(null, { now: NOW })).toBe(false);
    expect(() => markAutoToursDone()).not.toThrow();
  });

  it('auto start is blocked for a returning player and after the first game; an explicit start is not gated', () => {
    const fresh = { stats: { games: 0 }, createdAt: Date.now() - DAY };
    const returning = { stats: { games: 12 }, createdAt: Date.now() - 400 * DAY };
    expect(canAutoStart(fresh)).toBe(true);
    expect(canAutoStart(returning)).toBe(false);
    markAutoToursDone();
    expect(autoToursDone()).toBe(true);
    expect(canAutoStart(fresh)).toBe(false);
    // replay: resetAllTours forgets every tour AND the "done" flag, and the browser stamp stays
    ls.setItem('tour:v1:firstSeen', String(NOW));
    markSeen('home');
    resetAllTours();
    expect(hasSeen('home')).toBe(false);
    expect(autoToursDone()).toBe(false);
    expect(ls.getItem('tour:v1:firstSeen')).toBe(String(NOW));
    expect(canAutoStart(returning)).toBe(false); // replay is the explicit path (useTour.start never asks canAutoStart)
  });

  it('one auto tour per page load and one invite per session', () => {
    expect(claimAuto('page')).toBe(true);
    expect(claimAuto('page')).toBe(false);
    expect(claimAuto('invite')).toBe(true);
    expect(claimAuto('invite')).toBe(false);
    _resetAutoSession();
    expect(claimAuto('page')).toBe(true);
  });
});
