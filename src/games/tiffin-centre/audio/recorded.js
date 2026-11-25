// Tiffin Centre recorded voices: the customers' lines as real recordings (ElevenLabs v3 clips in public/audio/tiffin-voices/).
//
//   const rec = createRecordedVoices({ getContext?, getDest?, getSettings?, onStart?, onEnd?, onDrop?, fetch?, createAudio?, ... });
//   rec.has(lineId, lang)          is there a clip for this line (false until the language's manifest has loaded)
//   rec.hasLang(lang) / rec.availability(lang)   the manifest has lines: true | false | null (null: not known yet / still loading)
//   rec.ensure(lang) -> Promise<boolean>   lazily fetches manifest.<lang>.json once (404 / offline / corrupt: false, silently; retried later)
//   rec.play(utterance, { priority?, ttl?, onFail? }) -> boolean   queued or started (false: no clip / not unlocked / disabled)
//   rec.warm(lang?, lineIds?) -> Promise<number>   preloads a few clips (greetings, waiting) on an unmetered connection only
//   rec.cancel(customerId?)        one customer's lines (or everyone's)
//   rec.setPaused(b)               game paused / tab hidden: the clips in the air are paused and resume after (or are cut after a long pause)
//   rec.setEnabled(b) / rec.setVolume(0..1) / rec.updateVolume() / rec.unlock() (from a user gesture) / rec.stats() / rec.dispose()
//
// The assets: /audio/tiffin-voices/manifest.<lang>.json = { v:1, lang, lines: { "<lineId>": { f:"te/<lineId>.mp3", ms, voice, g, tag, mood, sit } } }.
// Only some lines are recorded: for every other line has() is false and the caller falls back (the browser's voices, or subtitles only).
// The utterance's line id is `utterance.lineId` (the director's) or, failing that, `utterance.id`.
//
// Playback: an HTMLAudioElement pool (3 elements, reused, preload='auto'). A clip is fetched on demand (same origin only), kept as a blob
// in a small LRU (24 clips) and played from there. When an AudioContext exists the element goes MediaElementSource -> gain -> StereoPanner
// -> dest (the shared master + limiter of createTiffinAudio), so the hub volume / mute apply through the master and customers are panned
// by their id (or `utterance.pan`); without one the element's own volume is used. Each customer's voice is the same recording sped by
// 0.94..1.06 (their id hash, pitch preserved).
//
// Queue (same rules as speech.js): at most 2 different customers in the pipeline, 3 lines waiting, the lowest priority is dropped on
// overflow, a line older than its ttl is dropped instead of played late, a customer's newer line replaces their waiting older one.
// onStart({ id, customer, lang, mood, text, estMs, intensity }) when the clip is audible; onEnd({ ..., durationMs, cancelled, reason }) when it
// ended or was cut, with the real length it played; onDrop({ id, customer, reason }) for a line that never started.

import { normalizeLang, hashString, speechParams, moodPriority, clamp01 } from './speechVoices.js';

export const DEFAULT_BASE = '/audio/tiffin-voices/';
export const POOL_SIZE = 3; // elements, so at most 3 clips in the air
export const MAX_SPEAKERS = 2;
export const MAX_QUEUE = 3;
export const CACHE_MAX = 24; // clips kept as blobs
export const WARM_MAX = 12;
export const DEFAULT_TTL_MS = 6000;
export const RETRY_MS = 30000; // a failed manifest is asked for again no sooner than this
export const PAUSE_MAX_MS = 8000; // a clip paused longer than this is cut instead of resumed (the moment has passed)
export const RATE_RANGE = Object.freeze([0.94, 1.06]);
export const WHISPER_GAIN = 0.6;

const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const SAFE_FILE = /^[a-z]{2}\/[A-Za-z0-9_.-]{1,100}\.mp3$/;
const WHISPER_RE = /whisper|hush|murmur|mutter|soft/i;
// one empty 8-bit mono WAV: playing it inside a user gesture is what unlocks an <audio> element on iOS
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const defaultCreateAudio = () => (typeof Audio === 'function' ? new Audio() : null);
const noop = () => {};

