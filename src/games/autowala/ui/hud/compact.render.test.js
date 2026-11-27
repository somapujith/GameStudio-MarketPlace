// Server-side markup of the phone HUD pieces: the strip, the More sheet (every collapsed panel is in it) and the alert lane.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertsLane, AlertsLaneSlot, MoreSheet, MoreSheetSlot, Strip } from './Compact.jsx';
import { SnapStoreProvider, createSnapStore } from './snapStore.js';
import { careerView, rulesView, weatherView } from './hudLogic.js';
import { pushToast } from './toastQueue.js';

const html = (el) => renderToStaticMarkup(el);
const snap = {
  kmh: 30, fuel: 0.7, hour: 17.4, day: 3, wallet: 1240, rating: 4.4, rides: 12, menu: null,
  trip: { name: 'Salma Aapa', kind: 'foodie', pax: 1, status: 'riding', fareNow: 148, distanceLeft: 2300, timeLeft: 42, mood: 0.7, dest: { name: 'Charminar', te: 'చార్మినార్' } },
  route: { length: 2300, eta: 190 },
  quest: { active: { title: 'Biryani run', te: 'బిర్యానీ', reward: { cash: 300 }, steps: [{ label: 'Pick up the biryani' }, { label: 'Deliver it' }], stepIndex: 0, progress: '1 of 2', timeLeft: 95 } },
  radio: { on: true, name: 'Radio Mirchi', te: 'రేడియో', track: 'Charminar Nights', color: '#ffc857' },
};
const career = {
  damage: 0.3, repairCost: 200, fatigue: 0.8, fatigueName: { en: 'Tired', te: 'అలసట' }, chai: { price: 15, cooldown: 0, canBuy: true },
  demand: { mult: 1.6, label: 'Office rush', te: 'రద్దీ', peak: true }, today: { earned: 640 }, rent: { due: 400, owned: false, debt: 0 },
};
const rules = rulesView({ limit: 40, zone: 'city', signalAhead: { state: 'red', dist: 60, left: 9 }, cameraAhead: { dist: 90, limit: 40 } }, 20);
const game = { ctx: { career: { drinkChai: vi.fn() }, sound: { radio: { toggle() {}, prev() {}, next() {} } } }, on: () => () => {}, input: { setTouch() {} } };
const sheet = (open) => html(createElement(MoreSheet, { open, onClose() {}, game, snap, careerV: careerView(career), rulesV: rules, weather: weatherView({ state: 'rain', rain: 0.6, wet: 0.4 }) }));

// the strip and the alert lane read the snapshot store (hud/snapStore.js): a test gives them one holding `snapshot`
const withStore = (snapshot, el) => createElement(SnapStoreProvider, { value: createSnapStore(snapshot) }, el);

describe('Strip: one compact top row', () => {
  const h = html(withStore({ ...snap, weather: { state: 'rain', wet: 0.4 } }, createElement(Strip, { reduced: true, onPause() {}, onMore() {}, moreOpen: false, badge: 'urgent' })));
  it('holds the wallet with the rating, the trip, the clock, More and pause', () => {
    expect(h).toContain('aw-cwallet');
    expect(h).toContain('1,240');
    expect(h).toContain('4.4');
    expect(h).toContain('Salma Aapa');
    expect(h).toContain('Charminar');
    expect(h).toContain('5:24');
    expect(h).toContain('aw-more-btn');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('aw-pausebtn');
  });
  it('flags something urgent in the sheet with a dot', () => {
    expect(h).toContain('aw-more-btn__dot is-urgent');
  });
  it('shows the find-a-customer hint without a trip', () => {
    const f = html(withStore({ ...snap, waitingCount: 3, trip: null, route: null }, createElement(Strip, { reduced: true, onPause() {}, onMore() {}, moreOpen: true, badge: null })));
    expect(f).toContain('aw-cfind');
    expect(f).toContain('3 waiting');
    expect(f).not.toContain('aw-more-btn__dot');
    expect(f).toContain('aria-expanded="true"');
  });
});

