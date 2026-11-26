# Rendering and gameplay overhaul: playbook

Working agreement for the parallel workstreams on **Autowala** and **Tiffin Centre** (the two three.js games). Read it fully before you touch code.

## Why this exists (measured 2026-11-27, production build, headless Chrome on the dev laptop's *integrated* AMD Radeon GPU, 1536x864 @ 1.25)
Chrome on a hybrid laptop usually runs on the integrated GPU, not the RTX 3060, so that GPU is the machine players with ordinary laptops have. Both games are heavy on it.

| | tier | fps (uncapped) | p99 frame | hitches > 50 ms | draw calls | programs | notes |
|---|---|---|---|---|---|---|---|
| Autowala | auto -> medium | 43 | 113 ms | ~5 stalls of 100-450 ms per 6 s | ~300-420 | 162 | `pickQuality` says *high* on an 8-core, the sampler drops it; MSAA 4x half-float + UnrealBloom + 2048 shadows + native-resolution pixels |
| Autowala | low | 85 | 33 ms | 0 | | 143 | boot: 9 long tasks, 1.1 s |
| Tiffin Centre | medium | 15 (first seconds), then 53 only because the scaler fell to render scale 0.6 (a blurry image) | 917 ms, then 43 | 15 long tasks, 3.6 s, in the first 6 s | 324 | 311 | 19.5 s from "Start tutorial" to playable, 43 main-thread stalls (8.6 s) in the first 14 s; `setSize` is 6% of CPU in steady state (render targets being re-created by the scaler); `uniformMatrix4fv` 27%, `bindTexture` 10%, `useProgram` 6% = per-draw-call overhead |
| Tiffin Centre | high | 8 | 1187 ms | 17 long tasks, 4.4 s | 439 | 330 | |
| Tiffin Centre | low | 113 | 27 ms | 0 | 159 | 125 | |

Targets, on that same machine and viewport, in the game's **default** (auto) tier: **>= 60 fps average, p99 <= 25 ms, zero frames over 50 ms after the first 3 s of play, start-to-playable <= 6 s, no visible resolution loss (render scale >= 0.85 in steady state) and the picture no worse than today** (compare screenshots before and after; the games must not get uglier to get faster). Also: lower CPU use (less fan noise), lower GPU memory, and no memory growth over a 5 minute session.

## Landscape first (owner requirement, 2026-11-27)
Both games must be played **in landscape** on phones and tablets so the controls are usable: wide, short viewports are the primary design target, portrait is a "turn your device" gate on touch devices (the `landscape` stream builds the shared gate and the orientation lock in `src/platform/game/`; manifests get `orientation: 'landscape'`). UI streams therefore design **landscape first**: reference sizes 640x360, 740x360, 844x390, 915x412, 932x430, 1024x768 (tablet), then 1280x720 ... 1920x1080 desktop; thumb zones (left thumb steer / pedals or movement, right thumb actions), safe-area insets (notch), HUD that scales with viewport *height* (clamp / `--ui-scale`), nothing important under the thumbs or the notch, 44 px touch targets. Desktop windows that happen to be portrait must still work, but nothing is optimised for portrait phones any more.

## Workspace
You work in your own git worktree under `A:\Coding\Projects\GameHub-wt\<your-name>` (branch `perf/<your-name>`, already created from main, `node_modules` already junctioned). Your shell starts in the shared checkout `A:\Coding\Projects\GameHub`: **never edit or commit there**. Start every PowerShell command with `Set-Location A:\Coding\Projects\GameHub-wt\<your-name>` and use absolute paths under that folder for Read / Edit / Write.

## Measure first (the harness is in the repo)
`scripts/perf/README.md`: `node scripts/perf/bench.mjs --game autowala|tiffin --tier ... --profile --shot x.jpg`. It uses the real GPU, a production build and takes a machine-wide lock so benchmarks never overlap. Build and serve your **own** copy:

```powershell
Set-Location <your worktree>
New-Item -ItemType Junction -Path node_modules -Target A:\Coding\Projects\GameHub\node_modules   # once; never run npm install
npx vite build --outDir $env:TEMP\<yourname>-dist --emptyOutDir
Start-Process npx.cmd -ArgumentList 'vite','preview','--outDir',"$env:TEMP\<yourname>-dist",'--port','<yourport>','--strictPort','--host','127.0.0.1' -WindowStyle Hidden -PassThru   # note the PID
node scripts/perf/bench.mjs --game autowala --base http://127.0.0.1:<yourport> --port <yourcdpport> --label before ...
```
Take a **baseline run before you change anything** and keep the numbers: your report is judged by before/after on the same command. Use `--profile` to find the real hotspot instead of guessing; use `renderer.info`, `performance.now()` brackets and `EXT_disjoint_timer_query_webgl2` (if exposed) to split CPU from GPU. Try the experiment (render at 1/4 area: is fps up a lot? then it is fill-rate bound; unchanged? CPU / draw-call bound).
Other agents share the GPU: the lock handles benchmarks, but timings can still wobble +-10 %; repeat a measurement before believing a small win and compare back-to-back.

