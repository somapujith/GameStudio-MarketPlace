import { describe, expect, it } from 'vitest';
import { COSMETICS, COSMETIC_KINDS, RARITIES } from '@shared/cosmetics.js';
import {
  RARITY_FILTERS,
  SORTS,
  lookSlots,
  parseKind,
  parseRarity,
  parseSort,
  rarityCounts,
  rarityFilter,
  shopList,
  shopQuery,
  sortItems,
  vaultCount,
  vaultItems,
  vaultVisible,
  viewFilter,
} from './shopModel.js';

const mk = (id, kind, rarity, price, owned = false) => ({ id, kind, rarity, price, owned });
const SAMPLE = [mk('a', 'dice', 'common', 400), mk('b', 'dice', 'legendary', 6500), mk('c', 'dice', 'rare', 900, true), mk('d', 'dice', 'epic', 900), mk('e', 'dice', 'legendary', 5000, true), mk('f', 'frame', 'rare', 100)];
const ALL = COSMETICS.map((c) => ({ ...c, owned: c.price === 0 }));

describe('url params', () => {
  it('validates kind, rarity and sort with safe defaults', () => {
    expect(parseKind('trail')).toBe('trail');
    expect(parseKind('board')).toBe('board');
    expect(parseKind('nope')).toBe('frame');
    expect(parseKind(null)).toBe('frame');
    expect(parseRarity('legendary')).toBe('legendary');
    expect(parseRarity('mythic')).toBe('all');
    expect(parseSort('price-desc')).toBe('price-desc');
    expect(parseSort('<script>')).toBe('featured');
  });
  it('omits defaults from the query', () => {
    expect(shopQuery({ kind: 'frame', rarity: 'all', sort: 'featured' })).toEqual({});
    expect(shopQuery({})).toEqual({});
    expect(shopQuery({ kind: 'trail', rarity: 'epic', sort: 'rarity' })).toEqual({ kind: 'trail', rarity: 'epic', sort: 'rarity' });
    expect(shopQuery({ kind: 'bogus', rarity: 'bogus', sort: 'bogus' })).toEqual({});
  });
  it('every rarity has a chip and the chips start at All', () => {
    expect(RARITY_FILTERS).toEqual(['all', ...RARITIES]);
    expect(SORTS.map((s) => s.id)).toEqual(['featured', 'price-asc', 'price-desc', 'rarity']);
  });
});

describe('sortItems', () => {
  const ids = (l) => l.map((x) => x.id);
  it('featured puts legendary first and keeps catalogue order otherwise', () => {
    expect(ids(sortItems(SAMPLE, 'featured'))).toEqual(['b', 'e', 'a', 'c', 'd', 'f']);
  });
  it('price sorts are stable on ties', () => {
    expect(ids(sortItems(SAMPLE, 'price-asc'))).toEqual(['f', 'a', 'c', 'd', 'e', 'b']);
    expect(ids(sortItems(SAMPLE, 'price-desc'))).toEqual(['b', 'e', 'c', 'd', 'a', 'f']);
  });
  it('rarity sorts legendary to common, cheaper first inside a tier, stable', () => {
    expect(ids(sortItems(SAMPLE, 'rarity'))).toEqual(['e', 'b', 'd', 'f', 'c', 'a']);
  });
  it('does not mutate and tolerates junk', () => {
    const copy = [...SAMPLE];
    sortItems(SAMPLE, 'price-desc');
    expect(SAMPLE).toEqual(copy);
    expect(sortItems(null)).toEqual([]);
    expect(ids(sortItems(SAMPLE, 'nonsense'))).toEqual(ids(sortItems(SAMPLE, 'featured')));
  });
  it('owned items do not sink in any sort', () => {
    expect(sortItems(SAMPLE, 'featured').findIndex((x) => x.id === 'e')).toBe(1);
  });
});

