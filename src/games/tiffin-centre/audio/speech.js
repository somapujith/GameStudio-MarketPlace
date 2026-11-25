// Tiffin Centre speech: customers SAY their lines. Order of preference for one line:
//   1. a RECORDED clip (recorded.js: public/audio/tiffin-voices, ElevenLabs v3) when the line has one and the 'Voices' switch is on;
//   2. the browser's own Web Speech API (speechSynthesis, robotic, the voices the device already has) when the SEPARATE
//      'Synthetic voices' switch is on and the device has a voice for the language;
//   3. nothing: speak() returns false and the UI keeps showing the subtitle.
//
//   const speech = createTiffinSpeech({ synth?, SpeechUtterance?, recorded?, getSettings?, onStart?, onEnd?, onDrop?, now?, timers?, doc? });
//   speech.speak({ id, lineId?, text, lang: 'te'|'hi'|'dk', mood, ttlMs, customer }) -> boolean   queued or started (false: show the subtitle only)
//     (the recording is found by `lineId`, else `id`)
//   speech.cancel(customerId?)   one customer's lines (or everyone's when omitted); the line in the air is cut
//   speech.setEnabled(b)         the session switch of the Voices setting (recorded voices; synthetic voices need it too)
//   speech.setSynthEnabled(b)    the session switch of the Synthetic voices setting (starts from its persisted value, default off)
//   speech.setVolume(0..1)       on top of the hub's volume
//   speech.setPaused(b)          the game pauses: everything is cut and nothing starts until resumed
//   speech.isAvailable(lang)     true: the language has recordings, or synthetic voices are on and the device has a voice;
//                                false: neither; null: the recordings are still being looked for
//   speech.warm(lang?, ids?)     preload a few recorded clips (greetings, waiting) on an unmetered connection
//   speech.getVoiceStats()       { played, synth, missing, errors, ... } for debugging
//   speech.unlock()              call from a user gesture (iOS refuses to speak or play before one)
//   speech.dispose()
//
// onStart({ id, customer, lang, mood, text, estMs, intensity }) / onEnd({ ..., cancelled }) let the scene move the mouth.
// onDrop({ id, customer, reason }) tells that a queued line will never be spoken ('stale' | 'overflow' | 'replaced' | 'speakers' |
// 'cancel' | 'no-voice' | 'silent' | 'no-start' | 'error').
//
// Queue discipline (browsers speak one line at a time): at most MAX_QUEUE lines wait; the lowest priority (angry > impatient > the
// rest, oldest first) is dropped on overflow; a line older than its ttlMs is dropped instead of spoken late; a customer's newer line
// replaces their still-waiting older one; at most MAX_SPEAKERS different customers are in the pipeline (speaking + waiting).
//
// Persisted switches (localStorage):
//   `jalebi.tiffin.voices.v1`        'Voices' (recorded voices): ON unless the player turned it off ('1' stored by the old version stays on)
//   `jalebi.tiffin.voices.synth.v1`  'Synthetic voices' (the browser's robotic speech): OFF until the player turns it on

import { loadSettings, subscribeSettings } from '../../../lib/storage.js';
import { chooseVoice, speechParams, moodPriority, estimateMs, normalizeLang, clamp01 } from './speechVoices.js';
import { createRecordedVoices } from './recorded.js';

export const VOICES_KEY = 'jalebi.tiffin.voices.v1';
export const SYNTH_KEY = 'jalebi.tiffin.voices.synth.v1';
export const MAX_SPEAKERS = 2;
export const MAX_QUEUE = 3;
export const DEFAULT_TTL_MS = 6000;
export const KEEPALIVE_MS = 4000; // Chrome silently stops a long utterance after ~15 s: nudge it with resume() while speaking
export const START_WATCHDOG_MS = 4000; // no `start` event by then (iOS before a gesture, a swallowed speak()): give the line up
export const VOICE_WAIT_MS = 2000; // how long an empty voice list is believed to be "still loading" (Chrome fills it asynchronously)

// ------------------------------------------------------------------------------------------------ the persisted switches

