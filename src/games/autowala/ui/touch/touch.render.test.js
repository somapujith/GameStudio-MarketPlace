// Render tests (server-side markup, no DOM): every piece mounts with a fake game, the full TouchControls shows on a touch device and hides
// on a mouse device or while a menu is open, and the markup carries the contract (zones, aria, 48 px targets).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowPad, Wheel } from './Wheel.jsx';
import { Pedal } from './Pedals.jsx';
import { MainActions, MinorActions } from './Actions.jsx';
import SettingsSheet from './SettingsSheet.jsx';
import { computeLayout } from './layout.js';
import { createTouchBus } from './touchBus.js';
import { DEFAULTS } from './touchSettings.js';

const html = (el) => renderToStaticMarkup(el);
const bus = createTouchBus({ setStick() {}, setPedals() {}, setTouch() {}, releaseTouch() {} });
const fx = () => {};
const L = computeLayout({ w: 844, h: 390 }, { size: 'M' });
const P = computeLayout({ w: 390, h: 844 }, { size: 'M' });

const fakeGame = (menu = null) => ({
  input: { setStick() {}, setPedals() {}, setTouch() {}, releaseTouch() {} },
  state: { menu },
  ctx: { v: { kmh: 0, fwd: 0 } },
  on: () => () => {},
});

describe('parts', () => {
  it('the wheel: a slider with a rotating art layer, positioned on its side', () => {
    const out = html(createElement(Wheel, { bus, layout: L, side: 'left', fx, getSpeed: () => 0, interactive: true }));
    expect(out).toContain('aw-ct-wheel');
    expect(out).toContain('role="slider"');
    expect(out).toContain('aw-ct-wheel__rot');
    expect(out).toContain('data-ctl-zone="wheel"');
    expect(out).toContain('safe-area-inset-left');
    expect(out).toContain(`width:${L.wheel.size}px`);
  });
  it('a passive wheel (tilt) is marked and can carry a calibrate button', () => {
    const out = html(createElement(Wheel, { bus, layout: L, side: 'right', fx, interactive: false }, createElement('button', { className: 'aw-ct-calib' }, 'Calibrate')));
    expect(out).toContain('is-passive');
    expect(out).toContain('Calibrate');
    expect(out).toContain('safe-area-inset-right');
  });
  it('arrows mode: two big labelled buttons', () => {
    const out = html(createElement(ArrowPad, { bus, layout: L, side: 'left', fx }));
    expect(out).toContain('aria-label="Steer left"');
    expect(out).toContain('aria-label="Steer right"');
  });
  it('pedals: gas and brake, brake explains reverse', () => {
    const gas = html(createElement(Pedal, { kind: 'gas', box: L.gas, side: 'right', bus, fx }));
    const brake = html(createElement(Pedal, { kind: 'brake', box: L.brake, side: 'right', bus, fx }));
    expect(gas).toContain('is-gas');
    expect(gas).toContain('aria-label="Gas"');
    expect(brake).toContain('is-brake');
    expect(brake).toContain('BRAKE');
    expect(brake).toContain('reverse');
    expect(gas).toContain('data-ctl-zone="pedal"');
  });
  it('main actions: boost, drift, interact, horn, camera, each at least 48 px', () => {
    const out = html(createElement('div', null, createElement(MainActions, { layout: L, side: 'right', bus, fx })));
    for (const label of ['Boost', 'Handbrake and drift', 'Interact', 'Horn', 'Camera']) expect(out).toContain(`aria-label="${label}"`);
    expect(out).toContain(`width:${L.btn}px`);
    expect(L.btn).toBeGreaterThanOrEqual(48);
  });
  it('a short screen gets the "..." tray, a roomy one the inline row with the gear', () => {
    const tray = html(createElement(MinorActions, { layout: L, bus, fx, wheelSide: 'left', pedalSide: 'right', onSettings() {} }));
    expect(tray).toContain('aria-label="More controls"');
    const roomy = computeLayout({ w: 1180, h: 820 }, {});
    const row = html(createElement(MinorActions, { layout: roomy, bus, fx, wheelSide: 'left', pedalSide: 'right', onSettings() {} }));
    for (const label of ['Map', 'Radio', 'Phone', 'Quests', 'Pause', 'Control settings']) expect(row).toContain(`aria-label="${label}"`);
  });
  it('portrait: the tray button rides the action row on the pedal side', () => {
    const out = html(createElement(MinorActions, { layout: P, bus, fx, wheelSide: 'left', pedalSide: 'right', onSettings() {} }));
    expect(out).toContain('aria-label="More controls"');
    expect(out).toContain('data-ctl-zone="row"');
  });
});

