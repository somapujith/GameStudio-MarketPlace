import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import BoardThemePreview from './BoardThemePreview.jsx';

const boards = COSMETICS.filter((c) => c.kind === 'board');
const html = (el) => renderToStaticMarkup(el);
const idsOf = (markup) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refsOf = (markup) => [...markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

describe('BoardThemePreview', () => {
  it('has one board item per finish', () => {
    expect(boards.map((b) => b.finish).sort()).toEqual([...FINISHES.board].sort());
  });

  it('renders an <svg> for every board item, labelled with its name, at the requested size', () => {
    for (const item of boards) {
      const out = html(h(BoardThemePreview, { item, size: 96 }));
      expect(out, item.id).toContain('<svg');
      expect(out).toContain('width="96"');
      expect(out).toContain('viewBox="0 0 64 64"');
      expect(out).toContain(`aria-label="${item.name.replace(/&/g, '&amp;')}"`);
      // the three catalogue colours are all used
      for (const c of item.colors) expect(out.toLowerCase(), `${item.id} ${c}`).toContain(c.toLowerCase());
    }
  });

  it('defaults to 64 and still renders without an item', () => {
    expect(html(h(BoardThemePreview, { item: boards[0] }))).toContain('width="64"');
    const bare = html(h(BoardThemePreview, {}));
    expect(bare).toContain('<svg');
    expect(bare).toContain('Board theme');
  });

  it('uses unique, bp-prefixed ids across two instances and every url(#) resolves inside its own svg', () => {
    for (const item of boards) {
      const a = html(h(BoardThemePreview, { item }));
      const b = html(h('div', null, h(BoardThemePreview, { item }), h(BoardThemePreview, { item })));
      const ids = idsOf(a);
      expect(ids.length, item.id).toBeGreaterThan(0);
      for (const id of ids) expect(id.startsWith('bp'), id).toBe(true);
      for (const ref of refsOf(a)) expect(ids, `${item.id} -> ${ref}`).toContain(ref);
      // two instances rendered in one tree never share an id
      const all = idsOf(b);
      expect(new Set(all).size, item.id).toBe(all.length);
    }
  });

  it('uses no SVG filters (a shop grid renders dozens) and stays small', () => {
    for (const item of boards) {
      const out = html(h(BoardThemePreview, { item }));
      expect(out).not.toMatch(/<filter|filter=|feTurbulence|feGaussianBlur|<animate|<style/i);
      expect((out.match(/<[a-zA-Z]/g) || []).length, item.id).toBeLessThan(60);
    }
  });

  it('draws a different detail per finish', () => {
    const strip = (s) => s.replace(/\sid="[^"]*"/g, '').replace(/url\(#[^)]*\)/g, 'url()');
    const seen = new Set(boards.map((item) => strip(html(h(BoardThemePreview, { item })))));
    expect(seen.size).toBe(boards.length);
  });

  it('carries the per-finish detail: veins, ripples, patterns, a static glint', () => {
    const by = Object.fromEntries(boards.map((b) => [b.finish, html(h(BoardThemePreview, { item: b }))]));
    expect(by.marble).toContain('clip-path'); // veins clipped to the tiles
    expect(by.lake).toContain('<circle cx="32" cy="32" r="9.5"'); // ripples in the middle
    for (const f of ['bazaar', 'grid', 'emerald', 'goldleaf']) expect(by[f], f).toContain('<pattern');
    expect(by.goldleaf).toContain('fff2c0'); // the glint
    expect(by.obsidian).toContain('stroke-opacity=".85"'); // the gold inlay line
  });
});
