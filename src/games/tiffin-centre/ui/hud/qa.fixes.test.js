// HUD fixes from the end-to-end QA run (docs/TIFFIN_CENTRE_PROOF.md): H3 co-op Leave slot, H5 the dock that scrolls, H6 bubbles clear of the panels,
// H7 the Board chip, H10 the compact status strip. CSS rules are checked as text (no browser in the node test run).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { coachInsets } from '../menus/menuModels.js';
import { createGame } from '@shared/tiffin-centre/index.js';
import HudLayer from './HudLayer.jsx';
import TopBar from './TopBar.jsx';
import StallStatus, { statusAlerts } from './StallStatus.jsx';
import StationsDock, { DENSE_FROM, dockRows, scrollIntoDock } from './StationsDock.jsx';
import { freeBounds } from './EdgeIndicators.jsx';
import { clampBubble } from './offscreen.js';
import { prepButtonGate, spotKeys } from './hudLogic.js';
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
    expect(css).toMatch(/\.tc-hud-btn \{[^}]*height: calc\(44 \* var\(--u\)\)/);
    expect(css).toMatch(/\.tc-hud-leave \{[^}]*min-width: calc\(44 \* var\(--u\)\)/);
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
  it('keeps bubbles and arrows below the tutorial coach bar when it hangs at the top (it is a sibling layer of the HUD), and ignores one in the lower half', () => {
    const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
    const parts = { '.tc-hud-top': rect(0, 0, 1280, 70), '.tc-hud-bottom': rect(0, 720, 1280, 800) };
    const withCoach = (coachRect) => ({
      getBoundingClientRect: () => rect(0, 0, 1280, 800),
      querySelector: (sel) => (parts[sel] ? { getBoundingClientRect: () => parts[sel] } : null),
      parentElement: { querySelector: (sel) => (sel === '.tc-menu-coachbar' && coachRect ? { getBoundingClientRect: () => coachRect } : null) },
    });
    expect(freeBounds(withCoach(rect(300, 80, 900, 140)), 1280, 800).top).toBe(144); // under the bar, with a 4 px margin
    expect(freeBounds(withCoach(rect(300, 600, 900, 660)), 1280, 800).top).toBe(70); // a bar in the lower half (a narrow window) does not move the top
    expect(freeBounds(withCoach(null), 1280, 800).top).toBe(70);
  });
});

