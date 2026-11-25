# Tiffin Centre: QA agent C proof (production build)

Branch `feat/tiffin-centre` at `0dbeab9` (detached worktree, `npx vite build` then `npx vite preview --port 5491`; a separate `vite` dev server on 5492 served only
`/shared/tiffin-centre/*.js` so the test bot could import the engine; the page under test is always the production bundle).
Headless Chrome via CDP, SwiftShader software GL (no GPU on this box), `localStorage` pre-seeded so levels 1-12 are open and the tutorial counts as done.
Screenshots: `docs/tiffin-centre-proofs/final-c/c-NN-*.jpg` (all <= 118 KB). Scripts: `<scratchpad>/c/*.mjs`.

Honest caveat for everything performance related: the browser has no GPU, so frame rates (0.2-1 fps) and times to first frame (19-160 s) are software-GL numbers, not
product numbers. Draw calls, triangles, geometry/texture/program counts and JS heap are renderer-side and valid. The 5 tiers x 300 s runs were launched in parallel
(contended); a second, serial, uncontended set (75-100 s each) is reported next to them.

## Result table

| # | Area | Verdict | Evidence |
|---|------|---------|----------|
| 1a | HUD 1280x800, L4 and L12, ops UI on: no overflow, no page scroll | PASS | `c-01-hud-L4-1280x800-*`, `c-01-hud-L12-1280x800-*` |
| 1b | Stations dock not clipped | **FAIL (medium)**, see B1 | dock 847 px wide holds 3 of 5 (L4) / 3 of 6 (L12) stations at 1280; the rest need a horizontal scroll (fade cue exists) |
| 1c | Speech bubbles not over panels | **PARTIAL (low)**, see B2 | 6 of 18 samples have a bubble partly behind a panel (top bar up to 51%, order rail up to 20%, subtitle bar 52%) |
| 1d | Landscape 844x390 keeps >= 55% of height free | PASS (thin) | free rows 58%, largest uninterrupted band 56%, both levels, status panel open |
| 1e | Tutorial coach bar not covering the stall | PASS collapsed, NOT VERIFIED expanded on phones | collapsed bar = 7% (1280x800, 390x844) and 13% (844x390) of the height; expanded card on an acknowledge step = 36-38% at 1280x800 (y 88-391); on phones the tutorial never got past the "look" step in my run, so no expanded phone shot |
| 1f | Portrait 390x844 (no threshold given) | NOTE, see B3 | free band only 21-28% with the status panel open; 9% in one L12 sample |
| 2 | Co-op replay (2 players, real GameRoom messages, L4 and L12) | PASS (18/18 checks x 4 runs) | `c-05-coop-*` (hud, emote, connection-lost, leave, results for L4 1280 + 390, L12 1280 + 844x390) |
| 2a | Leave button in the top bar (no pause in co-op) | PASS | rect 82x44 at x1184,y10 inside the 1252x69 top bar, clear of the dock |
| 2b | Emotes clear of the gas gauge / status panel / dock | PASS | emotes y125-169 vs gas y180-232 at 1280x800; emote float x1079,y96 |
| 2c | Teammate chips | PASS | chip "Cook 2 / Empty hands" at y87-119, no overlap with top bar, gas, status |
| 2d | Connection-lost screen, reconnect | PASS | "CONNECTION LOST ... Reconnect / Leave table"; after reconnect HUD back, no status screen |
| 2e | Results with profit | PASS | L4: takings 2,170 + tips 1,012 - cost 740 = profit 2,442; L12: 4,620 + 2,568 - 1,353 = 5,835 |
| 3a | Auto-save/resume (practice L4, 46 ticks) | PASS | tick 46 / money 295 / lives 5 / gas {u:402,sw:0} / 10 stock items / fresh equal before quit and after Resume; the whole engine state JSON is byte-identical (rng included) |
| 3b | Resume card, resumed shift starts paused | PASS | `c-03-autosave-resume-card.jpg`, `c-03-autosave-resumed-paused.jpg`; tick frozen at 46 while the card waits |
| 3c | Hard reload mid-shift, then Resume | PASS | saved tick 62 / money 459 / lives 5 / gas 398 equals the resumed state; plays on (62 -> 72) |
| 3d | Corrupt saves (8 variants: not JSON, truncated, wrong kind, bad checksum, `{}`, 300 KB junk, `null`, `[1,2,3]`) | PASS | no card, home OK, fresh shift starts at tick 0, no exception (`c-03-autosave-corrupt-fresh-start.jpg`) |
| 3e | localStorage blocked (getter throws SecurityError) and setItem throwing QuotaExceededError | PASS | home renders, tutorial plays (tick 1 -> 9), leave works, no Resume card, no errors (`c-03-storage-*`) |
| 4 | No WebGL, both ways (`--disable-gpu --disable-3d-apis`, and a getContext override) | PASS (11/11 each) | `c-04-nogl-*` |
| 4a | "This device cannot draw the 3D stall" card with "Check again" and "Back to games" | PASS | shown 3.7 s after Open the stall |
| 4b | No clock running behind it | PASS | practice and tutorial: status `paused`, tick 0 unchanged over 9 s and 6 s; nothing written to the save slot |
| 4c | Check again / Back | PASS | Check again reloads to home (no Resume card); Back goes to `/games/tiffin-centre` and the never-shown shift is cleared |
| 4d | Card at 844x390 | PASS with nit B4 | buttons visible but flush with the bottom edge (card 399 px in a 390 px view) |
| 5 | Graphics tiers | PASS for the engine, **not wired in the UI**, see B5 | table below |
| 6 | Network | PASS | table below |
| 7 | Console | PASS (no real errors) | section below |