const mem = new Map(); // values that could not be written to localStorage win over stale persisted data
const subs = { [VOICES_KEY]: new Set(), [SYNTH_KEY]: new Set() };

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readSwitch(key, fallback, storage) {
  let raw = null;
  if (mem.has(key)) raw = mem.get(key);
  else {
    try {
      raw = storage ? storage.getItem(key) : null;
    } catch {
      raw = null;
    }
  }
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return fallback; // never set (or garbage): the default
}

function writeSwitch(key, b, storage) {
  const value = b ? '1' : '0';
  try {
    if (!storage) throw new Error('no storage');
    storage.setItem(key, value);
    mem.delete(key);
  } catch {
    mem.set(key, value);
  }
  subs[key].forEach((cb) => {
    try {
      cb(!!b);
    } catch {
      /* a bad subscriber must not break the others */
    }
  });
  return !!b;
}

/**
 * Is the Voices switch (recorded voices) on? Default ON: only an explicit off ('0') turns it off; the '1' the old version stored stays on.
 * Never throws.
 */
export function getVoicesEnabled(storage = defaultStorage()) {
  return readSwitch(VOICES_KEY, true, storage);
}

/** Persists the Voices switch and tells the live speech objects (they follow it by themselves). */
export function setVoicesEnabled(b, storage = defaultStorage()) {
  return writeSwitch(VOICES_KEY, b, storage);
}

export function subscribeVoices(cb) {
  subs[VOICES_KEY].add(cb);
  return () => subs[VOICES_KEY].delete(cb);
}

/** Is the Synthetic voices switch (the browser's robotic speech, used only for lines without a recording) on? Default OFF. */
export function getSynthEnabled(storage = defaultStorage()) {
  return readSwitch(SYNTH_KEY, false, storage);
}

export function setSynthEnabled(b, storage = defaultStorage()) {
  return writeSwitch(SYNTH_KEY, b, storage);
}

export function subscribeSynth(cb) {
  subs[SYNTH_KEY].add(cb);
  return () => subs[SYNTH_KEY].delete(cb);
}

/** Test helper: forget the in-memory fallback. */
export function _resetVoicesMemory() {
  mem.clear();
}

// ------------------------------------------------------------------------------------------------ browser defaults

