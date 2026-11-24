import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HudLayer from './HudLayer.jsx';
import ActionSheet from './ActionSheet.jsx';
import Availability from './Availability.jsx';
import { availability } from './hudLogic.js';
import { mkState, mkCustomer, mkSlot } from './testState.js';

function world(over = {}) {
  const s = mkState({ level: 3, cfg: { menu: ['dosa', 'masala_dosa', 'irani_chai', 'idly'], spots: 4 }, ...over });
  s.stations.tawa1.slots = [mkSlot({ st: 'ready', dish: 'dosa' }), mkSlot({ st: 'cooking', dish: 'masala_dosa', t0: 18, readyAt: 26, burnAt: 33 }), mkSlot()];
  s.players.me.hands = [{ dish: 'dosa', q: 'perfect' }];
  s.customers = [
    mkCustomer({ id: 1, spot: 0, name: 'Ravi anna', order: ['dosa', 'irani_chai'], got: ['irani_chai'] }),
    mkCustomer({ id: 2, spot: 1, name: 'Fatima aapa', kind: 'student', st: 'paying', payLeft: 6, order: ['idly'], got: ['idly'], total: 30 }),
    mkCustomer({ id: 3, spot: 2, name: 'Padma', st: 'eating', eatLeft: 2, order: ['dosa'], got: ['dosa'] }),
  ];
  return s;
}
const session = (extra = {}) => ({ meId: 'me', mode: 'practice', players: [{ id: 'me', name: 'Me' }, { id: 'u2', name: 'Anu' }], pause() {}, subscribe: () => () => {}, dispatch: () => true, tutorial: null, ...extra });
const render = (state, extra = {}, props = {}) =>
  renderToStaticMarkup(createElement(HudLayer, { session: session(extra), scene: null, state, tickAt: 0, status: 'playing', connection: 'open', reducedOverride: false, ...props }));

