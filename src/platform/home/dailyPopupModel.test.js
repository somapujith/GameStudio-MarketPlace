import { describe, expect, it } from 'vitest';
import { istDayKey } from '@/components/shell/home/homeModel.js';
import {
  DAILY_POPUP_AUTOCLOSE_MS,
  DAILY_POPUP_DELAY_MS,
  DAILY_POPUP_RECHECK_MS,
  anotherLayerOpen,
  markPopupDismissed,
  popupDismissed,
  popupEligibility,
  popupKeys,
  popupRouteAllowed,
  popupShouldArm,
} from './dailyPopupModel.js';

const NOW = Date.UTC(2026, 10, 17, 6, 0, 0);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), m };
};
const member = (daily) => ({ id: 'u1', name: 'Asha', isGuest: false, daily });
const READY = { streak: 2, lastClaim: istDayKey(NOW - 86_400_000), canClaim: true, nextReward: 250 };
const DONE = { streak: 3, lastClaim: istDayKey(NOW), canClaim: false, nextReward: 300 };

describe('timing', () => {
  it('waits about three and a half seconds, re-checks quickly, auto-closes after a claim in 1.5 s', () => {
    expect(DAILY_POPUP_DELAY_MS).toBe(3500);
    expect(DAILY_POPUP_RECHECK_MS).toBeLessThan(DAILY_POPUP_DELAY_MS);
    expect(DAILY_POPUP_AUTOCLOSE_MS).toBe(1500);
  });
});

describe('popupEligibility', () => {
  it('is eligible for a member whose reward is claimable now', () => {
    expect(popupEligibility(member(READY), NOW)).toEqual({ eligible: true, reason: 'ok' });
  });
  it('is eligible on a first-ever claim (no streak yet)', () => {
    expect(popupEligibility(member({ streak: 0, lastClaim: null, canClaim: true }), NOW).eligible).toBe(true);
  });
  it('is not for signed-out visitors', () => {
    expect(popupEligibility(null, NOW)).toEqual({ eligible: false, reason: 'signed-out' });
    expect(popupEligibility(undefined, NOW).eligible).toBe(false);
    expect(popupEligibility({ daily: READY }, NOW).eligible).toBe(false); // no id
  });
  it('is not for guests', () => {
    expect(popupEligibility({ id: 'g1', isGuest: true, daily: READY }, NOW)).toEqual({ eligible: false, reason: 'guest' });
  });
  it('is not when already claimed today', () => {
    expect(popupEligibility(member(DONE), NOW)).toEqual({ eligible: false, reason: 'claimed' });
    expect(popupEligibility(member({ streak: 3, lastClaim: istDayKey(NOW) }), NOW).reason).toBe('claimed');
  });
  it('is not when the claim state is unknown or malformed', () => {
    for (const daily of [undefined, null, 'x', 5, {}, { streak: 4 }]) {
      expect(popupEligibility(member(daily), NOW)).toEqual({ eligible: false, reason: 'unknown' });
    }
  });
  it('agrees with the Home card helper once the IST day rolls over', () => {
    const tomorrow = NOW + 86_400_000;
    // a lastClaim-only answer that was "claimed" today becomes claimable tomorrow
    expect(popupEligibility(member({ streak: 3, lastClaim: istDayKey(NOW) }), tomorrow).eligible).toBe(true);
  });
});

describe('popupRouteAllowed', () => {
  it('allows hub pages', () => {
    for (const p of ['/', '/games', '/games/ludo', '/shop', '/profile', '/friends', '/leaderboard', '/search', '/f/ABC']) {
      expect(popupRouteAllowed(p), p).toBe(true);
    }
  });
  it('blocks full-screen play and lobby routes, and sign-in', () => {
    for (const p of ['/play', '/play/ludo', '/play/ludo/ABCD', '/lobby/ABCD', '/lobby', '/login']) {
      expect(popupRouteAllowed(p), p).toBe(false);
    }
  });
  it('does not confuse look-alike prefixes', () => {
    expect(popupRouteAllowed('/playground')).toBe(true);
    expect(popupRouteAllowed('/lobbyists')).toBe(true);
  });
  it('is false for junk', () => {
    expect(popupRouteAllowed(undefined)).toBe(false);
    expect(popupRouteAllowed('')).toBe(false);
  });
});

describe('dismissal keys', () => {
  it('are per account', () => {
    expect(popupKeys('a')).not.toEqual(popupKeys('b'));
    expect(popupKeys('a').day).toContain('a');
    expect(popupKeys('a').session).toContain('a');
  });
  it('a fresh account has not dismissed', () => {
    expect(popupDismissed('u1', NOW, { session: memory(), local: memory() })).toBe(false);
  });
  it('dismissing blocks the rest of the session and the rest of the IST day', () => {
    const session = memory();
    const local = memory();
    markPopupDismissed('u1', NOW, { session, local });
    expect(popupDismissed('u1', NOW, { session, local })).toBe(true);
    // a new tab session on the same day: still blocked by the per-day key
    expect(popupDismissed('u1', NOW + 3_600_000, { session: memory(), local })).toBe(true);
    // the same session on the next day: still blocked by the session flag
    expect(popupDismissed('u1', NOW + 86_400_000, { session, local })).toBe(true);
    // a new session on the next day: allowed again
    expect(popupDismissed('u1', NOW + 86_400_000, { session: memory(), local })).toBe(false);
    // another account is unaffected
    expect(popupDismissed('u2', NOW, { session, local })).toBe(false);
  });
  it('survives broken storage (private mode, quota, no storage)', () => {
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => markPopupDismissed('u1', NOW, { session: boom, local: boom })).not.toThrow();
    expect(popupDismissed('u1', NOW, { session: boom, local: boom })).toBe(false);
    expect(() => markPopupDismissed('u1', NOW, { session: null, local: null })).not.toThrow();
    expect(popupDismissed('u1', NOW, { session: null, local: null })).toBe(false);
  });
});

describe('anotherLayerOpen', () => {
  it('sees a dialog, a modal layer or an aria-modal node', () => {
    expect(anotherLayerOpen({ querySelector: () => ({}) })).toBe(true);
    expect(anotherLayerOpen({ querySelector: () => null })).toBe(false);
    expect(anotherLayerOpen(null)).toBe(false);
    expect(anotherLayerOpen({ querySelector: () => { throw new Error('x'); } })).toBe(false);
  });
  it('asks for the shared Modal layer and ARIA dialogs', () => {
    let sel = '';
    anotherLayerOpen({ querySelector: (s) => ((sel = s), null) });
    expect(sel).toContain('.hh-modal');
    expect(sel).toContain('[aria-modal="true"]');
  });
});

describe('popupShouldArm', () => {
  const base = { user: member(READY), pathname: '/', now: NOW, dismissed: false };
  it('arms for an eligible member on a hub page', () => {
    expect(popupShouldArm(base)).toBe(true);
    expect(popupShouldArm({ ...base, pathname: '/shop' })).toBe(true);
  });
  it('does not arm in a game, when dismissed, or when not eligible', () => {
    expect(popupShouldArm({ ...base, pathname: '/play/ludo' })).toBe(false);
    expect(popupShouldArm({ ...base, dismissed: true })).toBe(false);
    expect(popupShouldArm({ ...base, user: member(DONE) })).toBe(false);
    expect(popupShouldArm({ ...base, user: { id: 'g', isGuest: true, daily: READY } })).toBe(false);
    expect(popupShouldArm({ ...base, user: null })).toBe(false);
    expect(popupShouldArm()).toBe(false);
  });
});
