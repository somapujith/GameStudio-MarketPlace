# aw-ui: Autowala's UI and its on-screen picture, landscape first

Branch `perf/aw-ui` (worktree `GameHub-wt/aw-ui`), 2026-11-27. Stream owner: aw-ui. Two helpers worked inside the same branch: **aw-menus** (every full-screen menu) and **aw-3dqa** (visual QA of the 3D picture and the camera field of view). Their commits are in this branch and their findings are in this report.

The owner's words: "the Autowala UI isn't done perfectly, the rendering mechanism and all is messed up" and "Autowala must mainly be in horizontal orientation, so the controls are playable; implement it and design it accordingly".

## Headline

| | before | after |
|---|---|---|
| Touch controls on a 640x360 phone | 266 of 360 px tall (74 %), a "..." tray plus the HUD's "More" | 184 px (51 %), one More button (the tray's shortcuts live in the More sheet) |
| HUD on a 640x360 phone, worst case (trip, 2 alerts, toast, prompt, drift, caption) | minimap, route pill, speedometer, prompt and captions stacked across the middle of the road | everything on the edges or in two lanes; **no overlaps** between any two HUD boxes or between a HUD box and a touch control at 640x360, 740x360, 844x390, 932x430 and 1024x768 (measured with `getBoundingClientRect` on the forced worst case; the one intended overlap is the route pill tucked over the minimap's lower edge) |
| HUD on a 1366x1024 touch screen (iPad Pro class) | desktop HUD: minimap under the wheel, speedometer over BOOST, trip panel on the job chip | compact landscape HUD, nothing overlaps |
| HUD scale | fixed px: tiny at 1080p | `--aw-ui-scale` from the viewport height: 0.92 at 360 px tall, 1.0 at 430-720, 1.2 at 864, 1.5 at 1080 |
| Desktop trip panel | 5 rows, ~200 px tall (28 % of a 720p window) | 3 rows, ~140 px |
| `backdrop-filter` / `mix-blend-mode` / filter + box-shadow animations over the live canvas | 6 places | none (a CSS test forbids them) |
| Pause menu on a 360 px tall phone | list clipped, CLOCK OUT and QUIT hidden | two columns on a short phone: all 7 rows on screen with no scroll (checked at 640x360, 844x390 and 640x300) |
| Lake water | frozen white mirror at every hour | follows the sky |
| Camera field of view | vertical 60-75 degrees at any aspect | horizontal FOV kept in a band, so 21:9 is no longer a fisheye and a portrait window no longer a keyhole |

Frame-time numbers (`bench.mjs --game autowala`, 1536x864 @ 1.25, real integrated GPU, default tier): see "Performance" below.

Screenshots are in `docs/perf/aw-ui/` (JPEG, before/after pairs, all landscape phone sizes except the last pair). They were taken with software GL for layout (`scripts/perf/cdp.mjs`, touch emulation, dpr 2); the colours and frame rate mean nothing there.

| file | what it shows |
|---|---|
| `hud-640x360-before/after.jpg` | forced worst case: trip, speeding + red-light alerts, rain, drift, prompt, toasts |
| `hud-844x390-before/after.jpg` | same, 844x390 |
| `pause-844x390-before/after.jpg` | pause menu on a phone sideways (the "after" is the two-column list) |
| `fov-boost-844x390-before/after.jpg` | boosting on a 2.16:1 screen: the auto fills more, the edges are calmer |
| `lake-night-844x390-before/after.jpg` | the lake at night (aw-3dqa) |
| `touch-1366x1024-before/after.jpg` | a large touch screen: it now gets the compact landscape HUD |

## Defects found

Severity: High = a player cannot play or read it, Med = wrong or confusing, Low = polish. "Fixed" means seen fixed in a screenshot or covered by a test.

### HUD, touch controls, scale (aw-ui)
| Sev | Defect | Fix |
|---|---|---|
| High | Touch controls took 74 % of a 360 px tall phone (wheel from the width, boost / horn / drift / interact stacked above the pedals, a tray above the wheel) and left no room: the HUD ended up in the middle of the road | `touch/layout.js`: wheel and pedals sized from the height, boost over the gas, drift over the brake, ONE column of horn / interact / camera beside the pedals, no tray on compact layouts; buttons 48 px; the controls need about half the height |
| High | Landscape phone HUD: minimap, route pill, speedometer, prompt, fare card and captions all in the centre column over the road | `hud/land.css`: 44 px strip on top (wallet, trip, clock, More, pause), minimap under it on the left, toasts under it on the right, alerts and the tutorial card in a lane in the middle, captions under them, prompt and fare question above a slim bottom-centre **speed pod** between the thumbs |
| High | A touch screen bigger than 900 px short side (iPad Pro 1366x1024, Surface) got the desktop HUD under its own wheel and pedals | `hudLayout`: any touch screen gets the compact HUD |
| Med | Two "more" buttons ("..." tray in the controls, "More" in the HUD) and Pause twice | the touch tray is gone on compact layouts; the More sheet has Map / Quests / Phone / Radio / Controls |
| Med | HUD tiny at 1080p, fixed px | `ui/scale.js` + `zoom: var(--aw-ui-scale)` on every overlay root (all roots zoom together, otherwise panels placed relative to each other collide: seen in the first experiment) |
| Med | Desktop trip panel 5 rows | 3 rows |
| Med | Tutorial card, BRIEF, quest log and "Press E to ..." prompt speak keyboard on a phone ("W or the up arrow to go, A and D to steer") | `quests/coachText.js` (tested) re-words the steps for touch; prompts say "Tap to ..." when the prompt is a button |
| Med | The tutorial card's Skip chip was an empty square on touch (its only content was a `kbd`, hidden by the hub's touch stylesheet) | "Skip" label, step counter 1/6 because the dots are hidden |
| Med | Minimap canvas redrawn every frame at up to 2.5 x dpr, and blurry once the HUD zooms | redrawn at ~30 Hz moving / ~12 Hz parked, canvas resolution includes the zoom |
| Low | Esc with the More sheet open also opened the pause menu; the sheet did not take focus | Esc closes the sheet and returns focus to More; opening it focuses the first shortcut |
| Low | Wallet and clock chips changed width as the numbers ticked, shifting the trip chip | min widths |
| Low | Captions and the tutorial card lost their centring (their entrance animation owns `transform`) | centred with auto margins |
| Low | `aw-hud--touch` rules, `max-height: 520px` blocks, old landscape tokens in phone.css / minimap.css / toasts.css were dead or contradictory | removed |
| Low | The old rotate hint duplicated the shared orientation gate; the controls' fullscreen toggle never released fullscreen or the orientation lock on unmount | RotateHint deleted; TouchControls undoes only what its own toggle did |
| Low | The start screen swallowed Escape and the Android Back button | `onBack: onHub`, `data-native-back` on "Back to hub" |

