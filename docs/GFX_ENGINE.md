# GFX engine: the shared rendering layer (`src/platform/gfx/`)

One small, dependency-free (three.js only where it must be) layer that **both** 3D games adopt for the parts of rendering that are not game-specific:
knowing the machine, choosing the starting quality, holding the frame rate, not stalling on shaders, not drawing 1000 things one by one.
Everything is plain JS with a unit test next to it (`npx vitest run src/platform/gfx`, from PowerShell). Nothing here imports from a game.

```
gpu.js          what GPU is this?                  renderer string + caps -> { class, vendor, model, tflops, tierCap, key }
tierMemory.js   what worked last time?             per (GPU, viewport class): last stable tier + render scale, in guarded localStorage
calibrate.js    what can it do right now?          ~250 ms micro-benchmark -> costs per pixel / call / triangle -> recommended { tier, scale }
governor.js     keep the frame rate               ONE controller: scale ladder + tier steps, up AND down, hysteresis, refresh-aware
gpuTimer.js     how busy is the GPU really?        EXT_disjoint_timer_query_webgl2 wrapper (optional; lets the governor see headroom at vsync)
loop.js         the frame loop                     rAF, fixed step, fps cap, visibility, resize debounce, info reset, zero-alloc stats ring
dynamicRes.js   resolution scaling with no realloc render into a sub-rect of targets allocated once; dynUv() GLSL; fullscreen pass helper
warmup.js       no first-use stalls                compile shaders + upload textures under a per-frame budget; program census
batch.js        fewer draw calls                   merge by material, freeze static, tile for culling, instance, dispose
adaptive.js     the wiring                         gpu + memory + calibration + governor in one call; device hints (battery, data saver)
index.js        barrel                             import { ... } from '@/platform/gfx'
```

## 1. How the pieces fit (one picture)

```
page load ──► classifyGpu(gl)                    class, tierCap ("integrated never starts on high")
          ──► tierMemory.get(gpu, viewport)      a remembered stable tier?  ──yes──► start there, no benchmark
                    │ no
                    ▼
          ──► runStandaloneCalibration()         ~250 ms on the loading screen, no hitch
          ──► chooseInitialTier()                pref > memory > calibration (capped by class) > class
          ──► build the renderer at that tier ──► warmShaders() under the loading bar ──► play
play      ──► every frame: governor.frame(dt, cpuMs, calls, gpuMs)
                    ├─ onScale(s)  ──► dyn.setScale(s)        free (viewport only)
                    ├─ onTier(t)   ──► rebuild at tier t       rare, hitch hidden by governor.hold()
                    └─ onStable()  ──► tierMemory.set(...)     the NEXT session starts right
```

## 2. Quick start

```js
import {
  probeGpu, createTierMemory, viewportClass, createAdaptiveQuality, runStandaloneCalibration, shouldCalibrate, createLoop, createDynamicRes, watchDeviceHints, warmShaders,
} from '@/platform/gfx';

const gpu0 = probeGpu();                                           // one throw-away context, cached
const memory = createTierMemory({ game: 'tiffin-centre' }).get(gpu0.key, viewportClass(w, h, dpr));
let calibration = null;
if (shouldCalibrate({ gpu: gpu0, memory, pref }).run) calibration = await runStandaloneCalibration({ width: w, height: h, dpr, gpu: gpu0, tiers: MY_TIER_MODELS });

const dyn = createDynamicRes();            // resolution scaling without re-allocating targets (section 5)
const aq = createAdaptiveQuality({
  game: 'tiffin-centre', tiers: ['lite', 'low', 'medium', 'high'], pref: getGfxPref(),          // 'auto' or a tier
  viewport: { w, h, dpr }, gpu: gpu0, calibration,
  callBudgets: DRAW_CALL_BUDGET, scaleMin: { lite: 0.6, low: 0.5, medium: 0.5, high: 0.5 },
  onScale: (s) => dyn.setScale(s),
  onTier: (tier, info) => rebuildAt(tier, info.scale),
});
console.log(aq.describe());                // gfx: integrated AMD Radeon Graphics cap:medium -> start medium@1 (calibration: ...)
const renderer = createRenderer(canvas, { quality: aq.initial.tier });          // build with aq.initial.tier / .scale
const loop = createLoop({ update, render, governor: aq.governor, info: renderer.info, onResize });
watchDeviceHints(aq.governor);             // battery / data saver cap the fps
loop.start();
```

## 3. API reference

