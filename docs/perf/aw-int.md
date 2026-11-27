# aw-int: Autowala on the shared engine layer (wave 2)

Branch `perf/aw-int` (cut from main `3eb86f8`, merged with main at `f0f0529` and `a3ea770`). Machine: the dev laptop's integrated AMD Radeon (ANGLE / D3D11), headless Chrome on the
real GPU, production builds, 1536x864 @ 1.25 (a 1920x1080 drawing buffer) unless a row says otherwise, vsync and the frame cap off (`scripts/perf/*`).

## 0. Read this first: what the numbers can and cannot say

* **The machine was saturated for hours** (CPU 90-100 %, 60 node and 30 Chrome processes, the bench lock queue 20-40 minutes per hold), and the speed of the *same build* moved
  by 2x between two holds: low 16.2 ms at 10:35, 12.8 ms at 11:07; medium 22.9 ms and 14.4 ms. Every absolute frame rate below is a contention figure. The comparisons that matter are
  made **inside one lock hold or one page** (`matrix.mjs`, `aw-ab.mjs`), with the old build (main `f0f0529`) and the new one run alternately.
* **Control for "is it the machine or the game?"** (`scripts/perf/gl-baseline.mjs`): a trivial WebGL 2 page (no three.js, 220 draws a frame, paced like a game) ran 40 s with **0 frames over 50 ms**
  (max 26 ms) at the size of the game's buffer; with 8 full-screen heavy layers a frame 1 frame over 50 ms (64 ms). An un-paced version of the same page (930 fps) shows 271 stalls: that is the
  frame cap being off flooding the GPU queue, not evidence about the game. So the stalls the game shows (below) are not the idle driver hiccuping; they are in the game's own GL work.
* **60 fps at p99 <= 25 ms with zero frames over 50 ms is NOT demonstrated** on this machine in the default tier. At the best moments the game ran 64-81 fps (low 70-81, medium 70, high 64) with
  p99 30-33 ms and 0-2 frames over 50 ms in the 8 s window; at the busy moments 45-55 fps. What blocks the target is listed in section 6 with the measurement behind each item.

## 1. Headline (same hold, old build and new build alternately; `bench.mjs`, auto tier, 6 s warm + 8 s measured)