describe('MoreSheet: every collapsed panel lives in it', () => {
  it('rating, job (with the chai button), mission, weather, road rules and radio', () => {
    const h = sheet(true);
    for (const k of ['rating', 'job', 'quest', 'weather', 'rules', 'radio']) expect(h).toContain(`data-k="${k}"`);
    expect(h).toContain('aw-job__chai');
    expect(h).toContain('Biryani run');
    expect(h).toContain('Office rush');
    expect(h).toContain('Rain');
    expect(h).toContain('aw-radio--inline');
    expect(h).toContain('aw-sheet-scrim');
  });
  it('stays mounted but hidden while closed (the chai gamepad poll keeps running), with no scrim', () => {
    const h = sheet(false);
    expect(h).toContain('hidden=""');
    expect(h).toContain('data-k="job"');
    expect(h).not.toContain('aw-sheet-scrim');
  });
  it('only shows the sections that have content', () => {
    const h = html(createElement(MoreSheet, { open: true, onClose() {}, game: { ctx: {} }, snap: { ...snap, quest: null, radio: null }, careerV: null, rulesV: null, weather: null }));
    expect(h).toContain('data-k="rating"');
    for (const k of ['job', 'quest', 'weather', 'rules', 'radio']) expect(h).not.toContain(`data-k="${k}"`);
  });
});

describe('AlertsLane', () => {
  it('renders only the chosen kinds', () => {
    const h = html(createElement(AlertsLane, { rules, kinds: ['signal'], rage: null, mission: '', missionTime: '' }));
    expect(h).toContain('aw-rule--signal');
    expect(h).not.toContain('aw-rule--camera');
  });
  it('rage and mission chips', () => {
    const h = html(createElement(AlertsLane, { rules: null, kinds: ['rage', 'mission'], rage: { active: true, heat: 0.5, escape: 0.2, caughtIn: 0.1, chasers: 1 }, mission: 'Biryani run', missionTime: '1:35' }));
    expect(h).toContain('aw-rage');
    expect(h).toContain('aw-alert-chip--mission');
    expect(h).toContain('1:35');
  });
  it('renders nothing when there is nothing to alert', () => {
    expect(html(createElement(AlertsLane, { rules, kinds: [], rage: null, mission: '', missionTime: '' }))).toBe('');
  });
});

describe('the lane and the sheet fed from the store', () => {
  const stormy = { ...snap, kmh: 20, rules: { limit: 40, zone: 'city', signalAhead: { state: 'red', dist: 52, left: 9 } }, rage: { active: true, heat: 0.5, escape: 0.2, caughtIn: 0.1, chasers: 1 } };
  it('AlertsLaneSlot shows the chips the cap allows, from the snapshot, with the mission clock', () => {
    const h = html(withStore(stormy, createElement(AlertsLaneSlot, { cap: 3 })));
    expect(h).toContain('aw-alerts');
    expect(h).toContain('Biryani run');
    expect(h).toContain('1:35'); // 95 s, ceil
    expect((h.match(/aw-rule--|aw-rage"|aw-alert-chip--mission/g) || []).length).toBeLessThanOrEqual(3);
    expect(html(withStore(stormy, createElement(AlertsLaneSlot, { cap: 0 })))).toBe('');
    expect(html(createElement(AlertsLaneSlot, { cap: 3 }))).toBe(''); // no store: nothing
  });
  it('MoreSheetSlot open holds every section; closed it keeps only the job chip (its gamepad poll must keep running)', () => {
    const withCareer = { ...stormy, career, weather: { state: 'rain', rain: 0.6, wet: 0.4 } };
    const open = html(withStore(withCareer, createElement(MoreSheetSlot, { open: true, onClose() {}, game, onShortcut() {} })));
    for (const k of ['rating', 'job', 'quest', 'weather', 'rules', 'radio']) expect(open).toContain(`data-k="${k}"`);
    const closed = html(withStore(withCareer, createElement(MoreSheetSlot, { open: false, onClose() {}, game, onShortcut() {} })));
    expect(closed).toContain('hidden=""');
    expect(closed).toContain('data-k="job"');
    for (const k of ['quest', 'weather', 'rules', 'radio']) expect(closed).not.toContain(`data-k="${k}"`);
  });
});

describe('toast stack cap', () => {
  const push = (cap) => {
    let list = [];
    for (let i = 0; i < 6; i++) list = pushToast(list, { text: `toast ${i}` }, 1000 + i * 2000, i + 1, cap);
    return list.filter((t) => !t.leaving).length;
  };
  it('3 on phones, 2 as an explicit cap, 4 by default', () => {
    expect(push(3)).toBe(3);
    expect(push(2)).toBe(2);
    expect(push()).toBe(4);
  });
});