### gpu.js
| function | what it does |
|---|---|
| `classifyGpu({ gl \| renderer, vendor, caps, nav, win, mm })` | The full record `{ class: 'software' \| 'integrated' \| 'discrete' \| 'mobile' \| 'unknown', vendor, model, family, tflops, renderer, masked, dpr, cores, memoryGB, mobile, refreshHz (null until measured), caps, tierCap, reasons, key }`. Never throws. |
| `classifyRenderer(str, vendorHint?)` | The pure matcher (a rule table, first match wins): ANGLE wrapper unpacked, device ids stripped. 160 test cases over 70 real strings. |
| `tierCapFor({ cls, tflops, family, caps, memoryGB, cores, mobileHint })` | The highest generic tier to START on. Integrated (non Apple Silicon) is capped at `medium`; mobile never `high`; no half-float targets / tiny textures / 1-2 GB / 2 cores lower it. |
| `probeGpu()` | Browser convenience: classifies through a throw-away WebGL context (cached, context released). |
| `readGpuStrings(gl)`, `readGlCaps(gl)`, `readEnv()` | The raw readers (unmasked renderer, MAX_TEXTURE_SIZE / MAX_SAMPLES / half-float / KHR_parallel_shader_compile / timer query; cores, memory, dpr, touch). |
| `gpuKey(gpu)`, `withRefresh(gpu, hz)`, `describeGpu(gpu)`, `TIER_ORDER`, `minTier(a, b)` | helpers |