Main = `f0f0529` (port 5867), new = this branch (5866). One lock hold per row group, runs alternating old / new, fresh Chrome profile each (so the new build's calibration runs every time). "start -> end" is the tier the governor / sampler ends on; frames over 50 ms are counted in the 8 s measured window (6 s after START).

| hold | run | tier start -> end (scale) | fps | mean ms | p50 | p99 | max | > 50 ms | what happened |
|---|---|---|---|---|---|---|---|---|---|
| F1 | main auto | high -> high | 48.7 | 20.5 | 19.8 | 39.2 | 51.5 | 2 | `pickQuality` says high (8 cores) |
| F1 | **new auto** | low -> low (1.0) | **69.7** | 14.4 | 13.3 | 32.1 | 41.8 | **0** | calibration read the draw-call unit at 41.6 us (outlier, clamped): "hopeless", low |
| F1 | main medium (chosen) | medium | 68.8 | 14.5 | 13.5 | 32.6 | 48.5 | 0 | |
| F1 | new medium (chosen) | medium (1.0) | 71.6 | 14.0 | 13.0 | 32.4 | 47.4 | 0 | governor locked to the choice, scale stayed 1 |
| F1 | new auto, 1920x1080 @ 1 | medium (1.0) | 69.0 | 14.5 | 13.1 | 32.9 | 45.7 | 0 | est. 16.2 ms: medium |
| F1 | new auto, 844x390 @ 3 | medium (1.0) | 64.6 | 15.5 | 14.0 | 34.0 | 58.4 | 2 | |
| F2 | main auto | high -> high | 54.8 | 18.3 | 18.5 | 33.0 | 33.3 | 0 | |
| F2 | **new auto** | medium -> medium (0.59 -> 0.69) | 64.5 | 15.5 | 14.5 | 32.5 | 38.2 | 0 | est. 20.8 ms: medium; governor 1 -> 0.6 at 6.7 s, 0.7 at 13 s |
| F2 | main medium (chosen) | medium -> **low** | 76.4 | 13.1 | 12.1 | 47.0 | 108 | 6 | the sampler lowers a CHOSEN tier |
| F2 | new medium (chosen) | medium (1.0) | 55.3 | 18.1 | 18.5 | 38.4 | 40.2 | 0 | machine busier in this half of the hold |
| F2 | new auto, 1080p | medium -> medium (1 -> 0.69) | 54.0 | 18.5 | 18.2 | 39.2 | 71.3 | 1 | |
| F2 | new auto, 844x390 @ 3 | medium (1.0) | 69.4 | 14.4 | 12.3 | 32.1 | 32.6 | 0 | |
| F5 | main auto | high -> high | 59.6 | 16.8 | 16.5 | 33.0 | 34.4 | 0 | |
| F5 | main auto (2nd) | high -> high | 50.1 | 20.0 | 19.6 | 34.6 | 46.0 | 0 | |
| F5 | **new auto** | medium -> **low** (0.81) | 49.3 | 20.3 | 16.9 | 77.6 | 130 | 15 | busy moment: 1 -> 0.8 @ 8.0 s, 0.7 @ 9.4 s, tier-down @ 11.3 s (inside the window) |
| F5 | new auto (2nd) | medium -> **low** (1.0) | 61.0 | 16.4 | 14.6 | 64.3 | 129 | 6 | tier-down @ 7.9 s |
| F5 | new auto, 1080p | medium -> low (1.0) | 53.4 | 18.7 | 18.0 | 47.2 | 69.2 | 4 | tier-down @ 8.0 s |
| F5 | new auto, 844x390 @ 3 | low (1.0) | 80.0 | 12.5 | 12.0 | 30.7 | 51.9 | 1 | calibration read 59.7 us (even after the second reading): low |

How to read it, without flattering it:
* **Average frame rate of the default tier at 1536x864: main 48.7 / 54.8 / 59.6 / 50.1 fps (mean 53.3) against new 69.7 / 64.5 / 49.3 / 61.0 (mean 61.1), +15 %.** The new build is faster on average because on a machine that cannot hold the budget at medium it ends on low instead of staying on high, and because nothing is rebuilt on the way.
* **p99 and frames over 50 ms are NOT better in the window**: main has p99 33-39 ms and 2 frames over 50 ms in four auto runs; the new build 32-78 ms and 21 frames. The measured window is 6 to 14 s after START and the governor's first decisions fall inside it (7.9-11.3 s): a stretch of slow frames on the wrong tier, then the swap. In the two runs where it did not have to move (F1, F2) it was 32 ms and 0 frames.
* The p99 of **every** run, old or new, is 30-34 ms: that is the HUD (section 6, item 1), not the 3D frame.
* The start tier on this laptop is decided by a noisy benchmark (medium on 8 of the 10 new auto runs above, low on 2) because its units move 2-10x between runs (draw-call unit 3.75 to 59.7 us). By design the first session pays for a wrong medium (about 8-11 s) and the next sessions start on the remembered tier (section 4.2).

## 2. What was wrong

1. `pickQuality` chose **high** on any 8-core: on the integrated GPU that is the heaviest tier for the same draw-call-bound frame (high and medium draw the same pixels at device ratio 1.25).
2. The built-in sampler only stepped DOWN and every step rebuilt the composer and re-allocated the canvas (0.6-0.8 s each on this driver) and the light set.
3. A tier step re-compiled ~85 programs while playing: frames of 300-600 ms per batch (each batch of programs makes the GPU process stop drawing).
4. In dev (React StrictMode) two builds started on the same canvas and the abandoned one called `forceContextLoss()` on the context the live one was drawing with.
5. The bloom bright pass passed the WHOLE colour above a hard threshold, so every sunlit white line and chrome highlight at noon bloomed; the far plane (588 m at medium) cut towers with 20 % fog at the cut.

## 3. What was done (in the order of the brief)

### 3.1 Governor integration (`game/gfx-control.js`, `game/tier-switch.js`, `game/Game.js`, `render/quality.js`, `render/renderer.js`)
* **Start tier** = the player's choice, else tier memory (`jalebi.gfx.v1.autowala`, written by the governor after 8 s of stable *play*, never from the start screen, a failed tier-up is
  not persisted), else a start-up calibration behind the loading bar (`runStandaloneCalibration`, 370-460 ms, timer mode, confident, 60 Hz detected), else the GPU class. The probe asks for the
  same GPU the game will (`powerPreference: 'high-performance'`). An integrated GPU is capped at `medium` and never starts on `high`.
