// Tiffin Centre crowd: a synthesised "murmur of customers" and short per-mood vocalisations, all Web Audio (no files). They make the
// counter sound inhabited even on a device that has no speech voice for Telugu / Hindi.
//
//   crowdHandle(events, state) -> { murmur: { level, agitation, lanes:[{ pan, level }] }, vocals:[{ name, opts, priority, gain, key }] }   PURE
//   const crowd = createCrowd({ ctx, dest, vocalDest?, now, timers, rng });   dest = the murmur's bus (the ambience bus), vocalDest = the sfx bus
//   crowd.update(state)              the murmur follows the customers who are waiting (how many, where, how impatient)
//   crowd.handle(events, state)      update + the vocalisations of these events ('tsk', 'hmph', 'mmm', laugh); returns how many started
//   crowd.vocal(name, opts)          one vocalisation by hand
//   crowd.start() / stop() / dispose()
//
// The murmur is three "voices": looped noise through two formant band-pass filters (a vowel that drifts every half second) whose
// amplitude is modulated at syllable rate (about 4 Hz) and by a slow phrase LFO, each panned where a waiting customer stands. Its level
// follows the number of customers waiting; impatience makes the syllables quicker.

import { createSynth, noiseBuffer } from '@/lib/soundscape/synth.js';
import { LAYOUT } from '@shared/tiffin-centre/catalog.js';
import { createVoiceLimiter, panOfX } from './mapping.js';
import { basePersona } from './speechVoices.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0, 0, 1);

export const LANES = 3;
export const DRIFT_MS = 450; // how often the murmur's vowels change
const MURMUR_TOP = 0.5; // loudest murmur (it sits on the ambience bus)
const LEVEL_TAU = 0.6; // seconds: how fast the murmur follows the number of customers
const LANE_FLOOR = 0.02;

/** First and second formant (Hz) of five vowels: the murmur wanders between them like syllables of speech. */
export const VOWELS = Object.freeze([
  [730, 1090], // a
  [530, 1840], // e
  [270, 2290], // i
  [570, 840], // o
  [300, 870], // u
]);

// ------------------------------------------------------------------------------------------------ the vocalisations

const PRIORITY = { hmph: 4, tsk: 3, laugh: 3, mmm: 2 };
const COOLDOWN_MS = { hmph: 500, tsk: 300, laugh: 800, mmm: 350 };
export const VOCAL_NAMES = Object.freeze(Object.keys(PRIORITY));

/** Each recipe: (synth, t, { v, pan, pitch }) -> schedules its sources. `pitch` (~0.8..1.25) is the customer's own voice height. */
export const VOCALS = {
  /** Impatient "tsk": two quick tongue clicks. */
  tsk(s, t, { v = 0.2, pan = 0, pitch = 1 } = {}) {
    s.noise({ t, d: 0.03, v, type: 'bandpass', f: 3400 * pitch, f2: 2000 * pitch, q: 5, a: 0.002, pan });
    s.noise({ t: t + 0.12, d: 0.03, v: v * 0.8, type: 'bandpass', f: 3000 * pitch, f2: 1800 * pitch, q: 5, a: 0.002, pan });
  },
  /** Angry "hmph": a nasal grunt with a breath of air through the nose. */
  hmph(s, t, { v = 0.25, pan = 0, pitch = 1 } = {}) {
    s.tone({ f: 150 * pitch, f2: 105 * pitch, type: 'sawtooth', t, a: 0.02, d: 0.22, v: v * 0.7, filter: { type: 'lowpass', f: 420, f2: 260, q: 4 }, pan });
    s.noise({ t: t + 0.02, d: 0.2, v: v * 0.5, type: 'bandpass', f: 800, f2: 350, q: 1.2, a: 0.03, pan });
  },
  /** Happy "mmm": a closed-mouth hum that rises a little, with a touch of vibrato. */
  mmm(s, t, { v = 0.2, pan = 0, pitch = 1 } = {}) {
    s.tone({ f: 135 * pitch, f2: 160 * pitch, type: 'sawtooth', t, a: 0.06, hold: 0.12, d: 0.34, v, filter: { type: 'lowpass', f: 330, q: 3 }, vib: { rate: 5.5, depth: 18, delay: 0.1 }, pan });
  },
  /** A short laugh: four falling "ha" syllables, each a voiced burst plus a puff of breath. */
  laugh(s, t, { v = 0.22, pan = 0, pitch = 1 } = {}) {
    for (let i = 0; i < 4; i++) {
      const ti = t + i * 0.13;
      const fade = 1 - i * 0.18;
      const f = 230 * pitch * 0.94 ** i;
      s.tone({ f, f2: f * 0.9, type: 'sawtooth', t: ti, a: 0.012, d: 0.08, v: v * fade, filter: { type: 'bandpass', f: 900, q: 2 }, pan });
      s.noise({ t: ti, d: 0.07, v: v * 0.5 * fade, type: 'bandpass', f: 1500, q: 1, a: 0.01, pan });
    }
  },
};

