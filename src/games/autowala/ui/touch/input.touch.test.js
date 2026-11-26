// The touch hooks of game/input.js: analogue pedals, the analogue stick, held buttons, one-shot taps, releaseTouch, and that keyboard input
// still behaves exactly as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput } from '../../game/input.js';

function fakeTarget() {
  const h = {};
  return {
    h,
    addEventListener: (t, fn) => { (h[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { h[t] = (h[t] || []).filter((x) => x !== fn); },
    fire: (t, e) => (h[t] || []).forEach((fn) => fn(e)),
  };
}
const key = (k) => ({ key: k, target: { tagName: 'DIV' }, preventDefault() {} });

let input;
let target;
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  target = fakeTarget();
  input = createInput(target);
});
afterEach(() => {
  input.dispose();
  vi.unstubAllGlobals();
});

describe('analogue touch pedals', () => {
  it('drive() reports the analogue gas and brake', () => {
    input.setPedals(0.4, 0);
    expect(input.drive()).toMatchObject({ throttle: 0.4, brake: 0 });
    input.setPedals(0, 0.7);
    expect(input.drive()).toMatchObject({ throttle: 0, brake: 0.7 });
  });
  it('clamps and survives garbage', () => {
    input.setPedals(5, -2);
    expect(input.drive()).toMatchObject({ throttle: 1, brake: 0 });
    input.setPedals(undefined, 'x');
    expect(input.drive()).toMatchObject({ throttle: 0, brake: 0 });
  });
  it('held(up/down) is true while a pedal is pressed (the engine sound reads it)', () => {
    expect(input.held('up')).toBe(false);
    input.setPedals(0.5, 0);
    expect(input.held('up')).toBe(true);
    expect(input.held('down')).toBe(false);
    input.setPedals(0, 0.3);
    expect(input.held('down')).toBe(true);
  });
  it('the keyboard and the pedals combine by max, and the old digital touch names still work', () => {
    input.setPedals(0.3, 0);
    target.fire('keydown', key('w'));
    expect(input.drive().throttle).toBe(1);
    target.fire('keyup', key('w'));
    expect(input.drive().throttle).toBe(0.3);
    input.setPedals(0, 0);
    input.setTouch('up', true);
    expect(input.drive().throttle).toBe(1);
    input.setTouch('up', false);
    expect(input.drive().throttle).toBe(0);
  });
});

describe('steering and buttons', () => {
  it('setStick is the analogue steer and wins over the keys', () => {
    input.setStick(-0.35);
    expect(input.drive().steer).toBe(-0.35);
    input.setStick(0);
    target.fire('keydown', key('d'));
    expect(input.drive().steer).toBe(1);
  });
  it('handbrake and boost are held buttons', () => {
    input.setTouch('handbrake', true);
    input.setTouch('boost', true);
    expect(input.drive()).toMatchObject({ handbrake: true, boost: true });
    input.setTouch('boost', false);
    expect(input.drive().boost).toBe(false);
  });
  it('one-shot actions fire once per tap, for every name the touch controls send', () => {
    for (const n of ['horn', 'interact', 'camera', 'map', 'radio', 'phone', 'quests', 'pause', 'talk']) {
      input.setTouch(n, true);
      expect(input.pressed(n)).toBe(true);
      expect(input.pressed(n)).toBe(false);
    }
  });
});

describe('releaseTouch', () => {
  it('clears steering, pedals and held buttons at once, and leaves the keyboard alone', () => {
    input.setStick(1);
    input.setPedals(1, 1);
    input.setTouch('boost', true);
    input.setTouch('handbrake', true);
    target.fire('keydown', key('w'));
    input.releaseTouch();
    expect(input.drive()).toMatchObject({ steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false }); // W is still down
    target.fire('keyup', key('w'));
    expect(input.drive()).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
  });
  it('a window blur releases the touch input too (no stuck throttle after alt-tab)', () => {
    let onBlur;
    vi.stubGlobal('window', { addEventListener: (t, fn) => { if (t === 'blur') onBlur = fn; }, removeEventListener() {} });
    const i2 = createInput(fakeTarget());
    i2.setPedals(1, 0);
    i2.setStick(0.5);
    onBlur();
    expect(i2.drive()).toMatchObject({ throttle: 0, steer: 0 });
    i2.dispose();
  });
});

describe('keyboard is unchanged', () => {
  it('arrows steer, space is the handbrake, shift is boost, E is a one-shot', () => {
    target.fire('keydown', key('ArrowLeft'));
    expect(input.drive().steer).toBe(-1);
    target.fire('keyup', key('ArrowLeft'));
    target.fire('keydown', key(' '));
    target.fire('keydown', key('Shift'));
    expect(input.drive()).toMatchObject({ handbrake: true, boost: true });
    target.fire('keydown', key('e'));
    expect(input.pressed('interact')).toBe(true);
    expect(input.pressed('interact')).toBe(false);
  });
});