* **Our reading of the benchmark** (`decideStart`). The generic rule is a tight decision on a noisy measurement: units of consecutive runs on this laptop differ 2-3x (draw-call unit 4.4 to
  41.6 us, `mtriMs` once 293), the main thread is cold JIT and busy with the page's own start-up while it runs. A wrong LOW start stays low (the governor climbs only with evidence), a wrong
  HIGH start is corrected in seconds, so the tier is the highest one up to the class cap whose estimated frame is not hopeless (<= 2.5 x budget); units are sanitised; a first reading above 20 us
  is measured again and the faster of each unit kept (`mergeMinUnits`); a start below scale 1 is raised (`sharpenStart`: to 1 when the estimate says draw-call-bound, else >= 0.85).
* **Loop + governor + GPU timer**: `createLoop` (rAF, hidden tab, no catch-up dt, `info` reset once a frame) feeds `createGovernor` through a thin wrapper that passes **the game's own JS time
  outside `gfx.render`** as "cpu" (the render call mixes GL submission with waiting for the GPU, and as "cpu" it made every pixel-bound frame look CPU-bound). The timer reads the disjoint flag at
  most twice a second (tf-int: a synchronous round trip in Chrome). `refresh` floor 55 Hz: a steady 20 ms frame is not a 50 Hz display (the budget had relaxed to 20 ms).
* **No re-allocation on a tier or scale step**: the canvas and the scene target are allocated once for the highest tier the session may reach (`allocRatio`, with a pixel budget per tier:
  low 2.1 / medium 2.6 / high 5 MP at scale 1, so a 4K window is not an 8 MP frame); a tier is a *share* of it (`tierScale`) times the governor's scale; bloom levels, the composite variant and
  the shadow cadence are switches. A tier above the allocation (a player picking High on a capped GPU) reallocates once.
* **A tier step never stalls**: `game/tier-switch.js` builds the new tier's light set in the background (a trickle: a few programs at a time while frames are healthy), swaps renderer tier +
  world quality + draw distance on a frame boundary, and holds the governor meanwhile and for 1.8 s after. An **unproved start builds the next lower tier's programs behind the loading bar**
  (`insuranceTier`; skipped for a remembered tier, a chosen tier, or an estimate that fits): measured swap with the fallback built: **6 ms wait, 0 compile frames** (section 4).
* **Resolution is not the lever on this GPU**: `createScaleFloors` gives a tier the benchmark calls draw-call-bound (cpu >= gpu estimate) a scale floor of 1, and the governor's own "resolution
  did not help" verdict pins the tier and every tier below it; without it the lowest tier cycled sharp -> 0.8 -> 0.7 -> sharp every 3 s (closed-loop test). A tier the governor *left* is marked
  failed for 5 minutes (its tier-up prediction reads the GPU timer, which cannot see a draw-call-bound frame: it climbed back every 25 s in the simulation).
* **Phone**: 844x390 @ 3: medium shades 0.51 MP (pixel ratio 1.25 of CSS), low 0.33 MP; the pixel budget only binds on huge windows. Landscape gate, `prefers-reduced-motion`, tab hidden, context loss
  (the GPU timer is rebuilt, the governor held, the warm-up reset) are untouched or covered.
* `gfx.setQuality(tier|null)` (the Graphics setting, **live**): a tier locks the tier (only the resolution adapts, floor 0.7), `null` = Auto restarts from what the GPU allows. The menus drop their reload note by themselves (their text still says "may step down if the frame rate stays low" for a chosen tier: now only the resolution does).
* `jalebi:memory` (Android bridge): `low` = one scale step (else one tier) down + hold; `critical` = the lowest tier, the shadow map and the allocation of the tiers above released (`gfx.shrinkTo`).

