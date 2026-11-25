import { describe, expect, it } from 'vitest';
import {
  BANNERS,
  BODY_COLORS,
  BUMPERS,
  CURTAINS,
  DASH_TOYS,
  DEFAULT_LOADOUT,
  ENGINE_COVERS,
  FINISHES,
  HEADLIGHTS,
  MUDFLAPS,
  MUDFLAP_STYLES,
  OPTIONS,
  PLATE_STYLES,
  ROOF_COLORS,
  ROOF_STYLES,
  SEATS,
  STRIPES,
  TAILLIGHTS,
  TINTS,
  UNDERGLOW,
  WHEELS,
  WINDOW_FRAMES,
  getPath,
  withPath,
} from '../gameplay/catalog.js';
import {
  FIELDS,
  GLOW_MAX,
  diffLoadout,
  estimateWidthEm,
  finishParams,
  fitBadge,
  fitBanner,
  fitMudflap,
  fitRearWindow,
  fitText,
  fontFamilyFor,
  formatPlate,
  hsl,
  isTelugu,
  mudflapText,
  plateFontPx,
  resolveLook,
  splitLines,
  tintSpec,
  underglowRgb,
  windowLetterColors,
} from './custom-logic.js';

describe('FIELDS / diffLoadout', () => {
  it('covers every catalogue path and the free-text fields', () => {
    for (const path of Object.keys(OPTIONS)) expect(FIELDS, path).toContain(path);
    for (const p of ['plate.text', 'decals.banner', 'decals.rearWindow', 'decals.badge', 'interior.garland', 'rear.ladder', 'rear.antenna', 'rear.sideGuards']) {
      expect(FIELDS).toContain(p);
    }
  });
  it('null previous means everything, identical means nothing', () => {
    expect(diffLoadout(null, DEFAULT_LOADOUT)).toEqual(FIELDS);
    expect(diffLoadout(DEFAULT_LOADOUT, DEFAULT_LOADOUT)).toEqual([]);
    expect(diffLoadout(undefined, undefined)).toEqual(FIELDS);
  });
  it('reports exactly the changed fields', () => {
    let b = withPath(DEFAULT_LOADOUT, 'paint.body', BODY_COLORS[3].id);
    expect(diffLoadout(DEFAULT_LOADOUT, b)).toEqual(['paint.body']);
    b = withPath(b, 'lights.under', 'cyan');
    b = withPath(b, 'rear.ladder', true);
    b = withPath(b, 'decals.rearWindow', 'BADSHAH');
    expect(diffLoadout(DEFAULT_LOADOUT, b).sort()).toEqual(['decals.rearWindow', 'lights.under', 'paint.body', 'rear.ladder']);
  });
  it('normalises junk on both sides instead of throwing', () => {
    expect(diffLoadout({ paint: { body: 'nope' } }, {})).toEqual([]);
    expect(diffLoadout('garbage', 42)).toEqual([]);
    expect(diffLoadout(null, { horn: 'unknown-horn' })).toEqual(FIELDS);
  });
  it('detects a one-field change for every option of every list', () => {
    for (const [path, list] of Object.entries(OPTIONS)) {
      for (const item of list) {
        const next = withPath(DEFAULT_LOADOUT, path, item.id);
        const d = diffLoadout(DEFAULT_LOADOUT, next);
        if (getPath(DEFAULT_LOADOUT, path) === item.id) expect(d, `${path}=${item.id}`).toEqual([]);
        else expect(d, `${path}=${item.id}`).toEqual([path]);
      }
    }
  });
});

