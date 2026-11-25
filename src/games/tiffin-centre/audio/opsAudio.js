// Tiffin Centre audio: the OPERATIONS layer's looping sounds and the random one-shots that go with them (plan section 3b).
// The event-driven one-shots (thunk, whistle, ladle, hiss ...) are plain RECIPES played by index.js; THIS module owns what has a
// duration: it derives which loops should run from the game state (state.events, the prep counter's jobs, the cylinder) and fades them
// in and out.
//
//   rain      tin-roof patter + rain on the street, random drips and distant thunder        (state.events has 'rain')
//   cricket   a distant TV commentary murmur, now and then a stadium roar, rarely firecrackers   ('cricket')
//   festival  a quiet generic street drum loop (dhol / tasa), a few bells                   ('festival')
//   delivery  a bike idling at the kerb and an occasional horn                              ('delivery')
//   generator the generator / inverter hum, a few seconds into a power cut if the level has one   ('power' + cfg.generator)
//   grinder   the wet grinder's motor and stone while a batter prep job is cooking (silent in a power cut)
//   simmer    a pot bubbling while a gas prep job is cooking (silent while the gas is out)
//   gasHiss   the regulator hissing while the cylinder is nearly empty
//
//   const ops = createOpsAudio({ ctx, dest, now, timers, rng });
//   ops.start() / stop() / dispose()      follows the ambience
//   ops.setEnabled(false)                 muted: nothing is scheduled, every loop fades out and is freed
//   ops.noteEvent(ev) -> boolean          an engine event (event-start / event-end): true when the weather / power flags changed
//   ops.setState(state) -> boolean        the latest state (state.events is authoritative when present); true when the flags changed
//   ops.flags() -> { rain, power }        what index.js needs to thin / silence the dry-weather ambience
//
// CPU: loops are built lazily and freed again a few seconds after they fade out; at most MAX_NOISE_LOOPS looping noise sources run at
// once (opsMix.pickLoops); at most MAX_ONE_SHOTS scheduler one-shots sound at once; all of them share the one noise buffer of the context.

import { createSynth } from '@/lib/soundscape/synth.js';
import { buildLayer } from './ambience.js';
import { OPS_RECIPES, OPS_AMBIENT, dhol } from './opsRecipes.js';
import { eventIdsOf, opsTargets, pickLoops, LOOP_ORDER, NOISE_COST, GENERATOR_DELAY_MS } from './opsMix.js';

export const OPS_TICK_MS = 250;
export const MAX_ONE_SHOTS = 4; // scheduler one-shots sounding at once (drips count too, at most MAX_DRIPS of them)
export const MAX_DRIPS = 2;
const IDLE_FREE_MS = 9000; // a faded-out loop is freed after this long
const LOOKAHEAD_S = 0.45;
const FEST_STEP = 60 / 116 / 4; // sixteenth notes at 116 bpm
const FEST_V = 0.06; // the festival drum's loudest stroke: low on purpose
const FEST_PATTERN = ['dum', null, 'ta', 'ta', 'dum', null, 'ta', null, 'dum', 'dum', 'ta', null, 'dum', null, 'ta', 'ta'];
const TV_FORMANTS = [620, 800, 1050, 700, 900];

/**
 * Loops. Each chain is an ambience.buildLayer spec (`gain` = that chain's level); `mix` is the loop's top level on the ambience bus,
 * `tauIn` / `tauOut` how fast it fades (seconds). All of it is tuned by calculation, not by ear (see the report).
 */
