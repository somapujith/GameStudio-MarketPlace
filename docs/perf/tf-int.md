# tf-int: Tiffin Centre on the shared engine layer (wave 2)

Branch `perf/tf-int`, cut from main `0a90f3b`; main at `f0f0529` (Autowala work only: nothing of Tiffin changed) was merged in at `7e0ef4a`. Machine: the dev laptop's integrated AMD Radeon (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), Chrome headless on
the real GPU, production build, 1536x864 @ 1.25 (a 1920x1080 drawing buffer), vsync and the frame cap off in the bench, level 0 ("Training morning", 7:00 to 9:00) unless a row says
otherwise.

**Headline (what is measured, what is not).**

| target | result |
|---|---|
| a render-scale step is cheap, nothing is re-allocated or recompiled | **0.4 ms median** (p90 1.3, max 7.3) against 112 ms (p90 195, max 769) on main; 104 programs and every target before and after (section 2.1) |
| one controller, no flapping | the shared gfx governor replaces `createScaler`, `createQualitySampler`, `createDrawCallGuard` and tf-gpu's revert; Tiffin's tier cost model, tier memory, a held load and tier switches; no scale / tier pumping on a locked or CPU-bound tier (2.2) |
| a tier change does not recompile everything on the first draw | held-frame switch: second visit to a tier 0.06 to 0.9 s, first visit to a heavier tier up to 9 s of held picture on this saturated machine (2.3, 7.2) |
| night lights | pool of 3 proxy lights, shader 11 to 7 lights: -1.0 ms GPU by day, about -0.2 ms at night (2.4) |
| post chain | R11G11B10F scene target on medium: scene pass -1.0 ms (day) / -1.4 ms (night); FXAA, bloom, shadow pass measured and left (2.5) |
| memory warnings, WebGL 2 probe (the coordinator's two items) | done and tested (section 6) |
| **60 fps in the default tier on the dev iGPU, p99 <= 25 ms, steady scale >= 0.85** | **NOT demonstrated.** Best same-session rows: M4, medium at 0.7, 51.5 fps, p99 33.9 ms, 0 frames over 50 ms, CPU 29 % before the job. The machine was saturated all day (section 0), so no number here can confirm or deny it. The frame's fixed part is about 2000 GL calls and 163 to 175 draws, i.e. main-thread command volume that no pixel-side change reaches: next lever is draws / programs / materials (tf-prog, 2.6, 7.4) |
| zero frames over 50 ms after the first 3 s | M4 and K8: 0 and 1; K4 3; the auto rows still show up to 62 on this loaded machine; not met everywhere |

Tests: `npx vitest run src/games/tiffin-centre shared/tiffin-centre src/platform/gfx` and `npx vite build` (section 5).

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

All rows: `node scripts/perf/bench.mjs --game tiffin` (production build, uncapped, 25 s warm-up, 12 s window, level 0, the HUD visible), Chrome on the real GPU, run back to back under one
bench-lock hold, **machine saturated** (`lockrun` read 96 to 100 % CPU before almost every job; the cpu column says where it did not). "main" is `0a90f3b` on its own server. Read section 0 first:
these are contention figures and two rows of one build, minutes apart, differ by 20 to 40 %.

**Pinned medium (the Graphics setting on Medium; the governor is free to move the scale), 1536x864 @ 1.25**

| row | build | cpu before | scale reached | fps | p50 | p95 | p99 | max | frames > 50 ms |
|---|---|---|---|---|---|---|---|---|---|
| K1 | main | 100 % | 0.7 | 43.4 | 21.5 | 33.1 | 48.5 | 118 | 5 |
| K2 | branch (before the warm-gate fix, see below) | 100 % | 1.0 (governor blind) | 29.8 | 26.0 | 88.4 | 178.7 | 368 | 46 |
| K3 | main | 35 % | 0.8 | 65.2 | 12.3 | 32.2 | 76.2 | 149 | 14 |
| K4 | branch (same) | 100 % | 0.6 | 46.1 | 21.6 | 35.0 | 48.1 | 72 | 3 |
| M3 | main | 99 % | 0.7 | 39.5 | 24.2 | 55.1 | 82.2 | 98 | 29 |
| M4 | **final** branch | 29 % | 0.7 | **51.5** | 20.1 | 32.3 | **33.9** | 47 | **0** |

**1920x1080 @ 1 and phone 844x390 @ 3, pinned medium**

| row | build | scale reached | fps | p50 | p99 | max | frames > 50 ms |
|---|---|---|---|---|---|---|---|
| K5 1080 | main | 0.7 | 34.4 | 25.4 | 152.7 | 247 | 24 |
| K6 1080 | branch | ended on `lite` (see below) | 90.3 | 10.8 | 19.3 | 52 | 1 |
| K7 phone | main | 0.7 | 57.9 | 17.6 | 32.8 | 38 | 0 |
| K8 phone | branch | 0.8 | 51.8 | 19.9 | 33.5 | 53 | 1 |

**Auto (the default: no saved choice), 1536x864 @ 1.25**

| row | build | ended on | fps | p50 | p99 | max | frames > 50 ms |
|---|---|---|---|---|---|---|---|
| I1, I3 | main | `low` at scale 1 (both) | 37.4, 33.2 | 20.1, 14.2 | 472, 513 | 1433, 995 | 10, 35 |
| M1 | main | `medium` at 0.7 | 5.5 (one 26.8 s frame inside the window) | 24.6 | 98.7 | 26849 | 5 |
| I2 | branch (v6) | `low` at scale 1 | 51.7 | 4.4 | 236.6 | 487 | 62 |
| I4 | branch (v6) | `lite` | 262.8 | 1.3 | 37.5 | 64 | 7 |
| M2 | **final** branch | `lite` | 439.8 | 1.0 | 26.0 | 97 | 12 |

What these rows do and do not say:
* **Smoothness is the clear difference, speed is not.** In the pinned rows the main build had 5, 14, 24, 29 frames over 50 ms and the branch 3, 0 and 1 (not counting K2, where the
  governor was blind, below); every scale step of main is a 112 ms median task with hitches the 48-step table of 2.1 shows, the branch's is 0.4 ms. In **auto** the main build, on this
  loaded machine, ends on `low` at full resolution with 0.5 to 1.4 s frames (its tier change recompiles everything on the first draw: M1 has a 26.8 s frame inside a 12 s window); the
  branch never has a frame over 0.5 s in the window and reaches a steady tier.
* **fps at equal conditions is not shown better, and I do not claim it.** K3 (main, a quiet moment) beat K4 / M4 (branch) on mean fps; the next quiet moment M4 beat M3. The two
  builds were never measured at the same moment on a quiet machine, which is what a fps claim needs; the same-page measurements of section 2 (GPU medians, interleaved) are what I trust.
* **K2: the governor was blind for the whole warm-up** (scale stayed 1.0 for 37 s at 33 ms a frame while the shaders warmed up: 46 frames over 50 ms). Fixed in `5c8429e`: the warm-up gate
  ends after 10 s (`warmGateMs`) whatever the warmer says. K4 / M4 and every later row include the fix.
* **K6 ended on `lite` although Medium was asked for.** The bench selects the tier by clicking the Graphics button after load; main (K5) took it, this run's 198 programs (medium's 104 + lite's)
  show the page switched tier by itself (it started on medium and dropped), which an explicit choice never does. My reading is that the click did not land and the page ran as Auto, which on
  this machine ends on `lite` (I4, M2). **I did not confirm it** (the bench logs the tier asked, not the setting the page saw); the pinned rows that did land (K2, K4, K8, M4, and the earlier
  K-series) all stayed on medium for the whole run, as an explicit choice must. If it is not the click, it is a bug in the locked-tier path of `governor.setTier` / the memory handler, which
  `adapt.test.js` ("an explicit tier is never changed by the governor") covers for the governor itself.
* **Auto drops further than main did on this machine** (`lite` where main ended `low`): under a CPU that is 100 % busy with other work, a Medium that cannot hold about 37 fps loses its tier, and `lite`
  is 2 ms a frame here. That is the governor doing its job on a machine that is not representative; the way back up is `tierUpHoldMs` (20 s of headroom) plus a held switch, and a tier is only written to
  tier memory after 30 s of holding (`stableSaveMs`). See the risks.

## 4. Screenshots (`docs/perf/tf-int/`)

Twelve JPEGs (1280 wide, q72, at most 121 KB), from `scripts/perf/tf-qa.mjs`: medium pinned, `before-*` = main (`0a90f3b`) on its own server, `after-*` = this branch (the build with
main merged), the same clock (13:00, 19:30, 22:00) and the same weather, one Chrome per shot set, back to back. Traffic, customers and the wok's contents are live, so they differ between
the two frames of a pair; the picture is what I compared. I looked at every one of them:

| pair | what is in it | difference between before and after |
|---|---|---|
| `before-day13.jpg` / `after-day13.jpg` (1536x864 @ 1.25) | noon: the cook's view across the lane, awning, four bulbs, the menu board, the wok on the brick stove, hands, the lane's far haze | none I can see: same colours, same haze at the end of the lane, same edge quality; a different bike / person / rickshaw in the road |
| `before-dusk19_5.jpg` / `after-dusk19_5.jpg` | purple dusk sky, lit windows, bulbs with their glow, tail lights | none: the glow around the bulbs, the sky gradient and the windows match |
| `before-night22.jpg` / `after-night22.jpg` | night: bulbs and their bloom, the stove flames, shiny drums, headlights | none: same bloom, same flames and highlights on the drums (the light pool serves the flames and lamps from 3 proxy lights) |
| `before-rain13.jpg` / `after-rain13.jpg` | rain at noon | the after frame has denser, brighter streaks and a greyer end of the lane (the before frame shows a bus and fewer streaks over a bluer sky). Both are rain at noon; the streak opacity and the haze follow the rain level, and I read it as a different point of the weather's ramp, not as a pipeline difference. **I did not prove that** (I did not capture the rain level in the two frames) |
| `before-phone-dusk19_5.jpg` / `after-phone-dusk19_5.jpg` (844x390 @ 3, canvas at 1.25) | dusk on a phone landscape | none: the same wide view, glow and sky; different traffic |
| `before-phone-night22.jpg` / `after-phone-night22.jpg` | night on a phone landscape | none: bulbs, bloom, flames, drums match; a bus in the after frame |

Both builds were at scale 1 with the HUD hidden in these shots (the QA script pins the scale and holds the governor), so these show the picture at full resolution; the picture at the governor's usual 0.7 to 0.85 is the same
render upsampled by the final pass (as it was on main, whose scaler also drew at a smaller size).

## 5. Tests

`npx vitest run src/games/tiffin-centre shared/tiffin-centre src/platform/gfx` (PowerShell): **98 files, 2357 tests, all passing** on the final state (130 s). An earlier run of the same command on the machine at its busiest failed two tests by TIMEOUT, not by assertion:
`shared/tiffin-centre/tutorial.test.js` "chaos: 40 seeds ..." (49 s under a 100 % busy CPU; 7 s alone) and `shared/tiffin-centre/fuzz.test.js` "many seeds ..." (424 s); `shared/` has no diff against main. `npx vite build` passes. New and changed, each pure piece with its test next to it:

* `scene/post.dyn.test.js` (new): every fetch from a render target in every post fragment goes through `dynUv` (regex over the shipped GLSL); targets allocated once, an identical `build()`
  skipped, a changed size or pipeline rebuilt; at scales 1 / 0.85 / 0.5 the scene, bloom, composite and FXAA passes get the right viewport / scissor and the used sizes, nothing is
  re-created by a step; texel uniforms follow the used size; all eight materials share ONE set of dynUv uniforms; `prelink` compiles exactly the passes of the tier, each against its
  own target (the canvas for FXAA) and restores the bound target; the R11G11B10F scene target only with `EXT_color_buffer_float` (RGBA16F without); `applyPointScale` (scale, original kept, no compounding, shared materials, late Points, shader points untouched).
* `scene/webgl2.probe.test.js` (new) and the two menu tests (`menuModels.test.js`, `menus.render.test.js`): the WebGL 2 probe, the shell showing the card without loading the 3D screen, the
  Android wording. `adapt.test.js` also holds `memoryResponse` (the `jalebi:memory` policy: scale first, then tier, `critical` to the lowest tier, unknown levels ignored).
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

## 6. The coordinator's two extra items (Android session's device QA)

**`jalebi:memory` (the Android bridge's real memory warnings).** `index.js` listens on `window` and `document` (`MEMORY_EVENT`, pure helpers in `adapt.js`: `memoryResponse(level, state)`).
* `low`: ONE step down, the resolution first (the next rung of `SCALE_LADDER`, down to the tier's floor), then the tier; the governor is held 5 s (`memoryHoldMs`) so it does not undo it; a burst of
  `low` inside 4 s counts as one warning (the bridge can fire it repeatedly while the OS trims).
* `critical`: the lowest tier at once (`gov.setTier`), `gfx.releaseMemory()` frees what the new tier does not need (the HDR / bloom / FXAA targets, the shadow map: `post.release()`, the shadow
  map disposal in `light-apply.js`), and the governor may not climb back for 120 s (`gov.setMaxTier`, restored by a timer).
* Unknown levels are ignored. `scene.debug.memory(level)` and `scene.debug.memoryEvents` exist for the tests and the bench (`exp-r`).
* Verified in the browser (software GL, `exp-r`): `low` 1 -> 0.95 -> 0.9 with a second `low` 0.3 s later ignored; an unknown level does nothing; `critical` -> `lite` with the post targets freed
  (`post.targets.scene` gone, 67.9 fps afterwards at 640x360 on software GL), no errors, a second `critical` does nothing. 5 unit tests in `adapt.test.js`.

**WebGL 2 missing: said at once.** `capabilities.probeWebgl2()` (a throw-away canvas, cached, no DOM means "ok" so tests and SSR are unaffected) runs in the `TiffinGame` shell BEFORE the
3D chunks are prefetched or imported; a device without it gets `NoWebgl` (the existing `StatusScreen kind="webgl"`) right away instead of after 5 to 9 s of chunk loading. In the Android app
(`window.Capacitor?.isNativePlatform?.()`, `isNativeApp()`) the wording is "This phone can't run this game" with no browser advice and no retry (`menuModels.statusCopy(kind, { native })`,
`StatusScreen` `native` prop). Leaving the card runs the same exit as the game's other end screens (quit the session, clear the saved shift when not online, back to the game's page).
**Dedupe note for the merge:** aw-int's shared probe helper was not on main (`src/platform/gfx/` has no probe file at `7e0ef4a`), so the probe is inline in `scene/capabilities.js`
(`probeWebgl2`, `forgetWebgl2Probe`, `isNativeApp`); if aw-int's helper lands, `probeWebgl2` should become a one-line wrapper of it. Tests: `webgl2.probe.test.js` (context made and released, no context or a throw, no DOM,
a context that cannot be released, `isNativeApp`, the shell shows the card without rendering the lazy 3D screen, the native wording), `menus.render.test.js` / `menuModels.test.js` (the variant).

## 7. Risks, what is unfinished, what the next lever is

### 7.1 Not proven (read this before merging)

* **60 fps in the default tier on the dev iGPU at scale >= 0.85 is NOT demonstrated.** The machine never gave a quiet minute. What exists: one quiet stretch with medium at 0.85 and the HUD hidden
  at about 75 fps (a probe, not a bench), M4 (51.5 fps at 0.7, p99 33.9 ms, zero frames over 50 ms, CPU 29 % before the job), and GPU medians of the whole frame in the same page (about 16.5 ms at
  0.85 after the pool and R11, 13.5 ms at 0.7). The frame's other half is the main thread: about 2000 GL calls and 163 to 175 draws, 15 to 18 ms of command submission on this machine
  (section 1). **Re-run `node scripts/perf/bench.mjs --game tiffin` (and `--tier medium`) on a quiet machine before believing or denying the target**; if it fails there, the lever is the
  command volume (section 2.6, tf-prog), not the pixels.
* **Same-moment build-to-build fps is not shown** (section 3): only smoothness (hitches, p99, no multi-second frames) and the per-step costs are.
* **The tier-switch probe on the merged build looked bad in three runs (multi-second tasks) and normal in the two that followed**; the cause is not established, see 7.2.

### 7.2 The tier-switch probe, branch before and after merging main

The probe `exp-h` forces `medium -> low -> medium -> lite -> medium` on one page (`scene.debug.switchTier`, governor held) and records long tasks and frames during each switch plus 4 s of
frame times after it. Snapshots of the build at different commits were run one after the other under one lock hold, interleaved (the machine was never quiet; the CPU before each job is in the log):

| build (same Tiffin source unless noted) | first switch to `low`: longest task / frames over 50 ms | `lite` steady state afterwards | second visits to a tier |
|---|---|---|---|
| v6 (twice) | 733 ms / 19 of 1648 and 352 / 22 of 1007 | 556 and 552 fps | 92 to 785 ms |
| v7 | 174 / 10 of 2034 | 1206 fps | 67 to 580 ms |
| v8 (three times) | 224 / 23 of 1065, 649 / 18 of 705, 408 / 11 of 1325 | 720, 377, 300 fps | 608 to 968 ms |
| **v9 (merge of main), first three runs** | **5297, 8884 and 3885 ms** / 27 of 51, 15 of 32, 30 of 96 | **2.7, 11.5 and 34 fps** (frames of 374 ms, 87 ms and 29 ms mean) | 0.8 to 4.2 s, frames of 0.3 to 0.7 s |
| v9, fourth and fifth runs | 202 / 11 of 1798 and 384 / 10 of 1631 | 365 and 226 fps | 685 to 938 ms |
| v10 (HEAD, v9's source rebuilt) | 820 / 15 of 1580 | 366 fps | 614 to 806 ms |

The three bad `v9` runs are real and I could not reproduce them: the same source built again (v10) and the same snapshot (v9) run again behave like v8. `src/` outside Autowala has no
difference between v8 and v9 (`git diff` is empty), the only build difference is that `tiffin-three` is 14 KB smaller (Autowala stopped using some three.js modules), and the script lists of the two pages are the same (42 scripts, one service
worker, in the v8 and v9 runs of the last hold). The other streams ran their own GPU benchmarks all day (`aw-int`'s matrix of three parallel Chromes was alive from 10:10, found while
waiting for the lock; the lock only orders the benchmarks that take it). My reading is contention: the symptom was one task of seconds, consistent with a synchronous wait on a GPU
process busy with another process's work, and lite frames 30 to 300 times slower than the 1 to 2 ms they take in every other run. **I did not prove it, and it could be a rare path in the
held-frame switch that only a busy GPU process exposes.** If a tier
change ever shows a multi-second single task on a real device, that is where to look first: `stepSwitch` in `scene/index.js` (the `link` stage polls `programsStatus`; the `prime`
stage's `getUniforms()` is the synchronous query), and `scene.debug.tierSwitches` / the `tc:tier-switch-*` marks give the per-stage times.

### 7.3 Risks of what is in the branch

* **A long transient overload walks the governor down.** On a machine another process saturates, Auto can end on `lite` (I4, M2), where main ended on `low`. The way back up needs 20 s of headroom
  (`tierUpHoldMs`) plus a held switch (a second visit to a tier is instant, a first visit to a heavier one is up to 9 s of held picture on a saturated machine, then up to 1.5 s for the first
  draw's shadow-depth programs); and a rung that holds 30 s is written to tier memory (30 days), so one very busy session can start the next one a tier low (it climbs from there). I kept
  `tierDownRatio` at 1.6 (about 37 fps) so a CPU-bound medium that merely runs at 40 fps keeps its picture; a stricter ratio would make this less likely and the 40 fps case worse.
* **The direct tiers (lite, low) have no dynamic resolution**: a scale change would re-size the canvas (100 to 700 ms of blank frames each, measured). Their only lever is the tier. Their scale
  floor is 1, so the governor never tries.
* **R11G11B10F on medium only** (no alpha, 6-bit mantissa): nothing in the chain uses the scene target's alpha (checked in `post.js`); the picture matched at 13:00 / 19:30 / 22:00 / rain. High
  keeps RGBA16F (its MSAA path was not tested with the packed format). Without `EXT_color_buffer_float` (a device with only the half-float extension cannot render to R11G11B10F) the scene
  stays RGBA16F (`post.build` asks `renderer.extensions`, commit `d3fa580`, unit-tested with a fake renderer); I could not test that path on a real device without the extension.
* **The light pool changes the shader's light count (11 to 7 on medium with K = 3, to 8 on high with K = 4; lite and low have `lightPool` 0 and keep every light as main does).** It relies on the layer convention
  (`POOL_LAYER = 7`: no camera renders it, and three counts lights only on the camera's layers). Any later game code that sets `light.layers` on a point light of 6 m or less would fight it;
  structural lights (range over 6 m: the bulbs, the tube, the street lamp) are never pooled.
* **Edits in gfx-core's files** (all additive, defaults unchanged, each with a test): `governor.js` options `tierDownRatio` and `futileMs` (the `futileCount` / `futileUntil` state, reset on a tier
  or load change), `gpuTimer.js` option `disjointMs` (+ `now` for tests), `docs/GFX_ENGINE.md` (one options row and a note). gfx-core should read them; I did not touch `adaptive.js`, `calibrate.js`,
  `dynamicRes.js`, `loop.js`.
* **Tests that went with their code:** `createScaler`, `createQualitySampler`, `createDrawCallGuard`, `frameBudgetFor`, `tierBudgetFor` (and the scene test that used the sampler). The behaviour they
  covered (windowed overload, hysteresis, no flapping, draw-call guard) is covered by `gfx/governor.test.js`, `adapt.test.js` and `quality.test.js`; the draw-call BUDGETS stay (`DRAW_CALL_BUDGET`).
* **Flaky under this machine's load, not by this branch:** `scene/loader.test.js` "runAsync ... yields once a slice is used up" (wall clock), `shared/tiffin-centre/tutorial.test.js` "chaos: 40 seeds"
  (49 s under a 100 % busy CPU, 7 s alone) and `shared/tiffin-centre/fuzz.test.js` "many seeds" (424 s under load, over its limit). `shared/` has no diff against main.
* **Memory warnings and the probe** (section 6): `critical` caps the governor at the lowest tier for 120 s (a timer restores the ceiling); the throw-away WebGL 2 context of the probe is released
  at once (`WEBGL_lose_context`) and the answer is cached for the session.

### 7.4 What is unfinished, and the next lever

* **Draws, programs, materials: tf-prog's.** 163 to 175 draws, 60 program switches, 550 `uniform3f` per frame; the census (`scene.debug.census(true)`) lists the 104 programs (MeshStandard x35,
  MeshPhysical x30, MeshBasic x18, ShaderMaterial x7), 50 used per frame, 60 near-duplicate pairs. In order: merge / instance the remaining 47 station meshes and the street props, unify materials,
  MeshPhysical without clearcoat / sheen / transmission to MeshStandard, customers behind an instanced path (86 calls each). Each draw is about 0.04 ms of GPU-process time and each program
  switch re-uploads the lights, the shadow and the camera.
* **Not done, with reasons in 2.5:** folding bloom's pre-pass into the scene pass (0.5 ms), a shadow cadence change (within the noise), a cheaper night lamp (changes the look), FXAA at the used
  size (no gain at 0.85), grain before FXAA (0.35 ms at night only).
* **API for tf-prog's loader:** `gfx.post.prelink(gfx.rawCompile)` kicks the link of every pass of the current tier; `gfx.post.getMaterials()` returns the eight pass materials; `gfx.rawCompile` /
  `rawCompileAsync` compile without the "bind the HDR target" wrapper; `scene.debug.tierSwitches`, `.census()`, `.profile`, `.lightPool`, `.governor`, `.memory(level)` for measuring.
* **Tools for the next measurement:** `scripts/perf/tf-probe.mjs` (a script in the live page, same-page A/B), `scripts/perf/tf-qa.mjs` (the QA shots), `scripts/perf/README.md`.
