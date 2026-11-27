# aw-final: the last render-side gaps of Autowala (wave 3)

Branch `perf/aw-final` (cut from main `6aaf2be`). Machine: the dev laptop's integrated AMD Radeon (Chrome on D3D11 / ANGLE), headless Chrome, production builds served from
`vite preview`, 1536x864 @ 1.25 unless a row says otherwise. The machine is shared with the other streams: **frame times wobble by +-10-30 % between runs**, so every comparison below
is either a counter (programs, GL calls: exact), or taken back to back in one lock hold / one page. Where a number is one run it says so.

## Headline

**On the final build, the default tier on this laptop's integrated GPU, no shader program is built after the loading bar** (day cycle, rain, garage, 7-leg tour: main builds 166, 16 of them in the
shadow pass, at 549-644 ms a frame; the game's own counter of frames over 100 ms: 17 -> 0), **the daytime frame is 17 % cheaper** (the bloom's seven passes are skipped while nothing reaches its threshold:
12.15 -> 10.11 ms in one page, picture identical to 0.03 of 255; post chain by day 8 passes / 95 GL calls -> 1 / 11), and the workshop no longer has a light set of its own (it borrows the street's: 2 x 75 programs and the
trickle of 700-900 ms frames at the garage gone; the night garage differs a little in the picture). Alternating with main in one hold, auto tier 1536x864: **67.4 -> 74.2 fps median (+10 %)**, p99 32.7 -> 31.6 ms, ended on
scale 1.0 in 3 of 3 (main: 1.0 / 0.69 / 1.0). Quiet-machine runs reach 138-150 fps, but the machine's speed moved 2x between holds, so that is not a measured gain of this branch.

