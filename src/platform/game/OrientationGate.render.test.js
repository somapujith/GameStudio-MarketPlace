// Markup of the gate with a stubbed window: children stay mounted but hidden and inert, the screen says everything twice (English and
// Telugu), the paused signal reaches a game through context, and desktop / a landscape phone / a game with no policy are untouched.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import OrientationGate, { ManifestOrientationGate, PhoneTurnIcon, TurnScreen } from './OrientationGate.jsx';
import { useGamePaused, useOrientationState } from './orientationContext.js';
import { DEVICES, fakeWindow } from './orientation.fakes.js';

const html = (node) => renderToStaticMarkup(h(MemoryRouter, null, node)).replaceAll('<!-- -->', '');
const Probe = () => h('p', { id: 'probe' }, `paused:${useGamePaused()}`);
const game = { id: 'autowala', name: 'Autowala', theme: { accent: '#ff3d9a', accent2: '#37e6ff', bg: '#120824' }, orientation: 'landscape' };
const gate = (device, over = {}) =>
  html(h(OrientationGate, { policy: 'landscape', game, backTo: '/games/autowala', win: fakeWindow(DEVICES[device]), ...over }, h('div', { id: 'game' }, 'THE GAME'), h(Probe)));

describe('OrientationGate markup', () => {
  it('a phone held upright: the game stays in the DOM, hidden and inert, and the screen covers it', () => {
    const out = gate('iPhone 14 portrait');
    expect(out).toContain('THE GAME'); // still mounted: no state is lost
    expect(out).toContain('data-og="paused"');
    expect(out).toMatch(/class="og-game"[^>]*inert=""|inert=""[^>]*class="og-game"/);
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('Turn your phone sideways');
    expect(out).toContain('ఫోన్‌ను అడ్డంగా తిప్పండి');
    expect(out).toContain('lang="te"');
    expect(out).toContain('Autowala plays best in landscape');
    expect(out).toContain('href="/games/autowala"'); // Back to the game page
    expect(out).toContain('Back to the game page');
    expect(out).toContain('paused:true'); // the game's loop reads this
    expect(out).toContain('--g-accent:#ff3d9a'); // dressed in the game's colours
  });

  it('a tablet held upright is gated too', () => {
    expect(gate('iPad portrait')).toContain('data-og="paused"');
  });

  it('the same phone turned sideways: the game, untouched, and no screen', () => {
    const out = gate('iPhone 14 landscape');
    expect(out).toContain('data-og="live"');
    expect(out).not.toContain('inert');
    expect(out).not.toContain('data-og-gate');
    expect(out).toContain('paused:false');
    expect(out).toContain('THE GAME');
  });

  it('desktop is never gated, even in a narrow, tall window', () => {
    for (const d of ['desktop 1280x800', 'desktop narrow window 600x900', 'desktop phone-sized window 390x844']) {
      const out = gate(d);
      expect(out, d).toContain('data-og="live"');
      expect(out, d).not.toContain('data-og-gate');
      expect(out, d).toContain('paused:false');
    }
  });

  it('policy "any" never gates; policy "portrait" gates a phone held sideways', () => {
    expect(gate('iPhone 14 portrait', { policy: 'any' })).toContain('data-og="live"');
    const out = gate('iPhone 14 landscape', { policy: 'portrait' });
    expect(out).toContain('data-og="paused"');
    expect(out).toContain('Hold your phone upright');
  });

  it('the wrapper has no box of its own (display: contents) and the page cannot show it while paused', () => {
    const css = readFileSync(new URL('./orientation.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.og-game\s*\{[^}]*display:\s*contents/);
    expect(css).toMatch(/\.og-game\[data-og='paused'\]\s*\{[^}]*visibility:\s*hidden/);
  });
});

describe('TurnScreen', () => {
  it('shows the "Tap to play in landscape" button only when the browser can lock the orientation', () => {
    expect(html(h(TurnScreen, { canLock: true, backTo: '/' }))).toContain('Tap to play in landscape');
    expect(html(h(TurnScreen, { canLock: true, backTo: '/' }))).toContain('ల్యాండ్‌స్కేప్‌లో ఆడటానికి నొక్కండి');
    expect(html(h(TurnScreen, { canLock: false, backTo: '/' }))).not.toContain('data-og-play'); // iPhone Safari: the screen alone is the solution
  });

  it('is a labelled dialog with the heading and the body described', () => {
    const out = html(h(TurnScreen, { backTo: '/' }));
    expect(out).toContain('aria-labelledby="og-title"');
    expect(out).toContain('aria-describedby="og-body"');
    expect(out).toContain('id="og-title"');
    expect(out).toContain('id="og-body"');
    expect(out).toContain('Screen rotation locked?');
  });

  it('the icon is decorative (hidden from screen readers) and has a reverse form', () => {
    expect(html(h(PhoneTurnIcon))).toContain('aria-hidden="true"');
    expect(html(h(PhoneTurnIcon, { reverse: true }))).toContain('og-icon--reverse');
  });
});

describe('ManifestOrientationGate', () => {
  it('a game with no `orientation` renders as before: no wrapper at all', () => {
    const out = html(h(ManifestOrientationGate, { game: { id: 'x', name: 'X' } }, h('div', { id: 'game' }, 'plain')));
    expect(out).toBe('<div id="game">plain</div>');
  });
  it("`orientation: 'any'` and unknown values likewise", () => {
    for (const orientation of ['any', 'diagonal', undefined]) expect(html(h(ManifestOrientationGate, { game: { orientation } }, h('i', null, 'x'))), String(orientation)).toBe('<i>x</i>');
  });
  it("`orientation: 'landscape'` mounts the gate", () => {
    const out = html(h(ManifestOrientationGate, { game, backTo: '/' }, h('i', null, 'x')));
    expect(out).toContain('og-game');
  });
});

describe('the context outside a gate', () => {
  it('is never paused (a game can call the hook unconditionally)', () => {
    const Show = () => h('b', null, JSON.stringify(useOrientationState()));
    expect(html(h(Show))).toContain('&quot;paused&quot;:false');
    expect(html(h(Probe))).toContain('paused:false');
  });
});

describe('orientation.css', () => {
  const css = readFileSync(new URL('./orientation.css', import.meta.url), 'utf8');
  it('uses the visible viewport height and every safe-area inset', () => {
    expect(css).toContain('100dvh');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(css).toContain(`env(safe-area-inset-${side}`);
  });
  it('stops the animation for reduced motion (OS setting and the hub switch)', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(":root[data-motion='reduced']");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation:\s*none/);
  });
  it('has 44px+ targets and lets a tiny window scroll to them', () => {
    expect(css).toMatch(/\.og-btn\s*\{[^}]*min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(css).toMatch(/\.og-gate\s*\{[^}]*overflow-y:\s*auto/);
  });
});