## 1. HUD layouts (levels 4 and 12, status panel open, bot playing ~30 s)

Metric: "free rows" = share of viewport rows not covered by a HUD panel that spans the centre column; "band" = tallest uninterrupted free stretch.

| Viewport | Level | free rows | band | stations visible / total | bubble overlaps seen |
|---|---|---|---|---|---|
| 1280x800 | 4 | 74% | 69% | 3 / 5 (dock 847 of 1073 px) | rail 5%; top bar 51% (status closed) |
| 1280x800 | 12 | 74% | 69% | 3 / 6 (dock 847 of 1311 px) | rail 20% and 18% (status open); top 2% |
| 390x844 | 4 | 26% (29-37% other samples) | 21% | 1 / 5 | subtitle bar 52% |
| 390x844 | 12 | 33% (30%, 14% closed sample) | 28% (9% closed sample) | 1 / 6 | status strip 99% (closed sample) |
| 844x390 | 4 | 58% | 56% | 2 / 5 | top bar 42% (status closed) |
| 844x390 | 12 | 58% | 56% | 2 / 6 | top bar 16% |

Screens: `c-01-hud-L{4,12}-{1280x800,390x844,844x390}-{status-open,bubbles}.jpg`. The prep sheet was not opened (no prep button was found by my selector; the
status panel and the prep chips were on screen). Tutorial coach: `c-02-tutorial-coach-*`.

## 2. Co-op

