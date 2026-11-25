// One shared Web Audio context for the whole game (horns, engine, radio, effects). Browsers only allow audio after a user
// gesture, so the context is created lazily and resumed on the first key press / click / touch.
let ac = null;
let master = null;
let muted = false;
let primed = false;

export function getAudio() {
  if (typeof window === 'undefined') return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
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
  if (master) master.gain.value = muted ? 0 : 0.8;
}
export const isMuted = () => muted;
