import { describe, expect, it } from 'vitest';
import { createTouchBus } from './touchBus.js';
import { createPointerSlot, isGhostPointer } from './pointerGuard.js';

/** A stand-in for game.input that records what it was told. */
function fakeInput() {
  const st = { stick: 0, gas: 0, brake: 0, touch: {}, taps: [] };
  return {
    st,
    setStick: (v) => { st.stick = v; },
    setPedals: (g, b) => { st.gas = g; st.brake = b; },
    setTouch: (n, on) => {
      if (['horn', 'interact', 'talk', 'pause', 'quests', 'camera', 'map', 'radio', 'phone'].includes(n)) {
        if (on) st.taps.push(n);
        return;
      }
      st.touch[n] = !!on;
    },
    releaseTouch: () => { st.stick = 0; st.gas = 0; st.brake = 0; for (const k of Object.keys(st.touch)) st.touch[k] = false; },
  };
}

describe('touchBus', () => {
  it('passes analogue steer, gas and brake through, clamped', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setSteer(0.4);
    bus.setGas(0.7);
    bus.setBrake(0.2);
    expect(inp.st).toMatchObject({ stick: 0.4, gas: 0.7, brake: 0.2 });
    bus.setSteer(7);
    bus.setGas(-3);
    bus.setBrake(NaN);
    expect(inp.st).toMatchObject({ stick: 1, gas: 0, brake: 0 });
  });

  it('steering + gas + a held button together (multi-touch) do not disturb each other', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setSteer(-0.6);
    bus.setGas(1);
    bus.hold('boost', true);
    expect(inp.st).toMatchObject({ stick: -0.6, gas: 1, brake: 0 });
    expect(inp.st.touch.boost).toBe(true);
    bus.setSteer(0); // the wheel finger lifts: gas and boost stay
    expect(inp.st).toMatchObject({ stick: 0, gas: 1 });
    expect(inp.st.touch.boost).toBe(true);
  });

  it('one-shot taps reach the input, unknown names do not', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    expect(bus.tap('horn')).toBe(true);
    expect(bus.tap('camera')).toBe(true);
    expect(bus.tap('self-destruct')).toBe(false);
    expect(inp.st.taps).toEqual(['horn', 'camera']);
  });

  it('releaseAll clears steering, pedals and every held button', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setSteer(1);
    bus.setGas(1);
    bus.setBrake(0.5);
    bus.hold('boost', true);
    bus.hold('handbrake', true);
    bus.releaseAll();
    expect(inp.st).toMatchObject({ stick: 0, gas: 0, brake: 0 });
    expect(inp.st.touch.boost).toBe(false);
    expect(inp.st.touch.handbrake).toBe(false);
    expect(bus.state()).toMatchObject({ steer: 0, gas: 0, brake: 0, held: [] });
  });

  it('going inactive (a menu opens, the sheet opens, unmount) releases everything and ignores new input', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setGas(1);
    bus.hold('boost', true);
    bus.setActive(false);
    expect(inp.st.gas).toBe(0);
    expect(inp.st.touch.boost).toBe(false);
    bus.setGas(1); // a late pointer event after the menu opened
    bus.hold('boost', true);
    expect(bus.tap('horn')).toBe(false);
    expect(inp.st.gas).toBe(0);
    expect(inp.st.touch.boost).toBe(false);
    expect(inp.st.taps).toEqual([]);
    bus.setActive(true);
    expect(inp.st.gas).toBe(0); // nothing the late events said comes back with the controls
  });

  it('auto-throttle keeps the gas on until the brake is touched', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setAuto(true);
    expect(inp.st.gas).toBe(0); // not before the player has touched something (no launch when the start screen closes)
    bus.setSteer(0.3); // the first touch arms it
    expect(inp.st.gas).toBeGreaterThan(0.5);
    bus.setBrake(0.8);
    expect(inp.st.gas).toBe(0);
    expect(inp.st.brake).toBe(0.8);
    bus.setBrake(0);
    expect(inp.st.gas).toBeGreaterThan(0.5);
    bus.setAuto(false);
    expect(inp.st.gas).toBe(0);
    bus.setAuto(true);
    bus.releaseAll();
    expect(inp.st.gas).toBe(0); // releaseAll wins over auto-throttle (no stuck gas on unmount / blur / rotation)
    bus.setSteer(0);
    expect(inp.st.gas).toBe(0); // and it stays off until the next real touch
    bus.hold('boost', true);
    expect(inp.st.gas).toBeGreaterThan(0.5);
  });

  it('a held brake pedal that has gone quiet (standstill) still keeps auto-throttle off', () => {
    const inp = fakeInput();
    const bus = createTouchBus(inp);
    bus.setAuto(true);
    bus.setSteer(0.2);
    expect(inp.st.gas).toBeGreaterThan(0.5);
    bus.setBrake(0.9, true);
    expect(inp.st.gas).toBe(0);
    bus.setBrake(0, true); // stopped: the gate outputs 0 but the finger is still down
    expect(inp.st.gas).toBe(0);
    expect(inp.st.brake).toBe(0);
    bus.setBrake(0, false); // finger lifted
    expect(inp.st.gas).toBeGreaterThan(0.5);
  });

  it('falls back to setTouch up/down when the input has no analogue pedals', () => {
    const calls = [];
    const bus = createTouchBus({ setStick() {}, setTouch: (n, on) => calls.push([n, on]) });
    bus.setGas(1);
    bus.setBrake(1);
    expect(calls).toContainEqual(['up', true]);
    expect(calls).toContainEqual(['down', true]);
  });

  it('works with no input at all', () => {
    const bus = createTouchBus(null);
    expect(() => {
      bus.setSteer(1);
      bus.setGas(1);
      bus.hold('boost', true);
      bus.tap('horn');
      bus.releaseAll();
    }).not.toThrow();
  });
});

describe('pointer guard: one finger per control, no ghosts', () => {
  const touch = (id, extra = {}) => ({ pointerId: id, pointerType: 'touch', width: 24, height: 24, button: 0, ...extra });
  it('a slot takes the first pointer and refuses a second until released', () => {
    const s = createPointerSlot();
    expect(s.claim(touch(1))).toBe(true);
    expect(s.claim(touch(2))).toBe(false);
    expect(s.owns(touch(1))).toBe(true);
    expect(s.owns(touch(2))).toBe(false);
    expect(s.release(touch(2))).toBe(false); // somebody else's pointer ending is not ours
    expect(s.owns(touch(1))).toBe(true);
    expect(s.release(touch(1))).toBe(true);
    expect(s.claim(touch(2))).toBe(true);
  });
  it('a forced release (no event) frees the slot', () => {
    const s = createPointerSlot();
    s.claim(touch(5));
    expect(s.release()).toBe(true);
    expect(s.release()).toBe(false);
    expect(s.claim(touch(6))).toBe(true);
  });
  it('palms and right clicks are ghosts', () => {
    expect(isGhostPointer(touch(1, { width: 140, height: 150 }))).toBe(true);
    expect(isGhostPointer(touch(1, { width: 40, height: 40 }))).toBe(false);
    expect(isGhostPointer({ pointerType: 'mouse', button: 2 })).toBe(true);
    expect(isGhostPointer({ pointerType: 'mouse', button: 0 })).toBe(false);
    expect(isGhostPointer(null)).toBe(true);
    const s = createPointerSlot();
    expect(s.claim(touch(1, { width: 200, height: 200 }))).toBe(false);
    expect(s.id).toBeNull();
  });
});
