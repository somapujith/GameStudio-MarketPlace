# tf-cpu: Tiffin Centre load time, hitches and draw calls

Stream `tf-cpu` of the rendering and gameplay overhaul. Branch `perf/tf-cpu`. Measured on the shared dev laptop (integrated AMD Radeon, Chrome with ANGLE /
D3D11, production code, 1536x864 @ 1.25, tier **auto -> medium**, fresh browser profile = **cold** GPU shader cache; **warm** = the same page loaded a second
time in the same profile, which is what a returning player gets).

**Read this first: the machine was saturated the whole time.** Ten agents were building, testing and benchmarking on the same CPU and GPU: the CPU sat at 100 %,
50 to 70 Chrome processes were alive, a bench-lock wait took 25 minutes or more, and something else navigated my Chrome tab twice (other debug ports from then on).
Absolute times below are 1.5 to 3 times worse than on an idle laptop and the same build varies by that much between two passes (one "after, warm" pass took 29 s while
the machine was busy: the stall alone took 11.5 s to build, 5 times its usual time). What I trust: counts (draw calls, programs, geometries, textures: exact), structure
(which stage, which function) and A/B runs of two builds back to back (`tf-suite.mjs`, same browser). I ran the final A/B twice.

## 1. What was wrong (measured before touching code)

New harness `scripts/perf/tf-load.mjs`: click on "Start tutorial" -> stage marks (`tc:*` User Timing marks written by `scene/index.js`, `scene/loader.js` and
`TiffinGameImpl.jsx`), long tasks, frames, `renderer.info`, V8 CPU profile with inclusive times. Baseline build, one cold run with `--profile`:

| ms after the click | stage | cost |
|---|---|---|
| 0 - 1150 | 13 procedural surface textures baked one by one (50 to 90 ms slices) | 0.7 s |
| 1150 - 2240 | `createStall` (one task) | 1.1 s |
| 2240 - 3370 | `createStreet` (one task) | 1.1 s |
| 3370 - 3740 | 7 parked customers / cook built so their shaders compile | 0.4 s |
| 3740 - 6440 | `compileAsync` of the scene as it was at that moment | 2.7 s wait |
| 6440 - 10380 | `gfx.render()` at "ready": **one 3.9 s task** (shader compiles on first use) | 3.9 s |
| 10380 - 20750 | first frame with the real state: **one 10.1 s task** | 10.1 s |
| 20845 | `window.__tiffin` exists (what `bench.mjs` calls `loadMs`) | |

37 long tasks, 23.3 s in total; **57 % of all main-thread time was `WebGLProgram.onFirstUse`**: the frame blocks on shader compiles. After 50 s there were **439
programs**, of which only **101 were still referenced** by a live material; the other 338 were compiled for a condition that did not last:

* the load-time compile ran with **no env map** (the first `tick` sets it), so every lit program existed twice, with and without `ENVMAP`;
* the stations' flame lights were hidden when the burner was off (`light.visible = burnerOn`). three.js bakes the **number of visible point lights** into every lit
  shader, so lighting or putting out a burner changed the light count and every material in view compiled again. Six light-count variants (5, 7, 8, 10, 11, 13 point
  lights) of ~100 programs each were found in one session: **that is the multi-second freeze when a dish starts cooking**;
* the batcher merged the static scenery only after 40 frames with a state, so the originals were compiled and then thrown away;
* (found last, it was in the shader warm-up that already existed) `renderer.compile(object, camera, scene)` gathers the lights of the scene **and of the object**, so
  a unit already in the scene that holds lights (the stall has 8, the street 1) counted them twice: its programs were built for **19** point lights, the game has 10, and the
  first real frame rebuilt 44 programs from scratch, 24 of them the heaviest `MeshPhysical` ones.

## 2. What changed (commits on `perf/tf-cpu`, numbers in each message)

1. `chore(perf)`: stage marks, `tf-load.mjs`, `tf-groups.mjs`.
2. **Never change the number of lights.** The tawa, kadai, chai and prep-pot flame lights, the back counter's light and its candle stay in the scene and are dimmed
   to intensity 0 (a zero colour skips the BRDF in the shader). One program set for the whole shift. (`models/cookware-*.js`, `scene/stall.js`; the `stall-ops` tests
   asserted the old "light.visible follows the counter" contract and now assert the new one.)