### Menus (aw-menus)
| Sev | Defect | Fix |
|---|---|---|
| High | Pause list clipped at 360-390 px tall (CLOCK OUT, QUIT hidden, every sub-view scrolled) | list owns the left column; rows share it; below 400 px tall it is two columns wide (landscape.css), Telugu drops out of the rows under 760 px wide |
| High | The hub's `:root:root kbd {display:none}` on coarse pointers emptied the controls panel and left "/ to jump back in" | key caps are `span.aw-key`; a test forbids `<kbd>` in the menu files |
| High | Quality setting: reload-only, yet the text said "Auto picks the best setting" | `menus/quality.js` says what Auto does, what runs now, and whether a reload is needed. **Cannot apply live yet** (see below) |
| High | Start screen: one tall column, overflowed under 700 px | two columns in every landscape window from 560 px up |
| High | Quest log at 640 px stacked and the CLOSE button slid over the text | two columns kept, CLOSE in the flow |
| High | Summary hid the save result behind the action bar | result under the title, numbers in 3 columns |
| Med | HUD ghosted through the job board and quest log (specificity) | root selector raised |
| Med | Workshop on a phone: stat card ate ~250 px, labels collided | compact 3-column card, tighter rows |
| Med | Workshop purchases: wallet read from the 10 Hz snapshot (stale), foot changed height when a note appeared, a poor wallet gave no hint, removing a toggle said "Fitted No garland" | live `ctx.economy.wallet`, reserved note slot, red "Need more / Rs 140 short" button that still answers a press, `workshop/buyAction.js` (tested) |
| Med | Hisaab clipped in 360 px; big map title drowned in labels and its hint row covered a third of the map; GPU-lost overlay unstyled and under the HUD | fixed; `menus/BootScreens.jsx` (loading with a real progress bar, WebGL-unsupported / error / GPU-lost with a Reload button) |
| Low | Pause sliders, stats tiles, an endless box-shadow animation on the start button, `backdrop-filter` in `workshop.css` / `minimap.css` | fixed; a test forbids blur, blend modes and keyframed box-shadow in the menu CSS |
| Low | Menus small at 1080p | `zoom: var(--aw-ui-scale)` on menus from 800x1000 up |

