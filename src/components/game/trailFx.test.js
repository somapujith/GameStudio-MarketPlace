import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import TrailFx, { TRAIL_COUNTS, trailItem, trailParticles } from './TrailFx.jsx';
import Pawn from './Pawn.jsx';
import PhoneBoardContext from './phone/PhoneBoardContext.js';

const trails = COSMETICS.filter((c) => c.kind === 'trail');
const fx = (props) => renderToString(h(TrailFx, { colors: ['#ff7aa8', '#ffc2d6'], steps: 3, ...props }));
const count = (html) => (html.match(/class="tr-p"/g) || []).length;
const css = readFileSync(new URL('../../styles/trails.css', import.meta.url), 'utf8');
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('TrailFx particles', () => {
  it('has a count for every trail finish in the catalogue, 4-10 each', () => {
    expect(Object.keys(TRAIL_COUNTS).sort()).toEqual([...FINISHES.trail].sort());
    for (const n of Object.values(TRAIL_COUNTS)) {
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it('renders the right particle count for each finish, as CSS-only spans', () => {
    for (const finish of FINISHES.trail) {
      const html = fx({ finish });
      expect(count(html)).toBe(TRAIL_COUNTS[finish]);
      expect(html).toContain(`data-finish="${finish}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('<svg');
    }
  });

  it('gives the legendary finishes the richest effect', () => {
    for (const t of trails.filter((c) => c.rarity === 'legendary')) expect(TRAIL_COUNTS[t.finish]).toBe(10);
    expect(TRAIL_COUNTS.flame).toBeGreaterThan(TRAIL_COUNTS.dust);
  });

  it('carries the two item colours and a per-particle index', () => {
    const html = fx({ finish: 'petals', colors: ['#111111', '#222222'] });
    expect(html).toContain('--ca:#111111');
    expect(html).toContain('--cb:#222222');
    expect(html).toContain('--i:0');
    expect(html).toContain(`--i:${TRAIL_COUNTS.petals - 1}`);
  });

  it('draws nothing for an unknown finish, no step yet, or missing colours', () => {
    expect(fx({ finish: 'glitter' })).toBe('');
    expect(fx({ finish: undefined })).toBe('');
    expect(fx({ finish: 'dust', steps: 0 })).toBe('');
    expect(fx({ finish: 'dust', colors: undefined })).toBe('');
  });

  it('is deterministic from the step number and differs between steps', () => {
    expect(fx({ finish: 'sparks', steps: 5 })).toBe(fx({ finish: 'sparks', steps: 5 }));
    expect(fx({ finish: 'sparks', steps: 5 })).not.toBe(fx({ finish: 'sparks', steps: 6 }));
    expect(trailParticles('coins', 9, 'walk')).toEqual(trailParticles('coins', 9, 'walk'));
  });

  it('starts each particle when the pawn passes it, and bursts at arrival for a teleport', () => {
    const walk = trailParticles('dust', 2, 'walk');
    for (const p of walk) {
      expect(p.t).toBeGreaterThanOrEqual(0.22);
      expect(p.t).toBeLessThanOrEqual(0.78);
      expect(p.f).toBeLessThan(1);
    }
    expect(walk.map((p) => p.t)).toEqual([...walk.map((p) => p.t)].sort((a, b) => a - b));
    const burst = trailParticles('dust', 2, 'teleport');
    expect(burst.every((p) => p.f === 0 && p.t >= 0.72)).toBe(true);
    expect(trailParticles('dust', 2, 'ride').every((p) => p.t === p.f)).toBe(true);
  });

  it('marks the motion, keeps the path vector on its own group and thins to the disc board', () => {
    const html = fx({ finish: 'streak', motion: 'ride', gx: -0.1, gy: 0.05, compact: true });
    expect(html).toContain('tr-fx is-ride is-disc');
    expect(html).toContain('--gx:-0.1');
    expect(html).toContain('--gy:0.05');
    expect(fx({ finish: 'streak', motion: 'teleport' })).toContain('is-teleport');
    expect(fx({ finish: 'streak' })).toContain('is-walk');
  });
});

describe('trailItem', () => {
  it('resolves every catalogue trail and rejects everything else', () => {
    for (const t of trails) expect(trailItem(t.id)).toBe(t);
    expect(trailItem(null)).toBeNull();
    expect(trailItem('')).toBeNull();
    expect(trailItem('trail-nope')).toBeNull();
    const other = COSMETICS.find((c) => c.kind === 'frame');
    expect(trailItem(other.id)).toBeNull();
  });
});

describe('the Pawn and the Board pass the trail through', () => {
  const pawn = (props, disc = false) =>
    renderToString(h(PhoneBoardContext.Provider, { value: disc }, h(Pawn, { id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 5, ...props })));

  it('draws no trail before the pawn has moved, or for a missing / unknown trail', () => {
    for (const trail of [undefined, null, 'trail-neon', 'trail-nope']) expect(pawn({ trail })).not.toContain('tr-fx');
    expect(pawn({ trail: 'trail-neon' })).toBe(pawn({ trail: null }));
  });

  it('is unchanged for a pawn with no trail', () => {
    expect(pawn({})).toBe(pawn({ trail: null }));
  });

  it('has the Pawn render TrailFx behind the piece for a known trail once it has stepped', () => {
    const source = src('./Pawn.jsx');
    expect(source).toMatch(/steps \? trailItem\(trail\) : null/);
    expect(source).toMatch(/<TrailFx finish=\{trailFor\.finish\} colors=\{trailFor\.colors\} steps=\{steps\} motion=\{kind\}/);
    expect(source.indexOf('<TrailFx')).toBeLessThan(source.indexOf('className={`hb-pawn__hop'));
    expect(source).toMatch(/compact=\{!!disc\}/);
  });

  it('has the Board pass the equipped trail id as a plain string prop', () => {
    expect(src('./Board.jsx')).toMatch(/trail=\{cosmeticsOf\(session, p\.id\)\.trail \|\| null\}/);
  });
});

describe('trails.css gates', () => {
  /** the text of the `{ ... }` block that opens at `open` */
  const braces = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
    }
    return text.slice(open);
  };
  const rules = [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const animated = new Set();
  for (const r of rules) if (/\banimation(-name)?\s*:/.test(r.body)) for (const c of r.sel.matchAll(/\.(trp?-[a-z]+)/g)) animated.add(c[1]);

  const mq = css.indexOf('@media (prefers-reduced-motion: reduce)');
  const reducedMedia = braces(css, css.indexOf('{', mq));
  const select = (re) => rules.filter((r) => re.test(r.sel)).map((r) => r.sel).join('\n');
  const motionReduced = select(/data-motion='reduced'/);
  const gameRm = select(/\.hg-game\[data-rm\]/);
  const perfLow = select(/data-perf='low'/);

  it('animates something, in both families', () => {
    expect([...animated]).toEqual(expect.arrayContaining(['tr-fx', 'tr-p', 'trp-p', 'trp-line', 'trp-puck']));
  });

  it('silences every tr- / trp- animation under data-motion=reduced, .hg-game[data-rm] and prefers-reduced-motion', () => {
    expect(mq).toBeGreaterThan(0);
    for (const c of animated) {
      expect(motionReduced, `data-motion reduced: ${c}`).toContain(`.${c}`);
      expect(reducedMedia, `prefers-reduced-motion: ${c}`).toContain(`.${c}`);
      if (c.startsWith('tr-')) expect(gameRm, `data-rm: ${c}`).toContain(`.${c}`);
    }
    expect(reducedMedia).toMatch(/\.tr-fx \{ display: none; \}/);
  });

  it('caps the live trail to 3 particles with no glow, and stills the preview, under data-perf=low', () => {
    expect(perfLow).toContain(".tr-p:nth-child(n + 4)");
    expect(css).toMatch(/data-perf='low'\] \.tr-p:nth-child\(n \+ 4\) \{ display: none; \}/);
    expect(css).toMatch(/data-perf='low'\] \.tr-p::before \{ box-shadow: none !important; \}/);
    for (const c of animated) if (c.startsWith('trp-')) expect(perfLow, c).toContain(`.${c}`);
    expect(css).toMatch(/data-perf='low'\] \.trp-puck \{ animation: none !important; \}/);
  });

  it('thins the phone disc board to 3 particles', () => {
    expect(css).toMatch(/\.tr-fx\.is-disc \.tr-p:nth-child\(n \+ 4\) \{ display: none; \}/);
  });

  it('animates only transform and opacity (no filter, no animated box-shadow, no layout)', () => {
    const keyframes = [...css.matchAll(/@keyframes [a-z-]+ (\{)/g)].map((m) => braces(css, m.index + m[0].length - 1));
    expect(keyframes.length).toBeGreaterThan(10);
    for (const k of keyframes) expect(k).not.toMatch(/filter|box-shadow|width|height|left|top|margin/);
  });
});
