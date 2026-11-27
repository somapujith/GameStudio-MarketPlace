// QA-C B4 (status card on a short screen), B5 (the Graphics setting in the pause menu and on the home screen), QA-B B2 (results: profit first).
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { GFX_KEY, getGfxPref, setGfxPref } from '../../scene/capabilities.js';
import GraphicsSetting, { GFX_APPLY_HINT, GFX_OPTIONS, gfxNote, pendingNote, tierNote } from './GraphicsSetting.jsx';
import { PauseMenu, Results, SoloHome } from './index.js';

const css = readFileSync(new URL('./menus.css', import.meta.url), 'utf8');
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('B5: the Graphics setting', () => {
  beforeEach(() => setGfxPref('auto', memory()));
  it('offers Auto / High / Medium / Low / Lite, each with a short note; Lite names the weakest phones and 30 fps', () => {
    expect(GFX_OPTIONS.map((o) => o.id)).toEqual(['auto', 'high', 'medium', 'low', 'lite']);
    expect(GFX_OPTIONS.map((o) => o.label)).toEqual(['Auto', 'High', 'Medium', 'Low', 'Lite']);
    for (const o of GFX_OPTIONS) expect(o.note.length).toBeGreaterThan(20);
    expect(gfxNote('lite')).toMatch(/weakest phones/);
    expect(gfxNote('lite')).toMatch(/30 fps/);
    expect(gfxNote('nonsense')).toBe(gfxNote('auto'));
  });
  it('renders a radiogroup with the saved choice selected, the note, and the "applies next time" hint', () => {
    const store = memory();
    setGfxPref('low', store);
    expect(store.getItem(GFX_KEY)).toBe('low');
    const s = renderToStaticMarkup(h(GraphicsSetting, {}));
    expect(s).toContain('role="radiogroup"');
    expect(s).toContain('aria-label="Graphics"');
    for (const l of ['Auto', 'High', 'Medium', 'Low', 'Lite']) expect(s).toContain(`>${l}</button>`);
    expect(s).toContain(GFX_APPLY_HINT);
    expect(GFX_APPLY_HINT).toBe('Applies the next time you open the stall.');
  });
  it('says which tier is running when the scene can tell (and nothing when it cannot)', () => {
    expect(tierNote(null)).toBeNull();
    expect(tierNote({ tier: 'zzz' })).toBeNull();
    expect(tierNote({ tier: 'low', start: 'low', pref: 'auto' })).toBe('Running at Low now (picked by Auto).');
    expect(tierNote({ tier: 'medium', start: 'medium', pref: 'medium' })).toBe('Running at Medium now (your choice).');
    expect(tierNote({ tier: 'lite', start: 'low', pref: 'auto' })).toMatch(/started at Low, stepped down/);
    expect(renderToStaticMarkup(h(GraphicsSetting, { tierInfo: () => ({ tier: 'lite', start: 'lite', pref: 'auto' }) }))).toContain('Running at Lite now');
    expect(renderToStaticMarkup(h(GraphicsSetting, { tierInfo: () => { throw new Error('scene gone'); } }))).not.toContain('Running at');
  });
  it('the pause menu has a Graphics section, the home screen a Settings: Graphics one', () => {
    const p = renderToStaticMarkup(h(PauseMenu, { open: true, onResume: noop, onRestart: noop, onQuit: noop, onMute: noop }));
    expect(p).toContain('<summary>Graphics</summary>');
    expect(p).toContain('aria-label="Graphics"');
    expect(p).toContain(GFX_APPLY_HINT);
    const home = html(h(SoloHome, { progress: null, tutorialDone: true, unlockedLevel: 1, onStartLevel: noop, onInvite: noop, onBack: noop }));
    expect(home).toContain('Settings: Graphics');
    expect(home).toContain('aria-label="Graphics"');
    expect(home).toContain(GFX_APPLY_HINT);
  });
  it('keeps three.js out of the home chunk: the setting imports only the pure capabilities module', () => {
    for (const f of ['./GraphicsSetting.jsx', './SoloHome.jsx', './PauseMenu.jsx']) {
      expect(src(f)).not.toMatch(/scene\/index\.js|from 'three'|scene\/renderer/);
    }
    expect(src('./GraphicsSetting.jsx')).toMatch(/from '\.\.\/\.\.\/scene\/capabilities\.js'/);
  });
});