describe('settings sheet and hint', () => {
  const sheet = (over = {}) =>
    html(createElement(SettingsSheet, {
      settings: { ...DEFAULTS, ...over }, onChange() {}, onReset() {}, onClose() {},
      tilt: { status: 'off', request() {}, calibrate() {} }, fullscreen: { supported: true, active: false, toggle() {} },
    }));
  it('has every control the brief asks for', () => {
    const out = sheet();
    for (const t of ['Wheel', 'Tilt', 'Arrows', 'Right-handed', 'Left-handed', 'Opacity', 'Auto-throttle', 'Vibration', 'Full screen']) expect(out).toContain(t);
    expect(out).toContain('role="dialog"');
    expect(out).not.toContain('Calibrate'); // only in tilt mode
  });
  it('tilt mode shows calibrate, sensitivity and the iOS enable button when permission is needed', () => {
    const out = html(createElement(SettingsSheet, {
      settings: { ...DEFAULTS, steering: 'tilt' }, onChange() {}, onReset() {}, onClose() {},
      tilt: { status: 'needs-permission', request() {}, calibrate() {} }, fullscreen: { supported: false, active: false, toggle() {} },
    }));
    expect(out).toContain('Calibrate');
    expect(out).toContain('Sensitivity');
    expect(out).toContain('Enable tilt');
    expect(out).not.toContain('Full screen'); // hidden where unsupported (iPhone)
  });
});

describe('TouchControls', () => {
  const win = (coarse, w = 844, h = 390) => ({
    innerWidth: w, innerHeight: h, navigator: { maxTouchPoints: coarse ? 5 : 0 },
    matchMedia: (q) => ({ matches: coarse ? q.includes('coarse') : q.includes('fine'), addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
  });
  const load = async (coarse, w, h) => {
    vi.resetModules();
    vi.stubGlobal('window', win(coarse, w, h));
    vi.stubGlobal('navigator', win(coarse).navigator);
    vi.stubGlobal('document', { documentElement: {}, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' });
    return (await import('../TouchControls.jsx')).default;
  };
  afterEach(() => vi.unstubAllGlobals());
  beforeAll(() => {});

  it('renders the wheel, both pedals and the actions on a touch device in landscape', async () => {
    const TouchControls = await load(true, 844, 390);
    const out = html(createElement(TouchControls, { game: fakeGame() }));
    expect(out).toContain('aw-ct is-land hand-right');
    expect(out).toContain('aw-ct-wheel');
    expect(out).toContain('is-gas');
    expect(out).toContain('is-brake');
    expect(out).toContain('aria-label="Boost"');
    expect(out).not.toContain('Rotate your phone'); // landscape
  });
  it('portrait still reflows (a narrow desktop window; the shared gate covers upright phones)', async () => {
    const TouchControls = await load(true, 390, 844);
    const out = html(createElement(TouchControls, { game: fakeGame() }));
    expect(out).toContain('aw-ct is-port');
    expect(out).not.toContain('Rotate your phone'); // the hub's orientation gate owns that message now
  });
  it('renders nothing on a mouse device, and nothing while a menu is open', async () => {
    const desktop = await load(false, 1280, 800);
    expect(html(createElement(desktop, { game: fakeGame() }))).toBe('');
    const touch = await load(true, 844, 390);
    expect(html(createElement(touch, { game: fakeGame('pause') }))).toBe('');
    expect(html(createElement(touch, { game: null }))).toBe('');
  });
});