### 3.2 The four items from the aw-ui / aw-3dqa reports
1. **Dev context loss: cause found and fixed.** Not `checkShaderErrors`. Reproduced on a clean worktree of main (`f0f0529`, cold `vite` dev server, 844x390 @ 2 touch, software GL): two
   `getContext` calls on the one canvas 64 ms apart, then `loseContext on aw-canvas` and `webglcontextlost` 13 s later. React `StrictMode` (dev) mounts, unmounts and mounts again: two staged
   builds ran on the SAME canvas (same GL context); the first one, thrown away by its owner, ran to its end and `Game.dispose` -> `renderer.forceContextLoss()` killed the context the second was
   drawing with. Fix: `game/claim.js` (the newest build claims the canvas, an older one stops at its next stage and cleans up without touching the context) and no `forceContextLoss()` in dev
   (as Tiffin does). Same harness on this branch, cold server: one context, no loss for 14 s (`claim.test.js`, 6 tests).
2. **`gfx.setQuality`**: provided (above); a saved choice is respected (the governor is locked to that tier, only the resolution adapts); verified live in a page: medium requested, swap
   after the background build, `maxQuality` grown once, then `setQuality(null)` back to the GPU's choice.
3. **Far plane / fog**: far plane 1000 / 1300 / 1600 m (was 420 / 588 / 784: the sun-glow sprite sits at 900 m and was never inside it) with a **fog floor** `1.35 / far` (84 % fog at the plane,
   `sky.setFogFloor`): medium at noon 0.00104 against 0.0008 (a few % more haze at 300 m, nothing at 100 m), low 0.00135, high 0.00084 (palette 0.0008). A far plane costs no draw calls here (tiles are 1024 m)
   and no depth precision. Pictures: section 7.
4. **Bloom**: the bright pass keeps the EXCESS over the threshold through a quadratic soft knee (`brightPass`, unit-tested: continuous, 0 well below, excess above), and the threshold
   follows the time of day (`bloomThreshold(night)`: 1.05 at night as before, 2.2 at noon). Neon at night passes almost whole (the night pictures are unchanged); sunlit paint, the centre
   line and chrome no longer bloom by day.

### 3.3 The two low-priority items
* `jalebi:memory`: above. WebGL 2 probe: `src/platform/gfx/webgl.js` (`probeWebgl2`, `isNativeApp`, `webglFailureText`, exported from the barrel, 11 tests) is asked from `manifest.js`
  BEFORE `AutowalaGame.jsx` (three.js, the city) is imported: no WebGL 2 shows `NoWebgl.jsx` (the existing failure screen) at once; inside the Android app (`Capacitor.isNativePlatform()`)
  the wording is "This phone can't run this game". tf-int has its own copy in Tiffin's `capabilities.js` (merged first); they could switch to this one.

## 4. Per-step results

### 4.1 Baseline (main `3eb86f8`, built first, before anything was changed; the machine was at its busiest)
`bench.mjs --game autowala`, 1536x864 @ 1.25 unless noted: low 49.3 fps, p99 114.8 ms, 10 frames over 50 ms, 134 calls; **auto -> high** (pickQuality) 15.7 fps, p99 777 ms, 22 frames over 50 ms, 1965 ms worst; high 37.1 fps, p99 153 ms, 13 over 50 ms; 1920x1080 @ 1 auto 6.9 fps (p99 4466 ms, a 4.5 s freeze); 844x390 @ 3 auto -> high at pixel ratio 1.75: 30.2 fps, p99 583 ms. (A baseline medium run failed: Chrome did not start under the load.)
The later holds (section 1) show main at 49-60 fps once the machine calmed down; the baseline above is why absolute numbers cannot be compared across times of day.

