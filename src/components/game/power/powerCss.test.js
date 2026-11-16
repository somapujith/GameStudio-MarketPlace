// power.css: every loop is gated (OS reduced motion, [data-motion='reduced'], .hg-game[data-rm]) and the decorative ring stops on low-perf devices.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../styles/power.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level blocks: { head, body } (nested @media bodies are kept whole). */
function blocks(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    out.push({ head, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
const top = blocks(css);

describe('power.css motion gates', () => {
  it('every `infinite` animation sits in the prefers-reduced-motion: no-preference block behind the two app gates', () => {
    const loops = [];
    for (const b of top) {
      if (b.head.startsWith('@media')) {
        for (const r of blocks(b.body)) if (/infinite/.test(r.body)) loops.push({ media: b.head, sel: r.head });
      } else if (/infinite/.test(b.body)) {
        loops.push({ media: '', sel: b.head });
      }
    }
    expect(loops.length).toBeGreaterThanOrEqual(2);
    for (const l of loops) {
      expect(l.media, l.sel).toContain('prefers-reduced-motion: no-preference');
      expect(l.sel, l.sel).toContain(":not([data-motion='reduced'])");
      expect(l.sel, l.sel).toContain('.hg-game:not([data-rm])');
    }
  });
  it('the decorative last-round ring is switched off on low-perf devices', () => {
    expect(css).toMatch(/:root\[data-perf='low'\] \.pw-card\.is-last::before \{[^}]*animation: none/);
  });
  it('the last-round state keeps a static amber ring without any animation', () => {
    expect(css).toMatch(/\.pw-card\.is-last \{ box-shadow: 0 0 0 3px #ffb100/);
  });
  it('never repeats an animation outside the gated block, uses no filters, and keeps the pw- prefix', () => {
    const iterations = css.match(/animation[^;{}]*;/g) || [];
    const looping = iterations.filter((a) => /infinite/.test(a));
    expect(looping.length).toBe(2);
    expect(css).not.toMatch(/\bfilter:/);
    const classes = [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
    const allowed = new Set(['hg-game', 'is-last', 'is-selected', 'is-dimmed', 'is-on', 'is-off', 'cp']);
    expect(classes.filter((c) => !c.startsWith('pw-') && !allowed.has(c))).toEqual([]);
  });
});