### The 3D picture (aw-3dqa)
| Sev | Defect | Where | Status |
|---|---|---|---|
| High | Lake water ignored the sky: a frozen white mirror at every hour (`UniformsUtils.merge` cloned the uniforms, so the sky colours were copies of the initial white) | `world/terrain.js:81-85` | **fixed** (teal by day, pink at dusk, dark at night) |
| Med | Cloud sprites were hard-edged rectangles, obvious in rain | `render/sky.js:117-124` | **fixed** |
| Med | Old City, town and villa windows pure black by day (metalness 0.55 with no environment map) | `render/materials.js:57-61` | **fixed** (dark slate glass) |
| High (perf) | A freeze of about 5 s at dusk (hour 18) when the real lamp lights switch on: the point-light count changes, so every lit material recompiles (programs 152 to 196) | `world/props.js:259-262` | **reported**: render one warm-up frame with the tier's light count visible behind the loading screen, or keep the lights visible at intensity 0 (aw-gpu) |
| Med | Far plane clips towers with almost no fog (fog is 11-35 % at the far distance at noon) | `game/Game.js:54`, `render/sky.js:215` | **reported**: fog density about 1.5 / far, or a longer far plane |
| Low-Med | Bloom blows out the chrome rear bumper and the dashed centre line at noon | `render/renderer.js:114` | reported |
| Low | Junction patches are a flat colour with a hard edge against the textured asphalt | `world/roads.js:83` | reported |
| Low | Windscreen seen from the front is a white rectangle (the chase view never shows it; the workshop front view does) | auto windscreen plane | reported |

Checked and clean: camera jitter (0.018 m noise behind the auto, 0.000 sideways), camera inside walls (0 of 10,020 settled poses), shadow acne, z-fighting (four sub-5 cm captures), traffic spawn pop-in (0 of 12 in clear view), props (tile culling only, no LOD popping), night exposure, neon and wet roads. Framing at 640x360, 844x390 and 932x430: horizon about 40 % from the top, the auto at x 45-55 %, y 62-85 %, clear of both thumb zones.

## Camera field of view (`game/camera.js`, new `game/cameraFov.js` + test, commit e5023cf)
`createChaseCamera.update` still damps `60 + speed + boost`, then assigns `fovForAspect(fov, camera.aspect)`: horizontal FOV `h = 2 atan(tan(v/2) aspect)`; above 96 degrees the target is `96 + 0.4 (h - 96)`, below 84 it is `84 - 0.4 (84 - h)`, then back to a vertical FOV clamped to [40, 90]. 16:9 at rest is untouched.

| Viewport | rest (v / h) | boost |
|---|---|---|
| 640x360, 1280x720, 1920x1080 (16:9) | 60 / 91.5 unchanged | 82 / 114 to 70.8 / 103 |
| 844x390, 932x430 (2.16) | 60 / 102.7 to 56.6 / 98.7 | 82 / 124 to 64.2 / 107.2 |
| 3440x1440 (2.39) | 60 / 108 to 53.7 / 100.9 | 82 / 128.6 to 60.8 / 109 |
| 1024x768 (4:3) | 60 / 75 to 64.8 / 80.5 | 82 / 98.5 to 80.5 / 96.9 |
| 420x900 portrait window | 60 / 30 to 90 / 50 | capped |

Trade-off: the speed-widening is much smaller on wide screens (boost adds ~7 degrees of vertical FOV instead of 22). Raising `H_MAX` brings it back. The workshop orbit and `debug.cam` set their own FOV and still work.

## CSS cost over a live WebGL canvas
A DOM overlay on a WebGL canvas makes the compositor re-blend every frame, and `backdrop-filter` makes it read the canvas back first. Removed or replaced (look unchanged to slightly denser panels):