Replay harness: a real `GameRoom` + tiffin adapter, 2 seats driven by the engine bot, seat 1's `room`/`state` messages recorded (L4: 378 states, L12: 800 states,
including a teammate emote at tick 39) and replayed into the real client through a fake WebSocket (`window.WebSocket` proxy). The server clock and the actions the
client sends were verified (`{"t":"action",...}` messages appear for move, cook, emote). Reconnect, drop (1006) and the Leave confirm ("Leave the stall? The shift keeps
running for the others and your seat ends. 1 friend is still serving, they will miss you.") all behaved. Note: in a first, heavily contended run the L4 1280x800 reconnect
check failed (screen still "reconnecting" after a fixed 1.8 s wait); with a proper wait it passed on the rerun, so that was my harness, not the game.

## 3. Auto-save details

Save envelope `{v:1, kind:'shift', sum, data}` is 3.3 KB at tick 46. Quit writes the exact paused tick. Resume restores the pause (the clock does not move until the
player presses Resume in the pause menu). Corrupt/foreign envelopes are rejected silently and a normal fresh start follows (the junk stays in storage until the next
save overwrites it; it is not shown as a Resume card).

## 5. Graphics tiers (practice L12, 1280x800, bot playing, production build)

The setting is read from `localStorage['jalebi.tiffin.gfx.v1']` (pref `auto|lite|low|medium|high`). No UI sets it (B5). `auto` chose `lite` here (software GL).

Draw calls and triangles per frame (uncontended 75-100 s runs; "end" window = ~tick 100):

| Tier | draw calls avg / max | triangles avg / max | geometries / textures / programs | JS per frame avg / p95 | first interactive frame* |
|---|---|---|---|---|---|
| auto (= lite) | 323 / 415 | 163k / 216k | 470 / 200 / 125 | 1016 / 3997 ms | 38.1 s (HUD at 31.9 s) |
| lite | 189 / 254 | 142k / 155k | 468 / 201 / 121 | 134 / 423 ms | 24.9 s (HUD 19.1 s) |
| low | 293 / 337 | 152k / 176k | 507 / 188 / 118 | 457 / 2449 ms | 43.0 s (HUD 34.8 s) |
| medium | 1147 / 1165 | 275k / 279k | 912 / 232 / 171 | 553 / 1495 ms | 42.0 s (HUD 30.6 s) |
| high | 1379 / 1421 | 357k / 362k | 1059 / 263 / 182 | 3040 / 9859 ms | 161 s (HUD 143 s; ran beside other jobs) |

\* "Open the stall" click to the shift clock running (the clock waits for two frames on screen). Software GL is dominated by shader compile (115-180 programs). The home
menu itself is interactive in 1.2-3.0 s after navigation (FCP 1.0-2.6 s, DOMContentLoaded 0.2-1.8 s, 554 KB transferred, 40 requests).

5-minute runs (5 tiers started together, so contended; the numbers that matter are the counts and the heap). Columns are the samples every ~30 s:

| Tier | JS heap MB (start .. end, max) | geometries | textures | programs | DOM nodes |
|---|---|---|---|---|---|
| auto | 27.8 .. 45.2, max 64.4 | 170 -> 654 | 100 -> 195 | 90 -> 133 | 1.4k-5.3k |
| lite | 27.0 .. 53.6, max 64.9 | 174 -> 710 | 100 -> 207 | 91 -> 133 | 1.5k-4.7k |
| low | 24.5 .. 49.1, max 49.1 | 170 -> 738 | 100 -> 205 | 90 -> 132 | 1.2k-3.0k |
| medium | 28.0 .. 49.5, max 54.5 | 297 -> 1187 | 130 -> 289 | 135 -> 264 | 1.4k-3.3k |
| high | not completed in the parallel batch (Chrome did not start in time); see the 100 s solo run: heap 23.7 -> 46.6 MB, 742 -> 1059 geometries | | | | |

Heap is a sawtooth (GC), no upward trend: it is lower at the end than at the peak in every tier. Geometry counts rise during the first minutes; to check that this is not
a leak I ran a 400 s probe on lite that compares the geometries attached to the scene with `renderer.info`: the scene holds a steady ~930-1370 geometries (it falls back
to 982 when the next shift starts), the GPU side plateaus at ~660 and stays flat through the shift restart (664 -> 660), textures plateau at ~210, programs at 136. So it is lazy
first-use upload into a bounded cache, not a leak. One thing to watch: on medium, shader programs jumped 182 -> 264 around tick 150-180 (a new event or lighting state
compiling mid-shift): on a real GPU that is a possible hitch (B7).

## 6. Network (production preview, cache disabled, gzip sizes as served)

| Page | requests | transferred | Tiffin chunks |
|---|---|---|---|
| `/` | 59 | 899 KB | only `tiffin-catalog` (5.3 KB, 15 KB raw, `modulepreload`). No 3D chunk, no `tiffin-three`. PASS |
| `/games/tiffin-centre` | 60 | 625 KB | only `tiffin-catalog`. PASS |
| `/play/tiffin-centre` (home menu) | 54 | 1,247 KB | the 3D set is prefetched at idle while the menu is read (by design, `prefetchTiffinGame`): `tiffin-three` 147 KB, `tiffin-dialogue` 90, `tiffin-people` 82, `tiffin-scene` 75, `tiffin-models` 52, `TiffinGameImpl` 36 (+12.5 CSS), `tiffin-audio` 20, `TiffinSolo` 1.4, catalog 5.3 = ~520 KB |
| after Start tutorial | 3 | 57 KB | no new JS: two font files (18.5 + 17 KB) and `jalebi-mark.svg` (21.7 KB). The fonts are only fetched at game start |

`c-06-network-tutorial-running.jpg` shows the tutorial running after those requests.

## 7. Console

Across every flow (3 layout viewports, auto-save, 2 no-WebGL modes, 2 storage modes, 4 co-op runs, 5 tiers x 2, network, leak probes), unhandled rejections hooked:
zero exceptions, zero unhandled rejections, zero `console.error` from the app.

Expected (headless artefacts, not product problems): `The AudioContext was not allowed to start` (about 16 per flow; my clicks are synthetic, so no user gesture), SwiftShader
`GL Driver Message ... GPU stall due to ReadPixels`, and `Blocked call to navigator.vibrate` (3, no real tap). One real-but-harmless warning in every WebGL flow:
`THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported` (SwiftShader lacks it; real GPUs have it). No-WebGL flows produced no console error at all.

## Bugs

| ID | Severity | File | Symptom | Suggested fix |
|---|---|---|---|---|
| B1 | medium | `src/games/tiffin-centre/ui/hud/hud.css` (`.tc-hud-dockwrap`, StationsDock) | At 1280x800 the stations dock is 847 px wide (the hands tray and quick buttons own the left 400 px of the bottom row) so only 3 of 5 (L4) / 3 of 6 (L12) stations show; the 4th is sliced mid-card (`c-01-hud-L12-1280x800-bubbles.jpg`). Reachable by scrolling, but that is a poor default on desktop. | Let the dock span the full row on desktop (hands tray above it) or let cards shrink; at least scroll the dock to the cook's current station. |
| B2 | low-medium | `ui/hud/WorldBubbles.jsx`, `projector.js` | World speech bubbles can sit partly behind the top bar (51% at 1280 L4, 42% at 844x390 L4, 16% L12), the order rail (up to 20%) or the subtitle bar (52%, portrait). The same line is also shown in the subtitle bar, so the covered bubble is redundant but looks cut. | Clamp bubble anchors below the top bar / outside the rail, or hide the world bubble when the subtitle bar shows the same line. |
| B3 | medium | `ui/hud/OrderRail.jsx`, `hud.css` | At 390x844 the HUD covers 67-91% of the height (free band 21-28%, 9% in one L12 sample with 3-4 orders). Order cards expand into a ~330 px mostly blank paper (`c-01-hud-L12-390x844-bubbles.jpg`). The stall is a ~25% strip. | Cap the rail's height in portrait (collapse extra cards to chips), or shrink the status strips when orders are up. |
| B4 | low | `ui/menus/StatusScreen.jsx` / `StatusPanel` (not tiffin.css) | 844x390 no-WebGL card is 399 px tall in a 390 px view; the buttons are visible but touch the bottom edge. | Tighter padding or `max-height` + scroll in landscape. |
| B5 | low (feature gap) | `scene/capabilities.js`, `ui/menus/PauseMenu.jsx` | `setGfxPref` exists and persists `jalebi.tiffin.gfx.v1`, but no screen offers it (pause menu has no Graphics row), so players cannot pick a tier. | Add a Graphics row (Auto/Lite/Low/Medium/High) to the pause menu or hide the claim. |
| B6 | info | n/a | On software GL the first frame takes 19-43 s (lite..medium) and 143 s (high); `auto` correctly picked lite. Not measurable here as a product number. | Repeat on a real GPU and a mid phone before sign-off. |
| B7 | low (verify on GPU) | `scene/*` | Medium tier compiled ~80 extra shader programs mid-shift (182 -> 264 around tick 150-180); lite/low plateau by tick 150. Possible mid-shift hitch. | Pre-compile the event/lighting variants during load (`compileAsync`). |

Not fixed: I changed nothing in the repo except adding this file and the `final-c` screenshots (no edits to TiffinGameImpl.jsx or tiffin.css were needed).
