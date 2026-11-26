// The one place that talks to game.input for the touch controls. Each control reports its own part (steering, gas, brake, a held
// button); the bus combines them (auto-throttle, active gate) and pushes the result. releaseAll() clears EVERYTHING so no pedal is ever
// left stuck. Pure: takes any object with setTouch / setStick / setPedals, so it is unit-tested with a fake (touchBus.test.js).
import { applyAutoThrottle } from './pedalMath.js';

export const HELD_ACTIONS = ['handbrake', 'boost'];
export const TAP_ACTIONS = ['horn', 'interact', 'talk', 'pause', 'quests', 'camera', 'map', 'radio', 'phone'];

export function createTouchBus(input) {
  // `armed`: auto-throttle only starts after the player has touched a control, and stops again after any release-all (a menu, a blur,
  // a rotation), so the auto never rolls away on its own when the controls come back.
  const s = { steer: 0, gas: 0, brake: 0, brakeHeld: false, auto: false, active: true, armed: false, held: new Set() };
  const push = () => {
    if (!input) return;
    const on = s.active;
    input.setStick?.(on ? s.steer : 0);
    const gas = on ? applyAutoThrottle(s.gas, s.brakeHeld ? Math.max(s.brake, 1) : s.brake, s.auto && s.armed) : 0;
    const brake = on ? s.brake : 0;
    if (typeof input.setPedals === 'function') input.setPedals(gas, brake);
    else {
      input.setTouch?.('up', gas > 0.3);
      input.setTouch?.('down', brake > 0.3);
    }
  };
  const arm = () => {
    if (s.armed) return;
    s.armed = true;
    push();
  };
  const bus = {
    setSteer(v) {
      if (!s.active) return;
      const n = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
      if (n !== 0) arm();
      if (n === s.steer) return;
      s.steer = n;
      push();
    },
    setGas(v) {
      if (!s.active) return;
      const n = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
      if (n > 0) arm();
      if (n === s.gas) return;
      s.gas = n;
      push();
    },
    /** `held`: the brake pedal is under a finger even when its output is 0 (stopped, waiting for a new press): auto-throttle stays off. */
    setBrake(v, held = Number(v) > 0) {
      if (!s.active) return;
      const n = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
      if (n > 0 || held) arm();
      if (n === s.brake && !!held === s.brakeHeld) return;
      s.brake = n;
      s.brakeHeld = !!held;
      push();
    },
    /** handbrake / boost: held while a finger is on the button. */
    hold(name, on) {
      if (!HELD_ACTIONS.includes(name)) return;
      if (on && !s.active) return;
      if (on) {
        s.held.add(name);
        arm();
      } else s.held.delete(name);
      input?.setTouch?.(name, !!on);
    },
    /** One-shot actions (horn, interact, camera, map, radio, phone, quests, pause). Ignored while the bus is inactive. */
    tap(name) {
      if (!s.active || !TAP_ACTIONS.includes(name)) return false;
      arm();
      input?.setTouch?.(name, true);
      return true;
    },
    setAuto(on) {
      s.auto = !!on;
      push();
    },
    /** Inactive = the controls are hidden or a menu is open: every output is forced to zero. */
    setActive(on) {
      s.active = !!on;
      if (!on) bus.releaseAll();
      else push();
    },
    releaseAll() {
      s.steer = 0;
      s.gas = 0;
      s.brake = 0;
      s.brakeHeld = false;
      s.armed = false;
      for (const n of s.held) input?.setTouch?.(n, false);
      s.held.clear();
      for (const n of HELD_ACTIONS) input?.setTouch?.(n, false);
      if (typeof input?.releaseTouch === 'function') input.releaseTouch();
      else push();
    },
    state: () => ({ steer: s.steer, gas: s.gas, brake: s.brake, auto: s.auto, active: s.active, held: [...s.held] }),
  };
  return bus;
}