3. **Settle the scene before it is shown** (`settleFirstFrame` in `scene/index.js`): the async build receives the session's first state and the canvas size, applies the
   state (stations and their lights), the clock's light and the env map, finishes the batching, links every program (`createProgramWarmer`), polls `programsStatus()`
   until all report ready, builds each program's uniform tables a 40 ms slice at a time (the loading bar keeps moving, no task is a frozen page) and draws once behind the
   loading screen ("Stacking the steel..." / "Heating the tawa..." progress). three.js's three synchronous GPU round trips per program (shader and link logs) are off unless
   the dev server or `?tcshaders=1`. The warm-up now compiles a unit that holds lights through the whole scene (every light once). **104 programs at the end of the load
   instead of 311 (439 after a minute); the first real frame has 6 programs left to build (shadow depth, post passes, FXAA) instead of 44.** `scene.debug.settle` reports it.
4. **Shadow proxy** and **uber material** (`models/merge.js`, section 4): draw calls 324 -> 172.
5. People outside the view (with the tip of their shadow) are hidden; `useSession(..., { hz: 0 })` for the HUD and the game component (no 10 Hz re-render of the whole HUD for
   a clock nobody reads); `forceContextLoss()` and the module-level material caches on dispose.
6. Baked surface pixels re-used by a second scene in the same page (24 MB cap); rounder traffic (bonus).
7. Scripts: `tf-suite.mjs` (A/B builds, cold then warm cache), `tf-leak.mjs` (cycle / route control / soak, heap, DOM, listeners, live GL objects), `tf-shot.mjs`, `tf-diff.mjs`,
   `tf-groups.mjs`.

(The first rounded-traffic commit `bb8c928` throws at start-up: `RoundedBoxGeometry` is not indexed and `mergeGeometries` wants all or none. `c00fed2` fixes it and adds a test that builds
every vehicle through the real kit. I found it because the screenshot script timed out on the new build.)

## 3. Load: before / after (production code, `tf-suite.mjs`, back to back, no other benchmark running but the machine busy)

Start -> first rendered frame of the scene (`tc:first-frame`), three suites, medium:

| run | before | after (final code, 2 suites) | after (earlier build, without the light double count fix) |
|---|---|---|---|
| cold shader cache | 34.6 / 34.8 / 34.3 s | **13.8 s / 14.9 s (-57 %)** | 32.7 s |
| warm shader cache | 14.1 / 14.2 / 12.6 s | **8.2 s** (and 8.6 s with the earlier build); 29.4 s in one pass while the machine was busy | 8.6 s |
| worst single main-thread task, cold | 19.3 / 19.3 / 16.6 s | **1.9 s / 2.1 s** | 16.7 s |
| worst single task before the first frame, warm | 5.4 / 5.2 s | **2.2 s** | 4.3 s |
| programs at the end of the load | 311 (439 after a minute) | **104** | 154 |
| draw calls, tutorial start | 324 | **172** | 172 |

Long tasks in the 30 s after the click (final code, cold): 66 / 77 tasks, 13.8 / 17.0 s, against 21 to 29 tasks, 31.8 to 32.8 s before: more, shorter tasks (the program priming is sliced
into 40 ms steps on purpose, so the page never freezes) and **half the blocked time**. After the first frame, warm runs, long tasks starting more than 0.5 s after it:
before 45 to 73 tasks / 9.0 to 10.7 s (22 to 29 of them >= 100 ms, worst 875 to 913 ms); after (earlier build) 34 tasks / 4.2 s (6 >= 100 ms); final code 22 tasks / 1.6 s (3 >= 100 ms,
worst 113 ms) in the one clean warm pass. (The other warm pass of the final code has one 19 s task 20 s after the first frame and ends on 149 draw calls: an automatic tier drop under load, which recompiles every material; section 5.)

Stage marks of a cold pass, final code (ms after the click): stall done 2088, street done 3102, state applied 3820, batcher done 4478, programs kicked 4874, all linked 11688
(the browser links them while the page is idle: 6.8 s cold, 0.4 s warm), uniform tables built 11705, first render 13818 (2.1 s), warm-up of the dishes done 15802. Before: stall 5457,
street 6756, ready 14753, first frame 34319 (one 16.6 s task), batcher done at 16.1 s *during play*.

**What limits the load now, and why it is not under 6 s on this machine.** CPU build ~3 s (textures 1.0, stall 0.9, street 1.0, people 0.3, state + env map 0.6, batching 0.2, link kick
0.4) plus the compile. On ANGLE / D3D11 a program is *completed* by its first synchronous query (`getActiveUniform` / `getUniformLocation`), one after the other on the GPU process's main
thread, even though `KHR_parallel_shader_compile` reports "complete" earlier: ~25 ms warm and 60 to 120 ms cold per program on this saturated machine (the profile of the old first render was
99 % self time in the `WebGLUniforms` constructor). The lever is therefore the **number and size of programs** (the average fragment shader is 65 kB of GLSL; the stall alone has ~100
distinct lit programs): 439 -> 104 here, what remains is tf-gpu's (fewer material variants, lighter patched shaders). The 6 s target needs roughly <= 60 programs before the reveal. Also: every
program first *drawn* after the reveal (dishes, weather, a new customer kind: ~45 programs) costs one 25 to 120 ms frame at its first draw; priming them behind the loading screen would make the
load longer, the right fix is again fewer programs.

