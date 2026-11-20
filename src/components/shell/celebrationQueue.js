// Pure celebration queue (no React, no DOM): one celebration on screen at a time, the rest wait in order.
// `celebrate.js` owns the app-wide instance; `CelebrationHost.jsx` renders its head.

export const CELEBRATION_KINDS = ['level', 'badge', 'coins', 'purchase'];
export const CELEBRATION_MS = 2500;
/** Waiting items beyond this are dropped (oldest waiting first); the visible one is never dropped. */
export const QUEUE_MAX = 5;
/** An identical celebration (same kind + title + text) pushed again within this window is ignored. */
export const DEDUPE_MS = 1500;

const DEFAULT_TITLES = { level: 'Level up!', badge: 'Badge unlocked', coins: 'Coins added', purchase: 'Unlocked!' };

/** Cleans an input into `{ kind, title, text, icon }` or null when unusable. */
export function normalizeCelebration(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = CELEBRATION_KINDS.includes(input.kind) ? input.kind : 'badge';
  const str = (v, max) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
  const title = str(input.title, 60) || DEFAULT_TITLES[kind];
  const text = str(input.text, 140);
  const icon = typeof input.icon === 'string' && input.icon ? input.icon : null;
  const duration = Number.isFinite(Number(input.duration)) ? Math.max(800, Math.min(8000, Number(input.duration))) : CELEBRATION_MS;
  return { kind, title, text, icon, duration };
}

/**
 * `createCelebrationQueue({ now })` -> { push, dismiss, current, pending, size, clear, subscribe }.
 *   push(input) -> id | null (null = invalid or a duplicate)
 *   dismiss(id?) closes the visible item (only if `id` matches, when given) and promotes the next one.
 *   subscribe(fn) -> unsubscribe; fn(current) after every change.
 */
export function createCelebrationQueue({ now = () => Date.now(), max = QUEUE_MAX, dedupeMs = DEDUPE_MS } = {}) {
  let items = []; // items[0] is on screen
  let seq = 0;
  const recent = new Map(); // signature -> time
  const subs = new Set();

  const emit = () => {
    const head = items[0] || null;
    subs.forEach((fn) => {
      try {
        fn(head);
      } catch {
        /* a bad subscriber must not break the queue */
      }
    });
  };

  return {
    push(input) {
      const c = normalizeCelebration(input);
      if (!c) return null;
      const sig = `${c.kind}|${c.title}|${c.text}`;
      const t = now();
      const last = recent.get(sig);
      if (last !== undefined && t - last < dedupeMs) return null;
      recent.set(sig, t);
      if (recent.size > 50) recent.delete(recent.keys().next().value);
      const item = { ...c, id: ++seq };
      items.push(item);
      // keep the visible head, then the newest `max - 1` waiting
      if (items.length > max) items = [items[0], ...items.slice(items.length - (max - 1))];
      emit();
      return item.id;
    },
    dismiss(id) {
      if (!items.length) return false;
      if (id !== undefined && id !== null && items[0].id !== id) return false;
      items = items.slice(1);
      emit();
      return true;
    },
    current: () => items[0] || null,
    pending: () => items.slice(1),
    size: () => items.length,
    clear() {
      items = [];
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

// ---------------------------------------------------------------- level-up detection (pure)

/**
 * Compares a user's level with the last one seen on this device.
 * `seen` is `{ [userId]: level }`. Returns `{ up: boolean, from, to, seen: nextMap }`.
 * The first sighting of a user only records the level (no celebration for an existing level).
 */
export function checkLevelUp(seen, userId, level) {
  const map = seen && typeof seen === 'object' ? { ...seen } : {};
  const lv = Math.floor(Number(level));
  if (userId === undefined || userId === null || userId === '' || !Number.isFinite(lv) || lv < 1) return { up: false, from: null, to: null, seen: map };
  const key = String(userId);
  const prev = Math.floor(Number(map[key]));
  map[key] = lv;
  if (!Number.isFinite(prev)) return { up: false, from: null, to: lv, seen: map };
  return { up: lv > prev, from: prev, to: lv, seen: map };
}

/** The app-wide queue: `celebrate()` pushes into it, `<CelebrationHost/>` renders its head. */
export const appCelebrations = createCelebrationQueue();
