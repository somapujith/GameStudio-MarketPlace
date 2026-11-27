# ui-touch: tablet / touch fixes for both 3D games, and the Autowala HUD snapshot cost

Branch `perf/ui-touch` (worktree `GameHub-wt/ui-touch`), 2026-11-27. Owner of `src/games/autowala/ui/**` and `src/games/tiffin-centre/ui/**` for this task.
Part 1 is the Android session's device QA (a touch tablet whose WebView reports `pointer: fine`, 842x618 landscape). Part 2 is the lead's extra task: the cost of a 10 Hz HUD snapshot.

Method for every layout number below: `scripts/perf/ui-touch.mjs` (new) starts the real production build in headless Chrome with touch emulation (`pointer: coarse`, 5 touch points), forces the busiest HUD the stylesheets have to cope with, and reads `getBoundingClientRect` of every HUD box; software GL (layout only, frame rates mean nothing), screenshots viewed with the Read tool.
Forced Autowala worst case = a trip with a ticking meter, a red signal + a camera + a police check (the lane shows two), road rage, a prompt, a drift, two toasts and a caption (`voice:line`), on top of the "Mama's first day" tutorial card the game shows by itself; `--fare` adds the 3-answer fare question. Forced Tiffin worst case = level 5 played by the engine's bot for 30 s (orders piled up, toasts, hands full, the dish board full) and the tutorial with its coach card open, plus the pause card and the shift briefing.

## Part 1: what the Android QA found, what is true on main today

The Android branch was cut before aw-ui / tf-ui: the screenshots in its QA (`final-zfold-api34/02-autowala-tablet-land-hud.png`) show the old HUD (minimap top-centre next to the speedometer, the "..." tray). On current main the minimap hangs top-left and the speed pod is bottom-centre, so the "minimap overlaps the speedometer" finding does not reproduce (measured at all four tablet sizes: no overlap). The rest is real.

### Findings and fixes

| # | finding (Android QA) | on main today | fix | proof |
|---|---|---|---|---|
| 1 | Autowala `touchMode.js` seeded from `matchMedia('(pointer: coarse)')` only: on a touch tablet whose WebView reports `pointer: fine`, "PRESS ENTER OR SPACE", the WASD card, "Press E to enter Mama's Garage" and "W or the up arrow to go" show until the first touch | true | `createTouchMode(win)` seeds from `isCoarsePointer()` (`src/lib/mobile.js`, the helper the HUD layout already used), asks it again when the watcher starts and when the pointer query flips, still turns on at the first touch and never back off; the private `detectCoarse` (and its test) is gone | `touchMode.test.js`, 13 tests with fake windows (coarse, any-pointer coarse, no matchMedia + touch points, touch laptop, flip on touchstart / pointerdown, never back, listeners removed, and a mocked shared helper proving the seed follows it) |
| 2 | Tiffin `HudLayer.useCoarse` (own matchMedia): "Pause (Esc)" and "Click Got it" on that tablet | true; `CoachMark` had a second private `useMedia('(pointer: coarse)')`, the pause card showed an "Esc resume" hint on any screen | both use `useTouchDevice` (`src/lib/mobile.js`, what `PauseMenu` and `SoloHome` already used); the pause button reads "Pause" and the pause card drops its Esc hint on a touch screen | `touchRule.test.js` renders HUD, coach bar, TopBar and pause card under both answers, and forbids `matchMedia(... pointer / hover ...)` anywhere in the Tiffin UI components and hooks |
| 3a | Autowala tablet-land 842x618: the tutorial card covers the car | the card covers the middle of the road, not the car: a 380x199 px desktop-style card (header, step bar, two paragraphs, progress line, a tall Skip button) because the compact card rules sat under `@media (max-width: 760px), (max-height: 520px)` and a tablet is outside both | `hud/land.css` keys the card on the layout attribute: one compact block in every `-land` layout (step counter + text, Telugu line on a tablet, Skip chip), 402x94 at 842x618 | table below, screenshots |
| 3b | ... the minimap overlaps the speedometer | not reproducible (old HUD): minimap top-left, speed pod bottom-centre, no overlap at any of the four sizes | none needed | table below |
| 3c | (found while measuring) the caption bar slid under the 200 px card: overlap 77..109 px at every tablet size | true | the card publishes its own height (`--aw-coach-h`, `Coach.jsx` ResizeObserver) and the caption hangs under it; the text lanes start right of the street-name label | table below |
| 3d | (found while measuring) the fare question is a 300 px one-column card between the wheel and the pedals, over the car (the 3-in-a-row layout was phone-only media queries) | true | three compact answers side by side on a tablet, a fare question hides the tutorial card | table below |
| 4a | Tiffin 842x618: the banner truncates the level name and its Telugu name ("LUNCH BRE...", "లం...") | true (31 vw) | the banner takes 37 vw on a 761-900 px wide window | `tabletRules.test.js`, screenshots |
| 4b | Tiffin 842x618 / 1024x768: "Set Dosa (3 pc)" ends in an ellipsis on the chalk board | true | long dish names wrap to two lines | same |
| 4c | Tiffin 842x618: the shift briefing is one 900 px column; "Open the stall" is below the fold | true | the pause card and the briefing use their two-column layout up to 640 px tall (was 480 / 600) | screenshots |