| where | was | now |
|---|---|---|
| `subtitles.css`, `fares/fares.css`, `workshop.css`, `minimap.css` (big map) | `backdrop-filter: blur(3-6px)` | solid 0.9 panel |
| `touch.css` wheel | `filter: drop-shadow` on the wheel (re-run on every turn) | static `box-shadow` |
| `touch.css` pedal grip | `mix-blend-mode: screen` | plain alpha stripes |
| `minimap.css` disc | endless animated `filter: drop-shadow` | static glow |
| `hud/rules.css` speed-limit sign | endless animated `box-shadow` | scaling, fading ring (transform + opacity) |
| `hud/rules.css` chai button | animated `box-shadow` | opacity pulse |
| `hud.css` "find a customer" dot | animated `box-shadow` spread | scaling, fading pseudo-element |
| `menus.css` start button | endless animated `box-shadow` | opacity pulse on a pseudo-element |
| `hud/toasts.css` | `will-change` on the +Rs bursts | removed (animations promote by themselves) |
| `Minimap.jsx` | canvas redrawn every rAF frame | ~30 Hz moving, ~12 Hz parked |

Kept on purpose: `will-change: transform` on the turning wheel (a real, single compositor layer), the full-screen speed vignette (opacity only) and the speed lines (masked, shown only above ~50 km/h). `phoneCss.test.js` now fails if a HUD stylesheet gains `backdrop-filter`, `blur(`, `mix-blend-mode` or a keyframe that animates `box-shadow`, `filter` or a layout property.

## Performance
`node scripts/perf/bench.mjs --game autowala --warm 6 --seconds 8` (default tier, 1536x864 @ 1.25, headless Chrome on the real integrated AMD Radeon, production build, machine-wide lock), baseline build (`main` at the start of the stream) against this branch, run back to back, twice. **The GPU was shared with the other streams' benchmarks and screenshot runs, and the game's own frame-time sampler dropped the tier from the default to low within 2 s in all four runs, so these are low-tier numbers on a noisy machine.**

| run | fps | mean ms | p50 | p95 | p99 | worst frame | frames > 50 ms | boot long tasks (n / ms) | programs |
|---|---|---|---|---|---|---|---|---|---|
| before-1 | 36.8 | 27.2 | 17.1 | 64.1 | 261 | 988 | 22 | 11 / 4724 | 203 |
| after-1 | 46.0 | 21.7 | 18.7 | 37.6 | 75 | 755 | 9 | 16 / 7784 | 202 |
| before-2 | 35.7 | 28.0 | 21.1 | 39.6 | 334 | 1038 | 11 | 19 / 2545 | 202 |
| after-2 | 39.6 | 25.3 | 18.7 | 42.6 | 61 | 1794 | 7 | 19 / 2753 | 202 |

Both pairs point the same way (after: more fps, p99 down from 260-330 ms to 60-75 ms, fewer frames over 50 ms), but the worst frames and the boot tasks are dominated by shader compiles and other processes on the GPU, not by the UI, and I do not claim the whole difference: the UI changes are the removed backdrop blurs, filters and animations and the throttled minimap redraw, and aw-gpu's streams have not been merged into this branch. What I can claim is the A/B below.

**HUD cost, same session, same tier (low), same scene (worst case forced: trip, rage meter, two alerts, rain, drift, prompt), HUD shown vs hidden (`visibility:hidden` on everything but the canvas), alternating** (`hudab.mjs`, 5 s windows):

| build | pair 1: HUD / none (fps) | pair 2 | pair 3 | mean of 3 pairs: HUD vs none (fps, p99 ms) |
|---|---|---|---|---|
| before (baseline HUD and CSS) | 22.7 / 35.9 | 28.5 / 24.5 | 32.8 / 53.0 | **28.0 vs 37.8** (p99 106 vs 82) |
| after (this branch) | 120.7 / 131.9 (mean frame 8.28 vs 7.58 ms) | 115.5 / 68.5 | 14.7 / 42.3 | 83.6 vs 80.9 (p99 36 vs 44) |

Read it carefully: the machine was busy with other streams during these runs (the "after" session even ran at 120 fps while the "before" one was at 25-50), pair 2 of the old build and pairs 2 and 3 of the new one are reversed by other people's GPU load, and the sample is 3 pairs of 5 s. What the numbers do support: with the old HUD up the frame rate was lower than without it in two of three pairs (-37 %, -38 %) and 26 % lower on average; with the new HUD the cleanest pair costs 0.7 ms of an 8.3 ms frame, and the average over the three pairs is level. I would not quote more precision than "the HUD is no longer a measurable fraction of the frame, where before it was roughly a quarter"; the bench lock plus a quiet machine are needed for a number you can put in a table.

Static cost of the overlay: no `backdrop-filter`, no blend modes, no filter animations (test-enforced); the only endless animations left are opacity / transform pulses on small elements (low fuel, urgent timer, speeding ring, find dot, radio equaliser) and the speed streaks above ~50 km/h.

