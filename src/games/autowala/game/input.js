// Input: keyboard, gamepad and on-screen touch buttons, merged into one analogue-ish state. One-shot actions (horn, talk,
// interact...) are read with `pressed(name)`, which is true once per press.
const KEYS = {
  left: ['arrowleft', 'a'], right: ['arrowright', 'd'], up: ['arrowup', 'w'], down: ['arrowdown', 's'],
  handbrake: [' ', 'spacebar'], boost: ['shift'], horn: ['h'], talk: ['t'], interact: ['e'],
  quests: ['q'], map: ['m'], radio: ['r'], camera: ['c'], pause: ['escape', 'p'], phone: ['tab'], honk2: ['b'],
};
const BY_KEY = {};
for (const [name, list] of Object.entries(KEYS)) for (const k of list) (BY_KEY[k] ||= []).push(name);

export function createInput(target = window) {
  const down = new Set();
  const tapped = new Set();
  const touch = { left: false, right: false, up: false, down: false, handbrake: false, boost: false };
  let stick = 0; // -1..1 analogue steering from a touch slider or a gamepad
  let padSteer = 0;
  let padGas = 0;
  let padBrake = 0;

  const onDown = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const names = BY_KEY[e.key.toLowerCase()];
    if (!names) return;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'tab'].includes(e.key.toLowerCase())) e.preventDefault();
    for (const n of names) {
      if (!down.has(n)) tapped.add(n);
      down.add(n);
    }
  };
  const onUp = (e) => {
    const names = BY_KEY[e.key.toLowerCase()];
    if (!names) return;
    for (const n of names) down.delete(n);
  };
  const onBlur = () => { down.clear(); };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);

  const held = (n) => down.has(n) || touch[n] === true;

  function pollPad() {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(Boolean);
    if (!p) { padSteer = padGas = padBrake = 0; return; }
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
    padSteer = dz(p.axes[0] || 0);
    padGas = Math.max(p.buttons[7]?.value || 0, p.buttons[0]?.pressed ? 1 : 0);
    padBrake = Math.max(p.buttons[6]?.value || 0, p.buttons[1]?.pressed ? 1 : 0);
    const map = { 2: 'horn', 4: 'handbrake', 5: 'boost', 3: 'interact', 9: 'pause', 8: 'quests' };
    for (const [bi, name] of Object.entries(map)) {
      const on = !!p.buttons[bi]?.pressed;
      if (on && !down.has(`pad:${name}`)) tapped.add(name);
      if (on) down.add(`pad:${name}`); else down.delete(`pad:${name}`);
    }
  }

  /** Steering and pedals for this frame. */
  function drive() {
    pollPad();
    let steer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    if (stick) steer = stick;
    if (padSteer) steer = padSteer;
    const throttle = Math.max(held('up') ? 1 : 0, padGas);
    const brake = Math.max(held('down') ? 1 : 0, padBrake);
    return {
      steer, throttle, brake,
      handbrake: held('handbrake') || down.has('pad:handbrake'),
      boost: held('boost') || down.has('pad:boost'),
    };
  }

  /** True once per press of a one-shot action (and clears it). */
  const pressed = (name) => {
    if (tapped.has(name)) { tapped.delete(name); return true; }
    return false;
  };
  const clearTaps = () => tapped.clear();

  // touch hooks for the on-screen buttons
  const setTouch = (name, on) => {
    if (['horn', 'interact', 'talk', 'pause', 'quests', 'camera', 'map', 'radio', 'phone'].includes(name)) {
      if (on) tapped.add(name);
      return;
    }
    touch[name] = !!on;
  };
  const setStick = (v) => { stick = v; };

  const dispose = () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
  };
  return { drive, pressed, clearTaps, setTouch, setStick, held, dispose };
}
