// The landscape-first HUD contract (docs/perf/tf-ui.md), checked as CSS text because the node test run has no browser: the viewport-height scale, the
// safe areas, 44 px targets, a layout that is one grid for every landscape size and a narrow-window fallback (no portrait phone layout), a cheap
// compositor-only motion system, and the coach bar sitting in the free middle of the picture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const hud = noComments(read('./hud.css'));
const menus = noComments(read('../menus/menus.css'));
const root = noComments(read('../../tiffin.css'));
const hudLayer = read('./HudLayer.jsx');

/** The declaration block of the FIRST top-level rule whose selector is exactly `sel` ('' when there is none). */
const rule = (css, sel) => {
  const re = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`);
  return re.exec(css)?.[1] ?? '';
};
const u = (decl, prop) => {
  const m = new RegExp(`(?:^|[;\\s])${prop}: calc\\((\\d+(?:\\.\\d+)?) \\* var\\(--u\\)\\)`).exec(decl);
  return m ? Number(m[1]) : null;
};

describe('landscape first: one scale, one grid, no portrait phone layout', () => {
  it('--tc-u scales the HUD with the viewport HEIGHT, never below 1 px (a 44 px target stays 44 px) and never above 1.7 px', () => {
    expect(root).toMatch(/--tc-u: clamp\(1px, min\(calc\(0\.0972vh \+ 0\.5px\), calc\(0\.0833vw \+ 0\.2px\)\), 1\.7px\);/);
    expect(root).toMatch(/@supports \(height: 1dvh\) \{\s*\.tc \{ --tc-u: clamp\(1px, min\(calc\(0\.0972dvh/);
    // what the formula gives at the reference sizes (a 1 px floor on phones, about 1.2 at 720, 1.55 at 1080, capped at 1.7)
    const scale = (w, h) => Math.min(1.7, Math.max(1, Math.min(0.000972 * h + 0.5, 0.000833 * w + 0.2)));
    expect(scale(640, 360)).toBe(1);
    expect(scale(844, 390)).toBe(1);
    expect(scale(932, 430)).toBe(1);
    expect(scale(1280, 720)).toBeCloseTo(1.2, 1);
    expect(scale(1920, 1080)).toBeCloseTo(1.55, 1);
    expect(scale(3840, 2160)).toBe(1.7);
    expect(scale(390, 844)).toBe(1); // a narrow window does not grow the HUD
    expect(hud).toMatch(/\.tc-hud \{\s*--u: var\(--tc-u, 1px\);/);
  });
  it('sizes are written in --u (the file is calc(N * var(--u)) throughout, not px)', () => {
    const body = hud.slice(hud.indexOf('.tc-hud {'));
    expect((body.match(/calc\(\d+(?:\.\d+)? \* var\(--u\)\)/g) || []).length).toBeGreaterThan(400);
    // the only raw px left are hairlines, borders, outlines, the edge-arrow chips (sized in JS) and the pointer-coarse label floors
    const px = body.split('\n').filter((l) => /(?<![\w.#-])(?:[4-9]|\d{2,})(?:\.\d+)?px/.test(l) && !/^\s*\/\*|^\s*\*|^\s*@|--tc-hud-|env\(|max\(1\dpx|\.tc-hud-edge|repeating-linear-gradient\((?:-)?45deg|calc\(100% \+ 4px\)/.test(l));
    expect(px.filter((l) => !/font-size: max\(|line-height: |outline|border|var\(--tc-hud-(?:top|bottom)|min\(92vw/.test(l))).toEqual([]);
  });
  it('the HUD pads itself with every safe-area inset (a notch, rounded corners, the home bar)', () => {
    const r = rule(hud, '.tc-hud');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(r).toContain(`env(safe-area-inset-${side})`);
  });
  it('one grid for every landscape size: the rail on the left, the picture in the middle, the board on the right, hands and dock below', () => {
    const r = rule(hud, '.tc-hud');
    expect(r).toMatch(/grid-template-areas: 'top top top' 'rail mid board' 'bottom bottom bottom';/);
    expect(r).toContain('grid-template-columns: var(--tc-rail-w) minmax(0, 1fr) auto;');
    expect(rule(hud, '.tc-hud-subs')).toContain('grid-area: mid'); // subtitles never cover the rail or the board
    expect(rule(hud, '.tc-hud-coop')).toContain('grid-area: mid');
  });
  it('has no portrait-phone layout: the only narrow fallback is a window taller than wide, and the portrait media queries are gone', () => {
    for (const css of [hud, root]) {
      expect(css).not.toMatch(/orientation: portrait/);
      expect(css).not.toMatch(/max-width: 899px/);
      expect(css).not.toContain('--tcp-');
    }
    expect(hud).toMatch(/@media \(max-aspect-ratio: 1\/1\) \{\s*\.tc-hud \{ grid-template-columns: minmax\(0, 1fr\);/);
  });
  it('the roomy variant (480 px tall and up) brings back the names, the books and a wrapping dock; phones keep a scrolling dock', () => {
    const roomy = hud.slice(hud.indexOf('@media (min-height: 481px) {'));
    expect(roomy).toMatch(/\.tc-hud-dock \{[^}]*flex-wrap: wrap;[^}]*overflow: visible;/);
    expect(roomy).toMatch(/\.tc-hud-board:not\(\[data-slim='1'\]\) \.tc-hud-chip-name \{ display: flex; \}/);
    expect(roomy).toMatch(/\.tc-hud-book\.is-cost \{ display: inline; \}/);
    expect(rule(hud, '.tc-hud-dock')).toMatch(/overflow-x: auto;/);
    expect(rule(hud, '.tc-hud-station')).toContain('flex: none');
    expect(rule(hud, '.tc-hud-bottom')).toContain('min-width: 0');
    expect(rule(hud, '.tc-hud-dockwrap')).toMatch(/min-width: 0; max-width: 100%/);
  });
  it('the bubbles and edge arrows sit under every HUD panel, and the panels stack above them', () => {
    expect(hud).toMatch(/\.tc-hud-bubbles, \.tc-hud-edges \{[^}]*z-index: 1;/);
    expect(hud).toMatch(/\.tc-hud-top, \.tc-hud-board, \.tc-hud-railbox, \.tc-hud-bottom, \.tc-hud-coop \{ position: relative; z-index: 2; \}/);
  });
  it('the glue Leave button is hidden once the HUD has its own', () => {
    expect(hud).toMatch(/\.tc-hud--has-leave ~ \.tc-leave, \.tc:has\(\.tc-hud--has-leave\) \.tc-leave \{ display: none; \}/);
  });
});

describe('44 px touch targets', () => {
  const targets = ['.tc-hud-btn', '.tc-hud-slot', '.tc-hud-chip', '.tc-hud-hand', '.tc-hud-trash', '.tc-hud-status-toggle', '.tc-hud-collect', '.tc-hud-bubble', '.tc-hud-pending-x', '.tc-hud-chit-look', '.tc-hud-emote'];
  for (const sel of targets) {
    it(`${sel} is at least 44 design pixels in its smaller dimension`, () => {
      const r = rule(hud, sel);
      expect(r, `${sel} has a rule`).not.toBe('');
      const h = u(r, 'min-height') ?? u(r, 'height');
      const w = u(r, 'min-width') ?? u(r, 'width');
      expect(Math.min(h ?? 99, w ?? 99)).toBeGreaterThanOrEqual(44);
    });
  }
  it('the slim Dishes tab is a 28 px tab with a 44 px hit area', () => {
    expect(rule(hud, '.tc-hud-board-toggle')).toMatch(/min-height: calc\(28 \* var\(--u\)\)/);
    expect(hud).toMatch(/\.tc-hud-board-toggle::after \{ content: ''; position: absolute; inset: calc\(-8 \* var\(--u\)\) calc\(-4 \* var\(--u\)\); \}/);
  });
});

describe('cheap over a live WebGL canvas', () => {
  const keyframes = (css) => [...css.matchAll(/@keyframes ([\w-]+) \{((?:[^{}]|\{[^}]*\})*)\}/g)].map((m) => ({ name: m[1], props: [...new Set([...m[2].matchAll(/([a-z-]+):/g)].map((p) => p[1]))] }));
  const OK = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale']);
  it('no backdrop-filter, blur(), mix-blend-mode or will-change except on the moving bubbles and arrows', () => {
    for (const [name, css] of [['hud', hud], ['menus', menus], ['root', root]]) {
      expect(css, name).not.toMatch(/backdrop-filter/);
      expect(css, name).not.toMatch(/blur\(/);
      expect(css, name).not.toMatch(/mix-blend-mode: (?!normal)/);
    }
    const wc = hud.split('\n').filter((l) => l.includes('will-change'));
    expect(wc.every((l) => /^\.tc-hud-(anchor|edge) /.test(l))).toBe(true);
  });
  it('every HUD keyframe animates transform and opacity only (nothing that repaints or re-lays-out the layer over the canvas each frame)', () => {
    const bad = keyframes(hud).filter((k) => k.props.some((p) => !OK.has(p)));
    expect(bad).toEqual([]);
    expect(keyframes(hud).length).toBeGreaterThan(12);
  });
  it('every menu keyframe is transform / opacity too', () => {
    expect(keyframes(menus).filter((k) => k.props.some((p) => !OK.has(p)))).toEqual([]);
  });
  it('keeps :has() to four local selectors (an ancestor watching a subtree the frame bus rewrites every frame re-styles the HUD on each mutation)', () => {
    const uses = [...hud.matchAll(/[^\s{},]*:has\([^)]*\)\)?/g)].map((m) => m[0]);
    expect(uses.sort()).toEqual([
      '.tc-hud-chip-meta:not(:has(>*))'.replace('>*', '> *'),
      '.tc-hud-railbox:has(.tc-hud-rail-empty)',
      '.tc:has(.tc-hud--has-leave)',
      'div:has(> dt:empty)', // the help card's rows, static
    ].sort());
    expect(hud).not.toMatch(/\.tc-hud:has\(/);
  });
  it('the shift bar has no endless width transition (a 1 s step of a 160 px bar is one pixel)', () => {
    expect(rule(hud, '.tc-hud-shiftbar-fill')).not.toMatch(/transition/);
  });
  it('the "needs you" rings are pseudo elements (opacity + transform), not animated shadows on the element', () => {
    expect(hud).toMatch(/\.tc-hud-chip\[data-tone='urgent'\]::before[\s\S]*animation: tc-hud-ring 0\.9s ease-out infinite;/);
    expect(hud).not.toMatch(/animation: tc-hud-alarm/);
    expect(hud).not.toMatch(/animation: tc-hud-glow[^;]*;[^}]*filter/);
  });
  it('reduced motion turns every HUD and menu animation and transition off', () => {
    expect(hud).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.tc-hud \*, \.tc-hud \*::before, \.tc-hud \*::after \{ animation: none !important; transition: none !important; \}/);
    expect(hud).toMatch(/\.tc-hud--calm \*, \.tc-hud--calm \*::before, \.tc-hud--calm \*::after \{ animation: none !important; transition: none !important; \}/);
    expect(menus).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.tc-menu \*, \.tc-menu \*::before, \.tc-menu \*::after \{ animation: none !important; transition: none !important; \}/);
  });
});

describe('the tutorial coach bar sits in the free middle of the picture', () => {
  it('is centred between the order rail and the dish board (the HUD publishes both widths), under the banner, and its hint is a ring, not a shadow', () => {
    const bar = rule(menus, '.tc-menu-coachbar');
    expect(bar).toContain('left: var(--tc-hud-left, 0px)');
    expect(bar).toContain('right: var(--tc-hud-right, 0px)');
    expect(bar).toContain('top: calc(var(--tc-hud-top');
    expect(hudLayer).toContain("host.style.setProperty('--tc-hud-left'");
    expect(hudLayer).toContain("host.style.setProperty('--tc-hud-right'");
    expect(menus).toMatch(/\.tc-menu-coachbar\.is-hinting::after \{[^}]*animation: tc-menu-ring/);
  });
  it('toasts hang under the coach bar when it is at the top', () => {
    expect(rule(hud, '.tc-hud-toastzone')).toContain('var(--tc-coach-top-on, 0) * (var(--tc-coach-top-h, 0px) + 6px)');
  });
});

describe('every class the HUD components render is styled', () => {
  it('no component uses a tc-hud-* class that hud.css (or recipe.css) does not define', () => {
    const dir = new URL('./', import.meta.url);
    const used = new Set();
    for (const f of ['ActionSheet', 'Availability', 'BoardSheet', 'CoopBar', 'DishIcon', 'EdgeIndicators', 'HandsTray', 'HudLayer', 'HudIcon', 'OrderRail', 'PrepSheet', 'QuickBar', 'RecipeCard', 'StallStatus', 'StationsDock', 'Subtitles', 'TendButton', 'Toasts', 'TopBar', 'WorldBubbles']) {
      for (const m of readFileSync(new URL(`${f}.jsx`, dir), 'utf8').matchAll(/tc-hud-[a-z0-9]+(?:-[a-z0-9]+)*/g)) used.add(m[0]);
    }
    const defined = new Set([...(hud + read('./recipe.css')).matchAll(/\.(tc-hud-[a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1]));
    // classes that are only hooks (no style of their own): the empty slot ring and the board sheet's wrapper
    const hooks = new Set(['tc-hud-left', 'tc-hud-right', 'tc-hud-u', 'tc-hud-top', 'tc-hud-bottom', 'tc-hud-slot-ring', 'tc-hud-boardsheet', 'tc-hud-btn--sm', 'tc-hud-cooking', 'tc-hud-held', 'tc-hud-status-toggle-txt', 'tc-hud-say-', 'tc-hud-subs-']);
    expect([...used].filter((c) => !defined.has(c) && !hooks.has(c)).sort()).toEqual([]);
  });
});
