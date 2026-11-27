// The garage menu as data (categories -> sections -> rows), built from the catalogue so a new catalogue entry shows up by itself.
// Pure: the React menu renders it, the shop quotes it, the camera reads `view` from it.
import { ACCESSORIES, BADGE_MAX, BANNER_MAX, OPTIONS, PLATE_MAX, UPGRADES, getPath, sanitizeBadge } from '../catalog.js';
import { TEXT_PATHS, TOGGLE_PATHS, quote } from './shop.js';

/** Camera presets, as an angle relative to the auto's nose (0 = looking at the front, PI = rear), pitch, distance (m) and target height. */
export const VIEWS = {
  front: { az: 0.18, pitch: 0.14, dist: 6.2, ty: 0.9, fov: 46 },
  front34: { az: 0.7, pitch: 0.17, dist: 6.4, ty: 0.85, fov: 46 },
  rear: { az: Math.PI + 0.12, pitch: 0.1, dist: 3.7, ty: 0.85, fov: 44 },
  sideLow: { az: Math.PI / 2, pitch: 0.035, dist: 6.0, ty: 0.55, fov: 46 },
  high34: { az: -0.75, pitch: 0.5, dist: 7.4, ty: 0.9, fov: 46 },
  wide34: { az: 0.78, pitch: 0.2, dist: 8.6, ty: 0.9, fov: 48 },
  rear34: { az: Math.PI - 0.75, pitch: 0.22, dist: 7.2, ty: 0.95, fov: 46 },
  chase: { az: Math.PI, pitch: 0.36, dist: 7.8, ty: 1.2, fov: 62 }, // where the driving camera will pick up from
  cabin: { az: -2.3, pitch: 0.42, dist: 5.2, ty: 1.0, fov: 50 },
};

const item = (path, label) => ({ id: path, label, path, kind: 'list' });

export const CATEGORIES = [
  { id: 'performance', label: 'Performance', te: 'పనితీరు', view: 'front', blurb: 'Engine, tyres, brakes, tank and turbo.', sections: [{ id: 'perf', label: 'Performance', kind: 'upgrades' }] },
  {
    id: 'respray', label: 'Respray', te: 'రంగు వేయడం', view: 'wide34', blurb: 'Body, roof and finish.',
    sections: [{ ...item('paint.body', 'Body Colour'), kind: 'grid' }, { ...item('paint.roof', 'Roof Colour'), kind: 'grid' }, item('paint.finish', 'Finish')],
  },
  {
    id: 'plate', label: 'Number Plate', te: 'నంబర్ ప్లేట్', view: 'rear', blurb: 'Plate text and style.',
    sections: [{ id: 'plate.text', label: 'Plate Text', kind: 'text', path: 'plate.text' }, item('plate.style', 'Plate Style')],
  },
  { id: 'horn', label: 'Horn', te: 'హారన్', view: 'front34', blurb: 'Press play to hear one.', sections: [{ ...item('horn', 'Horn'), audio: true }] },
  {
    id: 'lights', label: 'Lights', te: 'లైట్లు', view: 'front34', blurb: 'Headlights, underglow and tail lights.',
    sections: [{ ...item('lights.head', 'Headlights'), kind: 'grid' }, { ...item('lights.under', 'Underglow'), kind: 'grid', view: 'sideLow' }, { ...item('lights.tail', 'Tail Lights'), kind: 'grid', view: 'rear' }],
  },
  { id: 'roof', label: 'Roof', te: 'పైకప్పు', view: 'high34', blurb: 'Toppers and canopies.', sections: [item('roofStyle', 'Roof')] },
  { id: 'curtains', label: 'Curtains', te: 'తెరలు', view: 'sideLow', blurb: 'The side curtains.', sections: [{ ...item('curtains', 'Curtains'), kind: 'grid' }] },
  {
    id: 'rear', label: 'Rear & Exterior', te: 'వెనుక భాగం', view: 'rear', blurb: 'Engine cover, bumper, window lettering, badge, extras.',
    sections: [
      item('rear.cover', 'Engine Cover'),
      item('rear.bumper', 'Bumper'),
      { id: 'decals.rearWindow', label: 'Rear-window Lettering', kind: 'text', path: 'decals.rearWindow' },
      { ...item('decals.rearWindowFrame', 'Lettering Frame'), kind: 'grid' },
      { id: 'decals.badge', label: 'Roof Badge', kind: 'text', path: 'decals.badge', view: 'rear34' },
      { id: 'rear.accessories', label: 'Accessories', kind: 'toggles', paths: Object.keys(ACCESSORIES), view: 'rear34' },
    ],
  },
  {
    id: 'decals', label: 'Decals', te: 'స్టిక్కర్లు', view: 'wide34', blurb: 'Stripes, banner, mud-flaps, dashboard toy.',
    sections: [
      { ...item('decals.stripe', 'Stripes'), view: 'sideLow' },
      { id: 'decals.banner', label: 'Roof Banner', kind: 'text', path: 'decals.banner', view: 'rear' },
      { ...item('decals.mudflap', 'Mud-flap Message'), view: 'rear' },
      { ...item('rear.flaps', 'Mud-flap Style'), view: 'rear' },
      { ...item('decals.dash', 'Dashboard Toy'), view: 'cabin' },
    ],
  },
  { id: 'wheels', label: 'Wheels', te: 'చక్రాలు', view: 'sideLow', blurb: 'Rims and tyres.', sections: [item('wheels', 'Wheels')] },
  { id: 'windows', label: 'Windows', te: 'కిటికీలు', view: 'front34', blurb: 'Windscreen tint.', sections: [item('tint', 'Window Tint')] },
  {
    id: 'interior', label: 'Interior', te: 'లోపలి భాగం', view: 'cabin', blurb: 'Seats and garland.',
    sections: [{ ...item('interior.seats', 'Seats'), kind: 'grid' }, { id: 'interior.garland', label: 'Garland', kind: 'toggles', paths: ['interior.garland'] }],
  },
];

