// Avatar frames (silver, emerald, obsidian, aurora, diamond) and the legendary shine system.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import { AvatarFrame, TitleChip, CosmeticPreview, Avatar, resolveCosmetic } from './index.js';

const html = (el) => renderToStaticMarkup(el);
const frames = COSMETICS.filter((c) => c.kind === 'frame');
const idsIn = (s) => [...s.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const css = readFileSync(new URL('../../styles/cosmetics-shine.css', import.meta.url), 'utf8');

describe('new avatar frames', () => {
  it('every FINISHES.frame has a catalogue frame that renders its own art', () => {
    const plain = html(h(AvatarFrame, { frame: 'frame-sandstone', size: 64 }, h('i')));
    for (const finish of FINISHES.frame) {
      const item = frames.find((f) => f.finish === finish);
      expect(item, finish).toBeTruthy();
      const out = html(h(AvatarFrame, { frame: item, size: 64 }, h('i')));
      expect(out).toContain(`data-frame="${item.id}"`);
      expect(out).toContain('<svg');
      // not the sandstone fallback
      expect(out.replace(/id="[^"]*"|url\(#[^)]*\)|href="#[^"]*"|data-frame="[^"]*"/g, '')).not.toBe(
        plain.replace(/id="[^"]*"|url\(#[^)]*\)|href="#[^"]*"|data-frame="[^"]*"/g, ''),
      );
    }
  });

  it('draws a distinct silhouette per frame', () => {
    const strip = (s) => s.replace(/id="[^"]*"|url\(#[^)]*\)|href="#[^"]*"|data-frame="[^"]*"|--cx-delay:[^;"]*/g, '');
    const out = frames.map((f) => strip(html(h(AvatarFrame, { frame: f, size: 64 }, h('i')))));
    expect(new Set(out).size).toBe(frames.length);
  });

  it('gradient ids stay unique when frames render together', () => {
    const both = html(
      h('div', null,
        ...frames.map((f) => h(AvatarFrame, { key: f.id, frame: f, size: 48 }, h('i'))),
        h(AvatarFrame, { key: 'dupe', frame: 'frame-aurora', size: 48 }, h('i')),
        h(AvatarFrame, { key: 'dupe2', frame: 'frame-golconda', size: 48 }, h('i'))),
    );
    const ids = idsIn(both);
    expect(ids.length).toBeGreaterThan(frames.length);
    expect(new Set(ids).size).toBe(ids.length);
    // every url(#x) / href=#x reference resolves to an id in the same markup
    for (const m of both.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) expect(ids).toContain(m[1] || m[2]);
  });

  it('renders at the smallest and largest sizes without throwing', () => {
    for (const f of frames) {
      for (const size of [22, 104]) {
        const out = html(h(AvatarFrame, { frame: f, size }, (inner) => h(Avatar, { preset: 2, size: inner })));
        expect(out).toContain(`width="${size}"`);
      }
    }
  });

  it('only the legendary frames loop, one phase offset each', () => {
    for (const f of frames) {
      const out = html(h(AvatarFrame, { frame: f, size: 64 }, h('i')));
      const animated = /cx-(orbit|glint|drift)/.test(out);
      expect(animated, f.id).toBe(f.rarity === 'legendary');
      expect(out.includes('--cx-delay'), f.id).toBe(f.rarity === 'legendary');
    }
    const aurora = html(h(AvatarFrame, { frame: 'frame-aurora', size: 64 }, h('i')));
    expect(aurora).toContain('cx-drift');
    expect(aurora).toContain('cx-orbit');
    const diamond = html(h(AvatarFrame, { frame: 'frame-golconda', size: 64 }, h('i')));
    expect((diamond.match(/cx-glint cx-glint--/g) || []).length).toBe(3);
    expect(diamond).toContain('cx-orbit');
  });

  it('keeps unknown-frame behaviour and the shop preview wiring', () => {
    expect(html(h(AvatarFrame, { frame: 'frame-bogus', size: 48 }, h('b', null, 'x')))).toBe('<b>x</b>');
    for (const f of frames) {
      const out = html(h(CosmeticPreview, { item: f, size: 96 }));
      expect(out).toContain(`data-frame="${f.id}"`);
      expect(out).toContain('<svg');
    }
    expect(html(h(CosmeticPreview, { item: 'frame-golconda' }))).toContain('cx-orbit');
  });
});

describe('title chip rarity tiers', () => {
  const legendary = COSMETICS.filter((c) => c.kind === 'title' && c.rarity === 'legendary');

  it('legendary titles resolve and render foil + sheen with the data hooks intact', () => {
    expect(legendary.map((t) => t.id)).toEqual(expect.arrayContaining(['title-golconda', 'title-kingpin']));
    for (const t of legendary) {
      expect(resolveCosmetic(t.id, 'title')).toBe(t);
      expect(resolveCosmetic(t.id.replace('title-', ''), 'title')).toBe(t);
      const out = html(h(TitleChip, { title: t.id }));
      expect(out).toContain('data-rarity="legendary"');
      expect(out).toContain('data-chip-text=""');
      expect(out).toContain('cx-sheen');
      expect(out).toContain('cx-foil');
      expect(out).toContain('--cx-delay');
      expect(out).toContain(t.name);
      expect(out).toContain('<svg'); // the 4-point star stays
    }
  });

  it('epic is rich without the sheen; rare and common stay inline-styled', () => {
    const epic = html(h(TitleChip, { title: 'title-charminar' }));
    expect(epic).toContain('data-rarity="epic"');
    expect(epic).toContain('cx-chip');
    expect(epic).not.toContain('cx-sheen');
    const rare = html(h(TitleChip, { title: 'title-dice' }));
    expect(rare).toContain('data-rarity="rare"');
    expect(rare).not.toContain('cx-');
    expect(rare).toContain('color-mix(in srgb, var(--rarity-rare');
    const common = COSMETICS.find((c) => c.kind === 'title' && c.rarity === 'common');
    if (common) expect(html(h(TitleChip, { title: common.id }))).not.toContain('cx-');
  });

  it('keeps className, size and style props', () => {
    const out = html(h(TitleChip, { title: 'title-kingpin', className: 'mine', size: 'sm', style: { margin: 3 } }));
    expect(out).toContain('mine');
    expect(out).toContain('cx-sheen');
    expect(out).toContain('margin:3px');
    expect(out).toContain('font-size:11px');
  });
});

describe('cosmetics-shine.css gates', () => {
  // every class that carries an `animation:` (outside the gate blocks) must be switched off in all four gates
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('---------- gates') ? '/* ---------- gates' : ''));
  const body = bare.split('/* ---------- gates')[0];
  const gates = bare.split('/* ---------- gates')[1] || '';
  const animated = new Set();
  for (const m of body.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*cx-[^;]+;/g)) {
    for (const cls of m[1].match(/\.cx-[a-z-]+/g) || []) animated.add(cls);
  }

  it('finds the animated loops', () => {
    expect([...animated].sort()).toEqual(['.cx-drift', '.cx-glint', '.cx-orbit', '.cx-sheen']);
  });

  it('defines keyframes for each loop and no ease-in', () => {
    for (const name of ['cx-sheen-sweep', 'cx-orbit-pass', 'cx-glint-twinkle', 'cx-drift-turn']) expect(css).toContain(`@keyframes ${name}`);
    expect(bare).not.toMatch(/ease-in(?!-out)/);
  });

  it('switches every loop off under reduced motion, in-game reduce, and perf-low', () => {
    const gateStarts = [
      '@media (prefers-reduced-motion: reduce)',
      ":root[data-motion='reduced']",
      '.hg-game[data-rm]',
      ":root[data-perf='low']",
    ];
    gateStarts.forEach((start, i) => {
      expect(gates, start).toContain(start);
      const from = gates.indexOf(start);
      const to = i + 1 < gateStarts.length ? gates.indexOf(gateStarts[i + 1]) : gates.length;
      const slice = gates.slice(from, to);
      for (const cls of animated) expect(slice, `${start} ${cls}`).toContain(cls);
      expect(slice).toMatch(/animation:\s*none/);
    });
  });

  it('declares the foil and sheen classes with a text-clip fallback colour', () => {
    expect(css).toContain('.cx-foil');
    expect(css).toMatch(/background-clip:\s*text/);
    expect(css).toMatch(/color:\s*var\(--cx-foil-d\)/);
    expect(css).toContain("[data-rarity='legendary'].cx-chip");
    expect(css).toContain("[data-rarity='epic'].cx-chip");
  });
});