### 4.2 Governor integration
* **Calibration**: 370-460 ms, `mode: timer`, confident, 60 Hz detected, on a throw-away context behind the loading bar. Sixteen readings of the draw-call unit on this laptop, in order of size: 3.75, 4.4, 5.6, 6.6, 8.4, 11.3, 13, 14, 15.6, 16, 17.2, 20.6, 22.5, 29.4, 41.6, 59.7 us (the quiet figure in `docs/perf/gfx-core.md` is 3.0); fill 2.8 ns/pixel every time (it IS the loaded GPU: 0.55 on a quiet one); `mtriMs` 2.7 to 5.3 with two outliers (68, 293). That spread is why the decision (`decideStart`) is "not hopeless" instead of "fits 85 % of the budget", and why a reading above 20 us is repeated.
* **Nothing is re-allocated or recompiled by a scale or tier step**; the closed-loop tests (`game/governor-sim.test.js`, 7) pin: a draw-call-bound medium tries the resolution, sees it buys nothing, steps to low once (< 12 s) and never climbs back; a pixel-bound GPU is answered with the resolution and keeps the tier; the first 4 s are never judged; while a swap waits for its programs the governor stays quiet and the warm-up's slow frames cause no second step; the lowest tier does not cycle soft / sharp.
* **Tier swap, real GPU, medium -> low through `gfx.setQuality('low')`** (`aw-probe --cmd eval`: 120 frames of reference, then the swap and 3 s after):

| warm-up of the new tier's programs | time to swap | frames during the wait (n, mean, max, over 50 ms / over 100 ms) | after the swap (mean, max) |
|---|---|---|---|
| in-play trickle, `maxPending` 10 (final) | 4.0 s (3.5 s in another run) | 206 frames, 19.5 ms, 601 ms, 6 / 6 | 15.0 ms, 89 ms |
| `maxPending` 3, budget 2 ms | 7.5 s | 317, 23.6 ms, 731 ms, 15 / 8 | 14.8 ms, 49 ms |
| `maxPending` 24, budget 8 ms | 2.1 s | 93, 22.5 ms, 656 ms, 7 / 5 | 15.6 ms, 54 ms |
| **fallback built behind the loading bar** (an auto start; 336 programs at boot) | **6 ms** | **0 frames** | 12.7-17.1 ms, 32-58 ms |

  Compiling in play cannot be made hitch-free whatever the pacing (each batch of ~3 programs makes the GPU process stop drawing: `render=606 +4 programs`), only moved; main did it in a burst on the first draw (aw-cpu: frames of 250-520 ms for 5-10 s). Building the fallback at boot costs 1-2 s of boot (boot 4.1-5.6 s without, 5.3-7.6 s with; main 5.4-9.6 s) and 170 programs of GPU memory, only for an unproved start.
* **Scale steps are free**: governor-driven scale changes in the runs above (1 -> 0.8 -> 0.7 within 1.5 s) left no frame over 50 ms attributable to the step itself.
* **Tier memory**: verified end to end on the real GPU with `scripts/perf/aw-memory.mjs` (two page loads in ONE Chrome profile). First session: no memory, the calibration ran (est. 28.9 ms for medium, draw-call-bound), start **medium**, the governor left it at 11.9 s (`scale floor 1 reached, still 21.6 ms vs 16.7 ms`: the benchmark had already pinned the scale floor, so no soft / sharp pass) and swapped to **low** with the fallback built at boot; the step-down was written to `jalebi.gfx.v1.autowala` at once (`rememberStepDown`). Second session: **`source: memory`, start low @ 1 ("remembered stable low at scale 1"), no calibration, no fallback build, no governor decision in 8 s.** Why the immediate write: on a borderline machine the governor needs 8 s of STABLE play after its last change to call a tier stable; in three earlier 26-50 s sessions that had not happened yet (medium for 10-30 s with scale changes, the tier-down at 32 s), so a session that ended early would have left nothing behind. The settled tier overwrites it later (`governor-sim.test.js`: a low tier holding the budget for 8 s is written with its scale).

### 4.3 GPU waits and draw calls (what the frame is bound by, measured)
Interleaved A/B in one page (`aw-ab.mjs`, medium, Charminar at dusk, 3 rounds of 3 s, median):

| variant | mean ms | fps | CPU of `gfx.render` | GPU timer | change |
|---|---|---|---|---|---|
| base | 22.88 | 43.7 | 20.3 | 20.0 | |
| render scale 0.7 | 22.04 | 45.4 | 19.6 | 18.9 | -0.8 |
| bloom off | 21.16 | 47.3 | 19.1 | 21.3 | -1.7 |
| bloom 2 levels | 22.38 | 44.7 | 20.3 | 21.5 | -0.5 |
| shadow update every 50 ms | 21.23 | 47.1 | 18.5 | 19.3 | -1.7 |
| shadow update every 100 ms | 21.76 | 46.0 | 18.7 | 19.7 | -1.1 |
| **no shadows** (= the low tier) | 19.08 | 52.4 | 16.3 | 18.2 | **-3.8** |
| lamp lights 0 (dusk: 3 on) | 20.10 | 49.8 | 18.2 | 18.7 | -2.8 |
| lamp lights 2 | 22.49 | 44.5 | 19.5 | 19.8 | -0.4 |
| no traffic / pedestrians | 22.06 | 45.3 | 20.0 | 17.2 | -0.8 |

