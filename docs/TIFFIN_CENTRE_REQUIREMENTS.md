# Tiffin Centre: minimum requirements, quality tiers and what was measured

This page declares what Tiffin Centre needs to run, how it picks a quality tier on its own, what each tier costs, and what happens on hardware that
cannot run it. Read section 8 first if you are about to trust a number: **only Chromium (Chrome 14x, headless, SwiftShader software GL) could be run
while this was written. Everything about Firefox, Safari, iOS and Samsung Internet is static analysis.**

## 1. Declared minimum requirements

| | Minimum | Notes |
|---|---|---|
| Browsers | Chrome / Edge / Opera 107+, Firefox 104+, Safari and iOS Safari 16.4+, Samsung Internet 21+ | The Vite default build target (`baseline-widely-available`: Chrome 107, Edge 107, Firefox 104, Safari 16). iOS 16.4 is the declared floor (WebGL 2 with half-float render targets, `Object.hasOwn`, `:has()` and the pointer events the HUD uses are all there). Older browsers load the home screen but get the "cannot draw the 3D stall" screen. |
| Graphics API | **WebGL 2** | three.js 0.187 has no WebGL 1 renderer. A browser with only WebGL 1 (or with WebGL off, a blocklisted GPU, or no free contexts) raises the existing `webgl` status screen ("This device cannot draw the 3D stall") with the reason recorded (`WebglUnavailableError`, `code: 'webgl'`). |
| Render targets | Half-float colour targets (`EXT_color_buffer_float` or `EXT_color_buffer_half_float`) for the medium and high tiers | Without them the post pipeline cannot work: the tier is capped at `low` (direct render). |
| GPU | Anything that gets WebGL 2 at all runs the **lite** tier; phones, tablets, Safari and iOS start on **low**; an integrated desktop / laptop GPU (Intel HD 5xx / UHD / Iris, AMD Radeon Graphics) starts on **medium**; only a discrete-looking GPU (GeForce GTX / RTX, Radeon RX, Arc A / B, Apple Silicon) with 8+ cores, 8+ GB and 4x MSAA starts on **high** | Software renderers (SwiftShader, llvmpipe, Microsoft Basic Render Driver) and a list of weak mobile / old integrated GPUs are detected and start on lite. A flagship Android phone (Adreno 7xx / 8xx or Mali-G710+, 8+ cores, 8 GB) may start on medium, never high. The player can pick any tier in Graphics; Auto steps down at run time (section 4). |
| RAM | 2 GB device (lite), 4 GB (low / medium), 8 GB (high, and a flagship phone's medium) | `navigator.deviceMemory` is Chromium-only; Safari and Firefox do not report it and are judged by CPU cores and GPU instead. JS heap measured at 55 MB (lite) to 113 MB (high) with six customers; GPU memory is a few tens of MB of textures and geometry. |
| CPU | 2 cores minimum; 4+ recommended | The simulation is tiny (an engine tick is well under a millisecond); the cost is the render submission, so draw calls matter more than clock speed. |
| Input | Mouse + keyboard, or touch | The HUD owns this. |
| Network | The 3D code is about 410 kB gzip on top of the home screen's ~90 kB, fetched once and cached | See section 5. No images, models, sounds or fonts are downloaded for the 3D scene: everything is generated at run time. |

## 2. How the tier is chosen

`scene/capabilities.js` (pure, unit tested with fake GL objects) probes the device once: WebGL 2 / WebGL 1, max texture size, anisotropy, float and
half-float render targets, MSAA samples, derivatives, instancing, parallel shader compile, the unmasked GPU renderer string, `hardwareConcurrency`,
`deviceMemory`, `devicePixelRatio`, coarse pointer, `prefers-reduced-data` / `saveData`, 2G, and (when the browser has it) the battery level.
`chooseTier(caps)` starts at `high` and only steps DOWN, recording every reason. The policy is deliberately conservative: a six-customer frame costs
189 draw calls / 142k triangles on lite, 293 / 152k on low, **1147 / 275k on medium and 1379 / 357k on high** (production QA, `docs/TIFFIN_CENTRE_PROOF_C.md`), which is
far more than a phone GPU or an integrated GPU sustains. The old policy gave medium to every phone with a decent GPU and to every iPhone / iPad.

| Rule (first match that lowers the tier wins, every reason is recorded) | Tier cap |
|---|---|
| No WebGL 2 | unsupported (status screen) |
| Software renderer; weak GPU string; max texture < 2048; 1 GB or less; 2 GB or 2 cores on a phone | lite |
| Max texture < 4096; no half-float render targets; 2 GB (desktop); <= 2 cores on a desktop; 4 GB / <= 4 cores on a phone | low |
| **Any phone or tablet** (coarse pointer, iOS, Android) unless clearly flagship; **Safari / every iOS browser** (WebKit: unmeasured, GPU and memory hidden) | **low** |
| Clearly flagship phone / tablet: not Safari / iOS, 8+ GB, 8+ cores and a 2022+ GPU (Adreno 7xx / 8xx, Mali-G710+, Xclipse, Immortalis) | **medium, never high on touch** |
| Desktop / laptop without a discrete-looking GPU string (integrated Intel / AMD, unknown or hidden renderer); fewer than 8 cores (or not reported); under 8 GB (a browser that does not report memory, such as Firefox, is not held against an 8-core discrete machine); MSAA under 4x or not reported; 4 GB desktop; `saveData` / reduced data; no float targets | medium |
| Battery <= 20 % and not charging | one tier lower |
| Discrete GPU (GeForce GTX / RTX, Quadro, Radeon RX / Pro, Arc A / B, Apple M-series) AND 8+ cores AND 8+ GB AND 4x MSAA, nothing reported against it | **high** |

What the table gives for real device shapes (`capabilities.test.js`, "the Auto tier policy", 33 cases):

| Device | Auto starts at |
|---|---|
| iPhone (Safari or Chrome), iPad, iPad Pro, Safari on a Mac | low |
| Galaxy S24 / Pixel 9 class (Adreno 7xx / 8xx or Mali-G710+, 8 cores, 8 GB) | medium |
| Any other Android phone: Adreno 6xx, Mali-G78, 6 GB, 6 cores | low |
| Old phone (Mali-T, 2 GB, Intel HD 4000, 2012 laptop) | lite |
| Office / thin laptop (Intel UHD 620, Iris Xe), Ryzen APU, a hidden renderer string | medium |
| Gaming laptop with a discrete GPU but 6 cores, or 4 GB | medium |
| Desktop with GeForce RTX / Radeon RX, 8+ threads, 8 GB; MacBook / Mac with Apple Silicon (Chrome); Firefox on the same | high |
| SwiftShader / llvmpipe / headless CI | lite |

The player's **Graphics** setting wins over the probe: `auto | high | medium | low | lite`, persisted in `localStorage` key `jalebi.tiffin.gfx.v1`
(`getGfxPref` / `setGfxPref` / `GFX_PREFS` from `src/games/tiffin-centre/scene/capabilities.js`; import from that file, not from `scene/index.js`, so the
menu does not pull three.js into the home screen). The scene also offers `scene.setGraphics(pref)`, `scene.getGraphics()`, `scene.getTierInfo()`
(`{ tier, start, pref, auto, reasons, caps, summary, scale }`) for the pause menu. An explicit tier applies at once to what is built from then on and
in full at the next shift. The probe's verdict and reasons are available in the console: `__tiffin.scene.getTierInfo().summary`.

## 3. The tiers

| | lite | low | medium | high |
|---|---|---|---|---|
| Post pipeline | none | none (native MSAA where the browser gives it) | HDR + bloom + grade + FXAA | MSAA 4 + AO + bloom + DoF + grade |
| Shadows | none | none | 1024 PCF | 2048 PCF |
| Pixel ratio cap | 1 | 1 | 1.25 | 1.75 |
| Frame cap | **30 fps** | uncapped | uncapped | uncapped |
| Draw calls per frame, six customers (measured, QA) | 189 | 293 | 1147 | 1379 |
| Draw-call budget of the run-time guard | 250 | 350 | 700 | 1000 |
| Triangles per frame (measured, QA) | 142k | 152k | 275k | 357k |
| Auto starts here on | old phones, software GL, weak GPUs | phones, tablets, iOS, Safari, 4 GB / 2-core machines | integrated-GPU laptops, flagship Android, < 8 cores | discrete GPU + 8 cores + 8 GB + MSAA 4x |
| Dynamic resolution floor | 0.6 | 0.5 | 0.5 | 0.5 |
| Procedural textures | 128 px, no normal maps | 128 px, no normal maps | 256 px | 512 px |
| People | baked proxy, lite sculpt (22-column head, 5-sided limbs), flat shaded | baked proxy, low sculpt | static meshes merged per material, medium sculpt | merged, high sculpt |
| Scenery | street and stall flattened and merged (PBR-textured materials become vertex colour; painted signs and lights keep theirs) | merged by equivalent material | merged by equivalent material | not merged |
| Street | 2 walkers, vehicles at the minimum (the street builder always keeps a few), no birds / wires / clouds / stars, 25 % decor | 3 walkers, 4 vehicles, 50 % decor | 6 walkers, 8 vehicles | 10 walkers, 12 vehicles |
| Real lights | none | none | 2 bulbs + tube + sodium | 4 bulbs + tube + 2 sodium |

## 4. Runtime adaptation

* **Dynamic resolution** (`createScaler` in `scene/quality.js`, used by `scene/renderer.js`): a 1.2 s rolling mean of the frame time against a budget
  (about 38 fps; 34 fps on lite) steps the render scale down in 0.1 steps to the tier's floor with a 1.5 s cool-down. It goes back up only after 6 s well
  under budget and never above the highest scale that held (a failed upscale lowers that ceiling: no flapping). If two downscales in a row buy less than
  4 % (the CPU is the limit), or the floor is reached, it asks for a **tier downgrade** (auto quality only, never an upgrade). In a live medium-tier scene on SwiftShader it stepped 1.0 -> 0.9 -> 0.8 -> 0.7 -> 0.6 -> 0.5 in 18 s and stopped at the floor. Frames during the first
  2.5 s after start, a tier change, a context restore or a tab switch are ignored.
* **Draw-call guard** (`createDrawCallGuard` in `scene/quality.js`, fed by `scene/renderer.js`; Auto only, never an upgrade): the probe is a guess, the draw-call count is a fact. When the
  smoothed `renderer.info.render.calls` of a frame (the whole frame: shadow pass and post passes included; `info.autoReset` is off and the renderer resets it once a frame) stays
  above the tier's budget for 2 s AND the mean frame time over those 2 s exceeds the frame budget (about 38 fps; 34 on lite), the tier drops one step at once (without the 6 to 8 s of
  resolution stepping, which cannot help a draw-call-bound frame). A strong desktop that submits 1400 calls and still holds its frame rate is never punished. Budgets: **lite 250, low 350, medium 700, high 1000**
  (measured six-customer frames: 189 / 293 / 1147 / 1379). The pure function is unit tested; in a live scene (medium forced to auto, SwiftShader) it stepped medium -> low at 1110 calls and low -> lite at
  631 calls (the customers built at medium stay in the scene until they leave), each after the 2.5 s warm-up plus 2 s.
