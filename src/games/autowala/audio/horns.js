// OWNER: customisation agent. Web Audio horn synthesis for every id in catalog.js HORNS (no sample files). The note tables live in
// horn-data.js (pure data, unit-tested); this file turns them into sound. Safe to call repeatedly: polyphony is capped, a short
// cooldown swallows double triggers, every note ramps in and out (no clicks) and the horn bus is soft-clipped.
import { getAudio } from './ctx.js';
import { getBuses } from './sound-bus.js';
import { getHornDef, hornDuration, noteHz, noteToHz } from './horn-data.js';

export { HORN_DEFS, getHornDef, hornDuration, resolveHornId } from './horn-data.js';

export const MAX_POLYPHONY = 4;
export const COOLDOWN_MS = 60;

const active = []; // { out, nodes, end (audio time), timer }
let lastAt = -1e9;
let noiseCache = null; // { ac, buf }
let curveCache = null;

const clampN = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

function noiseBuffer(ac) {
  if (noiseCache && noiseCache.ac === ac) return noiseCache.buf;
  const len = Math.floor(ac.sampleRate * 1.2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345; // a fixed little LCG so every horn has the same texture
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  noiseCache = { ac, buf };
  return buf;
}

/** tanh soft clip: nothing the horn bus carries can exceed 1. */
function softClipCurve() {
  if (curveCache) return curveCache;
  const n = 512;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  curveCache = c;
  return c;
}

const stopAt = (node, t) => {
  try {
    node.stop(t);
  } catch {
    /* already stopped */
  }
};

/** Schedule a note envelope on a gain param: 0 -> g over `a`, hold until `d`, ramp to 0 over `r`. Never a click. */
function envelope(param, t0, g, a, d, r) {
  const att = Math.max(0.004, a);
  const hold = Math.max(t0 + att, t0 + d);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(g, t0 + att);
  param.setValueAtTime(g, hold);
  param.linearRampToValueAtTime(0, hold + Math.max(0.012, r));
  return hold + Math.max(0.012, r);
}

/** An exponential-decay envelope (struck / plucked sounds). */
function decayEnv(param, t0, g, decay, attack = 0.003) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(g, t0 + attack);
  param.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, decay));
  param.linearRampToValueAtTime(0, t0 + Math.max(0.05, decay) + 0.01);
  return t0 + Math.max(0.05, decay) + 0.02;
}

function scheduleTone(ac, dest, layer, n, t0, pitch, nodes) {
  const f0 = noteHz(n) * pitch;
  const f1 = noteToHz(n) != null ? noteToHz(n) * pitch : null;
  const dur = n.d ?? 0.1;
  const g = (n.g ?? 0.5) * (layer.gain ?? 1);
  const noteGain = ac.createGain();
  const end = envelope(noteGain.gain, t0, g, n.a ?? 0.01, dur, n.r ?? 0.06);

  // chain: [oscillators] -> (am) -> (band-pass) -> (low-pass) -> noteGain -> dest
  let head = noteGain;
  if (layer.lp) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = layer.lp.q ?? 0.7;
    if (layer.lp.from) {
      lp.frequency.setValueAtTime(layer.lp.from, t0);
      lp.frequency.setTargetAtTime(layer.lp.f, t0, layer.lp.tc ?? 0.05);
    } else lp.frequency.value = layer.lp.f;
    lp.connect(noteGain);
    nodes.push(lp);
    head = lp;
  }
  if (layer.bp) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = layer.bp.f;
    bp.Q.value = layer.bp.q ?? 1;
    bp.connect(head);
    nodes.push(bp);
    head = bp;
  }
  let amGain = null;
  if (layer.am) {
    amGain = ac.createGain();
    amGain.gain.value = 1 - layer.am.depth / 2;
    amGain.connect(head);
    const lfo = ac.createOscillator();
    lfo.frequency.value = layer.am.rate;
    const lg = ac.createGain();
    lg.gain.value = layer.am.depth / 2;
    lfo.connect(lg);
    lg.connect(amGain.gain);
    lfo.start(t0);
    stopAt(lfo, end + 0.05);
    nodes.push(lfo, lg, amGain);
    head = amGain;
  }
  noteGain.connect(dest);
  nodes.push(noteGain);

  const detunes = layer.detune ? [-layer.detune, layer.detune] : [0];
  const share = 1 / detunes.length;
  for (const dt of detunes) {
    const o = ac.createOscillator();
    o.type = layer.wave || 'sine';
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + Math.max(0.03, dur));
    o.detune.value = dt;
    const og = ac.createGain();
    og.gain.value = share;
    o.connect(og);
    og.connect(head);
    if (layer.vib) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = layer.vib.rate;
      const lg = ac.createGain();
      lg.gain.setValueAtTime(0, t0);
      lg.gain.setValueAtTime(0, t0 + (layer.vib.delay ?? 0));
      lg.gain.linearRampToValueAtTime(layer.vib.cents, t0 + (layer.vib.delay ?? 0) + 0.12);
      lfo.connect(lg);
      lg.connect(o.detune);
      lfo.start(t0);
      stopAt(lfo, end + 0.05);
      nodes.push(lfo, lg);
    }
    o.start(t0);
    stopAt(o, end + 0.05);
    nodes.push(o, og);
  }
}

