// HUD fixes from the end-to-end QA run (docs/TIFFIN_CENTRE_PROOF.md): H3 co-op Leave slot, H5 the dock that scrolls, H6 bubbles clear of the panels,
// H7 the Board chip, H10 the compact status strip. CSS rules are checked as text (no browser in the node test run).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createGame } from '@shared/tiffin-centre/index.js';
import HudLayer from './HudLayer.jsx';
import TopBar from './TopBar.jsx';
import StallStatus, { statusAlerts } from './StallStatus.jsx';
import StationsDock, { DENSE_FROM, scrollIntoDock } from './StationsDock.jsx';
import { freeBounds } from './EdgeIndicators.jsx';
import { clampBubble } from './offscreen.js';
import { spotKeys } from './hudLogic.js';
import { gasView, prepView, stockGroups } from './opsLogic.js';

const css = readFileSync(new URL('./hud.css', import.meta.url), 'utf8');
const game = (level) => createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level, pace: 'normal' }, seed: 5 });
const session = (extra = {}) => ({ meId: 'me', mode: 'practice', players: [{ id: 'me', name: 'Me' }], pause() {}, subscribe: () => () => {}, dispatch: () => true, tutorial: null, ...extra });
const render = (state, extra = {}, props = {}) =>
  renderToStaticMarkup(createElement(HudLayer, { session: session(extra), scene: null, state, tickAt: 0, status: 'playing', connection: 'open', reducedOverride: false, ...props }));
const none = new Set();

