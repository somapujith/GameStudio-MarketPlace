// Pure shop logic (no React): rarity filter, sort, the "Your look" loadout and the Legendary vault. The URL carries
// `?kind=`, `?rarity=` and `?sort=`; the defaults (frame / all / featured) are left out of it.
import { COSMETIC_KINDS, EQUIPPABLE_KINDS, RARITIES, cosmeticById, rarityRank } from '@shared/cosmetics.js';

export const DEFAULT_KIND = 'frame';
export const DEFAULT_RARITY = 'all';
export const DEFAULT_SORT = 'featured';

export const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
export const RARITY_FILTERS = ['all', ...RARITIES];
export const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'rarity', label: 'Rarity' },
];
export const VIEWS = ['all', 'owned', 'afford'];

export const parseKind = (v) => (COSMETIC_KINDS.includes(v) ? v : DEFAULT_KIND);
export const parseRarity = (v) => (RARITIES.includes(v) ? v : DEFAULT_RARITY);
export const parseSort = (v) => (SORTS.some((s) => s.id === v) ? v : DEFAULT_SORT);

/** `{ kind, rarity, sort }` -> the query object for the URL, defaults omitted (so the plain shop has a clean URL). */
export function shopQuery({ kind, rarity, sort } = {}) {
  const q = {};
  if (parseKind(kind) !== DEFAULT_KIND) q.kind = kind;
  if (parseRarity(rarity) !== DEFAULT_RARITY) q.rarity = rarity;
  if (parseSort(sort) !== DEFAULT_SORT) q.sort = sort;
  return q;
}

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** The "Owned" / "I can afford" view of the shop (`all` keeps everything). `balance` null = unknown, nothing is affordable. */
export function viewFilter(items, view, balance) {
  const list = Array.isArray(items) ? items : [];
  if (view === 'owned') return list.filter((x) => x.owned);
  if (view === 'afford') return list.filter((x) => !x.owned && Number.isFinite(balance) && balance >= x.price);
  return list;
}

/**
 * Stable sort (ties keep catalogue order) into a new array.
 *   featured    legendary first, everything else in catalogue order
 *   price-asc   cheapest first
 *   price-desc  dearest first
 *   rarity      legendary -> common, cheaper first inside a tier
 * Owned items are never pushed down here: only the "Owned" view separates them.
 */
export function sortItems(items, sort = DEFAULT_SORT) {
  const list = (Array.isArray(items) ? items : []).map((item, at) => ({ item, at }));
  const lead = (r) => (rarityRank(r) >= rarityRank('legendary') ? 0 : 1);
  const cmp = {
    featured: (a, b) => lead(a.item.rarity) - lead(b.item.rarity),
    'price-asc': (a, b) => num(a.item.price) - num(b.item.price),
    'price-desc': (a, b) => num(b.item.price) - num(a.item.price),
    rarity: (a, b) => rarityRank(b.item.rarity) - rarityRank(a.item.rarity) || num(a.item.price) - num(b.item.price),
  }[parseSort(sort)];
  return list.sort((a, b) => cmp(a, b) || a.at - b.at).map((x) => x.item);
}

/** Items of one rarity (`all` = every one). */
export const rarityFilter = (items, rarity) => (parseRarity(rarity) === 'all' || !Array.isArray(items) ? items || [] : items.filter((x) => x.rarity === rarity));

/** `{ all, common, rare, epic, legendary }` counts for the filter chips. */
export function rarityCounts(items) {
  const list = Array.isArray(items) ? items : [];
  const out = { all: list.length };
  for (const r of RARITIES) out[r] = list.filter((x) => x.rarity === r).length;
  return out;
}

/**
 * What the grid shows: the tab's kind, then the Owned / afford view, then the rarity chip, then the sort.
 * `counts` (for the chips) are taken after the view but before the rarity chip, so every chip's number is what it would show.
 */
export function shopList(items, { kind, view = 'all', rarity = 'all', sort = DEFAULT_SORT, balance = null } = {}) {
  const ofKind = (Array.isArray(items) ? items : []).filter((x) => x.kind === kind);
  const inView = viewFilter(ofKind, view, balance);
  return { ofKind, inView, counts: rarityCounts(inView), shown: sortItems(rarityFilter(inView, rarity), sort) };
}

/** Legendary items of every buyable kind (voice lines are not in the vault), in catalogue order. */
export const vaultItems = (items) => (Array.isArray(items) ? items : []).filter((x) => x.rarity === 'legendary' && x.kind !== 'voice');

/** `{ owned, total }` of the vault. */
export function vaultCount(items) {
  const v = vaultItems(items);
  return { owned: v.filter((x) => x.owned).length, total: v.length };
}

/** The vault is a browsing aid: only on the plain "All" view of a buyable tab with no rarity chip on. */
export const vaultVisible = ({ kind, view = 'all', rarity = 'all' } = {}) => kind !== 'voice' && view === 'all' && parseRarity(rarity) === 'all';

/** The loadout slots of "Your look", in display order. */
export const LOOK_SLOTS = Object.freeze(['frame', 'title', 'dice', 'trail', 'board']);

/**
 * What to draw in each slot: the equipped item with the selected (try-on) item swapped into its own kind.
 * -> [{ kind, id, item, trying }] where `item` is null for an empty slot and `trying` marks the swapped-in preview.
 */
export function lookSlots(equipped, selectedId) {
  const sel = selectedId ? cosmeticById(selectedId) : null;
  const eq = equipped && typeof equipped === 'object' ? equipped : {};
  return LOOK_SLOTS.filter((k) => EQUIPPABLE_KINDS.includes(k)).map((kind) => {
    const swap = sel && sel.kind === kind ? sel.id : null;
    const id = swap || eq[kind] || null;
    const item = id ? cosmeticById(id) : null;
    return { kind, id: item ? item.id : null, item, trying: !!swap && eq[kind] !== swap };
  });
}
