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
import { Group, HalfFloatType, WebGLRenderTarget } from 'three';

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
  batch: 'Stacking the steel...',
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
  // somebody walks up, for a 10-25 % saving: off. Re-measured for the draw-call policy: medium 977 -> 898 calls (-8 %), high 1103 -> 1024 (-7 %), nowhere near the
  // medium budget (700), and customers are built mid-shift, not only inside the staged loader: still off (the run-time draw-call guard handles heavy tiers instead).
  // medium / high: PACKED people (models/pack.js): the rig is untouched, but a customer is drawn as ~10 dynamic meshes (skin, eyes, hair, clothes) instead of 62
  // (and ~7 shadow draws instead of 26), measured at 5 k vertices a person: the CPU copy is far cheaper than the draw calls it replaces.
  setCharacterDrawMode({ merge: false, baked: !!cfg.bakedCustomers, limitShadows: cfg.shadow > 0, pack: !cfg.bakedCustomers });
  setTextureQuality(TEX_TIER[q] || 'medium');
  setFoodQuality(FOOD_TIER[q] || 'medium');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// batching the static scenery
/**
 * createBatcher({ roots: [{ name, root, noMergeUnder: [Object3D] }], drive(i, n), flatten }) -> { step(budgetMs) -> done, restore(), dispose(), stats }
 * `drive(i, n)` moves the scene's own animation to variation `i` of `n` (an hour of the day, a time) WITHOUT rendering; the batcher samples after each.
 * `flatten` (lite) bakes textured materials into vertex colours; `uber` folds every untextured standard material into one shared material (see models/merge.js).
 */