/** Is this connection one to spare? false with data saver on or a 2g / 3g link. */
export function isMeteredConnection(nav = typeof navigator !== 'undefined' ? navigator : null) {
  try {
    const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    if (!c) return false;
    return !!c.saveData || /^(slow-2g|2g|3g)$/.test(String(c.effectiveType || ''));
  } catch {
    return false;
  }
}

/** The playback speed of one customer's voice: 0.94..1.06, always the same for the same id. */
export function voiceRate(key) {
  const u = hashString(key ?? '', 0x7) / 0x100000000;
  return RATE_RANGE[0] + u * (RATE_RANGE[1] - RATE_RANGE[0]);
}

/** Stereo position of a customer, -0.7..0.7, from their id. */
export function voicePan(key) {
  return (hashString(key ?? '', 0x9) / 0x100000000) * 1.4 - 0.7;
}

/** Whisper-like tags are quieter. */
export const isWhisper = (...tags) => tags.some((t) => typeof t === 'string' && WHISPER_RE.test(t));

function safeBase(b) {
  const s = typeof b === 'string' ? b : '';
  if (!s.startsWith('/') || s.startsWith('//')) return DEFAULT_BASE; // same origin only
  return s.endsWith('/') ? s : `${s}/`;
}

/** Customer given as an id or { id, kind }. */
function whoOf(u) {
  const who = u.customer ?? null;
  const customer = who !== null && typeof who === 'object' ? who.id ?? null : who === '' ? null : who;
  return { who, customer };
}

