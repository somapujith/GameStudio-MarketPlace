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

const num = (v, d = 0, max = 1e9) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : d);

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
    ratingSum: Math.max(0, Number(raw.ratingSum) || 0),
    ratingCount: num(raw.ratingCount),
    distance: num(raw.distance),
    bestFare: num(raw.bestFare),
    loadout: normalizeLoadout(raw.loadout),
    owned,
    upgrades: normalizeUpgrades(raw.upgrades),
    quests: raw.quests && typeof raw.quests === 'object' ? raw.quests : {},
    settings: { ...d.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
  };
}

/** A live profile: `data` is mutated in place by the game; `save()` is debounced and also runs on page hide. */
export function createProfile(userId, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const key = keyFor(userId);
  let data = defaultProfile();
  try {
    const txt = storage?.getItem(key);
    if (txt) data = normalizeProfile(JSON.parse(txt));
  } catch {
    /* unreadable: start fresh */
  }
  let timer = 0;
  const write = () => {
    try {
      storage?.setItem(key, JSON.stringify(data));
    } catch {
      /* private mode / quota: progress just is not saved */
    }
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 400);
  };
  const flush = () => {
    clearTimeout(timer);
    write();
  };
  const onHide = () => flush();
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onHide);
    window.addEventListener('visibilitychange', onHide);
  }
  const reset = () => {
    data = defaultProfile();
    flush();
  };
  const dispose = () => {
    flush();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('visibilitychange', onHide);
    }
  };
  return {
    get data() {
      return data;
    },
    save,
    flush,
    reset,
    dispose,
    rating: () => (data.ratingCount ? data.ratingSum / data.ratingCount : 0),
  };
}