function scheduleBell(ac, dest, layer, n, t0, pitch, nodes) {
  for (const [ratio, pg] of layer.partials) {
    const f = n.f * ratio * pitch;
    if (f > 16000) continue;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ac.createGain();
    decayEnv(g.gain, t0, (n.g ?? 0.5) * pg, n.decay / Math.sqrt(ratio), 0.002);
    o.connect(g);
    g.connect(dest);
    o.start(t0);
    stopAt(o, t0 + n.decay + 0.06);
    nodes.push(o, g);
  }
}

function schedulePluck(ac, dest, n, t0, pitch, nodes) {
  const f0 = noteHz(n) * pitch;
  const f1 = noteToHz(n) != null ? noteToHz(n) * pitch : null;
  const bright = n.bright ?? 1;
  const g = ac.createGain();
  decayEnv(g.gain, t0, n.g ?? 0.6, n.decay, 0.003);
  const bp = ac.createBiquadFilter(); // the "twang": a resonant band that falls as the string settles
  bp.type = 'bandpass';
  bp.Q.value = 3.5;
  bp.frequency.setValueAtTime(Math.min(5200, f0 * 8 * bright), t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(300, f0 * 1.6), t0 + n.decay * 0.7);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6500;
  bp.connect(lp);
  lp.connect(g);
  g.connect(dest);
  const mk = (type, mult, detune, gain) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * mult, t0);
    if (f1) {
      o.frequency.setValueAtTime(f0 * mult, t0 + 0.05);
      o.frequency.exponentialRampToValueAtTime(f1 * mult, t0 + 0.28);
    }
    o.detune.value = detune;
    const og = ac.createGain();
    og.gain.value = gain;
    o.connect(og);
    og.connect(bp);
    o.start(t0);
    stopAt(o, t0 + n.decay + 0.06);
    nodes.push(o, og);
  };
  mk('sawtooth', 1, 0, 0.75);
  mk('sawtooth', 2, 7, 0.25); // the sympathetic octave
  nodes.push(bp, lp, g);
}

function scheduleThump(ac, dest, n, t0, pitch, nodes) {
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(n.f * pitch, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(25, n.to * pitch), t0 + n.decay * 0.55);
  const g = ac.createGain();
  decayEnv(g.gain, t0, n.g ?? 0.7, n.decay, 0.002);
  o.connect(g);
  g.connect(dest);
  o.start(t0);
  stopAt(o, t0 + n.decay + 0.06);
  nodes.push(o, g);
}

function scheduleNoise(ac, dest, layer, n, t0, nodes) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = n.f ?? layer.bp?.f ?? 2000;
  bp.Q.value = layer.bp?.q ?? 1;
  const g = ac.createGain();
  const end = envelope(g.gain, t0, n.g ?? 0.2, n.a ?? 0.005, n.d ?? 0.05, n.r ?? 0.05);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t0, (t0 * 7.13) % 0.8);
  stopAt(src, end + 0.05);
  nodes.push(src, bp, g);
}