/**
 * What the text fields let you type, as you type (the saved value is cleaned again by the shop). Plate letters, digits, space and
 * hyphen up to PLATE_MAX (the stock plate is 11 characters: a limit of 10 used to cut it on the first edit), badge letters, free text.
 */
const freeText = (max) => (s) => String(s).replace(/[\u0000-\u001f<>]/g, '').replace(/ {2,}/g, ' ').slice(0, max);
export const TYPED_TEXT = {
  'plate.text': (s) => String(s).toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/ {2,}/g, ' ').slice(0, PLATE_MAX),
  'decals.badge': (s) => sanitizeBadge(s),
  'decals.banner': freeText(BANNER_MAX),
  'decals.rearWindow': freeText(BANNER_MAX),
};

/**
 * A double click (or a held Enter) must not buy twice: true for the first press of a row, false for a repeat of the same row within
 * `ms` of the previous press (blocked presses count too, so a key held down stays blocked until it is let go).
 */
export function createRepeatGuard(ms = 450, now = () => Date.now()) {
  let last = -Infinity;
  let lastKey = '';
  return (key) => {
    const t = now();
    const repeat = key === lastKey && t - last < ms;
    lastKey = key;
    last = t;
    return !repeat;
  };
}

export const sectionView = (cat, sec) => sec?.view || cat?.view || 'wide34';

