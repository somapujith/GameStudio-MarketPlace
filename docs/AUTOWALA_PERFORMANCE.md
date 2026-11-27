# Autowala: performance and browser support

What was measured, what the game does to stay light, and what is and is not tested. Numbers are from this repo on the date of writing.

> **Update (perf overhaul, 2026-11):** the GPU side was reworked (lean post pipeline, program / draw-call / light budgets, scheduled shadows, warm-up). The measured findings and the current numbers are in [docs/perf/aw-gpu.md](perf/aw-gpu.md); the figures below are from before that work and the draw-call, program and pipeline numbers no longer hold.

## Cost of the finished game (measured in the page)
| | Before optimising | Now |
|---|---|---|
| Triangles in the scene | ~2,000,000 | ~713,000 |
| Triangles drawn per frame (view + shadow pass) | 2,880,000 | ~440,000 |
| Draw calls per frame | 335 (but nothing culled) | ~414 on high, ~320 on low (almost all culled by map tile) |
| Traffic + pedestrians together | ~930,000 triangles | ~37,000 triangles, 7 draw calls |
| Game logic (every system) | n/a | ~0.08 ms per frame |
| Download (gzip), only when the game is opened | n/a | ~330 KB (game 180 KB + three.js 148 KB) + 14 KB CSS |

`__autowala.gfx.renderer.info`, `__autowala.boot` (stage timings) and `__autowala.world.timings` show these live.

## How it stays light
- **Culling by map tile** (`render/chunks.js`): every instanced set (buildings, trees, palms, lamps, bunting, rooftop details, signs) is split into 256 m tiles, each with its own bounding sphere, so the GPU draws only the tiles in view, in the camera pass and in the shadow pass. One big InstancedMesh can never be culled.
- **Triangle budgets**: traffic autos ~1.1k, player auto ~3.7k (7.4k fully customised), traffic vehicles 200-400 each, pedestrians ~70, trees ~100 per canopy. `sim/auto-budget.test.js` and the traffic tests enforce them.
- **Quality tiers** (`game/config.js` QUALITY, applied in `Game.js`): low / medium / high set pixel ratio, MSAA, bloom, shadow size (off on low), real lamp lights (2 / 5 / 8), traffic and pedestrian counts, and view distance (300 / 420 / 560 m). The player can pick one; otherwise it is chosen from the device (touch device or little memory = low, software rendering = low) and a **frame-time sampler steps it down** by itself when the device cannot hold ~40 fps (never back up in the same session).
- **Shadows** follow the player in a +-85 m box (they were silently off before: three.js defaults to +-5 m); only trees, buildings, metro and nearby vehicles cast.
- **Staged loading**: the city is built in stages with the browser given a frame between them, so the page stays responsive and shows a real progress bar. Shader programs are compiled during loading, in parallel where the browser supports `KHR_parallel_shader_compile` (the first render otherwise freezes the page while ~100 programs compile).
- **Shared textures**: branded shop signs are drawn once per brand (the second branch of a brand costs ~10 ms instead of ~300 ms); texture anisotropy follows the GPU and the tier.
- **Hidden tab**: drawing stops (requestAnimationFrame) and audio is suspended.
- **Leaving the game** disposes every geometry, material and texture and releases the WebGL context (`forceContextLoss`), so going back and forth does not leak GPU memory or hit the browser's context limit.

## After wave 3 (career, fares, quests, rules, sound, weather and events, HUD)
Measured again with every system installed (production build passes; `npx vitest run src/games/autowala`: 68 files, 903 tests):
- Scene triangles ~736k (was ~713k): signals, rain, kites and the baraat added about 3%. Draw calls ~300 (low) to ~425 (medium).
- Game logic per frame: 0.06 ms on a real GPU (WebKit, medium). Each new system is 0.001-0.1 ms; traffic is the largest at ~0.45 ms in a software-rendered test run.
- Boot: system installs total ~0.45 s, of which `customization` is ~0.39 s (it builds the auto's parts); shader programs ~160.
- Pavement driving adds no per-frame cost beyond one height lookup. Guardrail contacts (`crash` with `guard: true`) are ignored by damage, fines and missions.
- Sound is procedural (no audio files): 6 sources without the radio, 10 with it, ~0.02-0.05 ms per frame. Audio output itself could only be inspected as a node graph here, not heard.
- WebKit (Playwright build): loads with all systems, 0 console errors. Chromium: scripted playthrough (start, bargain, pick up, drop off with review and payment, pause) passes with no console errors. Firefox and real phones are still untested.

## Failure handling
- No WebGL 2 (or hardware acceleration off): the screen says so and links back to the game page (`WebglUnsupported`).
- No half-float render target: an 8-bit pipeline. Post-processing throws: a simpler pipeline, then plain direct rendering.
- WebGL context lost: drawing pauses with a message, the pipeline is rebuilt on restore.
- One failing game system (traffic, fares, ...) is logged and skipped; after five failures in a row it is switched off. The rest of the game keeps running.
- Storage unavailable (private mode): progress is simply not saved; nothing throws.

## Browsers
Needs WebGL 2 and ES2022 (the build targets Vite's default "baseline widely available": Chrome / Edge 107+, Firefox 104+, Safari 16+).

| Engine | Tested how | Result |
|---|---|---|
| Chromium (Chrome / Edge / Brave) | full scripted playthrough on the real route: start, pick up, drop off, pay, pause, workshop purchases, road boundary | pass, no console errors |
| WebKit (Safari's engine, Playwright build) | the game screen on a test page: loads, builds the city, quality auto-steps down, start screen, no console errors | pass |
| Chromium with WebGL disabled | forced | clear "this browser can't run the 3D city" screen |
| Software rendering (SwiftShader) | the default test machine | auto-selects low, ~300k triangles |
| **Firefox** | **not tested** (not installed here) | expected to work (WebGL 2, same code paths); please check |
| **Real phones and tablets (iOS Safari, Android Chrome)** | **not tested** (no devices) | touch controls and the low tier exist but need a real-device pass |

Playwright's WebKit on Windows is not iOS Safari: it covers the engine's JavaScript, CSS and WebGL API behaviour but not iOS memory limits, thermal throttling or audio-unlock rules.

## Known costs and next steps
- Startup is dominated by shader compilation (about 140 programs, ~3 s on a modest machine, hidden behind the loading bar). Reducing the number of distinct material variants (the window shader's four looks, the shop kit's materials, per-light-count variants) would cut it.
- Volumes: master, effects, voices and music are all applied live (`audio/sound-bus.js`: engine, tyres, ambience, horns, traffic horns and the menu clicks go through the effects bus, spoken lines through the voices bus, the radio through the music bus; the browser-speech fallback follows voices x master). Covered by `audio/volume.test.js`.
- Real GPU frame times on low-end phones are unmeasured: run `?`-less play on a mid-range Android phone and watch `__autowala.gfx.quality` (the sampler's choice) before release.
