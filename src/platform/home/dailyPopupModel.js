// Pure rules for the "daily reward" popup that greets a signed-in member a few seconds after the app loads.
// No React, no network. The popup itself is DailyRewardPopup.jsx; the eligibility check reuses `dailyView`, the same
// helper the Home card renders from (src/components/shell/home/homeModel.js), so the two can never disagree.

import { dailyView, istDayKey } from '@/components/shell/home/homeModel.js';

/** Wait this long after the signed-in app is up before the popup may appear (so it does not fight the page load). */
export const DAILY_POPUP_DELAY_MS = 3500;
/** When something else (a modal, a sheet, the tour) is open at that moment, look again after this long. */
export const DAILY_POPUP_RECHECK_MS = 1500;
/** After a successful claim the popup closes itself this long afterwards (the "Done" button closes it sooner). */
export const DAILY_POPUP_AUTOCLOSE_MS = 1500;

/** Full-screen play routes: never interrupt a game or a lobby. */
const BLOCKED_PREFIXES = ['/play', '/lobby', '/login'];

/** True for hub pages (Home, Games, Shop, Profile...), false inside /play/** and /lobby/** (and the sign-in screen). */
export function popupRouteAllowed(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  if (!p.startsWith('/')) return false;
  return !BLOCKED_PREFIXES.some((b) => p === b || p.startsWith(`${b}/`));
}

/**
 * Is a daily reward claimable right now, for a member (Google account)?
 * -> { eligible, reason } where reason is 'ok' | 'signed-out' | 'guest' | 'unknown' | 'claimed'.
 * `user.daily = { streak, lastClaim, canClaim, nextReward }` from GET /api/me. Missing / malformed daily state is
 * "unknown" and shows nothing (offline, an older API, still loading): the Home card stays the fallback.
 */
export function popupEligibility(user, now = Date.now()) {
  if (!user || typeof user !== 'object' || user.id == null || user.id === '') return { eligible: false, reason: 'signed-out' };
  if (user.isGuest) return { eligible: false, reason: 'guest' };
  const d = user.daily;
  if (!d || typeof d !== 'object') return { eligible: false, reason: 'unknown' };
  if (typeof d.canClaim !== 'boolean' && typeof d.lastClaim !== 'string') return { eligible: false, reason: 'unknown' };
  return dailyView(d, now).claimed ? { eligible: false, reason: 'claimed' } : { eligible: true, reason: 'ok' };
}

/** Storage keys: one flag per tab session and per account, one "last day shown" per account. */
export function popupKeys(userId) {
  const id = String(userId ?? '');
  return { session: `hh:daily-popup:session:${id}`, day: `hh:daily-popup:day:${id}` };
}

function safeStorage(kind) {
  try {
    return typeof window !== 'undefined' ? window[kind] || null : null;
  } catch {
    return null;
  }
}

function read(store, key) {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(store, key, value) {
  try {
    store?.setItem(key, value);
  } catch {
    /* private mode / quota: the in-memory phase of the popup still stops it from nagging in this tab */
  }
}

/** Has this member already dismissed the popup this session, or on this IST day? (storage is injectable for tests) */
export function popupDismissed(userId, now = Date.now(), { session = safeStorage('sessionStorage'), local = safeStorage('localStorage') } = {}) {
  const k = popupKeys(userId);
  if (read(session, k.session)) return true;
  return read(local, k.day) === istDayKey(now);
}

/** Remember a dismissal (or a finished claim): not again this session, not again today. */
export function markPopupDismissed(userId, now = Date.now(), { session = safeStorage('sessionStorage'), local = safeStorage('localStorage') } = {}) {
  const k = popupKeys(userId);
  write(session, k.session, '1');
  write(local, k.day, istDayKey(now));
}

/** Is another dialog / sheet / tour already on screen? (`doc` needs `querySelector`; `null` means "nothing to check") */
export function anotherLayerOpen(doc) {
  try {
    return !!doc?.querySelector?.('[aria-modal="true"], [role="dialog"], [role="alertdialog"], .hh-modal');
  } catch {
    return false;
  }
}

/** Everything that must hold for the delay timer to be armed (re-checked again when it fires). */
export function popupShouldArm({ user, pathname, now = Date.now(), dismissed = false } = {}) {
  return !dismissed && popupRouteAllowed(pathname) && popupEligibility(user, now).eligible;
}

/** The one-line status under the title, from a `dailyView(...)` result (same wording family as the Home card). */
export function popupSubline(view) {
  if (!view) return '';
  if (view.claimed) return 'Claimed. Your next reward unlocks at midnight.';
  if (view.lost) return 'Streak lost. Start a new one today.';
  if (view.streak === 0) return 'Your coins are waiting. Come back daily to grow them.';
  const pos = view.days?.find((d) => d.current)?.n;
  return pos ? `Day ${pos} of 7. Keep the streak alive.` : 'Keep the streak alive.';
}
