// Voice line playback. One <audio> element per clip (a tiny pool, created lazily on first use, the browser's HTTP cache does
// the rest), a hard cap on clips sounding at once, and every rule that keeps it polite:
//   * settings: "Voice lines" off, the global sound switch off, or a zero volume = nothing plays (the caption still shows)
//   * volume   = master volume x the voice slider (the soundscape's synth bus is a different graph, so the clip is not run through it)
//   * autoplay = nothing plays before the first user gesture (no console noise); the first gesture "primes" the elements so
//                iOS Safari lets later, script-started clips through
//   * the same line retriggered restarts it (never stacks); different lines may overlap up to MAX_CONCURRENT, extras drop
//   * a clip that fails to load (offline, 404) is silent, with one console.warn per session
// Everything environmental is injected so the rules run under node tests with a fake <audio>.
import { admitClip, clipMs, voiceUrl, MAX_CONCURRENT, createCooldown } from './voiceModel.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));
const hasSetting = (s, key, dflt) => (s && s[key] !== undefined ? s[key] : dflt);

/** Effective clip volume 0..1 for a settings object (master x voice slider). */
export function voiceVolumeOf(s) {
  return clamp01(hasSetting(s, 'volume', 0.8)) * clamp01(hasSetting(s, 'voiceVolume', 1));
}
/** Is the soundboard allowed to make noise for these settings? (`force` = the player pressed a preview button himself.) */
export function voiceAudible(s, force = false) {
  if (hasSetting(s, 'sfx', true) === false) return force ? voiceVolumeOf(s) > 0 : false;
  if (!force && hasSetting(s, 'voiceLines', true) === false) return false;
  return voiceVolumeOf(s) > 0;
}

export function createVoicePlayer(env = {}) {
  const {
    createAudio = () => null,
    getSettings = () => ({}),
    canStart = () => true,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    warn = (...a) => console.warn(...a),
    maxConcurrent = MAX_CONCURRENT,
  } = env;

  const pool = new Map(); // id -> [{ el }]
  const active = new Map(); // id -> { slot, timer, from }
  const priming = new Set();
  const subs = new Set();
  let warned = false;

  const notify = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  const warnOnce = (why) => {
    if (warned) return;
    warned = true;
    try { warn('[voice] a voice line could not be played:', why); } catch { /* ignore */ }
  };

  function finish(id) {
    const a = active.get(id);
    if (!a) return;
    clearTimer(a.timer);
    active.delete(id);
    try { a.slot.el.pause(); } catch { /* ignore */ }
    notify();
  }

  function slotFor(item) {
    const url = voiceUrl(item);
    let list = pool.get(item.id);
    if (!list) { list = []; pool.set(item.id, list); }
    let slot = list.find((s) => !priming.has(s) && ![...active.values()].some((a) => a.slot === s));
    if (!slot && list.length < 2) {
      const el = createAudio(url);
      if (!el) return null;
      try { el.preload = 'auto'; } catch { /* ignore */ }
      slot = { el, wired: false };
      list.push(slot);
    }
    if (slot && !slot.wired) {
      slot.wired = true;
      try {
        el_on(slot.el, 'ended', () => finish(item.id));
        el_on(slot.el, 'error', () => { warnOnce(url); finish(item.id); });
      } catch { /* ignore */ }
    }
    return slot;
  }

  function el_on(el, type, fn) {
    if (el && typeof el.addEventListener === 'function') el.addEventListener(type, fn);
  }

  /**
   * Play `item` (a catalogue entry). Returns what happened: 'played' | 'restarted' | 'dropped' | 'muted' | 'locked' | 'invalid'
   * | 'unsupported'. `force` = an explicit preview (ignores the "Voice lines" toggle, keeps the volume).
   */
  function play(item, { from = null, force = false } = {}) {
    if (!item || !voiceUrl(item)) return 'invalid';
    const s = getSettings();
    if (!voiceAudible(s, force)) return 'muted';
    if (!canStart()) return 'locked';
    const verdict = admitClip([...active.keys()].map((id) => ({ id })), item.id, maxConcurrent);
    if (verdict === 'drop') return 'dropped';
    const vol = voiceVolumeOf(s);
    let slot;
    if (verdict === 'restart') {
      slot = active.get(item.id).slot;
      clearTimer(active.get(item.id).timer);
    } else {
      slot = slotFor(item);
      if (!slot) return 'unsupported';
    }
    const el = slot.el;
    try {
      el.muted = false;
      el.volume = vol;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch((e) => {
          // NotAllowedError = the browser wants a gesture first: silent. Anything else = a load failure: one warning.
          if (!e || e.name !== 'NotAllowedError') warnOnce(e && e.message ? e.message : String(e));
          if (active.get(item.id)?.slot === slot) finish(item.id);
        });
      }
    } catch (e) {
      warnOnce(e && e.message ? e.message : String(e));
      return 'unsupported';
    }
    const timer = setTimer(() => finish(item.id), clipMs(item) + 1500);
    active.set(item.id, { slot, timer, from });
    notify();
    return verdict === 'restart' ? 'restarted' : 'played';
  }

  /** Create the elements for `items` and unlock them with a silent play on a gesture (iOS). Safe to call often. */
  function prime(items) {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !voiceUrl(item) || active.has(item.id)) continue;
      const slot = slotFor(item);
      if (!slot || slot.primed) continue;
      slot.primed = true;
      priming.add(slot);
      const el = slot.el;
      const done = () => {
        priming.delete(slot);
        try { el.muted = false; } catch { /* ignore */ }
      };
      try {
        el.muted = true;
        const p = el.play();
        Promise.resolve(p).then(
          () => {
            try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
            done();
          },
          done,
        );
      } catch {
        done();
      }
    }
  }

  function stop(id) { finish(id); }
  function stopAll() { [...active.keys()].forEach(finish); }

  return {
    play,
    prime,
    stop,
    stopAll,
    isPlaying: (id) => active.has(id),
    activeIds: () => [...active.keys()],
    activeCount: () => active.size,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    _pool: pool,
  };
}

// ---- the app's singletons -------------------------------------------------------------------------------------

let gestured = false;
let installed = false;
let primeList = () => [];
let player = null;

const activated = () => {
  if (gestured) return true;
  try {
    return !!(typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.hasBeenActive);
  } catch {
    return false;
  }
};

function installGesture() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const onGesture = () => {
    gestured = true;
    try { if (player) player.prime(primeList()); } catch { /* ignore */ }
  };
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((e) => document.addEventListener(e, onGesture, { capture: true, passive: true }));
}

/** The lines the signed-in player owns: the first gesture warms their audio elements (iOS needs a play() inside a gesture). */
export function setPrimeList(fn) {
  primeList = typeof fn === 'function' ? fn : () => [];
  if (gestured && player) {
    try { player.prime(primeList()); } catch { /* ignore */ }
  }
}

/** The shared player (lazy: nothing is created, fetched or listened to until the first call). */
export function getVoicePlayer(getSettings) {
  if (player) return player;
  player = createVoicePlayer({
    createAudio: (url) => (typeof Audio === 'undefined' ? null : new Audio(url)),
    getSettings,
    canStart: activated,
  });
  installGesture();
  return player;
}

export const voiceCooldown = createCooldown();

// ---- a tiny bus: a local press and a remote broadcast take the same road to the screen -----------------------

const busSubs = new Set();
export const voiceBus = {
  emit(ev) { [...busSubs].forEach((f) => { try { f(ev); } catch { /* ignore */ } }); },
  on(f) { busSubs.add(f); return () => busSubs.delete(f); },
};