`tflops` is an APPROXIMATE fp32 figure from public specs (only the ordering matters). `class` is descriptive; decisions use `tierCap` (Apple's M-series is `integrated` but Max / Ultra may start on `high`).

### tierMemory.js
`createTierMemory({ game, storage?, now?, ttlMs (30 d), failTtlMs (7 d), maxEntries (16), maxBytes (4096) })` -> `{ get(gpuKey, vp), set(gpuKey, vp, { tier, scale }), markFailed(gpuKey, vp, tier), isFailed(...), forget(...), clear(), supported, dump() }`.
`viewportClass(w, h, dpr)` buckets by DEVICE pixel load (`xs < 0.5 MP < s < 1 < m < 2 < l < 3.5 < xl`), so 1536x864 @1.25 and 1920x1080 @1 share a memory.
One versioned key per game (`jalebi.gfx.v1.<game>`). Every storage touch is guarded: private mode / blocked storage / quota (retries once with fewer entries, then degrades to memory) / corrupt JSON (discarded and removed) / wrong version / malformed entries (dropped one by one). It never throws.

### calibrate.js
- `createCalibration({ renderer \| load, gpu, tiers, viewport, maxMs (300), startMaxMs (500), ... })` -> `{ run(): Promise<result>, cancel(), frame(ts) }`. rAF driven, cancellable, never rejects. Timeline: six small JS build steps (one per frame) -> wait for the programs to be READY -> a **wake** phase (one program's first draw per frame, then a **fence** polled without blocking) -> measure. Two real-GPU lessons shaped it (dev laptop, ANGLE / D3D11): the first draw of each distinct program costs ~25-30 ms of MAIN THREAD even after `KHR_parallel_shader_compile` says ready (so it uses TWO programs and pays them in the wake phase), and a 1-pixel readback after a slice is bimodal (1.8 ms or 18 ms for the same work, it queues behind the compositor), so slices are timed with **`EXT_disjoint_timer_query_webgl2`** (GPU execution time; nothing blocks the main thread; the calls test uses `max(CPU submit, GPU)`). Slice size follows the display refresh (~3 ms at 144 Hz), the four tests are interleaved with up to 4 slices in flight and the follow-up slices sent together (two result latencies per test). Browsers without the extension fall back to blocking readbacks: the fixed cost of an empty readback (smallest of three) is measured and subtracted from every slice (not yet re-measured on a real GPU), two slow slices in a row abort with a lowest-tier verdict, and the result is marked `confident: false`. `maxMs` bounds the measure phase; the start-up phases have their own bound because first-use stalls are real.
- It measures `fillNsPerPx` (alpha-blended ALU-heavy layers at the real canvas size), `callUs` (up to 800 tiny meshes), `mtriMs` (a 100k-triangle mesh drawn repeatedly), `postNsPerPx` (a half-float 9-tap pass), each as `ms = overhead + slope * work` from 2-3 slices.
- `estimateFrameMs(units, model, viewport, scale)` = `max(cpu, gpu) * 1.1` with `cpu = calls * callUs`, `gpu = fill + tris + post`. `recommendTier({ units, viewport, tiers, budgetMs, capTier })` picks the HIGHEST tier that fits `0.85 * budget` at scale >= 0.9, else the highest that fits at any scale, else the lowest at its floor. **Pass your game's own tier models** (`DEFAULT_TIER_MODELS` is a generic ladder): `{ pixelRatio, layers (shaded overdraw), calls (in simple-call equivalents: lit shadowed materials cost more than the test's MeshBasicMaterial), mtris, post (full-screen passes), scaleMin }`.
- `shouldCalibrate({ gpu, memory, pref })` -> `{ run, reason }`: skipped for a player choice, a memory hit, software rendering, no WebGL2.
- `chooseInitialTier({ gpu, calibration, memory, pref, tiers })` -> `{ tier, scale, source: 'pref' \| 'memory' \| 'calibration' \| 'class', lock, maxTier, reasons }`. Guarantee: an integrated GPU never starts on `high` unless the player or its own remembered history says so. A non-confident benchmark (aborted / timed out / readback-timed) may lower the class cap by one tier at most.

### governor.js
`createGovernor(options)` -> `gov`. Feed it every rendered frame: `gov.frame(dtMs, cpuMs = -1, calls = -1, gpuMs = -1)` returns `CHANGE_NONE | CHANGE_SCALE | CHANGE_TIER`; read `gov.scale`, `gov.tier`, `gov.budgetMs`, `gov.refreshHz`, `gov.fpsCap`, `gov.stableMs`. Callbacks: `onScale(scale, info)`, `onTier(tier, info)` (`info.scale` = the scale to use with it), `onStable({ tier, scale })` (once per settled rung, after 8 s), `onTierFailed(tier)`, `onRefresh(hz)`.

| option | default | meaning |
|---|---|---|
| `tiers`, `tier`, `minTier`, `maxTier` | lite..high, medium | the ladder, the start, the floor, the ceiling (= `gpu.tierCap`) |
| `scale`, `ladder`, `scaleMin` | 1, `[1 .9 .8 .7 .6 .5]`, 0.5 | start scale (snapped to a rung); `scaleMin` may be a number, `{ tier: n }` or `(tier) => n` |
| `lockTier` | false | the player chose a tier: only the scale adapts |
| `targetFps`, `refreshHz` | 60, auto | budget = `1000 / min(refresh, targetFps, fpsCap)`; refresh detected from the frame intervals (50-240 Hz), or given |
| `callBudgets` | none | `{ tier: maxDrawCalls }`: over budget while missing the frame budget for 2 s -> tier down |
| `tierCost` | `1.7^i` | relative cost per tier (for the tier-up prediction) |
| `failedTiers` | [] | tiers tier memory says failed here: never tried |
| `warmupMs` 800, `windowMs` 400, `downRatio` 1.15, `severeRatio` 1.6, `upRatio` 0.9, `upHoldMs` 2500, `probeHoldMs` 5000, `tierUpHoldMs` 20000 | | see section 7 |
| `gpuTimerBias` 1.25, `forgiveRatio` 0.75 | | the GPU timer reads ~20 % low against the frame (measured), so headroom estimates inflate it; a rung that failed twice is forgiven automatically when the frame time at that rung falls below 75 % of what it was when it failed |

Other methods: `hold(ms)` (ignore the next frames: a rebuild, a level load), `discontinuity()`, `notifyLoadChange()` (forgive failed probes: new area, day/night), `setHints({ batteryLow, lowPower, saveData, thermal, capFps })` -> fps cap (30), `setRefreshHz(hz)`, `setTier(tier, { scale, lock })` (the player changed the setting), `setMaxTier()`, `markTierFailed()`, `stats()` (p50 / p95 / p99, counts, probe failures, history of every decision with its reason).

### loop.js
`createLoop({ update(dt), render(alpha, dt), fixedStep (seconds, 0 = variable), maxSubSteps 5, maxDelta 0.1, maxFps, governor, info (renderer.info), gpuTimer, onResize, onVisibility, resizeDebounceMs 120, pauseHidden })` -> `{ start, stop, pause, resume, setMaxFps(n), discontinuity(), ring, state, dispose }`.
- the fps cap uses a carried due-time, so 144 Hz capped to 60 averages ~57-60 (not 48); `dt` handed to the game is the time since the last RENDERED frame
- tab hidden: rAF cancelled; shown again: the first frame has `dt = 0` and the governor is told it was a discontinuity (no giant catch-up step, no false verdict)
- `info.autoReset = false` and one `info.reset()` per frame, so `renderer.info.render.calls` spans every pass of the frame (post included); the calls are fed to the governor
- `createFrameRing(capacity)`: typed-array ring of `dt / cpu / calls` with `mean`, `max`, `percentile`, `fps`, `over(ms)`. `push` allocates nothing.

### gpuTimer.js
`createGpuTimer(gl)` -> `{ supported, begin(), end(), lastMs, avgMs, dispose() }`. `createLoop({ gpuTimer })` wraps every frame in `begin()/end()` and passes `lastMs` to the governor (without the loop: wrap all GL work of the frame yourself and pass it as the 4th argument of `gov.frame`). Results arrive a few frames late; disjoint samples are dropped; at most 4 queries in flight; one query per frame, never nested. With it, the governor sees real headroom on a vsync-pinned frame and can raise the TIER with evidence. (Available on the dev laptop's Chrome: `EXT_disjoint_timer_query_webgl2` is exposed.)

### dynamicRes.js (section 5 has the full recipe)
`createDynamicRes({ scale })` -> `{ setScale(s), apply(target), sizeOf(target), reset(target), bind(target), uniforms }`; `DYNRES_GLSL` (`dynUv(uv)`), `rewriteSamples(glsl, ['tColor', ...])`, `createDynPass({ fragment, uniforms, dyn })` -> `{ render(renderer, target \| null, dyn), uniforms, dispose() }`, `createBlit(dyn)` (present a dynamic target on the canvas).

### warmup.js
- `warmShaders(renderer, scene, camera, { budgetMs 4, textures true, include, onProgress, targetScene, settleFrames 2 })` -> `{ promise, cancel(), progress, stats }`. (Measured on the dev laptop: a program's first draw right after `compileAsync` resolved cost 25-30 ms of main thread, ~1 ms five frames later; hence `settleFrames`. At ~25 ms per program the real lever is the NUMBER of programs: use the census.) One representative object per distinct (material, object features: instancing / skinning / morph / vertex colours / uv channels / shadow flags) is compiled through `compileAsync` (so it uses `KHR_parallel_shader_compile` readiness) and every texture is uploaded with `initTexture`, at most `budgetMs` per frame; the promise resolves when the programs are READY (linked), not merely submitted.
- `warmRender(renderer, scene, camera, { makeTarget })`: one real draw into a tiny target with frustum culling off, restoring everything: uploads every geometry and compiles the shadow-depth programs, which `compile()` cannot reach. Run it behind the loading screen.
- `programCensus(renderer \| programs)` -> `{ total, byName, groups: [{ name, count, varying: [{ label, distinct, values }] }], nearDuplicates, rarelyUsed }` and `formatCensus(c)`. Reads `renderer.info.programs`; names the cache-key tokens that vary (numDirLights, mapUv, vertexColors, toneMapping ... and the feature / state bit masks). `materialCensus(scene)` is the static pre-pass: estimated program variants and shareable duplicate materials, no renderer needed.

### batch.js
| | |
|---|---|
| `mergeByMaterial(root, { frame, include, skip, minGroup, bySignature, tileSize, tileAxes, maxVertices, includeTransparent, includeHidden, disposeOriginals })` | bakes every static mesh into one per (material, shadow flags, renderOrder, layers, tile). Returns `{ before, after, groups, merged, removed, restore(), dispose() }`. Never merges skinned / instanced / morph / ShaderMaterial / `userData.noMerge` (own or ancestor) / transparent / hidden. |
| `mergeMeshes(meshes, { material, frame })`, `mergeGeometries(geos, { color })`, `bakeGeometry(mesh, matrix)` | the primitives. World matrix baked, normals recomputed when missing on lit materials, mirrored transforms get their winding flipped, uv / uv1 / uv2 / uv3 / colour kept when every source has them, a material array keeps ONE group per material index (N meshes with two materials still draw in 2 calls). Uint16 or Uint32 index chosen by size. |
| `freezeStatic(root)` / `thaw(root)` | final `updateMatrixWorld`, then `matrixAutoUpdate = matrixWorldAutoUpdate = false` on every node, bounding spheres computed. (three 0.187 still visits frozen nodes in `updateMatrixWorld`: the saving is the matrix math; fewer nodes is the bigger one.) |
| `tileInstances(parent, geo, mat, items, at, place, opts)` | Autowala `render/chunks.js` `chunkedInstances`, same signature, plus `freeze`. One culled `InstancedMesh` per map tile. |
| `tileMeshes(root, size)`, `groupByTile` | already-built meshes, merged per (material, tile) so culling still works |
| `instancesFromMeshes(root, { minCount, tileSize })`, `createInstances(geo, mat, matrices, { colors, dynamic })` | meshes sharing geometry + material -> `InstancedMesh` |
| `disposeTree(root, { keep, textures, detach })` | frees each geometry / material / texture once, skips `userData.shared`, handles material arrays, InstancedMesh, ShaderMaterial uniform textures, shadow maps; returns counts |

### adaptive.js
`createAdaptiveQuality({ game, tiers, pref, viewport, gpu \| gl \| renderer, calibration, callBudgets, scaleMin, targetFps, tierCost, governor: {...}, onScale, onTier, onStable })` -> `{ gpu, vp, memory, saved, initial, governor, describe(), forget() }`; `runStandaloneCalibration({ width, height, dpr, gpu, tiers })` (throw-away WebGL context, so it can run BEFORE the game's renderer exists); `watchDeviceHints(governor)` (data saver, battery <= 20 % and not charging -> 30 fps cap) and `readDeviceHints()`, `readBattery()`.
An explicit player tier locks the governor to scale-only changes and is never written to tier memory.

## 4. Integration, game by game

The lead integrates after merge. None of this was done inside `src/games/**` or `shared/tiffin-centre/**`.

### 4.1 Tiffin Centre

Where the pieces live today: `scene/capabilities.js` (probe + `chooseTier` / `resolveTier` / `getGfxPref`), `scene/quality.js` (tier table `QUALITY`, `createScaler`, `createQualitySampler`, `createDrawCallGuard`, `DRAW_CALL_BUDGET`, `frameBudgetFor`), `scene/renderer.js` (`createRenderer`: `build()`, `setScale()`, `setQuality()`, `shouldRender()`, `render()` with the sampler), `scene/post.js` (`createPost`), `scene/index.js` (`buildScene`: tier choice at the top, `frame()` / `tick()` loop, visibility, `gfx.resize`).

1. **Start tier** (`scene/index.js` `buildScene`, the lines that call `probeBrowser()` / `resolveTier(getGfxPref(), caps)`): keep `probeBrowser()` + `chooseTier` only as the *capability gate* (`tier: null` = no WebGL2). Then call `createAdaptiveQuality({ game: 'tiffin-centre', tiers: QUALITY_ORDER, pref: getGfxPref(), viewport, calibration, callBudgets: DRAW_CALL_BUDGET, scaleMin: per-tier QUALITY[t].scaleMin, onScale, onTier })` and use `aq.initial.tier / .scale` instead of `verdict.tier`. Run `runStandaloneCalibration` before `buildScene` creates the renderer (the loading screen is up anyway), with Tiffin's real tier models (`TIFFIN_TIER_MODELS`, see 6.1) when `shouldCalibrate(...)` says so.
2. **Replace the three ad-hoc controllers** in `scene/renderer.js`: delete `createScaler` / `createDrawCallGuard` use and the `warmUp` counter; `render(dt)` just calls `renderer.render` / `post.render`. The governor lives in `scene/index.js` and is fed by the loop (step 3). `setQuality(next)` stays (rebuild); `setScale(s)` becomes `dyn.setScale(s)` (step 5), with **no** `build()` call. Keep `quality.js` exports until their tests are migrated; stop importing them in `renderer.js`.
3. **Loop** (`scene/index.js` `frame()` / `tick()` / `onVisibility`): `createLoop({ render: (a, dt) => ..., governor: aq.governor, info: gfx.renderer.info })` replaces the hand-written rAF, `gfx.shouldRender(nowMs)` (the lite 30 fps cap becomes `loop.setMaxFps(QUALITY[q].fpsCap)`, and `governor.fpsCap` for battery), the visibility handler and `gfx.holdAdaptation(...)` (`loop` does the discontinuity; call `aq.governor.hold(2500)` after the start-up load and after `setQuality`).
4. **Per tier change** `onTier(tier, info)` -> `gfx.setQuality(tier, info.reason)` then `dyn.setScale(info.scale)`; call `aq.governor.hold(cfg.tierWarmupMs)`. The Graphics setting -> `aq.governor.setTier(v, { scale: 1, lock: v !== 'auto' })` and `aq.forget()`.
5. **Dynamic resolution** (`scene/post.js`): see 5.1.
6. **Warm-up**: replace the manual `warmShaders()` in `frame()` with `warmShaders(gfx.renderer, scene, camera, { budgetMs: 4, onProgress })` during the loading steps and `warmRender(...)` once; dev: `console.log(formatCensus(programCensus(gfx.renderer)))`.
7. **Batching**: tf-cpu's `models/merge.js` `mergeStatic` is the probe-based variant (it measures what moves). `batch.js` is the general one; use it for scenery that is static by construction (street buildings, props) and keep `mergeStatic` for customers. `freezeStatic(street.root)` after the build.
8. **Persist**: nothing to do, `aq.governor`'s `onStable` writes tier memory.

### 4.2 Autowala

Where: `render/renderer.js` (`pickQuality`, `createRenderer`: `build()` with `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`, the step-down-only sampler), `render/chunks.js` (`chunkedInstances`), `render/dispose.js` (`disposeTree`), `game/config.js` (`QUALITY`), `game/Game.js` (`gameSteps`: `createRenderer(canvas, { quality: pickQuality(...) })`, the `frame()` loop, `resize`).

1. **Start tier** (`render/renderer.js` `pickQuality`, and `Game.js` `createRenderer(canvas, { quality: pickQuality(...) })`): `pickQuality` (cores >= 8 && memory >= 8 => high) is the wrong guess on an integrated GPU. Replace it with `createAdaptiveQuality({ game: 'autowala', tiers: ['low', 'medium', 'high'], pref: profile.data.settings.quality || 'auto', ... })` and build the renderer with `aq.initial`. `isSoftwareRenderer` becomes `gpu.class === 'software'`.
2. **Sampler** (`render/renderer.js` `sample()`): delete it; it only ever steps down and every `build()` re-creates the composer. The governor steps scale AND tier, up and down.
3. **Loop** (`Game.js` `frame()`): `createLoop({ update: simulate, render: (a, rawDt) => ..., governor: aq.governor, info: gfx.renderer.info, onResize })`; `resize` -> `loop`'s debounced `onResize`; tab hidden / shown is handled by the loop (keep the audio suspend / resume).
4. **Dynamic resolution**: Autowala's `EffectComposer` cannot render into a sub-rect (each pass samples the whole texture), so it is replaced by a 3-stage chain, see 5.2.
5. **Instancing / batching** (`render/chunks.js`): `chunkedInstances` -> `tileInstances` (same arguments; also freezes). Freeze static world meshes with `freezeStatic(world.root)`; merge static props with `mergeByMaterial(world.root, { tileSize: 128 })`, which keeps the culling that `chunks.js` was written for.
6. **Dispose** (`render/dispose.js`): `disposeTree` there is the same idea; `batch.js` `disposeTree` adds `keep`, `userData.shared`, uniform textures, shadow maps and counts.
7. **Warm-up**: `warmShaders` + `warmRender` in the boot stages (162 programs today), `programCensus` to find why.

## 5. Dynamic resolution, precisely

### The idea
Allocate every post target ONCE at its maximum size. To render at scale `s`, render into the `s x s` sub-rect of each target (`target.viewport` / `target.scissor`, which three reads in `setRenderTarget`: free). Every shader thinks it works on a virtual `used`-sized target; the only change is that texture fetches go through `dynUv(uv)`:

```glsl
// DYNRES_GLSL (prepended for you by createDynPass / rewriteSamples)
uniform vec2 uDynScale;   // used / allocated
uniform vec2 uDynHalf;    // half a USED texel
vec2 dynUv(vec2 uv) { return clamp(uv, uDynHalf, vec2(1.0) - uDynHalf) * uDynScale; }
```
`texture2D(tColor, vUv)` becomes `texture2D(tColor, dynUv(vUv))`, a blur tap `vUv + o` becomes `dynUv(vUv + o)` with `o` computed from the USED size (`1 / dyn.sizeOf(rt).w`). The clamp keeps taps inside the used area (a stale / garbage texel can never bleed in: the browser harness paints the whole target magenta first and checks the blue channel stays 0). `gl_FragCoord` runs `0..used` inside a target, so grain / dither hashes are unchanged. The camera is untouched (the sub-rect has the same aspect to within 1 px).

```js
const dyn = createDynamicRes({ scale: aq.initial.scale });
// once, at the tier's max size:  sceneRT = new WebGLRenderTarget(maxW, maxH, { type: HalfFloatType, samples: 4, depthBuffer: true, depthTexture })
// every frame:
dyn.apply(sceneRT);                     renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
dyn.apply(bloomA);  ...                 // each target of the chain, same scale
pass.render(renderer, null, dyn);       // the last pass: canvas, full viewport, linear upsample of the used sub-rect
// when the governor says so:           dyn.setScale(s)   // nothing is reallocated
```

Notes: MSAA targets resolve the WHOLE target (three blits `width x height`): bandwidth, not shading, so it is cheap relative to the saving. A depth texture sampled by AO / DOF goes through `dynUv` too. FXAA: `rewriteSamples(FXAAShader.fragmentShader, ['tex2D'])` (its one fetch point is `Sample(tex2D, uv)`) and set `resolution` to `1 / usedSize`. Tiers that render DIRECTLY to the canvas (no post) can keep `setPixelRatio` steps at a low rate, or render into one RGBA8 target + `createBlit(dyn)` below scale 1 (and straight to the canvas at 1).

### 5.1 Tiffin `scene/post.js`
1. `build(cfg, w, h, pixelRatio)`: allocate with `pixelRatio = min(cfg.pixelRatio, dpr)` and NO scale factor; call it only on a tier change / window resize, never from `setScale`.
2. `run(m, target, clear)`: add `if (target) dyn.apply(target); else full canvas viewport` before `quad.render(renderer)`; `render()` applies `dyn.apply(sceneRT)` before the scene draw.
3. Shaders: wrap fetches: `LINEARIZE`/`AO_FRAG`/`AO_BLUR_FRAG`/`DOF_FRAG` (`tDepth`, `tColor`, `tAO`), `BLOOM_*` (`tColor`), `FINAL_FRAG` (`tColor`, `tBloom`, `tAO`) via `rewriteSamples(src, [...])` at module load; add `...dyn.uniforms` to each material's `uniforms`.
4. Texel uniforms from the used size: `U.pre.uInv`, `U.down.uInv`, `U.up.uInv` (per pyramid level: `dyn.sizeOf(pyramid[i])`), `U.dof.uInv`, `U.aoU.uInv`, `U.aoBlur.uDir`, `fxU.resolution`, `U.fin.uRes`, `U.fin.uAspect` are set from `target.width / height` in `build()` today: move them to a `syncSizes()` called after `dyn.setScale` / `apply`.
5. `renderer.js` `setScale(s)` -> `dyn.setScale(s); post.syncSizes()`; remove the `build()` call and its `setPixelRatio` / `setSize` cost (the `setSize` that was 6 % of steady-state CPU).
6. The no-post tiers (lite / low) render straight to the canvas: leave them on `setPixelRatio` (rare changes) or use `createBlit`.

### 5.2 Autowala: replacing `EffectComposer`
Today: `RenderPass` -> `UnrealBloomPass(0.3, 0.42, 1.05)` -> `OutputPass` (ACES, exposure 0.95, sRGB). Replacement, all sub-rect aware:

```js
const sceneRT = new WebGLRenderTarget(maxW, maxH, { type: HalfFloatType, samples: q === 'low' ? 0 : 4, depthBuffer: true });
const pyr = [0.5, 0.25, 0.125].map((f) => new WebGLRenderTarget(maxW * f | 0, maxH * f | 0, { type: HalfFloatType, depthBuffer: false }));   // allocated once
const bright = createDynPass({ dyn, uniforms: {...}, fragment: BLOOM_PRE });     // threshold 1.05 + 2x2 box
const down   = createDynPass({ dyn, uniforms: {...}, fragment: BLOOM_DOWN });
const up     = createDynPass({ dyn, uniforms: {...}, fragment: BLOOM_UP, blending: AdditiveBlending, extra: { transparent: true } });
const out    = createDynPass({ dyn, uniforms: { tScene, tBloom, uExposure, uBloom }, fragment: COMPOSITE });  // add bloom, ACES, sRGB -> canvas
// frame:
dyn.apply(sceneRT); renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
bright.render(renderer, pyr[0], dyn); down.render(renderer, pyr[1], dyn); ... up.render(renderer, pyr[0], dyn, { clear: false });
out.render(renderer, null, dyn);
```
`BLOOM_PRE / DOWN / UP` are the dual-Kawase shaders already in Tiffin `post.js` (production-tested); copy them into an Autowala-owned file (do not import across games). `setBloom(strength)` -> `uBloom`. Tone mapping stays in the composite pass (`renderer.toneMapping = NoToneMapping` while post is on, as Tiffin does). The `low` tier (no bloom, no MSAA) keeps a direct render.

## 6. Tuning guide

### 6.1 Calibration models: the one thing a game must supply
`calibrate.js` is only as good as the tier table it is given. Give it your real per-tier cost (measured with `bench.mjs` or `renderer.info`): `layers` ~ shaded overdraw (3-4 for a lit scene with a shadow pass), `calls` = `renderer.info.render.calls` x a complexity factor (lit + shadowed materials cost ~2x a MeshBasicMaterial draw), `mtris` = `renderer.info.render.triangles / 1e6`, `post` = number of full-screen passes at full resolution equivalent (a bloom pyramid is ~1-1.5), `pixelRatio` = the tier's. Validate: `createCalibration(...).run()` then compare `result.recommended.estimates[tier].ms` with the measured frame time of that tier on the same machine: they should be within ~30 %. Fix the model, not the benchmark.

Suggested STARTING models, derived from the playbook's measured draw calls and the tier tables (unvalidated against `estimates`: adjust `layers` first):

| game / tier | pixelRatio | layers | calls (simple-call equiv.) | mtris | post | scaleMin |
|---|---|---|---|---|---|---|
| Tiffin lite | 1 | 1.5 | 190 | 0.10 | 0 | 0.6 |
| Tiffin low | 1 | 2.5 | 240 (159 measured x 1.5) | 0.15 | 0 | 0.5 |
| Tiffin medium | 1.25 | 3.5 | 700 (324 x 2.2: lit, shadowed) | 0.30 | 3 (HDR + bloom pyramid + FXAA) | 0.5 |
| Tiffin high | 1.75 | 5 | 1000 (439 x 2.3) | 0.40 | 7 (MSAA 4 + AO + DOF + bloom) | 0.5 |
| Autowala low | 1 | 2.5 | 450 | 0.25 | 0 | 0.5 |
| Autowala medium | 1.25 | 3.5 | 800 | 0.35 | 2 (MSAA + bloom) | 0.5 |
| Autowala high | 1.75 | 4.5 | 1000 | 0.45 | 2.5 | 0.5 |

Pass them as an object keyed by tier id (`tiers: { lite: {...}, ... }`).

### 6.2 Governor knobs (`governor.js`)
- **It never reaches 1.0 on a machine that should**: raise `upRatio` slightly, lower `upHoldMs`, or check `stats().probeFailures` (a rung that failed twice is frozen until `notifyLoadChange()` or 2 minutes of calm). Call `notifyLoadChange()` when the scene changes (a new area, night, a crowd).
- **It steps down too eagerly**: `downRatio` (1.15) and `downWindows` (2 windows of 400 ms) are the debounce; a one-off hitch never counts (frames over `max(3.5 x median, 80 ms)` are excluded, `dt > 250 ms` is a discontinuity).
- **It blurs a CPU-bound game**: pass `cpuMs` (the loop does) so it steps the TIER; without it the "no gain" detector needs two scale steps (~3 s) to conclude the same.
- **A 120 / 144 Hz display**: the budget is `1 / min(refresh, targetFps)`, so a 144 Hz panel does not demand 6.9 ms of a game designed for 60. Pass `targetFps: 120` to chase it. Tier up needs real headroom: use `gpuTimer`.
- **Battery / data saver**: `watchDeviceHints(gov)` caps at 30 fps (`loop.setMaxFps(gov.fpsCap)`).
- **Scale floor per tier** (`scaleMin`): below ~0.6 the image is visibly soft; prefer letting the tier drop.

### 6.3 Memory
A remembered tier is trusted over the benchmark. If a release changes the cost of a tier a lot, bump the game's key (`createTierMemory({ game: 'tiffin-centre-v2' })`) or call `aq.forget()`.

## 7. Governor behaviour in detail (what the tests prove)
Closed-loop tests (`governor.test.js`) simulate a game whose cost depends on the governor's own decisions, with vsync quantisation:
- a steady overload converges to the right rung in < 3 s, then makes at most two bounded, immediately-reverted probes, then re-probes at most once per ~2 minutes (7 simulated minutes checked);
- a load that fits never changes anything (60 s); a noisy load inside the dead band is left alone;
- load drops -> it climbs back to 1.0 (vsync-pinned: via probes, ~5 s per rung; with headroom visible: 2.5 s per rung); rungs that failed before are forgiven automatically when the load at that rung falls to 75 %;
- on a display faster than the budget (144 Hz panel, 60 fps target) "fits" is judged on whole refresh intervals (14.3 ms of work lands on 20.8 ms, not 14.3), the case that made two ups fail on the real GPU;
- one-off stalls, start-up shader compiles and tab switches change nothing;
- CPU-bound (cpuMs, or no gain from two scale steps): tier steps down within 3 s and the scale is restored to 1;
- draw calls over the tier budget while missing the frame budget: tier down in ~2 s; a fast machine with many calls but a held frame rate is never punished;
- tier up: only with observable headroom (a GPU timer), only after 20 s, never above `maxTier`, a failed tier up is reverted at once, reported and never retried.

## 8. "Diagnosing a heavy scene" checklist
1. **Which resource?** `bench.mjs --profile`: `(program)` high = driver / GPU wait; `uniformMatrix4fv`, `bindTexture`, `useProgram` high = per-draw-call overhead (CPU bound). Render at 1/4 area (`dyn.setScale(0.5)`): fps up a lot = fill bound; unchanged = CPU / draw-call bound. `createGpuTimer` gives the GPU ms directly where supported.
2. **Count things.** `renderer.info.render.calls / triangles`, `info.memory.geometries / textures`, `info.programs.length`. Budget: ~300 calls and ~300k triangles on integrated GPUs.
3. **Why so many programs?** `console.log(formatCensus(programCensus(renderer)))`: the `varying` list names the tokens that split programs (light counts per mesh, uv channels, vertex colours, tone mapping, defines); `nearDuplicates` are candidates to unify (give every lit material the same light setup, same uv channel, avoid per-material `onBeforeCompile` differences, set `customProgramCacheKey` only when really different). `materialCensus(scene)` before anything renders: `shareableCount` = distinct-but-identical materials to share.
4. **Why so many draw calls?** `mergeByMaterial(root, { tileSize })` on what never moves; `instancesFromMeshes` / `tileInstances` for repeats; `freezeStatic`; share materials (identical values = one object); merge small textures into atlases.
5. **Stalls rather than low fps?** `loop.ring.over(50)` and `governor.stats().counts.hitches`: first-use costs (`warmShaders`, `warmRender`), geometry / texture uploads (`initTexture`), GC (look for per-frame allocation: `new Vector3`, array literals, closures in the loop), a synchronous `setSize` / `new WebGLRenderTarget` per scale step (use `dynamicRes`).
6. **Fill bound?** Lower `pixelRatio` of the tier, drop MSAA for FXAA, half-resolution post (AO, bloom), fewer transparent layers, tighter shadow frustum / smaller map, `scaleMin`. Check `renderer.shadowMap.autoUpdate` / update only when lights moved.
7. **Memory growth?** `disposeTree` on everything you drop (it reports counts), `info.memory` flat over 5 minutes, targets allocated once.
8. **Is it the machine?** `describeGpu(gpu)`; an integrated GPU should land on `medium` at scale >= 0.9 (`aq.describe()`); check `result.units` from calibration against the tier model.

## 9. Verification status
Unit tests: `npx vitest run src/platform/gfx` (PowerShell): 455 tests. Real-GPU checks (throwaway harness on the dev laptop's integrated AMD Radeon, 144 Hz): see `docs/perf/gfx-core.md` for the GPU class (integrated, cap medium), the calibration (225-244 ms, `medium` at scale 1, repeatable), the frame-time trace during calibration (one ~28 ms first-draw stall), the dynamic-resolution correctness (error <= 0.002, no bleed) and cost (0.25-0.43 ms per scale step vs 2.2-2.6 ms for `setSize`), and the governor on a synthetic fill-bound load (converges in 1.65 s, recovers to 1.0 within 4 s of the load dropping).
