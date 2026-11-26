// The operations layer rendered to static markup: status strip, Tend buttons, prep group and sheet, board, chit badges, profit books.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAction, createGame } from '@shared/tiffin-centre/index.js';
import HudLayer from './HudLayer.jsx';
import PrepSheet from './PrepSheet.jsx';
import BoardSheet from './BoardSheet.jsx';
import ActionSheet from './ActionSheet.jsx';
import Availability from './Availability.jsx';
import StallStatus from './StallStatus.jsx';
import { availability } from './hudLogic.js';
import { boardMap } from './opsLogic.js';
import { mkCustomer } from './testState.js';

const game = (level) => createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level, pace: 'normal' }, seed: 5 });
const session = (extra = {}) => ({ meId: 'me', mode: 'practice', players: [{ id: 'me', name: 'Me' }], pause() {}, subscribe: () => () => {}, dispatch: () => true, tutorial: null, ...extra });
const render = (state, extra = {}) => renderToStaticMarkup(createElement(HudLayer, { session: session(extra), scene: null, state, tickAt: 0, status: 'playing', connection: 'open', reducedOverride: false }));

function busyStall() {
  const s = game(5);
  s.tick = 40;
  s.money = 600;
  s.cost = 230;
  s.profit = 370; // cash (600) is over level 5's one-star target (390), profit is not: the star bar must follow profit
  s.gas.u = 150;
  s.stock.batter_dosa = 0;
  s.stock.batter_idly = 14;
  s.fresh.batter_idly = 22;
  s.stations.tawa1.gunk = 55;
  s.stations.tawa1.heat = 40;
  s.stations.steamer1.water = 12;
  s.stations.prep1.slots[0] = { st: 'cooking', item: 'sambar', t0: 35, readyAt: 45, by: 'me' };
  s.stations.prep1.slots[1] = { st: 'ready', item: 'coconut_chutney', t0: 20, readyAt: 26, by: 'me' };
  s.stations.tawa1.slots[0] = { st: 'ready', dish: 'dosa', t0: 30, readyAt: 36, burnAt: 43, by: 'me', fl: 1 };
  s.events = [{ id: 'rain', until: 70 }, { id: 'inspector', until: 49 }];
  s.customers = [
    mkCustomer({ id: 1, spot: 0, name: 'Ravi anna', order: ['dosa'], parcel: true, extra: 'sambar', spice: 'less', regular: true, loyal: 2 }),
    mkCustomer({ id: 2, spot: 1, name: 'Padma', order: ['dosa', 'masala_dosa', 'idly', 'dosa', 'idly', 'dosa'], big: true, patience: 90, patienceMax: 100 }),
    mkCustomer({ id: 3, spot: 2, name: 'Boy', order: ['idly'], delivery: true, patience: 44, patienceMax: 48 }),
  ];
  return s;
}