describe('H3: co-op Leave lives in the top bar, in the pause slot', () => {
  it('online with onLeave: a Leave button instead of Pause, and the root says so for the glue', () => {
    const h = render(game(4), { mode: 'online' }, { onLeave() {} });
    expect(h).toContain('aria-label="Leave the table"');
    expect(h).toContain('tc-hud-leave');
    expect(h).not.toContain('aria-label="Pause (Esc)"');
    expect(h).toContain('tc-hud--has-leave');
  });
  it('online without onLeave keeps the old behaviour (no Leave here, the glue draws its own, no has-leave class)', () => {
    const h = render(game(4), { mode: 'online' });
    expect(h).not.toContain('tc-hud-leave');
    expect(h).not.toContain('tc-hud--has-leave');
  });
  it('solo ignores onLeave and keeps Pause', () => {
    const h = render(game(4), { mode: 'practice' }, { onLeave() {} });
    expect(h).toContain('aria-label="Pause (Esc)"');
    expect(h).not.toContain('tc-hud-leave');
  });
  it('TopBar renders Leave next to Mute and the button is 44 px high (the .tc-hud-btn size)', () => {
    const h = renderToStaticMarkup(createElement(TopBar, { state: game(4), reduced: true, canPause: false, onMute() {}, onLeave() {} }));
    expect(h).toMatch(/aria-label="Mute"[\s\S]*aria-label="Leave the table"/);
    expect(css).toMatch(/\.tc-hud-btn \{[^}]*height: 44px/);
    expect(css).toMatch(/\.tc-hud-leave \{[^}]*min-width: 44px/);
  });
  it('CSS hides the glue .tc-leave once the HUD has its own, and moves the team bar off the status strip on phone landscape', () => {
    expect(css).toMatch(/\.tc-hud--has-leave ~ \.tc-leave/);
    expect(css).toMatch(/\.tc:has\(\.tc-hud--has-leave\) \.tc-leave \{ display: none/);
    expect(css).toMatch(/@media \(max-height: 520px\) and \(min-width: 600px\) \{\s*\.tc-hud-coop \{ position: relative;[^}]*grid-area: mid/);
  });
});

describe('H5: the dock never clips a station', () => {
  const s = game(12);
  const dock = (extra = {}) => renderToStaticMarkup(createElement(StationsDock, { state: s, spot: none, walking: none, onSlot() {}, onFocusTarget() {}, prep: prepView(s), onPrep() {}, ...extra }));
  it('is dense from five groups (level 12 has the prep counter too) and wrapped for the edge fades', () => {
    expect(DENSE_FROM).toBe(5);
    expect(dock()).toContain('data-dense="1"');
    expect(dock()).toContain('tc-hud-dockwrap');
    expect(dock()).toContain('tc-hud-dock-fade is-l');
    expect(dock()).toContain('tc-hud-dock-fade is-r');
    const l1 = game(1);
    expect(renderToStaticMarkup(createElement(StationsDock, { state: l1, spot: none, walking: none, onSlot() {}, onFocusTarget() {} }))).not.toContain('data-dense');
  });
  it('CSS starts at the left edge (no justify-content: center losing the left half) and centres with auto margins', () => {
    const tail = css.slice(css.lastIndexOf('H5: the stations dock'));
    expect(tail).toMatch(/\.tc-hud-dock \{ justify-content: flex-start/);
    expect(tail).toMatch(/\.tc-hud-dock > :first-child \{ margin-left: auto/);
    expect(tail).toMatch(/\.tc-hud-dock > :last-child \{ margin-right: auto/);
    expect(tail).toMatch(/\.tc-hud-dock\[data-dense='1'\] \.tc-hud-slot \{ width: 44px; height: 44px/);
  });
  it('scrollIntoDock brings a cut-off station fully in, either side, and leaves a visible one alone', () => {
    const box = (left, right) => ({ getBoundingClientRect: () => ({ left, right }) });
    const mk = (left, right) => Object.assign(box(left, right), { scrollLeft: 100 });
    const d = mk(100, 500);
    scrollIntoDock(d, box(60, 160)); // cut off on the left
    expect(d.scrollLeft).toBe(100 - (100 + 8 - 60));
    const e = mk(100, 500);
    scrollIntoDock(e, box(420, 560)); // cut off on the right
    expect(e.scrollLeft).toBe(100 + (560 - (500 - 8)));
    const f = mk(100, 500);
    scrollIntoDock(f, box(200, 300));
    expect(f.scrollLeft).toBe(100);
    expect(() => scrollIntoDock(null, null)).not.toThrow();
  });
});

describe('H6: bubbles stay clear of the HUD panels', () => {
  const bounds = { top: 60, bottom: 300, left: 150, right: 700 };
  const size = { w: 120, h: 50 };
  it('a bubble over the right-hand board slides left of it', () => {
    expect(clampBubble({ x: 760, y: 200 }, size, bounds)).toEqual({ x: 700 - 60 - 4, y: 200 });
  });
  it('a bubble over the chit rail slides right of it', () => {
    expect(clampBubble({ x: 40, y: 200 }, size, bounds).x).toBe(150 + 60 + 4);
  });
  it('a bubble that would poke under the top bar or sink into the dock is held inside the free height', () => {
    expect(clampBubble({ x: 400, y: 70 }, size, bounds).y).toBe(60 + 50 + 4);
    expect(clampBubble({ x: 400, y: 400 }, size, bounds).y).toBe(300 - 4);
  });
  it('leaves a free bubble alone, tolerates missing bounds, and centres one wider than the free strip', () => {
    expect(clampBubble({ x: 400, y: 200 }, size, bounds)).toEqual({ x: 400, y: 200 });
    expect(clampBubble({ x: 400, y: 200 }, size, null)).toEqual({ x: 400, y: 200 });
    expect(clampBubble({ x: 400, y: 200 }, size, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual({ x: 400, y: 200 });
    expect(clampBubble({ x: 0, y: 200 }, { w: 900, h: 50 }, bounds).x).toBe(425);
    expect(clampBubble({ x: NaN, y: NaN }, size, bounds)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });
  it('freeBounds knows the right-hand board column (and the chit rail on the left)', () => {
    const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
    const parts = {
      '.tc-hud-top': rect(0, 0, 1280, 70),
      '.tc-hud-board': rect(1000, 90, 1270, 700),
      '.tc-hud-bottom': rect(0, 720, 1280, 800),
      '.tc-hud-railbox': rect(10, 90, 300, 700),
    };
    const root = { getBoundingClientRect: () => rect(0, 0, 1280, 800), querySelector: (sel) => (parts[sel] ? { getBoundingClientRect: () => parts[sel] } : null) };
    expect(freeBounds(root, 1280, 800)).toEqual({ top: 70, bottom: 720, left: 300, right: 1000 });
  });
  it('CSS paints the bubbles under every panel', () => {
    expect(css).toMatch(/\.tc-hud-bubbles, \.tc-hud-edges \{ z-index: 1; \}/);
    expect(css).toMatch(/\.tc-hud-board, \.tc-hud-railbox, \.tc-hud-bottom, \.tc-hud-coop \{ position: relative; z-index: 2; \}/);
  });
});

describe('H7: the Board chip', () => {
  it('reads Board in full and is not a fixed 64 px any more', () => {
    const h = renderToStaticMarkup(createElement(StallStatus, { state: game(12), onStock() {}, onSwap() {}, onBoard() {} }));
    expect(h).toMatch(/is-board[^>]*>[\s\S]*?Board<\/span>/);
    expect(css.lastIndexOf('.tc-hud-stockbar.is-board { width: auto')).toBeGreaterThan(css.indexOf('.tc-hud-stockbar.is-board { --tone: #ffe08a; width: 64px')); // the fix comes after the old fixed width, and wins
    expect(css).toMatch(/\.tc-hud-stockbar\.is-board \{ width: auto; min-width: 74px; \}/);
  });
});

describe('H10: compact status strip on short screens', () => {
  const s = game(12);
  const h = renderToStaticMarkup(createElement(StallStatus, { state: s, onStock() {}, onSwap() {}, onBoard() {} }));
  it('has a toggle button with expanded state, an alert count, and the strip behind it', () => {
    expect(h).toContain('class="tc-hud-status-toggle"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('aria-controls="tc-hud-status-body"');
    expect(h).toContain('id="tc-hud-status-body"');
    expect(h).toContain('data-open="0"');
    expect(h).toContain('aria-label="Stall status"');
  });
  it('a tutorial spotlight on the gas stand or the board opens it', () => {
    const t = renderToStaticMarkup(createElement(StallStatus, { state: s, onStock() {}, onSwap() {}, onBoard() {}, spot: new Set(['gas']) }));
    expect(t).toContain('data-open="1"');
    expect(t).toContain('tc-hud-gas-swap is-spot');
    const b = renderToStaticMarkup(createElement(StallStatus, { state: s, onStock() {}, onSwap() {}, onBoard() {}, spot: new Set(['board']) }));
    expect(b).toContain('data-open="1"');
    expect(b).toMatch(/is-board is-spot" data-spot="board"/);
    expect(renderToStaticMarkup(createElement(StallStatus, { state: s, onStock() {}, onSwap() {}, onBoard() {}, forceOpen: true }))).toContain('data-open="1"');
  });
  it('counts what needs a look and flags the urgent ones', () => {
    const calm = statusAlerts({ events: [], groups: stockGroups(game(3)).map((g) => ({ ...g, tone: 'ok' })), gas: { tone: 'ok' } });
    expect(calm).toEqual({ count: 0, urgent: false });
    const g = stockGroups(game(3));
    expect(statusAlerts({ events: [], groups: [{ ...g[0], tone: 'low' }], gas: { tone: 'low' } })).toEqual({ count: 2, urgent: false });
    expect(statusAlerts({ events: [], groups: [{ ...g[0], tone: 'out' }], gas: gasView(game(3)) })).toEqual({ count: 1, urgent: true });
    expect(statusAlerts({ events: [{ id: 'inspector' }], groups: [], gas: null })).toEqual({ count: 1, urgent: true });
  });
  it('CSS: folded behind the button only on short screens; the button is hidden elsewhere and is a 44 px target', () => {
    expect(css).toMatch(/\.tc-hud-status-toggle \{ display: none; \}\s*@media \(max-height: 460px\) and \(min-width: 600px\)/);
    const compact = css.slice(css.lastIndexOf('@media (max-height: 460px) and (min-width: 600px)'));
    expect(compact).toMatch(/\.tc-hud-status\[data-open='0'\] \.tc-hud-status-body \{ display: none; \}/);
    expect(compact).toMatch(/\.tc-hud-status-toggle \{[^}]*min-height: 44px/);
  });
  it('CSS: the compact layout keeps 44 px chit and chip targets and a slim 152 px chit rail', () => {
    const compact = css.slice(css.lastIndexOf('@media (max-height: 460px) and (min-width: 600px)'));
    expect(compact).toMatch(/grid-template-columns: 152px minmax\(0, 1fr\) 144px/);
    expect(compact).toMatch(/\.tc-hud-collect \{ min-height: 44px/);
    expect(compact).toMatch(/\.tc-hud-chip-meta/);
    expect(compact).not.toMatch(/min-height: [0-3]\dpx/); // nothing below a 40 px box on a control
  });
});

describe('the tutorial pulses the ops controls it points at', () => {
  it('gas and board spotlights map to the Swap button and the Board chip', () => {
    expect([...spotKeys({ kind: 'gas', look: true }, game(0))]).toEqual(['gas']);
    expect([...spotKeys({ kind: 'board', look: true }, game(0))]).toEqual(['board']);
  });
  it('a pan that needs tending gets its Tend button pulsed when the lesson points at the station', () => {
    const s = applyHeat(game(0));
    expect(s.cfg.heat).toBe(true);
    expect([...spotKeys({ kind: 'station', id: 'tawa1' }, s)]).toEqual(expect.arrayContaining(['station:tawa1', 'tend:tawa1']));
    expect([...spotKeys({ kind: 'station', id: 'tawa1' }, game(0))]).toEqual(['station:tawa1']); // nothing to tend in a bare training shift
  });
});

function applyHeat(s) {
  const next = structuredClone(s);
  next.cfg.heat = true;
  next.stations.tawa1.heat = 40;
  next.stations.tawa1.gunk = 72;
  next.stations.tawa1.tendAt = 0;
  return next;
}