## 4. Draw calls

Medium tier, tutorial start (no customers), one frame including the shadow pass and the post passes (`renderer.info.render.calls`; `scripts/perf/tf-groups.mjs`):

| group | before | after | how |
|---|---|---|---|
| shadow pass | 144 | 12 | ~137 static casters (stall shell, street) cast through 2 position-only proxy meshes on a layer only the sun's shadow camera draws (three.js takes the shadow pass's layers from the shadow camera when it has any beyond layer 0): same triangles, same side modes |
| main pass: stall (142 meshes in the scene) + street (97) + sky + cook's hands | 169 | 149 | untextured opaque standard materials folded into one vertex-coloured "uber" material (colour baked in, roughness / metalness in a per-vertex attribute): lossless, ~20 draws and ~25 programs fewer |
| post passes | 11 | 11 | tf-gpu |
| **total** | **324** | **172** | |

(164 when the clock is pinned for the screenshots: the count moves a little with what is in view.) What is left in the main pass: 12 textured PBR materials and the canvas signs (one
draw per texture set), 47 station-prop meshes (they animate), 18 instanced traffic meshes, 8 street decals, the cook's 12 hand meshes (IK, rewritten every frame).

**Customers are the real cost in play and I did not solve it.** One customer at medium is **60 meshes in the main pass + 26 in the shadow pass = 86 calls**, 36 materials, 14 programs,
5.5 k triangles; a six-customer shift is ~690 calls at medium. None of their meshes is frustum-culled by three.js (the geometry is rewritten every frame), so I now hide a person
as a whole when neither they nor the tip of their shadow is in view (the sun is always on the cook's side, so the test sphere is the person plus their shadow reach): off-screen
customers are free, on-screen ones are not. Merging them does not work cheaply: the skin parts carry per-part local-frame uniforms and the head, limbs and sleeves are rewritten on
the CPU every update (the models owner measured 10 to 25 % saving for 70 to 370 ms build time); the baked proxy of lite / low changes the picture. A real fix is an instanced
people path (shared skin shader reading a baked local position) in gfx-core.

## 5. Hitch sources found

| source | evidence | status |
|---|---|---|
| shader compile on first use of the scene (3.9 s + 10.1 s) | profile, `onFirstUse` 57 % of main-thread time | behind the loading screen, 439 -> 104 programs; the serial compile remains (section 3) |
| light count changing with a burner (6 variants of ~100 programs) | `info.programs` by `NUM_POINT_LIGHTS` | fixed (lights dimmed, never hidden) |
| warm-up compiled for 19 lights, game has 10 | cache keys of the 44 programs the first frame built | fixed (unit with lights compiled through the scene) |
| env map / batching absent at load compile | 338 of 439 programs dead | fixed (state, env map, batch before the compile) |
| dynamic resolution step: `setScale -> renderer.setSize` 220 to 600 ms every time the scaler moves; an auto **tier drop** recompiles everything (a 19 s task seen in one saturated warm pass) | profile windows of the 400 to 700 ms in-play tasks (all inside `build` in `renderer.js`) | **not mine** (tf-gpu / gfx-core): scale the post targets and the viewport, never re-size the canvas; keep the programs of the lower tier warm |
| first draw of a program built after the reveal (dishes, a new customer kind) | 25 to 120 ms each; `getProgramParameter` was 11 % of a 5-minute soak (the ~105 programs created after the load, plus a tier step) | not fixed (needs fewer programs) |
| customer arrival: `buildCustomer` ~27 ms CPU (+ clothes textures) | profile (187 ms for 7 builds) | not fixed: a sliced generator build of `buildPerson` + a prediction of the next customer's seed (`state.nid`, `schedule[0]`) would remove it |
| HUD clock pulse: whole HUD tree re-rendered 10x a second | `useSession` interval; nothing reads `now` | fixed (`hz: 0`); React is 0.6 % of the soak now (`performWorkUntilDeadline` 1.8 s of 305 s) |
| texture bake in the stall / street builders (props' PBR sets 1.4 s) | profile (`pbrSet`, `streetMat`) | not fixed: lives in `models/textures-pbr.js` (tf-gpu); the 13 scene surfaces are now cached across scenes |

## 6. Leaks and soak

* `scripts/perf/tf-leak.mjs --mode cycle --n 5` (start the tutorial, play 4 s, leave through the pause menu, single-page navigation back, forced GC, repeat): per cycle `renderer.info`
  151 geometries / 150 textures / 168 programs (**no accumulation**), the WebGL context is **lost on leaving** (`forceContextLoss`), 0 live GL objects on a live context after leaving.
  No three.js object survives (heap snapshot after 3 cycles: 2 `Mesh`, 0 `WebGLRenderer`, 1 `Scene`). Residual growth per cycle: **+1.1 MB JS heap, +534 DOM nodes, +37 listeners**:
  SVG documents (detached nodes in the snapshot) reachable from the hub's app shell (`AuthProvider` `slotSubs` -> `hub-noticeslot` fibers, the logo `<img>` documents). A control that only
  toggles routes, without the game, does **not** grow, so the trigger is a game start / leave, but the retainer is shell code (`src/main`, `auth.jsx`: owned by the Android session): I did not change it.
* **5-minute soak** (`tf-leak.mjs --mode soak --minutes 5 --profile`: practice level 1 played by the engine's bot, restarted when the shift ends, production code, saturated machine):
  JS heap after forced GC **30.9 -> 33.5 MB, flat from the first minute (32.0 to 33.5)**; `renderer.info` plateaus at 241 geometries / 179 textures / 273 programs from t = 200 s (the customers
  seen so far: no growth afterwards); DOM nodes 680 to 790, listeners 240 to 300 (HUD mount state). No bot errors. The frame times of that run (p99 34 to 72 ms, 57 to 98 frames over 50 ms per
  30 s) are contention figures and prove nothing about an idle machine. Profile of the soak: `(program)` 23 %, `(idle)` 23 %, `getProgramParameter` 11 % (first draws of programs built after the
  load), uniform uploads 11 %, `WebGLRenderer.setSize` 3.5 % (resolution steps), `updateMatrixWorld` 1.7 %, GC 2.5 %, React 0.6 %.

## 7. Screenshots (`docs/perf/tf-cpu/`, JPEG, HUD hidden, tier medium, 1280x720, same clock hour, same camera; everything that moves by itself differs)

`before-h9.jpg` / `after-h9.jpg` (morning), `before-h13.jpg` / `after-h13.jpg` (noon, shadows), `before-h19_5.jpg` / `after-h19_5.jpg` (evening lights and bulbs), `diff-h9.jpg` (difference
x4: only traffic, the cook's hands, the flames and sub-pixel edge jitter from the head bob; flat surfaces, shadows and lights are black). I looked at all six: the stall (awning, tarp, drums,
brick stove, wok, signboard, bulbs and their glow, the wet floor, the shadows of the drums) is the same picture; what differs is the traffic (random positions) and its shape: the bus, car and
scooters have softened edges and darker lower bodies (the bonus: `after-h13.jpg` shows the bus). Measured: mean absolute difference over the static awning region 2.7 to 3.7 (of 255),
0.2 to 3.7 % of its pixels differ by more than 16. These pictures were taken from the build before the last two commits (light double count, priming), which do not touch what is drawn.

## 8. Not done, risks, files outside my area

Not done: the 6 s start (section 3: fewer programs), customers' draw calls (section 4), sliced / predicted customer builds, pre-warming of weather and events (their materials are
created at the first event: levels 3+ compile them mid-shift), the station props' static parts (47 meshes: would need a declared static / dynamic split in the cookware builders),
texture baking in a worker (the generators are tf-gpu's files and the builders need the textures synchronously), the post passes' 5 programs (post.js could expose its materials so they
link during the load), the tier-drop recompile and the `setSize` hitches (tf-gpu).

Risks: the shadow proxy depends on three.js taking the shadow pass's layers from the shadow camera (r187; a unit test covers the layer arithmetic, the screenshots the picture); the uber
material patches the standard shader at two `#include` anchors (`roughnessmap_fragment`, `metalnessmap_fragment`: a three upgrade that renames them breaks it loudly, a unit test covers the
patch strings); shader log checks are off in production (a program that fails to link now fails silently: `?tcshaders=1` turns them on); the person-hiding test assumes the sun is on the cook's
side (true for every hour in `lighting.js`).

Files changed outside `src/games/tiffin-centre`: `scripts/perf/cdp.mjs` (Chrome start timeout 20 -> 60 s) and new scripts in `scripts/perf/`. Inside it, outside my strict list:
`models/cookware-{tawa,kadai,chai,prep}.js` (the flame lights stay in the scene), `models/merge.js` (+ tests), `scene/loader.js`, `session/useSession.js`, `ui/hud/Hud.jsx` (one prop to
`useSession`). Nothing in `shared/` or `worker/`.
