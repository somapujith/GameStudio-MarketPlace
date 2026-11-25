// Tiffin Centre audio: the AMBIENCE engine. Continuous beds (traffic, crowd, heat hum, cicadas, crickets, radio hum) are looping
// noise / oscillators whose gains glide with the hour; sporadic one-shots (birds, a temple bell, a pressure cooker, auto horns,
// dogs) and a very quiet generated tabla loop are scheduled from a timer. Layers are built lazily (only the ones the current
// hour needs exist) and everything is injected (context, clock, timers, rng) so it runs under a fake context in node.
//
//   const amb = createAmbience({ ctx, dest, now, timers, rng });
//   amb.start(); amb.setLevels(layerLevels(hour, busy)); amb.stop(); amb.dispose();

import { createSynth, noiseBuffer } from '@/lib/soundscape/synth.js';
import { AMBIENT_RECIPES, tabla } from './recipes.js';
import { CONTINUOUS_LAYERS, SPORADIC, SPORADIC_LAYERS, LAYER_FLOOR, nextDelayMs } from './mix.js';
import { TABLA_PATTERN, tablaStepSeconds } from './score.js';

/** How a continuous layer is built: noise and/or oscillators, optional filters, amplitude modulators (LFOs), and its top gain. */
export const LAYER_SPECS = {
  traffic: { noise: true, filters: [{ type: 'lowpass', f: 260, q: 0.7 }], mods: [{ type: 'sine', rate: 0.13, depth: 0.3 }], gain: 0.55 },
  crowd: { noise: true, filters: [{ type: 'bandpass', f: 700, q: 0.6 }], mods: [{ type: 'sine', rate: 0.35, depth: 0.3 }, { type: 'sine', rate: 1.7, depth: 0.12 }], gain: 0.34 },
  heat: { oscs: [{ type: 'sine', f: 118, g: 1 }, { type: 'sine', f: 177, g: 0.4 }], mods: [{ type: 'sine', rate: 0.1, depth: 0.3 }], gain: 0.1 },
  cicadas: { oscs: [{ type: 'sine', f: 4100, g: 1 }, { type: 'sine', f: 4330, g: 0.8 }], mods: [{ type: 'sawtooth', rate: 38, depth: 0.4 }, { type: 'sine', rate: 0.17, depth: 0.4 }], gain: 0.05 },
  crickets: { oscs: [{ type: 'sine', f: 4650, g: 1 }], mods: [{ type: 'square', rate: 12, depth: 0.5 }, { type: 'sine', rate: 1.3, depth: 0.5 }], gain: 0.06 },
  radio: { oscs: [{ type: 'sine', f: 100, g: 1 }, { type: 'sine', f: 200, g: 0.35 }, { type: 'sine', f: 301, g: 0.15 }], mods: [{ type: 'sine', rate: 2.2, depth: 0.1 }], gain: 0.07 },
};

export const TICK_MS = 200; // scheduler interval
const LOOKAHEAD_S = 0.35; // tabla steps are scheduled this far ahead
const TABLA_V = 0.05; // the tabla loop's loudest stroke: very quiet on purpose
const MIN_ONESHOT_GAP_MS = 900; // two ambience one-shots never start closer than this (keeps the node count and CPU low)
const FADE_TAU = 1.2; // seconds: how fast layer gains follow the hour (a crossfade)

export function buildLayer(c, dest, spec) {
  const nodes = [];
  const sources = [];
  const out = c.createGain(); // the layer's level
  out.gain.value = 0;
  out.connect(dest);
  nodes.push(out);
  const head = c.createGain(); // the sum of the layer's sources
  head.gain.value = 1;
  nodes.push(head);
  if (spec.noise) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    src.connect(head);
    sources.push(src);
  }
  for (const o of spec.oscs || []) {
    const osc = c.createOscillator();
    osc.type = o.type;
    osc.frequency.value = o.f;
    const g = c.createGain();
    g.gain.value = o.g;
    osc.connect(g);
    g.connect(head);
    sources.push(osc);
    nodes.push(g);
  }
  let node = head;
  for (const f of spec.filters || []) {
    const bq = c.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.value = f.f;
    bq.Q.value = f.q ?? 1;
    node.connect(bq);
    node = bq;
    nodes.push(bq);
  }
  for (const m of spec.mods || []) {
    const mg = c.createGain();
    mg.gain.value = 1 - m.depth;
    const lfo = c.createOscillator();
    lfo.type = m.type;
    lfo.frequency.value = m.rate;
    const lg = c.createGain();
    lg.gain.value = m.depth;
    lfo.connect(lg);
    lg.connect(mg.gain);
    node.connect(mg);
    node = mg;
    sources.push(lfo);
    nodes.push(mg, lg);
  }
  node.connect(out);
  const t0 = c.currentTime;
  sources.forEach((s) => s.start(t0));
  return { out, nodes, sources, top: spec.gain };
}

