// Markup of the shop pieces: every card kind renders, the tabs include trails and boards, legendary cards are marked,
// the look panel has its five slots, and shop-shine.css gates every loop it starts.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COSMETICS, COSMETIC_KINDS } from '@shared/cosmetics.js';
import { ItemCard, LookPanel, RarityBar } from './Shop.jsx';
import { rarityCounts } from './shopModel.js';

const html = (node) => renderToStaticMarkup(h(MemoryRouter, null, node)).replaceAll('<!-- -->', '');
const card = (item, over = {}) =>
  h(ItemCard, { item: { ...item, owned: false }, i: 0, equipped: {}, selected: false, coins: 99999, signedIn: true, offline: false, busy: false, buying: false, fresh: false, avatar: 2, preview: null, onSelect() {}, onBuy() {}, onEquip() {}, ...over });
const firstOf = (kind, rarity) => COSMETICS.find((c) => c.kind === kind && (!rarity || c.rarity === rarity));

describe('ItemCard', () => {
  it('renders every kind (voice included) without throwing', () => {
    for (const kind of COSMETIC_KINDS) {
      const out = html(h('ul', null, card(firstOf(kind), { preview: kind === 'voice' ? { playingId: null, toggle() {} } : null })));
      expect(out).toContain('xp-item');
      expect(out).toContain(firstOf(kind).name);
    }
  });
  it('renders owned and signed-out states for the new kinds', () => {
    for (const kind of ['trail', 'board']) {
      const item = firstOf(kind);
      expect(html(h('ul', null, card(item, { item: { ...item, owned: true } })))).toContain('Equip');
      expect(html(h('ul', null, card(item, { signedIn: false })))).toContain('Sign in to buy');
    }
  });
  it('legendary cards carry the rarity class, the badge, the glints and a gold Buy', () => {
    const item = firstOf('trail', 'legendary');
    const out = html(h('ul', null, card(item)));
    expect(out).toContain('xp-item--legendary');
    expect(out).toContain('xp-rarity--legendary');
    expect(out).toContain('Legendary');
    expect(out).toContain('xz-glints');
    expect(out).toContain('hub-btn--primary');
  });
  it('other rarities have no glints', () => {
    expect(html(h('ul', null, card(firstOf('trail', 'epic'))))).not.toContain('xz-glints');
  });
  it('a legendary dice card still renders its swatch', () => {
    expect(html(h('ul', null, card(firstOf('dice', 'legendary'))))).toContain('<svg');
  });
});

describe('LookPanel', () => {
  const props = { equipped: { frame: 'frame-lake', dice: 'dice-gold' }, selectedId: 'trail-flame', avatar: 1, name: 'Asha', onBrowse() {}, onClear() {} };
  it('shows all five slots with the selected item swapped in', () => {
    const out = html(h(LookPanel, props));
    for (const label of ['Avatar and frame', 'Title', 'Dice', 'Pawn trail', 'Board theme']) expect(out).toContain(label);
    expect(out).toContain('Dragon Flame');
    expect(out).toContain('Trying');
    expect(out).toContain('Hussain Sagar');
    expect(out).toContain('Solid Gold');
    expect(out).toContain('Show my current look');
  });
  it('every slot is a labelled button', () => {
    const out = html(h(LookPanel, { ...props, selectedId: null }));
    expect(out.match(/<button/g).length).toBe(5);
    expect(out).toContain('aria-label="Pawn trail: No trail. Browse trails"');
    expect(out).toContain('Tap an item to try it on');
  });
});

describe('RarityBar', () => {
  it('has a chip per rarity with counts and a labelled sort', () => {
    const out = html(h(RarityBar, { rarity: 'legendary', sort: 'rarity', counts: rarityCounts(COSMETICS.filter((c) => c.kind === 'dice')), onRarity() {}, onSort() {} }));
    for (const l of ['All', 'Common', 'Rare', 'Epic', 'Legendary']) expect(out).toContain(l);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('Sort');
    expect(out).toContain('Price: low to high');
  });
});

describe('tabs', () => {
  it('the catalogue drives a Trails and a Boards tab', () => {
    expect(COSMETIC_KINDS).toContain('trail');
    expect(COSMETIC_KINDS).toContain('board');
    const src = readFileSync(new URL('./Shop.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/trail: 'Trails'/);
    expect(src).toMatch(/board: 'Boards'/);
    expect(src).toMatch(/trail: 'pawn trail'/);
    expect(src).toMatch(/board: 'board theme'/);
    for (const k of COSMETIC_KINDS) expect(src).toMatch(new RegExp(`${k}: '`));
  });
});

describe('shop-shine.css', () => {
  const css = readFileSync(new URL('../styles/shop-shine.css', import.meta.url), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('stops everything decorative under all three motion switches', () => {
    expect(stripped).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stripped).toContain(":root[data-motion='reduced']");
    expect(stripped).toContain(":root[data-perf='low']");
  });
  it('every infinite loop lives in the motion-allowed block, behind the reduced and low-perf guards', () => {
    const at = stripped.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(at).toBeGreaterThan(-1);
    expect(stripped.slice(0, at)).not.toMatch(/infinite/);
    const block = stripped.slice(at);
    const rules = block.split('}').filter((r) => /animation:/.test(r));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toContain(":root:not([data-motion='reduced']):not([data-perf='low'])");
  });
  it('animates transform and opacity only', () => {
    const frames = [...stripped.matchAll(/@keyframes xz-[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity']).toContain(p);
    }
  });
  it('uses design tokens for colour (no raw hex besides the white sheen mix)', () => {
    const hex = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    expect(hex.filter((x) => !['#fff', '#000'].includes(x.toLowerCase()))).toEqual([]);
  });
});
