// The mixer: owns the AudioContext, the master chain and every playing voice.
//
//   voice gain -> effects bus ----------------+--------------------------------+
//                       \-> reverb send ->    |                                v
//   ambient bed -> ambient bus -> duck gain --+--> mix -> master gain -> compressor -> soft clip -> destination
//
//   * master gain   = settings.volume (perceptual curve); effects bus = settings.sfxVolume; ambient bus is quiet by design
//   * compressor    = a fast limiter so stacked sounds never pump the output past full scale
//   * soft clip     = a WaveShaper that is the identity below 0.7 and rounds off to exactly +-1, so nothing can clip
//   * voices        = one per play(); at most `maxVoices` at once. A new sound steals the weakest voice (lowest priority,
//                     then quietest x shortest remaining life) or is dropped when everything playing matters more.
//                     Stolen voices fade out in ~15 ms and every node is disconnected when its sources end (no leaks).
//   * rate limiting = per-sound cooldown (coins coalesce, steps never machine-gun); a global node budget protects the CPU.
//   * ducking       = the ambient bed dips under notable sounds and recovers on its own (all on the audio clock).
//   * lifecycle     = no context before a user gesture (no autoplay warnings); sounds that arrive while the context is
//                     still resuming are replayed if they are less than 350 ms old; the tab hidden = everything stops and
//                     the context is suspended; on return it resumes (iOS also wants a gesture: handled by the caller).
//
// Everything environmental is injected (`createContext`, `now`, `hidden`, `canStart`, timers) so the mixer runs under a
// fake context in node tests and an OfflineAudioContext in a browser render.

import { createSynth } from './synth.js';
import { createAmbient } from './ambient.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));

/** Master level curve: perceptual, and the old default (volume 0.8 -> 0.56) is unchanged. */
export const masterLevel = (v) => 0.8 * clamp01(v) ** 1.6;
/** Effects fader curve (1 = unity). */
export const effectsLevel = (v) => clamp01(v) ** 1.3;
const AMBIENT_LEVEL = 0.32;
const DUCK_LEVEL = 0.38;

/** Identity below 0.7, a smooth knee above it that lands on exactly 1 at full scale. */
export function softClipCurve(n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= 0.7 ? x : Math.sign(x) * (0.7 + (0.3 * Math.tanh((a - 0.7) / 0.3)) / Math.tanh(1));
  }
  return curve;
}

/** A short decaying-noise impulse response: a small bright "room" that makes the toys sound glossy, not dry. */
function impulse(c, seconds = 0.75) {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}