**Not reached, plainly:** p99 <= 25 ms (the HUD's frames hold it at 26-33 ms even at 100 fps), zero frames over 50 ms after the first 3 s (0 on quiet windows, 0-8 on busy ones, none of them a program build), and
a steady render scale >= 0.85 under load (the governor goes to 0.55-0.9 or low when other sessions use the GPU). Shadow cadence and program-switch / material merging were measured or inspected and **do not pay**
(sections 3, 4). Details, tables, pictures and what I could not prove below.

## What was measured, and with what (new tools in `scripts/perf/`)

* `aw-warm.mjs` (new): a fixed life cycle in ONE page (noon, a dusk sweep, night, dawn, a second dusk, rain by day and night, the garage by day / night / rain, optionally a teleport tour)
  and every shader program built after the loading bar, with the pass (shadow / camera), the object that triggered it and the length of the frame. `--strict` exits 1 when there is one.
* `aw-shots.mjs` (new): fixed cameras, HUD hidden, the city paused (`--pause`), several variants of one page, a pixel diff between them (and an amplified diff image), `--compose` for
  before | after pairs.
* `aw-ab.mjs` got presets (`bloom3`, `bloomon`, `shadow33`); everything else is the existing harness (`bench.mjs`, `aw-draw.mjs`, `matrix.mjs`).

## 1. The light-set freeze: depth programs, and the workshop

**What `aw-warm.mjs` found on main (`6aaf2be`), real GPU, medium held, one life cycle (day, dusk, night, dawn, rain, garage):** 165 programs built after the loading bar.
Two different causes, not one:

1. **The depth (shadow-pass) programs of the night light set** (aw-draw's finding, confirmed and attributed by the object that triggered each): at the first frame with the lamp pool lit
   the shadow pass built 5 `MeshDepthMaterial` programs in ONE frame (terrain instanced + colour, the shops' shadow proxy, props instanced, props instanced + colour, the auto's
   double-sided wrapper mesh; a 6th, the skinned customer, at the first customer): **616-677 ms** on the integrated GPU. `renderer.compile` never builds them: their program key carries the
   same light counts as every lit program, and they were only built when the shadow pass first drew them.
2. **The workshop's two light sets, built in play.** The workshop added a spot and two point lights, i.e. its own light set: 2 x 75 programs (measured: 1.99 s and 1.74 s to build each at
   full speed). `game/Game.js` trickled them in while playing as soon as the player had been parked at the garage for 3 s after the first 20 s of the session (the garage is where the game
   starts): in the same run **64 + 75 programs between dusk and dawn, 17 frames over 50 ms, worst 741-897 ms**, and 5 depth programs + a 400-820 ms frame at the first opening of the
   workshop. (The "rain +27..31" of aw-draw's tour is this same trickle arriving in the rain legs: there is nothing rain-specific, 0 programs are built when it starts to rain.)

**What was done**
* `game/warm.js`: a light set now includes its shadow pass. `depthParts(scene)` lists one caster per distinct shadow program (kind of object x side x custom depth material), `depthStandIn` is
  three's shared depth material (`new MeshDepthMaterial()` in r187: NOT the RGBA-packed one, which was the first attempt and missed) configured as `getDepthMaterial` does, and each one is
  compiled against a light-only scene with the recipe's lights and **no fog** (the shadow pass hands the program key an empty scene; `fog` is a bit of every key: this was the second
  miss). At boot the **night** set's 7 depth programs are built this way, in parallel with the rest. **The day set's are not**: a first version built both and was bisected
  (`aw-probe --cmd boot`, interleaved, the 400 frames after START, sum of the frames over 40 ms): both sets 2.1-2.5 s, day only 2.4 s, **night only 1.6 s, main 1.5-2.0 s**. Building the day set ahead
  made the loading bar 0.6 s shorter (`game.boot.compile` 0.6 s against 1.2 s) and the first seconds of play ~0.5 s worse: the programs the boot frame no longer waits for leave their first-draw
  work to the GPU process while the player already plays. The day set is the one the boot frame draws for real, so it stays with the boot frame (`warm(set, { depth: false })`); later calls (a tier
  step, a restored context) still build both. On the final build the same probe reads: new 2.5 / 3.2 / 2.5 s, main 2.6 / 2.7 / 3.0 s (a busier moment: both worse, no difference).
* The workshop **borrows** its three lights (`gameplay/workshop/light-bank.js`): two lamp-pool lights (`world/props.js` `lend` / `unlend`) are the pink and cyan rims and the auto's headlight spot is
  the key light; while any is lent the day shows as many lights as the night does (`game/light-sets.js` `visibleLights`), so a lit garage is one of the two light sets that are built at boot. The
  in-play workshop warm-up in `Game.js` is deleted; `lightSet` has no `workshop` flag. The headlight comes back in the colour the loadout has at that moment (a headlight bought inside the
  garage: `sim/customize.js` keeps `ud.headlightHex`; found while reviewing, not by a test of the old behaviour).

**Proof** (`aw-warm.mjs --strict --tour`, final build, SwiftShader, `--warm 25`, exit code 0): **0 programs built in play** over day, dusk, night, dawn, dusk, night, rain by night and by day, the garage by day,
by night and in the rain, and a 7-leg teleport tour (Charminar dusk, Cyber night / rain, Birla, stadium in rain, station, CNG in rain). Main in the same harness: 77 (SwiftShader) / 165 (real GPU).

Real GPU, `aw-warm.mjs --tour`, medium held, 24 phases (the life cycle above + the 7-leg tour); main and the final build one run each, back to back in one session, **the machine was busier during the
final run** (sustained 40-60 ms frames in the dusk and station phases):

| | main `6aaf2be` | aw-final (final build) |
|---|---|---|
| programs after the loading bar | 167 | 174 (+7: the night set's depth programs) |
| `game.boot.compile` (ms) | 1370 (a second main run: 1485) | 1341 (no gain: see above; the first version measured 727-741) |
| programs built in play | **166** (16 of them in the shadow pass) | **0** (0 in the shadow pass) |
| frames over 50 ms | 27 | 36 (sustained 50-90 ms frames of a loaded machine, no program built in any) |
| frames over 150 ms / worst frame | 15 / 644 ms (workshop opening), 599 ms (dawn), 571 ms (night) | **0 / 89 ms** |
| the game's own counter (frames > 50 / > 100 ms since 3 s after START) | 29 / 17 | 53 / **0** |
| frames in the run | 9966 | 7636 |

So what is removed is the compile-caused freezes (15 frames of 150-640 ms in this window; 17 frames over 100 ms in the game's counter -> 0); the 40-90 ms frames that remain are not caused by
program builds and move with the load of the machine.

## 2. The post chain

**Counted** (the GL calls between `setRenderTarget` and the end of each pass, `exp-postcalls`, medium, 4 bloom levels): prefilter 12, down 12 / 10 / 10, up 15 / 11 / 11, composite 14 =
**8 passes, 95 GL calls** (aw-draw's 156 were the same passes counted with the calls that follow each draw). Every pass costs 10-15 calls whatever it draws: `bindFramebuffer`, `viewport`,
`scissor`, two `depthMask`, `enable` / `disable` (three's `render()` ends every call by switching depth test and mask back on and the next material switches them off again: inherent in
`renderer.render(mesh, camera)`; `renderBufferDirect` cannot be called outside `render()`, so there is no cheaper way to draw a full-screen triangle through three), `useProgram`,
two uniforms, `bindTexture`, `bindVertexArray`, `drawArrays`.

**What paid: the bloom is not drawn by day.** By day the bright pass's threshold is 2.2 and nothing in the picture reaches it. Measured with `aw-shots.mjs` in a paused world (same camera, bloom
levels 4 vs 0, medium, 1536x864 @ 1.25, amplified diff images looked at): mean absolute difference **0.006-0.026 of 255**, **0-0.01 % of the pixels over 2 levels**, worst pixel 3-43 (isolated, tree sway
that the pause does not stop) at Charminar (12:00), the shops, the glass towers (11:00) and the sunset (17.9): that is dither noise, not a halo. `render/post.js bloomWanted(night)` (on above
`night` 0.04, off below 0.02: the palette's `night` is 0 from 08:30 to 16:12, 0.08 at 17:36, 0.35 at 18:42) and `renderer.setBloomEnabled` switch the tier's levels off by day without
reallocation or a new program (the plain composite is built up front). Chain by day: **8 passes / 95 GL calls -> 1 pass / 11 GL calls** (-88 %). Interleaved in one page (Charminar, 12:00, medium held, 4 rounds, table in section 3): **12.15 -> 10.11 ms per frame (82.3 -> 98.9 fps)**, CPU time of `gfx.render` 11.0 -> 9.2 ms, GPU timer 10.7 -> 10.2 ms,
and `base` was the faster of the two in every round. The p99 does not move (31.1 -> 26.7 ms: the HUD's frames, see below).

**What did not, and why** (target "<= 4 passes, <= 80 GL calls": met by day, **not at night: 8 / 95**): dropping a bloom level on medium (`bloomLevels: 3`: -2 passes, 95 -> 73 GL calls at night) changes the
picture very little: `aw-shots.mjs`, paused world, 4 vs 3 levels at three night cameras: mean absolute difference **0.03 / 0.11 / 0.04 of 255**, 0.01-1.07 % of the pixels over 2 levels, worst pixel 12-29 levels (the core
of the neon sign's halo); 2 levels: 0.04-0.22, up to 5 % of the pixels over 2 levels. But its frame-time gain is ~0.2 ms of CPU per pass, at night only (about 1 % of the average frame over a day cycle), and
I could not measure it: `bloom3` 13.9 ms and `bloom0` 13.9 ms against 12.2 ms for the 4 levels at 21:00, in a page that drifted by 4-6 ms. So I did not apply it (it is the first thing to try when the night
frame is the problem); folding the three up-passes into one combine pass (also -2 passes, ~-22 calls) would change the glow's shape and I did not try it.

## 3. Shadow cadence (not changed: it does not pay)

The brief assumed `shadowInterval` 0.024 s redraws the map on every frame at 50 fps. It does not: `shadowDue` is time based (`since >= interval`), so at 50-60 fps (frames of 17-20 ms) the map is
already redrawn on every 2nd frame, and on every 3rd at the 100 fps the day now runs at; it is redrawn every frame only below ~42 fps. Measured interleaved in one page (`aw-ab.mjs`, medium
held, Charminar, 4 rounds x 3 s, median per variant, real GPU):

| hour / variant | fps | mean ms | p50 | p99 | CPU of `gfx.render` | GPU timer | per-round mean ms |
|---|---|---|---|---|---|---|---|
| 12:00 `base` (bloom skipped, shadows every 24 ms) | **98.9** | 10.11 | 10.3 | 26.7 | 9.19 | 10.19 | 10.1 10.1 11.3 9.5 |
| 12:00 `bloomon` (the old behaviour: bloom drawn by day) | 82.3 | 12.15 | 11.6 | 31.1 | 11.01 | 10.7 | 11.9 11.7 14.4 12.2 |
| 12:00 `shadow33` (interval 0.033 s) | 89.7 | 11.15 | 10.9 | 26.0 | 10.06 | 9.96 | 10.2 10.8 11.3 11.1 |
| 12:00 `noshadow` | 101.7 | 9.83 | 9.8 | 15.5 | 8.36 | 9.89 | 9.7 9.8 9.5 10.6 |
| 21:00 `base` | 82.0 | 12.20 | 12.0 | 32.1 | 11.07 | 12.13 | 10.4 12.2 11.9 15.6 |
| 21:00 `bloom3` (3 levels: -2 passes) | 71.8 | 13.93 | 13.2 | 31.9 | 12.61 | 12.9 | 13.3 11.0 14.0 13.9 |
| 21:00 `bloom0` (no bloom at all) | 71.9 | 13.90 | 13.4 | 31.3 | 12.49 | 13.35 | 12.5 13.6 14.6 13.9 |
| 21:00 `shadow33` | 64.5 | 15.50 | 14.9 | 32.6 | 14.09 | 15.52 | 11.3 15.5 14.9 16.3 |
| 21:00 `noshadow` | 81.4 | 12.28 | 11.7 | 29.4 | 11.00 | 10.6 | 9.4 12.3 12.3 12.1 |

How to read it: the **day** rows are consistent round by round (`bloomon` is slower than `base` in each of the four rounds, by 1.6-3.1 ms: the bloom skip is worth ~2 ms = 17 % of the day frame,
and it is almost all CPU: 1.8 ms of `gfx.render`); the `shadow33` and `noshadow` rows are inside the round-to-round noise of this laptop (+-1.5 ms). The **night** rows are not usable
for ranking: the machine drifted by 4-6 ms inside the page (per-round means 9.4-16.3 ms; `bloom0` slower than `base` cannot be real), so night shows only that none of the variants is a
clear gain. p99 is 26-32 ms in every row including `noshadow`: it is the HUD's snapshot frames (aw-int, section 6), not the shadow pass.

So there is nothing to cut: the whole shadow pass (`noshadow`) is worth 0.3 ms of a 10 ms frame in the day, and a longer interval (0.033 s) measured the same as the current one inside the
noise. A longer interval would only make the shadow of the moving auto and people lag further (0.5 m at 24 m/s per 20 ms), so `QUALITY.*.shadowInterval` and the tier table in
`game/config.js` are unchanged. The earlier "shadow 3 ms" figures were taken at 40 fps where it is redrawn every frame.

## 4. Program switches and materials (not done)

Looked at, measured, **not changed**. Charminar at noon on the final build (`aw-draw.mjs --cmd scenes --rows --progs`, SwiftShader counts): 128 camera draws + 28 shadow draws, 820 GL calls, 49 program
switches of 50 programs in view; by object: shops 12 draws / 94 GL calls, props 23 / 77, the auto 8 / 64, metro 16 / 61, landmarks 12 / 60, terrain 7 / 38, buildings 8 / 28, signals 11 / 26, rule art 8 / 20.
Program switches are 30 draws of ~10 calls each (~300 calls, 37 % of the frame's calls); instanced same-material draws cost 2.1 calls. The cheapest remaining cut is the shops' textured
materials (7-12 distinct `MeshStandard/map` materials in a shop street, each a material switch of ~7 calls): a per-shop atlas of sign + canopy + takeaway tags would save ~2 draws per shop in view
(about 20-25 calls, 3 % of the calls, ~0.3 ms), but it touches the four shop builders' drawing code and texture memory (aw-draw's estimate: +80 %) for that. The props' 23 draws are 8 instanced
sets x tiles with different geometries (not mergeable without BatchedMesh) and 4 programs. I judged both not worth the visual risk in this stream; with the post chain at 1 pass by day and the
light sets fixed, what is left of the draw-call work is a long tail of 1-3 % items.

## 5. ARCHITECTURE.md and the lamp lights

Addendum 5 said "the lamp point lights stay visible with intensity 0 by day"; `world/props.js` toggles `visible`. **The code is right for performance, the document was wrong.** A constant light count
would make every lit pixel of the day pay for three lights that give nothing (aw-int measured lamps 3 -> 0 at -2.8 ms of a medium frame; three uploads each light on every program switch,
~4 GL calls per light per switch, and shades it in every lit fragment); what it costs the other way is a second set of programs, and that is now paid behind the loading bar: both light sets
(camera + shadow pass) are built at boot, **0 programs are built when the lamps come on** (proof in section 1). The addendum now says what the code does, why, what the sets are and how the
workshop avoids being a third one. (`bloomon` in `aw-ab.mjs` re-enables the day bloom for comparisons.)

## 6. Final measurement

**Read this first.** The laptop was shared with the other streams the whole time. The SAME build measured 138-150 fps (p99 12-14 ms, medium, scale 1) in one hold and 56-70 fps (p99 32-47 ms, the governor
lowering the scale to 0.55-0.9) in another a few minutes later; the start-up calibration's units moved 5x between two runs (fill 0.44 vs 2.8 ns / px). Single runs, and any two runs minutes apart, cannot
rank two builds. What can: counters (programs, GL calls), the in-page interleaved A/B of section 3, and `bench.mjs` runs of the two builds **alternating in one hold** (below, A). Every row says what it is.
`bench.mjs`: 8 s warm-up, 12 s measured (frames over 50 ms are counted in that window; "play" is the game's own counter, frames over 33 / 50 / 100 ms since 3 s after START, which includes the warm-up).
Builds: "main" = `6aaf2be`. "final" = this branch as committed, **in A only** (and the GPU program probe of section 1). Everything else (B, C, D, E, F) was measured on commit `71e9983`: the same rendering and
the same workshop, but the boot also built the day set's depth programs (section 1: ~0.6 s shorter boot, ~0.5 s worse first seconds); steady-state frames are identical.

### A. Default (auto) tier, 1536x864 @ 1.25, main and the final build alternating in one hold (3 pairs)

| run | fps | mean ms | p50 | p95 | p99 | max | frames > 50 ms | play 33 / 50 / 100 | tier -> end (scale) | programs at the end |
|---|---|---|---|---|---|---|---|---|---|---|
| main 1 | 65.2 | 15.3 | 14.1 | 31.2 | 32.7 | 46.6 | 0 | 14 / 6 / 2 | medium -> medium (1.0) | 317 |
| **final 1** | **73.0** | 13.7 | 13.1 | 28.4 | 31.6 | 33.0 | 0 | 10 / 6 / 4 | medium -> medium (1.0) | 324 |
| main 2 | 67.4 | 14.8 | 13.6 | 31.3 | 33.1 | 51.5 | 1 | 21 / 11 / 5 | medium -> medium (**0.69**) | 317 |
| **final 2** | **74.2** | 13.5 | 12.6 | 28.9 | 32.0 | 48.3 | 0 | 11 / 5 / 3 | medium -> medium (1.0) | 324 |
| main 3 | 83.4 | 12.0 | 11.3 | 15.8 | 29.4 | 33.0 | 0 | 6 / 5 / 2 | medium -> medium (1.0) | 317 |
| **final 3** | 83.3 | 12.0 | 11.1 | 24.9 | 30.2 | 32.7 | 0 | 7 / 7 / 3 | medium -> medium (1.0) | 324 |
| median | main 67.4 -> final **74.2** (+10 %) | 14.8 -> 13.5 | 13.6 -> 12.6 | 31.2 -> 28.4 | 32.7 -> 31.6 | 46.6 -> 33.0 | 0 -> 0 | | main ended on scale 1.0 / 0.69 / 1.0, final on 1.0 x 3 | |

(The 317 / 324 programs are 167 / 174 plus the lower tier's two light sets: this laptop was loaded, so the calibration was pessimistic and the unproved start built the fallback tier behind the loading
bar in both builds. On a quiet moment the calibration says "fits" and neither builds it: 175 programs, rows C.) The game starts at hour 17:24, so these windows are dusk, which is the heavier time of day
(bloom on, lamp lights about to come on).

### B. Other viewports, same method

| viewport | main | final |
|---|---|---|
| 1920x1080 @ 1, three pairs alternating (second hold) | 58.2 / 65.3 / 59.6 fps, p99 44.3 / 46.6 / 46.9 ms, frames > 50 ms 1 / 3 / 5, ended on medium 0.69 / **low** 1.0 / medium 0.69 | 55.7 / 69.8 / 57.9 fps, p99 42.1 / 32.1 / 41.1 ms, frames > 50 ms 3 / 0 / 1, ended on medium 0.69 / medium 1.0 / medium 0.91 |
| 1920x1080 @ 1, three + two runs in separate holds (commit `71e9983`) | 68.4 / 75.1 fps, p99 31.8 / 32.4 ms, 0 frames > 50 ms, medium 1.0 | 83.0 / 60.1 / 73.9 fps, p99 35.7 / 55.1 / 34.9 ms; **7 / 10 / 0 frames > 50 ms and a 604 / 770 ms frame in two runs**: the governor stepped medium -> low during the window while the lower tier's second light set was still being built (programs 318 / 250 / 325) |
| 844x390 @ 3 (a phone landscape), separate holds | 106.8 / 86.0 fps, p99 24.4 / 32.5 ms, 0 frames > 50 ms | 77.9 / 86.7 / 95.2 fps, p99 52.1 / 30.1 / 29.0 ms; the first run stepped to low with a 639 ms frame (11 frames > 50 ms) |

The two stalls of 600-770 ms are the known unproved-start tier step (aw-int, section 4.2: "a tier step whose fallback was not built at boot"); this stream does not touch `tier-switch.js` or the
governor, and the alternating hold above shows main doing the same (a medium -> low step at 1080p, 65 fps), but I cannot say the final build is *not* more exposed to it: those separate-hold runs happened at
the busiest minutes of the session. I list them because they are the worst numbers I measured for the new build.

### C. Quiet-machine holds (commit `71e9983`, six runs each, one hold per build, 2-3 minutes apart)

| tier asked, 1536x864 @ 1.25 | fps | mean ms | p50 | p95 | p99 | max | > 50 ms | end tier (scale) | programs |
|---|---|---|---|---|---|---|---|---|---|
| auto, main, 3 runs | 89.9 / 85.4 / 75.7 | 11.1 / 11.7 / 13.2 | 10.6 / 11.2 / 12.5 | 16.1 / 17.1 / 28.6 | 28.8 / 29.7 / 31.4 | 31.7 / 32.3 / 32.9 | 0 / 0 / 0 | medium (1.0) x 3 | 317 |
| auto, final, 3 runs | **150 / 145 / 138** | 6.7 / 6.9 / 7.3 | 6.4 / 6.6 / 6.8 | 10.5 / 10.7 / 11.9 | **12.4 / 13.4 / 14.1** | 24.1 / 21.0 / 23.3 | 0 / 0 / 0 | medium (1.0) x 3 | **175** |
| low, main / final | 114.5 / 132.7 | 8.7 / 7.5 | 8.2 / 6.1 | 12.1 / 14.5 | 27.3 / 26.7 | 30.7 / 40.1 | 0 / 0 | low (1.0) | 154 / 154 |
| medium, main / final | 85.9 / 76.2 | 11.7 / 13.1 | 11.2 / 12.3 | 19.5 / 28.9 | 30.5 / 31.6 | 33.0 / 32.8 | 0 / 0 | medium (1.0) | 167 / 175 |
| high, main / final | 74.6 / 81.3 | 13.4 / 12.3 | 13.0 / 11.8 | 29.1 / 17.4 | 32.1 / 31.5 | 32.7 / 32.8 | 0 / 0 | high (1.0) | 166 / 175 |

These are real runs and the auto rows show what the machine does when it is quiet (the calibration read 8.7 ms for medium: "fits", no fallback built, 3.1 s from page to ready against 4.6-5.3 s for main), but
main's rows were taken in a **louder** minute (its calibration read fill 2.8 ns / px, 6x the final's): **do not read 85 -> 145 fps as the gain of this branch**. The honest comparison is A.

### D. In-page A/B (section 3): medium, Charminar, same page

At 12:00 the day frame is 10.1 ms (98.9 fps, p50 10.3, p99 26.7) of which `gfx.render` is 9.2 ms of CPU and the GPU timer 10.2 ms; with the old behaviour (bloom drawn) 12.2 ms / 11.0 ms CPU / 10.7 ms GPU. At 21:00 the
frame is 12.2 ms (82 fps, p99 32.1) with 11.1 ms of CPU and 12.1 ms of GPU. Main in its own page at 12:00: 11.1 ms (90.3 fps, p99 29.2), 10.1 ms CPU, 9.8 ms GPU. (The frame is bound by the CPU side -- GL calls -- and
the GPU timer together: neither is far below the other, so a saving on one side alone buys about half of itself.)

### E. In-play stalls (`aw-hitch.mjs --scenarios boot,drive`, auto tier, 8 s of play after START + 30 s of autopilot driving; two runs per build, alternating, commit `71e9983`)

| phase | main | final |
|---|---|---|
| drive 30 s: programs built | 1 and **149** (the workshop trickle at 17 s) | **0 and 0** |
| drive 30 s: frames > 50 / > 100 ms, ms in them | 8 / 4, 1396 ms and **25 / 18, 4543 ms** | 6 / 3, 832 ms and 6 / 3, 920 ms |
| drive 30 s: p99, max frame | 31.9 / 43.5 ms, 482 / 428 ms | 32.4 / 32.0 ms, 375 / 426 ms |
| first 8 s after START: frames > 50 ms | 4 / 3 | **9 / 8** (the first version; see section 1: the day set's depth programs. The fix measures like main: 400 frames after START, sum of frames > 40 ms 2.5-3.2 s against 2.6-3.0 s) |

The frames of 100-480 ms that are left in the drive are in `gfx.render` with no program, texture or geometry created in them (the game's own slow-frame attribution): GL / GPU waits on a shared GPU. The target "zero
frames over 50 ms after the first 3 s" is **not met**: 6 per 30 s here, 0-8 per 12 s in the bench windows (0 on the quiet ones).

### F. 5-minute soak (`aw-hitch.mjs --scenarios boot,soak --seconds 300`, auto tier, autopilot, commit `71e9983`)

22212 frames, 74.8 fps average, p99 34.8 ms (the machine was loaded: the governor ended on **low, scale 0.81 -> render scale 0.65**), 42 frames over 50 ms (0.19 %), 3 over 100 ms, the worst 643 ms in the first 3 s.
**Flat:** programs 325 -> 325 (0 created in 300 s), textures 61 -> 62, geometries 219 -> 223, JS heap 63.8 -> 67.0 MB (before / after the run, no forced GC), 2886 React commits at 9.6 / s.

### Targets, default tier, this laptop, 1536x864 @ 1.25

| target | where it stands |
|---|---|
| >= 60 fps average | **met on a quiet machine, not on a busy one.** Quiet: 138-150 fps (rows C), 99 fps in the day A/B; busy: 56-83 fps (A, B). With the other streams running it is 65-83 fps: all six alternating runs of A are at or above 65 fps (main 65 / 67 / 83, final 73 / 74 / 83). |
| p99 <= 25 ms | **not met** except on the quietest runs (12-14 ms, rows C). In every busy run and in every in-page A/B it is 26-33 ms, and `noshadow` / `bloom0` do not move it: it is the HUD's snapshot frames (aw-int, section 6: one frame in seven is ~15 ms longer; ui-touch's work) |
| zero frames > 50 ms after the first 3 s | **not met**: 0 in the quiet bench windows, 0-8 in the busy ones, 6 per 30 s of driving. The compile-caused ones are gone (0 programs built in play; main: 17 frames over 100 ms in the game's counter -> 0). The rest are GL waits with nothing created. |
| render scale >= 0.85 in steady state | **met on a quiet machine** (medium at 1.0 in all quiet runs, 3 of 3 in A for the final build); **not under load**: the governor goes to 0.55-0.9 or to low (the soak ended on 0.65) |
| start to playable | the first version of this branch measured -1.5 to -2 s on the quiet holds (3.1 s against 4.6-5.3 s) and -0.6 s on `game.boot.compile`; the final build gives the day set's depth programs back to the boot frame, so expect **the same as main** (`game.boot.compile` 1341 ms against 1370 ms); I did not re-run the quiet holds on the final commit |

What is the next lever: (1) **the HUD** (p99 and the 15 ms frame in every seventh: `game/snapshot.js`, `ui/**`, ui-touch); (2) **the machine is the limit on a busy day, not the picture**: at 74 fps the CPU side of
`gfx.render` (GL calls through ANGLE: 860-1000 a frame, `uniformMatrix4fv` 25 % of the main thread in the profile) is as large as the GPU's, so only fewer GL calls help: the shops' textured materials (~25 calls), props (23
draws, needs BatchedMesh), the night chain's last two passes (-22 calls, picture-neutral, see Screenshots); (3) the **first ~3 s after START** (3-7 frames of 100-400 ms in `gfx.render` with nothing created, on main as well: the GPU process appears to be
still busy with the boot's first-draw work; not proven what exactly, my best guess is also the lower tier's programs that `belowWarmed` compiles while the start menu is up): try skipping the below-tier warm for
starts the calibration says fit, as `insuranceTier` does, and measure `aw-probe --cmd boot --menu-wait 2` (new option: linger on the start screen like a player) against 0.


## Screenshots (`docs/perf/aw-final/`, 12 JPEG q72, each < 105 KB, left = main `6aaf2be`, right = this branch)

Taken with `aw-shots.mjs` on the real GPU, medium held, the city paused (`--pause`), the same cameras / hour / weather in both builds, HUD hidden, in one hold per build; the garage pictures from
FIXED free cameras (the workshop's orbit camera drifts with time). I looked at every pair. What differs inside a pair is live game state (a customer's pick-up beam and diamond, a pedestrian), not
rendering.

| file | what it shows | what I see |
|---|---|---|
| `pair-charminar-day` | Charminar, 12:00, 1536x864 | identical: facades, sky, the mosque, bunting, shadows, the "FILMY CINEMA" neon; this is the bloom-skipped daytime frame |
| `pair-dusk-hitech` | the glass towers at 18:36, bloom on in both | identical glow, lit windows, pink sky (a signal at the lower left is red in one and green in the other: live state) |
| `pair-night-paradise` | Paradise, 22:00 | identical: neon, lit shopfront, the lamp pool on the pavement, stars (the tree sways: the pause does not stop the wind) |
| `pair-rain-night-charminar` | Charminar in the rain, 21:00 | identical neon halo ("DUM BIRYANI"), rain streaks, wet road tone |
| `pair-wfix-day-a` | the garage showroom, 12:00, fixed camera | identical: turntable, pink / cyan rim light on the floor and the auto, shadows |
| `pair-wfix-dusk-b` | the garage at 18:36 from the other side | the same picture: the pink / cyan rims on the floor and the auto, the sky, the neon |
| `pair-wfix-night-a`, `-b` | the garage, 22:00, two fixed cameras | pink / cyan rims, the key light on the auto, neon, windows: the same. **Different: the orange sodium glow on the near pavement is weaker (two of the three lamp lights are the rims now) and the headlight's bright wedge on the pavement is gone (the headlight spot is the key light).** Not worse in my eyes, not identical |
| `pair-844x390-charminar-day`, `-night-paradise`, `-wfix-night-a`, `-rain-night-charminar` | the same cameras in a phone landscape viewport (844x390 @ 3, pixel ratio 1.25 of CSS) | the same pictures, nothing cut or shifted; the garage night pair shows the same sodium / headlight difference as above |

Not saved (viewed, not committed): the bloom A/B at day (amplified diff = dither noise), and the 4 / 3 / 2-level bloom at night (`lv` runs): mean absolute difference 0.03-0.11 of 255 for 3 levels (0.04-0.22 for 2),
worst pixel 12-29 levels inside the sign's halo only; so `bloomLevels: 3` for medium is a picture-neutral way to take 2 more passes (95 -> 73 GL calls at night) off the chain if a later measurement
finds it worth it. I did not apply it: its frame-time gain was not measurable in my runs (night rows of section 3), and the final tables below are for the build as committed.

## Risks

* **The depth stand-ins mirror three r187's `getDepthMaterial` and `getParameters`** (default `MeshDepthMaterial`, `shadowSide`, the fog bit, `customDepthMaterial`). A three upgrade can change a key and the
  warm-up would silently build useless programs while the real ones are built in play again. `node scripts/perf/aw-warm.mjs --strict` is the check (it exits 1 on any program built in play); run it after any
  three bump, new light, new caster kind or new weather / event object.
* **The garage looks a little different at night.** With the lamp pool lent, two of the street's three sodium lights (medium; both of low's two) and the auto's own headlight beam are not in the showroom: the key
  spot, the pink and cyan rims, the sun / hemisphere and the surrounding emissive neon are unchanged (day: identical in every picture I took). Pictures: `wfix-night-*` below.
* **Bloom by day is off, not weak.** Measured at four daytime cameras at <= 0.026 of 255 mean difference. An object that goes above 2.2 HDR by day (a baraat bulb, a camera flash: both additive and
  unlit) loses its halo by day; the switch is under `night` 0.04 (dusk), where the difference is under 2 levels.
* `props.lend` is a single loan (the workshop); a second borrower would need a counter. The loan survives a tier step (`setLightCount`) and the game being closed with the garage open (`workshop.dispose`
  releases it).
* Boot builds the night set's 7 depth programs ahead (+7 programs: 174 after boot against 167) and leaves the day set's to the boot frame, as main does (`game.boot.compile` 1341 ms against 1370). Building both was 0.6 s faster
  to boot and 0.5 s worse in the first seconds of play (section 1): a measured trade I did not take.
* The cost model in `GFX.models` (`calls: 1500` for medium) was fitted before this work and was not re-fitted: the bloom skip takes ~85 of ~1500 call-equivalents off a daytime frame, which the
  start-up calibration (units move 2-10x between runs on this laptop) cannot resolve.

## Unfinished / next levers

1. **The first ~3 s after START** still has 3-7 frames of 100-400 ms inside `gfx.render` with no program, texture or geometry created (main too). Hypothesis, not proven: the GPU process finishing the boot's first-draw
   work and the below-tier warm; see the end of section 6 for the experiment (`aw-probe.mjs --menu-wait`).
2. **One 80-150 ms frame at the first dusk** (first-sight uploads of the night-only objects: +3-4 textures, +2 geometries over the sweep, 0 programs; absent in one of two runs). `renderer.prewarm` skips invisible
   objects, so a hidden night group is uploaded on its first visible frame: reveal hidden objects for the boot frame and restore them.
3. **The night chain is still 8 passes / 95 GL calls** (73 with `bloomLevels: 3` for medium, picture-neutral: 0.03-0.11 of 255 mean difference; not applied, no measurable frame gain).
4. **Shops' textured materials and props** (section 4): ~25 + ~20 GL calls a frame, a per-shop atlas and BatchedMesh respectively.
5. The in-page A/B of the night variants drifted by 4-6 ms; a quiet-machine rerun of sections 3 and 6 on the final commit (I measured B-F one commit earlier) would tighten every number here.
6. `GFX.models` (the calibration's cost model) was not re-fitted for the cheaper daytime frame.
7. The 600-770 ms tier-step frames of two 1080p / phone runs (section 6, B): the unproved-start path of aw-int, untouched here; worth a look by whoever owns `game/tier-switch.js`.

## Files

Changed: `game/warm.js` (+ test), `game/light-sets.js`, `game/Game.js` (the in-play workshop warm-up removed, bloom switch, headlight guard), `render/post.js` (`bloomWanted`, + test), `render/renderer.js`
(`setBloomEnabled`), `world/props.js` (`lend` / `unlend`), `gameplay/workshop.js`, `gameplay/workshop/showroom.js` (borrowed lights), new `gameplay/workshop/light-bank.js` (+ test), `sim/customize.js` (3 lines:
`headlightHex`), `ARCHITECTURE.md` (addendum 5 and 6), `scripts/perf/{aw-warm,aw-shots}.mjs` (new), `aw-ab.mjs` (presets), `README.md`, `docs/perf/aw-final.md` + `docs/perf/aw-final/*.jpg`.
Outside my area: `gameplay/workshop*` and `sim/customize.js` (aw-logic's and aw-cpu's files, rendering-side changes only; the workshop's rules, prices, camera and menu are untouched). Not touched:
`ui/**`, `game/snapshot.js`, `game/config.js` (no tier numbers changed).
