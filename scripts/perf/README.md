# Perf harness for the 3D games

Measures Autowala and Tiffin Centre on the machine's **real GPU** (headless Chrome with ANGLE/D3D11, vsync and the frame cap off), so a
frame time is the true cost of a frame. On a hybrid laptop Chrome often picks the *integrated* GPU (the dev laptop: AMD Radeon Graphics, not the
RTX 3060), which is exactly the weak machine the games must run well on. Software rendering (`--soft`) is only for layout / screenshot checks.

```powershell
# 1. a production build in a scratch folder, served on its own port
npx vite build --outDir $env:TEMP\perf-dist --emptyOutDir
npx vite preview --outDir $env:TEMP\perf-dist --port 5701 --strictPort --host 127.0.0.1     # leave running

# 2. measure (from the repo root; one JSON line per run, appended to $PERF_OUT or <tmp>/jalebi-perf.jsonl)
node scripts/perf/bench.mjs --game autowala --base http://127.0.0.1:5701 --tier medium --label aw-medium
node scripts/perf/bench.mjs --game tiffin   --base http://127.0.0.1:5701 --tier high   --label tf-high --profile --shot out.jpg
```

Flags: `--tier low|medium|high` (Tiffin also `lite`; default = the game's own auto pick), `--w --h --dpr` (default 1536x864 @ 1.25, a typical Windows
laptop), `--warm` seconds before measuring (shader compiles and first uploads), `--seconds` measured, `--profile` (V8 CPU profile, heaviest self-time
functions), `--shot file.jpg`, `--soft`, `--label`, `--port` (Chrome debug port: use a different one per person), `--no-lock`.

Read the numbers like this:
- `fps` / `meanMs` / `p95` / `p99`: uncapped throughput. 60 fps needs `meanMs` <= 16.7 and `p99` <= ~25. On the integrated GPU anything under 30 fps is a bad experience.
- `hitches50` / `hitchMs`: frames over 50 ms. These (shader compiles, GC, texture uploads, geometry builds) are the stutter players feel even at a good average.
- `bootLongTasks`: main-thread stalls in the first seconds after the game starts.
- `calls` / `tris` / `programs`: draw calls, triangles, compiled shader programs (the last render's counters; Tiffin counts a whole frame).
- `--profile`: where the CPU goes. `(program)` is time not in JS (driver / GPU wait).

`lock.mjs` is a machine-wide mutex: every run takes it, so two benchmarks never share the GPU. `cdp.mjs` is the small DevTools client the scripts use
(it also launches Chrome from `CHROME_PATH` or the usual install folders, and only ever kills the Chrome it started).

## Autowala actors (customers, the player's auto)
`aw-actors.mjs` counts the draw calls of the people and the player's auto, split into camera pass (`v`) and shadow pass (`s`) per scene object, and
holds the quality tier from the very first frame (the renderer's frame-time sampler otherwise drops a busy machine to `low`, which has no shadow pass):

```powershell
node scripts/perf/aw-actors.mjs --base http://127.0.0.1:5724 --port 9771 --cmd suite --compact --out suite.json   # customers + auto default / customised / canopy + frame time
node scripts/perf/aw-actors.mjs --base http://127.0.0.1:5724 --port 9771 --cmd shots --dir shots --label before   # fixed-look customers, auto finishes, workshop
node scripts/perf/aw-actors.mjs --soft --no-lock --w 960 --h 540 --dpr 1 --cmd actors --near cam ...             # draw calls are the same on SwiftShader: no GPU lock needed
```

## Autowala GPU side (aw-probe.mjs)
`aw-probe.mjs` starts Autowala like `bench.mjs` (and takes the same lock) but holds the tier (`gfx.autoTier = false`; `--keep-sampler` for the game's own behaviour) and has one command per question:

```powershell
node scripts/perf/aw-probe.mjs --base http://127.0.0.1:5720 --port 9760 --tier medium --cmd suite --poi charminar --hour 19 --profile --compact   # bench + draws + gpu + tour in one lock hold
node scripts/perf/aw-probe.mjs --base ... --cmd bench     # frame times, long tasks, gfx.cost, CPU profile, screenshot (--shot)
node scripts/perf/aw-probe.mjs --base ... --cmd gpu       # GPU ms per pass from timer queries: frame / scene (incl. shadow) / shadow / post
node scripts/perf/aw-probe.mjs --base ... --cmd draws     # draw calls and triangles per scene object, camera vs shadow pass, material / program switches
node scripts/perf/aw-probe.mjs --base ... --cmd glcalls   # GL calls per frame by kind (where the CPU of gfx.render goes)
node scripts/perf/aw-probe.mjs --base ... --cmd programs  # every shader program: users, light counts, decoded flags (--full for JSON)
node scripts/perf/aw-probe.mjs --base ... --cmd tour      # teleports to every landmark at several hours / in rain: frames > 50 ms, new programs / textures
node scripts/perf/aw-probe.mjs --base ... --cmd exp       # one-page matrix: scale 0.5, shadows off / 1024, no bloom / FXAA, MSAA, lights 0 / 2, no traffic
node scripts/perf/aw-probe.mjs --base ... --cmd shots --label before --dir out   # fixed cameras (day / dusk / night / rain), HUD hidden
node scripts/perf/aw-probe.mjs --base ... --cmd boot      # long tasks and slow frames right after the game starts
```
`--tune '{\"medium\":{\"chunk\":1024}}'` overrides tier settings before the page loads (`tier()` in render/renderer.js); `--scale`, `--lights` set `gfx.setScale` / the lamp light count; `--poi --hour --weather` pin the player and the clock.
Draw-call counts do not depend on the GPU: `--soft --no-lock` (SwiftShader) gives exact `draws` / `glcalls` / `programs` and screenshots without queueing for the GPU. Frame times only mean something on the real GPU, and on a machine other people are using they wobble by +-30%: compare back to back.