describe('HudLayer render', () => {
  const html = render(world());

  it('top bar: shift name, clock, day part, money, hearts, pause', () => {
    expect(html).toContain('Poori Morning');
    expect(html).toMatch(/\d{1,2}:\d\d/);
    expect(html).toContain('Morning');
    expect(html).toContain('₹120');
    expect(html).toContain('5 hearts left');
    expect(html).toContain('aria-label="Pause (Esc)"');
    expect(html).toContain('3 star at'); // star ticks at 1/2/3 stars
  });

  it('order rail: a chit per customer in spot order, Telugu names, served ticks, collect button', () => {
    const i1 = html.indexOf('Ravi anna');
    const i2 = html.indexOf('Fatima aapa');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(html).toContain('దోశ');
    expect(html).toContain('tc-hud-tick');
    expect(html).toContain('aria-label="Collect ₹30 from token 2, Fatima aapa"');
    expect(html).toContain('Eating...');
    expect(html).toContain('Token 1, Ravi anna, Office-goer, waiting, needs Plain Dosa');
  });

  it('availability board with aria labels, tones and counts', () => {
    expect(html).toContain('aria-label="Plain Dosa: 1 ready, 1 in hand, 1 wanted"');
    expect(html).toContain('aria-label="Masala Dosa: 1 cooking, 0 wanted"');
    expect(html).toContain('aria-label="Irani Chai: none ready, 0 wanted"');
  });

  it('hands tray shows the held dish with its quality and a trash button', () => {
    expect(html).toContain('Hand 1: Plain Dosa, perfect quality, selected');
    expect(html).toContain('Hand 2: empty');
    expect(html).toContain('Throw away the selected dish');
  });

  it('stations dock: every station with slots as accessible buttons', () => {
    expect(html).toContain('aria-label="Stations"');
    expect(html).toContain('Dosa tawa, slot 1: Plain Dosa ready. Press to take it');
    expect(html).toContain('Dosa tawa, slot 2: cooking Masala Dosa');
    expect(html).toContain('Dosa tawa, slot 3: empty. Press to choose a dish to cook');
    expect(html).toContain('Idly steamer, slot 4');
    expect(html).toContain('Chai counter, slot 2');
  });

  it('has an aria-live region and no co-op bar in solo', () => {
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('Your team');
  });

  it('co-op bar appears online with teammates, emotes and the connection chip', () => {
    const s = world();
    s.players.u2.hands = [{ dish: 'irani_chai', q: 'good' }];
    const h = render(s, { mode: 'online' });
    expect(h).toContain('Your team');
    expect(h).toContain('Anu');
    expect(h).toContain('Irani Chai');
    expect(h).toContain('aria-label="Thumbs up"');
    expect(h).toContain('Connected');
    expect(h).not.toContain('Pause (Esc)');
  });

  it('hides hearts and star targets in the tutorial', () => {
    const s = world({ level: 0, cfg: { tutorial: true } });
    const h = render(s, { mode: 'tutorial' });
    expect(h).not.toContain('hearts left');
    expect(h).not.toContain('Takings toward');
  });

  it('tutorial spotlight pulses the matching controls', () => {
    const h = render(world(), { tutorial: { step: { spotlight: { kind: 'slot', id: 'tawa1', slot: 2 } } } });
    expect(h).toMatch(/tc-hud-slot is-spot"[^>]*data-spot="slot:tawa1:2"/);
    const c = render(world(), { tutorial: { step: { spotlight: { kind: 'customer', id: 2 } } } });
    expect(c).toMatch(/tc-hud-chit is-spot/);
    expect(c).toMatch(/tc-hud-collect is-spot/);
    const hands = render(world(), { tutorial: { step: { spotlight: { kind: 'hands' } } } });
    expect(hands).toContain('tc-hud-hands is-spot');
  });

  it('renders nothing without state, and a calm class for reduced motion', () => {
    expect(render(null)).toBe('');
    expect(render(world(), {}, { reducedOverride: true })).toContain('tc-hud--calm');
  });

  it('shows a mute button only when onMute is given', () => {
    expect(html).not.toContain('aria-label="Mute"');
    expect(render(world(), {}, { onMute() {}, muted: false })).toContain('aria-label="Mute"');
    expect(render(world(), {}, { onMute() {}, muted: true })).toContain('aria-label="Unmute"');
  });
});

describe('Availability strip', () => {
  const s = world();
  s.stations.tawa1.slots = [mkSlot({ st: 'burnt', dish: 'dosa' }), mkSlot({ st: 'cooking', dish: 'dosa', readyAt: 30 }), mkSlot({ st: 'cooking', dish: 'masala_dosa', readyAt: 25 })];
  const h = renderToStaticMarkup(createElement(Availability, { rows: availability(s, 'me'), onChip() {} }));
  it('greys a dish with no free slot and nothing ready, says why', () => {
    expect(h).toMatch(/data-tone="blocked"[^>]*data-dish="dosa"/);
    expect(h).toContain('No free slot');
    expect(h).toContain('aria-disabled="true"');
  });
  it('shows cooking counts with ETA and what customers want', () => {
    expect(h).toContain('1 cooking 10s');
    expect(h).toContain('needs 1');
  });
});

describe('ActionSheet', () => {
  const s = world();
  const h = renderToStaticMarkup(createElement(ActionSheet, { sheet: { station: 'tawa1', slot: 2 }, state: s, avail: availability(s, 'me'), onPick() {}, onClose() {} }));
  it('lists only dishes this station can cook that are on the menu, with price, time, Telugu and counts', () => {
    expect(h).toContain('role="dialog"');
    expect(h).toContain('Plain Dosa');
    expect(h).toContain('Masala Dosa');
    expect(h).not.toContain('Idly (2 pc)');
    expect(h).not.toContain('Irani Chai');
    expect(h).toContain('₹40');
    expect(h).toContain('5s to cook');
    expect(h).toContain('మసాలా దోశ');
    expect(h).toContain('1 ready · 0 cooking · 1 wanted');
    expect(h).toContain('aria-keyshortcuts="1"');
    expect(h).toContain('aria-keyshortcuts="2"');
  });
});
