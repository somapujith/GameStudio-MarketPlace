// "Is this a touch screen?" is ONE rule in Tiffin Centre's UI: useTouchDevice (src/lib/mobile.js, which asks isCoarsePointer). A touch tablet whose WebView
// reports `pointer: fine` still counts as touch inside the Android app, and every piece of wording (Pause (Esc), Click "Got it", the Esc hint) must follow it.
import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { createGame } from '@shared/tiffin-centre/index.js';

const asTouch = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/mobile.js', async (orig) => ({ ...(await orig()), useTouchDevice: () => asTouch.on }));

const { default: CoachMark } = await import('./menus/CoachMark.jsx');
const { PauseMenu } = await import('./menus/index.js');
const { default: HudLayer } = await import('./hud/HudLayer.jsx');
const { default: TopBar } = await import('./hud/TopBar.jsx');

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};
const step = { id: 's1', say: 'Chalo!', text: 'Click "Got it" to carry on.', textTouch: 'Tap "Got it" to carry on.', hint: 'Use the mouse', hintTouch: 'Use your finger' };
const state = createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level: 4, pace: 'normal' }, seed: 5 });
const hud = () =>
  html(
    h(HudLayer, {
      session: { meId: 'me', mode: 'practice', players: [{ id: 'me', name: 'Me' }], pause() {}, subscribe: () => () => {}, dispatch: () => true, tutorial: null },
      scene: null, state, tickAt: 0, status: 'playing', connection: 'open', reducedOverride: false,
    }),
  );

describe('on a touch screen (the shared rule says so, whatever the pointer media query says)', () => {
  it('the coach bar uses the touch wording without being told', () => {
    asTouch.on = true;
    const s = html(h(CoachMark, { step, index: 0, total: 2, onSkip: noop, onNext: noop }));
    expect(s).toContain('Tap &quot;Got it&quot; to carry on.');
    expect(s).not.toContain('Click &quot;Got it&quot;');
  });
  it('an explicit touch prop still wins over the rule', () => {
    asTouch.on = true;
    expect(html(h(CoachMark, { step, index: 0, total: 2, onSkip: noop, touch: false }))).toContain('Click &quot;Got it&quot;');
  });
  it('the pause button says Pause, not Pause (Esc)', () => {
    asTouch.on = true;
    expect(hud()).toContain('aria-label="Pause"');
    expect(hud()).not.toContain('Pause (Esc)');
    expect(html(h(TopBar, { state, reduced: true, canPause: true, onPause: noop, touch: true }))).toContain('aria-label="Pause"');
  });
  it('the pause card has no Esc key hint', () => {
    asTouch.on = true;
    const s = html(h(PauseMenu, { open: true, onResume: noop, onRestart: noop, onQuit: noop, onMute: noop }));
    expect(s).not.toContain('tc-menu-keys');
  });
});

describe('with a keyboard and mouse', () => {
  it('the coach bar, the pause button and the pause card speak keyboard', () => {
    asTouch.on = false;
    expect(html(h(CoachMark, { step, index: 0, total: 2, onSkip: noop, onNext: noop }))).toContain('Click &quot;Got it&quot; to carry on.');
    expect(hud()).toContain('aria-label="Pause (Esc)"');
    expect(html(h(TopBar, { state, reduced: true, canPause: true, onPause: noop }))).toContain('aria-label="Pause (Esc)"');
    expect(html(h(PauseMenu, { open: true, onResume: noop, onRestart: noop, onQuit: noop, onMute: noop }))).toContain('tc-menu-keys');
  });
});

describe('nothing in the Tiffin UI asks the pointer media query on its own', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const files = walk(root).filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f));
  it('no matchMedia of (pointer: coarse), (pointer: fine), (any-pointer ...) or (hover: ...) in a component or a hook', () => {
    expect(files.length).toBeGreaterThan(20);
    const bad = files.filter((f) => /matchMedia\([^)]*(pointer|hover)\s*:/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
