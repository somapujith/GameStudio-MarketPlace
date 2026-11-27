# aw-cpu: Autowala stutter, main-thread and boot work

Branch `perf/aw-cpu`. Everything below was measured with `scripts/perf/aw-hitch.mjs` (new, in this branch) on the dev laptop's integrated AMD GPU,
headless Chrome, 1536x864 @ 1.25, production build unless stated. **The machine was shared with the nine other streams** (their builds, test runs and
Chrome sessions all use the same CPU and GPU), so absolute milliseconds are inflated and noisy, sometimes by 2-3x between two runs. The counters
(shader programs built, which phase a stall was in, what the profile says) are exact; read the frame times as "worse than on a quiet machine" in both
columns, and trust a result when it is large or repeated.

## Summary (read this first)
**What was wrong.** Autowala's game logic is cheap (all systems together 1-2 ms per frame, React 1.4 % of the main thread, GC 1.7 %). The stutter was
**shader programs being built in the middle of the game**: the boot warm-up compiled the wrong variants, so the first frame, the first night, the first
customer, the first rain and every quality step each built 7-60 programs on first draw (100+ ms each on the integrated GPU), and the frame-time sampler took
those stalls as "the machine is slow" and stepped the quality down, which rebuilt the pipeline and the light set again.

**What was done.** `game/warm.js` builds every program the game can draw, for the state it is really drawn in, before it is drawn (behind the loading bar, then
in small slices while playing), plus a staged boot, no canvas re-allocation on a quality step, a HUD snapshot that keeps unchanged parts identical, and a
frame profiler (`game/perf.js`) and a replayable harness (`scripts/perf/aw-hitch.mjs`) so the next regression can be found in minutes.