// ------------------------------------------------------------------------------------------------ pure planning

const customersOf = (state) => (Array.isArray(state?.customers) ? state.customers : []);
const spotX = (c) => (Number.isFinite(c?.spot) ? LAYOUT.spotX(c.spot) : 0);

/** 0..1 how hurried a waiting customer is (the patience that is gone). */
function agitationOf(c) {
  const max = Number(c?.patienceMax);
  const left = Number(c?.patience);
  return max > 0 && Number.isFinite(left) ? clamp01(1 - left / max) : 0;
}

/** The murmur target for a state: level 0..1 (follows how many customers wait), agitation 0..1, and up to LANES voices placed at customers. */
export function murmurPlan(state) {
  const waiting = customersOf(state)
    .filter((c) => c && c.st === 'waiting')
    .sort((a, b) => spotX(a) - spotX(b));
  const n = waiting.length;
  if (!n) return { level: 0, agitation: 0, lanes: [] };
  const agitation = waiting.reduce((a, c) => a + agitationOf(c), 0) / n;
  const level = clamp01((0.25 + 0.15 * (n - 1)) * (1 + 0.3 * agitation));
  const picks = n <= LANES ? waiting : [waiting[0], waiting[Math.floor((n - 1) / 2)], waiting[n - 1]];
  const lanes = picks.map((c) => ({ pan: panOfX(spotX(c)), level: 0.6 + 0.4 * agitationOf(c), pitch: basePersona(c.id).pitch }));
  return { level, agitation, lanes };
}

function spotOfEvent(ev, state) {
  if (Number.isFinite(ev?.spot)) return ev.spot;
  const c = customersOf(state).find((x) => x && x.id === ev?.customer);
  return Number.isFinite(c?.spot) ? c.spot : null;
}

function vocalFor(name, ev, state, gain = 1) {
  const spot = spotOfEvent(ev, state);
  const pan = spot === null ? 0 : panOfX(LAYOUT.spotX(spot));
  const pitch = ev?.customer != null ? basePersona(ev.customer).pitch : 1;
  return { name, opts: { pan, pitch }, priority: PRIORITY[name], gain, key: `${name}:${ev?.customer ?? 'all'}` };
}

/**
 * The crowd's reaction to one state change (pure): `murmur` is the plan for the waiting customers, `vocals` the little sounds the engine's
 * events cause. tsk = a customer is about to lose patience / walks off, hmph = angry or unpaid, mmm = pleased, laugh = a big happy moment.
 */
export function crowdHandle(events, state = null) {
  const vocals = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev.type !== 'string') continue;
    switch (ev.type) {
      case 'pay-warning':
      case 'customer-turned-away':
        vocals.push(vocalFor('tsk', ev, state));
        break;
      case 'customer-angry':
      case 'customer-unpaid':
        vocals.push(vocalFor('hmph', ev, state));
        break;
      case 'collect':
        vocals.push(vocalFor(Number(ev.amount) >= 160 || Number(ev.combo) >= 4 ? 'laugh' : 'mmm', ev, state));
        break;
      case 'eating':
        vocals.push(vocalFor('mmm', ev, state, 0.6));
        break;
      case 'shift-end':
        if (ev.status === 'done' && Number(ev.stars) >= 2) vocals.push(vocalFor('laugh', { ...ev, customer: null, spot: null }, state, 0.8));
        break;
      default:
        break;
    }
  }
  return { murmur: murmurPlan(state), vocals };
}

// ------------------------------------------------------------------------------------------------ Web Audio