Tablet HUD overlaps, Autowala, forced worst case (box pairs with more than 1 px of intersection, measured with `getBoundingClientRect`; the minimap / route pill overlap of 14..20 px is the intended one, the pill is tucked over the disc's lower edge):

| size (touch) | before | after |
|---|---|---|
| 842x618 | caption / tutorial card 242x77 | none |
| 1024x768 | caption / tutorial card 260x82 | none |
| 1180x820 | caption / tutorial card 276x87 | none |
| 1366x1024 | caption / tutorial card 343x109 | none |
| 844x390 (phone, for regressions) | none | none (caption still over the car's projected box, as before) |
| 640x360 (phone) | card / caption 224x4, caption / prompt 201x7 | card / caption none, caption / prompt 201x21 (see below) |

Sizes of the boxes (width x height): tutorial card 380x199 -> 402x94 (842x618), 539x281 -> 624x106 (1366x1024); fare question 329x310 -> 329x119 (842x618), 681x308 -> 681x164 (1366x1024). With the fare question open: before 842x618 caption / fare 242x63 and the card pushed under it; after none. The fare question still stands over the lower half of the car (it is the one thing in the centre column by design); it is 8 seconds long and now 120..160 px high instead of 230..310.

Tiffin, forced worst case (level 5 for 30 s, the tutorial with its coach card open, the pause card, the briefing): no overlaps between any two HUD boxes and nothing off-screen at 842x618, 1024x768, 1180x820 (before only) and 1366x1024, before and after (the pause card sits over the HUD by design). The clipped text before was 4a and 4b (842x618) and 4b (1024x768); after: only the screen-reader-only `.tc-hud-sr` / `.tc-menu-sr` strings (clipped on purpose).

Screenshots (`docs/perf/ui-touch/`, JPEG q72, software GL so colours and frame rate mean nothing):

| file | what it shows |
|---|---|
| `aw-842x618-before.jpg` / `-after.jpg` | Autowala, forced worst case on the Z Fold-class landscape size. Before: the tutorial card is a 200 px desktop card (header, step bar, two paragraphs, big Skip), the Salma caption slides under it and overlaps its text. After: the card is one compact block (step counter + text, Telugu line, Skip chip) in its lane under the alert chips, the caption hangs under it, the car and the road centre are clear. The street label under the minimap ends in an ellipsis ("OLD CI...") at this width. |
| `aw-1024x768-before.jpg` / `-after.jpg` | same at 1024x768: before the card (407x213) sits over the horizon and the caption crosses it; after 471x81 and the caption below. |
| `aw-1366x1024-before.jpg` / `-after.jpg` | same at 1366x1024 (scale 1.42): 539x281 card before, 624x106 after, caption clear, nothing over the car. |
| `tf-842x618-level5-before.jpg` / `-after.jpg` | Tiffin level 5 mid-shift played by the bot. Before: the banner reads "LUNCH BRE..." with its Telugu name cut ("లం..."), the chalk board shows "Set Dosa (3..." with an ellipsis. After: "LUNCH BREAK  లంచ్ బ్రేక్  Shift 5" whole, the dish name wraps to two lines. |
| `tf-842x618-briefing-before.jpg` / `-after.jpg` | the shift briefing. Before: one ~900 px column, scrolled to its bottom button, the title and the menu above the fold. After: two columns, the banner, tip and "Open the stall" on the left, the menu and "New today" on the right (the "Expect" chips row at the bottom of the right column still needs a small scroll at 618 px). |

The fare-question and Tiffin-tutorial screenshots, and the 1024x768 / 1180x820 / 1366x1024 Tiffin shots (no layout change there: no overlaps, nothing off-screen, no clipped text before or after), are not committed (image budget).

## Part 2: the HUD snapshot cost

The lead's brief: "each 10 Hz HUD snapshot lengthens one frame by about 15 ms; with the HUD hidden p95 drops from 30.5 to 16.1 ms; a snapshot must cost < 2 ms of main-thread time and never land in a rendered frame as one long task".

### What I did
The snapshot was `useState` in `AutowalaGame`: every publish re-rendered the whole overlay tree and each piece diffed the whole snapshot again. Now it is an external store (`ui/hud/snapStore.js`, `useSnapView(store, select, equal)` over `useSyncExternalStore`) and every piece reads a VIEW of it (`ui/hud/views.js`, `ui/hud/picks.js`):
- views are rounded to what is printed (distance to formatDistance's 10 m, ETA to its minute, countdowns to their ceil second, bars to a pixel), so a view changes exactly when the pixels would; a sweep test proves the roundings leave `formatDistance` / `formatEta` / `formatCountdown` / `timerTone` output unchanged (0..60 km, 0..20000 s, all quirks);
- `Hud.jsx` is a shell that re-renders only for the root attributes (trip on/off, fare question, alert count, More dot); wallet, clock, trip, alerts, prompt, drift, effects, speedometer, rage, rules, job chip and the More sheet subscribe on their own; minimap, quest log, radio, book, garage, menus and the fare question get a slice (`picks.js`);
- the speed (10 Hz) never goes through React: number, needle and arc are written straight into the DOM (`writeSpeed`, into the text node React owns);
- the More sheet, closed, holds only the job chip (its gamepad poll must keep running).
`AutowalaGame.jsx` (outside `ui/**`) pushes into the store and exposes `window.__autowalaStore.version()` (snapshots offered). Behaviour and look are unchanged: `hud.render.test.js` still passes against the new `Hud`, screenshots of the desktop and touch HUD were viewed, and the existing 3026 tests pass.

### Renders per piece (`renderBudget.test.js`: 10 s drive, trip, signal, mission, 100 snapshots)
wallet, weather, prompt, drift, career, minimap, radio, garage, fare question: 1 each (the first); clock 3, gauge 4, quest 10, rules 12, alert lane 17, trip 32, effects 35. Before: every piece, every snapshot (and the whole tree under it).

### Cost of ONE snapshot (`aw-hud.mjs --cmd micro`: real integrated AMD GPU, game stopped so only the HUD runs, 1536x864 @ 1.25 desktop HUD, one synthetic trip/signal/mission snapshot pushed per animation frame, idle baseline subtracted, median of 3 rounds)
| build | script (store, selectors, React render + commit, DOM writes) | style recalc | layout | main-thread task incl. paint / commit |
|---|---|---|---|---|
| before (setState of the whole tree) | 0.887 ms (rounds 0.79 0.89 1.01) | 0.380 | 0.289 | 2.44 |
| after (store + views) | 0.155 ms (0.15 0.16 0.16) | 0.120 | 0.204 | 0.538 |
Hidden HUD (display:none; React still renders): script 0.573 -> 0.151 ms. So a snapshot is now 0.5 ms of main thread (target < 2 ms), 4.5x less than before, JS alone 5.7x less, and no step of it is a long task (the largest piece is one layout of 0.2 ms).

### Driving A/B on the real GPU (`aw-hud.mjs --cmd ab`: the car keeps changing speed, ~9.4 snapshots/s, variants round-robin in one page session)
Low tier pinned, 1536x864@1.25, p95 / p99 in ms:

| run | HUD | HUD frozen (visible, no updates) | HUD transitions off | HUD hidden |
|---|---|---|---|---|
| before build (quiet machine) | 85.7 fps, mean 11.67, p95 19.4, p99 31.6 | | | 95.7 fps, 10.45, 16.1, 31.0 |
| after build, same quiet minute | 85.9 fps, 11.64, 20.3, 31.4 | 92.8, 10.78, 14.9, 28.3 | 88.7, 11.27, 17.0, 30.1 | 96.3, 10.38, 14.3, 25.6 |
| after build, machine drifted | 96.1, 10.41, 15.7, 29.4 | 89.9, 11.12, 15.3, 30.6 | 96.2, 10.40, 15.3, 29.7 | 91.6, 10.92, 15.2, 27.3 |
| medium tier, before build | 71.5, 13.99, 31.2, 32.6 | | | 66.8, 14.98, 32.9, 34.6 |
| medium tier, after build (GPU shared with another job) | 46.6, 21.46, 45.9, 56.9 | 51.6, 19.37, 39.5, 59.5 | | 53.5, 18.68, 41.3, 59.6 |

Main-thread ms per second (`Performance.getMetrics`), low tier:

| | style recalc | layout | layouts / s | style recalcs / s |
|---|---|---|---|---|
| before, HUD | 17.5 | 5.0 | 81 | 91 |
| after, HUD | 15.3 | 4.5 | 79 | 87 |
| after, transitions off | 11.9 | 2.0 | 10 | 90 |
| after, frozen HUD | 8.8 | 0.5 | 3 | 93 |
| hidden | 0.7 | 0 | 0 | 3 |

### Reading it, honestly
- I could not reproduce "15 ms per snapshot" or a p95 of 30.5 -> 16.1 from the HUD. With the HUD on, the mean frame is 0..1.3 ms longer than with it hidden (up to 2.8 ms on a loaded GPU at medium), p95 +0..6 ms depending on how loaded the machine is, p99 and the worst frames equal; frames over 50 ms happen with the HUD hidden as often, and their long-animation-frame entries are all one function of the shared three.js chunk (`F` in `tiffin-scene-*.js`: 60..660 ms, shader compiles / uploads), not the HUD. Between rounds of one session the machine swings by more than the HUD effect, so none of the frame-time rows is a win I claim for the store; the micro table is what is attributable.
- What the store changed: the JS and DOM-write part of a snapshot (0.89 -> 0.16 ms) and the number of renders (table above). That is ~7 ms of main thread per second, 0.7 %: real, but below the noise of a frame-time A/B.
- What it did not change, and is the bigger main-thread piece of the HUD: ~20 ms/s of style recalc + layout, one layout and one style recalc per frame while driving. Hiding `.aw-corner` removes the layouts (65 -> 3 / s): it is the speedometer's two SVG transitions (`.aw-sp-needle` transform 0.14 s, `.aw-sp-fill` stroke-dasharray 0.14 s): every 100 ms snapshot restarts a 140 ms transition, so one runs almost every frame. `.aw-sp-needle, .aw-sp-fill { transition: none }` takes layouts from 79 to 10 per second and style from 15.3 to 11.9 ms/s, and was 0.37 ms faster per frame and 3 ms lower in p95 in the quiet run (and level with the baseline in the drifted one). I did NOT apply it: the needle and the arc would step at 10 Hz instead of gliding, a visible change to the look; the change is that one CSS rule if you want it (`node scripts/perf/aw-hud.mjs ... --variants "hud|notrans~.aw-sp-needle,.aw-sp-fill{transition:none !important}|nohud"` reproduces the numbers). A glide that stays smooth would need the needle as an HTML element on the compositor, which is a redesign of the dial.
- A frozen HUD (nothing changes) still costs a style recalc every frame (93 / s, 8.8 ms/s) from the infinite CSS animations (`aw-ping` on the find-a-customer dot, pulses) in this headless, uncapped benchmark; `contain: layout style` on the overlay roots and `will-change: transform` on the dial and the panels made no measurable difference in the micro or the A/B (tried, not applied).
- Not measured: the GPU side. The per-process CPU columns of `aw-hud.mjs` came back empty (`SystemInfo.getProcessInfo` returned nothing usable from this headless Chrome), so raster / composite of the HUD tiles and the minimap's 2D canvas (shadowBlur markers, gradients, ~35 draws/s) are only visible through frame times, which were too noisy to resolve them. That is where the remaining hud-vs-hidden gap (and perhaps the 15 ms the aw-probe `--nohud` run saw, which also hides the touch layer and the minimap) most likely sits; the next experiment is hiding `.aw-mm` alone with the machine idle, and a GPU trace.

### Tests
`snapStore.test.js` (store, memoised reader, null before the first snapshot, provider), `views.test.js` (the roundings never change a printed string; trip / rules / rage / alert views; a ticking ride is one view), `picks.test.js` (what the minimap, quest log, radio, garage, book, menus and the fare question re-render for), `speedometer.test.js` (`dialValues`, `writeSpeed` in place into the React text node, the gauge from the store), `renderBudget.test.js` (the table above as assertions), `compact.render.test.js` (strip, alert lane and More sheet fed from a store; closed sheet keeps the job chip).

## Not fixed, risks, files outside `ui/**`
- **Touch wording on a `pointer: fine` WebView.** Both games now use `isCoarsePointer` / `useTouchDevice`. On main that helper keeps a hybrid laptop (pointer: fine + touch points) on the desktop wording until its first touch, so the Z Fold-class tablet only gets the touch wording from the first frame once the Android session's `mobile.js` (`isNative() && maxTouchPoints > 0`) lands on main. I could not run a native WebView here: the tests prove the games follow the shared rule, not that the rule says "touch" in that WebView.
- **CSS-only `pointer: coarse` rules** are unchanged: Tiffin's label floors (`hud.css`, `menus.css`: 12 / 14 px minimum text) and Autowala's 44 px targets (`fares.css`, `minimap.css`, `sheet.css`). CSS cannot call the helper; the fix is a `data-touch` attribute on each game root plus `:where()` twins of the blocks (nesting would drop them on old WebViews), left for whoever owns that risk.
- **Phones:** 640x360 forced worst case (tutorial card + caption + prompt + two alerts together): the caption now clears the card (4 px overlap -> none) but overlaps the prompt by 21 px instead of 7; the 844x390 numbers are unchanged. The street-name label under the minimap ends in an ellipsis at 842 px.
- **The fare question** (8 s, 3 answers) still stands over the lower half of the car; it is 120..164 px high now, was 230..310.
- **Briefing at 842x618:** two columns now, but the right column's last row ("Expect" chips) needs a short scroll.
- **Perf, open:** the GPU side of the HUD (raster of invalidated tiles, the minimap's canvas); the speedometer's SVG transitions (measured, not applied: look change); the frame-time A/B is too noisy on this shared machine to resolve < 1 ms.
- **Risks:** `AutowalaGame.jsx` now renders the overlay pieces from a store: a new overlay that reads `snap` must be given a slice (`ui/hud/picks.js`) or the store through `useView`; a view that rounds a number must keep the printed text unchanged (the sweep tests in `views.test.js` are the guard). `Coach.jsx` writes `--aw-coach-h` on the `.aw` root (removed when the card goes).
- **Tooling slip, fixed:** a scripted edit re-encoded a few files (middle dots, an apostrophe, Telugu test strings); repaired and checked against main (commit "restore UTF-8 text"); the screenshots here were taken after the repair.
- Files outside `src/games/*/ui/**`: `src/games/autowala/AutowalaGame.jsx` (store wiring), `scripts/perf/ui-touch.mjs`, `ui-touch-tiffin.mjs`, `aw-hud.mjs`, `scripts/perf/README.md`, this report and `docs/perf/ui-touch/`.