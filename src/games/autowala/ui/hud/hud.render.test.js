// Render tests (server-side markup, no DOM) for the HUD pieces added in wave 3: speed-limit sign, rules strip, job chip, rain chip,
// and that a bare snapshot (no rules / career / weather) still renders. Layout itself is checked with screenshots, not here.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Hud from '../Hud.jsx';
import JobChip from './JobChip.jsx';
import RulesStrip, { LimitSign } from './RulesStrip.jsx';
import { ClockBlock } from './StatBlocks.jsx';
import { careerView, rulesView, weatherView } from './hudLogic.js';

const html = (el) => renderToStaticMarkup(el);
const game = () => ({ ctx: { career: { drinkChai: vi.fn(() => ({ ok: true })) }, toast: vi.fn() }, on: () => () => {}, input: { setTouch() {} } });

const baseSnap = { kmh: 22, fuel: 0.8, hour: 12.5, day: 2, wallet: 640, rating: 4.2, rides: 3, menu: null };
const rules = {
  limit: 40, zone: 'city', speeding: false, heat: 0, wanted: false, fines: 0, lastFine: null,
  signalAhead: { state: 'red', dist: 55, left: 6.2, watched: true }, cameraAhead: { dist: 150, limit: 40 }, checkpoint: { phase: 'near', dist: 28 },
};
const career = {
  damage: 0.4, repairCost: 140, fatigue: 0.8, fatigueName: { en: 'Tired', te: 'అలసట' }, chai: { price: 15, cooldown: 0, canBuy: true },
  demand: { mult: 1.7, label: 'Evening rush', te: 'సాయంత్రం రష్', peak: true }, today: { earned: 420 }, rent: { due: 200, owned: false, debt: 0 },
};

describe('Hud with the wave 3 snapshot keys', () => {
  it('renders nothing without a snapshot', () => {
    expect(html(createElement(Hud, { game: game(), snap: null }))).toBe('');
  });
  it('a bare snapshot (no rules, career or weather) renders the core HUD and none of the new widgets', () => {
    const h = html(createElement(Hud, { game: game(), snap: baseSnap }));
    expect(h).toContain('aw-wallet');
    expect(h).toContain('aw-sp');
    expect(h).not.toContain('aw-limit');
    expect(h).not.toContain('aw-rules');
    expect(h).not.toContain('aw-job');
    expect(h).not.toContain('aw-wx');
  });
  it('shows the sign, the strip, the chip and the rain together', () => {
    const snap = { ...baseSnap, rules, career, weather: { state: 'rain', rain: 0.6, wet: 0.5 } };
    const h = html(createElement(Hud, { game: game(), snap }));
    expect(h).toContain('aw-limit');
    expect(h).toContain('aw-rule--signal');
    expect(h).toContain('aw-rule--camera');
    expect(h).toContain('aw-rule--check');
    expect(h).toContain('aw-job');
    expect(h).toContain('aw-wx');
    expect(h).toContain('Evening rush');
  });
  it('hides the job chip while a menu is open', () => {
    const h = html(createElement(Hud, { game: game(), snap: { ...baseSnap, menu: 'pause', career } }));
    expect(h).not.toContain('aw-job');
  });
  it('a crash with guard: true never produces a red flash markup (Effects renders no crash layer without an event)', () => {
    const h = html(createElement(Hud, { game: game(), snap: baseSnap }));
    expect(h).not.toContain('aw-fx-crash');
  });
});

describe('speed-limit sign', () => {
  it('is red-flagged while speeding and names the zone for screen readers', () => {
    const over = html(createElement(LimitSign, { sign: rulesView({ ...rules, speeding: true }).sign }));
    expect(over).toContain('is-over');
    expect(over).toContain('>40<');
    expect(over).toMatch(/aria-label="Speed limit 40 kilometres per hour, City, you are speeding"/);
    const calm = html(createElement(LimitSign, { sign: rulesView(rules).sign }));
    expect(calm).not.toContain('is-over');
    expect(html(createElement(LimitSign, { sign: null }))).toBe('');
  });
  it('school zones get their own class', () => {
    expect(html(createElement(LimitSign, { sign: rulesView({ ...rules, zone: 'school', limit: 20 }).sign }))).toContain('is-school');
  });
});

