import { createElement as h, Fragment } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import TrailPreview from './TrailPreview.jsx';

const trails = COSMETICS.filter((c) => c.kind === 'trail');
const css = readFileSync(new URL('../../styles/trails.css', import.meta.url), 'utf8');
const ids = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe('TrailPreview', () => {
  it('covers every trail finish in the catalogue', () => {
    expect(trails.map((t) => t.finish).sort()).toEqual([...FINISHES.trail].sort());
  });

  it.each(trails.map((t) => [t.finish, t]))('renders an svg scene for %s in the item colours', (_f, item) => {
    const html = renderToString(h(TrailPreview, { item, size: 72 }));
    expect(html).toMatch(/^<svg/);
    expect(html).toContain('viewBox="0 0 64 64"');
    expect(html).toContain('width="72"');
    expect(html).toContain(`data-finish="${item.finish}"`);
    expect(html).toContain(`aria-label="${item.name}"`);
    expect(html).toContain('trp-puck');
    expect(html).toMatch(/trp-(p|line)/);
    expect(html.toLowerCase()).toContain(item.colors[0].toLowerCase());
    expect(html).not.toContain('<filter');
    expect(html).not.toContain('filter=');
  });

  it('gives each instance unique gradient ids that its fills point at', () => {
    const [a, b] = [trails[0], trails[0]];
    const html = renderToString(h(Fragment, null, h(TrailPreview, { item: a }), h(TrailPreview, { item: b })));
    const all = ids(html);
    expect(all.length).toBeGreaterThan(8);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((id) => id.startsWith('tp'))).toBe(true);
    expect(all.some((id) => /[:\s]/.test(id))).toBe(false);
    for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) expect(all).toContain(ref);
  });

  it('falls back to a plain scene without an item', () => {
    const html = renderToString(h(TrailPreview, {}));
    expect(html).toMatch(/^<svg/);
    expect(html).toContain('aria-label="Trail"');
  });

  it('draws a still frame by default: the puck rests at the end of its lane', () => {
    expect(css).toMatch(/\.trp-puck \{ transform: translateX\(28px\); \}/);
    expect(css).toMatch(/\.trp-line \{ transform-origin: 0 50%; transform: scaleX\(0\.9\); \}/);
  });

  it('has an animation for every finish', () => {
    for (const f of FINISHES.trail) {
      if (f === 'streak') continue; // lines, not particles: trp-draw
      expect(css).toContain(`.trp[data-finish='${f}'] .trp-p`);
    }
    expect(css).toContain('@keyframes trp-draw');
  });
});
