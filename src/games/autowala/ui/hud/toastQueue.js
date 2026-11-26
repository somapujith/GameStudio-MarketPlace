// The logic behind the toast stack and the floating "+Rs 120" bursts: capping, merging, expiry. Pure (time is passed in) so it
// is unit-tested without React (toastQueue.test.js). Toasts.jsx only renders what these functions return.
import { groupIndian } from './hudLogic.js';

export const MAX_TOASTS = 4;
export const EXIT_MS = 260; // how long a toast plays its leave animation before it is removed
export const DEFAULT_MS = 2600;
export const MIN_MS = 900;
export const MAX_MS = 9000;
export const MERGE_WINDOW_MS = 1200; // an identical toast inside this window bumps a counter instead of stacking
export const MAX_BURSTS = 3;
export const BURST_MS = 1500;
export const BURST_MERGE_MS = 450;
export const TONES = ['info', 'good', 'bad', 'gold'];

const REASONS = { fare: 'Fare', tip: 'Tip', bonus: 'Bonus', refund: 'Refund', fuel: 'Fuel', pump: 'Fuel', purchase: 'Workshop' };

/** The raw `toast` event -> `{ text, tone, icon, ms }`, or null when there is nothing to show. */
export function normalizeToast(p) {
  const text = String(p && p.text != null ? p.text : '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!text) return null;
  const ms = Number(p.ms);
  return {
    text,
    tone: TONES.includes(p.tone) ? p.tone : 'info',
    icon: typeof p.icon === 'string' ? p.icon.slice(0, 4) : '',
    ms: Number.isFinite(ms) ? Math.min(MAX_MS, Math.max(MIN_MS, ms)) : DEFAULT_MS,
  };
}

/**
 * Add a toast at time `now` (ms). Returns a new list, oldest first; at most `max` (default MAX_TOASTS) stay visible: the oldest leave early.
 * The phone HUD passes 3 (1 on a short portrait phone), see layoutLogic.toastCap.
 */
export function pushToast(list, payload, now, id, max = MAX_TOASTS) {
  const t = normalizeToast(payload);
  if (!t) return list;
  const out = list.map((x) => ({ ...x }));
  const twin = out.find((x) => !x.leaving && x.text === t.text && x.tone === t.tone && now - x.born < MERGE_WINDOW_MS);
  if (twin) {
    twin.count += 1;
    twin.until = now + t.ms;
    twin.born = now;
    return out;
  }
  out.push({ id, ...t, count: 1, born: now, until: now + t.ms, leaving: false });
  const live = out.filter((x) => !x.leaving);
  const cap = Math.max(1, Math.round(Number(max)) || MAX_TOASTS);
  for (let i = 0; i < live.length - cap; i++) {
    live[i].leaving = true;
    live[i].until = Math.min(live[i].until, now);
  }
  return out;
}

/** Mark finished toasts as leaving and drop the ones whose leave animation is over. Returns the SAME array when nothing changed. */
export function expireToasts(list, now) {
  let changed = false;
  const out = [];
  for (const x of list) {
    if (now >= x.until + EXIT_MS) {
      changed = true;
      continue;
    }
    if (now >= x.until && !x.leaving) {
      changed = true;
      out.push({ ...x, leaving: true });
    } else out.push(x);
  }
  return changed ? out : list;
}

/** Milliseconds until the next toast changes state (leaves / disappears), or null for an empty list. */
export function nextExpiry(list, now) {
  let best = null;
  for (const x of list) {
    const at = x.leaving || now >= x.until ? x.until + EXIT_MS : x.until;
    const d = Math.max(0, at - now);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** The `wallet` event -> a burst `{ delta, text, tone, label, ... }`, or null for a zero / invalid change. */
export function makeBurst(p, now, id) {
  const delta = Math.round(Number(p && p.delta));
  if (!Number.isFinite(delta) || delta === 0) return null;
  const reason = String((p && p.reason) || '').toLowerCase();
  return { id, delta, text: burstText(delta), tone: delta > 0 ? 'gold' : 'bad', label: REASONS[reason] || '', born: now, until: now + BURST_MS };
}

export const burstText = (delta) => `${delta > 0 ? '+' : '-'}Rs ${groupIndian(Math.abs(delta))}`;

/** Add a burst; a quick follow-up of the same sign (fare then tip) merges into one bigger number. At most MAX_BURSTS stay. */
export function pushBurst(list, p, now, id) {
  const b = makeBurst(p, now, id);
  if (!b) return list;
  const out = list.filter((x) => now < x.until).map((x) => ({ ...x }));
  const twin = out.find((x) => Math.sign(x.delta) === Math.sign(b.delta) && now - x.born < BURST_MERGE_MS);
  if (twin) {
    twin.delta += b.delta;
    twin.text = burstText(twin.delta);
    twin.label = twin.label === b.label ? twin.label : '';
    twin.until = now + BURST_MS;
    twin.born = now;
    return out;
  }
  out.push(b);
  while (out.length > MAX_BURSTS) out.shift();
  return out;
}

export const expireBursts = (list, now) => {
  const out = list.filter((x) => now < x.until);
  return out.length === list.length ? list : out;
};
