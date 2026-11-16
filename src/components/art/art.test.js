// Smoke tests for the art kit: every id / level / theme renders to SVG markup without throwing.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COSMETICS } from '@shared/cosmetics.js';
import { TILES } from '@shared/board.js';
import {
  PieceArt, PIECE_IDS, BuildingArt, THEMES, TileIcon, tileIconId, CardBack,
  AvatarFrame, DiceSwatch, TitleChip, CosmeticPreview, Avatar, frameInner,
} from './index.js';
import { TycoonCover, TycoonIcon } from './hub/index.js';

const html = (el) => renderToStaticMarkup(el);
const HUSTLE_IDS = ['start', 'luck', 'drama', 'auto', 'metro', 'mmts', 'traffic', 'chai', 'municipal', 'auction'];
const GROUP_IDS = ['bazaar', 'oldcity', 'everyday', 'twin', 'lake', 'luxury', 'cyber', 'newcity'];
const CLASSIC_IDS = ['property', 'plane', 'bulb', 'water', 'tax', 'kismet', 'jail', 'parking', 'gotojail'];

describe('PieceArt', () => {
  it('renders all six pieces, accessible only with a title', () => {
    expect(PIECE_IDS).toEqual(['pearl', 'auto', 'handi', 'chai', 'bat', 'camera']);
    const seen = new Set();
    for (const piece of PIECE_IDS) {
      const svg = html(h(PieceArt, { piece, color: '#4cc9f0', size: 24 }));
      expect(svg).toContain('<svg');
      expect(svg).toContain('aria-hidden="true"');
      seen.add(svg.replace(/id="[^"]*"|url\(#[^)]*\)/g, ''));
      const titled = html(h(PieceArt, { piece, color: '#ff4d6d', title: 'Asha' }));
      expect(titled).toContain('role="img"');
      expect(titled).toContain('<title>Asha</title>');
    }
    expect(seen.size).toBe(6);
  });
  it('falls back for unknown pieces / missing colour', () => {
    expect(html(h(PieceArt, { piece: 'nope', color: undefined }))).toContain('<svg');
  });
});

describe('BuildingArt', () => {
  it('renders every theme x level and the levels differ', () => {
    for (const theme of THEMES) {
      const out = [0, 1, 2].map((level) => html(h(BuildingArt, { theme, level, size: 48 })));
      out.forEach((s) => expect(s).toContain('<svg'));
      expect(new Set(out).size).toBe(3);
      expect(html(h(BuildingArt, { theme, level: 9, size: 48 }))).toBe(out[2]);
    }
  });
  it('keeps the classic colour/level signature and accepts a group id', () => {
    for (let level = 0; level <= 5; level++) expect(html(h(BuildingArt, { level, color: '#ff8a3d' }))).toContain('<svg');
    for (const group of GROUP_IDS) expect(html(h(BuildingArt, { group, level: 1, title: '' }))).toContain('role="img"');
    expect(html(h(BuildingArt, { group: 'everyday', level: 2, title: '' }))).toContain('Food Court');
  });
});

describe('TileIcon', () => {
  it('renders every id, and the new ids are distinct', () => {
    const out = new Map();
    for (const id of [...HUSTLE_IDS, ...GROUP_IDS, ...CLASSIC_IDS]) {
      const svg = html(h(TileIcon, { tile: id, size: 40 }));
      expect(svg).toContain('<svg');
      out.set(id, svg);
    }
    expect(new Set([...HUSTLE_IDS, ...GROUP_IDS].map((id) => out.get(id))).size).toBe(HUSTLE_IDS.length + GROUP_IDS.length);
  });
  it('resolves board tiles (current board and type-only fallbacks)', () => {
    for (const t of TILES) expect(html(h(TileIcon, { tile: t, size: 32 }))).toContain('<svg');
    expect(tileIconId({ type: 'card', deck: 'drama' })).toBe('drama');
    expect(tileIconId({ type: 'card', deck: 'luck', art: 'kismet' })).toBe('luck');
    expect(tileIconId({ type: 'kismet', deck: 'chest', art: 'kismet' })).toBe('khazana');
    expect(tileIconId({ type: 'transport', name: 'Auto Stand' })).toBe('auto');
    expect(tileIconId({ type: 'transport', name: 'MMTS Express' })).toBe('mmts');
    expect(tileIconId({ type: 'transport', name: 'Metro Interchange' })).toBe('metro');
    expect(tileIconId({ type: 'property', art: 'property', group: 'cyber' })).toBe('cyber');
    expect(tileIconId({ type: 'property', art: 'property', group: 'brown' })).toBe('property');
    expect(tileIconId({ type: 'municipal' })).toBe('municipal');
    expect(tileIconId({ type: 'start', art: 'start' })).toBe('start');
    expect(tileIconId(null)).toBe('property');
  });
});

describe('CardBack', () => {
  it('renders both decks at 5:7', () => {
    const l = html(h(CardBack, { deck: 'luck', size: 100 }));
    const d = html(h(CardBack, { deck: 'drama', size: 100 }));
    expect(l).toContain('height="140"');
    expect(l).not.toBe(d);
    expect(html(h(CardBack, { deck: 'drama', title: 'City Drama' }))).toContain('<title>City Drama</title>');
  });
});

describe('cosmetics', () => {
  it('previews every catalogue item', () => {
    for (const item of COSMETICS) {
      expect(html(h(CosmeticPreview, { item, size: 64 })).length).toBeGreaterThan(20);
      expect(html(h(CosmeticPreview, { item: item.id }))).not.toBe('');
    }
    expect(html(h(CosmeticPreview, { item: 'nope' }))).toBe('');
  });
  it('AvatarFrame wraps children, accepts short ids, and is transparent without a frame', () => {
    const child = h(Avatar, { preset: 1, size: 40 });
    const plain = html(child).replace(/id="[^"]*"|url\(#[^)]*\)|href="#[^"]*"/g, '');
    const strip = (s) => s.replace(/id="[^"]*"|url\(#[^)]*\)|href="#[^"]*"/g, '');
    expect(strip(html(h(AvatarFrame, { frame: null, size: 48 }, child)))).toBe(plain);
    expect(strip(html(h(AvatarFrame, { frame: 'frame-bogus', size: 48 }, child)))).toBe(plain);
    for (const f of ['sandstone', 'pearl', 'lake', 'nizam', 'frame-nizam', 'silver', 'emerald', 'obsidian', 'aurora', 'golconda']) {
      const s = html(h(AvatarFrame, { frame: f, size: 48 }, child));
      expect(s).toContain('data-frame="frame-');
      expect(strip(s)).toContain(plain);
    }
    for (const size of [22, 104]) {
      for (const f of COSMETICS.filter((c) => c.kind === 'frame')) expect(html(h(AvatarFrame, { frame: f, size }, child))).toContain(`data-frame="${f.id}"`);
    }
    const fn = html(h(AvatarFrame, { frame: 'lake', size: 50 }, (inner) => h('i', null, String(inner))));
    expect(fn).toContain('<i>' + frameInner(50) + '</i>');
  });
  it('DiceSwatch and TitleChip', () => {
    for (const skin of ['dice-ivory', 'cyber', 'dice-bangle', undefined]) expect(html(h(DiceSwatch, { skin, size: 32 }))).toContain('<svg');
    expect(html(h(TitleChip, { title: 'title-nawab' }))).toContain('Nawab of the City');
    expect(html(h(TitleChip, { title: 'chai' }))).toContain('Chai Connoisseur');
    const legendary = html(h(TitleChip, { title: 'title-kingpin' }));
    expect(legendary).toContain('data-rarity="legendary"');
    expect(legendary).toContain('data-chip-text=""');
    expect(legendary).toContain('cx-sheen');
    expect(html(h(TitleChip, { title: 'title-charminar' }))).toContain('data-rarity="epic"');
    expect(html(h(TitleChip, { title: 'frame-lake' }))).toBe('');
    expect(html(h(TitleChip, { title: undefined }))).toBe('');
  });
});

describe('hub cover', () => {
  it('renders the Tycoon cover and icon', () => {
    expect(html(h(TycoonCover, {}))).toContain('<svg');
    expect(html(h(TycoonCover, { title: 'Kingpin', animated: false }))).toContain('role="img"');
    expect(html(h(TycoonIcon, { size: 64, rounded: true }))).toContain('<svg');
  });
});