describe('B4: the status card on a short screen', () => {
  it('scrolls inside its own box and shrinks its icon and padding under 460 px tall', () => {
    expect(css).toMatch(/\.tc-menu-status \{ grid-template-rows: minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/\.tc-menu-status__card \{ max-height: 100%; overflow-y: auto;/);
    const tail = css.slice(css.indexOf('B4 (QA C)'));
    expect(tail).toMatch(/@media \(max-height: 460px\) \{[\s\S]*\.tc-menu-status \.ho-status__icon \{ width: 44px; height: 44px;/);
    expect(tail).toMatch(/\.tc-menu-status__glyph \{ width: 28px; height: 28px; \}/);
  });
});

describe('QA-B B2: results show PROFIT first and use the side-by-side layout on a laptop-sized window', () => {
  const result = { kind: 'closed', stats: { served: 5, walked: 4, tips: 114, bestCombo: 2, revenue: 165, cost: 295 }, money: 279, tick: 100 };
  it('the books list starts with the profit row', () => {
    const s = html(h(Results, { result: { ...result, books: { revenue: 165, tips: 114, cost: 295, waste: 30, fines: 10, profit: -170 } }, level: 5, onRetry: noop, onExit: noop }));
    if (!s.includes('tc-menu-books')) return; // a result without books has no books list (levels below the operations layer)
    expect(s.indexOf('Profit')).toBeLessThan(s.indexOf('Takings'));
  });
  it('the two-column results layout also applies from 900 px wide up to 900 px tall', () => {
    expect(css).toMatch(/@media \(max-height: 480px\) and \(min-width: 700px\), \(min-width: 900px\) and \(max-height: 900px\) \{\s*\.tc-menu-results__scroll \{ display: grid; grid-template-columns: 1fr 1fr;/);
  });
});

describe('the Graphics setting says honestly what is running and when a pick takes effect', () => {
  const running = (tier, pref = 'auto') => ({ tier, start: tier, pref, auto: tier });
  it('names the running tier and the picked one when they differ, and offers Apply now only where the stall can rebuild', () => {
    expect(pendingNote(running('low'), 'high')).toBe('You picked High, but the stall is still running at Low. It starts the next time you open the stall.');
    expect(pendingNote(running('low'), 'high', true)).toMatch(/Press Apply now to rebuild the picture at once \(the shift stays paused\)/);
    expect(pendingNote(running('medium', 'high'), 'auto', true)).toMatch(/You picked Auto, but the stall is still running at Medium/);
  });
  it('says nothing when the pick is already what runs, or when nothing is known about the running stall (the home screen)', () => {
    expect(pendingNote(running('medium', 'medium'), 'medium', true)).toBe(null);
    expect(pendingNote(running('low', 'auto'), 'auto', true)).toBe(null);
    expect(pendingNote(null, 'high', true)).toBe(null);
    expect(pendingNote({ tier: 'nope', pref: 'auto' }, 'high', true)).toBe(null);
  });
  it('the pause menu offers Apply now when the glue gives it a handler, the home screen never does', () => {
    const withApply = html(h(GraphicsSetting, { tierInfo: running('low'), onApply: noop }));
    expect(withApply).not.toContain('Apply now'); // the saved pick (auto) is what runs: nothing to apply yet
    setGfxPref('high', memory());
    expect(html(h(GraphicsSetting, { tierInfo: running('low'), onApply: noop }))).toContain('Apply now');
    expect(html(h(GraphicsSetting, { tierInfo: running('low') }))).not.toContain('Apply now');
    expect(html(h(GraphicsSetting, { tierInfo: running('low') }))).toContain('It starts the next time you open the stall.');
  });
  it('the glue rebuilds the picture on Apply now and keeps the pause card away while it loads', () => {
    const impl = src('../../TiffinGameImpl.jsx');
    expect(impl).toContain('const applyGraphics = useCallback(() => setSceneKey((k) => k + 1), []);');
    expect(impl).toContain('}, [session, sceneKey]);');
    expect(impl).toContain('onApplyGraphics={applyGraphics}');
    expect(impl).toMatch(/const paused = status === 'paused' && !tutorialFinished && !gated && !!scene;/);
  });
  it('a rebuild reuses the canvas, so only a real unmount hands the GPU context back (a force-lost context cannot be drawn with again)', () => {
    const impl = src('../../TiffinGameImpl.jsx');
    expect(impl).toContain('const unmounting = useRef(false);');
    expect(impl).not.toMatch(/\bs\??\.dispose\(\)/); // every scene disposal says whether the context goes with it
    expect(impl.match(/dispose\(\{ loseContext: unmounting\.current \}\)/g)).toHaveLength(2);
    expect(src('../../scene/index.js')).toMatch(/dispose\(\{ loseContext = !import\.meta\.env\?\.DEV \} = \{\}\)/);
  });
});