/** The rows of a section. Row types: 'item' (a catalogue entry), 'input' (free text), 'upgrade' (one performance part). */
export function sectionRows(sec) {
  if (sec.kind === 'upgrades') {
    return Object.entries(UPGRADES).map(([key, u]) => ({ type: 'upgrade', key, path: `upgrade.${key}`, name: u.label, te: u.te, blurb: u.blurb, prices: u.prices }));
  }
  if (sec.kind === 'text') {
    const def = TEXT_PATHS[sec.path];
    const plate = sec.path === 'plate.text';
    const badge = sec.path === 'decals.badge';
    const input = {
      type: 'input', path: sec.path, name: plate ? 'Plate text' : badge ? 'Badge letters' : 'Custom text',
      max: plate ? PLATE_MAX : badge ? BADGE_MAX : BANNER_MAX, price: def.price,
      hint: plate ? 'A-Z, 0-9, space, hyphen' : badge ? 'A-Z, 0-9, & or +' : 'Your own words, in any script', upper: plate || badge,
    };
    return [input, ...(def.presets || []).map((b) => ({ type: 'item', path: sec.path, value: b.id, name: b.name, te: b.te, price: b.price }))];
  }
  if (sec.kind === 'toggles') {
    return sec.paths.map((path) => ({ type: 'toggle', path, name: TOGGLE_PATHS[path].on, te: TOGGLE_PATHS[path].te, price: TOGGLE_PATHS[path].price }));
  }
  const list = OPTIONS[sec.path] || [];
  return list.map((o) => ({ type: 'item', path: sec.path, value: o.id, name: o.name, te: o.te, hex: o.hex ?? null, price: o.price, data: o }));
}

/**
 * How a row reads in the menu: the right-hand label and its tone.
 * -> { label, tone: 'installed'|'owned'|'free'|'price'|'max'|'locked', price, can, q }
 */
export function rowStatus(profileData, loadout, row, wallet = Infinity, typed) {
  if (row.type === 'upgrade') {
    const lvl = Math.max(0, Math.floor(Number(profileData?.upgrades?.[row.key]) || 0));
    if (lvl >= row.prices.length - 1) return { label: 'MAX', tone: 'max', price: 0, can: false, level: lvl };
    const price = row.prices[lvl + 1];
    return { label: `Rs ${price.toLocaleString('en-IN')}`, tone: price > wallet ? 'locked' : 'price', price, can: price <= wallet, level: lvl };
  }
  if (row.type === 'toggle') {
    if (getPath(loadout, row.path) === true) return { label: 'INSTALLED', tone: 'installed', price: 0, can: true, q: null };
    const q = quote(profileData, loadout, row.path, true);
    if (q.reason === 'owned') return { label: 'OWNED', tone: 'owned', price: 0, can: true, q };
    return { label: `Rs ${q.price.toLocaleString('en-IN')}`, tone: q.price > wallet ? 'locked' : 'price', price: q.price, can: q.price <= wallet, q };
  }
  if (row.type === 'input') {
    // the label follows what is typed: the stock plate is free, a banner preset has its own price, anything else costs the change fee
    const q = typeof typed === 'string' && typed ? quote(profileData, loadout, row.path, typed) : null;
    if (!q || !q.ok) return { label: `Rs ${row.price} / change`, tone: 'price', price: row.price, can: row.price <= wallet };
    if (q.installed) return { label: 'INSTALLED', tone: 'installed', price: 0, can: true, q };
    if (q.reason === 'owned') return { label: 'OWNED', tone: 'owned', price: 0, can: true, q };
    if (q.price === 0) return { label: 'FREE', tone: 'free', price: 0, can: true, q };
    return { label: `Rs ${q.price.toLocaleString('en-IN')}`, tone: q.price > wallet ? 'locked' : 'price', price: q.price, can: q.price <= wallet, q };
  }
  const q = quote(profileData, loadout, row.path, row.value);
  if (!q.ok) return { label: '-', tone: 'locked', price: 0, can: false, q };
  if (q.installed) return { label: 'INSTALLED', tone: 'installed', price: 0, can: true, q };
  if (q.reason === 'owned') return { label: 'OWNED', tone: 'owned', price: 0, can: true, q };
  if (q.price === 0) return { label: 'FREE', tone: 'free', price: 0, can: true, q };
  return { label: `Rs ${q.price.toLocaleString('en-IN')}`, tone: q.price > wallet ? 'locked' : 'price', price: q.price, can: q.price <= wallet, q };
}

/** The value a row would set the loadout to, for the live preview (null when the row is not previewable). */
export const rowValue = (row, loadout) => (row.type === 'item' ? row.value : row.type === 'toggle' ? !getPath(loadout, row.path) : null);
export const currentOf = (loadout, path) => getPath(loadout, path);
