# tf-int: Tiffin Centre on the shared engine layer (wave 2)

Branch `perf/tf-int`, cut from main `0a90f3b`. Machine: the dev laptop's integrated AMD Radeon (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), Chrome headless on
the real GPU, production build, 1536x864 @ 1.25 (a 1920x1080 drawing buffer), vsync and the frame cap off in the bench, level 0 ("Training morning", 7:00 to 9:00) unless a row says
otherwise.

**TBD-HEADLINE**

## 0. How to read the numbers

The machine was saturated the whole time: 60 node and 30 Chrome processes were alive, the CPU read 100 % for hours (`lockrun` waited 90 s for a quiet moment before every job and
never got one), and the bench lock only serialises benchmarks, not the other streams' test runs and builds. The same build measured minutes apart moves 20 to 40 percent
(`day, scale 0.85, GPU median` of one build, four probes: 15.6, 17.7, 14.2, 19.0 ms), and one quieter stretch (about 08:05) showed the **same medium frame at 75 fps** where the
saturated hours showed 40. So:

* every comparison that matters is **inside one page load** (`scripts/perf/tf-probe.mjs` runs a script in the live game: scale series, toggles, interleaved A/B pairs: same GPU
  clocks, same load), and every before / after of two builds is run back to back under ONE bench-lock hold, interleaved (base, new, base, new);
* GPU numbers are medians of `EXT_disjoint_timer_query_webgl2` over whole frames or single passes; CPU numbers are `performance.now()` brackets and V8 profiles; counts (GL calls,
  draw calls, programs) are exact and do not depend on load;
* **absolute frame rates in this report are contention figures.** They cannot tell whether 60 fps is reached on an idle laptop; the lead has to re-run
  `node scripts/perf/bench.mjs --game tiffin` on a quiet machine (the probe at the quiet stretch says it is, at scale 0.85 with the HUD hidden). I do not claim an unmeasured win.

## 1. What the frame is made of (measured before changing anything of the pipeline)

Medium, 1536x864 @ 1.25, day, HUD hidden, one page, adaptation held, GPU timer medians (ms):

| render scale | scene pass | bloom pre | final composite | FXAA | sum of passes |
|---|---|---|---|---|---|
| 1.0 | 17.3 | 0.59 | 1.98 | 2.41 | 22.4 |
| 0.85 | 14.4 | 0.46 | 1.63 | 2.11 | 18.7 |
| 0.7 | 11.8 | 0.36 | 1.30 | 2.38 | 15.9 |
| 0.5 | 9.3 | 0.28 | 0.82 | 2.42 | 12.9 |

* The scene pass is about **6.7 ms that does not move with the resolution (the draw path) plus 5.1 ms per megapixel**. FXAA is flat because it runs at canvas size.
* Hiding groups of the scene in the same page (GPU ms, HUD hidden): the whole frame 16.7 to 17.7; without the stall (63 fewer draws) 14.0; without the street (84 fewer) 14.4; with
  nothing but the sky 3.9; with nothing at all 2.6. About **0.04 ms per draw call**, and the post chain at 0.85 is 3 to 4 ms.
* **GL calls per frame (every `WebGL2RenderingContext` method counted): about 2000 at medium** (`uniform3f` 550, `bindTexture` 244, `uniformMatrix4fv` 235, `activeTexture` 216,
  `bindVertexArray` 162, `drawElements` 122, `uniform1f` 77, `useProgram` 60). The V8 profile of the base build puts **71 % of the main thread in three of them**: `uniform3f` 35.5 %,
  `uniformMatrix4fv` 20.9 %, `(program)` 14.4 %. Those natives do not cost 12 to 18 us each by themselves: the renderer's thread waits for room in the command buffer while the GPU
  *process* decodes and translates the previous frame (ANGLE / D3D11), so the time lands on the most frequent calls. **The fixed part of the frame is GL command volume, and the lever on
  it is draws, materials and programs (tf-prog), not pixels.** One 144 Hz-class check: at scale 0.5 the same scene is still 11.9 ms.
