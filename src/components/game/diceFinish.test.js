import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import { Dice, diceFinish, diceSkinStyle } from './Dice.jsx';

const css = readFileSync(new URL('../../styles/dice-finishes.css', import.meta.url), 'utf8');
const diceItems = COSMETICS.filter((c) => c.kind === 'dice');
const render = (skin) => renderToString(createElement(Dice, { session: { display: { dice: [3] } }, skin }));

describe('diceSkinStyle with finishes', () => {
  it('adds --die-glow from the item glow, or the edge colour when it has none', () => {
    expect(diceSkinStyle('dice-gold')).toEqual({ '--die-face': '#f5c542', '--die-pip': '#5a3a00', '--die-edge': '#b8860b', '--die-glow': '#ffd86b' });
    expect(diceSkinStyle('dice-ruby')['--die-glow']).toBe('#ff5c7a');
    expect(diceSkinStyle('dice-ruby')['--die-glow']).not.toBe('#7a0a25');
    // the glow falls back to the edge for a finish without one
    expect(diceSkinStyle({ id: 'x' })).toBeNull();
  });

  it('leaves the plain skins exactly as they were (no glow variable, no finish)', () => {
    for (const id of ['dice-ivory', 'dice-biryani', 'dice-cyber', 'dice-bangle']) {
      expect(Object.keys(diceSkinStyle(id)).sort()).toEqual(['--die-edge', '--die-face', '--die-pip']);
      expect(diceFinish(id)).toBeNull();
      const html = render(id);
      expect(html).not.toContain('data-finish');
      expect(html).not.toContain('cp-glint');
    }
  });
});

describe('the die wrapper', () => {
  it('carries data-finish for every finished skin and its glow variable', () => {
    for (const item of diceItems.filter((c) => c.finish)) {
      const html = render(item.id);
      expect(html).toContain(`data-finish="${item.finish}"`);
      expect(html).toContain('has-skin');
      expect(html).toContain(`--die-glow:${item.glow || item.colors[2]}`);
    }
  });

  it('omits data-finish for no skin, unknown ids and other kinds', () => {
    for (const skin of [null, undefined, 'nope', 'frame-silver']) expect(render(skin)).not.toContain('data-finish');
  });

  it('draws one glint per face on the legendary finishes only', () => {
    for (const item of diceItems.filter((c) => c.finish)) {
      const n = (render(item.id).match(/class="cp-glint"/g) || []).length;
      expect(n).toBe(item.rarity === 'legendary' ? 6 : 0);
    }
    expect(diceItems.filter((c) => c.rarity === 'legendary' && c.finish).map((c) => c.finish).sort()).toEqual(['emerald', 'gold', 'holo', 'ruby']);
  });

  it('keeps one cube and six faces with every finish (the roll animation targets them)', () => {
    for (const item of diceItems) {
      const html = render(item.id);
      expect(html.match(/class="cp-cube"/g)).toHaveLength(1);
      expect(html.match(/class="cp-face cp-face--\d"/g)).toHaveLength(6);
    }
  });
});

describe('dice-finishes.css', () => {
  it('has a material rule for every finish in the catalogue', () => {
    for (const f of FINISHES.dice) expect(css, f).toMatch(new RegExp(String.raw`\[data-finish='${f}'\][^{]*\.cp-face\b`));
  });

  it('makes the halo, sparkle, burst, ring, spark and pop number follow --die-glow', () => {
    for (const part of ['.cp-die3d__halo', '.cp-die3d__twinkle', '.cp-die3d__ring', '.cp-spark', '.cp-die3d__pop']) {
      const rule = css.split('}').find((r) => r.includes(`[data-finish] ${part}`));
      expect(rule, part).toContain('--die-glow');
    }
  });

  it('stops every decorative animation under reduced motion and on slow devices', () => {
    for (const gate of ["[data-motion='reduced'] .cp-dice .cp-glint", '[data-rm] .cp-dice .cp-glint', ":root[data-perf='low'] .cp-dice .cp-glint", '@media (prefers-reduced-motion: reduce)', '.cp-dice.is-reduced .cp-glint']) {
      expect(css).toContain(gate);
    }
    for (const gate of ["[data-motion='reduced'] .dsw-sweep", ":root[data-perf='low'] .dsw-star", '[data-rm] .dsw-sweep']) expect(css).toContain(gate);
  });

  it('animates only transform and opacity (plus the face material, which is static)', () => {
    const frames = css.match(/@keyframes [^{]+\{(?:[^{}]*\{[^}]*\})+\s*\}/g) || [];
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(f.replace(/@keyframes [^{]+/, '')).not.toMatch(/(?:background|box-shadow|filter|width|height|left|top)\s*:/);
  });
});
