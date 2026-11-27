// The tutorial card in the landscape HUD: one compact block in every landscape layout (a tablet used to get the 200 px desktop card in the middle of the
// road), and the caption bar hangs under it by the card's MEASURED height. The pixel proof is the measurement run (scripts/perf/ui-touch.mjs); these keep the contract.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Coach, { publishCoachHeight } from './Coach.jsx';

const dir = dirname(fileURLToPath(import.meta.url));
const land = readFileSync(join(dir, '../hud/land.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** `selector { body }` pairs, selectors split on commas. */
const rules = [...land.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].split(',').map((s) => s.trim()), m[2]]);
const bodyFor = (selector) => rules.filter(([sels]) => sels.includes(selector)).map(([, b]) => b).join(';');

describe('land.css: the tutorial card', () => {
  it('is a two-column block (text | Skip) for every landscape layout, not only under the phone media queries', () => {
    const card = bodyFor(".aw[data-aw-layout$='-land'] .aw-quest-coach");
    expect(card).toContain('display: grid');
    expect(card).toContain("grid-template-areas: 'text skip' 'te skip'");
    expect(bodyFor(".aw[data-aw-layout$='-land'] .aw-quest-coach__text")).toContain('grid-area: text');
    expect(bodyFor(".aw[data-aw-layout$='-land'] .aw-quest-skip")).toContain('grid-area: skip');
  });
  it('drops the header, the step bar and the progress line; the Telugu line comes back only on a tablet', () => {
    const hidden = bodyFor(".aw[data-aw-layout$='-land'] .aw-quest-coach__te");
    expect(hidden).toContain('display: none');
    for (const s of ['.aw-quest-coach header', '.aw-quest-dots', '.aw-quest-coach .aw-quest-progress']) expect(bodyFor(`.aw[data-aw-layout$='-land'] ${s}`)).toContain('display: none');
    expect(bodyFor(".aw[data-aw-layout='tablet-land'] .aw-quest-coach__te")).toContain('display: block');
  });
  it('a tablet gets a wider lane, with the specificity to beat the compact rule', () => {
    expect(bodyFor(".aw[data-aw-compact='1'][data-aw-layout='tablet-land'] .aw-quest-coach")).toContain('width: min(440px, var(--hud-lane-w2))');
  });
  it('the caption hangs under the card by the card measured height (fallback: one short row)', () => {
    const sub = bodyFor(".aw[data-aw-layout$='-land']:has(.aw-quest-coach) .aw-sub");
    expect(sub).toMatch(/var\(--hud-lane2-top\) \+ var\(--aw-coach-h, \d+px\)/);
  });
  it('the text lanes of a tablet start right of the street name that sticks out under the minimap', () => {
    expect(bodyFor(".aw[data-aw-layout='tablet-land']")).toContain('--hud-lane-l2: calc(var(--hud-x-l) + max(var(--hud-mm) + 40px, 150px) + 10px)');
  });
});

describe('land.css: the card and the fare question share the lane', () => {
  it('a fare question hides the card in every landscape layout (the grid above would otherwise show it again)', () => {
    expect(bodyFor(".aw[data-aw-fare='1'][data-aw-layout$='-land'] .aw-quest-coach")).toContain('display: none');
  });
  it('the fare answers are three in a row in every landscape layout, and compact columns on a tablet (not the 300 px tall column)', () => {
    expect(bodyFor(".aw[data-aw-layout$='-land'] .aw-fare-opts")).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    const opt = bodyFor(".aw[data-aw-layout='tablet-land'] .aw-fare-opt");
    expect(opt).toContain('flex-direction: column');
    expect(opt).toContain('min-height: 58px');
    for (const s of ['.aw-fare-te', '.aw-fare-note', '.aw-fare-lbl small']) expect(bodyFor(`.aw[data-aw-layout='tablet-land'] ${s}`)).toContain('display: none');
  });
});

describe('publishCoachHeight', () => {
  const fake = (height) => {
    const style = new Map();
    const root = { style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) } };
    const el = { offsetHeight: height, closest: (sel) => (sel === '.aw' ? root : null) };
    return { el, style };
  };
  it('writes the height on the .aw root, rounded up, and removes it on cleanup', () => {
    const { el, style } = fake(91.2);
    const stop = publishCoachHeight(el);
    expect(style.get('--aw-coach-h')).toBe('92px');
    stop();
    expect(style.has('--aw-coach-h')).toBe(false);
  });
  it('follows the card when it resizes (a new step with more text)', () => {
    const watchers = [];
    const RO = vi.fn(function (cb) {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      watchers.push({ cb, ro: this });
    });
    vi.stubGlobal('ResizeObserver', RO);
    try {
      const { el, style } = fake(60);
      const stop = publishCoachHeight(el);
      expect(watchers[0].ro.observe).toHaveBeenCalledWith(el);
      el.offsetHeight = 88;
      watchers[0].cb();
      expect(style.get('--aw-coach-h')).toBe('88px');
      stop();
      expect(watchers[0].ro.disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does nothing without an element or a .aw root', () => {
    expect(() => publishCoachHeight(null)()).not.toThrow();
    expect(() => publishCoachHeight({ closest: () => null })()).not.toThrow();
  });
});

describe('Coach', () => {
  const q = { tutorial: { stepIndex: 0, key: 'W', progress: '40 m', steps: [{ label: 'Drive', te: 'నడపండి', current: true }, { label: 'Stop' }] } };
  it('renders the card with its ref (the aside the height is measured on) and nothing without a tutorial', () => {
    const h = renderToStaticMarkup(createElement(Coach, { q, onSkip() {} }));
    expect(h).toContain('class="aw-quest-coach"');
    expect(h).toContain('aw-quest-coach__text');
    expect(renderToStaticMarkup(createElement(Coach, { q: {}, onSkip() {} }))).toBe('');
  });
});