## What I could not do, and why
1. **Quality choice cannot apply live.** The pause / start menus save it honestly and say it needs a reload; `menus/settings.js` already calls `game.ctx.gfx.setQuality(tier|null)` when the renderer offers it, and nothing does. `render/renderer.js` is aw-gpu's. Patch (weather, events and traffic already re-read `ctx.gfx.quality` every frame and `Game.js` `onQuality` applies shadows, lamps and draw distance, so a live switch is safe): in `createRenderer` after `let q = ...` add `const autoTier = software ? 'low' : pickQuality(null); let pinned = !!explicit;`; first line of `sample()`: `if (pinned) return;` (a chosen tier is not silently lowered: today's "High" is lowered by the sampler); before the returned object add `const setQuality = (next) => { pinned = ORDER.includes(next); const want = pinned ? next : autoTier; slow = 0; sampled = 0; if (want !== q) { q = want; if (!lost) build(); onQuality?.(q); } return q; };` and return it. The UI drops its reload note by itself once `setQuality` exists. Unverified until then.
2. **The dusk freeze and the far-plane fog** (table above) belong to aw-gpu / aw-cpu.
3. **The game's frame-time sampler drops the tier within about 2 s** on this shared integrated GPU (`render/renderer.js:154-167`): `--tier medium` becomes low in every bench, so the numbers below are mostly the low tier. aw-3dqa pinned the tier by dilating `performance.now` to take medium and high screenshots.
4. **Gamepad access to the More sheet** (menus have it; the sheet closes on Esc / B only through the keyboard path).
5. Not seen on a real phone: safe-area insets (env() usage and CSS tests only), tilt steering, multi-touch on glass, gamepad navigation, the 'error' variant of the boot failure screen (unit-rendered), live quality switching, the dusk freeze fix.
6. Subtitles (z-index above 40) draw over the workshop panel (seen once in a baseline shot); big-map customer labels clutter at 640x360 (`minimap/draw.js`); `gameplay/workshop/shop.js` toasts "Fitted No marigold garland" when removing an item (the menu's own note says "Took off"); Hisaab does not open for a shift under `minShiftHours` with no rides (by design in `career.js`).
7. Portrait: nothing is optimised for it any more (the hub's gate covers upright phones). The compact portrait layout stays in `phone.css` because a narrow desktop window still uses it (checked at 500x800: fine).

## Risks
- `zoom` is the scale mechanism. Chrome, Safari and Firefox 126+ support it; `vw` / `dvh` inside a zoomed element are scaled too, so the HUD rules lean on percentages and on the control variables, and `uiScale` is capped by the width (desktop HUD ~1010 px wide at scale 1, compact HUD ~640). The touch layer publishes its occupied width / height already divided by the scale.
- `:has()` (captions push the tutorial card down, drift banner steps aside) and container queries (the trip chip drops its badge and ETA when narrow) need Chrome 105 / Safari 15.4-16 / Firefox 121 or newer. Without them the layout still works, only the tidying is lost.
- A touch screen of any size now gets the compact HUD. A hybrid laptop switches to it the first time the screen is touched (it never switches back, as before).

## Tests
`npx vitest run src/games/autowala`: 97 files, 1274 tests pass. New or extended in this stream: `ui/scale.test.js`, `ui/quests/coachText.test.js`, `ui/touch/layout.test.js` (landscape budget), `ui/hud/phoneCss.test.js` (landscape HUD, zoom roots, CSS cost), `ui/hud/layoutLogic.test.js`, `ui/hud/hudLogic.test.js` (`touchPromptText`), `game/cameraFov.test.js`; aw-menus added `menus/quality.test.js`, `menus/boot.render.test.js`, `workshop/buyAction.test.js` and extended `menus/menuLayout.test.js`. `npx vite build` passes.

## Files changed outside `src/games/autowala/ui/**` and `AutowalaGame.jsx`
`game/camera.js` and new `game/cameraFov.js`, `game/cameraFov.test.js` (the allowed FOV edit); from aw-3dqa, each its own commit so aw-gpu can cherry-pick: `render/materials.js` (a986ca5), `render/sky.js` (952b078), `world/terrain.js` (dc9ca23). Nothing else. `gameplay/quest-defs.js` was NOT touched: the touch wording is applied in the UI (`quests/coachText.js`, `hud/hudLogic.js`) so every surface that shows a step or a prompt (tutorial card, BRIEF, quest log, prompt chip) agrees, with no change to gameplay data.