export function createMixer(env = {}) {
  const {
    createContext = () => null,
    now = () => Date.now(),
    hidden = () => false,
    canStart = () => true,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    recipes = {},
    maxVoices = 8,
    maxSources = 140,
    reverb = true,
  } = env;

  let ctx = null;
  let nodes = null; // { effects, ambientBus, duck, mix, master, comp, shaper, wet }
  let ambient = null;
  const voices = new Set();
  const lastPlayed = new Map(); // name -> ms
  let pending = []; // [{ name, opts, at }] waiting for the context to start running
  let nextId = 1;
  let duckUntil = 0;
  let sources = 0;
  let suspendedByUs = false;

  const set = { enabled: true, volume: 0.8, sfxVolume: 1, ambient: false, scene: false };
  const stats = { played: 0, dropped: 0, stolen: 0, queued: 0, replayed: 0, cooled: 0 };

  // ---- context and graph -------------------------------------------------------------------
  function build() {
    const c = createContext();
    if (!c) return null;
    try {
      const effects = c.createGain();
      const ambientBus = c.createGain();
      const duck = c.createGain();
      const mix = c.createGain();
      const master = c.createGain();
      const comp = c.createDynamicsCompressor();
      const shaper = c.createWaveShaper();
      effects.gain.value = effectsLevel(set.sfxVolume);
      ambientBus.gain.value = AMBIENT_LEVEL;
      duck.gain.value = 1;
      mix.gain.value = 1;
      master.gain.value = masterLevel(set.volume);
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 14;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      shaper.curve = softClipCurve();
      try {
        shaper.oversample = '2x';
      } catch {
        /* optional */
      }
      effects.connect(mix);
      ambientBus.connect(duck);
      duck.connect(mix);
      mix.connect(master);
      master.connect(comp);
      comp.connect(shaper);
      shaper.connect(c.destination);
      let wet = null;
      if (reverb && typeof c.createConvolver === 'function') {
        const conv = c.createConvolver();
        conv.buffer = impulse(c);
        const send = c.createGain();
        send.gain.value = 0.13;
        const tone = c.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 5200;
        effects.connect(send);
        send.connect(tone);
        tone.connect(conv);
        conv.connect(mix);
        wet = { conv, send, tone };
      }
      nodes = { effects, ambientBus, duck, mix, master, comp, shaper, wet };
      ctx = c;
      ctx.onstatechange = onState;
      return ctx;
    } catch {
      try {
        c.close?.();
      } catch {
        /* ignore */
      }
      ctx = null;
      nodes = null;
      return null;
    }
  }

  function ensure() {
    if (ctx) return ctx;
    if (!canStart()) return null;
    return build();
  }

  function running() {
    return !!ctx && ctx.state === 'running';
  }

  function tryResume() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function onState() {
    if (!ctx) return;
    if (ctx.state === 'running') {
      suspendedByUs = false;
      const t = now();
      const list = pending;
      pending = [];
      for (const p of list) {
        if (t - p.at < 350) {
          stats.replayed += 1;
          play(p.name, p.opts, true);
        }
      }
      syncAmbient();
    }
  }

  // ---- voices --------------------------------------------------------------------------------
  function dispose(v, at) {
    if (!voices.delete(v)) return;
    sources = Math.max(0, sources - v.counted);
    try {
      if (at !== undefined && ctx) {
        v.gain.gain.cancelScheduledValues(at);
        v.gain.gain.setTargetAtTime(0, at, 0.01);
      }
    } catch {
      /* ignore */
    }
  }

  function kill(v) {
    // fade quickly, stop every source shortly after, then free the nodes
    const c = ctx;
    const at = c ? c.currentTime : 0;
    dispose(v, at);
    for (const s of v.srcs) {
      try {
        s.stop(at + 0.04);
      } catch {
        /* never started / already stopped */
      }
    }
    setTimer(() => {
      try {
        v.gain.disconnect();
      } catch {
        /* ignore */
      }
    }, 120);
  }

  /** Forget voices whose sources should long be over (an `ended` event that never came, e.g. a suspended context). */
  function sweep() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const v of [...voices]) {
      if (t > v.end + 1.5) {
        dispose(v);
        try {
          v.gain.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
  }

  function weakest() {
    let pick = null;
    let score = Infinity;
    const t = ctx.currentTime;
    for (const v of voices) {
      const remain = Math.max(0.05, v.end - t);
      const s = v.priority * 1000 + v.loud * Math.min(remain, 2) - v.born * 1e-6;
      if (s < score) {
        score = s;
        pick = v;
      }
    }
    return pick;
  }

  // ---- ducking -------------------------------------------------------------------------------
  function duckFor(t, seconds) {
    if (!nodes || !ambient || !ambient.isRunning()) return;
    try {
      const g = nodes.duck.gain;
      const until = t + seconds;
      if (until > duckUntil) duckUntil = until;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(DUCK_LEVEL, t, 0.03);
      g.setTargetAtTime(1, duckUntil, 0.45);
    } catch {
      /* ignore */
    }
  }

  // ---- public: play --------------------------------------------------------------------------
  /** Plays `name`. Returns true when a voice was started (or queued for the resuming context). */
  function play(name, opts, replay = false) {
    const meta = recipes[name];
    if (!meta) return false;
    if (!set.enabled || set.volume <= 0 || set.sfxVolume <= 0) return false;
    if (hidden()) {
      stats.dropped += 1;
      return false;
    }
    const o = opts && typeof opts === 'object' ? opts : {};
    const t0 = now();
    const key = o.key ? `${name}:${o.key}` : name;
    if (!replay) {
      const last = lastPlayed.get(key);
      if (last !== undefined && t0 - last < meta.cooldown) {
        stats.cooled += 1;
        return false;
      }
    }
    const c = ensure();
    if (!c) {
      stats.dropped += 1;
      return false;
    }
    if (c.state !== 'running') tryResume();
    if (c.state !== 'running') {
      // still resuming: keep it a moment so the very first click or roll is not lost
      if (!replay && pending.length < 4) {
        pending.push({ name, opts: o, at: t0 });
        stats.queued += 1;
        return true;
      }
      stats.dropped += 1;
      return false;
    }
    sweep();
    lastPlayed.set(key, t0);
    if (lastPlayed.size > 200) lastPlayed.delete(lastPlayed.keys().next().value);

    // make room
    if (voices.size >= maxVoices || sources > maxSources) {
      const w = weakest();
      if (w && w.priority <= meta.priority) {
        kill(w);
        stats.stolen += 1;
      } else if (w) {
        stats.dropped += 1; // everything playing matters more than this
        return false;
      }
    }

    const t = c.currentTime + 0.012;
    const gain = c.createGain();
    const vol = Math.min(1.5, Math.max(0, Number.isFinite(Number(o.vol)) ? Number(o.vol) : 1));
    gain.gain.value = vol;
    gain.connect(nodes.effects);
    const voice = { id: nextId++, name, priority: meta.priority, born: t, end: t + meta.dur, gain, sources: 0, loud: 0, counted: 0, srcs: [], onIdle: null };
    voice.onIdle = () => {
      if (voices.delete(voice)) sources = Math.max(0, sources - voice.counted);
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    try {
      const synth = createSynth(c, gain, voice);
      meta.fn(synth, t, o);
    } catch {
      // a half-built voice: stop what exists and free it
      for (const s of voice.srcs) {
        try {
          s.stop(c.currentTime);
        } catch {
          /* ignore */
        }
      }
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
      stats.dropped += 1;
      return false;
    }
    if (voice.sources <= 0) {
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
      return false;
    }
    voice.counted = voice.sources;
    sources += voice.counted;
    voices.add(voice);
    stats.played += 1;
    if (meta.priority >= 1) duckFor(t, Math.min(meta.dur, 2.5));
    return true;
  }

  // ---- settings, ambient, lifecycle ----------------------------------------------------------
  function applySettings(s = {}) {
    if (s.sfx !== undefined) set.enabled = s.sfx !== false;
    if (s.volume !== undefined) set.volume = clamp01(s.volume);
    if (s.sfxVolume !== undefined) set.sfxVolume = clamp01(s.sfxVolume);
    if (s.ambient !== undefined) set.ambient = !!s.ambient;
    if (ctx && nodes) {
      try {
        const t = ctx.currentTime;
        nodes.master.gain.setTargetAtTime(masterLevel(set.volume), t, 0.02);
        nodes.effects.gain.setTargetAtTime(effectsLevel(set.sfxVolume), t, 0.02);
      } catch {
        /* ignore */
      }
    }
    if (!set.enabled || set.volume <= 0) stopAll();
    syncAmbient();
  }

  function wantAmbient() {
    return set.enabled && set.ambient && set.scene && set.volume > 0 && !hidden();
  }

  function syncAmbient() {
    const want = wantAmbient();
    if (want) {
      const c = ensure();
      if (!c) return;
      if (c.state !== 'running') {
        tryResume();
        return; // onState() calls syncAmbient again once it runs
      }
      if (!ambient) ambient = createAmbient(c, nodes.ambientBus, { setTimer, clearTimer });
      ambient.start();
    } else if (ambient) {
      ambient.stop();
    }
  }

  /** The game screen is up (true) or gone (false): the ambient bed only plays while it is. */
  function setScene(on) {
    set.scene = !!on;
    syncAmbient();
  }

  function stopAll() {
    for (const v of [...voices]) kill(v);
    pending = [];
    if (ambient) ambient.stop();
  }

  /** Resume after a gesture or when the tab comes back. Never throws. */
  function unlock() {
    const c = ensure();
    if (!c) return;
    tryResume();
    try {
      // iOS Safari: a silent one-sample buffer fully unlocks output
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }

  function onHidden() {
    stopAll();
    if (ctx && ctx.state === 'running') {
      suspendedByUs = true;
      try {
        const p = ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  function onVisible() {
    if (ctx) {
      tryResume();
      syncAmbient();
    }
  }

  function close() {
    stopAll();
    try {
      ctx?.close?.();
    } catch {
      /* ignore */
    }
    ctx = null;
    nodes = null;
    ambient = null;
  }

  return {
    play,
    applySettings,
    setScene,
    unlock,
    stopAll,
    onHidden,
    onVisible,
    close,
    /** A "needs a gesture" check for callers: the context is not running (suspended / interrupted / not created). */
    needsGesture: () => !ctx || ctx.state !== 'running',
    getContext: () => ctx,
    getNodes: () => nodes,
    activeVoices: () => voices.size,
    activeSources: () => sources,
    pendingCount: () => pending.length,
    isAmbientRunning: () => !!ambient && ambient.isRunning(),
    wasSuspendedByUs: () => suspendedByUs,
    stats: () => ({ ...stats, voices: voices.size, sources }),
    settings: () => ({ ...set }),
  };
}
