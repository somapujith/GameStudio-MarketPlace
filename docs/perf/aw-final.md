# aw-final: the last render-side gaps of Autowala (wave 3)

Branch `perf/aw-final` (cut from main `6aaf2be`). Machine: the dev laptop's integrated AMD Radeon (Chrome on D3D11 / ANGLE), headless Chrome, production builds served from
`vite preview`, 1536x864 @ 1.25 unless a row says otherwise. The machine is shared with the other streams: **frame times wobble by +-10-30 % between runs**, so every comparison below
is either a counter (programs, GL calls: exact), or taken back to back in one lock hold / one page. Where a number is one run it says so.

## Headline

TBD-HEADLINE

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
  miss). 14 more programs at boot (7 per set), compiled in parallel with the rest.
* The workshop **borrows** its three lights (`gameplay/workshop/light-bank.js`): two lamp-pool lights (`world/props.js` `lend` / `unlend`) are the pink and cyan rims and the auto's headlight spot is
  the key light; while any is lent the day shows as many lights as the night does (`game/light-sets.js` `visibleLights`), so a lit garage is one of the two light sets that are built at boot. The
  in-play workshop warm-up in `Game.js` is deleted; `lightSet` has no `workshop` flag. The headlight comes back in the colour the loadout has at that moment (a headlight bought inside the
  garage: `sim/customize.js` keeps `ud.headlightHex`; found while reviewing, not by a test of the old behaviour).

**Proof** (`aw-warm.mjs --strict`, final build, SwiftShader, `--warm 25`): **0 programs built in play** over day, dusk, night, dawn, dusk, night, rain by night and by day, the garage by day, by night
and in the rain, and a 7-leg teleport tour (Charminar dusk, Cyber night / rain, Birla, stadium in rain, station, CNG in rain): `programs after boot 175 = programs at the end 175`, exit 0. Main in
the same harness: 77 (SwiftShader, 3.8 s for the first frame of the garage) / 165 (real GPU).

Real GPU, `aw-warm.mjs --tour`, medium held, one run each (back to back, the same hold), 24 phases (the life cycle above + the 7-leg tour):

| | main `6aaf2be` | aw-final |
|---|---|---|
| programs after the loading bar | 167 | 175 (+8: the night set's depth programs; the day set's were already built by the first frame, now they are built in parallel earlier) |
| `game.boot.compile` (ms; a second main run 1485 / a second final run 741) | 1370 | **727** |
| programs built in play | **166** (16 of them in the shadow pass) | **0** (0 in the shadow pass) |
| frames over 40 ms / over 150 ms | 37 / 15 | 33 / **1** |
| worst frame | 644 ms (workshop opening), 599 ms (dawn), 571 ms (night) | **152 ms** (the first dusk, see below), then 86 ms |
| the game's own counter (frames > 50 / > 100 ms since 3 s after START) | 29 / 17 | 24 / **1** |
| frames in the run | 9966 | 8899 |

The remaining 32 frames of 40-90 ms in the aw-final run are spread over the phases (no program built in any of them; not attributed further: machine and GPU contention, the HUD's snapshot
frames, first-sight uploads; `workshop-day` has 7 of them, 41-75 ms). **One frame of 152 ms remains at the first dusk** (on main that frame was the 549 ms freeze): see "Unfinished".

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

**What did not, and why** (target "<= 4 passes, <= 80 GL calls": met by day, **not at night: 8 / 95**): folding the three up-passes into one combine pass (-2 passes, -22 calls) or dropping a level
(`bloom3`: -2 passes) changes the glow of the neon, which is the point of the night picture; the gain is ~0.2 ms of CPU per pass at night only (about 1 % of the average frame over a day
cycle), so I left it. (Measured anyway at 21:00: `bloom3` 13.9 ms and `bloom0` 13.9 ms against 12.2 ms for the 4-level chain, in a page that drifted by 4-6 ms: no measurable gain, so no reason to change the night picture.)

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

TBD-STEP6

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
* Boot adds 14 depth programs (7 per set) and loses the blocking depth compile of the first frame: measured TBD-BOOT.
* The cost model in `GFX.models` (`calls: 1500` for medium) was fitted before this work and was not re-fitted: the bloom skip takes ~85 of ~1500 call-equivalents off a daytime frame, which the
  start-up calibration (units move 2-10x between runs on this laptop) cannot resolve.

## Unfinished / next levers

TBD-NEXT

## Files

Changed: `game/warm.js` (+ test), `game/light-sets.js`, `game/Game.js` (the in-play workshop warm-up removed, bloom switch, headlight guard), `render/post.js` (`bloomWanted`, + test), `render/renderer.js`
(`setBloomEnabled`), `world/props.js` (`lend` / `unlend`), `gameplay/workshop.js`, `gameplay/workshop/showroom.js` (borrowed lights), new `gameplay/workshop/light-bank.js` (+ test), `sim/customize.js` (3 lines:
`headlightHex`), `ARCHITECTURE.md` (addendum 5 and 6), `scripts/perf/{aw-warm,aw-shots}.mjs` (new), `aw-ab.mjs` (presets), `README.md`, `docs/perf/aw-final.md` + `docs/perf/aw-final/*.jpg`.
Outside my area: `gameplay/workshop*` and `sim/customize.js` (aw-logic's and aw-cpu's files, rendering-side changes only; the workshop's rules, prices, camera and menu are untouched). Not touched:
`ui/**`, `game/snapshot.js`, `game/config.js` (no tier numbers changed).
