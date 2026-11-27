// Tier memory: remembers, per (GPU, viewport class), the last STABLE quality tier + render scale so the second session starts where the first one
// settled and never has to hitch its way down. Pure logic over an injectable Storage; every storage touch is guarded (private mode, blocked
// storage, quota, corrupt JSON, another tab writing garbage), and a failure just degrades to an in-memory copy for this page's life.
//
//   const mem = createTierMemory({ game: 'tiffin-centre' });
//   const vp = viewportClass(innerWidth, innerHeight, devicePixelRatio);
//   const saved = mem.get(gpu.key, vp);          // { tier, scale, at, failed } | null
//   ...                                          // governor.onStable -> mem.set(gpu.key, vp, { tier, scale })
//   governor tier-up probe failed               -> mem.markFailed(gpu.key, vp, 'high')   // never retried for a week
//
// Storage layout: ONE key per game, `jalebi.gfx.v1.<game>`, JSON { v: 1, e: { "<gpu>|<viewport>": { t, s, at, f?: { tier: at } } } }.
// Bounded: at most `maxEntries` (16) entries (least recently written dropped first) and `maxBytes` (4096) of JSON.

export const MEMORY_VERSION = 1;
export const MEMORY_PREFIX = 'jalebi.gfx.v1.';

const DAY = 86400000;
const MAX_KEY = 140;
const TIER_RE = /^[a-z][a-z0-9_-]{0,15}$/i;

/**
 * A coarse class of the drawing buffer: how many device pixels the game has to fill. 1536x864 @1.25 and 1920x1080 @1 land in the same bucket
 * (the same pixel load), which is what a remembered tier is really about.
 */
export function viewportClass(width, height, dpr = 1) {
  const d = Math.min(3, Math.max(0.5, Number(dpr) || 1));
  const px = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0) * d * d;
  const mp = px / 1e6;
  const bucket = mp < 0.5 ? 'xs' : mp < 1 ? 's' : mp < 2 ? 'm' : mp < 3.5 ? 'l' : 'xl';
  return bucket;
}

const clampScale = (s) => (Number.isFinite(s) ? Math.min(1, Math.max(0.25, s)) : 1);

/** Accepts only well-formed entries; anything else is dropped (another tab, an old build or a user may have edited the value). */
function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || k.length > MAX_KEY || !v || typeof v !== 'object') continue;
    const t = typeof v.t === 'string' && TIER_RE.test(v.t) ? v.t : null;
    const at = Number.isFinite(v.at) ? v.at : 0;
    const f = {};
    if (v.f && typeof v.f === 'object') for (const [ft, fa] of Object.entries(v.f)) if (TIER_RE.test(ft) && Number.isFinite(fa)) f[ft] = fa;
    if (!t && !Object.keys(f).length) continue;
    out[k] = { t, s: clampScale(Number(v.s)), at, ...(Object.keys(f).length ? { f } : {}) };
  }
  return out;
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked: private mode, sandboxed iframe, disabled cookies */ }
  return null;
}

export function createTierMemory({ game = 'game', storage, now = () => Date.now(), ttlMs = 30 * DAY, failTtlMs = 7 * DAY, maxEntries = 16, maxBytes = 4096 } = {}) {
  const storeKey = `${MEMORY_PREFIX}${String(game).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'game'}`;
  let degraded = false; // storage is unusable: serve from `entries` only
  let loaded = false;
  let entries = {};

  const store = () => (degraded ? null : getStorage(storage));

  function load() {
    if (loaded) return;
    loaded = true;
    const s = store();
    if (!s) {
      degraded = true;
      return;
    }
    let text = null;
    try {
      text = s.getItem(storeKey);
    } catch {
      degraded = true;
      return;
    }
    if (text == null) return;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.v !== MEMORY_VERSION) throw new Error('version');
      entries = sanitize(parsed.e);
    } catch {
      entries = {};
      try {
        s.removeItem(storeKey); // corrupt or foreign: start clean
      } catch { /* ignore */ }
    }
  }

  const serialize = () => JSON.stringify({ v: MEMORY_VERSION, e: entries });

  function trim() {
    const keys = Object.keys(entries).sort((a, b) => entries[a].at - entries[b].at);
    while (keys.length > maxEntries) delete entries[keys.shift()];
    while (keys.length > 1 && serialize().length > maxBytes) delete entries[keys.shift()];
  }

  function persist() {
    trim();
    const s = store();
    if (!s) return false;
    try {
      s.setItem(storeKey, serialize());
      return true;
    } catch {
      // quota or a failing store: drop the older half once and retry, then give up and stay in memory
      try {
        const keys = Object.keys(entries).sort((a, b) => entries[a].at - entries[b].at);
        for (const k of keys.slice(0, Math.floor(keys.length / 2))) delete entries[k]; // the newest entry is last and always survives
        s.setItem(storeKey, serialize());
        return true;
      } catch {
        degraded = true;
        return false;
      }
    }
  }

  const keyOf = (gpuKey, vp) => `${String(gpuKey || 'unknown').slice(0, 96)}|${String(vp || 'm').slice(0, 12)}`;

  return {
    get supported() { load(); return !degraded; },
    /** The remembered result for this machine: { tier, scale, at, ageMs, failed: { tier: at } } or null (none, stale or no tier recorded). */
    get(gpuKey, vp) {
      load();
      const e = entries[keyOf(gpuKey, vp)];
      if (!e || !e.t || now() - e.at > ttlMs) return null;
      return { tier: e.t, scale: e.s, at: e.at, ageMs: now() - e.at, failed: { ...(e.f || {}) } };
    },
    /** Records the stable (tier, scale). A tier recorded as failed stays recorded. Skips the write when nothing changed. */
    set(gpuKey, vp, { tier, scale = 1 }) {
      load();
      if (!tier || !TIER_RE.test(tier)) return false;
      const k = keyOf(gpuKey, vp);
      const prev = entries[k];
      const s = Math.round(clampScale(scale) * 100) / 100;
      if (prev && prev.t === tier && Math.abs(prev.s - s) < 0.005 && now() - prev.at < 60000) return true;
      entries[k] = { t: tier, s, at: now(), ...(prev?.f ? { f: prev.f } : {}) };
      return persist();
    },
    /** A tier that was tried and could not hold the frame budget here: `isFailed` stays true for `failTtlMs`. */
    markFailed(gpuKey, vp, tier) {
      load();
      if (!tier || !TIER_RE.test(tier)) return false;
      const k = keyOf(gpuKey, vp);
      const prev = entries[k] || { t: null, s: 1, at: 0 };
      entries[k] = { ...prev, at: prev.at || now(), f: { ...(prev.f || {}), [tier]: now() } };
      return persist();
    },
    isFailed(gpuKey, vp, tier) {
      load();
      const at = entries[keyOf(gpuKey, vp)]?.f?.[tier];
      return Number.isFinite(at) && now() - at < failTtlMs;
    },
    forget(gpuKey, vp) {
      load();
      delete entries[keyOf(gpuKey, vp)];
      return persist();
    },
    clear() {
      load();
      entries = {};
      const s = store();
      try {
        s?.removeItem(storeKey);
      } catch { /* ignore */ }
    },
    /** For diagnostics. */
    dump() {
      load();
      return JSON.parse(JSON.stringify(entries));
    },
    storeKey,
  };
}