describe('the HUD on a shift with the operations layer', () => {
  const html = render(busyStall());

  it('stall status strip: events, stock bars by group with freshness and out / sour warnings', () => {
    expect(html).toContain('aria-label="Stall status"');
    expect(html).toContain('వర్షం'); // rain, in Telugu
    expect(html).toContain('Inspector in 9s');
    expect(html).toMatch(/data-tone="out"[^>]*data-group="batter"/);
    expect(html).toMatch(/Dosa batter 0, out/); // an ingredient at zero has no freshness to report (QA B3)
    expect(html).not.toMatch(/Dosa batter 0, \d+ percent fresh/);
    expect(html).toContain('Idly batter 14, 22 percent fresh, sour');
    expect(html).toContain('Sour!');
    for (const g of ['chutney', 'sambar', 'masala', 'oil', 'drinks']) expect(html).toContain(`data-group="${g}"`);
    expect(html).toContain('Press to prepare more');
  });

  it('LPG gauge with a low warning and the Swap button with its cost', () => {
    expect(html).toContain('LPG cylinder: 15 percent, running low');
    expect(html).toContain('aria-label="Swap the cylinder for ₹90"');
    expect(html).toContain('data-tone="low"');
  });

  it('money shows cash, cost and profit, and the star bar is about profit', () => {
    expect(html).toContain('₹600');
    expect(html).toContain('aria-label="Cost ₹230, profit ₹370"');
    expect(html).toContain('Profit toward');
    expect(html).toContain('aria-valuetext="0 of 3 stars"'); // level 5 needs 390 profit for one star: 370 is not enough, although the 600 in the till is
  });

  it('each pan has a Tend button with its gauge; the chai counter has none', () => {
    expect(html).toMatch(/data-spot="tend:tawa1"/);
    expect(html).toContain('Dosa tawa: Needs wiping. Press to wipe (T)');
    expect(html).toContain('Idly steamer: Low water. Press to top up (T)');
    expect(html).toContain('Fry kadai: Clean. Already clean');
    expect(html).not.toContain('tend:chai1');
    expect(html).toContain('tc-hud-tendbtn is-tend is-dock is-pulse');
  });

  it('the dock has the prep counter group with job slots and a collect-ready alert', () => {
    expect(html).toContain('aria-label="Prep counter"');
    expect(html).toContain('Prep job 1: Sambar, 5 seconds left');
    expect(html).toContain('Prep job 2: Coconut chutney ready. Press to collect it');
    expect(html).toContain('aria-label="Open the prep counter (P)"');
    expect(html).toMatch(/data-alert="1"[^>]*aria-keyshortcuts="P"/);
    expect(html).not.toContain('aria-label="Stations"><div class="tc-hud-station" data-spot="station:prep1"'); // it is the last group, not the first
  });

  it('a ready dish that came out stuck says so on its slot', () => {
    expect(html).toContain('Dosa tawa, slot 1: Plain Dosa ready, stuck to the pan: it will come out only OK. Press to take it');
    expect(html).toContain('data-flaw="stuck"');
  });

  it('availability chips: out of batter, mark sold out, plus a board button', () => {
    expect(html).toContain('Out of dosa batter');
    expect(html).toContain('aria-label="Mark Plain Dosa sold out"');
    expect(html).toContain('Mark sold out');
    expect(html).toMatch(/Menu board: 0 sold out, 3 cannot be made right now/); // dosa, masala dosa and set dosa all need the batter
  });

  it('chits carry request badges, REGULAR with loyalty, BIG OFFICE ORDER and DELIVERY BOY with timers', () => {
    expect(html).toContain('REGULAR');
    expect(html).toContain('Extra sambar');
    expect(html).toContain('Spice less');
    expect(html).toContain('BIG OFFICE ORDER');
    expect(html).toContain('DELIVERY BOY');
    expect(html).toContain('>90s<');
    expect(html).toContain('>44s<');
    expect(html).toContain('data-badges="1"');
    expect(html).toContain('Regular customer: loyalty 2 of 3');
  });
});

// the tutorial's lessons switch one mechanic on at a time (`tutorial-flags`): the HUD shows the controls of exactly the switches that are on
const train = (s, flags) => {
  const r = applyAction(s, { type: 'tutorial-flags', ...flags });
  expect(r.error).toBeUndefined();
  return r.state;
};
const tutorial = (flags = null) => {
  const s = game(0);
  s.customers = [mkCustomer({ id: 1 })];
  return flags ? train(s, flags) : s;
};
const PLAIN = ['Stall status', 'tc-hud-tendbtn', 'Prep counter', 'Profit toward', 'tc-hud-books', 'tc-hud-stockbar', 'Mark sold out', 'LPG cylinder', 'Menu board'];