describe('resolveLook', () => {
  it('resolves every catalogue id to its own entry', () => {
    const cases = [
      ['paint.body', BODY_COLORS, 'body'], ['paint.roof', ROOF_COLORS, 'roof'], ['paint.finish', FINISHES, 'finish'],
      ['plate.style', PLATE_STYLES, 'plateStyle'], ['lights.head', HEADLIGHTS, 'head'], ['lights.under', UNDERGLOW, 'under'],
      ['lights.tail', TAILLIGHTS, 'tail'], ['roofStyle', ROOF_STYLES, 'roofStyle'], ['curtains', CURTAINS, 'curtain'],
      ['decals.stripe', STRIPES, 'stripe'], ['decals.mudflap', MUDFLAPS, 'mudflap'], ['decals.dash', DASH_TOYS, 'toy'],
      ['wheels', WHEELS, 'wheel'], ['interior.seats', SEATS, 'seat'], ['tint', TINTS, 'tint'],
      ['decals.rearWindowFrame', WINDOW_FRAMES, 'frame'], ['rear.cover', ENGINE_COVERS, 'cover'], ['rear.bumper', BUMPERS, 'bumper'],
      ['rear.flaps', MUDFLAP_STYLES, 'flaps'],
    ];
    for (const [path, list, key] of cases) {
      for (const item of list) expect(resolveLook(withPath(DEFAULT_LOADOUT, path, item.id))[key].id, `${path}=${item.id}`).toBe(item.id);
    }
  });
  it('falls back to stock on junk', () => {
    for (const bad of [null, undefined, 7, 'x', { paint: { body: 'zzz' }, horn: {} }, { tint: 99 }]) {
      const l = resolveLook(bad);
      expect(l.body.id).toBe(BODY_COLORS[0].id);
      expect(l.finish.id).toBe('gloss');
      expect(l.tint.id).toBe(0);
    }
  });
});