Round-to-round noise is about +-1 ms. At medium the CPU time of `gfx.render` and the GPU timer are both about the frame (20.3 and 20.0 of 22.9 ms) and the resolution buys 4 %: the frame is bound by GL calls, not pixels (at low a governor window read 5.2 ms of GPU in a 14 ms frame: CPU-bound too). Low (same session type): 18.0 ms base, 17.7 at scale 0.7, 17.1 with lights 0. At a quiet moment (11:07): low 12.8 ms, medium 14.4, high 15.6, so the tier cost ratio is 1.12-1.4 depending on the load: tierCost 1 / 1.15 / 1.25.
* **CPU profile of 20 s of driving, auto tier (aw-hitch --profile)**: 86 % of the main thread is the frame function, 82 % is `renderer.render`; self time by place: native GL calls 60.7 %, three.js 22.3 %, (program / driver) 9.5 %, game code 6.3 %, React 1.0 %, GC 0.1 %. `uniformMatrix4fv` 21.1 % (4.3 s = 4.6 ms a frame, ~360 calls a frame), `uniform3f` 10.8 %, `uniformMatrix3fv` 5.9 %, `bindVertexArray` 3.6 %, draw calls 7 %, `useProgram` 2.2 %. Camera pass 183 draws / 540 k triangles + shadow pass 36 draws / 269 k at the start position at noon, 58.7 program switches and ~167 distinct materials a frame (`--cmd draws`). Every program switch re-uploads the projection / view / shadow matrices and all light uniforms; a draw is ~50-90 us all in. **That is the whole frame, and it is draw-call work inside `world/**` (shops 28.6 draws, glass / physical 23.4, instanced Lambert 21.7, metro 16, signals 11, road art 10 a frame), which this stream does not own.**
* Distance culling of whole groups does not help: 71 of 141 draws are instanced tile meshes whose bounding sphere centre is hundreds of metres away while their content is under the camera, so culling by distance would have to be per instance.
* The GPU timer with the disjoint flag read twice a second costs nothing measurable: low 16.38 ms vs timer off 17.06, medium 22.67 vs 23.07 (4 interleaved rounds).

## 5. Validating the tier models (the calibration's cost model)

`GFX.models` in `game/config.js` are the calibration's cost model per tier (`ms = max(cpu, gpu) x 1.1`, `cpu = calls x callUs`, `gpu = layers x Mpix x fillNs + mtris x mtriMs + post x Mpix x postNs`). The starting values of `docs/GFX_ENGINE.md` 6.1 were not validated. Compared with the measured frame times of the same minutes (units of one calibration: fill 2.82 ns/px, draw call 14.06 us, 4.48 ms/Mtri, post 2.79 ns/px; viewport 1536x864 @ 1.25; measured at that load: low 17.7, medium 23.5, high 22-25 ms):

| tier | measured | old model (calls 450 / 800 / 1000, layers 2.5 / 3.5 / 4.5) | **fitted** (calls 1100 / 1500 / 1560, layers 1.6 / 1.6 / 1.8) |
|---|---|---|---|
| low | 16.2-18.0 ms | 13.2 (-25 %; cpu 6.3, gpu 12.0) | **17.0** (cpu 15.5, gpu 10.8) |
| medium | 22.9-23.5 ms | 33.2 (+41 %; cpu 11.3, gpu 30.2) | **23.2** (cpu 21.1, gpu 19.0) |
| high | 22.0-25.6 ms | 45.2 (+100 %) | **24.1** (cpu 21.9, gpu 20.9) |

