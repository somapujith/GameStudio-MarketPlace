// One shared Web Audio context for the whole game (horns, engine, radio, effects). Browsers only allow audio after a user
// gesture, so the context is created lazily and resumed on the first key press / click / touch.
let ac = null;
let master = null;
let muted = false;
let masterLevel = 1; // the master slider 0..1 (the shared graph runs at 0.8 for "full")
let primed = false;

/** The master gain for the current slider and mute state. */
const masterNow = () => (muted ? 0 : 0.8 * masterLevel);

export function getAudio() {
  if (typeof window === 'undefined') return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = masterNow(); // a context that starts after the player set the sliders must already honour them
    const comp = ac.createDynamicsCompressor(); // keeps stacked sounds from clipping
    master.connect(comp);
    comp.connect(ac.destination);
  }
  return { ac, master };
}

/** Call once at game start: wires the first-gesture unlock. Returns a cleanup. */
export function primeAudio() {
  if (primed || typeof window === 'undefined') return () => {};
  primed = true;
  const unlock = () => {
    const a = getAudio();
    if (a && a.ac.state === 'suspended') a.ac.resume();
  };
  const evs = ['pointerdown', 'keydown', 'touchstart'];
  evs.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  return () => {
    evs.forEach((e) => window.removeEventListener(e, unlock));
    primed = false;
  };
}

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = masterNow();
}
export const isMuted = () => muted;

/** The master slider (0..1). Remembered, so a context created later (first gesture) starts at the right level. */
export function setMasterLevel(l) {
  const n = Number(l);
  masterLevel = l !== null && l !== '' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  if (master) master.gain.value = masterNow();
}
export const getMasterLevel = () => masterLevel;