/** Build all the nodes of one horn into `dest`; returns { nodes, end } (end = audio time the last sound stops). */
function schedule(ac, dest, def, t0, pitch) {
  const nodes = [];
  for (const layer of def.layers) {
    for (const n of layer.notes) {
      const t = t0 + n.t;
      switch (layer.kind) {
        case 'tone': scheduleTone(ac, dest, layer, n, t, pitch, nodes); break;
        case 'bell': scheduleBell(ac, dest, layer, n, t, pitch, nodes); break;
        case 'pluck': schedulePluck(ac, dest, n, t, pitch, nodes); break;
        case 'thump': scheduleThump(ac, dest, n, t, pitch, nodes); break;
        case 'noise': scheduleNoise(ac, dest, layer, n, t, nodes); break;
        default: break;
      }
    }
  }
  return { nodes, end: t0 + hornDuration(def) + 0.1 };
}

function release(entry, ac, fade = 0.04) {
  clearTimeout(entry.timer);
  try {
    const now = ac.currentTime;
    entry.out.gain.cancelScheduledValues(now);
    entry.out.gain.setValueAtTime(entry.out.gain.value, now);
    entry.out.gain.linearRampToValueAtTime(0, now + fade);
    for (const n of entry.nodes) if (typeof n.stop === 'function') stopAt(n, now + fade + 0.02);
  } catch {
    /* the context may be closed */
  }
  entry.timer = setTimeout(() => {
    try {
      entry.out.disconnect();
    } catch {
      /* gone already */
    }
  }, (fade + 0.15) * 1000);
}

/**
 * Play horn `id` (any catalogue horn id; unknown ids play the stock horn). Returns true when something was started.
 * `volume` 0..2 (1 = normal), `pitch` 0.5..2 (playback-rate style), `pan` -1..1.
 */
export function playHorn(id, { volume = 1, pitch = 1, pan = 0 } = {}) {
  try {
    const a = getAudio();
    if (!a) return false;
    const { ac } = a;
    const master = getBuses()?.fx ?? a.master; // the effects slider, else straight to master
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - lastAt < COOLDOWN_MS) return false;
    lastAt = nowMs;
    if (ac.state === 'suspended') ac.resume?.().catch?.(() => {});

    const def = getHornDef(id);
    // forget horns that have finished, then make room (the oldest is faded out, never cut)
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end < ac.currentTime) active.splice(i, 1);
    while (active.length >= MAX_POLYPHONY) release(active.shift(), ac, 0.05);

    const vol = clampN(volume, 0, 2, 1);
    if (vol <= 0) return false;
    const out = ac.createGain();
    out.gain.value = vol * def.gain;
    const clip = ac.createWaveShaper();
    clip.curve = softClipCurve();
    out.connect(clip);
    let tail = clip;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = clampN(pan, -1, 1, 0);
      clip.connect(p);
      tail = p;
    }
    tail.connect(master);

    const t0 = ac.currentTime + 0.012;
    const { nodes, end } = schedule(ac, out, def, t0, clampN(pitch, 0.5, 2, 1));
    nodes.push(clip);
    const entry = { out, nodes, end, timer: 0 };
    entry.timer = setTimeout(() => {
      try {
        tail.disconnect();
        out.disconnect();
      } catch {
        /* gone already */
      }
      const i = active.indexOf(entry);
      if (i >= 0) active.splice(i, 1);
    }, Math.max(100, (end - ac.currentTime + 0.3) * 1000));
    active.push(entry);
    return true;
  } catch {
    return false; // audio is a nicety: never take the game down
  }
}

/** Cut every horn that is sounding (a short fade, no click). */
export function stopHorn() {
  const a = getAudio();
  if (!a) {
    active.length = 0;
    return;
  }
  for (const e of active.splice(0)) release(e, a.ac, 0.03);
}

/** How many horns are sounding right now (debug / tests). */
export const activeHornCount = () => active.length;
