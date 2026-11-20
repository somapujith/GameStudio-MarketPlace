// The phone toast stack (pure, unit-tested in toastModel.test.js): at most two lines at a time, each one expires on its
// own; a roll followed by the landing becomes ONE line ("Sana rolled 5 and landed on Madhapur"), and the roll alone is
// not toasted (the speech bubble over the avatar already says it).

import { mergeRollText } from './feedModel.js';

export const MAX_TOASTS = 2;
/** How long a roll waits for its landing before it is forgotten. */
export const ROLL_WAIT_MS = 12000;

/** Kinds that never toast (the round banner and the turn hand-off already say it). */
const SILENT = new Set(['round']);

/** True when a feed item deserves a toast. */
export const toastWorthy = (item) => !!item && !!item.text && !SILENT.has(item.kind);

/** How long a line stays: long enough to read (about 16 characters a second), between 3 and 5.4 seconds, scaled by playback speed. */
export function toastMs(text, speed = 1) {
  const base = Math.min(5400, Math.max(3000, 1800 + String(text || '').length * 60));
  const s = Number(speed) > 0 ? Math.max(0.75, Number(speed)) : 1;
  return Math.round(base / s);
}

/**
 * Decide what a new feed item does to the toasts. `pending` = the last roll that is waiting for its landing
 * ({ item, at } or null). -> { show: item | null, pending }
 *   - a roll that can be joined ("... rolled 5") is held, not shown
 *   - the landing by the same player right after it is shown joined to it
 *   - anything else is shown as it is (and a held roll by someone else is dropped once it is stale)
 */
export function feedToToast(pending, item, now) {
  const held = pending && now - pending.at <= ROLL_WAIT_MS ? pending : null;
  if (!toastWorthy(item)) return { show: null, pending: held };
  if (item.kind === 'roll' && / rolled \d$/.test(item.text)) return { show: null, pending: { item, at: now } };
  if (item.kind === 'move' && held && held.item.player === item.player) {
    const text = mergeRollText(held.item.text, item.text);
    if (text) return { show: { ...item, text, id: held.item.id }, pending: null };
  }
  return { show: item, pending: held };
}

/** Add `item` to the stack at time `now`; the stack keeps the newest `max` live lines. -> new list. */
export function pushToast(list, item, now, { max = MAX_TOASTS, speed = 1 } = {}) {
  const live = (Array.isArray(list) ? list : []).filter((t) => t.expires > now);
  const ms = toastMs(item.text, speed);
  return [...live, { key: `t${item.id ?? now}`, id: item.id, text: item.text, tone: item.tone, icon: item.icon, kind: item.kind, player: item.player, tile: item.tile, expires: now + ms }].slice(-max);
}

/** Drop what has expired; the same list back when nothing did (so React does not re-render). */
export function expireToasts(list, now) {
  const live = list.filter((t) => t.expires > now);
  return live.length === list.length ? list : live;
}

/** The next moment a line expires (ms from `now`), or null for an empty stack. */
export function nextExpiry(list, now) {
  if (!list.length) return null;
  return Math.max(30, Math.min(...list.map((t) => t.expires)) - now);
}
