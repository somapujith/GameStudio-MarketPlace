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

**TBD-STEPS**

## 3. Before / after

**TBD-BENCH**

## 4. Screenshots (`docs/perf/tf-int/`)

**TBD-SHOTS**

## 5. Tests

**TBD-TESTS**

## 6. Risks, what is unfinished, what the next lever is

**TBD-RISKS**