describe('rules strip', () => {
  it('renders nothing when there is nothing to warn about', () => {
    expect(html(createElement(RulesStrip, { view: null }))).toBe('');
    expect(html(createElement(RulesStrip, { view: rulesView({ limit: 40, zone: 'city' }) }))).toBe('');
  });
  it('signal: lamp, English + Telugu word, countdown and distance', () => {
    const h = html(createElement(RulesStrip, { view: rulesView({ ...rules, cameraAhead: null, checkpoint: null }) }));
    expect(h).toContain('aw-lamp');
    expect(h).toContain('STOP');
    expect(h).toContain('ఆగు');
    expect(h).toContain('7s');
    expect(h).toContain('60 m');
  });
  it('camera warns harder when you are over its limit', () => {
    const r = { ...rules, signalAhead: null, checkpoint: null };
    expect(html(createElement(RulesStrip, { view: rulesView(r, 30) }))).toContain('CAMERA');
    const over = html(createElement(RulesStrip, { view: rulesView(r, 60) }));
    expect(over).toContain('is-over');
    expect(over).toContain('SLOW DOWN');
  });
  it('police check and the wanted badge', () => {
    const h = html(createElement(RulesStrip, { view: rulesView({ ...rules, signalAhead: null, cameraAhead: null }) }));
    expect(h).toContain('Police check ahead');
    const w = html(createElement(RulesStrip, { view: rulesView({ ...rules, signalAhead: null, cameraAhead: null, checkpoint: null, wanted: true }) }));
    expect(w).toContain('WANTED');
  });
});

describe('job chip', () => {
  const view = careerView(career);
  it('shows the capped fare multiplier, today, rent, both bars and the Y chai button', () => {
    const h = html(createElement(JobChip, { game: game(), view, hidden: false }));
    expect(h).toContain('x1.28');
    expect(h).not.toContain('x1.7');
    expect(h).toContain('Rs 420');
    expect(h).toContain('Rs 200');
    expect(h).toContain('aria-label="Dents"');
    expect(h).toContain('aria-label="Tiredness"');
    expect(h).toContain('<kbd>Y</kbd>');
    expect(h).toContain('is-urgent');
  });
  it('chai is disabled while it is brewing and shows the countdown', () => {
    const v = careerView({ ...career, chai: { price: 15, cooldown: 9.1, canBuy: false } });
    const h = html(createElement(JobChip, { game: game(), view: v, hidden: false }));
    expect(h).toContain('disabled');
    expect(h).toContain('10s');
  });
  it('no dent bar for an undamaged auto, no multiplier in a quiet hour, nothing when hidden', () => {
    const v = careerView({ ...career, damage: 0, demand: { mult: 0.9, label: 'Night lull' } });
    const h = html(createElement(JobChip, { game: game(), view: v, hidden: false }));
    expect(h).not.toContain('aria-label="Dents"');
    expect(h).not.toContain('aw-job__demand is-peak');
    expect(h).not.toMatch(/<em>x/);
    expect(html(createElement(JobChip, { game: game(), view, hidden: true }))).toBe('');
    expect(html(createElement(JobChip, { game: game(), view: null, hidden: false }))).toBe('');
  });
});

describe('rain chip in the clock', () => {
  it('appears only when it rains or the rider is still wet', () => {
    const dry = html(createElement(ClockBlock, { hour: 9, day: 1, onPause() {}, weather: weatherView({ state: 'clear', wet: 0 }) }));
    expect(dry).not.toContain('aw-wx');
    const wet = html(createElement(ClockBlock, { hour: 9, day: 1, onPause() {}, weather: weatherView({ state: 'rain', wet: 0.5, rain: 0.8 }) }));
    expect(wet).toContain('aw-wx');
    expect(wet).toContain('Rain');
    expect(wet).toContain('aria-valuenow="50"');
  });
});
