import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COSMETICS } from '@shared/cosmetics.js';
import { DiceSwatch } from './DiceSwatch.jsx';

const html = (props) => renderToString(h(DiceSwatch, props));
const dice = COSMETICS.filter((c) => c.kind === 'dice');
const ids = (s) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const anon = (s) => s.replace(/ds[a-zA-Z0-9]+/g, 'ID');

describe('DiceSwatch', () => {
  it('renders a root <svg> with gradients for every dice skin, as an id or an item', () => {
    for (const item of dice) {
      for (const skin of [item.id, item]) {
        const s = html({ skin });
        expect(s.startsWith('<svg'), item.id).toBe(true);
        expect(s).toContain('<linearGradient');
        expect(s).toContain('<polygon');
      }
    }
    expect(html({ skin: 'cyber' })).toContain('<svg');
    expect(html({ skin: 'gold' })).toContain('<svg');
  });

  it('falls back to ivory for unknown ids and other kinds', () => {
    const ivory = anon(html({ skin: 'dice-ivory' }));
    for (const skin of ['nope', undefined, 'frame-silver']) expect(anon(html({ skin }))).toBe(ivory);
  });

  it('keeps unique, plain-alphanumeric gradient ids per instance, so two swatches never clash', () => {
    const both = renderToString(h('div', null, h(DiceSwatch, { skin: 'dice-gold' }), h(DiceSwatch, { skin: 'dice-gold' })));
    const all = ids(both);
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^ds[a-zA-Z0-9]+$/);
  });

  it('uses no SVG filters or masks (many swatches render at once)', () => {
    for (const item of dice) expect(html({ skin: item.id })).not.toMatch(/<filter|feGaussian|<mask/);
  });

  it('keeps size, className, face and the aria behaviour', () => {
    const decorative = html({ skin: 'dice-ruby', size: 48, className: 'x' });
    expect(decorative).toContain('width="48"');
    expect(decorative).toContain('class="x"');
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role=');
    const named = html({ skin: 'dice-ruby', title: 'Ruby Gem' });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Ruby Gem"');
    expect(named).toContain('<title>Ruby Gem</title>');
    expect(anon(html({ skin: 'dice-ivory', face: 1 }))).not.toBe(anon(html({ skin: 'dice-ivory', face: 6 })));
  });

  it('draws a different material per finish', () => {
    const finished = dice.filter((c) => c.finish).map((c) => anon(html({ skin: c.id })));
    expect(new Set(finished).size).toBe(finished.length);
  });

  it('sweeps and sparkles only when asked to shine AND legendary', () => {
    for (const item of dice) {
      const on = html({ skin: item.id, shine: true });
      expect(html({ skin: item.id })).not.toContain('dsw-');
      if (item.rarity === 'legendary') {
        expect(on).toContain('dsw-sweep');
        expect(on).toContain('dsw-star');
      } else {
        expect(on).not.toContain('dsw-');
      }
    }
  });
});