describe('filters', () => {
  it('rarityFilter keeps one tier or everything', () => {
    expect(rarityFilter(SAMPLE, 'legendary').map((x) => x.id)).toEqual(['b', 'e']);
    expect(rarityFilter(SAMPLE, 'all')).toBe(SAMPLE);
    expect(rarityFilter(SAMPLE, 'bogus')).toBe(SAMPLE);
  });
  it('rarityCounts counts every chip', () => {
    expect(rarityCounts(SAMPLE)).toEqual({ all: 6, common: 1, rare: 2, epic: 1, legendary: 2 });
  });
  it('viewFilter: owned / afford / all', () => {
    expect(viewFilter(SAMPLE, 'owned', 0).map((x) => x.id)).toEqual(['c', 'e']);
    expect(viewFilter(SAMPLE, 'afford', 1000).map((x) => x.id)).toEqual(['a', 'd', 'f']);
    expect(viewFilter(SAMPLE, 'afford', null)).toEqual([]);
    expect(viewFilter(SAMPLE, 'all', null)).toBe(SAMPLE);
  });
  it('shopList: kind, view, rarity and sort together; chip counts ignore the rarity chip but follow the view', () => {
    const r = shopList(SAMPLE, { kind: 'dice', view: 'all', rarity: 'legendary', sort: 'price-asc' });
    expect(r.shown.map((x) => x.id)).toEqual(['e', 'b']);
    expect(r.counts.all).toBe(5);
    const own = shopList(SAMPLE, { kind: 'dice', view: 'owned', rarity: 'all' });
    expect(own.shown.map((x) => x.id)).toEqual(['e', 'c']); // featured: legendary first
    expect(own.counts).toEqual({ all: 2, common: 0, rare: 1, epic: 0, legendary: 1 });
  });
  it('covers every kind of the real catalogue', () => {
    for (const k of COSMETIC_KINDS) {
      const r = shopList(ALL, { kind: k });
      expect(r.shown.length).toBe(ALL.filter((x) => x.kind === k).length);
    }
  });
});

describe('legendary vault', () => {
  it('selects legendary items of every buyable kind, never voice lines', () => {
    const v = vaultItems(ALL);
    expect(v.length).toBeGreaterThanOrEqual(11);
    expect(v.every((x) => x.rarity === 'legendary' && x.kind !== 'voice')).toBe(true);
    expect(new Set(v.map((x) => x.kind))).toEqual(new Set(['frame', 'dice', 'trail', 'board', 'title']));
    expect(vaultItems(null)).toEqual([]);
  });
  it('counts owned of total', () => {
    expect(vaultCount(SAMPLE)).toEqual({ owned: 1, total: 2 });
    expect(vaultCount([])).toEqual({ owned: 0, total: 0 });
  });
  it('shows only on the plain All view of a buyable tab', () => {
    expect(vaultVisible({ kind: 'frame', view: 'all', rarity: 'all' })).toBe(true);
    expect(vaultVisible({ kind: 'trail' })).toBe(true);
    expect(vaultVisible({ kind: 'voice', view: 'all', rarity: 'all' })).toBe(false);
    expect(vaultVisible({ kind: 'frame', view: 'owned', rarity: 'all' })).toBe(false);
    expect(vaultVisible({ kind: 'frame', view: 'afford', rarity: 'all' })).toBe(false);
    expect(vaultVisible({ kind: 'frame', view: 'all', rarity: 'epic' })).toBe(false);
  });
});

describe('lookSlots', () => {
  it('lists the five equippable slots in order', () => {
    expect(lookSlots({}, null).map((s) => s.kind)).toEqual(['frame', 'title', 'dice', 'trail', 'board']);
    expect(lookSlots({}, null).every((s) => s.item === null && !s.trying)).toBe(true);
  });
  it('shows what is equipped and swaps the selected item into its own slot', () => {
    const eq = { frame: 'frame-lake', trail: 'trail-dust' };
    const s = lookSlots(eq, 'trail-flame');
    expect(s.find((x) => x.kind === 'frame')).toMatchObject({ id: 'frame-lake', trying: false });
    expect(s.find((x) => x.kind === 'trail')).toMatchObject({ id: 'trail-flame', trying: true });
    expect(s.find((x) => x.kind === 'board').item).toBeNull();
  });
  it('selecting what is already worn is not a try-on; voice and unknown ids never trigger one', () => {
    expect(lookSlots({ board: 'board-lake' }, 'board-lake').find((x) => x.kind === 'board').trying).toBe(false);
    expect(lookSlots({}, 'voice-old-man').some((x) => x.trying)).toBe(false);
    expect(lookSlots({}, 'nope').some((x) => x.trying)).toBe(false);
  });
});