* **Shader warm-up** (`createProgramWarmer` in `scene/loader.js`, run by `scene/index.js` once the first state is in and the batcher is done): the programs compiled at load are not the ones the game draws
  with (at that moment the stall has 5 point lights instead of 11, `scene.environment` is not set, and the output colour space differs from the HDR target). Measured at medium, level 12: 89 of the 151 load-time
  programs were never used, and 30 to 80 more compiled mid-shift (events, weather, dishes, batched meshes). The warmer compiles the real scene in chunks (one per frame, 3 ms budget) with every hidden
  object made visible for the call, the HDR render target bound when the tier has post, one of each dish built and parked below the street, and, when a light is hidden (the prep counter's), a second pass with every
  light on. Result over 420 ticks of level 12 (programs compiled after the warm-up point, headless Chrome): medium 30 (70 in a run that met a late event) -> 17, high 30 -> 18, low 44 -> 11; the medium program count rises 151 -> 291 at warm-up (high 161 -> 306, low 91 -> 125) (about 0.25 s of compile calls on this machine, spread over frames and a dish build per frame).
  Left over: the event and weather materials whose state (instance colours, fog / map flags) is set only when the event starts, and the 12-light variant of customers built later. A restart follows a tier change.
* **Tab hidden**: the render loop stops on `visibilitychange` and restarts with a clean timer; adaptation is held for 2 s after the return.
* **Frame cap**: `renderer.shouldRender(nowMs)`, 30 fps on lite.
* **Context lost / restored**: rendering pauses (`lost`), the existing "error" status screen shows, three.js rebuilds its GL state on restore, the sky
  light and the render targets are rebuilt, the screen clears. Verified in headless Chrome with `WEBGL_lose_context` (sections 6 and 8).
* **Context creation failure**: one retry with plain attributes (no `high-performance`, no antialias), then `WebglUnavailableError` (`code: 'webgl'`),
  which `TiffinGameImpl` turns into the `webgl` status screen. `webglcontextcreationfailed`'s `statusMessage` is kept as the reason.

## 5. Loading and bundle

`TiffinGame.jsx` is now a 1 kB shell (`React.lazy`) so the solo home, the briefing and the lobby load the menus only; the 3D code starts downloading in
idle time as soon as the shell is imported (skipped on data-saver and 2G), and the real work happens in `TiffinGameImpl.jsx`.

| Chunk (gzip) | Before | After |
|---|---|---|
| Solo home: Tiffin part | 1 chunk, 461 kB + 15 kB css | shell 1 kB + menus / session / HUD / engine shared chunk (`session-*.js`) 52 kB + audio 30 kB + css 8 kB |
| three.js | inside the one chunk | `tiffin-three` 147 kB |
| People (face, hair, skin, bodies, limbs, clothes, customers, avatar, viewmodel, merge, baked) | " | `tiffin-people` 80 kB |
| Models (food, cookware, stations, street kit, pbr, textures) | " | `tiffin-models` 45 kB |
| Scene core (renderer, stall, street, sync, post, sky, fx) | " | `tiffin-scene` 61 kB |
| Dialogue lines (four languages) | " | `tiffin-dialogue` 55 kB |
| Impl (the play screen glue) | " | `TiffinGameImpl` 23 kB + css 8 kB |

The staged loader (`scene/loader.js`, `createTiffinSceneAsync`) builds in steps (GPU, 13 surface textures one by one, stall, street, people, shader
compile) with a progress bar and the line "Lighting the stove..."; the browser gets a turn after any slice over 12 ms. One step (the stall, 0.1 to 0.7 s
at medium) is still a single slice: splitting `createStall` / `createStreet` needs changes in files this work does not own. Shaders for the stall, the
street, a customer and a cook are compiled while loading (`compileAsync` where KHR_parallel_shader_compile exists), and the two parked actors stay in
the scene hidden so the programs stay cached until the first customer walks up.

## 6. Measurements (headless Chrome, SwiftShader, 640x360, level 6, six customers, first-person view)

Setup: Chrome (headless, `--use-angle=swiftshader`: a CPU rasteriser standing in for a slow GPU), 640x360, level 6, six customers at their counter spots, the cook
at the home spot, batching finished, one render of the scene measured with `renderer.info` (draw calls include the shadow pass where the tier has one).
"Before" is the committed tip `277283d` run through the same page; "after" is this work. Draw calls, triangles, geometries, textures and programs are exact and repeatable.
**The frame-time columns are not**: other processes were using the machine during the runs (a 4-minute swing in the load time of the same page was seen), and SwiftShader's
cost is dominated by pixel work, so use them only as ratios inside one table.

| Tier | Draw calls before | after | Triangles before | after | Visible meshes before | after | Geometries before | after | Textures before | after | Programs before | after | JS heap MB before | after |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lite | n/a | **188** | n/a | 145 k | n/a | 178 | n/a | 186 | n/a | 124 | n/a | 89 | n/a | 55 |
| low | 636 | **228** | 147 k | 145 k | 627 | 218 | 587 | 225 | 146 | 126 | 63 | 89 | 65 | 57 |
| medium | 1275 | **894** | 304 k | 288 k | 625 | 549 | 694 | 635 | 169 | 191 | 144 | 217 | 81 | 105 |
| high | 1275 | **992** | 314 k | 305 k | 625 | 568 | 694 | 626 | 172 | 171 | 146 | 223 | 89 | 113 |

Notes on the table:

* "Before" medium and high are identical because the tiers never reached the model libraries: customers, food and textures were always built at the library defaults
  (characters `high`, textures `medium`). The scene now tells the libraries its tier (`applyModelTier`).
* **Draw-call target not met at medium (150) or lite (80).** What a six-customer first-person view is made of after this work, per tier:
  lite 188 = stall shell + stations 52 + street 65 + customers 6 x (1 baked mesh + 2 ring discs + 1 blob) 24 + cook hands and forearms 12 + sky 1 + the rest;
  medium 549 visible meshes = 6 x about 58 for the customers (unmerged, see below) + 100 stall + 76 street + 12 hands.
  Customers merge well only by giving up their per-part skin materials (each skin part carries its own local-frame uniform), so static-mesh merging
  of a rigged customer saves only 10 to 25 % (62 -> 55 visible meshes at medium) and costs 70 to 370 ms per customer build, a hitch: it exists (`models/merge.js`,
  `setCharacterDrawMode({ merge: true })`) and is **off**. The stall's 99 and the street's 73 distinct materials set the floor for the scenery at about 170 draw calls without
  texture atlases (lite flattens them: 115 meshes -> 54 + 61 above).
* **Medium and high are still heavy, and the cheap fixes were measured and do not close the gap.** Same scene, `renderer.info` of one render (shadow pass included), level 6, six customers, 640x360:
  medium 977 calls / 299k triangles, high 1103 / 307k. (a) `setCharacterDrawMode({ merge: true })` while building at medium / high: 898 (-8 %) and 1024 (-7 %); it also costs 70 to 370 ms per customer build, and customers are
  built mid-shift, not only in the staged loader, so it stays **off**. (b) Pinning shadow casters under 0.15 m radius off: -122 calls (-12 %), under 0.3 m: -181 (-19 %), but `sync.js` re-sets `castShadow`
  after every build and the stall / street owners would have to agree: not done. The medium frame is 619 calls without the shadow pass and 977 with it (customers are 430 of them). Getting medium under 700 needs fewer meshes per
  customer (58 now) or a shadow proxy for people, a change in `models/customers.js` and the stall. Until then the draw-call guard (section 4) is what keeps medium off devices that cannot afford it.
* Customers at lite and low: 51 sources -> 4 meshes (office), family of two 87 -> 4; the cook 52 -> 1. Rig update rate 4 Hz waiting, 8 to 15 Hz otherwise.
* Programs went UP (63 -> 89 on lite / low, 144 -> 217 on medium) because one of every customer kind and a cook are parked in the scene hidden so their shaders compile at load.
* Shadow pass: tiny parts (eyes, lids, brows, glasses, fingers) are pinned out of the shadow casters on tiers with shadows.
* JS frame cost (JS time of one `tick`, `scene.debug.step`, on the test machine; it includes GL command submission, which SwiftShader makes expensive): lite 4.5 ms, low 7.8 ms,
  medium 25 ms, high 144 ms, against 380 ms (medium) and 243 ms (high) before. With CPU throttled 4x: lite 5 ms, low 6.6 ms; medium 435 ms against 573 ms before.
  The scene `update` alone (no render) is 0.4 ms (lite / low) to 2.8 ms (high).
* Frame rate: SwiftShader rendered 0.6 to 1.6 fps at 640x360 at every tier except lite and low (about 0.6 to 0.9 fps) because it is a CPU rasteriser running next to other work:
  **there is no honest fps number to quote from this machine.** Real expected frame rates are estimates from draw calls and pixel counts, not measurements:
  lite 30 (capped) on a 2015 phone or Intel HD 4000; low 45 to 60 on an Intel HD 5xx / Adreno 6xx; medium 60 on UHD 620 or Apple A14 and up; high 60 on a discrete GPU or M1 and up.
* Customer build cost (ms of JS, includes first-use work): lite 8 to 18 per customer (cook 8); medium and high unchanged from before (12 to 61 per customer at 1x; the 70 to 370 ms
  of the merging variant was measured and rejected). Shader compile of a new customer shape: 10 to 70 ms on lite; 50 to 1900 ms on medium / high, which the parked actors now absorb at load.
* Load: clicking "Start tutorial" to the HUD took 5.6 s on lite and 15.9 s on medium in this contended SwiftShader setup (dev server, unbundled modules; the real number on a GPU with the production
  bundle is much lower). The progress bar moved through 17 steps; the 13 procedural surface textures baked as slices of 50 to 150 ms each at medium (they were one 1.2 s block), and the stall and the street
  are still one slice each (about 1.2 to 1.4 s each under SwiftShader at medium; 0.3 to 0.4 s on lite).
* Context loss: `WEBGL_lose_context` lose then restore in headless Chrome: `lost` true then false, the scene renders again with the same draw-call count, no exception. three.js logs
  harmless "object does not belong to this context" warnings while it retires the old GL objects.


## 7. Browser compatibility audit

Method: static reading and `grep` over `src/games/tiffin-centre` and `shared/tiffin-centre` (non-test), the shader patches, the CSS, and the production build config; plus
what headless Chrome could confirm. Build target: Vite 8 default (`baseline-widely-available`), no `build.target` override, no polyfills.

| Area | Finding | Status |
|---|---|---|
| JS syntax | No `??=` / `\|\|=`, `#private`, static blocks, regex lookbehind, BigInt, top-level await in Tiffin code; the build transpiles to the target above | ok |
| `Object.hasOwn` | Used in sync.js, localSession.js, roomCore.js, movement.js, recipes.js, tutorial.js. Safari 15.4+, Chrome 93+, Firefox 92+ | ok for the declared floor (iOS 16.4); would fail on iOS < 15.4 |
| `structuredClone`, `Array.at`, `findLast`, `toSorted`, `replaceAll`, `Promise.withResolvers`, `AbortSignal.timeout`, `Intl.Segmenter`, `crypto.randomUUID`, `OffscreenCanvas`, `visualViewport`, pointer lock, fullscreen | None used in Tiffin code | ok |
| `requestIdleCallback` | Absent in Safari. New code (`loader.js`, `TiffinGame.jsx`) falls back to `setTimeout`; nothing else uses it | fixed |
| `ResizeObserver` | HUD and CoachMark already guard it; `TiffinGameImpl` called it unguarded: now falls back to the window `resize` event | fixed |
| `matchMedia(...).addEventListener` | All five call sites use `addEventListener?.('change')` behind `typeof matchMedia === 'function'` (Safari < 14 has only `addListener`; irrelevant at the floor) | ok |
| `AudioContext` / `webkitAudioContext` | `audio/index.js` tries both and returns `null` when neither exists or the constructor throws; the context is created on the first gesture | ok (verified by reading) |
| iOS audio unlock | iOS only counts `touchend` (not `pointerdown`) as the activation for `AudioContext.resume()`; `TiffinGameImpl` now unlocks on `touchend` too | fixed |
| `speechSynthesis` | `audio/speech.js` reads it through a null-safe accessor, voices are off until the player enables them, `onvoiceschanged` is set and cleared safely | ok |
| `navigator.vibrate` | Not called anywhere in Tiffin code | n/a |
| `localStorage` | Blocked / full / private-mode storage: the Graphics preference falls back to a session copy (`capabilities.js`); the other keys use `safeStorage.js` / try-catch (not re-audited) | ok |
| `navigator.connection` / `deviceMemory` / `getBattery` | Chromium-only; all optional, each read behind a guard, the battery probe times out after 0.8 s | ok |
| `document.fonts` | `loadFonts()` guards `document.fonts?.load` and races a 2.5 s timeout; the scene listens with `addEventListener?.` | ok |
| Pointer events, `setPointerCapture` | `setPointerCapture?.` optional-called; `touch-action: none` and `-webkit-user-select` set on `.tc` | ok |
| Passive listeners | Unlock listeners are passive; HUD listeners not changed | ok |
| CSS `inset`, `env(safe-area-inset-*)`, `clamp()`, `min()/max()`, `gap`, `scroll-snap`, `conic-gradient`, `:focus-visible` | Safari 14.1+ / Chrome 87+ / Firefox 66+ at worst | ok |
| CSS `:has()` | One rule in hud.css (hides an empty chip meta); an unsupported selector drops only that rule | ok |
| CSS `100vh` | Four `max-height: calc(100vh - N)` in hud.css (rail / chips, landscape and small screens). On iOS Safari `100vh` includes the area under the toolbar, so the lists can be up to ~80 px taller than the visible area | **unfixed** (HUD file, not in this work's ownership); suggested fix: `100dvh` with a `100vh` fallback |
| CSS not used | `dvh/svh`, `@container`, `color-mix`, `oklch`, `@layer`, `aspect-ratio`, `backdrop-filter`, `text-wrap`, nesting | n/a |
| three.js shader patches | Every `onBeforeCompile` chunk (skin, eye, food, tawa, oil, steam, flame, fur, post passes) is GLSL ES 1.00-style code that three.js converts for WebGL 2 (`texture2D` -> `texture`, `gl_FragColor` -> `pc_fragColor`, `varying` -> `in/out`); derivatives (`dFdx`, `dFdy`, `fwidth`) are core in GLSL ES 3.00. No `#extension`, no `RawShaderMaterial`, no explicit precision | ok |
| WebGL 1 / "no derivatives" degradation | Not reachable: three.js 0.187 requires WebGL 2, where derivatives, instancing and 3D-array features are always present. A WebGL 1 browser is reported as unsupported with that reason | by design |
| Half-float render targets | The post pipeline uses `HalfFloatType`; tiers with post are only chosen when `EXT_color_buffer_float` or `EXT_color_buffer_half_float` exists (iOS Safari 15+ has the latter) | ok |
| Firefox float-texture / blend quirks | Additive blending is done on half-float targets (needs the half-float extension only, not `EXT_float_blend`); no 32-bit float targets are used | ok (analysis) |
| MSAA render target | `samples: 4` only on high; three.js clamps to `MAX_SAMPLES`; the tier is capped at medium when `MAX_SAMPLES < 4` | ok |
| `package.json` | **three is imported by the code but is not in the committed `package.json`** (it is in the working tree, together with the `voices:gen` script, uncommitted). A clean checkout would fail to build | **unfixed, needs a commit by the owner of that change** |
| Dialogue per language | The four language files are one 55 kB (gzip) chunk; loading one language on demand needs a dynamic `import()` inside the dialogue director | unfixed (dialogue not owned) |


## 8. What was and was not tested

**Run here (headless Chrome 14x on Windows, SwiftShader):** the capability probe on a software renderer (it answered `lite: software renderer`), the whole app flow home -> tutorial
with the staged loader and its progress bar, the no-WebGL path (`--disable-3d-apis`: the "cannot draw the 3D stall" screen appears, nothing throws), a WebGL context loss and restore,
dynamic resolution in a live scene (medium tier, scale 1.0 -> 0.5 in 18 s with the tier left alone because it was explicit), the batcher and the baked people with before / after
screenshots at lite and medium, the production build and its chunk sizes, and 125 unit tests (`npx vitest run src/games/tiffin-centre`, PowerShell).

**Analysis only, never run:** Firefox, Safari (macOS and iOS), Samsung Internet, any real GPU (so no real frame rates, and the Auto policy's GPU-string lists were checked against strings from documentation, not against
real `WEBGL_debug_renderer_info` output from those devices), any phone, `deviceMemory`, the Battery API, `prefers-reduced-data`,
Data Saver, the auto tier downgrade path on a real device (the draw-call guard was run in a live medium-tier scene on SwiftShader with Auto forced on, where it stepped down twice; the scaler's tier verdict is unit tested,
`renderer.setQuality` is the same code the explicit setting uses), `KHR_parallel_shader_compile` (SwiftShader does not have it, so the warm-up's non-blocking behaviour is by reading three.js, not measured), iOS `touchend` audio unlock, the WebGL 1-only message (a fake context is unit tested; no real WebGL 1-only browser was available).

**Known limits of the numbers:** SwiftShader makes draw submission and pixel work CPU cost, the machine was shared with other builds, and the dev server serves unbundled modules; frame rates and
load times above are therefore ratios at best. The draw-call, triangle, geometry, texture and program counts are exact.

**Not done, and why:**
* Draw-call targets (150 at medium, 80 at lite, 20 / 8 meshes per customer at medium / lite): customers reach 4 meshes at lite and low, but 58 at medium and high; the total is 188 on lite and 894 on medium
  (see section 6 for what it is made of and why merging a rigged customer does not get there).
* Distance LOD for customers: every customer stands 2 to 5 m from the eye, so a distance switch would almost never trigger; the tier decides the build instead.
* Splitting `createStall` / `createStreet` into 12 ms slices, and a "static backdrop" street with no traffic at all, need changes in `scene/stall.js` and `scene/street.js` (not part of this work).
  The street is as cheap as its builder allows at lite (`vehicles: 0` still builds the minimum of five instanced vehicle meshes, no birds, no wires).
* Per-language dialogue chunks need a dynamic `import()` inside `shared/tiffin-centre/dialogue`.
* `100vh` in `ui/hud/hud.css` (iOS toolbar), see section 7.
* The pause menu's Graphics control: the setting and its API exist (`getGfxPref` / `setGfxPref` in `scene/capabilities.js`; `scene.setGraphics`), the UI is the pause-menu owner's.


## 9. Unsupported hardware

* No WebGL 2: the home screen works, the shift opens the "cannot draw the 3D stall" screen with Back / Check again; nothing throws.
* WebGL 2 but the GPU process dies or the context is lost: the "error" screen, with a reload button; the page recovers when the browser restores the context.
* Very slow GPU (software rendering): lite starts automatically, dynamic resolution takes over from there; the scene is playable at a few frames per second at best, and the loader
  never blocks input for more than one step.
* Memory pressure: only an explicit lite choice reduces memory further; nothing here loads assets, so the footprint is the JS heap (55 to 113 MB) plus GPU textures (about 120 to 190 textures).
