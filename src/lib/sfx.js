// The sound system of the whole app: pure WebAudio, no asset files. Every sound is synthesised on demand by the recipes in
// ./soundscape/recipes.js and mixed by ./soundscape/mixer.js (master limiter, voice stealing, per-sound rate limits,
// priorities, ducking, tab-visibility handling). This module is the stable public face:
//
//   sfx.unlock()               resume the AudioContext (also done automatically on every user gesture)
//   sfx.play(name, opts?)      play a sound; `opts` shape it (cash amount, dice faces, pawn step...): see recipes.js
//   sfx.snatchWindow({ ms })   start the Snatch alarm + the accelerating tick-tock; returns stop()
//   sfx.setScene(on)           the game screen is open: the optional night-market ambient bed may play
//   sfx.setEnabled(b)  sfx.setVolume(v)  sfx.setSfxVolume(v)  sfx.setAmbient(b)   (all also follow storage settings)
//
// Names: click tap toggle dice diceLand step land coin pay rent buy sold auction upgrade hotel mortgage trade chai card
//        announce lucky jail traffic ride turn turnOther tick warn snatchAlarm snatchTick snatchPress snatchWin
//        snatchLost win lose bankrupt cheer levelup invite friend error
//
// Settings (src/lib/storage.js): `sfx` on/off, `volume` master 0..1, `sfxVolume` effects 0..1, `ambient` bed on/off.
// Silent (and never throws) when AudioContext is unavailable, e.g. SSR or old browsers.

import { loadSettings, subscribeSettings } from './storage.js';
import { RECIPES, SOUND_NAMES } from './soundscape/recipes.js';
import { createMixer } from './soundscape/mixer.js';

export const SFX_NAMES = SOUND_NAMES;

let gestured = false;
let gestureInstalled = false;

const hasWindow = () => typeof window !== 'undefined';

function activated() {
  if (gestured) return true;
  try {
    return !!(typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.hasBeenActive);
  } catch {
    return false;
  }
}

function makeContext() {
  if (!hasWindow()) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC({ latencyHint: 'interactive' });
  } catch {
    try {
      return new AC();
    } catch {
      return null;
    }
  }
}

const mixer = createMixer({
  createContext: makeContext,
  now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  canStart: activated,
  recipes: RECIPES,
});

function syncFromSettings() {
  try {
    const s = loadSettings();
    mixer.applySettings({ sfx: s.sfx !== false, volume: s.volume, sfxVolume: s.sfxVolume ?? 1, ambient: !!s.ambient });
  } catch {
    /* keep defaults */
  }
}

// ---- gestures and tab visibility -------------------------------------------------------------

function installLifecycle() {
  if (gestureInstalled || typeof document === 'undefined') return;
  gestureInstalled = true;
  // Stay installed: iOS can put a running context into "interrupted" (a call, the lock screen) and needs a gesture again.
  const onGesture = () => {
    gestured = true;
    if (mixer.settings().enabled && mixer.needsGesture()) mixer.unlock();
  };
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((e) => document.addEventListener(e, onGesture, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mixer.onHidden();
    else mixer.onVisible();
  });
  if (hasWindow()) {
    window.addEventListener('pagehide', () => mixer.onHidden());
    window.addEventListener('pageshow', () => {
      if (document.visibilityState !== 'hidden') mixer.onVisible();
    });
  }
}

// ---- Snatch window: alarm + accelerating tick-tock ---------------------------------------------

/** Tick times (ms from the start of the window) for a window of `ms`: slow at first, then faster and faster. Pure. */
export function snatchTickTimes(ms) {
  const total = Math.max(1000, Number(ms) || 5000);
  const start = 900; // after the alarm's two blips
  const out = [];
  let at = start;
  while (at < total - 80 && out.length < 40) {
    const u = (at - start) / Math.max(1, total - start);
    out.push({ at: Math.round(at), urgency: Math.min(1, Math.max(0, u)), tock: out.length % 2 === 1 });
    at += 620 - 480 * u ** 1.4; // 620 ms between ticks at first, 140 ms at the end
  }
  return out;
}

let snatchTimers = [];
function stopSnatch() {
  snatchTimers.forEach((id) => clearTimeout(id));
  snatchTimers = [];
}

/**
 * The Snatch window just opened for a player who may press: the alarm, then a tick-tock that speeds up and climbs until the
 * window closes. `elapsed` skips what already happened (a reload mid-window). Returns a stop function.
 */
function snatchWindow({ ms = 5000, elapsed = 0, alarm = true } = {}) {
  stopSnatch();
  try {
    if (alarm && elapsed < 300) play('snatchAlarm');
    for (const tk of snatchTickTimes(ms)) {
      const wait = tk.at - Math.max(0, elapsed);
      if (wait < 0) continue;
      snatchTimers.push(setTimeout(() => play('snatchTick', { tock: tk.tock, urgency: tk.urgency }), wait));
    }
  } catch {
    /* sound is optional */
  }
  return stopSnatch;
}

// ---- public API ----------------------------------------------------------------------------

function unlock() {
  gestured = true;
  try {
    mixer.unlock();
  } catch {
    /* ignore */
  }
}

function play(name, opts) {
  try {
    return mixer.play(name, opts);
  } catch {
    return false; // never let a sound crash the game
  }
}

const setEnabled = (b) => mixer.applySettings({ sfx: !!b });
const setVolume = (v) => mixer.applySettings({ volume: v });
const setSfxVolume = (v) => mixer.applySettings({ sfxVolume: v });
const setAmbient = (b) => mixer.applySettings({ ambient: !!b });
const setScene = (on) => {
  try {
    mixer.setScene(on);
  } catch {
    /* ignore */
  }
};

export const sfx = {
  unlock,
  play,
  snatchWindow,
  stopSnatch,
  setScene,
  setEnabled,
  setVolume,
  setSfxVolume,
  setAmbient,
  stats: () => mixer.stats(),
};

/** Test / harness access to the singleton mixer. */
export const _mixer = mixer;

syncFromSettings();
try {
  subscribeSettings(syncFromSettings);
} catch {
  /* ignore */
}
installLifecycle();

export default sfx;
