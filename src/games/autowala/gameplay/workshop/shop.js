// The garage's shop rules, pure (no three.js, no DOM). `quote` prices a change from the catalogue rules, `buy` charges the wallet
// and fits the part, `previewLoadout` builds a look without charging. UI and 3D code call these; nothing here knows about either.
//
// A "path" names what is being changed:
//   a catalogue path   'paint.body', 'horn', 'lights.head', 'wheels', 'tint', ... (see OPTIONS in catalog.js)
//   TEXT paths         'plate.text' (PLATE_TEXT_PRICE per change), 'decals.badge' (BADGE_PRICE per change), and the two lettering
//                      boards 'decals.banner' / 'decals.rearWindow': a preset (its own price) or custom text (BANNER_CUSTOM_PRICE)
//   TOGGLE paths       'interior.garland' and the ACCESSORIES ('rear.ladder' ...): true costs once then stays owned, false is free
//   'upgrade.<key>'    performance: value is the target level, bought one level at a time
import {
  ACCESSORIES, BADGE_PRICE, BANNERS, BANNER_CUSTOM_PRICE, DEFAULT_LOADOUT, GARLAND_PRICE, MAX_UPGRADE, OPTIONS, PLATE_TEXT_PRICE,
  REAR_WINDOW_TEXTS, UPGRADES, find, getPath, sanitizeBadge, sanitizeBanner, sanitizePlate, withPath,
} from '../catalog.js';
import { CAR } from '../../game/config.js';
import { createVehicle } from '../../sim/vehicle.js';

export const fmtRs = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (reason, message, extra = {}) => ({ ok: false, price: 0, free: false, reason, message, ...extra });

/** Free-text paths. `presets` are catalogue boards whose text may be picked at their own price; anything else is custom text. */
export const TEXT_PATHS = {
  'plate.text': { kind: 'plate-text', clean: sanitizePlate, price: PLATE_TEXT_PRICE, presets: null, stock: DEFAULT_LOADOUT.plate.text, empty: 'Type a plate number first', name: (t) => `Plate ${t}` },
  'decals.banner': { kind: 'banner', clean: sanitizeBanner, price: BANNER_CUSTOM_PRICE, presets: BANNERS, stock: null, empty: 'Type your banner text first', name: (t) => t },
  'decals.rearWindow': { kind: 'banner', clean: sanitizeBanner, price: BANNER_CUSTOM_PRICE, presets: REAR_WINDOW_TEXTS, stock: null, empty: 'Type your window lettering first', name: (t) => t },
  'decals.badge': { kind: 'badge', clean: sanitizeBadge, price: BADGE_PRICE, presets: null, stock: DEFAULT_LOADOUT.decals.badge, empty: 'Type 2 to 4 letters first', name: (t) => `Badge ${t}` },
};

/** Yes / no extras: the garland and every accessory. `price` is paid once, then the part is owned. */
export const TOGGLE_PATHS = {
  'interior.garland': { price: GARLAND_PRICE, on: 'Marigold garland', off: 'No garland', te: 'బంతి పూల మాల' },
  ...Object.fromEntries(Object.entries(ACCESSORIES).map(([path, a]) => [path, { price: a.price, on: a.label, off: `No ${a.label.toLowerCase()}`, te: a.te }])),
};

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Where ownership of a catalogue item is stored (the profile only keeps [\w.:-] keys, so presets use their index). */
export function ownedKey(path, value) {
  if (own(TEXT_PATHS, path)) {
    const presets = TEXT_PATHS[path].presets;
    const i = presets ? presets.findIndex((b) => b.id === value) : -1;
    return i >= 0 ? `${path}:preset-${i}` : null;
  }
  return `${path}:${value}`;
}

/** Validate a (path, value) pair. Returns { ok, kind, path, value, item?, name } or { ok:false, reason, message }. */
export function resolve(path, value) {
  if (typeof path !== 'string') return fail('unknown-path', 'Unknown part');
  if (own(TEXT_PATHS, path)) {
    const def = TEXT_PATHS[path];
    if (typeof value !== 'string') return fail('bad-text', 'That text is not valid');
    const text = def.clean(value);
    if (!text) return fail('empty-text', def.empty);
    const item = def.presets ? find(def.presets, text) : null;
    return { ok: true, kind: def.kind, path, value: text, item, name: def.name(text) };
  }
  if (own(TOGGLE_PATHS, path)) {
    if (typeof value !== 'boolean') return fail('unknown-item', 'Unknown option');
    const def = TOGGLE_PATHS[path];
    return { ok: true, kind: 'toggle', path, value, name: value ? def.on : def.off };
  }
  if (path.startsWith('upgrade.')) {
    const key = path.slice(8);
    const def = own(UPGRADES, key) ? UPGRADES[key] : null;
    if (!def) return fail('unknown-path', 'Unknown part');
    if (!Number.isInteger(value) || value < 0) return fail('unknown-item', 'Unknown level');
    return { ok: true, kind: 'upgrade', path, key, value, name: `${def.label} level ${value}` };
  }
  const list = own(OPTIONS, path) ? OPTIONS[path] : null;
  if (!list) return fail('unknown-path', 'Unknown part');
  const item = list.find((x) => x.id === value) || null;
  if (!item) return fail('unknown-item', 'Unknown option');
  return { ok: true, kind: 'item', path, value: item.id, item, name: item.name };
}

