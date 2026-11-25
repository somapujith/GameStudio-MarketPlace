// Tiffin Centre audio: everything is synthesised with Web Audio (no files, no CDN). Public face:
//
//   const audio = createTiffinAudio({ getAudioContext?, settings?, meId?, ... });
//   audio.unlock()                 call from a user gesture; nothing plays before it. Idempotent. Resumes a suspended context.
//   audio.handleEvents(events, state?)   the engine's event objects (plan section 3) -> sounds (+ phone vibration)
//   audio.setState(state, tickAt)  drives the ambience (hour of the shift, how busy the counter is) and the footsteps (players[id].at)
//   audio.setHour(hour)            ambience by hand (menus, tests); the continuous hour 0..29 of the 24h clock
//   audio.startAmbience() / stopAmbience()
//   audio.setMuted(b) / isMuted()  the game's own mute (isMuted() is also true while the hub's sound setting is off)
//   audio.setVolume(0..1)          on top of the hub's volume setting
//   state.events / state.gas / the prep counter's jobs (plan section 3b) start and stop the operations loops: rain, cricket TV, festival
//   drum, delivery bike, generator, wet grinder, pot simmer, regulator hiss (opsAudio.js); their one-shots come through handleEvents
//   audio.setMe(playerId)          who "you" are: your actions are louder than the others', your hands buzz, theirs do not
//   audio.dispose()
//
// The context comes from `getAudioContext()` (default: a new browser AudioContext, created on the first unlock), so tests inject a
// fake one. Hub settings (sound on/off, volume, effects volume; haptics and reduced motion inside the hub's `buzz`) come from
// `settings` = { load(), subscribe(cb) } (default: src/lib/storage.js), or a plain object, or a function returning the object.
//
// Graph:  recorded customer voices (HTMLAudio clips) -> voiceBus --------------------------------------------------+
//         voices -> sfxBus --+
//         ambience, ops loops, crowd murmur (via crowdBus: the inspector's hush) -> ambBus-+-> group (effects fader) -> master (volume, mute) -> compressor -> soft clip -> destination
//         (the recorded voices join at the master: the hub volume and mute apply, the effects fader does not)

import { loadSettings, subscribeSettings } from '../../../lib/storage.js';
import { createSynth } from '@/lib/soundscape/synth.js';
import { masterLevel, effectsLevel, softClipCurve } from '@/lib/soundscape/mixer.js';
import { RECIPES } from './recipes.js';
import { createAmbience } from './ambience.js';
import { createVoiceLimiter, soundsForEvent, soundsForMove } from './mapping.js';
import { layerLevels, hourOfState, busyOfState } from './mix.js';
import { createTiffinHaptics } from './haptics.js';
import { createTiffinSpeech } from './speech.js';
import { createCrowd } from './crowd.js';
import { createOpsAudio } from './opsAudio.js';
import { adjustAmbience } from './opsMix.js';

export {
  createTiffinSpeech,
  getVoicesEnabled,
  setVoicesEnabled,
  subscribeVoices,
  VOICES_KEY,
  getSynthEnabled,
  setSynthEnabled,
  subscribeSynth,
  SYNTH_KEY,
} from './speech.js';
export { createRecordedVoices, isMeteredConnection } from './recorded.js';
export { crowdHandle, createCrowd } from './crowd.js';
export { soundsForEvent, soundsForMove, createVoiceLimiter } from './mapping.js';
export { layerLevels, daypartWeights } from './mix.js';
export { hapticFor, HAPTIC_PATTERNS, createTiffinHaptics } from './haptics.js';
export { createOpsAudio } from './opsAudio.js';
export { opsTargets, adjustAmbience, prepKindOf, eventIdsOf } from './opsMix.js';

const AMBIENCE_BUS = 0.6;
const MAX_EVENTS_PER_CALL = 24; // a reconnect can hand over a long backlog: never turn it into a wall of sound
const HUSH_LEVEL = 0.28; // the crowd murmur while the inspector looks round
const HOUR_EPS = 0.01;
const BUSY_EPS = 0.05;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp01 = (v) => Math.min(1, Math.max(0, num(v, 0)));