`calls` is in the benchmark's simple-draw equivalents: a real Autowala draw (program switches, ~30 uniform uploads, lights, fog) counts for 5-6 of them. `layers` is small because the game is call-bound (scale 0.7 bought 4 %). `tierCost` 1 / 1.15 / 1.25 comes from the quiet-moment measurement. **What this does not validate**: the units move 2-10x between consecutive runs on this laptop (the calibration runs while the page boots: cold JIT, a busy main thread), so the fit holds for one calibration, not for the machine; on a quiet laptop the same units give low 3.6 / medium 5.0 / high 5.2 ms (not measurable here); a phone's units were never measured (the 844x390 @ 3 runs are this laptop with a phone-sized viewport). Fix the models, not the benchmark: re-fit `calls` when the draw-call count of the world changes (`gfx.cost.calls`).

## 6. Why 60 fps / zero hitches is not reached here, and the next levers (measured)

Measured with the tools of this branch (`aw-ab`, `aw-hitch --profile`, `gl-baseline`, a GL-call timing wrapper), in the order of what they would buy:

1. **The HUD costs the p95 / p99.** `aw-probe --cmd bench --tier low`, 20 s, HUD on / off (CSS `display: none` on everything but the canvas), two rounds each, a quiet moment: **on 74.4 / 67.2 fps, p95 30.5 / 30.6 ms, p99 32.6 / 32.6; off 77.5 / 73.0 fps, p95 16.1 / 17.2 ms, p99 29.9 / 32.2.** Every snapshot (10 Hz, about 1 frame in 7) makes one frame ~15 ms longer (layout / paint / composite of the DOM over the canvas): that is the p95 of 30 ms in every run above, and it alone keeps p99 over the target of 25 ms. For aw-ui / aw-cpu: publish the HUD at 5 Hz or only on a visible change, animate the speedometer with a compositor-only transform.
2. **Camera-pass draw calls and program switches** (`world/**`, aw-draw): 183 + 36 draws, 58.7 program switches, ~360 `uniformMatrix4fv` a frame = 4.6 ms (profile above). Merging shops / metro / signals / road art and fewer light-uniform uploads per switch (one program for Lambert + Standard) is what would move a medium frame from 14-23 ms. The tier knobs of this stream take at most 9 ms off medium in total (shadows 3.8, lamps 2.8, bloom 1.7, traffic 0.8): that is the low tier.
3. **Stalls**: with the machine busy, 64 frames over 50 ms in 25 s at low and 1 at medium in the next minute (GL stall probe, a wrapper around every GL call: 51 calls over 12 ms at low, spread over `uniformMatrix4fv` / `uniform3f` / `bindVertexArray` / draw calls, i.e. whichever call finds the command buffer full or the thread descheduled; 400 over 12 ms at medium, where every frame waits in GL for the GPU). The paced control page (`gl-baseline.mjs --fps 60`, 220 draws) had 0 frames over 50 ms in 40 s, 8 heavy full-screen layers a frame 1. So the stalls need both the game's GPU load and a busy machine; they were never a program compile (0 new programs in those frames), a texture or a geometry upload. The only compile hitches left are a tier step whose fallback was not built at boot (a remembered or a chosen tier that later has to step: ~4 s, 6-15 frames over 50 ms).
4. **The start**: a quiet machine starts on medium and holds it (70 fps), a loaded one pays 8-11 s on the wrong tier once; tier memory ends that for the next sessions. A better estimate needs a benchmark that does not run during the page's own start-up (a second one on the start screen, with warm JIT, is the next lever).
5. First-draw cost of the composite variants (`compPlain` after a swap to low): not measured separately; `post.warm()` compiles them but the first draw still reads the program's uniforms.

## 7. Pictures (`docs/perf/aw-int/`, 12 JPEGs, SwiftShader at the same camera / hour / weather, medium tier, before = main `f0f0529`, after = this branch)