const hasWindow = () => typeof window !== 'undefined';
const browserSynth = () => (hasWindow() && window.speechSynthesis) || null;
const browserUtterance = () => (hasWindow() && window.SpeechSynthesisUtterance) || null;
const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
function defaultActivated() {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    return ua ? !!ua.hasBeenActive : true; // no API (old browsers): assume yes and let the start watchdog catch a refusal
  } catch {
    return true;
  }
}
function detectAndroid() {
  try {
    return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

function settingsSource(s) {
  if (s && typeof s.load === 'function') return { load: () => s.load(), subscribe: typeof s.subscribe === 'function' ? s.subscribe : () => () => {} };
  if (typeof s === 'function') return { load: s, subscribe: () => () => {} };
  if (s && typeof s === 'object') return { load: () => s, subscribe: () => () => {} };
  return { load: loadSettings, subscribe: subscribeSettings };
}

// ------------------------------------------------------------------------------------------------ the speech object

export function createTiffinSpeech(opts = {}) {
  const {
    synth = browserSynth(),
    SpeechUtterance = browserUtterance(),
    getSettings,
    onStart,
    onEnd,
    onDrop,
    now = defaultNow,
    timers = globalThis,
    doc = typeof document !== 'undefined' ? document : null,
    isActivated = defaultActivated,
    android = detectAndroid(),
    storage,
  } = opts;
  const hub = settingsSource(getSettings);
  const supported = !!synth && typeof synth.speak === 'function' && typeof SpeechUtterance === 'function';

  let enabled = opts.enabled ?? getVoicesEnabled(storage);
  let synthEnabled = opts.synthEnabled ?? getSynthEnabled(storage); // the browser's robotic voices: a separate opt-in
  let localVolume = 1;
  let paused = false;
  let hidden = false;
  let gestured = false;
  let disposed = false;
  let voices = [];
  let voicesEvent = false;
  const createdAt = now();
  let queue = [];
  let current = null;
  let autoId = 1;
  let keepalive = null;
  let startTimer = null;
  let maxTimer = null;
  let waitTimer = null;
  const unsubs = [];

  // ---- settings (sound on/off + volume, read like src/lib/sfx.js does; `voiceVolume` is the hub's voice-line fader)
  const hubSettings = () => {
    try {
      const s = hub.load() || {};
      return { sfx: s.sfx !== false, volume: clamp01(s.volume ?? 0.8), voiceVolume: clamp01(s.voiceVolume ?? 1) };
    } catch {
      return { sfx: true, volume: 0.8, voiceVolume: 1 };
    }
  };
  const masterVolume = () => {
    const h = hubSettings();
    return h.sfx ? h.volume * h.voiceVolume * localVolume : 0;
  };
  const baseOk = () => !disposed && enabled && !paused && !hidden && masterVolume() > 0.001;
  const mayPlay = () => supported && synthEnabled && baseOk(); // the SYNTHETIC path
  const stats = { synth: 0, missing: 0 };

  // ---- recorded voices (recorded.js). `opts.recorded`: a ready object, false (none), or options for createRecordedVoices; by default
  // a player is built when the browser has <audio>.
  const recordedOpts = opts.recorded && typeof opts.recorded === 'object' && typeof opts.recorded.play !== 'function' ? opts.recorded : {};
  let recorded = null;
  if (opts.recorded && typeof opts.recorded.play === 'function') recorded = opts.recorded;
  else if (opts.recorded !== false && (opts.recorded || typeof Audio === 'function')) {
    recorded = createRecordedVoices({
      getSettings: () => hub.load(),
      now,
      timers,
      enabled,
      onStart: (e) => callbackSafe(onStart, e),
      onEnd: (e) => callbackSafe(onEnd, e),
      onDrop: (e) => callbackSafe(onDrop, e),
      ...recordedOpts,
    });
  }
  function callbackSafe(fn, e) {
    try {
      fn?.(e);
    } catch {
      /* callbacks must not break playback */
    }
  }

  // ---- voices
  function refreshVoices() {
    try {
      const list = synth && typeof synth.getVoices === 'function' ? synth.getVoices() : [];
      voices = Array.isArray(list) ? list : Array.from(list || []);
    } catch {
      voices = [];
    }
  }
  const voicesPending = () => voices.length === 0 && !voicesEvent && now() - createdAt < VOICE_WAIT_MS;
  const voiceFor = (lang) => chooseVoice(voices, lang);

  function onVoicesChanged() {
    voicesEvent = true;
    refreshVoices();
    pump();
  }
  if (supported) {
    refreshVoices();
    try {
      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', onVoicesChanged);
        unsubs.push(() => synth.removeEventListener?.('voiceschanged', onVoicesChanged));
      } else {
        synth.onvoiceschanged = onVoicesChanged;
        unsubs.push(() => {
          if (synth.onvoiceschanged === onVoicesChanged) synth.onvoiceschanged = null;
        });
      }
    } catch {
      /* optional */
    }
  }

  // ---- bookkeeping
  const payload = (item, extra) => ({ id: item.id, customer: item.customer, lang: item.lang, mood: item.mood, text: item.text, ...extra });
  function drop(item, reason) {
    try {
      onDrop?.({ id: item.id, customer: item.customer, reason });
    } catch {
      /* callbacks must not break the queue */
    }
  }
  const clearTimer = (t, fn) => {
    if (t !== null) timers[fn](t);
    return null;
  };
  function clearCurrentTimers() {
    keepalive = clearTimer(keepalive, 'clearInterval');
    startTimer = clearTimer(startTimer, 'clearTimeout');
    maxTimer = clearTimer(maxTimer, 'clearTimeout');
  }
  const safeCancel = () => {
    try {
      synth?.cancel?.();
    } catch {
      /* ignore */
    }
  };

  /** Ends the line in the air (finished or cut): frees the slot, stops the timers, tells the scene when it had started. */
  function endCurrent(item, extra) {
    if (current !== item) return false;
    current = null;
    clearCurrentTimers();
    if (item.started) {
      try {
        onEnd?.(payload(item, { ...extra }));
      } catch {
        /* ignore */
      }
    } else {
      drop(item, extra.reason);
    }
    return true;
  }

  function pickNext() {
    let best = null;
    for (const it of queue) if (!best || it.priority > best.priority || (it.priority === best.priority && it.at < best.at)) best = it;
    return best;
  }

  function pump() {
    if (current || disposed || !queue.length) return;
    if (!mayPlay()) return;
    const t = now();
    const fresh = [];
    for (const it of queue) {
      if (t - it.at > it.ttl) drop(it, 'stale');
      else fresh.push(it);
    }
    queue = fresh;
    if (!queue.length) return;
    if (voicesPending()) {
      if (waitTimer === null) {
        waitTimer = timers.setTimeout(() => {
          waitTimer = null;
          refreshVoices();
          pump();
        }, 250);
      }
      return;
    }
    const item = pickNext();
    queue = queue.filter((q) => q !== item);
    start(item);
  }

  function start(item) {
    const voice = voiceFor(item.lang);
    if (!voice) {
      drop(item, 'no-voice');
      pump();
      return;
    }
    const p = speechParams(item.persona, item.mood);
    const volume = clamp01(masterVolume() * p.volume);
    if (volume <= 0.001) {
      drop(item, 'silent');
      pump();
      return;
    }
    item.intensity = p.intensity;
    item.estMs = estimateMs(item.text, p.rate);
    current = item;
    // Android Chrome keeps stale utterances in its queue: always start from a clean synth there (and elsewhere when it is busy).
    if (android || synth.speaking || synth.pending) safeCancel();
    let utt;
    try {
      utt = new SpeechUtterance(item.text);
      utt.voice = voice;
      utt.lang = voice.lang || '';
      utt.pitch = p.pitch;
      utt.rate = p.rate;
      utt.volume = volume;
      utt.onstart = () => {
        if (current !== item || item.started) return;
        item.started = true;
        startTimer = clearTimer(startTimer, 'clearTimeout');
        try {
          onStart?.(payload(item, { estMs: item.estMs, intensity: item.intensity }));
        } catch {
          /* ignore */
        }
      };
      utt.onend = () => {
        if (endCurrent(item, { cancelled: false, reason: 'end' })) pump();
      };
      utt.onerror = (e) => {
        const reason = e && e.error ? String(e.error) : 'error';
        if (endCurrent(item, { cancelled: true, reason })) pump();
      };
      synth.speak(utt);
    } catch {
      if (endCurrent(item, { cancelled: true, reason: 'error' })) pump();
      return;
    }
    keepalive = timers.setInterval(() => {
      try {
        if (synth.speaking) synth.resume?.();
      } catch {
        /* ignore */
      }
    }, KEEPALIVE_MS);
    startTimer = timers.setTimeout(() => {
      startTimer = null;
      if (current !== item || item.started) return;
      safeCancel();
      if (endCurrent(item, { cancelled: true, reason: 'no-start' })) pump();
    }, START_WATCHDOG_MS);
    maxTimer = timers.setTimeout(() => {
      maxTimer = null;
      if (current !== item) return;
      safeCancel();
      if (endCurrent(item, { cancelled: true, reason: 'timeout' })) pump();
    }, START_WATCHDOG_MS + Math.min(30000, Math.max(4000, item.estMs * 2.5)));
  }

  function cutCurrent(reason) {
    const item = current;
    if (!item) return false;
    safeCancel(); // before endCurrent: the browser's own 'error: canceled' for this line finds `current` already moved on
    endCurrent(item, { cancelled: true, reason });
    return true;
  }

  // ---- public API
  function speak(u) {
    if (!u || typeof u.text !== 'string') return false;
    const text = u.text.trim();
    const lang = normalizeLang(u.lang);
    if (!text || !lang) return false;
    // 1. a recording of this very line
    if (recorded && !disposed && enabled) {
      const lineId = typeof u.lineId === 'string' ? u.lineId : u.id;
      if (recorded.has(lineId, lang)) {
        const at = now();
        const onFail = () => {
          // accepted but never heard (a failed download, iOS refusing): the synthetic voice, if it is on and the line is still fresh
          const ttl = Number.isFinite(u.ttlMs) && u.ttlMs > 0 ? u.ttlMs : DEFAULT_TTL_MS;
          if (!disposed && now() - at <= ttl) speakSynth(u, text, lang);
        };
        if (baseOk() && recorded.play(u, { onFail })) return true;
      } else {
        const p = recorded.ensure(lang); // the first line of a language may find no manifest yet: the next ones will
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    }
    return speakSynth(u, text, lang);
  }

  /** 2. the browser's synthetic voice when it is switched on and the device has one; 3. nothing (false: the subtitle stays on its own). */
  function speakSynth(u, text, lang) {
    const unavailable = () => {
      stats.missing++;
      return false;
    };
    if (!mayPlay()) return unavailable();
    if (!gestured && !isActivated()) return unavailable(); // iOS (and Chrome) refuse to speak before the first tap
    if (!voicesPending() && !voiceFor(lang)) return unavailable();
    // `customer` is an id or { id, kind }; a line without one is anonymous (it still gets a stable voice from its own id)
    const who = u.customer ?? null;
    const customer = who !== null && typeof who === 'object' ? who.id ?? null : who === '' ? null : who;
    const persona = who ?? u.id ?? '';
    const item = {
      id: u.id ?? `line-${autoId++}`,
      text,
      lang,
      mood: u.mood || 'neutral',
      customer,
      persona,
      priority: Number.isFinite(u.priority) ? u.priority : moodPriority(u.mood),
      ttl: Number.isFinite(u.ttlMs) && u.ttlMs > 0 ? u.ttlMs : DEFAULT_TTL_MS,
      at: now(),
      started: false,
    };
    // a customer's newer line replaces their older one that is still waiting
    if (customer !== null) {
      queue = queue.filter((q) => {
        if (q.customer !== customer) return true;
        drop(q, 'replaced');
        return false;
      });
    }
    // at most MAX_SPEAKERS different customers in the pipeline (the one speaking counts)
    if (customer !== null) {
      const others = new Set();
      if (current && current.customer !== null && current.customer !== customer) others.add(current.customer);
      for (const q of queue) if (q.customer !== null && q.customer !== customer) others.add(q.customer);
      if (others.size >= MAX_SPEAKERS) {
        let weakest = null;
        for (const q of queue) {
          if (q.customer === null) continue;
          if (!weakest || q.priority < weakest.priority || (q.priority === weakest.priority && q.at < weakest.at)) weakest = q;
        }
        if (!weakest || weakest.priority >= item.priority) return false;
        queue = queue.filter((q) => q !== weakest);
        drop(weakest, 'speakers');
      }
    }
    // the waiting line is at most MAX_QUEUE long: the lowest priority (then the oldest) goes
    if (queue.length >= MAX_QUEUE) {
      let weakest = item;
      for (const q of queue) if (q.priority < weakest.priority || (q.priority === weakest.priority && q.at < weakest.at)) weakest = q;
      if (weakest === item) return false;
      queue = queue.filter((q) => q !== weakest);
      drop(weakest, 'overflow');
    }
    queue.push(item);
    stats.synth++;
    pump();
    return true;
  }

  function cancelSynth(customerId) {
    if (customerId === undefined || customerId === null) {
      const waiting = queue;
      queue = [];
      waiting.forEach((q) => drop(q, 'cancel'));
      waitTimer = clearTimer(waitTimer, 'clearTimeout');
      if (!cutCurrent('cancel') && supported && (synth.speaking || synth.pending)) safeCancel();
      return;
    }
    queue = queue.filter((q) => {
      if (q.customer !== customerId) return true;
      drop(q, 'cancel');
      return false;
    });
    if (current && current.customer === customerId) {
      cutCurrent('cancel');
      pump();
    }
  }

  /** Everything: the synthetic line and the recorded clips (one customer's, or all when no id is given). */
  function cancel(customerId) {
    cancelSynth(customerId);
    recorded?.cancel(customerId);
  }

  /** The recordings pause with the game / a hidden tab and carry on after; the synthetic voice cannot, so it is cut. */
  function syncRecordedPause() {
    recorded?.setPaused(paused || hidden);
  }

  /** A silent utterance: on iOS the first speak() must happen inside a user gesture, after that any speak() works. */
  function prime() {
    if (!supported || disposed || current || synth.speaking) return true;
    try {
      const u = new SpeechUtterance(' ');
      u.volume = 0;
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function setEnabled(b) {
    const was = enabled;
    enabled = !!b;
    recorded?.setEnabled(enabled);
    if (!enabled) cancel();
    else {
      if (!was && synthEnabled) prime(); // switched on from a menu tap: this is the gesture iOS wants
      pump();
    }
  }

  function setSynthEnabled(b) {
    const was = synthEnabled;
    synthEnabled = !!b;
    if (!synthEnabled) cancelSynth();
    else {
      if (!was && enabled) prime(); // the menu tap that switched it on
      pump();
    }
  }

  function applyHidden(h) {
    hidden = h;
    if (h) cancelSynth();
    syncRecordedPause();
    if (!h) pump();
  }

  if (doc && typeof doc.addEventListener === 'function') {
    const onVis = () => applyHidden(doc.visibilityState === 'hidden');
    doc.addEventListener('visibilitychange', onVis);
    unsubs.push(() => doc.removeEventListener?.('visibilitychange', onVis));
    hidden = doc.visibilityState === 'hidden';
  }
  unsubs.push(subscribeVoices((b) => setEnabled(b)));
  unsubs.push(subscribeSynth((b) => setSynthEnabled(b)));
  try {
    unsubs.push(
      hub.subscribe(() => {
        if (disposed) return;
        if (masterVolume() <= 0.001) cancel(); // the hub's sound got switched off or turned to zero mid-line
        else recorded?.updateVolume(); // a fader moved: the clips in the air follow it
      }),
    );
  } catch {
    /* optional */
  }

  return {
    speak,
    cancel,
    setEnabled,
    isEnabled: () => enabled,
    setSynthEnabled,
    isSynthEnabled: () => synthEnabled,
    setVolume(v) {
      localVolume = clamp01(v);
      recorded?.setVolume(localVolume);
      if (localVolume <= 0.001) cancel();
    },
    setPaused(b) {
      paused = !!b;
      if (paused) cancelSynth();
      syncRecordedPause();
      if (!paused) pump();
    },
    /**
     * Will a customer speaking `lang` be heard: true when the language has recordings, or the synthetic voices are on and the device has a
     * voice; false when neither; null while the recordings are still being looked for (do not show a "no voice" notice yet).
     */
    isAvailable(lang) {
      const synthOk = supported && synthEnabled && !!voiceFor(lang);
      if (synthOk) return true;
      if (!recorded || !normalizeLang(lang)) return false;
      const a = recorded.availability(lang);
      if (a === null && enabled) {
        const p = recorded.ensure(lang); // not looked for yet: start now, the answer is there next time
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      return a;
    },
    /** Preloads a few recorded clips (the greetings and waiting lines of the language, or of every language) on an unmetered connection. */
    warm: (lang, ids) => (recorded && enabled ? recorded.warm(lang, ids) : Promise.resolve(0)),
    /** { played, synth, missing, errors, dropped, ... } since the speech object was made (for debugging). */
    getVoiceStats() {
      const r = recorded ? recorded.stats() : {};
      return { played: r.played || 0, synth: stats.synth, missing: stats.missing, errors: r.errors || 0, dropped: r.dropped || 0, recorded: r };
    },
    recorded: () => recorded,
    /** The installed voice a language would use (for a settings screen), or null. */
    voiceFor: (lang) => (supported ? voiceFor(lang) : null),
    /** From a user gesture: lets iOS speak afterwards (a silent utterance, only while Voices is on) and lifts the gesture check. */
    unlock() {
      gestured = true;
      const rec = recorded && !disposed ? recorded.unlock() : false;
      if (!supported || disposed) return rec;
      return enabled && synthEnabled ? prime() || rec : true;
    },
    isSpeaking: () => !!current || !!recorded?.isPlaying?.(),
    stats: () => ({ speaking: current ? current.id : null, queued: queue.map((q) => q.id), voices: voices.length }),
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      recorded?.dispose?.();
      waitTimer = clearTimer(waitTimer, 'clearTimeout');
      unsubs.splice(0).forEach((f) => {
        try {
          f();
        } catch {
          /* ignore */
        }
      });
    },
  };
}

export default createTiffinSpeech;