export function createRecordedVoices(opts = {}) {
  const {
    fetch: fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
    createAudio = defaultCreateAudio,
    getContext = () => null,
    getDest = () => null,
    getSettings,
    onStart,
    onEnd,
    onDrop,
    now = defaultNow,
    timers = globalThis,
    nav = typeof navigator !== 'undefined' ? navigator : null,
    urlApi = typeof URL !== 'undefined' ? URL : null,
    enabled: startEnabled = true,
  } = opts;
  const base = safeBase(opts.baseUrl);
  const canBlob = !!(urlApi && typeof urlApi.createObjectURL === 'function');
  const supported = typeof createAudio === 'function' && (opts.createAudio !== undefined || typeof Audio === 'function');

  let enabled = !!startEnabled;
  let unlocked = false;
  let paused = false;
  let pausedAt = 0;
  let disposed = false;
  let localVolume = 1;
  let autoId = 1;
  let queue = [];
  const active = []; // items loading or playing
  const pool = []; // { el, graph, item, bound }
  const manifests = new Map(); // lang -> { status, lines (Map), count, failedAt, promise }
  const clips = new Map(); // url -> { src, blob: bool, refs } in LRU order (oldest first)
  const inflight = new Map(); // url -> Promise<clip>
  const counters = { played: 0, errors: 0, dropped: 0, loads: 0, blocked: 0 };

  // ------------------------------------------------------------------------------------------ settings and levels
  const hub = () => {
    try {
      const s = (typeof getSettings === 'function' ? getSettings() : getSettings) || {};
      return { sfx: s.sfx !== false, volume: clamp01(s.volume ?? 0.8), voiceVolume: clamp01(s.voiceVolume ?? 1) };
    } catch {
      return { sfx: true, volume: 0.8, voiceVolume: 1 };
    }
  };
  const audible = () => {
    const h = hub();
    return h.sfx && h.volume * h.voiceVolume * localVolume > 0.001;
  };

  function itemLevel(item, routed) {
    const h = hub();
    const mood = speechParams(item.persona, item.mood).volume * (item.whisper ? WHISPER_GAIN : 1);
    // routed: the master gain already carries hub volume x the game's volume and the mute; direct: the element carries everything
    const level = routed ? h.voiceVolume * mood : h.sfx ? h.volume * h.voiceVolume * localVolume * mood : 0;
    return clamp01(level);
  }

  function applyLevel(slot) {
    const item = slot.item;
    if (!item) return;
    const level = itemLevel(item, !!slot.graph);
    try {
      if (slot.graph) slot.graph.gain.gain.value = level;
      else slot.el.volume = level;
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------ manifests
  const manifestUrl = (lang) => `${base}manifest.${lang}.json`;

  function parseManifest(lang, json) {
    if (!json || typeof json !== 'object' || !json.lines || typeof json.lines !== 'object') return null;
    if (json.v !== undefined && json.v !== 1) return null;
    const lines = new Map();
    for (const [id, e] of Object.entries(json.lines)) {
      if (!SAFE_ID.test(id)) continue;
      const entry = e && typeof e === 'object' ? e : {};
      const f = typeof entry.f === 'string' ? entry.f : `${lang}/${id}.mp3`;
      if (!SAFE_FILE.test(f)) continue;
      const ms = Number.isFinite(Number(entry.ms)) && Number(entry.ms) > 0 ? clamp(Number(entry.ms), 200, 30000) : 2500;
      lines.set(id, {
        f,
        ms,
        g: entry.g === 'm' || entry.g === 'f' ? entry.g : '',
        voice: typeof entry.voice === 'string' ? entry.voice : '',
        tag: typeof entry.tag === 'string' ? entry.tag : '',
        mood: typeof entry.mood === 'string' ? entry.mood : '',
        sit: typeof entry.sit === 'string' ? entry.sit : '',
      });
    }
    return lines;
  }

  function ensure(langIn) {
    const lang = normalizeLang(langIn);
    if (!lang || !supported || disposed || !enabled || !fetchFn) return Promise.resolve(false);
    const m = manifests.get(lang);
    if (m) {
      if (m.status === 'ready') return Promise.resolve(true);
      if (m.status === 'loading') return m.promise;
      if (now() - m.failedAt < RETRY_MS) return Promise.resolve(false);
    }
    const entry = { status: 'loading', lines: new Map(), count: 0, failedAt: 0, promise: null };
    const fail = () => {
      entry.status = 'failed';
      entry.failedAt = now();
      return false;
    };
    entry.promise = (async () => {
      try {
        const res = await fetchFn(manifestUrl(lang), { credentials: 'same-origin' });
        if (!res || !res.ok) return fail();
        const lines = parseManifest(lang, await res.json());
        if (!lines) return fail();
        if (disposed) return false;
        entry.lines = lines;
        entry.count = lines.size;
        entry.status = 'ready';
        return true;
      } catch {
        return fail(); // offline, 404 served as HTML, corrupt JSON: silently no recordings
      }
    })();
    manifests.set(lang, entry);
    return entry.promise;
  }

  function lookup(lineId, langIn) {
    const lang = normalizeLang(langIn);
    const m = lang ? manifests.get(lang) : null;
    if (!m || m.status !== 'ready' || typeof lineId !== 'string') return null;
    return m.lines.get(lineId) || null;
  }

  const has = (lineId, lang) => supported && !disposed && !!lookup(lineId, lang);

  function availability(langIn) {
    const lang = normalizeLang(langIn);
    if (!lang || !supported || !fetchFn) return false;
    const m = manifests.get(lang);
    if (!m || m.status === 'loading') return null;
    return m.status === 'ready' && m.count > 0;
  }

  // ------------------------------------------------------------------------------------------ clips (fetch + LRU of blobs)
  function evict() {
    for (const [url, c] of clips) {
      if (clips.size <= CACHE_MAX) break;
      if (c.refs > 0) continue;
      clips.delete(url);
      if (c.blob) {
        try {
          urlApi.revokeObjectURL(c.src);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Resolves with a clip { src, blob, refs } (refs already +1: release it with unref) or rejects. */
  function loadClip(url) {
    const hit = clips.get(url);
    if (hit) {
      clips.delete(url); // refresh its place in the LRU
      clips.set(url, hit);
      hit.refs++;
      return Promise.resolve(hit);
    }
    let p = inflight.get(url);
    if (!p) {
      p = (async () => {
        counters.loads++;
        if (!fetchFn || !canBlob) return { src: url, blob: false, refs: 0 }; // no way to keep it: let the element stream it
        const res = await fetchFn(url, { credentials: 'same-origin' });
        if (!res || !res.ok) throw new Error('clip-http');
        const blob = await res.blob();
        const type = String(blob?.type || '');
        if (!blob || !(blob.size > 0) || /html|json|text/i.test(type)) throw new Error('clip-bad'); // an SPA fallback page, an empty file
        return { src: urlApi.createObjectURL(blob), blob: true, refs: 0 };
      })();
      inflight.set(url, p);
      const clear = () => inflight.delete(url);
      p.then(clear, clear);
    }
    return p.then((c) => {
      let kept = clips.get(url);
      if (!kept) {
        if (disposed) {
          if (c.blob) {
            try {
              urlApi.revokeObjectURL(c.src);
            } catch {
              /* ignore */
            }
          }
          throw new Error('disposed');
        }
        kept = c;
        clips.set(url, kept);
      }
      kept.refs++;
      evict();
      return kept;
    });
  }
  const unref = (clip) => {
    if (clip && clip.refs > 0) clip.refs--;
    evict();
  };

  // ------------------------------------------------------------------------------------------ the element pool
  function makeSlot() {
    let el = null;
    try {
      el = createAudio();
    } catch {
      el = null;
    }
    if (!el) return null;
    try {
      el.preload = 'auto';
      el.playsInline = true;
    } catch {
      /* ignore */
    }
    const slot = { el, graph: null, item: null, bound: null };
    // route through the shared master / limiter when an AudioContext exists (once per element: a MediaElementSource is for life)
    try {
      const ctx = getContext();
      const dest = getDest();
      if (ctx && dest && typeof ctx.createMediaElementSource === 'function') {
        const src = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
        src.connect(gain);
        if (pan) {
          gain.connect(pan);
          pan.connect(dest);
        } else gain.connect(dest);
        slot.graph = { src, gain, pan };
      }
    } catch {
      slot.graph = null; // the element then plays straight to the speakers with its own volume
    }
    const listen = (name, fn) => {
      try {
        el.addEventListener(name, fn);
      } catch {
        /* ignore */
      }
    };
    listen('ended', () => slot.item && finish(slot.item, { cancelled: false, reason: 'end' }));
    listen('error', () => slot.item && fail(slot.item, 'error'));
    pool.push(slot);
    return slot;
  }

  function acquireSlot() {
    const free = pool.find((s) => !s.item);
    if (free) return free;
    return pool.length < POOL_SIZE ? makeSlot() : null;
  }

  function releaseSlot(slot) {
    if (!slot) return;
    slot.item = null;
    try {
      slot.el.pause?.();
    } catch {
      /* ignore */
    }
    try {
      if (slot.graph) slot.graph.gain.gain.value = 0;
      slot.el.removeAttribute?.('src');
      slot.el.load?.();
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------ item bookkeeping
  const payload = (item, extra) => ({ id: item.id, customer: item.customer, lang: item.lang, mood: item.mood, text: item.text, ...extra });
  const clearTimer = (item) => {
    if (item.timer !== null) timers.clearTimeout(item.timer);
    item.timer = null;
  };

  function dropWaiting(item, reason) {
    counters.dropped++;
    try {
      onDrop?.({ id: item.id, customer: item.customer, reason });
    } catch {
      /* callbacks must not break the queue */
    }
  }

  function playedMs(item) {
    const el = item.slot?.el;
    const cur = el && Number.isFinite(el.currentTime) && el.currentTime > 0 ? el.currentTime * 1000 : now() - item.t0;
    return Math.round(cur / item.rate);
  }

  /** The end of an active item (ended, cut, or never started). Idempotent. */
  function finish(item, { cancelled, reason, failed = false }) {
    if (item.done) return false;
    item.done = true;
    clearTimer(item);
    const i = active.indexOf(item);
    if (i >= 0) active.splice(i, 1);
    const durationMs = item.started ? playedMs(item) : 0;
    if (item.slot) {
      const slot = item.slot;
      item.slot = null;
      releaseSlot(slot);
    }
    unref(item.clip);
    item.clip = null;
    if (item.started) {
      try {
        onEnd?.(payload(item, { estMs: item.estMs, intensity: item.intensity, durationMs, cancelled, reason }));
      } catch {
        /* ignore */
      }
    } else {
      dropWaiting(item, reason);
      if (failed) {
        try {
          item.onFail?.(reason);
        } catch {
          /* ignore */
        }
      }
    }
    pump();
    return true;
  }

  function fail(item, reason) {
    counters.errors++;
    if (reason === 'blocked') {
      counters.blocked++;
      unlocked = false; // iOS refused: wait for the next gesture's unlock()
    }
    return finish(item, { cancelled: true, reason, failed: true });
  }

  function started(item) {
    if (item.done || item.started) return;
    item.started = true;
    item.t0 = now();
    const el = item.slot.el;
    const real = Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : item.entry.ms;
    item.estMs = Math.round(real / item.rate);
    counters.played++;
    // a clip that never reports `ended` (a stalled stream) must not hold its slot for ever
    item.timer = timers.setTimeout(() => {
      item.timer = null;
      finish(item, { cancelled: true, reason: 'timeout' });
    }, item.estMs * 1.5 + 3000);
    try {
      onStart?.(payload(item, { estMs: item.estMs, intensity: item.intensity }));
    } catch {
      /* ignore */
    }
  }

  function begin(item, clip) {
    if (item.done) {
      unref(clip);
      return;
    }
    item.clip = clip;
    if (paused || disposed || !enabled) return void finish(item, { cancelled: true, reason: paused ? 'paused' : 'disabled' });
    if (now() - item.at > item.ttl) return void finish(item, { cancelled: true, reason: 'stale' });
    if (!unlocked) return void fail(item, 'blocked');
    if (!audible()) return void finish(item, { cancelled: true, reason: 'silent' });
    const slot = acquireSlot();
    if (!slot) return void fail(item, 'no-slot');
    slot.item = item;
    item.slot = slot;
    const el = slot.el;
    let p;
    try {
      el.src = clip.src;
      el.currentTime = 0;
      el.playbackRate = item.rate;
      el.defaultPlaybackRate = item.rate;
      el.preservesPitch = true;
      el.webkitPreservesPitch = true;
      el.mozPreservesPitch = true;
      if (!slot.graph) el.muted = false;
      applyLevel(slot);
      if (slot.graph?.pan) slot.graph.pan.pan.value = item.pan;
      p = el.play();
    } catch {
      return void fail(item, 'error');
    }
    if (p && typeof p.then === 'function') {
      p.then(
        () => started(item),
        (err) => {
          const name = err && err.name ? String(err.name) : '';
          fail(item, name === 'NotAllowedError' || /not.?allowed/i.test(String(err?.message || '')) ? 'blocked' : 'error');
        },
      );
    } else started(item);
  }

  function startItem(item) {
    active.push(item);
    loadClip(`${base}${item.entry.f}`).then(
      (clip) => begin(item, clip),
      () => fail(item, 'load'),
    );
  }

  function pickNext() {
    let best = null;
    for (const q of queue) {
      if (q.customer !== null && active.some((a) => a.customer === q.customer)) continue; // one voice per customer at a time
      if (!best || q.priority > best.priority || (q.priority === best.priority && q.at < best.at)) best = q;
    }
    return best;
  }

  function pump() {
    if (disposed || paused || !enabled || !unlocked) return;
    const t = now();
    const fresh = [];
    for (const q of queue) {
      if (t - q.at > q.ttl) dropWaiting(q, 'stale');
      else fresh.push(q);
    }
    queue = fresh;
    while (queue.length && active.length < POOL_SIZE) {
      const next = pickNext();
      if (!next) break;
      queue = queue.filter((q) => q !== next);
      startItem(next);
    }
  }

  // ------------------------------------------------------------------------------------------ public API
  function play(u, o = {}) {
    if (!u || typeof u !== 'object' || disposed || !supported || !enabled || !unlocked || paused) return false;
    const lang = normalizeLang(u.lang);
    const lineId = typeof u.lineId === 'string' ? u.lineId : typeof u.id === 'string' ? u.id : '';
    const entry = lang ? lookup(lineId, lang) : null;
    if (!entry || !audible()) return false;
    const { who, customer } = whoOf(u);
    const mood = String(u.mood || entry.mood || 'neutral').toLowerCase();
    const key = customer ?? lineId;
    const item = {
      id: u.id ?? `line-${autoId++}`,
      lineId,
      text: typeof u.text === 'string' ? u.text.trim() : '',
      lang,
      mood,
      customer,
      persona: who ?? lineId,
      entry,
      priority: Number.isFinite(o.priority) ? o.priority : Number.isFinite(u.priority) ? u.priority : moodPriority(mood),
      ttl: Number.isFinite(o.ttl) && o.ttl > 0 ? o.ttl : Number.isFinite(u.ttlMs) && u.ttlMs > 0 ? u.ttlMs : DEFAULT_TTL_MS,
      at: now(),
      rate: voiceRate(key),
      pan: Number.isFinite(u.pan) ? clamp(u.pan, -1, 1) : voicePan(key),
      whisper: isWhisper(entry.tag, u.tag),
      intensity: speechParams(who ?? lineId, mood).intensity,
      onFail: typeof o.onFail === 'function' ? o.onFail : null,
      started: false,
      done: false,
      slot: null,
      clip: null,
      timer: null,
      t0: 0,
      estMs: entry.ms,
    };
    // a customer's newer line replaces their older one that is still waiting
    if (customer !== null) {
      queue = queue.filter((q) => {
        if (q.customer !== customer) return true;
        dropWaiting(q, 'replaced');
        return false;
      });
      // at most MAX_SPEAKERS different customers in the pipeline (playing + waiting)
      const others = new Set();
      for (const a of active) if (a.customer !== null && a.customer !== customer) others.add(a.customer);
      for (const q of queue) if (q.customer !== null && q.customer !== customer) others.add(q.customer);
      if (others.size >= MAX_SPEAKERS) {
        let weakest = null;
        for (const q of queue) {
          if (q.customer === null) continue;
          if (!weakest || q.priority < weakest.priority || (q.priority === weakest.priority && q.at < weakest.at)) weakest = q;
        }
        if (!weakest || weakest.priority >= item.priority) return false;
        queue = queue.filter((q) => q !== weakest);
        dropWaiting(weakest, 'speakers');
      }
    }
    // the waiting line is at most MAX_QUEUE long: the lowest priority (then the oldest) goes
    if (queue.length >= MAX_QUEUE) {
      let weakest = item;
      for (const q of queue) if (q.priority < weakest.priority || (q.priority === weakest.priority && q.at < weakest.at)) weakest = q;
      if (weakest === item) return false;
      queue = queue.filter((q) => q !== weakest);
      dropWaiting(weakest, 'overflow');
    }
    queue.push(item);
    pump();
    return true;
  }

  function cancel(customerId) {
    const all = customerId === undefined || customerId === null;
    queue = queue.filter((q) => {
      if (!all && q.customer !== customerId) return true;
      dropWaiting(q, 'cancel');
      return false;
    });
    for (const a of [...active]) if (all || a.customer === customerId) finish(a, { cancelled: true, reason: 'cancel' });
  }

  function setPaused(b) {
    const want = !!b;
    if (want === paused) return;
    paused = want;
    if (paused) {
      pausedAt = now();
      for (const a of active) {
        try {
          a.slot?.el.pause?.();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const long = now() - pausedAt > PAUSE_MAX_MS;
    for (const a of [...active]) {
      if (long) finish(a, { cancelled: true, reason: 'stale' });
      else if (a.slot) {
        try {
          const p = a.slot.el.play?.();
          if (p && typeof p.catch === 'function') p.catch(() => finish(a, { cancelled: true, reason: 'blocked' }));
        } catch {
          finish(a, { cancelled: true, reason: 'blocked' });
        }
      } else {
        finish(a, { cancelled: true, reason: 'paused' }); // was still loading when the pause came
      }
    }
    pump();
  }

  function unlock() {
    if (disposed || !supported) return false;
    unlocked = true;
    // iOS: an element may only start sound once it has been played from a gesture: do it for the whole pool with an empty clip
    while (pool.length < POOL_SIZE) if (!makeSlot()) break;
    for (const slot of pool) {
      if (slot.item) continue;
      try {
        slot.el.src = SILENT_WAV;
        const p = slot.el.play();
        const back = () => {
          if (!slot.item) {
            try {
              slot.el.pause?.();
            } catch {
              /* ignore */
            }
          }
        };
        if (p && typeof p.then === 'function') p.then(back, noop);
        else back();
      } catch {
        /* a refusal here only means this element stays locked */
      }
    }
    pump();
    return true;
  }

  async function warm(langIn, lineIds) {
    if (disposed || !supported || !enabled || !fetchFn || isMeteredConnection(nav)) return 0;
    const langs = langIn ? [normalizeLang(langIn)].filter(Boolean) : ['te', 'hi', 'dk'];
    let loaded = 0;
    const perLang = langIn ? WARM_MAX : Math.max(1, Math.floor(WARM_MAX / langs.length));
    for (const lang of langs) {
      if (!(await ensure(lang))) continue;
      const m = manifests.get(lang);
      let ids;
      if (Array.isArray(lineIds)) ids = lineIds.filter((id) => m.lines.has(id));
      else {
        const rank = (e) => (/^greet/.test(e.sit) ? 0 : /^waiting/.test(e.sit) ? 1 : 2);
        ids = [...m.lines.entries()]
          .filter(([, e]) => rank(e) < 2)
          .sort((a, b) => rank(a[1]) - rank(b[1]))
          .map(([id]) => id);
      }
      for (const id of ids.slice(0, perLang)) {
        if (disposed || !enabled || isMeteredConnection(nav)) return loaded;
        try {
          const clip = await loadClip(`${base}${m.lines.get(id).f}`);
          unref(clip);
          loaded++;
        } catch {
          /* a clip that cannot be fetched is fetched again when a line needs it */
        }
      }
    }
    return loaded;
  }

  return {
    has,
    hasLang: (lang) => availability(lang) === true,
    availability,
    entry: (lineId, lang) => lookup(lineId, lang),
    ensure,
    play,
    warm,
    cancel,
    setPaused,
    unlock,
    isUnlocked: () => unlocked,
    isSupported: () => supported,
    isPlaying: () => active.some((a) => a.started),
    setEnabled(b) {
      enabled = !!b;
      if (!enabled) cancel();
      else pump();
    },
    setVolume(v) {
      localVolume = clamp01(v);
      if (localVolume <= 0.001) cancel();
      else this.updateVolume();
    },
    /** The hub's volume / sound switch changed: re-level the clips in the air (and cut them when the sound went off). */
    updateVolume() {
      if (!audible()) return cancel();
      for (const slot of pool) applyLevel(slot);
      return undefined;
    },
    stats: () => ({
      ...counters,
      playing: active.filter((a) => a.started).map((a) => a.id),
      loading: active.filter((a) => !a.started).map((a) => a.id),
      queued: queue.map((q) => q.id),
      cached: clips.size,
      manifests: Object.fromEntries([...manifests].map(([l, m]) => [l, m.status === 'ready' ? m.count : m.status])),
    }),
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      for (const slot of pool.splice(0)) {
        try {
          slot.el.pause?.();
          slot.graph?.src.disconnect();
          slot.graph?.gain.disconnect();
          slot.graph?.pan?.disconnect();
        } catch {
          /* ignore */
        }
      }
      for (const c of clips.values()) {
        if (c.blob) {
          try {
            urlApi.revokeObjectURL(c.src);
          } catch {
            /* ignore */
          }
        }
      }
      clips.clear();
    },
  };
}

export default createRecordedVoices;