* The HUD costs about 2 ms a frame (visible vs `display: none` in the same page: 41.3 vs 46.5 fps and 44.9 vs 49.3 fps, two repeats).
* The GPU timer's `getParameter(GPU_DISJOINT_EXT)` is a synchronous round trip in Chrome; polled every frame it removes the renderer's lead over the GPU. (Measured: not a
  large cost here, 0 to 1 ms in six paired rows, but it is a stall by construction.) The shared timer now reads that flag at most every 500 ms (`disjointMs`).

## 2. What changed, step by step: what paid and what did not

### 2.1 Dynamic resolution without re-allocation (paid, big)

`post.js` allocates every target once at the tier's full size (`min(tier ratio, device ratio)` x css size) and renders into the `s x s` sub-rect of each (viewport + scissor);
every fetch from a target goes through the gfx `dynUv()` (hand-written into the AO / DoF / FXAA shaders, `rewriteSamples` for the bloom and the final), the texel sizes are computed from
the USED size, and the last pass (FXAA, or the final composite on high) draws on the canvas at full size and upsamples. `renderer.setScale(s)` is `dyn.setScale(s)` plus the point
sprite fix; `post.build()` skips an identical rebuild (it used to rebuild every target at every `resize()`, including the second one of the load).

Same page, 48 consecutive steps through the ladder (`scripts/perf/tf-probe.mjs`, `exp-n`), HUD visible, `setScale` call time and what the next three frames pay:

| | median | p90 | max | long tasks during the 48 steps | canvas | targets / programs |
|---|---|---|---|---|---|---|
| main (`setPixelRatio` + `setSize` + every target re-created) | **112 ms** | 195 ms | 769 ms | 48 (51 to 810 ms) | re-allocated every step (1920x1080 -> 1824x1026) | re-created |
| this branch | **0.4 ms** | 1.3 ms | 7.3 ms | 5 (54 to 75 ms, not from the steps) | untouched | same objects, 104 programs before and after, geometries / textures unchanged |

Particle sizes stay right: `applyPointScale` multiplies every `PointsMaterial.size` by the scale (original kept in `userData.tcBaseSize`, new materials caught by a 1 s scan), the steam
shader's pixel factor reads `renderer.tcViewScale`, `fx.update` gets `canvas ratio x scale`. The css canvas size never changes. The direct tiers (lite, low) have no post pipeline: a step
would re-size the canvas, which the trace showed as 100 to 700 ms of blank frames each, so **lite and low hold their pixel ratio and only the tier moves** (`SCALE_MIN` 1).

### 2.2 The shared governor replaces three ad-hoc controllers (paid: no flapping, no recompile, hitch-free steps)