## Engineering rules
- Stack: React 19 + Vite, plain JS/JSX, `three@0.187.0`. **No new npm dependencies.** No network calls from the games, no CDN, no eval (CSP `script-src 'self'`). No secrets in `src/`.
- Run vitest and vite from **PowerShell**, not Git Bash (Git Bash makes every test fail with "reading config"): `npx vitest run src/games/autowala` / `npx vitest run src/games/tiffin-centre shared/tiffin-centre`. Do not leave dev servers or Chrome running: stop only the PIDs you started, **never kill processes by name** (other sessions run vite/Chrome/wrangler).
- Own files only (your brief lists them). A change you need elsewhere: make it small and mention it in your report; do not refactor other owners' files. You may add new files inside your own area.
- Pure logic has a unit test next to it. Existing tests must keep passing; a test you change must still test something real. Do not delete tests to get green.
- Performance work must be **measured** and **behaviour-preserving**: no popping, flicker, missing shadows, changed gameplay, or visual regressions. Verify with before/after screenshots at the same camera (view your screenshots with the Read tool: look at them, do not assume).
- No per-frame allocation in hot paths (`new Vector3`, array literals, closures, `.map/.filter` in the render loop); reuse scratch objects. Freeze what never moves (`matrixAutoUpdate = false` after one `updateMatrix()`), merge or instance what repeats, share materials, dispose what you drop.
- Mobile and low-end stay supported: touch controls, `prefers-reduced-motion`, the low / lite tiers, WebGL context loss, tab hidden. Do not break them.
- Commit early and often in **your worktree branch** with Conventional Commits (`perf(autowala): ...`, `fix(tiffin-centre): ...`), body says what was measured; end every commit message with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never touch `main`, never rewrite history. The lead merges your branch.
- Do not commit build output, logs, node_modules, scratch files. Screenshots that prove your work go in `docs/perf/<yourname>/` as JPEG (quality ~72, each <= 150 KB, at most 12 images). Your written report goes to `docs/perf/<yourname>.md`: what you measured, what you changed and why, before/after table, screenshot list, what you could not do and why, risks.

## Definition of done
1. Before/after numbers from `bench.mjs` for the default tier **and** the tiers you touched, in your report. 2. Your unit tests + the existing tests of your area pass (PowerShell). 3. `npx vite build` passes. 4. Screenshots viewed and described honestly in the report. 5. Everything committed on your branch. 6. Your final message to the lead: the branch name, the headline numbers, the list of files you changed outside your area, and anything unfinished. Say plainly what did not work; do not claim a win you did not measure.

## Who owns what
```
gfx-core   src/platform/gfx/**  (new shared engine layer), docs/GFX_ENGINE.md
aw-gpu     src/games/autowala/render/**, game/config.js, world/** (meshes, materials, batching, LOD, shaders), sim/auto*, sim/traffic mesh builders
aw-cpu     src/games/autowala/game/Game.js, game/camera.js, game/input.js, sim/** (logic), audio/**, boot staging, hot paths in gameplay/**; React render cost in ui/** (memo / selectors only)
aw-ui      src/games/autowala/ui/** (layout, look, behaviour), AutowalaGame.jsx; visual QA of the 3D picture (reports 3D defects, fixes only small ones)
aw-logic   src/games/autowala/gameplay/** (rules, fares, quests, career, workshop), shared Autowala pure logic, worker/ solo run API, tests
tf-gpu     src/games/tiffin-centre/scene/{post,quality,renderer,lighting,light-apply,sky,weather,capabilities,textures,fx,highlight}.js, models/shaders/**, material and texture files in models/ (pbr, materials-street, textures-pbr, textures, texgen, fabric, skin, noise)
tf-cpu     src/games/tiffin-centre/scene/{index,loader,stall,street,sync,interp,rig,camera,kit,art,art-signs,events-fx,ops-view,picking,tracker,vm,street-vehicles}.js, models/** geometry (merge, LOD, instancing), session/**, TiffinGameImpl.jsx (load / loop), React render cost in ui/** (memo / selectors only)
tf-ui      src/games/tiffin-centre/ui/**, tiffin.css, TiffinSolo.jsx, TiffinGame.jsx, OnlineGame.jsx; visual QA of the 3D picture
tf-logic   shared/tiffin-centre/**, worker/games/tiffin-centre.js, session logic contracts, tests
landscape  src/platform/game/** (orientation gate + lock, new files), src/pages/SoloGame.jsx and the online game page (gate wrapper only), `orientation` field in manifests, docs/perf/landscape.md
```
Another session (Android / Capacitor, worktree `GameHub-android`) owns `src/lib/haptics.js`, `src/lib/mobile.js`, `push.js`, `auth.jsx`, `main.jsx`, `shell/**`, `styles/**`, `public/**`: **read** them, never edit them.
Another stream may land a shared engine layer in `src/platform/gfx/` (GPU classification, start-up calibration, frame governor with dynamic resolution, tier memory, shader warm-up, batching helpers). If you are a GPU or CPU stream: **do not build a second copy of those**; make each tier itself cheap, and expose the knobs the governor needs (e.g. a `setScale(s)` that costs nothing, a tier table). The lead integrates the governor after the merge.