export function createAmbience({ ctx, dest, now = () => Date.now(), timers = globalThis, rng = Math.random } = {}) {
  const layers = new Map(); // id -> built layer
  const levels = {}; // target level per layer, 0..1
  const nextAt = {}; // sporadic id -> ms
  let timer = null;
  let running = false;
  let disposed = false;
  let tablaAt = null; // ctx time of the next tabla step
  let tablaStep = 0;
  let sporadicCount = 0;
  let lastOneShot = -Infinity;

  function applyLevel(id, tau) {
    const L = layers.get(id);
    if (!L) return;
    const target = running ? Math.min(1, Math.max(0, levels[id] || 0)) * L.top : 0;
    try {
      L.out.gain.setTargetAtTime(target, ctx.currentTime, tau);
    } catch {
      L.out.gain.value = target;
    }
  }

  function syncLayers(tau = FADE_TAU) {
    for (const id of CONTINUOUS_LAYERS) {
      const want = running && (levels[id] || 0) >= LAYER_FLOOR;
      if (want && !layers.has(id)) layers.set(id, buildLayer(ctx, dest, LAYER_SPECS[id]));
      applyLevel(id, tau);
    }
  }

  function playSporadic(id, level) {
    const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
    const s = createSynth(ctx, dest, voice);
    const pan = (rng() * 2 - 1) * 0.7;
    try {
      AMBIENT_RECIPES[id](s, ctx.currentTime + 0.02, { v: level, pan, pitch: rng() });
      sporadicCount++;
    } catch {
      /* ambience is optional */
    }
  }

  function tick() {
    if (!running || disposed || ctx.state !== 'running') return;
    const t = now();
    for (const id of SPORADIC_LAYERS) {
      const level = levels[id] || 0;
      if (level < LAYER_FLOOR) {
        nextAt[id] = undefined;
        continue;
      }
      if (nextAt[id] === undefined) nextAt[id] = t + nextDelayMs(SPORADIC[id], level, rng()) * 0.5; // first one comes sooner
      if (t >= nextAt[id] && t - lastOneShot < MIN_ONESHOT_GAP_MS) nextAt[id] = t + MIN_ONESHOT_GAP_MS; // wait for a quiet moment
      else if (t >= nextAt[id]) {
        lastOneShot = t;
        playSporadic(id, level);
        nextAt[id] = t + nextDelayMs(SPORADIC[id], level, rng());
      }
    }
    // the tabla loop, scheduled slightly ahead on the audio clock
    const tl = levels.tabla || 0;
    if (tl >= LAYER_FLOOR) {
      const step = tablaStepSeconds();
      if (tablaAt === null || tablaAt < ctx.currentTime) tablaAt = ctx.currentTime + 0.05;
      const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
      const s = createSynth(ctx, dest, voice);
      while (tablaAt < ctx.currentTime + LOOKAHEAD_S) {
        const kind = TABLA_PATTERN[tablaStep % TABLA_PATTERN.length];
        if (kind) tabla(s, tablaAt, kind, TABLA_V * tl, -0.2);
        tablaStep++;
        tablaAt += step;
      }
    } else {
      tablaAt = null;
    }
  }

  return {
    start() {
      if (disposed || running) return;
      running = true;
      syncLayers();
      timer = timers.setInterval(tick, TICK_MS);
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      for (const id of layers.keys()) applyLevel(id, 0.25);
      tablaAt = null;
    },
    /** `lv` is the output of mix.layerLevels(hour, busy). Safe before start(): it is remembered and applied on start. */
    setLevels(lv) {
      if (disposed) return;
      for (const id of [...CONTINUOUS_LAYERS, ...SPORADIC_LAYERS, 'tabla']) levels[id] = lv?.[id] ?? 0;
      if (running) syncLayers();
    },
    tick,
    isRunning: () => running,
    layerIds: () => [...layers.keys()],
    stats: () => ({ layers: layers.size, sporadic: sporadicCount }),
    dispose() {
      if (disposed) return;
      this.stop();
      disposed = true;
      for (const L of layers.values()) {
        for (const s of L.sources) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        for (const n of [...L.sources, ...L.nodes]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
      layers.clear();
    },
  };
}