/**
 * What would changing `path` to `value` cost right now? `loadout` is the CURRENT look (usually profileData.loadout).
 * -> { ok, price, free, reason, message, installed, owned, name, value }
 * reason: 'installed' (already fitted) | 'stock' | 'owned' | 'paid', or on failure 'unknown-path' | 'unknown-item' | 'bad-text'
 * | 'empty-text' | 'max-level' | 'skip-level' | 'downgrade'.
 */
export function quote(profileData, loadout, path, value) {
  const r = resolve(path, value);
  if (!r.ok) return r;
  const owned = profileData?.owned || {};
  const out = (price, reason, extra = {}) => ({ ok: true, price, free: price === 0, reason, message: '', installed: false, owned: false, name: r.name, value: r.value, path, kind: r.kind, ...extra });

  if (r.kind === 'upgrade') {
    const def = UPGRADES[r.key];
    const cur = Math.max(0, Math.min(MAX_UPGRADE, Math.floor(Number(profileData?.upgrades?.[r.key]) || 0)));
    if (r.value > MAX_UPGRADE) return fail('max-level', `${def.label} is already maxed`, { level: cur });
    if (r.value <= cur) return out(0, 'installed', { installed: true, message: 'Already fitted', level: cur });
    if (r.value > cur + 1) return fail('skip-level', `Fit ${def.label} level ${cur + 1} first`, { level: cur });
    return out(def.prices[r.value], 'paid', { level: cur });
  }

  const current = loadout ? getPath(loadout, path) : undefined;
  // (the stock loadout stores the paint as a hex colour, so an item also counts as fitted when its hex matches)
  const same = current === r.value || (r.item?.hex && typeof current === 'string' && current.toLowerCase() === r.item.hex.toLowerCase());
  if (same) return out(0, 'installed', { installed: true, message: 'Already fitted' });

  if (own(TEXT_PATHS, path)) {
    const def = TEXT_PATHS[path];
    // (the catalogue's stock plate is 11 characters, one over PLATE_MAX, so compare with its sanitised form too)
    if (def.stock && (r.value === def.stock || r.value === def.clean(def.stock))) return out(0, 'stock');
    if (r.item) {
      if (r.item.price === 0) return out(0, 'stock');
      const k = ownedKey(path, r.value);
      return k && owned[k] ? out(0, 'owned', { owned: true }) : out(r.item.price, 'paid');
    }
    return out(def.price, 'paid');
  }
  if (r.kind === 'toggle') {
    if (r.value === false) return out(0, 'stock');
    return owned[ownedKey(path, 'on')] ? out(0, 'owned', { owned: true }) : out(TOGGLE_PATHS[path].price, 'paid');
  }
  // plain catalogue item
  if (r.item.price === 0) return out(0, 'stock');
  if (owned[ownedKey(path, r.value)]) return out(0, 'owned', { owned: true });
  return out(r.item.price, 'paid');
}

function writePath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** The loadout with one change applied (a copy; nothing is charged or saved). Invalid input returns a copy of `base`. */
export function previewLoadout(base, path, value) {
  const r = resolve(path, value);
  const out = clone(base);
  if (!r.ok || r.kind === 'upgrade') return out;
  return withPath(out, path, r.value);
}