function defaultContextFactory() {
  if (typeof window === 'undefined') return null;
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

function settingsSource(s) {
  if (s && typeof s.load === 'function') return { load: () => s.load(), subscribe: typeof s.subscribe === 'function' ? s.subscribe : () => () => {} };
  if (typeof s === 'function') return { load: s, subscribe: () => () => {} };
  if (s && typeof s === 'object') return { load: () => s, subscribe: () => () => {} };
  return { load: loadSettings, subscribe: subscribeSettings };
}

export function createTiffinAudio({
  getAudioContext,
  settings,
  meId = null,
  now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
  timers = globalThis,
  rng = Math.random,
  doc = typeof document !== 'undefined' ? document : null,
  buzz,
  haptics = true,
  speech: speechOptions = {}, // options of createTiffinSpeech (synth, onStart, onEnd, ...) or a ready speech object
  crowd: crowdEnabled = true, // the murmur of waiting customers and the "tsk / hmph / mmm" vocalisations
} = {}) {
  const factory = getAudioContext || defaultContextFactory;
  const ownsContext = !getAudioContext;
  const hub = settingsSource(settings);
  const limiter = createVoiceLimiter();
  const hapt = createTiffinHaptics({ buzz, meId, now });

  let me = meId;
  let ctx = null;
  let nodes = null; // { sfxBus, ambBus, group, master, comp, shaper }
  let ambience = null;
  let crowd = null;
  let ops = null; // the operations layer's loops (rain, grinder, ...)
  let pendingState = null; // the latest state, handed to the ops layer when the context exists
  let speech = null; // created on first use (the browser's speechSynthesis is only touched when a line is spoken)
  let unlocked = false;
  let disposed = false;
  let muted = false;
  let localVolume = 1;
  let wantAmbience = false;
  let hour = null;
  let busy = 0.5;
  let lastHour = null;
  let lastBusy = null;
  let unsubSettings = null;
  let visHandler = null;
  const voices = new Map(); // limiter id -> { g }
  const lastAt = new Map(); // player id -> last `at` seen (footsteps)

  const hubSettings = () => {
    try {
      const s = hub.load() || {};
      return { sfx: s.sfx !== false, volume: clamp01(num(s.volume, 0.8)), sfxVolume: clamp01(num(s.sfxVolume, 1)) };
    } catch {
      return { sfx: true, volume: 0.8, sfxVolume: 1 };
    }
  };
  const effectivelyMuted = () => muted || !hubSettings().sfx;

  function applyLevels() {
    if (!ctx || !nodes) return;
    const h = hubSettings();
    const t = ctx.currentTime;
    const master = muted || !h.sfx ? 0 : masterLevel(h.volume * localVolume);
    try {
      nodes.master.gain.setTargetAtTime(master, t, 0.03);
      nodes.group.gain.setTargetAtTime(effectsLevel(h.sfxVolume), t, 0.03);
    } catch {
      nodes.master.gain.value = master;
    }
    ops?.setEnabled(!(muted || !h.sfx)); // muted: no loops, no scheduler (CPU)
  }

  function buildGraph() {
    const sfxBus = ctx.createGain();
    const ambBus = ctx.createGain();
    const group = ctx.createGain();
    const master = ctx.createGain();
    const crowdBus = ctx.createGain(); // the murmur's own fader: the inspector's hush dips it
    const voiceBus = ctx.createGain(); // recorded customer lines (recorded.js): into the master, so the limiter catches them too
    const comp = ctx.createDynamicsCompressor();
    const shaper = ctx.createWaveShaper();
    ambBus.gain.value = AMBIENCE_BUS;
    master.gain.value = 0;
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 14;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    try {
      shaper.curve = softClipCurve();
      shaper.oversample = '2x';
    } catch {
      /* optional */
    }
    sfxBus.connect(group);
    ambBus.connect(group);
    group.connect(master);
    master.connect(comp);
    comp.connect(shaper);
    shaper.connect(ctx.destination);
    crowdBus.connect(ambBus);
    voiceBus.connect(master);
    nodes = { sfxBus, ambBus, crowdBus, voiceBus, group, master, comp, shaper };
    ambience = createAmbience({ ctx, dest: ambBus, now, timers, rng });
    if (crowdEnabled) crowd = createCrowd({ ctx, dest: crowdBus, vocalDest: sfxBus, now, timers, rng });
    ops = createOpsAudio({ ctx, dest: ambBus, now, timers, rng });
  }

  function getSpeech() {
    if (!speech) {
      const ready = speechOptions && typeof speechOptions.speak === 'function';
      if (ready) speech = speechOptions;
      else {
        const ro = speechOptions && speechOptions.recorded;
        // the recorded player plays through this graph (master gain + limiter, panned) once the context exists
        const recorded =
          ro === false ? false : ro && typeof ro.play === 'function' ? ro : { getContext: () => ctx, getDest: () => nodes?.voiceBus || null, ...(ro && typeof ro === 'object' ? ro : {}) };
        speech = createTiffinSpeech({ getSettings: settings, ...speechOptions, recorded });
      }
      speech.setVolume?.(localVolume);
    }
    return speech;
  }

  function resume() {
    try {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      /* needs another gesture */
    }
  }

  function installLifecycle() {
    if (visHandler || !doc || typeof doc.addEventListener !== 'function') return;
    visHandler = () => {
      if (!ctx || disposed) return;
      try {
        if (doc.visibilityState === 'hidden') {
          const p = ctx.suspend?.();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } else if (unlocked) {
          resume();
        }
      } catch {
        /* ignore */
      }
    };
    doc.addEventListener('visibilitychange', visHandler);
  }

  function applyAmbience() {
    if (!ambience || hour === null) return;
    ambience.setLevels(adjustAmbience(layerLevels(hour, busy), ops?.flags()));
    lastHour = hour;
    lastBusy = busy;
  }

  function stealVoice(id) {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    try {
      v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.01); // fade out in ~15 ms ...
    } catch {
      /* ignore */
    }
    for (const src of v.voice.srcs) {
      try {
        src.stop(ctx.currentTime + 0.05); // ... then free the CPU: its oscillators and noise sources stop early
      } catch {
        /* already stopped */
      }
    }
  }

  /** Starts one planned sound ({ name, opts, priority, gain, key? }). Returns true when a voice started. */
  function play(item) {
    if (!ctx || !nodes || !unlocked || disposed || effectivelyMuted()) return false;
    const recipe = RECIPES[item.name];
    if (!recipe) return false;
    const r = limiter.request(item.name, item.priority, now(), item.key || item.name);
    if (!r.ok) return false;
    if (r.steal != null) stealVoice(r.steal);
    const g = ctx.createGain();
    g.gain.value = item.gain ?? 1;
    g.connect(nodes.sfxBus);
    const finish = () => {
      limiter.end(r.id);
      voices.delete(r.id);
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    const voice = { sources: 0, loud: 0, end: 0, srcs: [], onIdle: finish };
    const synth = createSynth(ctx, g, voice);
    try {
      recipe(synth, ctx.currentTime + 0.005, item.opts || {});
    } catch {
      /* a broken recipe must not break the game */
    }
    if (voice.sources === 0) {
      finish();
      return false;
    }
    voices.set(r.id, { g, voice });
    return true;
  }

  // ------------------------------------------------------------------------------------------ public API

  const api = {
    /** Create / resume the context. Call from a user gesture. Returns false when audio is unsupported. */
    unlock() {
      if (disposed) return false;
      try {
        if (!ctx) {
          ctx = factory();
          if (!ctx) return false;
          buildGraph();
          unsubSettings = hub.subscribe(applyLevels);
        }
      } catch {
        ctx = null;
        return false;
      }
      unlocked = true;
      resume();
      installLifecycle();
      applyLevels();
      applyAmbience();
      if (wantAmbience) {
        ambience.start();
        crowd?.start();
        ops?.start();
      }
      if (pendingState) ops?.setState(pendingState); // a resume: the rain / the grinder that are already going
      getSpeech().unlock?.(); // iOS only speaks / plays <audio> after a gesture: this is one
      if (wantAmbience) warmVoices();
      return true;
    },
    isUnlocked: () => unlocked,
    /** Sound voices playing right now (for tests and debugging). */
    voiceCount: () => voices.size,
    setMuted(b) {
      muted = !!b;
      applyLevels();
      if (muted) speech?.cancel();
    },
    isMuted: () => effectivelyMuted(),
    setVolume(v) {
      localVolume = clamp01(v);
      applyLevels();
      speech?.setVolume?.(localVolume);
    },
    setMe(id) {
      me = id;
      hapt.setMe(id);
    },

    /**
     * The engine's events of one state change -> sounds and a vibration. `state` (optional) tells where customers stand.
     * Returns how many sounds started. Does nothing before unlock().
     */
    handleEvents(events, state = null) {
      if (!unlocked || disposed || !Array.isArray(events) || !events.length) return 0;
      const list = events.length > MAX_EVENTS_PER_CALL ? events.slice(-MAX_EVENTS_PER_CALL) : events;
      let started = 0;
      for (const ev of list) {
        for (const item of soundsForEvent(ev, { meId: me, state })) if (play(item)) started++;
      }
      if (crowd && !effectivelyMuted()) crowd.handle(list, state); // tsk / hmph / mmm / laugh: not counted in `started`
      if (ops) {
        let flagsChanged = false;
        let weather = false;
        for (const ev of list) {
          if (!ev) continue;
          if (ev.type === 'event-start' || ev.type === 'event-end') weather = true;
          if (ops.noteEvent(ev)) flagsChanged = true;
          if (ev.type === 'event-start' && ev.id === 'inspector') hushCrowd(4); // the whistle, then everyone goes quiet
          else if (ev.type === 'inspector') hushCrowd(2);
        }
        if (!weather && state) ops.setState(state); // a prep job / the cylinder changed with these events
        if (flagsChanged) applyAmbience();
      }
      if (haptics) hapt.handle(list);
      if (list.some((e) => e && (e.type === 'shift-end' || e.type === 'life-lost'))) duckAmbience();
      return started;
    },

    /** The latest state: drives the ambience (hour, busy) and the footsteps (a player's `at` changed = they walked). */
    setState(state, tickAt) {
      if (disposed || !state) return;
      void tickAt;
      hour = hourOfState(state);
      busy = busyOfState(state);
      pendingState = state;
      if (unlocked) crowd?.update(state); // the murmur follows how many customers wait
      const flagsChanged = unlocked && ops ? ops.setState(state) : false; // rain / power change the dry-weather beds
      if (lastHour === null || flagsChanged || Math.abs(hour - lastHour) >= HOUR_EPS || Math.abs(busy - (lastBusy ?? 0)) >= BUSY_EPS) applyAmbience();
      const players = state.players && typeof state.players === 'object' ? state.players : {};
      for (const [id, p] of Object.entries(players)) {
        const at = p?.at ?? null;
        if (lastAt.has(id) && lastAt.get(id) !== at && unlocked) {
          for (const item of soundsForMove(lastAt.get(id), at, { mine: me == null || id === me, key: id })) play(item);
        }
        lastAt.set(id, at);
      }
    },
    setHour(h) {
      if (disposed || !Number.isFinite(Number(h))) return;
      hour = Number(h);
      applyAmbience();
    },
    startAmbience() {
      wantAmbience = true;
      if (unlocked && ambience && !disposed) {
        warmVoices(); // the start of a shift: the greeting / waiting clips are fetched before the first customers speak
        applyAmbience();
        ambience.start();
        crowd?.start();
        ops?.start();
      }
    },
    stopAmbience() {
      wantAmbience = false;
      ambience?.stop();
      crowd?.stop();
      ops?.stop();
    },
    isAmbienceOn: () => !!ambience?.isRunning(),

    /**
     * A customer's spoken line ({ id, text, lang: 'te'|'hi'|'dk', mood, ttlMs, customer }) through the browser's speech voices.
     * Returns false when it will not be spoken (Voices off, muted, no voice for that language): show the subtitle instead.
     */
    speak(utterance) {
      if (disposed || muted || !hubSettings().sfx) return false;
      try {
        return getSpeech().speak(utterance);
      } catch {
        return false;
      }
    },
    /** The 'Voices' switch of this session (recorded voices; persist it with setVoicesEnabled, the speech object also follows that by itself). */
    setSpeechEnabled(b) {
      getSpeech().setEnabled(!!b);
    },
    /** The 'Synthetic voices' switch (the browser's robotic speech for lines without a recording; default off, persist it with setSynthEnabled). */
    setSynthEnabled(b) {
      getSpeech().setSynthEnabled?.(!!b);
    },
    /** Fetches a few recorded clips ahead (the language's greetings and waiting lines; every language when `lang` is omitted). Never on a metered link. */
    warmVoices,
    /** { played, synth, missing, errors, dropped, recorded: {...} }: how lines were voiced so far (debugging). */
    getVoiceStats: () => getSpeech().getVoiceStats?.() ?? { played: 0, synth: 0, missing: 0, errors: 0, dropped: 0 },
    cancelSpeech: (customerId) => speech?.cancel(customerId),
    setSpeechPaused: (b) => getSpeech().setPaused?.(!!b),
    isSpeechAvailable: (lang) => getSpeech().isAvailable(lang),
    getSpeech,

    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        speech?.dispose?.();
        crowd?.dispose();
        ops?.dispose();
        ambience?.dispose();
        unsubSettings?.();
        if (visHandler && doc) doc.removeEventListener('visibilitychange', visHandler);
        visHandler = null;
        voices.clear();
        limiter.reset();
        hapt.cancel();
        if (nodes) for (const n of Object.values(nodes)) n.disconnect();
        if (ctx && ownsContext) ctx.close?.();
      } catch {
        /* ignore */
      }
      ctx = null;
      nodes = null;
    },
  };

  let warmedOnce = false;
  /** See api.warmVoices. Resolves with the number of clips fetched; never rejects. */
  function warmVoices(lang, ids) {
    if (disposed || (!lang && warmedOnce)) return Promise.resolve(0);
    if (!lang) warmedOnce = true;
    try {
      return Promise.resolve(getSpeech().warm?.(lang, ids) ?? 0).catch(() => 0);
    } catch {
      return Promise.resolve(0);
    }
  }

  /** The crowd murmur goes quiet for `seconds` (the inspector is looking) and comes back by itself. */
  function hushCrowd(seconds) {
    if (!ctx || !nodes) return;
    const t = ctx.currentTime;
    try {
      nodes.crowdBus.gain.setTargetAtTime(HUSH_LEVEL, t, 0.12);
      nodes.crowdBus.gain.setTargetAtTime(1, t + seconds, 0.5);
    } catch {
      /* ignore */
    }
  }

  /** The ambience dips under the fanfare / the thud and comes back by itself. */
  function duckAmbience() {
    if (!ctx || !nodes) return;
    const t = ctx.currentTime;
    try {
      nodes.ambBus.gain.setTargetAtTime(AMBIENCE_BUS * 0.3, t, 0.05);
      nodes.ambBus.gain.setTargetAtTime(AMBIENCE_BUS, t + 1.6, 0.6);
    } catch {
      /* ignore */
    }
  }

  return api;
}

export default createTiffinAudio;
