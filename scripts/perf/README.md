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