export function createCrowd({ ctx, dest, vocalDest = dest, now = () => Date.now(), timers = globalThis, rng = Math.random, maxVocals = 3 } = {}) {
  const limiter = createVoiceLimiter({ maxVoices: maxVocals, cooldowns: COOLDOWN_MS });
  const lanes = []; // built lazily: { gain, pan, lfo, lfoGain, f1, f2, srcs, nodes, vowel }
  let master = null;
  let running = false;
  let disposed = false;
  let timer = null;
  let plan = { level: 0, agitation: 0, lanes: [] };
  let vocalsPlayed = 0;

  function ensureLanes() {
    if (lanes.length || !ctx) return;
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(dest);
    for (let i = 0; i < LANES; i++) {
      const nodes = [];
      const srcs = [];
      const out = ctx.createGain();
      out.gain.value = 0;
      const amp = ctx.createGain(); // syllable amplitude: base + LFO swing
      amp.gain.value = 0.55; // 0.55 - 0.3 (syllables) - 0.2 (phrases) never goes below 0.05
      const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx);
      noise.loop = true;
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      f1.type = f2.type = 'bandpass';
      f1.Q.value = 5;
      f2.Q.value = 7;
      g1.gain.value = 2.2; // a narrow band-pass of noise is faint: make up the level
      g2.gain.value = 1.3;
      noise.connect(f1);
      noise.connect(f2);
      f1.connect(g1);
      f2.connect(g2);
      g1.connect(amp);
      g2.connect(amp);
      const lfo = ctx.createOscillator(); // syllables
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 3.6 + i * 0.7;
      lfoGain.gain.value = 0.3;
      lfo.connect(lfoGain);
      lfoGain.connect(amp.gain);
      const phrase = ctx.createOscillator(); // phrases: now talking, now a breath
      const phraseGain = ctx.createGain();
      phrase.type = 'sine';
      phrase.frequency.value = 0.31 + i * 0.13;
      phraseGain.gain.value = 0.2;
      phrase.connect(phraseGain);
      phraseGain.connect(amp.gain);
      if (pan) {
        amp.connect(pan);
        pan.connect(out);
      } else {
        amp.connect(out);
      }
      out.connect(master);
      nodes.push(out, amp, noise, f1, f2, g1, g2, lfo, lfoGain, phrase, phraseGain);
      if (pan) nodes.push(pan);
      srcs.push(noise, lfo, phrase);
      const t0 = ctx.currentTime;
      noise.start(t0, rng() * 0.8);
      lfo.start(t0);
      phrase.start(t0);
      const lane = { out, pan, lfo, f1, f2, srcs, nodes, vowel: Math.floor(rng() * VOWELS.length), pitch: 1 };
      setVowel(lane, 0.05);
      lanes.push(lane);
    }
  }

  function setVowel(lane, tau) {
    const [a, b] = VOWELS[lane.vowel % VOWELS.length];
    const t = ctx.currentTime;
    try {
      lane.f1.frequency.setTargetAtTime(a * lane.pitch, t, tau);
      lane.f2.frequency.setTargetAtTime(b * lane.pitch, t, tau);
    } catch {
      lane.f1.frequency.value = a * lane.pitch;
      lane.f2.frequency.value = b * lane.pitch;
    }
  }

  function drift() {
    if (!running || disposed || ctx.state === 'suspended') return;
    for (const lane of lanes) {
      lane.vowel = (lane.vowel + 1 + Math.floor(rng() * (VOWELS.length - 1))) % VOWELS.length; // never the same vowel twice
      setVowel(lane, 0.08);
    }
  }

  function apply() {
    if (!ctx) return;
    const want = running && plan.level > 0;
    if (want) ensureLanes();
    if (!master) return;
    const t = ctx.currentTime;
    const set = (param, v, tau) => {
      try {
        param.setTargetAtTime(v, t, tau);
      } catch {
        param.value = v;
      }
    };
    set(master.gain, want ? plan.level * MURMUR_TOP : 0, LEVEL_TAU);
    lanes.forEach((lane, i) => {
      const p = plan.lanes[i];
      set(lane.out.gain, want && p && p.level >= LANE_FLOOR ? p.level : 0, LEVEL_TAU);
      if (p) {
        if (lane.pan) set(lane.pan.pan, p.pan, 0.3);
        lane.pitch = 0.85 + (p.pitch - 0.8) * 0.8; // a customer's own voice height colours their lane
        lane.lfo.frequency.value = 3.2 + i * 0.7 + plan.agitation * 2; // impatient people talk quicker
      }
    });
  }

  function vocal(name, opts = {}) {
    const recipe = VOCALS[name];
    if (!recipe || !ctx || disposed || !vocalDest) return false;
    const r = limiter.request(name, PRIORITY[name], now(), opts.key || name);
    if (!r.ok) return false;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    g.connect(vocalDest);
    const voice = { sources: 0, loud: 0, end: 0, srcs: [], onIdle: () => {
      limiter.end(r.id);
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    } };
    try {
      recipe(createSynth(ctx, g, voice), ctx.currentTime + 0.005, { v: opts.v, pan: opts.pan, pitch: opts.pitch });
    } catch {
      /* a broken recipe must not break the game */
    }
    if (voice.sources === 0) {
      voice.onIdle();
      return false;
    }
    vocalsPlayed++;
    return true;
  }

  return {
    start() {
      if (disposed || running) return;
      running = true;
      timer = timers.setInterval(drift, DRIFT_MS);
      apply();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      apply();
    },
    update(state) {
      if (disposed) return;
      plan = murmurPlan(state);
      apply();
    },
    handle(events, state = null) {
      if (disposed) return 0;
      const out = crowdHandle(events, state);
      if (state) {
        plan = out.murmur;
        apply();
      }
      let n = 0;
      for (const item of out.vocals) if (vocal(item.name, { ...item.opts, gain: item.gain, key: item.key })) n++;
      return n;
    },
    vocal,
    isRunning: () => running,
    plan: () => plan,
    stats: () => ({ lanes: lanes.length, vocals: vocalsPlayed }),
    dispose() {
      if (disposed) return;
      this.stop();
      disposed = true;
      for (const lane of lanes) {
        for (const s of lane.srcs) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        for (const n of lane.nodes) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
      try {
        master?.disconnect();
      } catch {
        /* ignore */
      }
      lanes.length = 0;
    },
  };
}

export default createCrowd;