describe('the tutorial shows the operations controls its lessons have switched on', () => {
  it('a bare training shift (before the switches) has no stall status, no tend, no prep group, no cost or profit', () => {
    const h = render(tutorial(), { mode: 'tutorial' });
    for (const w of PLAIN) expect(h).not.toContain(w);
  });
  it('stock on: stock bars, the prep counter in the dock, the menu board button and the books', () => {
    const h = render(tutorial({ stock: true }), { mode: 'tutorial' });
    expect(h).toContain('aria-label="Stall status"');
    expect(h).toContain('tc-hud-stockbar');
    expect(h).toContain('aria-label="Prep counter"');
    expect(h).toContain('aria-label="Open the prep counter (P)"');
    expect(h).toContain('Menu board:');
    expect(h).toContain('tc-hud-books');
    expect(h).not.toContain('LPG cylinder');
    expect(h).not.toContain('tc-hud-tendbtn is-tend');
  });
  it('heat on: a Tend button on each pan (and none for stock or gas)', () => {
    const h = render(tutorial({ heat: true }), { mode: 'tutorial' });
    expect(h).toContain('tc-hud-tendbtn is-tend');
    expect(h).toMatch(/Dosa tawa: [^"]*\. Press to wipe \(T\)/);
    expect(h).not.toContain('Prep counter');
    expect(h).not.toContain('LPG cylinder');
  });
  it('gas on: the LPG gauge and the Swap button', () => {
    const h = render(tutorial({ gas: true }), { mode: 'tutorial' });
    expect(h).toContain('aria-label="Stall status"');
    expect(h).toMatch(/LPG cylinder: \d+ percent/);
    expect(h).toContain('aria-label="Swap the cylinder for ₹');
    expect(h).not.toContain('Prep counter');
  });
  it('events on: the banner shows a staged event (and nothing until one runs)', () => {
    const quiet = render(tutorial({ events: true }), { mode: 'tutorial' });
    expect(quiet).not.toContain('Happening now');
    const s = tutorial({ events: true });
    const h = render(train(s, { stage: { event: { id: 'rain', ticks: 30 } } }), { mode: 'tutorial' });
    expect(h).toContain('aria-label="Happening now"');
    expect(h).toContain('వర్షం');
  });
  it('market on: the prep sheet offers the market runner', () => {
    const s = tutorial({ stock: true, market: true });
    const w = renderToStaticMarkup(createElement(PrepSheet, { state: s, onClose() {}, onPrep() {}, onCollect() {}, onBuy() {}, onNotify() {} }));
    expect(w).toContain('Market runner (40% dearer)');
    const off = renderToStaticMarkup(createElement(PrepSheet, { state: tutorial({ stock: true }), onClose() {}, onPrep() {}, onCollect() {}, onBuy() {}, onNotify() {} }));
    expect(off).not.toContain('Market runner');
  });
  it('switching a mechanic back off takes its controls away again', () => {
    const s = train(tutorial({ stock: true, gas: true, heat: true }), { stock: false, gas: false, heat: false });
    const h = render(s, { mode: 'tutorial' });
    for (const w of PLAIN) expect(h).not.toContain(w);
  });
  it('the board sheet opens in the tutorial once the stock is on, and not before', () => {
    expect(renderToStaticMarkup(createElement(BoardSheet, { state: tutorial({ stock: true }), onClose() {}, onToggle() {} }))).toContain('role="switch"');
    expect(renderToStaticMarkup(createElement(BoardSheet, { state: tutorial(), onClose() {}, onToggle() {} }))).toBe('');
  });
});

describe('level 0 and a bare shift hide the layer', () => {
  it('the bare tutorial has no stall status, no tend, no prep group, no cost or profit', () => {
    const h = render(tutorial(), { mode: 'tutorial' });
    for (const w of ['Stall status', 'tc-hud-tendbtn', 'Prep counter', 'Profit toward', 'tc-hud-books', 'tc-hud-stockbar', 'Mark sold out']) expect(h).not.toContain(w);
  });
  it('level 1 shows stock and the prep counter but no gas and no tend', () => {
    const h = render(game(1));
    expect(h).toContain('Stall status');
    expect(h).toContain('aria-label="Prep counter"');
    expect(h).not.toContain('LPG cylinder');
    expect(h).not.toContain('tc-hud-tendbtn is-tend');
    expect(h).toContain('tc-hud-books');
  });
  it('a hand-built state without any of the fields still renders', () => {
    const s = game(3);
    delete s.stock;
    delete s.fresh;
    delete s.gas;
    s.events = undefined;
    expect(() => render(s)).not.toThrow();
  });
});

describe('PrepSheet', () => {
  const s = busyStall();
  const h = renderToStaticMarkup(createElement(PrepSheet, { state: s, selected: 'batter_dosa', onClose() {}, onPrep() {}, onCollect() {}, onBuy() {}, onNotify() {} }));
  it('lists the jobs: progress, collect when ready', () => {
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-label="Prep counter"');
    expect(h).toContain('Job 1: Sambar, 5 seconds left');
    expect(h).toContain('aria-label="Collect 12 portions of Coconut chutney"');
  });
  it('lists the ingredients with recipe, time, cost and yield, and highlights the pre-selected one', () => {
    expect(h).toContain('Grind rice and urad dal');
    expect(h).toContain('+12 · 12s · ₹60');
    expect(h).toMatch(/tc-hud-prep-item is-selected" data-item="batter_dosa"/);
    expect(h).toContain('Dosa batter');
    expect(h).toContain('Out');
    expect(h).toContain('Sour!');
  });
  it('shows soft reasons while a job would wait, and the market runner on market levels (40% dearer)', () => {
    const p = busyStall();
    p.stations.prep1.slots = [{ st: 'empty', item: null }, { st: 'empty', item: null }];
    p.events = [{ id: 'power', until: 99 }];
    p.gas.u = 0;
    const w = renderToStaticMarkup(createElement(PrepSheet, { state: p, onClose() {}, onPrep() {}, onCollect() {}, onBuy() {}, onNotify() {} }));
    expect(w).toContain('Power cut: it will wait');
    expect(w).toContain('No gas: it will wait');
    expect(w).toContain('Market runner (40% dearer)');
    expect(w).toContain('Buy 5');
    expect(w).toContain('₹35'); // 5 portions of dosa batter at 5 x 1.4
  });
  it('shows Slot busy as a hard reason and no market on a level without one', () => {
    const p = game(3);
    p.stations.prep1.slots[0] = { st: 'cooking', item: 'oil', t0: 0, readyAt: 3, by: 'me' };
    p.stations.prep1.slots[1] = { st: 'cooking', item: 'oil', t0: 0, readyAt: 3, by: 'me' };
    const w = renderToStaticMarkup(createElement(PrepSheet, { state: p, onClose() {}, onPrep() {}, onCollect() {}, onBuy() {}, onNotify() {} }));
    expect(w).toContain('Slot busy');
    expect(w).toContain('aria-disabled="true"');
    expect(w).not.toContain('Market runner');
  });
  it('renders nothing on level 0', () => {
    expect(renderToStaticMarkup(createElement(PrepSheet, { state: game(0), onClose() {} }))).toBe('');
  });
});

describe('BoardSheet and the chips', () => {
  it('a switch per dish: on, sold out, and the dish the shelf cannot make is flagged', () => {
    const s = busyStall();
    s.off = ['idly'];
    const h = renderToStaticMarkup(createElement(BoardSheet, { state: s, onClose() {}, onToggle() {} }));
    expect(h).toContain('role="switch"');
    expect(h).toContain('Plain Dosa, ₹40: on the board. Out of dosa batter');
    expect(h).toContain('Idly (2 pc), ₹30: sold out');
    expect(h).toContain('SOLD OUT');
    expect(h).toContain('data-suggest="1"');
  });
  it('a dish off the board is struck through on its chip and offers Back on board', () => {
    const s = busyStall();
    s.off = ['masala_dosa'];
    const h = renderToStaticMarkup(createElement(Availability, { rows: availability(s, 'me'), onChip() {}, board: boardMap(s), onBoard() {} }));
    expect(h).toMatch(/tc-hud-chip is-off"[^>]*data-dish="masala_dosa"/);
    expect(h).toContain('Sold out');
    expect(h).toContain('aria-label="Put Masala Dosa back on the board"');
    expect(h).toContain('Back on board');
  });
});

describe('the cook sheet explains why a dish cannot be made and offers Tend', () => {
  it('says "Out of dosa batter", and a Tend button for the pan', () => {
    const s = busyStall();
    const h = renderToStaticMarkup(createElement(ActionSheet, { sheet: { station: 'tawa1', slot: 1 }, state: s, avail: availability(s, 'me'), onPick() {}, onClose() {}, onTend() {} }));
    expect(h).toContain('Out of dosa batter');
    expect(h).toContain('data-blocked="1"');
    expect(h).toContain('tc-hud-tendbtn is-tend is-sheet');
    expect(h).toContain('This pan needs tending before the next dish.');
  });
  it('no Tend footer without a handler, none on level 1', () => {
    const s = game(1);
    const h = renderToStaticMarkup(createElement(ActionSheet, { sheet: { station: 'tawa1', slot: 0 }, state: s, avail: availability(s, 'me'), onPick() {}, onClose() {}, onTend() {} }));
    expect(h).not.toContain('tc-hud-sheet-foot');
  });
});

describe('StallStatus on its own', () => {
  it('shows the swap progress (6 ticks) while the cylinder is being changed', () => {
    const s = game(3);
    s.gas.sw = 3;
    s.gas.u = 0;
    const h = renderToStaticMarkup(createElement(StallStatus, { state: s, onStock() {}, onSwap() {}, onBoard() {} }));
    expect(h).toContain('role="progressbar" aria-label="Changing the cylinder" aria-valuemin="0" aria-valuemax="6" aria-valuenow="3"');
    expect(h).toContain('Changing 3s');
    expect(h).not.toContain('tc-hud-gas-swap');
  });
  it('renders nothing for the tutorial', () => {
    expect(renderToStaticMarkup(createElement(StallStatus, { state: game(0), onStock() {}, onSwap() {}, onBoard() {} }))).toBe('');
  });
});
