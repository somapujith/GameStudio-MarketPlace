# Rendering and gameplay overhaul of Autowala and Tiffin Centre (2026-11-27)

One page that ties the work together. The per-stream write-ups (numbers, screenshots, risks) are in `docs/perf/*.md`; the rules the streams worked by are in
`docs/perf/PLAYBOOK.md`; the shared engine layer is described in `docs/GFX_ENGINE.md`.

## Why it was slow (measured on the dev laptop's *integrated* AMD GPU, which is what Chrome picks on a hybrid laptop)
- Both games were bound by **per-draw-call and per-shader-program work in the browser and GPU process**, not by pixels or triangles:
  about 2000 GL calls per frame (~10 us each), 160-440 draws, 162-311 shader programs, and every program costs 25 ms (warm) to 120 ms (cold) the first time it is drawn.
- Quality tiers were guessed (`high` on any 8-core), the sampler read compile stalls as slowness, a tier or resolution change re-allocated render targets and recompiled,
  and Autowala's HUD, post chain (MSAA half-float + bloom) and shadow map ran at native resolution on every frame.

## Result (same machine, 1536x864 @ 1.25, auto tier, production builds, interleaved runs)
| | before | after |
|---|---|---|
| Autowala fps | 38-40 (stalls of 100-450 ms) | 71-74, no frame over 50 ms, 8 s to load -> 6.6 s |
| Autowala draw calls (camera + shadow) | 390 + 142 | about 130 + 30 |
| Autowala programs compiled while playing | 166 per day cycle (16 in the shadow pass, 550-650 ms frames) | **0** (`scripts/perf/aw-warm.mjs --strict`) |
| Tiffin fps | 30-35 (p99 250 ms, ~20 frames over 50 ms), 16 s to load | about 99 on `low` after the governor settles, 6 s to load |
| Tiffin draw calls | 324-440 | 150-172 (a busy shift: 351-428 -> 197-202) |
| Tiffin programs compiled after the reveal | 9 in 3 s, +4 rain, +2 cricket, +2 festival, +1 inspector | **0** (`scene.debug.reveal`) |
| Tiffin first rain / cricket / festival / inspector frame | 252 / 206 / 359 / 131 ms | 34-59 ms |

Not reached (stated plainly): 60 fps *and* p99 <= 25 ms in the default tier on this iGPU. Autowala's p99 is ~32 ms with 0 frames over 50 ms; Tiffin's `medium`
tier reaches ~51 fps (auto starts on `lite` and climbs to `low` after ~20 s, then the tier is remembered); cold-cache Tiffin load on `medium` is ~12-15 s
(warm ~4 s). The next lever is fewer draw calls and programs, not more governor work (see each stream's "unfinished" list).

## What changed
- **Shared engine** (`src/platform/gfx/`, `gfx-core`): GPU classifier, tier memory, start-up calibration, one frame governor with free resolution steps (viewport sub-rect,
  no `setSize`), GPU timer, warm-up, batching helpers, WebGL2 probe. Both games run on it (`aw-int`, `tf-int`).
- **Autowala GPU** (`aw-gpu`, `aw-draw`, `aw-final`): R11G11B10F scene target, no MSAA, dual-Kawase bloom (skipped by day), one composite, one program per material class,
  merged landmarks / shops / roofs, a customer is one skinned mesh, the auto is 8 draws, night / workshop / rain depth programs built behind the loading bar.
- **Autowala CPU / UI** (`aw-cpu`, `aw-ui`, `ui-touch`): staged boot, program warm-up, a leak fixed (a `speechSynthesis` listener kept a whole game alive), landscape-first
  HUD and menus that scale with viewport height, no `backdrop-filter` or endless animations over the canvas, a HUD snapshot store with per-piece views (0.5 ms per snapshot).
- **Tiffin GPU / CPU / UI** (`tf-gpu`, `tf-cpu`, `tf-prog2`, `tf-ui`, `tf-int`): lit shaders no longer recompile when a burner lights, packed people (11-13 draws per
  customer instead of 59-93), sliced customer builds, one hidden instance of everything drawn behind the loading screen, batched traffic, light pool, landscape-first HUD.
- **Landscape** (`landscape`): manifest `orientation: 'landscape'`; a portrait phone or tablet gets a "turn your phone" screen (EN + Telugu) while the game stays mounted,
  paused and silent; first tap locks landscape + fullscreen where the browser allows; desktop is never gated (`src/platform/game/Orientation*`, `docs/perf/landscape.md`).
- **Mechanics** (`aw-logic`, `tf-logic`): 43 Autowala defects (per-frame mood hit that wiped tips, compounding damage factor, day/rain/rent running behind menus, tutorial
  replay farm, solo run API retries and token loss, trees in carriageways, per-category volumes) and 6 Tiffin defects (co-op win credit, dedicated-cook credit, tables that kept
  ticking for nobody, stranded dishes of a leaver, a difficulty curve that closed levels 9/11/12 for the bot, tutorial resume card), all with tests.
- **Found by an independent review before the push**: "Apply now" in Tiffin's pause menu (and Autowala signing in mid-load) rebuilt the scene on a canvas whose GPU context had
  just been force-lost, so the player got "cannot draw the 3D stall" (fixed: only a real unmount hands the context back); a seat with one unit of work got the full co-op win
  bonus (fixed: at least 3 units and a tenth of the team's work, `WIN_MIN_WORK` / `WIN_MIN_SHARE`).

## How to verify or continue
- `npm run perf -- --game autowala|tiffin ...` (`scripts/perf/README.md`): real-GPU frame times; run it on a quiet machine, on a production build, interleaving old and new builds.
- After a three.js bump, a new light, caster or weather object: `node scripts/perf/aw-warm.mjs --strict` (Autowala) and `node scripts/perf/tf-census.mjs --strict` (Tiffin):
  zero programs may be compiled while playing.
- To force the discrete GPU for Chrome on a hybrid Windows laptop: Settings > System > Display > Graphics > Chrome > High performance.

## Known gaps
- Not seen on real hardware: iOS rotation timing, Android fullscreen + orientation lock (the Android session verified it on emulators), notch insets, tilt steering, gamepad.
- Medium and high Tiffin hold more geometry and textures after the reveal (556 geometries / 245 textures against 151 / 150) in exchange for no compiles in play.
- A first-time visitor on an integrated GPU sees Tiffin on `lite` for ~20 s; the governor remembers the settled tier afterwards.
- Native-speaker review of the Telugu / Hindi / Hyderabadi dialogue is still pending; co-op was proven with the real room code in the test harness, not against a live Durable Object.
