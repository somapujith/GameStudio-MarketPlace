// Staged loading for the 3D scene.
//
//   * runSync(gen) / runAsync(gen, { onProgress, budgetMs }) drive a generator of build steps. The generator yields `{ label, p }` between steps
//     (or a Promise to wait for, such as a shader pre-compile); the async driver gives the browser a turn whenever a slice has used its budget
//     (12 ms), so the loading screen animates and input stays alive. A single step (building the stall) can still exceed the budget: steps are the
//     unit of cooperation.
//   * applyModelTier(q) points the model libraries (people, food, textures) at the tier. Before this existed they all ran at their `high` defaults.
//   * createBatcher(...) merges the static meshes of the stall shell and the street after the first state has arrived, spread over frames
//     (probe -> sample under varied light -> merge), and can undo itself if the stall rebuilds (stations / spots / menu change).
//   * idle(fn) / whenIdle() / yieldToBrowser(): requestIdleCallback with a setTimeout fallback (Safari has no requestIdleCallback).
import { QUALITY } from './quality.js';
import { setCharacterQuality, setCharacterDrawMode } from '../models/charquality.js';
import { setTextureQuality } from '../models/util.js';
import { setQuality as setFoodQuality } from '../models/pbr.js';
import { createStaticProbe, mergeStaticSteps } from '../models/merge.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------------------------------------------
export function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });
}

/** Runs `fn` when the browser is idle (requestIdleCallback), or after `timeout` ms on browsers without it. Returns a cancel function. */
export function idle(fn, timeout = 1200) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback?.(id);
  }
  const id = setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 8 }), Math.min(timeout, 200));
  return () => clearTimeout(id);
}
export const whenIdle = (timeout) => new Promise((resolve) => idle(resolve, timeout));

export function runSync(gen) {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

export async function runAsync(gen, { onProgress, budgetMs = 12, shouldAbort } = {}) {
  let sliceStart = now();
  for (;;) {
    if (shouldAbort?.()) {
      gen.return?.();
      return null;
    }
    const r = gen.next();
    if (r.done) return r.value;
    const y = r.value;
    if (y && typeof y.then === 'function') {
      await y;
      sliceStart = now();
      continue;
    }
    if (y && y.label) onProgress?.(y.p ?? 0, y.label);
    if (now() - sliceStart >= budgetMs) {
      await yieldToBrowser();
      sliceStart = now();
    }
  }
}

/** The copy of the loading screen for each step (the stove is the joke; the step names are the truth). */
export const LOAD_STEPS = {
  gpu: 'Lighting the stove...',
  textures: 'Rolling the batter...',
  stall: 'Hanging the banner...',
  street: 'Sweeping the street...',
  people: 'Calling the regulars...',
  shaders: 'Heating the tawa...',
  ready: 'Ready',
};

// ---------------------------------------------------------------------------------------------------------------------------------
// tiers -> model libraries
const FOOD_TIER = { lite: 'low', low: 'low', medium: 'medium', high: 'high' };
const TEX_TIER = { lite: 'low', low: 'low', medium: 'medium', high: 'high' };

/** Points characters, food and procedural textures at tier `q`. Call BEFORE building anything; later calls only affect new objects. */
export function applyModelTier(q) {
  const cfg = QUALITY[q] || QUALITY.medium;
  setCharacterQuality(cfg.characters);
  // people: lite / low bake (a few draw calls, cheap to build); medium / high keep the full rig and only pin tiny parts out of the shadow pass.
  // Merging static sub-meshes of a customer (merge: true) works (models/merge.js) but costs 70-370 ms per build (it probes 45 poses), a visible hitch when
  // somebody walks up, for a 10-25 % saving: off.
  setCharacterDrawMode({ merge: false, baked: !!cfg.bakedCustomers, limitShadows: cfg.shadow > 0 });
  setTextureQuality(TEX_TIER[q] || 'medium');
  setFoodQuality(FOOD_TIER[q] || 'medium');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// batching the static scenery
/**
 * createBatcher({ roots: [{ name, root, noMergeUnder: [Object3D] }], drive(i, n), flatten }) -> { step(budgetMs) -> done, restore(), dispose(), stats }
 * `drive(i, n)` moves the scene's own animation to variation `i` of `n` (an hour of the day, a time) WITHOUT rendering; the batcher samples after each.
 */
export function createBatcher({ roots, drive, flatten = false, samples = 36, perCall = 4, minGroup = 2 }) {
  let phase = 0; // 0 begin, 1 sample, 2 merge, 3 done
  let i = 0;
  let r = 0;
  let gen = null;
  const probes = [];
  const results = [];
  const stats = { before: 0, after: 0, ms: 0 };
  const api = {
    stats,
    get done() { return phase >= 3; },
    /** Does a slice of work (at most ~budgetMs); returns true when finished. */
    step(budgetMs = 8) {
      const t0 = now();
      if (phase === 3) return true;
      if (phase === 0) {
        for (const spec of roots) {
          for (const g of spec.noMergeUnder || []) g.userData.noMerge = true;
          probes.push({ spec, probe: createStaticProbe(spec.root, { skip: spec.skip }) });
        }
        phase = 1;
      }
      if (phase === 1) {
        let n = 0;
        while (i < samples && n < perCall && now() - t0 < budgetMs) {
          drive(i, samples);
          for (const p of probes) p.probe.sample();
          i++;
          n++;
        }
        if (i >= samples) phase = 2;
        stats.ms += now() - t0;
        return false;
      }
      if (phase === 2) {
        // one merge bucket per slice step, as many as fit the budget (a whole root is 30 to 120 ms in one piece: too long for a frame)
        do {
          if (!gen) {
            const p = probes[r];
            if (!p) {
              phase = 3;
              break;
            }
            gen = mergeStaticSteps(p.spec.root, { only: p.probe.finish(), flatten, minGroup, keepOriginals: true });
          }
          const step = gen.next();
          if (step.done) {
            const res = step.value;
            results.push(res);
            stats.before += res.before;
            stats.after += res.after;
            stats[probes[r].spec.name] = { before: res.before, after: res.after };
            gen = null;
            r++;
            if (r >= probes.length) phase = 3;
          }
        } while (phase === 2 && now() - t0 < budgetMs);
        stats.ms += now() - t0;
        return phase === 3;
      }
      return true;
    },
    /** Puts the original meshes back (the stall rebuilt something the merge swallowed). */
    restore() {
      for (const res of results) res.restore?.();
      results.length = 0;
      phase = 3;
    },
    dispose() {
      for (const res of results) res.dispose?.();
      results.length = 0;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// lazy chunks
/** Starts the downloads of the heavy tiffin chunks while the player reads the home screen. No-op on data-saver connections. */
export function prefetchChunks(loaders, { saveData = false } = {}) {
  if (saveData) return () => {};
  let cancelled = false;
  let cancel = () => {};
  const run = (k) => {
    if (cancelled || k >= loaders.length) return;
    cancel = idle(() => {
      if (cancelled) return;
      Promise.resolve()
        .then(() => loaders[k]())
        .catch(() => {})
        .then(() => run(k + 1));
    }, 4000);
  };
  run(0);
  return () => {
    cancelled = true;
    cancel();
  };
}