`createScaler`, `createQualitySampler`, `createDrawCallGuard`, tf-gpu's CPU-bound revert and the `warmUp` counters are gone from `renderer.js`; their tests went with them (the closed-loop
behaviour is covered by the governor's own suite and by `adapt.test.js`, below). `index.js` wires `createAdaptiveQuality` (GPU class from the capability probe that already ran, tier
memory, start-up calibration) + `createLoop` (rAF, the tier's frame cap, hidden tab, no catch-up step) + `createGpuTimer`, and `watchDeviceHints` (battery / data saver: 30 fps).
`scene.debug.gfx` keeps `quality`, `scale`, `pixelRatio`, `renderer` (the bench reads them) and `holdAdaptation`, `setScale`; `getTierInfo()` keeps its shape (+ `gfx`, `governor`), so
the Graphics setting, "Apply now" and the "picked X but running Y" label are unchanged.

What the real-GPU runs found, and what was done about it (each one reproduced on the real GPU, not in a unit test):
* **`switchTier is not defined`** at the first tier change (a block-scoped const reached from the governor's callback): found by the bench, fixed, now `switchTierFn`.
* **The calibration under load.** A run whose tests could not finish returns pessimistic sentinels (25 ns / pixel, 60 us / call, `confident: false`); read as a verdict it started the dev
  laptop on `low` (and tier memory would have kept it there for 30 days). `usableCalibration()` ignores any incomplete or non-confident run (the GPU class decides, the governor
  corrects); the units of a good run are bounded (1.6x calls, 3x pixels vs the reference) and go through Tiffin's own cost table; a rung must hold 30 s before it is remembered.
* **The shared estimate cannot say "fixed cost plus pixel cost".** `estimateFrameMs` is `max(cpu, gpu)`; Tiffin's frame is 10 ms of draw path plus 4 ms per megapixel (section 1). The tier
  cost model is `TIER_REF` (fixed ms + ms per Mpx per tier, measured on the dev laptop) scaled by the calibration's two units: `estimateTierMs` / `recommendStart`, unit-tested
  (a post tier at its floor beats the plain tier at full resolution; a fast machine starts at full resolution; never above the GPU class cap). `TIER_COST` (tier-up prediction) from the
  same table. The generic starting tables of `GFX_ENGINE.md` 6.1 estimated medium at 9.5 ms where the measured frame is 18 ms at scale 1.
* **A CPU-bound tier pumped the resolution.** On a locked tier (an explicit Graphics choice) a scale step that buys nothing was undone and retried every 3 s (1.0 -> 0.6 -> 1.0, seen in the
  first 25 s of play). `governor.js` got two options (gfx-core's file, 2 small edits, 3 new closed-loop tests): `futileMs` (after a futile step with no tier to give, scale steps pause 60 s,
  doubling) and `tierDownRatio` (a tier step needs a clearly slow frame: Tiffin 1.6 = about 37 fps, so a CPU-bound 40 fps medium keeps bloom, shadows and lights).
* **The post-load warm-up looks like a slow device.** For about 12 s after the reveal the shader warm-up builds one dish per frame; the governor sank to 0.6 at once. Frames are not
  judged while that warm-up (or a tier switch) runs, plus 1.5 s after.
* **The GPU timer's disjoint flag** is a synchronous round trip; polled every frame it removes the renderer's lead over the GPU. `createGpuTimer(gl, { disjointMs: 500 })`.
* One throw-away WebGL context fewer at load (`classifyGpu` from the probe's renderer string and caps instead of a second `probeGpu()`).

### 2.3 A tier change no longer recompiles everything on the first draw (paid)

A tier is a different set of programs (tone mapping, output colour space, shadows and the light set are in the program key). The old `setQuality` marked every material dirty and the first
frame compiled them all (tf-cpu saw a 19 s task under load). Now `switchTier` sets the new state at once with the canvas size (and so the last picture) deferred, compiles every program
through the load's own warm-up (whole top-level groups, `KHR_parallel_shader_compile`) plus `post.prelink()` for the post passes, polls readiness, primes the programs in 25 ms slices, then
commits the canvas size and draws the first frame of the new tier. The game keeps running and the picture holds. Measured on the saturated machine (one page, forced switches):

| switch | wall time | new programs | long tasks | frames over 50 ms |
|---|---|---|---|---|
| medium -> lite | 4.2 s | 2 | none | 0 of 2001 |
| low -> medium, first time | 9.4 s (compiles queue on a saturated CPU) | 93 | 2 (131, 128 ms) | 11 of 1362 (the first draw: shadow-depth programs, up to 1.5 s) |
| lite -> medium, second time | 0.08 s | 0 (cached) | none | 0 of 79 |

The first switch to a heavier tier is still a long held picture on a saturated machine; the way back (and any switch between tiers already visited) is instant. The governor prefers scale to
tier (floors 0.6 on the post tiers, was 0.7, with 0.05 rungs now that a step is free) and `tierDownRatio` keeps a medium that merely runs at 40 fps.

### 2.4 Night lights: a pool of K proxy lights (paid a little, by day and night)

three.js bakes the number of point lights into every lit shader and re-uploads their uniforms on every program change. The stall had 11: 2 bulbs, the tube, the street lamp (structural) and
8 small ones that are mostly dark (4 station flames, 2 candles, the prep lamp). `light-pool.js` moves every point light with a range of 6 m or less to a layer no camera renders (so
three neither counts nor uploads it) and lets K = 3 proxy lights stand in for the strongest, nearest ones, fading a handover over 0.18 s; the shader has 7 lights, not 11, and no game
file is touched (pooled before anything compiles; refreshed when the stall rebuilds stations / spots / the menu and every 1.5 s). Visual check at 22:00: same picture (flames under the
pan, bulbs, drums), see the screenshots. Interleaved in one page (k = 0 / 3 alternating, 3 pairs per hour, programs of both sets cached):

| | GPU median | main thread (render) | fps |
|---|---|---|---|
| 08:00, 11 lights | 18.7, 16.6, 16.5 | 18.5, 16.0, 15.6 | 67.5, 75.6, 75.8 |
| 08:00, pool (7) | 17.0, 16.1, 15.8 | 16.4, 15.0, 14.8 | 74.0, 78.2, 78.8 |
| 22:00, 11 lights | 16.3, 17.6, 17.0 | 15.3, 17.7, 16.5 | 79.0, 72.2, 75.2 |
| 22:00, pool (7) | 16.2, 16.1, 17.3 | 15.8, 15.0, 17.0 | 77.2, 79.4, 72.6 |

Day: about -1.0 ms GPU, -1.2 ms CPU, +5 % fps (3 of 3 pairs). Night: about -0.2 ms, within the noise. The census shows why it is small: `uniform3f` calls per frame 550 -> 454 (the total
2004 -> 1930). I expected more from the base profile (35 % of the main thread in `uniform3f`) and it is not what the call count says: the cost sits in command volume and in the GPU process
(section 1), not in the lights alone. **Cheaper night lights beyond this (a diffuse-only street lamp, dropping the bulbs' specular) were not done**: they change the look, the lamp's
range is the cost at night (4 to 5 ms between 13:00 and 22:00 in the same page), and the next lever is fewer draws and programs, not fewer lights.

### 2.5 The post chain (paid: R11G11B10F; the rest measured and left)

* **R11G11B10F scene target on medium** (`QUALITY.medium.hdr = 'r11'`, 4 bytes a pixel instead of RGBA16F's 8): 6 interleaved pairs in one page, scene pass -1.0 ms by day and -1.4 ms at
  night, bloom's first pass 0.55 -> 0.26 ms, sum of passes -0.85 / -1.6 ms. The final and FXAA passes read 0.2 to 0.4 ms higher in the same rows (the pass after a pair is always a
  little hotter), so the net is the sum. No alpha, 6-bit mantissa: the film grain hides it; compared at 13:00, 19:30, 22:00 and in the rain. High keeps RGBA16F (MSAA path untested with it).
* **FXAA costs 2.1 to 2.4 ms and does not shrink with the scale** (it runs at canvas size and upsamples the used sub-rect). FXAA at the used size plus a blit would cost 1.2 + 0.35 ms at 0.7 and
  no less than today at 0.85, so it was not built. Grain applied before FXAA costs 0.35 ms at night only (FXAA 2.3 -> 2.0 with it off; no difference by day): not moved.
* **`final` +0.5 ms against main at the same scale** in my first A/B was not the dynUv math: fetch variants swapped in place in one page (`textureLod` everywhere, no clamp, both; 2 scales,
  12 measurements) are all within +-0.1 ms of the original.
* Bloom is 0.5 ms; shadow pass: switching it off entirely moves the frame by -0.7 .. +0.8 ms (within noise) and it is 12 draws since tf-cpu, so its throttling policy was left (a every-2nd-frame
  update would make frames alternate for about 0.3 ms). The sky is 0.5 ms. None of them is where the frame is.
* `post.getMaterials()` returns the eight pass materials and `post.prelink(compile)` kicks the compile of every pass the current tier runs, each against the target it draws into: the
  load calls it (`index.js` `settleFirstFrame`); **tf-prog's loader can call `gfx.post.prelink(gfx.rawCompile)` too** (`rawCompile` is the renderer's own compile without the "bind the HDR target" wrapper).

### 2.6 What the frame still is, and the next lever (not mine)

The default tier's frame is **GL command volume**: about 2000 calls, 163 to 175 draws at 0.04 ms each, 60 program switches, 550 `uniform3f` (per-material colours: diffuse, emissive, specular,
sheen... of MeshPhysicalMaterial) and 244 `bindTexture`. In one page: hide the stall (63 draws) -2.8 ms, hide the street (84 draws) -2.3 ms. The program census (`scene.debug.census(true)`):
104 programs = MeshStandardMaterial x35, MeshPhysicalMaterial x30, MeshBasicMaterial x18, ShaderMaterial x7..., 50 used per frame, 60 near-duplicate pairs (differing by 1 to 2 tokens: the
`onBeforeCompile` skin / hair / tint-mask variants, vertex-colour and instancing masks). tf-prog's levers, in order: merge / instance the remaining 47 station meshes and the street's props,
unify materials so fewer programs are used per frame, turn MeshPhysicalMaterial without clearcoat / sheen / transmission into MeshStandardMaterial (fewer per-material uniforms), and keep customers
(86 calls each) behind an instanced path. Each program switch also re-uploads the lights, shadow and camera uniforms.

## 3. Before / after

**TBD-BENCH**

## 4. Screenshots (`docs/perf/tf-int/`)

**TBD-SHOTS**

## 5. Tests

`npx vitest run src/games/tiffin-centre shared/tiffin-centre src/platform/gfx` (PowerShell): **TBD-COUNT**. `npx vite build` passes. New and changed, each pure piece with its test next to it:

* `scene/post.dyn.test.js` (new): every fetch from a render target in every post fragment goes through `dynUv` (regex over the shipped GLSL); targets allocated once, an identical `build()`
  skipped, a changed size or pipeline rebuilt; at scales 1 / 0.85 / 0.5 the scene, bloom, composite and FXAA passes get the right viewport / scissor and the used sizes, nothing is
  re-created by a step; texel uniforms follow the used size; all eight materials share ONE set of dynUv uniforms; `prelink` compiles exactly the passes of the tier, each against its
  own target (the canvas for FXAA) and restores the bound target; `applyPointScale` (scale, original kept, no compounding, shared materials, late Points, shader points untouched).
* `scene/adapt.test.js` (new): `combineFpsCap`, `startTier`, `usableCalibration` (the dev laptop's saturated run is rejected), `createGovernorFeed` (a compile stall is kept from the governor, normal
  frames are not, a slow device is still seen, paused frames are not shown) and the real governor with Tiffin's tables (scale before tier, a fitting load changes nothing for a minute, a
  locked tier never changes, `hold()`).
* `scene/light-pool.test.js` (new): scores, slot assignment (stable, no double service, allocation-free in place), fades, the layer move, late lights, `setK(0)` restores everything.
* `scene/quality.test.js`: the draw-call budgets and the governor tables (ladder, floors, costs, models, options), `estimateTierMs` / `recommendStart` (fixed + pixel cost, bounded units,
  a post tier at its floor beats the plain tier, the class cap, confidence passed through); the sampler, scaler and draw-call-guard tests were removed WITH their code (the governor's
  suite covers the same behaviour; `createCompileHold` stays, its governor-level test moved to `adapt.test.js`); `scene.test.js` lost the sampler case with it.
* `src/platform/gfx` (gfx-core's, 2 small edits): `governor.js` options `tierDownRatio`, `futileMs` (3 closed-loop tests: a mild CPU-bound frame keeps its tier, a locked tier does not pump,
  a severe overload still moves the scale), `gpuTimer.js` option `disjointMs` (1 test: the flag is read at most that often).
* `scene/loader.test.js` "runAsync reports progress ... yields once a slice is used up" is a wall-clock test (it failed with "expected 3989 < 2000" on this saturated machine, passes when it is quiet:
  tf-ui and tf-gpu reported the same); I did not touch it.

## 6. Risks, what is unfinished, what the next lever is

**TBD-RISKS**