describe('finish / tint / underglow', () => {
  it('maps every finish and falls back to gloss', () => {
    for (const f of FINISHES) {
      const p = finishParams(f.id);
      expect(p.roughness).toBe(f.roughness);
      expect(p.metalness).toBe(f.metalness);
      expect(p.clearcoat).toBe(f.clearcoat);
      expect(p.envK).toBeGreaterThan(0);
      expect(p.sheen).toBe(!!f.sheen);
    }
    expect(finishParams('nope').id).toBe('gloss');
    expect(finishParams('pearl').iridescence).toBeGreaterThan(0);
    expect(finishParams('gloss').iridescence).toBe(0);
  });
  it('tint gets darker with the level and clamps', () => {
    const ops = [0, 1, 2, 3].map((l) => tintSpec(l).opacity);
    expect([...ops].sort((a, b) => a - b)).toEqual(ops);
    expect(tintSpec(-4).level).toBe(0);
    expect(tintSpec(99).level).toBe(3);
    expect(tintSpec('x').level).toBe(0);
  });
  it('underglow colour: off is null, rainbow cycles, all channels in range', () => {
    expect(underglowRgb(UNDERGLOW[0])).toBeNull();
    expect(underglowRgb(null)).toBeNull();
    for (const u of UNDERGLOW.slice(1)) {
      const c = underglowRgb(u, 3);
      expect(c).toHaveLength(3);
      for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
    }
    const rb = UNDERGLOW.find((u) => u.cycle);
    expect(underglowRgb(rb, 0)).not.toEqual(underglowRgb(rb, 2));
    expect(GLOW_MAX).toBeLessThanOrEqual(1.3);
  });
  it('hsl wraps and stays in range', () => {
    expect(hsl(0)).toEqual(hsl(1));
    for (const h of [-0.3, 0.1, 0.5, 2.7]) for (const v of hsl(h)) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe('text helpers', () => {
  it('detects Telugu and picks the font', () => {
    expect(isTelugu('జై హనుమాన్')).toBe(true);
    expect(isTelugu('JAI BALAYYA')).toBe(false);
    expect(fontFamilyFor('జై')).toContain('Noto Sans Telugu');
    expect(fontFamilyFor('HORN')).toContain('Bricolage');
  });
  it('estimates width monotonically', () => {
    expect(estimateWidthEm('')).toBe(0);
    expect(estimateWidthEm('HORN OK PLEASE')).toBeGreaterThan(estimateWidthEm('HORN'));
    expect(estimateWidthEm('జై హనుమాన్')).toBeGreaterThan(0);
  });
  it('splits into balanced lines at spaces', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('BADSHAH')).toEqual(['BADSHAH']);
    const two = splitLines('BURI NAZAR WAALE TERA MUH KAALA', 2);
    expect(two).toHaveLength(2);
    expect(two.join(' ')).toBe('BURI NAZAR WAALE TERA MUH KAALA');
    expect(splitLines('A B C D E F', 3).join(' ')).toBe('A B C D E F');
    expect(splitLines('A B', 1)).toEqual(['A B']);
  });
  it('fitText: width-limited, height-limited, shrinks for long text, one line when it is big enough', () => {
    const measure = (s, px) => s.length * px * 0.6;
    const a = fitText('HELLO', { maxW: 300, maxH: 400, measure });
    expect(a.fontPx).toBeCloseTo(100, 0); // 300 / (5 * 0.6)
    const b = fitText('HELLO', { maxW: 300, maxH: 40, measure });
    expect(b.fontPx).toBeLessThanOrEqual(40 / 1.12 + 0.1);
    const long = fitText('HELLO HELLO HELLO HELLO', { maxW: 300, maxH: 400, measure });
    expect(long.fontPx).toBeLessThan(a.fontPx);
    const two = fitText('HELLO HELLO HELLO HELLO', { maxW: 300, maxH: 400, maxLines: 2, minSingle: 1000, measure });
    expect(two.lines).toHaveLength(2);
    expect(two.fontPx).toBeGreaterThan(long.fontPx);
    expect(fitText('', { maxW: 10, maxH: 10 }).lines).toEqual([]);
    expect(fitText('X', { maxW: 0, maxH: 0, minPx: 9 }).fontPx).toBe(9);
  });
  it('plate text is upper-cased, cleaned, falls back to the stock plate', () => {
    expect(formatPlate('ts 09  ab-12!')).toBe('TS 09 AB-12');
    expect(formatPlate('')).toBe(DEFAULT_LOADOUT.plate.text);
    expect(formatPlate(null)).toBeTruthy();
    expect(formatPlate('A'.repeat(40)).length).toBeLessThanOrEqual(12);
    expect(formatPlate(DEFAULT_LOADOUT.plate.text)).toBe(DEFAULT_LOADOUT.plate.text);
  });
  it('plate font fits the plate', () => {
    const px = plateFontPx('TS09 EZ4040', 256, 80, 22);
    expect(px).toBeGreaterThan(8);
    expect(px).toBeLessThanOrEqual(80 * 0.62);
    expect(plateFontPx('AB', 256, 80)).toBeGreaterThan(plateFontPx('TS09 EZ4040', 256, 80));
  });
  it('banners fit for every preset, Telugu or Latin, and for junk', () => {
    for (const b of BANNERS) {
      const r = fitBanner(b.id, 512, 110);
      expect(r.fontPx).toBeGreaterThan(9);
      expect(r.fontPx).toBeLessThanOrEqual(110);
      expect(r.text).toBe(b.id);
    }
    expect(fitBanner('జై హనుమాన్', 512, 110).font).toContain('Telugu');
    expect(fitBanner('', 512, 110).text.length).toBeGreaterThan(0);
    expect(fitBanner('A'.repeat(22), 512, 110).fontPx).toBeLessThan(fitBanner('AB', 512, 110).fontPx);
  });
  it('mud-flap text never needs more than two lines', () => {
    for (const m of MUDFLAPS) {
      const r = fitMudflap(m.text, 512, 154);
      expect(r.lines.length).toBeLessThanOrEqual(2);
      expect(r.lines.length === 0).toBe(!m.text);
      expect(mudflapText(m.id)).toBe(m.text);
    }
    expect(mudflapText('nope')).toBe('');
  });
  it('rear window lettering: 1-2 lines, long text shrinks', () => {
    const short = fitRearWindow('BADSHAH', 512, 307);
    const long = fitRearWindow('DUBAI WHITE HOUSE', 512, 307);
    expect(short.lines).toHaveLength(1);
    expect(long.lines.length).toBeLessThanOrEqual(2);
    expect(long.fontPx).toBeGreaterThan(10);
    expect(fitRearWindow('', 512, 307).lines.length).toBeGreaterThan(0);
  });
  it('badge keeps 2-4 clean characters', () => {
    expect(fitBadge('ha', 200, 80).text).toBe('HA');
    expect(fitBadge('abcdefg', 200, 80).text).toBe('ABCD');
    expect(fitBadge('!!', 200, 80).text).toBe('HA');
    expect(fitBadge('A&B', 200, 80).fontPx).toBeGreaterThan(8);
  });
  it('sticker letter colours contrast with the frame', () => {
    expect(windowLetterColors('white', '#ffffff').fill).not.toBe('#ffffff');
    for (const f of WINDOW_FRAMES.slice(1)) expect(windowLetterColors(f.id, f.hex)).toEqual({ fill: '#ffffff', stroke: f.hex });
  });
});