export const LOOP_SPECS = {
  rain: {
    mix: 1,
    tauIn: 1.6,
    tauOut: 2.6,
    chains: [
      // the tin roof: bright noise broken up at patter rate
      { noise: true, filters: [{ type: 'highpass', f: 2400, q: 0.7 }, { type: 'lowpass', f: 9000, q: 0.5 }], mods: [{ type: 'sawtooth', rate: 17, depth: 0.35 }, { type: 'sine', rate: 0.3, depth: 0.2 }], gain: 0.08 },
      // the rain on the street and the puddles: a broad mid hiss that swells slowly
      { noise: true, filters: [{ type: 'bandpass', f: 1000, q: 0.5 }], mods: [{ type: 'sine', rate: 0.21, depth: 0.25 }], gain: 0.15 },
    ],
  },
  cricket: {
    mix: 1,
    tauIn: 2,
    tauOut: 2,
    // the neighbour's TV: a voiced murmur through a drifting formant, syllable rate ~4 Hz, phrases ~3 s
    chains: [{ noise: true, oscs: [{ type: 'sawtooth', f: 112, g: 0.5 }, { type: 'sawtooth', f: 169, g: 0.25 }], filters: [{ type: 'bandpass', f: 800, q: 1.6 }, { type: 'lowpass', f: 2600, q: 0.5 }], mods: [{ type: 'sine', rate: 4.1, depth: 0.55 }, { type: 'sine', rate: 0.35, depth: 0.45 }], gain: 0.9 }],
  },
  delivery: {
    mix: 1,
    tauIn: 0.8,
    tauOut: 1.2,
    // a single-cylinder bike idling: ~10 Hz putt on a low saw
    chains: [{ oscs: [{ type: 'sawtooth', f: 41, g: 1 }, { type: 'square', f: 82, g: 0.4 }], filters: [{ type: 'lowpass', f: 240, q: 0.7 }], mods: [{ type: 'sine', rate: 10.5, depth: 0.55 }, { type: 'sine', rate: 0.6, depth: 0.15 }], gain: 0.11 }],
  },
  generator: {
    mix: 1,
    tauIn: 0.5,
    tauOut: 0.8,
    chains: [{ oscs: [{ type: 'sawtooth', f: 50, g: 1 }, { type: 'square', f: 100, g: 0.35 }], filters: [{ type: 'lowpass', f: 360, q: 0.7 }], mods: [{ type: 'sine', rate: 22, depth: 0.25 }, { type: 'sine', rate: 0.3, depth: 0.1 }], gain: 0.1 }],
  },
  grinder: {
    mix: 1,
    tauIn: 0.3,
    tauOut: 0.45,
    chains: [
      { oscs: [{ type: 'sawtooth', f: 58, g: 1 }, { type: 'sine', f: 116, g: 0.5 }], filters: [{ type: 'lowpass', f: 340, q: 0.8 }], mods: [{ type: 'sine', rate: 0.8, depth: 0.1 }], gain: 0.07 }, // the motor
      { noise: true, filters: [{ type: 'lowpass', f: 520, q: 0.8 }], mods: [{ type: 'sine', rate: 1.7, depth: 0.35 }, { type: 'sine', rate: 6.3, depth: 0.12 }], gain: 0.5 }, // the stone turning in the wet dal
    ],
  },
  simmer: {
    mix: 1,
    tauIn: 0.8,
    tauOut: 0.8,
    chains: [{ noise: true, filters: [{ type: 'bandpass', f: 520, q: 0.9 }], mods: [{ type: 'sawtooth', rate: 6.5, depth: 0.5 }, { type: 'sine', rate: 2.9, depth: 0.3 }], gain: 0.5 }],
  },
  gasHiss: {
    mix: 1,
    tauIn: 0.6,
    tauOut: 0.4,
    chains: [{ noise: true, filters: [{ type: 'highpass', f: 5200, q: 0.6 }], mods: [{ type: 'sine', rate: 0.5, depth: 0.15 }], gain: 0.035 }],
  },
};

/** The one-shot gaps (ms) of the scheduler: [min, max]; the first one of a loop comes after ~40% of a gap. */
export const GAPS = {
  thunder: [16000, 38000],
  drip: [300, 1300],
  roar: [18000, 42000],
  firecracker: [45000, 95000],
  bell: [7000, 14000],
  horn: [10000, 22000],
};