**Also found and fixed (not a stutter, found while chasing the coordinator's heap report):** leaving the game kept the whole city alive (+22 MB per visit after a forced GC) whenever a voice
line had gone through the browser's speech path: `audio/voice-player.js` left a `voiceschanged` listener on the global `speechSynthesis`. Fixed and verified (see "Memory and leaks").

**What it bought (one run per cell on a machine shared with nine other streams; noisy, read large differences only).** The 4-7 s freezes (the first seconds of play, the first rain or night)
are gone in every tier; frames of 100-1300 ms during play are reduced but not removed (the worst frame of the 20 s drive is still 0.7-1.3 s on high / auto), and they are not CPU any more (see "What is left").

| tier | scenario | worst frame ms, before -> after | frames > 100 ms, before -> after | programs built during play, before -> after |
|---|---|---|---|---|
| low | weather (rain, dusk, night, dawn) | 7239 -> 711 | 15 -> 9 | 56 -> 0 |
| low | first 8 s of play | 258 -> 435 (noise: p99 126 -> 112) | 8 -> 4 | 0 -> 0 |
| low | drive 20 s | 453 -> 947 (GPU waits, 0 programs built) | 7 -> 9 | 7 -> 0 |
| medium | first 8 s of play | 4650 -> 641 | 9 -> 6 | 42 -> 82 (a tier step, built in the background) |
| medium | weather | 5939 -> 219 | 17 -> 1 | 54 -> 0 |
| high (2nd pair) | first 8 s of play | 3966 -> 674 | 4 -> 9 | 42 -> 82 (a tier step) |
| high (2nd pair) | weather | 5510 -> 285 | 10 -> 8 | 54 -> 0 |
| auto | first 8 s of play | 4935 -> 773 | 6 -> 10 | 0 -> 82 (a tier step) |
| auto | weather | 6048 -> 793 | 5 -> 13 | 49 -> 0 |
| auto | fares (real pick-ups and drop-offs) | 2206 -> 600 | 7 -> 2 | 7 -> 0 |

`bench.mjs` (the lead's harness, 6 s warm + 10 s measured, boot long tasks counted from the page load), before -> after: low `bootLongTasks` n 10 / 2738 ms / worst
1621 ms -> 9 / 1874 / 972, `hitches50` 11 -> 7; medium n 7 / 5607 / 4909 -> 14 / 3562 / 855, `hitches50` 13 -> 8; auto n 22 / 8047 / 5127 -> 18 / 4277 / 1649,
`hitches50` 7 -> 11; high see below.

**What did not get done (plainly).**
- **Zero frames over 50 ms after 3 s of play: not reached in any tier.** A 20 s window still has 10-54 of them. The ones that are left are GPU waits inside
  `gfx.render` (the main thread blocks in WebGL calls while the shared integrated GPU is behind), with 0 programs built in the frame; the CPU side of a frame (sim, world, camera, snapshot) is 1-2 ms.
  That is render-cost work (aw-gpu / gfx-core), not something the CPU side can remove.
- **Boot is not <= 3 s.** Build time is 4.9-6.7 s here (before: 4.9-6.1 s; the machine load moves it by 2 s either way). What improved is the stall at the end of it:
  the first frame no longer builds 100-200 programs (first-frame stall 2005 -> 1432 ms low, 1481 -> 1016 ms medium, 1311 -> 996 ms high) and the long-task time while
  loading went down in `bench.mjs` (see above). Left: the auto's reflection map (`PMREMGenerator`, 0.6-1.9 s in one task), `metro` / `props` / `buildings` are single tasks of
  100-400 ms, the synchronous part of the warm-up (1.4 s).
- **The quality sampler still steps down on a slow GPU** (every medium / high / auto run ends on `low` on this machine, before and after). Each step now builds its light set
  in small background slices before it switches (82 programs, frames of 250-520 ms while that happens) instead of freezing for seconds, but a persisted tier and a start-up calibration
  (gfx-core's tier memory) would avoid the steps altogether. The knobs are exposed: `requestQuality`, `game.warm`.
- The tests I added cover the pure logic only (`perf`, `warm`, `steps`, `snapshot`); the render-time behaviour is covered by the harness numbers above, not by unit tests.

## How it was measured
- `scripts/perf/aw-hitch.mjs`: drives the real game through scenarios (boot, an autopilot that drives a random walk of the road graph, menus,
  rain + night + dawn, fares with real pick-up and drop-off, leak cycles, a soak) and reports, for every phase, each frame over 50 ms **with its
  cause**: long-animation-frame script attribution, the game's own phase and per-system timings, the shader programs / textures / geometries created
  in that frame (and each program's cache key, to see why it was needed), React commits and components rendered per commit, an optional CPU profile
  (self, inclusive, by place) and allocation sampling. `scripts/perf/aw-compare.mjs before.json after.json` prints the tables below.
  `scripts/perf/aw-heapdiff.mjs` diffs two heap snapshots across enter / leave cycles. Flags of the cycle and allocation runs: `--cycles N --cycleplay S` (seconds of driving per visit),
  `--nostart` (leave from the start screen without pressing START), `--heap --heapinterval 256 --allocmatch <regex>` (allocation sampling, per function).
- `game/perf.js` (always on, allocation free): `__autowala.perf.report()` gives the time of the loop's phases and of every system, and a ring of slow frames.
- "Before" is the production build of `main` at `ff7de38`, "after" is this branch, same commands, same viewport, one run each (the lock queue
  was 20+ minutes per run), except `high`, which was run as three back-to-back pairs (see the table notes); where a number looks like noise it is called out.

## What the stutter was (evidence)
The CPU of the game logic is not the problem: all gameplay systems together cost 1-2 ms per frame (traffic 0.3-0.6 ms, everything else under 0.1 ms each),
React is 1.4 % of the main thread, the game allocates almost nothing per frame (257 KB/s in a drive, 85 % of it three.js and the shader introspection),
GC is 1.7 %, A* is 0.14 ms median, `updateMatrixWorld` is 0.36 ms per frame for 1569 objects. The stalls are **shader programs being built in the middle of
the game**, and everything around them.

1. **First use of a shader program blocks.** CPU profile of the baseline, 13 s starting at the page load: `WebGLProgram.getUniforms -> onFirstUse`
   59 % of all main-thread time (8.0 s). In a 24 s drive profile 40 % (`getProgramInfoLog` 7.4 s, `getShaderInfoLog` 2.3 s). The first draw of a program waits for the
   driver to compile and link it (~100 ms each here) and then reads its log and its uniform locations with synchronous round trips to the GPU process,
   which first has to catch up with the frames already queued. 200-250 programs in this city.
2. **The boot warm-up compiled the wrong programs.** `renderer.compileAsync(scene)` ran with the canvas as render target, but the game draws into the
   composer's render target (a different program variant: output colour space and tone mapping are part of the program key), with the 8 lamp-pool point
   lights visible (the first frame has none), at the 'high' tier's light count and shadow state. So the first frame built almost everything again:
   **first frame 3.8-6.9 s** (LoAF on `frame`, 3 runs).
3. **Every light set is a second set of programs.** The lamp pool (`world/props.js`) switches 2 / 5 / 8 real point lights on when `night > 0.18` (48 s into
   a game), the workshop adds a spot and two point lights, the low tier drops shadows. Built on first draw: **dusk 5.4-7.2 s stall (+49..58 programs in one frame)**,
   the first workshop opening, each quality step.
4. **Objects that only exist in play bring programs.** The first customer: **2.2 s, +7 programs** (people are lit, shadow-receiving, not instanced: no
   other object in the boot scene has that program).
5. **The quality sampler feeds on the stalls.** It counts frames over 32 ms and steps the quality down; the compile stalls are exactly such frames, so on
   the auto tier every session dropped high -> medium -> low in the first 6 s, each step rebuilding the composer, re-allocating the canvas twice (`setPixelRatio`
   then `setSize` re-assign `canvas.width`, which re-allocates the drawing buffer even for an unchanged value: 0.6-0.8 s each here) and changing the light
   set (item 3) again.
6. **Boot** (4.5-6 s on the loaded machine): `customization` 0.5-2.5 s (the environment map: `PMREMGenerator.fromScene` draws a room whose 4 programs
   are built by the first draw), `shops` 0.2-0.7 s in one task, `metro` 0.1-0.3 s, the sync part of the compile 1 s.

Measured and **not** worth changing: React (1.4 %, 52 components per commit, 4-7 commits/s), per-frame allocation, A*, traffic and pedestrian updates,
customer rig creation (0.46 ms median), the scene-graph matrix update, the sound graph. They are listed so nobody spends time there.

## What was changed
| where | what |
|---|---|
| `game/warm.js` (new, 350 lines, 18 tests) | Shader warm-up. Compiles a given **light set** against a throw-away scene holding clones of the lights (the real scene is never touched, so it works while playing), **into the composer's render target**, in slices, waits for the driver without blocking (`KHR_parallel_shader_compile`), then reads every program's uniform / attribute locations in batches (one round trip to the GPU process pays for a batch) so the first draw has nothing left to do. Incremental (what was added to the scene since is compiled by the next call, an edited material is recompiled), cancellable, `reset()` after a lost GPU context, texture pre-upload, `parallel` flag (without the extension a compile blocks, so only the loading screen warms). |
| `game/light-sets.js` (new) | The light sets the game can be in: lamp pool per tier, workshop (+1 spot, +2 points), sun shadow. |
| `game/Game.js` | The warm-up starts right after the world is built and runs while the systems install; both times of day are built behind the loading bar; the pass materials (bloom, tone map) are compiled; a hidden person with luggage stands in the scene so customers have their programs; one real frame is rendered into the pipeline before the game starts (depth programs, first uploads). In play: the other tier's set is built only after it has been in force for 8 s, textures only while frames are healthy, the workshop's set while the start menu is up or when the player has been parked at the garage for 3 s. A quality step builds its set first and switches when it is ready. The sampler is not fed the stall frames. `checkShaderErrors` is off in production (`?shaderdebug` turns it on). The HUD snapshot goes through `game/snapshot.js`. Per-phase / per-system timing through `game/perf.js`. |
| `game/steps.js` (new, was in `world/world.js`) | Staged-boot helpers; new `SLICE` yield (a macrotask break inside a stage) and `timedSteps` (total and longest piece of a stage). |
| `game/snapshot.js` (new) | Parts of the HUD snapshot that did not change keep their identity; nothing is published when only x / z / heading moved (nobody reads them). |
| `game/perf.js` (new) | Allocation-free frame profiler (phases, systems, slow-frame ring with the programs / textures / geometries created in the frame). |
| `game/camera.js` | No allocation per frame (target vector, probe, options). |
| `sim/customize.js` | The auto's reflection room compiles its shaders in the background while the city builds (`prepareEnvironment`). |
| `audio/voice-player.js` (+ `voice-player.test.js`, 3 tests) | The leak fix: the `voiceschanged` listener on the global `speechSynthesis` is the player's own, does not capture `play()`'s scope, and `dispose()` removes it (see "Memory and leaks"). |
| `scripts/perf/aw-hitch.mjs`, `aw-compare.mjs`, `aw-heapdiff.mjs`, `heapsnap.mjs` | The harness, the before / after table, the heap diff, the shortest retaining path from the GC roots to a leaked object. |

### Files outside my area (small, for the lead's merge)
- `render/renderer.js` (aw-gpu): `composer` / `target` getters; `resize` is a no-op for an unchanged size once the composer exists (the game sizes the
  pipeline during boot for the warm-up); `build()` no longer re-assigns `canvas.width / height` when ratio and size did not change.
- `world/world.js`, `world/shops.js` (aw-gpu): the staging helpers moved to `game/steps.js` (re-exported from `world.js`), `buildShops` is now a generator
  `shopSteps` that yields after every shopfront (`buildShops` stays as the synchronous wrapper, the shop tests use it).
- `AutowalaGame.jsx` (aw-ui): the fonts load while the city builds (3 lines). `ui/Minimap.jsx` (aw-ui): the round minimap redraws every 28 ms instead of every display frame.

## Rules for new code (so this does not come back)
- **Never create a lit material, a light, or toggle a light's `visible` / `castShadow` at run time without `game/warm.js` knowing.** A new light set is a complete
  new set of programs (100-250 ms each on an integrated GPU, 200+ of them). Add it to `game/light-sets.js` and warm it. A new object kind that is first
  created in play (a mission prop, an event crowd) with a material no boot-time object has: put a hidden instance in the scene at boot like the hidden person.
- Drawing a program for the first time costs a round trip to the GPU process. Do it before the frame loop (`gfx.render(0)` after the warm-up) or never.
- `__autowala.perf.report()` shows which phase / system caused a slow frame and whether it built programs; `node scripts/perf/aw-hitch.mjs ...` replays it.

## Results (details)
Same viewport, same commands, production builds of `main` at `ff7de38` ("before") and of this branch ("after"), `scripts/perf/aw-hitch.mjs`, one run per cell
(the exception: `high`, three back-to-back pairs, see below). fps / p99 / worst are frame times; "> 50" and "> 100" count frames; "programs" is the number of shader programs
created while the scenario ran (including the ones the warm-up builds in the background, so after-values above 0 on medium / high / auto are quality steps, not stalls).
`boot-play` is the first 8 s after START, `drive` 20 s of an autopilot on the road graph, `weather` 20 s of rain / night / dawn, `menus` opens pause, workshop,
job board, map and the radio, `fares` runs real pick-ups and drop-offs.

| tier | scenario | fps | p99 ms | worst ms | frames > 50 | frames > 100 | programs |
|---|---|---|---|---|---|---|---|
| low | boot-play | 48.1 -> 38.9 | 125.5 -> 112.1 | 258.5 -> 435.2 | 22 -> 14 | 8 -> 4 | 0 -> 0 |
| low | drive | 44.3 -> 40.9 | 97.8 -> 106.1 | 453.2 -> 947.1 | 50 -> 49 | 7 -> 9 | 7 -> 0 |
| low | weather | 21 -> 46.9 | 411.6 -> 101.3 | 7239.3 -> 711.3 | 38 -> 34 | 15 -> 9 | 56 -> 0 |
| low | boot: build ms / first-frame stall ms / long tasks while loading | 4979 / 2005 / 7 -> 5928 / 1432 / 18 | | | | | |
| medium | boot-play | 11.8 -> 38.1 | 638.1 -> 143.9 | 4650.1 -> 641.4 | 17 -> 10 | 9 -> 6 | 42 -> 82 |
| medium | drive | 38.5 -> 35 | 295.7 -> 358.4 | 983.5 -> 680.9 | 23 -> 24 | 10 -> 11 | 12 -> 82 |
| medium | weather | 19 -> 45.4 | 368.4 -> 67 | 5939.2 -> 218.6 | 50 -> 15 | 17 -> 1 | 54 -> 0 |
| medium | boot: build ms / first-frame stall ms / long tasks while loading | 5792 / 1481 / 15 -> 6217 / 1016 / 11 | | | | | |
| high (2nd pair) | boot-play | 13.1 -> 23.9 | 878.5 -> 669.8 | 3966 -> 673.6 | 16 -> 27 | 4 -> 9 | 42 -> 82 |
| high (2nd pair) | drive | 38.1 -> 35.9 | 71 -> 285.6 | 810.1 -> 782.5 | 17 -> 28 | 4 -> 12 | 12 -> 82 |
| high (2nd pair) | weather | 23.3 -> 41 | 377.8 -> 114.5 | 5509.5 -> 284.8 | 19 -> 34 | 10 -> 8 | 54 -> 0 |
| high (2nd pair) | boot: build ms / first-frame stall ms / long tasks while loading | 5255 / 1311 / 7 -> 6691 / 996 / 14 | | | | | |
| auto | boot-play | 9.1 -> 27.8 | 4934.8 -> 517.8 | 4934.8 -> 773.3 | 13 -> 20 | 6 -> 10 | 0 -> 82 |
| auto | drive | 37.5 -> 33.3 | 110.8 -> 193.9 | 1439.5 -> 1015.9 | 28 -> 54 | 8 -> 11 | 12 -> 82 |
| auto | weather | 31.4 -> 38.9 | 88.8 -> 119.2 | 6047.6 -> 792.6 | 12 -> 40 | 5 -> 13 | 49 -> 0 |
| auto | menus | 33 -> 35.1 | 111.3 -> 249.4 | 575.8 -> 2231.5 | 32 -> 47 | 8 -> 15 | 0 -> 0 |
| auto | fares | 26.7 -> 39.2 | 177.9 -> 86.1 | 2206 -> 599.8 | 26 -> 20 | 7 -> 2 | 7 -> 0 |
| auto | boot: build ms / first-frame stall ms / long tasks while loading | 6125 / 2478 / 7 -> 8678 / 1963 / 16 | | | | | |

How to read it, without flattering it:
- **What is clearly better** is the end of the multi-second freezes: weather worst frame 7239 / 5939 / 5510 / 6048 ms -> 711 / 219 / 285 / 793 ms (low / medium / high / auto), the
  first 8 s of play on medium / high / auto (4650 / 3966 / 4935 -> 641 / 674 / 773 ms, fps 12 / 13 / 9 -> 38 / 24 / 28), fares on auto (2206 -> 600 ms, programs 7 -> 0), and
  the programs built on the stable `low` tier while playing (boot-play, drive, weather: 0 / 7 / 56 -> 0 / 0 / 0).
- **Counts of frames over 50 ms did not go down everywhere** (low drive 50 -> 49, high weather 19 -> 34, auto drive 28 -> 54). The window is a fixed number of seconds, a build that
  froze the game for 5 s used up a quarter of it, so more of the remaining time is counted as frames; and the after-runs on medium / high / auto spend the first 10 s stepping the
  tier down while the background build runs (82 programs, frames of 250-520 ms, see "What is left"). I do not claim the count improved.
- `low` drive worst 453 -> 947 ms and boot-play 258 -> 435 ms are worse in this sample. In those frames the time is in `gfx.render` with no program built (the GPU is behind); the
  bench harness on the same build measured 583 ms worst and 7 frames over 50 ms in 10 s (before: 229 ms, 11). I could not separate this from the machine load with one run each, so it stays in the table.
- The third `high` pair (back to back as well) agrees on the big things and disagrees on the drive: boot-play worst 3963 -> 767 ms, weather 5307 -> 343 ms, but drive worst 836 -> 1286 ms and frames over 50 ms 16 -> 40
  (over 100 ms: 5 -> 16). That is the first 20 s after a tier step on a GPU that cannot hold `high`: the new set's 82 programs are built in the background while the drive runs. I did not find a cheap way to
  make that disappear without the persisted tier (below); it is the price of replacing a 4-5 s freeze by many 100-300 ms frames, and it is visible in the numbers.
- The first `high` pair (final-high, run while I was building and testing on the same machine) is not used: even the world's build steps were 3-6x slower in it (buildings 424 ms
  against 117 ms before), boot 11.3 s, drive worst 2.75 s. The second pair, base and final back to back with nothing else of mine running, is the one above.
- The `auto` menus row (worst 576 -> 2232 ms) is one 1035 ms frame inside the sound system plus two 1.1-1.2 s browser render tasks (layout / paint of the overlay) in the same
  run. Three repeats of the menus scenario (same code, merged with main) show the sound system at 8.1 / 8.0 / 7.7 ms maximum (that is the radio graph being built on the R key), worst frames
  498 / 532 / 427 ms with no 1 s frame, so the 1035 ms is treated as machine contention (it is the only sound-system frame over 40 ms in the ~20 other runs that have per-system timing) and not as a defect, but it was not
  reproduced either way.

### bench.mjs (the lead's harness)
| tier asked | boot long tasks n / ms / worst ms | `hitches50` | fps | p99 ms | programs |
|---|---|---|---|---|---|
| low | 10 / 2738 / 1621 -> 9 / 1874 / 972 | 11 -> 7 | 47.9 -> 41.9 | 85.7 -> 58.4 | 143 -> 166 |
| medium (ends on low) | 7 / 5607 / 4909 -> 14 / 3562 / 855 | 13 -> 8 | 34.1 -> 42 | 247 -> 255 | 205 -> 311 |
| high (ends on low) | 9 / 662 / 136 -> 21 / 4095 / 770 (worse) | 14 -> 12 | 48 -> 44.8 | 101 -> 91.6 | 202 -> 281 |
| auto (ends on low) | 22 / 8047 / 5127 -> 18 / 4277 / 1649 | 7 -> 11 | 42.1 -> 38.8 | 59.1 -> 100.1 | 202 -> 272 |

The high-tier boot-long-task row is worse after. The base number looks like an outlier (the base builds' own `aw-hitch` boots on the same tier show 3.1-3.6 s of long tasks, not 0.66 s), but I report the pair as
measured: on `high` the boot now does more up-front work (both times of day with 8 lamp lights and shadows are built behind the loading bar) and `bench.mjs` counts that as long tasks.

The programs column is higher after because the build now holds both times of day (and, on a tier step, the next tier's set), which is the point; each is built before it is drawn.

### Memory and leaks
- **5 minute soak** (low tier, autopilot driving the whole map, 13625 frames, forced GC before and after): JS heap 40.5 -> 44.1 MB, programs 166 -> 166, textures 73 -> 73,
  geometries uploaded 134 -> 508 (they are uploaded on first sight as the city streams in; see the trend below), 2669 React commits (8.9/s, 56 components per commit),
  `hitches50` 278 of 13625 frames (2 %), 23 over 100 ms. There is no baseline soak: the baseline run failed twice (Chrome did not start under load), so the soak is an absolute check, not a comparison.
- **Trend** (240 s, a sample every 30 s, no forced GC, `final-trend`): objects in the scene 1586-1612, materials 343-356, unique geometries in the scene 681-703, textures 73, programs 166
  (all flat); uploaded geometries 434-489 (they go down as well as up, the streaming frees them); JS heap a saw tooth between 48 and 72 MB with no trend.
- **Enter / leave cycles** (5 x, production build, `aw-hitch --scenarios cycles`, forced GC at each point): heap after leaving 37.0 -> 38.2 -> 39.0 -> 39.7 -> 40.4 MB, canvases 2 in the game and
  0 after leaving, programs / textures stable. The +0.8 MB per cycle is attributed to the harness's own recorder arrays (frames, long tasks, programs log, kept in the page): `aw-heapdiff.mjs`, which has none of that, takes a heap
  snapshot after the 1st and after the 4th visit and finds the biggest growth to be 99 KB of V8 `WeakArrayList` and 32 KB of Blink hash tables, no three.js, game or React class anywhere in the list.
  Baseline (`base-cycles`, medium) 36.6 -> 40.0 MB over the same 5 cycles, the same slope.
- **The leak the coordinator reported was real, but only after playing, and only on a path the 6 s cycles do not reach: found and fixed.** With 20 s of driving per visit the merged build
  (this branch + main) lost one whole game (+22 MB, forced GC) on some visits: heap after leaving 37.1 -> 38.6 -> **60.9 -> 83.0** MB (`m6-play`), 40.4 -> 41.8 -> **64.5 -> 86.6 -> 108.6** (`leak-snap`); the
  class diff between leaving visit 2 and visit 5 of `leak-snap` (3 leaked visits) shows +48 MB of `ArrayBuffer` data (16 MB per visit), +2415 `InstancedMesh`, +1694 `Mesh`, +612 `MeshStandardMaterial` and +152 canvas contexts, i.e. the whole city per leaked visit. The same harness
  on the pre-merge tip (`leak-dist5`: 37.0 -> 38.4 -> 39.3 -> 40.2) and on the base (`leak-base`: 36.5 -> 37.9 -> 38.8 -> 39.5) does not leak, and the 20 s sine-steering heap diff did not either,
  so it needed real driving. `--retain` (shortest retaining path from the GC roots to a leaked `InstancedMesh`, `scripts/perf/heapsnap.mjs`) gave the chain:
  `window` -> **`speechSynthesis`** -> its event listeners -> the arrow function `voice-player.js` registers with `synth.addEventListener('voiceschanged', ..., { once: true })` -> its scope chain ->
  the `onEnd` argument of that `play()` call (a closure in `audio/voices.js`) -> `ctx` -> every system -> the scene. `speechSynthesis` is a global that outlives the game, and a browser that
  never loads a voice list (headless Chrome, no speech service; some Android WebViews) never fires `voiceschanged`, so the `once` listener stays and holds the game of the visit in which the first
  recorded-file-less line was spoken. **Fix (`audio/voice-player.js`, my area):** the listener is created at the player's scope (it no longer captures `play()`'s scope and with it `onEnd` / `ctx`), is the
  player's own, and `dispose()` removes it; `voice-player.test.js` (3 tests) pins that. **Verified** (`leak-fixed`, unminified build of the fix, 5 visits of 20 s of driving, forced GC after each): heap after leaving 40.3 -> 41.7 -> 42.6 -> 43.5 -> 44.2 MB
  (+0.9 MB per visit, the harness's recorders), no 22 MB step; the retaining-path search for `InstancedMesh` now ends in the harness's own closures (its `g` variable in `window.__mark` holds the first game, a constant one game) and a string constant. The unfixed build lost a game on 3 of 5, 2 of 4 and 1 of 5 visits in the three runs above, so one clean run of 5 is evidence, not proof.
  The other items on the coordinator's list: `Game.dispose` / the React cleanup release everything else they named (`renderer.dispose()` + `forceContextLoss()`, the world, the scene tree, every system's
  `dispose`, `visibilitychange`, input listeners, the audio prime, the profile's `storage` listener, rAF and the background timer, `window.__autowala`); what stays by design is the shared `AudioContext`,
  the module-level texture cache (`render/textures.js`, fixed keys) and the cached auto geometry (`sim/autoModel.js`, two entries). The 12 MB per visit *without* START was not reproduced (5 visits,
  forced GC: 37.1 -> 38.3 -> 39.1 -> 39.8 -> 40.5 MB, the harness's own recorders explain the +0.8): the voice path needs a spoken line, which needs the game to be played.

### Per-frame allocation
Heap sampling at 256 B (`aw-hitch --heap --heapinterval 256`, 25 s of driving, low tier, unminified build so function names survive): 88 KB/s in total, of which three.js 64 KB/s (the vertex-array
binding states `WebGLBindingStates.setup` 24 KB/s and `cloneUniforms` 21 KB/s, both made when a geometry or material is drawn for the first time: streaming city chunks, spawned people and cars), the browser itself about 10 KB/s,
React and the HUD about 2 KB/s, the harness's own autopilot `tick` 2 KB/s. **No function in
`events.js`, `roadRage.js`, `fuel.js`, `weather.js` or `sim/vehicle.js` appears in the top 80 at all** (each under 0.15 KB/s): V8 already removes those small short-lived objects (`vehicle.params()`,
the road-rage tick action, the `W.event` view, `Object.keys(run)`) by escape analysis once the functions are hot. I wrote the allocation-free versions, measured 88 -> 81 KB/s (the difference is
three.js noise: the three.js share went 64 -> 60), and **reverted them**: no measured win, and four of the files belong to aw-logic. Nothing is left to fix on the CPU side here.

### React render cost
52-56 components per commit, 5.8-6.2 commits/s before and 7.7-8.9 after (the HUD snapshot is capped at 10 Hz and a faster loop reaches the cap more often; `game/snapshot.js` only stops commits when nothing
visible changed, e.g. parked behind a menu). React is 1.4 % of the main thread in the profile, so no `memo` / selector work was done: it would change appearance-owned files for no measurable gain.

### Main merged
`git merge main` was done before the last commit (aw-logic's `game/clock.js`, `clock.sim` into `world.update`, no idle fuel burn behind menus, tank-sized start fuel, the landscape hook in `AutowalaGame.jsx`,
gfx-core, tf-*): one conflict in `game/Game.js` (imports and the `world.update` line, `clock.sim` kept, my early warm-up frame uses `clock.sim` too). `src/games/autowala` and `src/platform` (after the leak fix and its test): 135 files, 2072 tests pass, `vite build` ok.
**The measurements above are from the build just before that merge** (`ff7de38` + this branch); the merged build was exercised by the leak / menus runs only, not by the before / after tables.

## Proof images (`docs/perf/aw-cpu/`, JPEG, 70 % size, each under 100 KB)
`before-*.jpg` (main at `ff7de38`) and `after-*.jpg` (this branch), the same fixed camera in front of Mama's Garage, same hour and weather, low tier, from `aw-hitch --scenarios boot,shots`:
`dusk` (17:36), `noon` (12:00), `night` (21:30), `rain-night` (21:30, storm). The point of the pairs is that **the picture did not change**: the lamp-pool lights on the road, the lit windows, the pink
pick-up ring, the sky and the rain read the same in each pair (I looked at all four pairs side by side). What differs inside a pair is live content: a pedestrian or a car in a different place, the clock a few
minutes apart, 0.1 L of fuel, the pick-up distance 130 m against 120 m, the rain streaks. The pictures are not a performance proof by themselves; they are the evidence that the shader warm-up
and the staged boot did not change how the city looks.

## What is left (for whoever picks this up)
1. **Frames of 100-700 ms during play are GPU waits.** `gfx.render` blocks the main thread inside WebGL calls while the shared iGPU is behind (render phase 8-26 ms average, 0 programs built in those
   frames). That is draw cost (pixel ratio, MSAA, bloom, lights per pixel): aw-gpu / gfx-core.
2. **Tier steps.** The sampler in `render/renderer.js` still steps down on a slow GPU; each step builds the new light set first (82 programs, 4-9 at a time, frames of 250-520 ms while it runs) and
   then switches. A persisted tier (gfx-core's tier memory) or a calibration at the start screen would remove them; `requestQuality` in `Game.js` is the only place that has to change.
3. **Boot 4.9-6.7 s.** Remaining: `PMREMGenerator.fromScene` for the auto's reflection (`sim/customize.js`, 0.6-1.9 s in one task, its 4 programs are now built early but the draw is still one task),
   `metro` / `props` / `buildings` as single tasks of 100-400 ms, the synchronous part of the first frame (1.4 s).
4. **The first opening of the workshop** on a tier / time of day nobody warmed (it warms while the start menu is up, or after 3 s parked at the garage): one 100-200 ms frame per program the first time. Not measured separately.
5. **Shader error logs are off in production** (`checkShaderErrors = false`: each program's log was two synchronous GPU round trips). `?shaderdebug` turns them back on; a shader that fails to compile now draws nothing silently.
6. No `matrixAutoUpdate` freezing of static objects (measured 0.36 ms per frame for 1569 objects: not worth the risk), no worker for A* (0.14 ms median).