export function createBatcher({ roots, drive, flatten = false, uber = false, samples = 36, perCall = 4, minGroup = 2 }) {
  let phase = 0; // 0 begin, 1 sample, 2 merge, 3 done
  let i = 0;
  let r = 0;
  let gen = null;
  const probes = [];
  const results = [];
  const statics = new Set(); // every mesh the probe saw never move (merged or left alone) plus the merged meshes: the shadow proxy swallows these
  const stats = { before: 0, after: 0, ms: 0 };
  const api = {
    stats,
    /** Meshes that never move (see above); complete once `done`. */
    statics,
    get done() { return phase >= 3; },
    /** 0..1: how far the probe and the merge have got (for the loading bar). */
    get progress() {
      if (phase === 0) return 0;
      if (phase === 1) return 0.5 * (i / samples);
      if (phase === 2) return 0.5 + 0.5 * (r / Math.max(1, probes.length));
      return 1;
    },
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
            const only = p.probe.finish();
            for (const o of only) statics.add(o);
            gen = mergeStaticSteps(p.spec.root, { only, flatten, uber, minGroup, keepOriginals: true });
          }
          const step = gen.next();
          if (step.done) {
            const res = step.value;
            results.push(res);
            for (const m of res.merged || []) statics.add(m);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// shader readiness
/**
 * Resolves when every shader program the renderer holds has finished linking (KHR_parallel_shader_compile: the browser links them on worker threads while
 * the main thread does other work; `program.isReady()` polls the completion flag without blocking). Without the extension three.js reports every program
 * ready at once and the compile is paid on first use, as before. Polls every `pollMs` (the page stays responsive), gives up after `timeoutMs`.
 * onProgress(ready, total) is called on every poll. Resolves { ready, total, ms, timedOut }.
 */
export function waitProgramsReady(renderer, { timeoutMs = 30000, pollMs = 25, onProgress } = {}) {
  return new Promise((resolve) => {
    const t0 = now();
    const check = () => {
      const { ready, total } = programsStatus(renderer);
      onProgress?.(ready, total);
      const timedOut = ready < total && now() - t0 >= timeoutMs;
      if (ready >= total || timedOut) resolve({ ready, total, ms: now() - t0, timedOut });
      else setTimeout(check, pollMs);
    };
    check();
  });
}

/** { ready, total }: how many of the renderer's shader programs have finished linking (all of them when the browser cannot tell). */
export function programsStatus(renderer) {
  const progs = renderer?.info?.programs || [];
  let ready = 0;
  for (const p of progs) if (typeof p.isReady !== 'function' || p.isReady()) ready++;
  return { ready, total: progs.length };
}

/**
 * The "no shader program is compiled in play" contract, as a counter. `reveal()` (called when the loading screen goes) remembers every program the renderer holds
 * now; `late()` lists the programs created since (each one is a 25 to 120 ms hitch on the frame that first drew it), `count` is how many. `getPrograms()` returns
 * the renderer's `info.programs` (objects with an `id`, a `name` and a `cacheKey`). Tooling reads it through `scene.debug.reveal`.
 */
export function createRevealWatch(getPrograms) {
  let known = null;
  let atReveal = 0;
  const list = () => {
    const all = (typeof getPrograms === 'function' ? getPrograms() : null) || [];
    return Array.prototype.slice.call(all);
  };
  return {
    reveal() {
      const all = list();
      known = new Set(all.map((p) => p.id));
      atReveal = all.length;
      return atReveal;
    },
    get revealed() {
      return known !== null;
    },
    /** Programs held at the reveal (0 before it). */
    get atReveal() {
      return atReveal;
    },
    /** The programs created after the reveal: [{ id, name, key }]. */
    late() {
      if (!known) return [];
      return list().filter((p) => !known.has(p.id)).map((p) => ({ id: p.id, name: p.name || '', key: String(p.cacheKey || '').slice(-80) }));
    },
    get count() {
      return this.late().length;
    },
  };
}

/** A promise that resolves after `ms` (a yield that lets the browser link shaders on its worker threads and paint the loading screen). */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn()` with every object of `scene` visible and exempt from frustum culling, then puts every flag back. One frame drawn like this (behind the loading
 * screen) pays the FIRST DRAW of everything the game keeps hidden or off-screen until it needs it (a customer parked below the street, the rain, the cricket TV,
 * the inspector's clipboard, the viewmodel's tools): the driver's per-program first-use cost (25 to 120 ms each on D3D11), the geometry and texture uploads and the
 * shadow-depth programs, all of which would otherwise land in the middle of a shift as a hitch. Lights and cameras are left alone (the light count is part of every
 * lit shader), and `skip(o)` keeps an object as it is.
 */
export function withEverythingDrawn(scene, fn, { skip } = {}) {
  const saved = [];
  scene.traverse((o) => {
    if (o.isLight || o.isCamera || skip?.(o)) return;
    const drawable = o.isMesh || o.isPoints || o.isLine || o.isSprite;
    const hide = !o.visible;
    const cull = drawable && o.frustumCulled;
    if (!hide && !cull) return;
    saved.push(o, o.visible, o.frustumCulled);
    o.visible = true;
    if (drawable) o.frustumCulled = false;
  });
  try {
    return fn();
  } finally {
    for (let i = 0; i < saved.length; i += 3) {
      saved[i].visible = saved[i + 1];
      saved[i].frustumCulled = saved[i + 2];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// shader warm-up
/**
 * The programs the game really draws with are not the ones the load-time `compile` sees: that runs before the first state, so the stall has fewer lights
 * (5 point lights, not 11), `scene.environment` is not set yet (no env-map variant) and the static scenery is not batched. Measured at medium, level 12: 89 of
 * the 151 programs compiled at load were never used, while 30 to 80 more compiled mid-shift, the first time a dish, an event, the weather or a batched
 * mesh was drawn (a visible hitch on a real GPU, where one program is 5 to 50 ms).
 *
 * createProgramWarmer({ renderer, scene, camera, post, extras, hiddenLights }) -> { step(budgetMs) -> done, cancel(), stats }
 * Run it once the first state is in, the lights are applied and the batcher is done. Per step it compiles one chunk of the scene against the real scene's
 * lights, with every hidden object made visible for the call (events, weather, torches, the generator) and, with the post pipeline, with a render target
 * bound (the HDR target changes the output colour space: a different program from the canvas one). Then, when some light is hidden at the moment (the prep
 * counter's lights are on only at some levels), the same again with every light on, so the light-count variant the next level needs exists too.
 * `extras` are builders of things the game creates later (one of each dish): each is built once, parked out of sight, compiled, and left in the caches.
 * `units: false` skips the scene itself (it was compiled before) and does only the extras.
 * All visibility changes are undone before the call returns. Without KHR_parallel_shader_compile a chunk can block for its compile time: chunks are
 * small (a top-level child, or its children when it is big) and `step` stops at its time budget.
 */
export function createProgramWarmer({ renderer, scene, camera, post = false, extras = [], hiddenLights = true, bigChunk = 60, units: compileUnits = true }) {
  const stats = { chunks: 0, programs: 0, ms: 0, variants: 0, extras: 0, errors: 0 };
  let units = null;
  let phase = 0; // 0 extras, 1 current lights, 2 all lights, 3 done
  let i = 0;
  let x = 0;
  let allOn = false;
  let rt = null;
  let parkGroup = null;
  let cancelled = false;
  const programCount = () => renderer?.info?.programs?.length ?? 0;

  const chunkOf = (root) => {
    let n = 0;
    root.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) n++;
    });
    return n;
  };
  const planUnits = () => {
    const out = [];
    for (const child of scene.children) {
      if (child === camera || child.isLight || child === parkGroup) continue;
      if (child.children.length > 1 && chunkOf(child) > bigChunk) {
        for (const g of child.children) out.push(g);
        if (child.isMesh || child.isPoints || child.isLine || child.isSprite) out.push(child);
      } else out.push(child);
    }
    return out;
  };

  /** Runs `fn` with every object under `root` visible (and, if `lights`, every light in the scene on, with its ancestors), then restores all of it. */
  const withEverythingVisible = (root, lights, fn) => {
    const saved = [];
    root.traverse((o) => saved.push(o, o.visible));
    root.traverse((o) => {
      o.visible = true;
    });
    if (lights) {
      scene.traverse((o) => {
        if (!o.isLight) return;
        for (let p = o; p && p !== scene; p = p.parent) {
          if (p.visible) continue;
          saved.push(p, false);
          p.visible = true;
        }
      });
    }
    try {
      return fn();
    } finally {
      for (let k = saved.length - 2; k >= 0; k -= 2) saved[k].visible = saved[k + 1];
    }
  };
  const anyHiddenLight = () => {
    let hidden = false;
    scene.traverse((o) => {
      if (o.isLight && !o.visible) hidden = true;
      else if (o.isLight) for (let p = o.parent; p && p !== scene; p = p.parent) if (!p.visible) hidden = true;
    });
    return hidden;
  };

  /** Does the subtree hold a light? (three.js counts those twice when the subtree is compiled as an object of the scene: see compileOne.) */
  const holdsLight = (root) => {
    let found = false;
    root.traverse((o) => {
      if (o.isLight) found = true;
    });
    return found;
  };

  const compileOne = (root, lights) => {
    if (!root || !renderer?.compile) return;
    const before = programCount();
    const t0 = now();
    const prev = renderer.getRenderTarget?.() ?? null;
    // renderer.compile(object, camera, scene) gathers the lights of the scene AND of the object (it is made for an object that is not in the scene yet). A unit that is
    // already in the scene and holds lights (the stall: 8, the street: 1) therefore counted them twice: its programs were built for 19 point lights, the scene really
    // has 10, and the first frame rebuilt 24 of the heaviest programs from scratch (20 s on a cold, shared GPU). Such a unit is compiled through the whole scene instead.
    const own = root !== scene && holdsLight(root);
    try {
      if (post && rt) renderer.setRenderTarget(rt);
      withEverythingVisible(root, lights, () => (own ? renderer.compile(scene, camera) : renderer.compile(root, camera, scene)));
    } catch (err) {
      stats.errors++;
      if (stats.errors === 1) console.warn('[tiffin] shader warm-up chunk skipped', err);
    } finally {
      renderer.setRenderTarget?.(prev);
    }
    stats.chunks++;
    stats.programs += Math.max(0, programCount() - before);
    stats.ms += now() - t0;
  };

  return {
    stats,
    get done() { return phase >= 3 || cancelled; },
    cancel() {
      cancelled = true;
      if (parkGroup) scene.remove(parkGroup);
      rt?.dispose?.();
      rt = null;
    },
    step(budgetMs = 4) {
      if (phase >= 3 || cancelled || !renderer?.compile) return true;
      const t0 = now();
      if (!rt && post && typeof renderer.setRenderTarget === 'function') {
        try {
          rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: true });
        } catch {
          rt = null;
        }
      }
      do {
        if (phase === 0) {
          // one dish (or whatever the caller listed) per step: it is built, parked below the street, compiled with the rest, and its caches stay
          if (x < extras.length) {
            try {
              const o = extras[x++]();
              if (o) {
                if (!parkGroup) {
                  parkGroup = new Group();
                  parkGroup.name = 'warm-park';
                  parkGroup.position.set(0, -60, 0);
                  scene.add(parkGroup);
                }
                parkGroup.add(o);
                stats.extras++;
              }
            } catch {
              stats.errors++;
            }
            break; // building a dish is a frame's work on its own
          } else {
            phase = 1;
            units = compileUnits ? planUnits() : [];
            if (parkGroup) units.push(parkGroup);
            i = 0;
          }
        } else if (phase === 1 || phase === 2) {
          if (i < units.length) compileOne(units[i++], allOn);
          else if (phase === 1 && hiddenLights && anyHiddenLight()) {
            phase = 2;
            allOn = true;
            i = 0;
            stats.variants++;
          } else {
            phase = 3;
            if (parkGroup) scene.remove(parkGroup);
            rt?.dispose?.();
            rt = null;
          }
        }
      } while (phase < 3 && now() - t0 < budgetMs);
      return phase >= 3;
    },
  };
}
