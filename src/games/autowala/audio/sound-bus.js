// OWNER: sound agent. Volume buses between every game sound and the shared master gain (audio/ctx.js):
//
//   source -> bus.fx | bus.voice | bus.music -> master -> compressor -> speakers
//
// `getBuses()` is the public API. Anyone (the voices code, horns...) may connect to a bus:
//   import { getBuses } from './sound-bus.js';
//   const out = getBuses()?.voice ?? getAudio().master;   // spoken lines
//   const out = getBuses()?.fx ?? getAudio().master;      // effects
// The bus gains follow the saved settings (audio.fx / audio.voice / audio.music, 0..1) and the `audio:volume` event
// ({ master, fx, voice, music, muted }); master itself is still applied by ui/menus/settings.js.
import { getAudio } from './ctx.js';

const levels = { fx: 1, voice: 1, music: 1 };
let built = null; // { ac, master, fx, voice, music }

const lvl = (v, d = 1) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(1, Math.max(0, Number(v))) : d);

function apply() {
  if (!built) return;
  const t = built.ac.currentTime;
  for (const k of ['fx', 'voice', 'music']) {
    try {
      built[k].gain.setTargetAtTime(levels[k], t, 0.03);
    } catch {
      built[k].gain.value = levels[k];
    }
  }
}

/** Remember the player's levels (from `audio:volume` or the saved settings) and apply them live to the buses that exist. */
export function setBusLevels(a) {
  if (!a || typeof a !== 'object') return;
  levels.fx = lvl(a.fx, levels.fx);
  levels.voice = lvl(a.voice, levels.voice);
  levels.music = lvl(a.music, levels.music);
  apply();
}

/** Current levels (read-only copy for tests / the debug hook). */
export const busLevels = () => ({ ...levels });

/**
 * { ac, master, fx, voice, music } of GainNodes, built on first use; null when Web Audio is missing. Safe to call any time.
 * A new AudioContext (hot reload) rebuilds the buses.
 */
export function getBuses() {
  let a = null;
  try {
    a = getAudio();
  } catch {
    return null;
  }
  if (!a) return null;
  if (built && built.ac === a.ac) return built;
  try {
    const mk = (g) => {
      const n = a.ac.createGain();
      n.gain.value = g;
      n.connect(a.master);
      return n;
    };
    built = { ac: a.ac, master: a.master, fx: mk(levels.fx), voice: mk(levels.voice), music: mk(levels.music) };
  } catch {
    built = null;
  }
  return built;
}

/** Tear down (game dispose): the buses stay connected to the shared master, so just forget them. */
export function dropBuses() {
  if (built) {
    for (const k of ['fx', 'voice', 'music']) {
      try {
        built[k].disconnect();
      } catch {
        /* already gone */
      }
    }
  }
  built = null;
}
