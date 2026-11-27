# tf-int: Tiffin Centre on the shared engine layer (wave 2)

Branch `perf/tf-int`, cut from main `0a90f3b`. Machine: the dev laptop's integrated AMD Radeon (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), Chrome headless with
the real GPU, production build, 1536x864 @ 1.25 (a 1920x1080 drawing buffer), vsync and frame cap off in the bench, level 0 ("Training morning", 7:00 to 9:00) unless a row says
otherwise.

**TBD-HEADLINE**

## 0. How to read the numbers

The machine was shared with ten other streams the whole time (benchmarks queue on the bench lock, but tests, builds, other people's Chrome windows and the GPU itself are not
serialised): the same build measured twice, minutes apart, moves 20 to 40 percent (`day s0.85` GPU median of the same build: 15.6, 17.7, 14.2, 19.0 ms in four consecutive probes).
So every comparison that matters is **inside one page load** (`scripts/perf/tf-probe.mjs`: several measurements, same GPU clocks, same load: toggles, scale series, interleaved
A/B), and every "before / after" of two builds is run back to back under ONE bench-lock hold. GPU numbers are medians of `EXT_disjoint_timer_query_webgl2` over whole frames or
single passes; CPU numbers are `performance.now()` brackets of the frame's JS (the loop's own `cpu` ring) and V8 profiles. Single runs are not claimed as wins.

**TBD-BODY**
