# tf-gpu: Tiffin Centre's GPU pipeline

Branch `perf/tf-gpu`. Machine: the dev laptop's **integrated AMD Radeon** (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), headless Chrome,
1536x864 @ 1.25 (1920x1080 pixels), production build, vsync and the frame cap off, level 0 ("Training morning", 7:00 to 9:00) unless a row says otherwise.

**Read every number with this in mind:** the GPU and the CPU were shared with nine other streams running benchmarks, Chrome sessions and test suites the whole
time. The bench lock only serialises the benchmarks, not the rest, so absolute frame times wobbled by 20 to 40 percent between identical runs (the same build
measured twice back to back differed by that much). So every comparison below is either (a) a toggle inside ONE session (apply, measure, undo, measure again),
(b) a baseline / final pair run back to back, or (c) GPU time from `EXT_disjoint_timer_query_webgl2` (median of the frame's `TIME_ELAPSED`, which does not depend
on what the CPU is doing). Where something is a single noisy sample it says so. **The 60 fps target was not reached**; see section 7.

## 1. What the profile said (baseline, before any change)

* **The draw path is the cost, not the pixel count.** Same session, forced scale: GPU 36 ms at scale 1.0, 24 ms at 0.7, 19 ms at 0.5, i.e. about **11 ms fixed + 24 ms x
  scale^2**. The bench's 15 fps "first seconds" are shader compiles and the scaler walking the scale down; its 53 fps "steady state" is at scale 0.5 (a blurry
  picture) and *did not get faster for it*: 37.7 fps at scale 0.5 vs 37.5 at 0.9 in two runs.
* **The point lights were the single biggest cost.** The stall carries 9 to 11 point lights (2 bulbs, tube, 3 station flames, 2 candles, prep light, street lamp)
  and three evaluates every one for every fragment of every PBR material, and re-uploads the whole lighting uniform block on every GL program change.
  Switching them all off: GPU 36 to 26 ms, JS render time 40 to 22 ms.
* **Draw path:** 324 draw calls, 222 distinct materials among 261 drawables (every draw is a material change), CPU profile `uniformMatrix4fv` 14 to 30 percent,
  `drawElements` 7, `activeTexture` 5, `uniform3f` 4, `bindVertexArray` 4.
* **Programs:** 311, of which a good part were stale duplicates: compiled without the sky environment map, against the canvas colour space instead of the HDR target, or
  for a different point-light count (the station flame lights toggled `visible`, so every cooking start changed the light count and recompiled every lit shader).