describe('H7: the Board chip', () => {
  it('reads Board in full and is not a fixed 64 px any more', () => {
    const h = renderToStaticMarkup(createElement(StallStatus, { state: game(12), onStock() {}, onSwap() {}, onBoard() {} }));
    expect(h).toMatch(/is-board[^>]*>[\s\S]*?Board<\/span>/);
    expect(css).toMatch(/\.tc-hud-stockbar\.is-board \{ width: 100%; min-width: calc\(74 \* var\(--u\)\); \}/); // fills the stock panel; the old fixed 64 px clipped the last letter
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

// ---- H5 (final): the wide dock wraps, so 5 stations + prep + Tend buttons are all in view at 1280 x 800 ----------------------------------------------
describe('H5 final: on a wide screen the dock wraps into rows instead of clipping', () => {
  it('level 12 renders every station group and the prep counter, each with its Tend button room', () => {
    const s = game(12);
    const html = renderToStaticMarkup(createElement(StationsDock, { state: s, spot: none, walking: none, onSlot() {}, onFocusTarget() {}, prep: prepView(s), onPrep() {}, renderExtra: () => createElement('button', { className: 'tc-hud-tendbtn' }, 'Tend') }));
    expect((html.match(/class="tc-hud-station[ "]/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('aria-label="Prep counter"');
    expect(html).toContain('Open the prep counter (P)');
  });
  it('dockRows counts the distinct tops of the groups', () => {
    expect(dockRows([{ offsetTop: 8 }, { offsetTop: 8 }, { offsetTop: 8.4 }])).toBe(1);
    expect(dockRows([{ offsetTop: 8 }, { offsetTop: 8 }, { offsetTop: 100 }, { offsetTop: 100 }])).toBe(2);
    expect(dockRows([])).toBe(0);
    expect(dockRows(null)).toBe(0);
  });
});

// ---- T2: no coach element over a sheet ---------------------------------------------------------------------------------------------------------------
describe('T2: the coach bar never lies over a sheet', () => {
  const coachSrc = readFileSync(new URL('../menus/CoachMark.jsx', import.meta.url), 'utf8');
  const hudSrc = readFileSync(new URL('./HudLayer.jsx', import.meta.url), 'utf8');
  it('a bar in the lower half is a bottom inset, a bar in the upper half a top inset, and nothing is nothing', () => {
    const host = { top: 0, height: 844 };
    expect(coachInsets({ top: 560, height: 48 }, host)).toEqual({ bottomOn: 1, bottomH: 52, topOn: 0, topH: 0, subsH: 52 });
    expect(coachInsets({ top: 100, height: 61.2 }, { top: 0, height: 800 })).toEqual({ bottomOn: 0, bottomH: 0, topOn: 1, topH: 66, subsH: 0 });
    expect(coachInsets(null, host)).toMatchObject({ bottomOn: 0, topOn: 0 });
    expect(coachInsets({ top: 0, height: 0 }, host)).toMatchObject({ bottomOn: 0, topOn: 0 });
  });
  it('every sheet wrapper (action, cook, prep, board) is inset below a top bar and, on phones, above a bottom bar', () => {
    // the top inset is part of the wrapper's padding; the coach bar is only at the bottom in a narrow window, where the sheet sits above the dock
    expect(css).toMatch(/\.tc-hud-sheetwrap \{[^}]*padding: calc\(var\(--tc-coach-top-on, 0\) \* \(var\(--tc-hud-top, 0px\) \+ 2px\) \+ var\(--tc-coach-top-h, 0px\)\) 0 0;/);
    expect(css).toMatch(/@media \(max-aspect-ratio: 1\/1\) \{[\s\S]*\.tc-hud-sheetwrap \{ align-items: flex-end; padding-bottom: calc\(var\(--tc-hud-bottom, 120px\) \+ 4px\); \}/);
    // the sheet wrapper is the only HUD layer above the coach's reach: board, prep and action sheets share it
    for (const f of ['PrepSheet.jsx', 'BoardSheet.jsx', 'ActionSheet.jsx']) expect(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).toContain('tc-hud-sheetwrap');
  });
  it('the HUD flags an open sheet on the game root and the coach folds its card while it is flagged', () => {
    expect(hudSrc).toMatch(/const sheetOpen = !!sheet \|\| !!panel;/);
    expect(hudSrc).toContain("host.setAttribute('data-hud-sheet', '1')");
    expect(coachSrc).toContain("attributeFilter: ['data-hud-sheet']");
    expect(coachSrc).toContain('const shown = open && !covered;');
    expect(coachSrc).toContain('hidden={!shown}');
  });
});

// ---- T3: the dock's Prep button only walks when the step allows walking but not prepping ----------------------------------------------------------------
describe('T3: the Prep button under the tutorial gate', () => {
  it('opens the sheet when prepping is allowed or nothing is gated', () => {
    expect(prepButtonGate(undefined)).toBe('open');
    expect(prepButtonGate(null, true)).toBe('open');
    expect(prepButtonGate(['move', 'prep', 'collectPrep'])).toBe('open');
    expect(prepButtonGate((a) => a.type === 'prep')).toBe('open');
  });
  it('walks to the back counter when the step allows only move (stock-turn), not "not yet"', () => {
    expect(prepButtonGate(['move'], false)).toBe('walk');
    expect(prepButtonGate(['walk'], false)).toBe('walk');
    expect(prepButtonGate((a) => a.type === 'move', false)).toBe('walk');
  });
  it('is the friendly refusal when already there (prepping not taught yet) or when walking is refused too', () => {
    expect(prepButtonGate(['move'], true)).toBe('blocked');
    expect(prepButtonGate(['cook'], false)).toBe('blocked');
    expect(prepButtonGate([], false)).toBe('blocked');
    expect(prepButtonGate(false, false)).toBe('blocked');
  });
});