/** Spend the money, fit the part, remember it, save, announce. Returns { ok, reason, price?, already? } and changes nothing on failure. */
export function buy(ctx, path, value) {
  const data = ctx?.profile?.data;
  if (!data || !ctx.economy) return { ok: false, reason: 'The garage is closed', code: 'closed' };
  const q = quote(data, data.loadout, path, value);
  if (!q.ok) return { ok: false, reason: q.message, code: q.reason };
  if (q.installed) return { ok: true, already: true, price: 0, reason: q.message, code: 'installed' };
  if (q.price > 0 && !ctx.economy.canAfford(q.price)) {
    return { ok: false, reason: `Not enough rupees (need ${fmtRs(q.price)})`, code: 'funds', short: q.price - ctx.economy.wallet };
  }
  if (q.price > 0 && !ctx.economy.spend(q.price, 'workshop')) return { ok: false, reason: 'Not enough rupees', code: 'funds' };

  // from here nothing can fail: the money is gone, so fit the part in the same breath
  if (q.kind === 'upgrade') {
    const key = path.slice(8);
    data.upgrades[key] = q.value;
    if (ctx.state?.upgrades && ctx.state.upgrades !== data.upgrades) ctx.state.upgrades[key] = q.value; // the live physics object
    data.owned[ownedKey(path, q.value)] = true;
  } else {
    writePath(data.loadout, path, q.value);
    // stock parts need no record; text is paid per change; the rest stay owned for good
    const k = q.kind === 'toggle' ? (q.value ? ownedKey(path, 'on') : null) : ownedKey(path, q.value); // text: only presets are remembered
    if (k && q.reason !== 'stock') data.owned[k] = true;
  }
  ctx.profile.save();

  const bill = q.price > 0 ? `  -${fmtRs(q.price)}` : '';
  if (q.kind === 'upgrade') {
    ctx.emit?.('workshop:upgrade', { key: path.slice(8), level: q.value, price: q.price, upgrades: { ...data.upgrades } });
    ctx.toast?.(`${UPGRADES[path.slice(8)].label} level ${q.value} fitted${bill}`, { tone: 'good' });
  } else {
    ctx.emit?.('loadout', { loadout: clone(data.loadout), preview: false });
    ctx.toast?.(`${q.price > 0 ? 'Installed' : 'Fitted'} ${q.name}${bill}`, { tone: 'good' });
  }
  ctx.emit?.('workshop:buy', { path, value: q.value, price: q.price });
  return { ok: true, price: q.price, name: q.name, code: 'bought' };
}

// ------------------------------------------------------------------------------------------------ performance stats
const params = createVehicle().params;
const STAT_DEFS = [
  { id: 'top', label: 'Top speed', unit: 'km/h', fmt: (v) => `${Math.round(v)}` },
  { id: 'accel', label: 'Acceleration', unit: 'm/s²', fmt: (v) => v.toFixed(1) },
  { id: 'grip', label: 'Grip', unit: '', fmt: (v) => v.toFixed(1) },
  { id: 'braking', label: 'Braking', unit: 'm/s²', fmt: (v) => v.toFixed(0) },
  { id: 'range', label: 'Range', unit: 'km', fmt: (v) => v.toFixed(1) },
  { id: 'boost', label: 'Boost', unit: 'x', fmt: (v) => v.toFixed(2) },
];

/** Raw numbers for a set of upgrade levels, computed from the same maths the physics uses (vehicle.params + the brake / turbo terms). */
export function rawStats(upgrades, paramsFn = params) {
  const u = upgrades || {};
  const P = paramsFn({ upgrades: u });
  return {
    top: P.top * 3.6,
    accel: P.accel,
    grip: P.grip,
    braking: CAR.brake * (1 + 0.14 * (u.brakes || 0)),
    range: P.tank / CAR.fuelUse / 1000,
    boost: 2.1 * (1 + 0.1 * (u.turbo || 0)) * (1 + 0.04 * (u.engine || 0)),
  };
}

/**
 * Bars for the stats panel: the current build and the build after buying `key` one level up (or null).
 * Each stat is [0..1] on a scale where stock is 0.25 and a fully upgraded auto is 1.
 */
export function statBars(upgrades, key = null, paramsFn = params) {
  const base = rawStats({}, paramsFn);
  const max = rawStats({ engine: MAX_UPGRADE, tyres: MAX_UPGRADE, brakes: MAX_UPGRADE, tank: MAX_UPGRADE, turbo: MAX_UPGRADE }, paramsFn);
  const cur = rawStats(upgrades, paramsFn);
  let next = null;
  if (key && UPGRADES[key] && (upgrades?.[key] || 0) < MAX_UPGRADE) next = rawStats({ ...upgrades, [key]: (upgrades?.[key] || 0) + 1 }, paramsFn);
  const frac = (id, v) => 0.25 + 0.75 * Math.max(0, Math.min(1, (v - base[id]) / ((max[id] - base[id]) || 1)));
  return STAT_DEFS.map((d) => ({
    id: d.id, label: d.label, unit: d.unit,
    value: cur[d.id], text: d.fmt(cur[d.id]), frac: frac(d.id, cur[d.id]),
    nextValue: next ? next[d.id] : null, nextText: next ? d.fmt(next[d.id]) : null, nextFrac: next ? frac(d.id, next[d.id]) : null,
  }));
}