* **Console:** `X3595 gradient instruction used in a loop with varying iteration` (three's FXAA shader) and `X4000 use of potentially uninitialized variable
  (f_skinAlbedo / f_skinH)` (early `return` in the skin shader functions).
* **Scaler:** after a downscale bought less than 4 percent twice it asked for a tier drop, but an explicit tier ignored that and the scaler carried on to the
  floor (scale 0.5, 6 percent of CPU in `setSize`, because `build()` re-created every render target on every step). On a 60 Hz display it could never go back up:
  the "well under budget" test (`mean < 0.62 x budget`) is below one refresh interval. Any later slowdown was blamed on the last upscale (it lowered the ceiling and
  froze the scale).

## 2. What changed

Five commits on the branch (each body carries its own numbers):

1. `skip dark point lights, program-sorted opaque pass, stable scaler, no shader warnings`
2. `scaler that works under vsync, tier budget, DoF taps by radius, compile against the real target`
3. `sky drawn last with the depth test, merged statics on high, resolution floor 0.7, integrated-GPU high`
4. `shadow refresh throttling only below ~36 fps`
5. `docs and proof screenshots` (this file)

**Lights and ordering** (`scene/gfx-tweaks.js`, new)
* three's `lights_fragment_begin` is patched (idempotent, reference counted, restored on dispose): a point light whose colour uniform is zero is skipped before its
  distance attenuation is computed (a uniform branch, free), and a light that reaches a fragment with zero colour (beyond its range) skips the PBR evaluation.
  Output is identical; only the work changes.
* `renderer.setOpaqueSort` with a comparator that groups by shader program (renderOrder still first, so the sky and weather keep their place, then program, material,
  front to back): a GL program change re-sends about 60 lighting uniforms and the camera matrices, so it is now paid once per program instead of once per material.
* The station flame / prep lights stay in the scene with intensity 0 instead of toggling `visible` (4 one-line edits in `models/cookware-*.js`, outside the gfx list):
  the point-light count is now constant for a level, so no cooking start recompiles the world.

**Programs and compiles** (`renderer.js`, `light-apply.js`)
* `compile()` / `compileAsync()` bind the HDR scene target (the output colour space is part of the program key) and `light-apply` applies a first look at creation
  so the fog, the sun and the sky-driven environment light exist before the loader compiles: the programs compiled at load are now the ones the frame uses.
  **311 to 284 programs** after warm-up, shader warnings 0.
* FXAA rewritten (`post.js`): same edge search, explicit-LOD fetches, the four corner taps only on edge pixels (this removes `X3595`). AO / DoF loops use `textureLod`.
* `skin.js`: one `return` per function (removes `X4000`).

**The scaler** (`quality.js createScaler`, `renderer.js`)
* A downscale that bought nothing twice is a CPU-bound verdict: the scale goes back to where it last helped, freezes there, and `revertTo` tells the renderer.
* The upscale probe learns what the pixels cost (frame-time change per unit of scale^2) and goes up when the frame is *on time* and the bigger picture is predicted
  to fit, so it works on a vsync-locked display; the learned cost decays when it only blocks; a failed upscale is judged for 3.5 s only; isolated hitches (a compile,
  a GC pause) count for at most 4 budgets in a window.
* Two budgets: resolution reacts at 20 ms (50 fps), a **tier** drop is only asked for above 28 ms (36 fps), so a CPU-bound 40 fps medium keeps its picture.
* Scale floor 0.7 on medium and high (the tier is the lever after that, not a blurry picture).
* The canvas is only resized when its size really changes. Measured cost of `setScale()` itself: 2 to 7 ms (the render targets are re-created lazily on the next
  frame); with the stable scaler it is called a handful of times per session. **I did not do the "allocate once at the maximum size and scale with the viewport"
  variant**: PointsMaterial sizes, the particle shader and the HUD projector all derive from the pixel ratio, so it needs changes in `index.js` and `stall.js`
  (tf-cpu) and a per-material point-size fix; the quantised (0.1 steps), debounced path is what ships. Listed under "Not done".

**Shadows, sky, post, tiers**
* The shadow map of the static stall is redrawn every frame, and every 2nd / 3rd frame only when the smoothed frame time is above 28 / 45 ms (`shadowEvery`, hysteresis,
  tested). Measured: the shadow pass is 0 to 1 ms of GPU (about 8 ms of CPU for its 142 draws), so it only pays when the game is already slow.
* The sky dome is the last opaque draw with the depth test on (it sits at the far plane): it used to run the whole sky shader, clouds included, for every pixel of the
  screen and the stall painted over most of them (hiding the sky afterwards still saves 1.2 ms: it is the part that is visible).
* Depth of field takes 6 to 24 taps by blur radius (was a fixed 24 inside a 4 px radius).
* `high` merges static scenery like `medium` (430 to about 330 draw calls); `deviceTweaks()`: a *forced* `high` on an identified integrated GPU uses FXAA instead of
  4x MSAA, pixel ratio 1.1 and a 1536 shadow map (Auto only ever gives `high` to a discrete GPU, whose table is unchanged).

## 3. Per-effect GPU cost

Medium, 1920x1080, level 0 at 7:12, `shadowEvery` pinned to 1, GPU timer medians, toggled inside one session (noise about +-1 ms):

| effect | GPU ms | note |
|---|---|---|
| whole frame | 24.1 to 26.8 (5 baselines) | |
| scene pass (shadow map + main + lights + sky + particles) | about 19 | per-pass timer queries |
| shadow map pass (142 draws, 88k triangles) | 0 to 1 | not the GPU cost; it is about 8 ms of CPU for 142 draws |
| bloom (pre 0.8, down 0.2, up 0.1) | about 1.1 | |
| final composite (AgX grade, heat haze, fringe, vignette, grain) | about 1.2 | heat haze and grain toggled off: < 0.2 each |
| FXAA | 1.1 to 1.6 | |
| sky | 1.2 | after drawing it last; it was the whole screen before |
| particles (steam, sparks) | 0.9 | |
| light shafts | < 0.3 | |
| fixed floor with a trivial override material | about 13 | draw path, shadow, post |
| all point lights at night (6 active) | about 8 | 17.96 vs 26.1 ms; about 1.3 ms per active light |
| PMREM environment refresh | 8 to 17 ms per refresh | once per 0.6 game hours at medium |

High (forced, integrated GPU, after the tweaks): scene 26.6, depth of field 3.5 (before the tap change), AO 1.5 + blur 0.4, bloom 2.1, final 1.5, FXAA 1.6.

## 4. Before / after

### 4a. Same session, forced scale (GPU timer queries; the cleanest numbers, toggles in one page load)

[[RUN13]]

Earlier same-session samples of the same kind, for the trail (medium, 1080p, 9:00, GPU median ms, scale 1.0 / 0.7 / 0.5):

| build | 1.0 | 0.7 | 0.5 | JS render ms at 1.0 |
|---|---|---|---|---|
| baseline | 31.7, 38.3 | 22.7, 24.2 | 18.6, 19.1 | 36 to 40 |
| after commit 1 (light gate v1, program sort) | 25.8, 29.4 | 18.3, 20.9 | 14.5, 15.7 | 27 to 28 |
| final (run at 7:12, 5 baselines) | 24.1 to 26.8 | | | 22 to 28 |

Night (21:00), toggled in one session, medium: the six active point lights cost about 8 ms of GPU (17.96 ms with all of them off vs 26.1 ms), about 1.3 ms each; the three
small station flames are not the cost (hiding them: no change), the two bulbs, the tube and the street lamp (range 30, covers the whole screen) are.

### 4b. End to end, `bench.mjs` (production build, 22 s warm-up, 10 s measured; pairs run back to back; contended machine)

| run | fps | mean ms | p50 | p99 | frames > 50 ms | scale at the end | programs | start to playable | boot long tasks |
|---|---|---|---|---|---|---|---|---|---|
| medium baseline | 30.8 | 32.5 | 24.0 | 304 | 36 (4.3 s) | 0.5 (pr 0.625) | 311 | 42.8 s | 88 tasks / 16.0 s |
| medium final | 30.8 | 32.4 | 28.0 | 148 | 32 (2.7 s) | 0.7 (pr 0.875) | 284 | 29.3 s | 61 tasks / 11.7 s |
| high baseline (forced) | 36.0 | 27.8 | 24.5 | 68 | 25 | 0.6 (pr 0.75) | 330 | 56.8 s | 65 / 13.8 s |
| high final (forced) | 39.5 | 25.3 | 23.1 | 96 | 33 | 0.7 (pr 0.77) | 297 | 63.9 s | 67 / 16.9 s |
[[AUTO]]

Another pair, earlier build, medium: baseline 37.9 fps (p50 24.6, scale 0.5, 311 programs) vs 54.9 fps (p50 13.7, scale 0.5, 284 programs). The spread between samples of the SAME
build (30.8 to 37.9 fps for the baseline) is as large as most of the differences, so **what is robust is this: the final build holds a sharper picture for the same frame
rate (scale 0.7 / pixel ratio 0.875 instead of the scaler sinking to 0.5 / 0.625), starts about 13 s sooner, compiles 27 fewer programs, and the timer queries say the GPU does
25 to 30 percent less work per frame at the same resolution. The 60 fps target was not reached in any end-to-end run.**

lite and low were not re-measured on the final build (the queue for the shared GPU was too long): their pipeline is unchanged apart from the program-sorted opaque pass
and the scaler; the baselines from the first run were low 61 fps at scale 0.6 and lite 245 fps (the playbook's low = 113 fps was measured on an idle machine).

### 4c. The scaler in the real loop (adaptation on, 12 x 8 s windows after the scene is ready)

| | scale changes | what it did |
|---|---|---|
| baseline | 1.0, 0.9, 0.8, 0.7, 0.6, 0.5 in 11 s (t = 40.5 to 51.5 s), then stays at 0.5 | a blurry picture for the rest of the session, 38 to 47 fps |
| final | 0.9 (42.5 s), 0.8 (46.6 s), back to 1.0 (51.2 s), then nothing | the two steps bought nothing under contention (CPU / shared GPU bound), so it reverted and froze at full resolution |

### 4d. Boot, shaders and hitches

* Programs after warm-up: 311 to 284; shader warnings: 2 families to 0.
* **A finding for the loader (tf-cpu), not fixed here:** after the scene reports ready, programs keep compiling for about 16 s (final: 107 to 284; baseline: 132 to 311)
  and every window in that period has frames of 300 to 1000 ms (the first use of a program that is still linking blocks the main thread; the warmer starts the links
  faster than the driver finishes them). Link time per lit program is about 85 ms (the wait for 96 programs was 8 s). Fix: make the warmer await `compileAsync` per chunk
  (it polls `COMPLETION_STATUS_KHR` without blocking) and spend a fixed number of compiles per frame; and fewer lit variants (222 distinct materials among 261 drawables,
  about 70 double-sided variants).
* PMREM refresh 8 to 17 ms; `setScale` call 2 to 7 ms.

## 5. Screenshots (`docs/perf/tf-gpu/`, canvas only, 1920x1080 re-encoded to 1280 wide, same camera, `scene.debug.setHour`, medium)

Mean absolute difference per pixel between before and after (0 to 255, same camera and hour): 4.2 to 7.3, 5 to 10 percent of the pixels differ by more than 16 levels, mean
luminance equal to within 0.1 to 2.5. That is the film grain (random per frame, up to +-8 levels), the flame / steam / cloud animation and the traffic being at different
positions (the two captures are minutes apart); no shift in colour, exposure, shadows or sky. I looked at the pairs; I could not find a difference that is not one of
those.

| file | what |
|---|---|
| `base-med-h07.jpg` / `fin-med-h07.jpg` | 7:00, golden morning, before / after |
| `base-med-h12.jpg` / `fin-med-h12.jpg` | noon |
| `base-med-h19.jpg` / `fin-med-h19.jpg` | dusk, bulbs and neon on |
| `base-med-h21.jpg` / `fin-med-h21.jpg` | night, stars, sodium lamp |
| `base-med-rain21.jpg` / `fin-med-rain21.jpg` | rain at night, wet road |
| `fin-land844-med-h19.jpg` | landscape phone, 844x390 at device pixel ratio 3 (see below) |

Also captured and compared but not committed (size limit): 9:30, 15:30, 17:20, 18:30, 2:00, rain at 15:30, power cut at 21:00.

## 6. Landscape phones

`viewFov(aspect)` keeps the **vertical** FOV at 74 degrees for every landscape aspect (1.33 to 2.4; it only widens on portrait): at 844x390 (2.16) the horizontal FOV is
117 degrees, at 21:9 (2.37) 121 degrees, so the stall is framed the same from 16:9 to 21:9 and nothing needed changing (the horizontal FOV does get very wide, the edges
stretch). The screenshot at 844x390 shows the kadai, the counter, the menu board and the street framed as on desktop. Fill cost at that size is small: 844x390 at pixel
ratio 1.25 is 0.5 Mpx (a quarter of the laptop test), and phones start on `low` (no post, pixel ratio 1) anyway.

## 7. Status, what is not done, risks

* **Target status:** the default (Auto) tier on the integrated GPU is still not 60 fps at scale >= 0.85, and a forced high is about 40 fps at its 0.7 floor, not at 0.85. The
  remaining frame is a draw-call and fragment cost I could not remove from my files: 322 + 142 draw calls (about 13 ms of GPU even with a trivial fragment shader) over 222
  materials, and about 14 ms of PBR fragment shading at 1080p. The levers left are outside this stream: tf-cpu merging / instancing (fewer draws and materials), the loader's
  compile throttling above, and for the fragment cost a cheaper lit shader for the far street.
* **Not done:** render targets at maximum size with viewport scaling (section 2); programs < 120 (now 284: it needs unified material slots across the stall, street and
  people); incremental PMREM (the refresh is 8 to 17 ms, rare); bloom at quarter resolution (bloom is 1.1 ms, not worth it); a light pool or merged night lights (the six night
  lights cost 8 ms; merging the two bulbs, or cutting the street lamp's range of 30 m, would save 1 to 2 ms each but changes the look, so I left them); per-customer skin / cloth
  material sharing (about 100 of the 222 materials).
* **Tried and reverted:** ordering the opaque pass near-to-far in three distance buckets before the program order (so early-Z rejects the far fragments): A/B in one session, 3
  pairs by day and 3 by night, no difference (27.5 vs 28.1 ms by day, 27.9 vs 27.8 at night), removed.
* **Risks:** (1) `gfx-tweaks.js` patches three's `ShaderChunk.lights_fragment_begin` string while a Tiffin renderer exists; it is guarded (a test pins the structure against the
  installed three, the patch is a no-op if the text does not match) but a three upgrade should rerun `gfx-tweaks.test.js`. (2) The four edited `cookware-*.js` lights are
  always visible now: the light count is constant, so a shader compiled for 11 lights is used at every moment. (3) The shadow map is stale for one or two frames below 36 fps
  (the casters that move are a few people). (4) `deviceTweaks` changes the shared `QUALITY.high` object while a renderer on an integrated GPU exists and puts it back on dispose.
  (5) Numbers: see the caveat at the top; rerun `scripts/perf/bench.mjs` on a quiet machine before quoting any of them.
* **Integration notes for the shared governor:** `gfx.setScale(s)` is cheap enough to call a handful of times a session (2 to 7 ms, nothing allocated until the next frame);
  `gfx.scale`, `gfx.pixelRatio`, `gfx.cfg` (live tier row), `QUALITY` (monotone, tested), `frameBudgetFor / tierBudgetFor` (20 ms / 28 ms) are the knobs; `createScaler` returns
  `{ scale }`, `{ tier: 1, revertTo? }` or `{ revertTo }`.

## 8. Files changed outside the gfx list

`src/games/tiffin-centre/models/cookware-tawa.js`, `cookware-kadai.js`, `cookware-chai.js`, `cookware-prep.js`: one line each (the station light is no longer toggled with
`visible`). `models/skin.js` is in the gfx list. Nothing in `index.js`, `stall.js`, `street.js`, `loader.js` or `ui/`.

## 9. Tests

`npx vitest run src/games/tiffin-centre shared/tiffin-centre` (PowerShell): 78 files, 1798 tests passed (run before the last small commits; the scene directory was rerun after
them). New: `scene/gfx-tweaks.test.js`, `scene/sky.test.js`, and about 30 new cases in `scene/quality.test.js` (scaler: CPU-bound revert, vsync, hitch clamp, tier budget, probe
window; shadow interval; device tweaks).