export function createOpsAudio({ ctx, dest, now = () => Date.now(), timers = globalThis, rng = Math.random } = {}) {
  const loops = new Map(); // id -> { id, out, chains, srcs, nodes, want, idleAt, tau }
  const nextAt = {};
  let evSet = new Set();
  let lastState = null;
  let targets = opsTargets(null);
  let keep = new Set();
  let powerSince = null;
  let running = false;
  let enabled = true;
  let disposed = false;
  let timer = null;
  let shots = 0;
  let drips = 0;
  let festAt = null;
  let festStep = 0;
  let tickNo = 0;

  const flagsNow = () => ({ rain: evSet.has('rain'), power: evSet.has('power') });
  const set = (param, v, tau) => {
    try {
      param.setTargetAtTime(v, ctx.currentTime, tau);
    } catch {
      param.value = v;
    }
  };

  function buildLoop(id) {
    const spec = LOOP_SPECS[id];
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const chains = spec.chains.map((c) => {
      const L = buildLayer(ctx, out, c);
      L.out.gain.value = c.gain; // the chain sits at its own level; the loop's `out` fades the whole
      return L;
    });
    return {
      id,
      out,
      chains,
      srcs: chains.flatMap((c) => c.sources),
      nodes: chains.flatMap((c) => [...c.nodes]),
      want: null,
      idleAt: null,
    };
  }

  function destroyLoop(L) {
    for (const s of L.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of [...L.srcs, ...L.nodes, L.out]) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    loops.delete(L.id);
  }

  function computeTargets(t) {
    const power = evSet.has('power');
    if (power && powerSince === null) powerSince = t;
    if (!power) powerSince = null;
    const generatorReady = powerSince !== null && t - powerSince >= GENERATOR_DELAY_MS;
    return opsTargets(lastState, { events: [...evSet], generatorReady });
  }

  /** Brings the loops in line with the state: build the wanted ones, fade the others, free the long-idle ones. */
  function apply(t = now()) {
    if (disposed || !ctx) return;
    targets = computeTargets(t);
    keep = running && enabled ? pickLoops(targets) : new Set();
    for (const id of LOOP_ORDER) {
      const want = keep.has(id);
      let L = loops.get(id);
      if (want && !L) {
        try {
          L = buildLoop(id);
          loops.set(id, L);
        } catch {
          continue; // a context that cannot build it: the layer is optional
        }
      }
      if (!L) continue;
      if (want) L.idleAt = null;
      else if (L.idleAt === null) L.idleAt = t;
      if (L.want !== want) {
        L.want = want;
        const spec = LOOP_SPECS[id];
        set(L.out.gain, want ? spec.mix : 0, want ? spec.tauIn : spec.tauOut);
      }
      if (!want && L.idleAt !== null && t - L.idleAt > IDLE_FREE_MS) destroyLoop(L);
    }
  }

  function due(key, on, t) {
    const [lo, hi] = GAPS[key];
    if (!on) {
      nextAt[key] = undefined;
      return false;
    }
    if (nextAt[key] === undefined) {
      nextAt[key] = t + (lo + (hi - lo) * rng()) * 0.4; // the first one comes sooner
      return false;
    }
    if (t < nextAt[key]) return false;
    nextAt[key] = t + lo + (hi - lo) * rng();
    return true;
  }

  function oneShot(recipe, opts, { drip = false } = {}) {
    if (!recipe || shots >= MAX_ONE_SHOTS || (drip && drips >= MAX_DRIPS)) return false;
    const g = ctx.createGain();
    g.connect(dest);
    shots++;
    if (drip) drips++;
    let freed = false;
    const free = () => {
      if (freed) return;
      freed = true;
      shots = Math.max(0, shots - 1);
      if (drip) drips = Math.max(0, drips - 1);
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    const voice = { sources: 0, loud: 0, end: 0, onIdle: free };
    try {
      recipe(createSynth(ctx, g, voice), ctx.currentTime + 0.02, opts || {});
    } catch {
      /* ambience is optional */
    }
    if (voice.sources === 0) {
      free();
      return false;
    }
    return true;
  }

  function driftTv() {
    const L = loops.get('cricket');
    if (!L || !L.want) return;
    const bq = L.nodes.find((n) => n && n.Q && n.frequency && n.type === 'bandpass');
    if (bq) set(bq.frequency, TV_FORMANTS[Math.floor(rng() * TV_FORMANTS.length) % TV_FORMANTS.length], 0.12);
  }

  function playFestivalDrum() {
    if (!(targets.festival > 0 && running && enabled)) {
      festAt = null;
      return;
    }
    if (festAt === null || festAt < ctx.currentTime) festAt = ctx.currentTime + 0.05;
    const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
    const s = createSynth(ctx, dest, voice);
    while (festAt < ctx.currentTime + LOOKAHEAD_S) {
      const kind = FEST_PATTERN[festStep % FEST_PATTERN.length];
      if (kind) dhol(s, festAt, kind, FEST_V, -0.25);
      festStep++;
      festAt += FEST_STEP;
    }
  }

  function tick() {
    if (!running || disposed || !enabled || !ctx || ctx.state !== 'running') return;
    const t = now();
    tickNo++;
    try {
      apply(t);
      const rain = keep.has('rain');
      if (due('thunder', rain, t)) oneShot(OPS_RECIPES.thunder, { long: rng() > 0.4, v: 0.5 + 0.5 * rng() });
      if (due('drip', rain && targets.rain > 0, t)) oneShot(OPS_AMBIENT.drip, { v: rng(), pitch: rng(), pan: (rng() * 2 - 1) * 0.6 }, { drip: true });
      const cricket = keep.has('cricket');
      if (due('roar', cricket, t)) oneShot(OPS_AMBIENT.roar, { v: 0.4 + 0.6 * rng() });
      if (due('firecracker', cricket, t)) oneShot(OPS_AMBIENT.firecracker, { v: rng(), pan: (rng() * 2 - 1) * 0.7 });
      if (cricket && tickNo % 3 === 0) driftTv();
      if (due('bell', targets.festival > 0, t)) oneShot(OPS_AMBIENT.bell, { v: rng(), pitch: rng() });
      if (due('horn', keep.has('delivery'), t)) oneShot(OPS_RECIPES.bikeHorn, { pan: 0.35 });
      playFestivalDrum();
    } catch {
      /* the ambience must never break the game */
    }
  }

  return {
    start() {
      if (disposed || running) return;
      running = true;
      timer = timers.setInterval(tick, OPS_TICK_MS);
      apply();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      festAt = null;
      apply();
    },
    /** Muted: every loop fades out and is freed, nothing is scheduled. Unmuted: the loops the state asks for come back. */
    setEnabled(b) {
      const on = !!b;
      if (on === enabled) return;
      enabled = on;
      if (!on) {
        for (const k of Object.keys(nextAt)) nextAt[k] = undefined;
        festAt = null;
      }
      apply();
    },
    /** event-start / event-end of the engine. Returns true when the rain / power flags changed. */
    noteEvent(ev) {
      if (disposed || !ev || (ev.type !== 'event-start' && ev.type !== 'event-end') || typeof ev.id !== 'string') return false;
      const before = flagsNow();
      if (ev.type === 'event-start') evSet.add(ev.id);
      else evSet.delete(ev.id);
      apply();
      const after = flagsNow();
      return before.rain !== after.rain || before.power !== after.power;
    },
    /** The latest state: state.events (when an array) says which events run, the prep counter and the cylinder say the rest. */
    setState(state) {
      if (disposed || !state || typeof state !== 'object') return false;
      const before = flagsNow();
      lastState = state;
      if (Array.isArray(state.events)) evSet = new Set(eventIdsOf(state));
      apply();
      const after = flagsNow();
      return before.rain !== after.rain || before.power !== after.power;
    },
    flags: flagsNow,
    tick,
    isRunning: () => running,
    targets: () => ({ ...targets }),
    loopIds: () => [...loops.keys()],
    /** Loops that are WANTED right now (not the ones still fading out). */
    activeLoops: () => [...loops.values()].filter((L) => L.want).map((L) => L.id),
    stats: () => ({
      loops: loops.size,
      active: [...loops.values()].filter((L) => L.want).length,
      noiseLoops: [...loops.values()].reduce((n, L) => n + (L.want ? NOISE_COST[L.id] || 0 : 0), 0),
      shots,
    }),
    dispose() {
      if (disposed) return;
      this.stop();
      disposed = true;
      for (const L of [...loops.values()]) destroyLoop(L);
    },
  };
}

export default createOpsAudio;