Same camera, hour, weather and game state as far as the harness pins them (`aw-probe --cmd shots`: customers and the chase camera's heading are live, so a waiting customer may differ inside a pair). I looked at every pair.
* `before|after-day-street` (noon, the auto at the garage): same street, sky, sun shadows. **The white centre line and the pink pick-up ring are less washed out after** (the old bloom passed the whole colour of every sunlit pixel above 1.05; the new one passes the excess and the noon threshold is 2.2).
* `before|after-day-charminar`: the mosque, bunting, tree and road identical; the dashed centre line is crisp in both; the far houses fade the same.
* `before|after-dusk-cyber`: the glass towers, lit windows, red trees and the pink sky identical; the sky near the top is a little more saturated after (the sun-glow sprite 900 m out is now inside the far plane).
* `before|after-night-paradise`: the neon sign, the lit shopfront, the lamp pool on the pavement, the stars and the lake lights identical (a waiting customer with a beam is in the after picture: game state). **The night glow is unchanged.**
* `before|after-rain-night`: the green neon "DUM BIRYANI" halo, the rain streaks, the wet road and the lamp pool read the same.
* `before|after-844x390-day-street`: the same scene in a wide, short viewport: framed correctly, no border or offset from the sub-rectangle.
Not compared pixel for pixel (SwiftShader, one frame each). The far-plane change is visible only for towers beyond 588 m (none is in these framings).

## 8. Tests, build, files

Tests: `npx vitest run src/games/autowala src/platform/gfx` (PowerShell) green; `npx vite build` green. New suites: `render/quality`, `game/tier-switch`, `game/gfx-control` (benchmark reading, floors, memory plan, insurance, start-up path), `game/governor-sim` (closed loop), `game/claim`, `game/perf` hitch counters, `render/post` bright pass, `platform/gfx/webgl`.
Files outside my brief's list: `src/platform/gfx/webgl.js` (+ test, + one barrel line) and one row in `docs/GFX_ENGINE.md` (gfx-core's folder: a new file only); `src/games/autowala/manifest.js` (the loader probes WebGL 2 first), `NoWebgl.jsx` (new), `ui/menus/BootScreens.jsx` (the failure text comes from the shared helper: same words in a browser, "This phone can't run this game" in the app); `render/sky.js` (`setFogFloor`, the shadow map is freed when shadows go off); `ARCHITECTURE.md` (the quality paragraph); `scripts/perf/*` (`matrix.mjs`, `aw-ab.mjs`, `gl-baseline.mjs`, `aw-memory.mjs`, governor / hitch fields in `bench.mjs` and `aw-hitch.mjs`, `--nohud`, GPU timer pause in `aw-probe.mjs`, README).
New fields the UI may read: `game.adaptive` (`aq`, `gpu`, `calibration`, `governor`, `loop`, `timer`, `switcher`, `describe()`, `recalibrate()`), `gfx.maxQuality`, `gfx.renderScale`, `gfx.setTier`, `gfx.setQuality`, `gfx.shrinkTo`, `gfx.setBloomThreshold`, `game.perf.report().hitches`. The contract read by `bench.mjs` (`__autowala.gfx.quality / renderer`), the settings keys and the snapshot shape are unchanged. `pickQuality` is kept (exported, unused by the game).

## 9. Risks and what is not done

* **The first session on a machine that cannot hold its start tier pays 8-11 s** (section 1). Tier memory (written after 8 s of stable play, not from the start screen) ends it (section 4.2); verified on this laptop only.
* The calibration is weak evidence on this machine (2-10x spread): `decideStart` only vetoes a hopeless estimate. On a phone (never measured) an optimistic medium start may need the governor.
* A tier the governor left is not retried for 5 minutes (`GFX.tierRetryMs`): a transient overload at the start can keep a machine on low for 5 minutes (it climbs only with evidence after that). Failed tier-ups are not persisted.
* `insuranceTier` adds 1-2 s of boot and 170 programs of GPU memory for an unproved start.
* A tier chosen by the player locks the tier; only the resolution adapts (floor 0.7), so a player on High on a weak GPU sees 0.7 instead of a lower tier.
* The far plane and fog floor change the look: at 300 m at noon the fog is 15 % on low (was 6 %), 9 % on medium (6 %), 6 % on high; the sun-glow sprite (900 m out) becomes visible (it was behind the plane). The noon bloom is deliberately weaker.
* Not done: the `compPlain` first-draw cost, per-instance culling, the HUD publish rate (aw-ui), merging more draws (aw-draw), a calibration that runs on the start screen; the 5 minute soak was not re-run on this branch (targets are allocated once and disposed with the pipeline).
* The lock: one of my queued benchmark jobs was killed while it held the bench lock (a mis-parsed argument) and the lock directory stayed until it expired; I was not allowed to remove it myself.
