// The player's saved Autowala progress (wallet, loadout, owned parts, upgrades, stats). Stored on this device per account in
// localStorage; guests share one slot. Everything read back is normalised, so a corrupt or hostile value can never crash the game.
import { DEFAULT_LOADOUT, DEFAULT_UPGRADES, normalizeLoadout, normalizeUpgrades } from './catalog.js';

export const START_WALLET = 600;
const VERSION = 1;
const keyFor = (userId) => `jalebi.autowala.v${VERSION}:${userId || 'guest'}`;

export function defaultProfile() {
  return {
    version: VERSION,
    wallet: START_WALLET,
    totalEarned: 0,
    rides: 0,
    ratingSum: 0,
    ratingCount: 0,
    distance: 0, // metres driven, ever
    bestFare: 0,
    loadout: JSON.parse(JSON.stringify(DEFAULT_LOADOUT)),
    owned: {}, // 'paint.body:bonalu-red' -> true: once bought, re-applying is free
    upgrades: { ...DEFAULT_UPGRADES },
    quests: {}, // reserved for the quest system
    settings: { quality: null, sound: true, music: true, units: 'kmh' },
  };
}

/** A whole number 0..max; anything that is not a real number (null, '', true, {}, NaN, Infinity) falls back to `d`. */
const num = (v, d = 0, max = 1e9) => {
  const ok = (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
  return ok ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : d;
};
const QUALITIES = ['low', 'medium', 'high'];

export function normalizeProfile(raw) {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const owned = {};
  if (raw.owned && typeof raw.owned === 'object') for (const [k, v] of Object.entries(raw.owned)) if (v === true && /^[\w.\-:]{1,80}$/.test(k)) owned[k] = true;
  return {
    ...d,
    wallet: num(raw.wallet, d.wallet),
    totalEarned: num(raw.totalEarned),
    rides: num(raw.rides),
    ratingSum: Math.min(1e9, num(Math.round(Number(raw.ratingSum) * 10), 0, 1e10) / 10),
    ratingCount: num(raw.ratingCount),
    distance: num(raw.distance),
    bestFare: num(raw.bestFare),
    loadout: normalizeLoadout(raw.loadout),
    owned,
    upgrades: normalizeUpgrades(raw.upgrades),
    quests: raw.quests && typeof raw.quests === 'object' ? raw.quests : {},
    ...(raw.career && typeof raw.career === 'object' && !Array.isArray(raw.career) ? { career: raw.career } : {}), // career.js sanitises its own part
    settings: normalizeSettings(raw.settings, d.settings),
  };
}

/** The saved settings over the defaults; `quality` is checked here because Game.js treats any truthy value as "chosen by the player". */
export function normalizeSettings(raw, defaults = defaultProfile().settings) {
  const s = { ...defaults, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };
  s.quality = QUALITIES.includes(s.quality) ? s.quality : null;
  return s;
}

/** localStorage, or null when the browser blocks it (the getter itself throws a SecurityError with cookies off). */
function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** What another tab saved, folded into this tab's live data without losing either side's progress. Returns true when something changed. */
export function mergeProfiles(data, theirs) {
  let changed = false;
  for (const k of ['totalEarned', 'rides', 'ratingCount', 'distance', 'bestFare']) {
    if (theirs[k] > data[k]) {
      data[k] = theirs[k];
      changed = true;
    }
  }
  if (theirs.ratingCount >= data.ratingCount && theirs.ratingSum > data.ratingSum) {
    data.ratingSum = theirs.ratingSum;
    changed = true;
  }
  for (const k of Object.keys(theirs.owned)) if (!data.owned[k]) { data.owned[k] = true; changed = true; }
  for (const [k, lvl] of Object.entries(theirs.upgrades)) if (lvl > (data.upgrades[k] || 0)) { data.upgrades[k] = lvl; changed = true; } // in place: state.upgrades aliases it
  return changed;
}

/** A live profile: `data` is mutated in place by the game; `save()` is debounced and also runs on page hide. */
export function createProfile(userId, storage = defaultStorage()) {
  const key = keyFor(userId);
  let data = defaultProfile();
  try {
    const txt = storage?.getItem(key);
    if (txt) data = normalizeProfile(JSON.parse(txt));
  } catch {
    /* unreadable: start fresh */
  }
  let timer = 0;
  /** Another tab of the same account saved: take its wallet (it is the newer view) and keep the best of every counter. */
  const adopt = (txt) => {
    try {
      const theirs = normalizeProfile(JSON.parse(txt));
      const changed = mergeProfiles(data, theirs);
      if (theirs.wallet !== data.wallet) {
        data.wallet = theirs.wallet;
        return true;
      }
      return changed;
    } catch {
      return false;
    }
  };
  const write = (merge = true) => {
    if (merge) try {
      // a tab that was in the background may not have seen the other tab's last save yet: never overwrite progress it made
      const cur = storage?.getItem(key);
      if (cur) mergeProfiles(data, normalizeProfile(JSON.parse(cur)));
    } catch {
      /* unreadable: ours wins */
    }
    try {
      storage?.setItem(key, JSON.stringify(data));
    } catch {
      /* private mode / quota: progress just is not saved */
    }
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => write(), 400);
  };
  const flush = () => {
    clearTimeout(timer);
    write();
  };
  const onHide = () => flush();
  const onStorage = (e) => {
    if (e && e.key === key && typeof e.newValue === 'string') adopt(e.newValue);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onHide);
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('storage', onStorage);
  }
  /** Back to a new account's state. In place, so objects that alias parts of `data` (state.upgrades) stay live. */
  const reset = () => {
    const fresh = defaultProfile();
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, fresh);
    clearTimeout(timer);
    write(false); // not merged: the stored progress is exactly what is being thrown away
  };
  const dispose = () => {
    flush();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('storage', onStorage);
    }
  };
  return {
    get data() {
      return data;
    },
    save,
    flush,
    reset,
    adopt,
    dispose,
    rating: () => (data.ratingCount ? data.ratingSum / data.ratingCount : 0),
  };
}
