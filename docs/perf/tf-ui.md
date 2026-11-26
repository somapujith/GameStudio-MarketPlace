# tf-ui: Tiffin Centre's UI and on-screen picture (landscape first)

Branch `perf/tf-ui`. Owner brief: "the Tiffin Centre UI isn't done perfectly, the rendering mechanism and all is messed up" and "Tiffin Centre must mainly be in horizontal orientation, so the controls are playable". This page is the defect list, what was changed, what was measured and what is left.

## How it was audited
A small CDP harness (not committed; it only drives `scripts/perf/cdp.mjs`) opened the game at 640x360, 740x360, 844x390, 915x412, 932x430, 1024x768, 1180x820, 1280x720, 1366x768, 1536x864 and 1920x1080 (touch emulation on for the phones and tablets), reached each state through the real session (the tutorial with the test bot `shared/tiffin-centre/tutorial.bot.js` driven from the page, practice levels 1 / 4 / 5 / 12 with the greedy bot, a virtual clock to fast-forward), and every screenshot was looked at. WebGL failure was forced with `--disable-3d-apis`, context loss with `WEBGL_lose_context`, co-op was shown by giving a local session an online `mode` and two teammates (no server here). The real GPU (AMD integrated) was used for the pictures; frame-time numbers from it were useless this session (see "Cost").

## Defects found, with severity

| # | Severity | Defect (before) | Status |
|---|---|---|---|
| 1 | high | The HUD was not designed for landscape: a portrait layout was the default, with three stacked media-query layers (portrait under 900 px, wide over 900x521, "phone landscape" under 520/460 px tall) written in raw px. At 1080p all type was 10 to 12 px; at 360 px tall the compact layer crowded the stall. | fixed: one landscape grid, one height-based scale |
| 2 | high | At 1920x1080: a 12-row dish list with two-language names down the whole right side, two stretched top plates 900 px wide and mostly empty, a bottom dock spanning the full width. The picture was the leftover. | fixed (slim chalk board, auto-width plates, right-aligned dock) |
| 3 | high | The tutorial coach bar sat where customers' order and speech bubbles live; bubbles ignored it (844x390: order bubbles hidden under the card); at 640x360 the bar was squeezed to 200 px ("Nar / ann" and no Got it); the open card text was 15 px times the page scale and covered about 30 % of a 1080p view; the stall panel's gas gauge and the highlighted Swap button were hidden behind it in the gas lesson. | fixed |
| 4 | high | 844x390 at level 4+: five station groups need about 980 px and the dock showed two; the bottom-left held seven buttons (hands, trash, voices, subtitles, recentre, help) in 340 px; "EMPTY" overflowed both hand buttons. | fixed (hands are quiet outlines, four fewer permanent buttons, the dock scrolls with edge fades) |
| 5 | medium | Pause card: one column of five buttons plus settings, taller than a 360 px phone; the touch controls list had an empty key column; the help card the same. | fixed (two columns on short screens, empty key column removed) |
| 6 | medium | Shift briefing and the home hero: a single tall column, a whole screen of banner before the first button at 390 px tall. | fixed (two-column briefing, 104 px hero) |
| 7 | medium | Cost: endless animations of `box-shadow` (alarm rings), `outline-offset` (walking marker), `filter: brightness` (glows), `background` (edge flash) and a 1 s linear `width` transition on the shift bar re-run every tick; each repaints or re-lays-out a layer over the live canvas every frame. | fixed (see "Cost") |
| 8 | medium | Graphics setting: the note never said which tier was running versus the one just picked, and a pick could only take effect after leaving the stall. A lost WebGL context showed the generic "stove would not light" card. | fixed (pending note, "Apply now", its own "picture dropped" card) |
| 9 | medium | With the HUD scaled up, a level-12 dock on a 1024 to 1366 px screen wrapped into three rows (262 to 292 px, over a third of the height); on 1920x1080 into two (239 px). | fixed (bottom band 85 px at 1024x768, 169 px at 1280x720 and 89 px at 1920x1080, from 259 / 173 / 94 before the scale went up) |
| 10 | low | `OrientationHint` ("turn your phone sideways ... playing upright works too"), the portrait-only `.tc-leave` rule and `hud.portrait.test.js` are dead with the orientation gate. | removed |
| 11 | low | Co-op: the hub's connection chip ("Connected") is unreadable on a bright sky. | fixed (dark plate) |
| 12 | low | The stall panel, when open, overlapped the dish chips. | fixed (opens as an overlay left of the board, below the coach bar) |
| 13 | low | The dish board clipped silently when it had more dishes than room. | fixed (chalk scroll edge) |

3D picture (screenshots at every daypart in a 2.28:1 window, 1366x600, level 4, medium tier; FOV and framing are fine from 4:3 to 21:9, the hands stay in view and nothing stretches):

| # | Severity | Observation | Owner |
|---|---|---|---|
| P1 | medium | Regular customers' gold star floats in a **translucent square** (additive 26 cm plane behind the star). | fixed here: `models/marks.js` uses a disc (one line plus the import) |
| P2 | medium | Street vehicles and far pedestrians are blocky: the scooters, the auto and the bus are boxes of flat cubes (visible in every picture; the lead's "blocky cubes"). Customers and the cook's hands are fine. | tf-cpu: `models/street-vehicles.js`, `scene/street-vehicles.js` |
| P3 | medium | The counter top to the right of the stove (and the wooden floor in front of it) smears into long horizontal streaks at a grazing angle: anisotropic filtering looks off or the UVs stretch. Visible at every hour in `after-1366x600-dusk-3d-qa.jpg` (bottom right). | tf-gpu: `scene/textures.js`, `models/textures-pbr.js` |
| P4 | low | At 19:30 a soft pink blob hangs at the end of the street (about 57 % across, 27 % down in the 1366x600 frame), not tied to any light. | tf-gpu: `scene/sky.js`, `scene/lighting.js` (not investigated further) |
| P5 | info | Colours and lighting read correctly at 06:18 (rose gold), 13:00 (hard white), 19:30 (purple sky with warm bulbs) and 22:00 (blue night with warm bulbs); no flicker or z-fighting was seen in still frames (not checked in motion). | |

## What changed

* **One scale.** `.tc` defines `--tc-u = clamp(1px, min(0.0972dvh + 0.5px, 0.0833vw + 0.2px), 1.7px)`: 1 px up to a 430 px tall phone (so a 44 px target stays 44 px), about 1.2 px at 720, 1.55 px at 1080, never grown by a narrow window. Every HUD length is `calc(N * var(--u))`; the HudIcon / DishIcon sizes scale with it too (`--ico` pins a size from CSS).
* **Capped sub-scales.** The dish board scales with `--ub = min(--u, 1.3px)` and the stations dock (and its icons) with `--ud = min(--u, 1.1px)`: at 1080p the board is 256 px wide instead of 305 and a full level-12 dock stays one row instead of two. Targets stay at least 44 design pixels everywhere.
* **One grid** (`ui/hud/hud.css`, rewritten, 1000 lines of layered overrides became one landscape file): order rail left, picture middle, dish board right, hands under the left thumb and the stations dock under the right, safe-area insets on all four sides. Subtitles, the co-op bar and the coach bar live in the middle column. A tall-but-narrow window (aspect under 1:1) falls back to stacked bands; nothing is optimised for portrait phones any more.
* **Information design.** Dish board: icon plus ready count plus a "wanted" badge (names and cooking / held / needs on roomy screens), slim or wide at the player's choice (remembered); stall status behind one button that wears the number of things to look at, events stay visible under it; hands are quiet outlines when empty; recentre only while the head is turned; the voices switch lives in the pause menu; chits are token + ring + dish icons (names back on roomy screens).
* **Coach bar** is centred between the rail and the board (the HUD publishes `--tc-hud-left` / `--tc-hud-right`), toasts hang under it, bubbles and arrows are kept below it (`freeBounds`), the stall panel opens below it.
* **Menus on short screens**: two-column pause card, two-column briefing, compact home hero, no blank key column.
* **Graphics**: "You picked High, but the stall is still running at Low ... Press Apply now to rebuild the picture at once (the shift stays paused)". Apply now bumps a key in `TiffinGameImpl` that rebuilds scene and audio while the session stays paused (verified live: low to medium, session still `paused`). The home screen, which has no scene, says it starts the next time the stall opens.
* **Status**: lost context has its own card ("The picture dropped out ... usually comes back by itself").
* **Removed** `OrientationHint`, the landscape-hint logic and tests, `hud.portrait.test.js` (a CSS-text test of the removed layout) and the portrait CSS.

## Cost of the UI over a live canvas
Audit of `tiffin.css`, `hud.css`, `menus.css`: no `backdrop-filter`, `filter: blur`, `mix-blend-mode` existed (and none was added); `will-change` only on the bubble and edge-arrow anchors that move every frame. What did cost: animated `box-shadow` (nine "alarm" selectors: dish tiles, stock bars, gas, Swap, Tend, the Stall button, events), `outline-offset` (the marching-ants walking marker, six selectors), `filter: brightness` (five glow rules), `background` (the edge-arrow flash), the tutorial coach's hint `box-shadow`, and the shift bar's `width`. All are now transform or opacity on the element or on a `::before` / `::after` ring or wash, and `hud.layout.test.js` fails the build if any HUD or menu `@keyframes` animates anything else. The shift bar has no transition (a 1 s step of a 160 px bar is one pixel). Static shadows and gradients are unchanged.

Measured in **one Chrome session, alternating old and new**, so the machine's load cancels: the game at level 4 with the 3D loop stopped, and a synthetic busy HUD of 41 elements built from the real class names (6 Collect buttons, 8 urgent dish tiles, 6 walking slots, 4 gas gauges "out", 4 Tend alerts, 4 paying bubbles, 3 edge flashes: every endless animation the old HUD had). The OLD keyframes (box-shadow rings, filter glow, marching outline, background flash) were injected beside the new ones and switched on and off on the same elements; 6 alternating 3 s windows, uncapped `requestAnimationFrame` and `Performance.getMetrics` deltas, 1536x864 at 1.25:

| | old animations | new animations |
|---|---|---|
| rAF frames per second, median of 6 windows | 55.9 | 95.0 |
| main-thread task per frame | 18.6 ms | 10.3 ms |
| style recalculation per frame | 12.1 ms | 5.0 ms |
| every window (fps) | 48.1 52.6 67.8 53.4 60.6 55.9 | 70.0 32.7 178.6 95.0 97.6 60.1 |

The 32.7 fps window coincided with a load spike from another process; four of the six new windows beat the best old one. This is an upper bound: a real shift animates far fewer elements at once (a handful of rings, one or two Collect glows). It is a measurement of the animation primitive, not of a whole game. The script is not committed (it only drives `scripts/perf/cdp.mjs`).

Also removed: two ancestor `:has()` rules (`.tc-hud:has(.tc-hud-dock[data-rows='2']) ...`) that re-evaluate whenever the dock's subtree mutates, which the frame bus does every frame (`hud.layout.test.js` now pins `:has()` to four small local selectors). Not measured separately.

What was **not** measurable here: the whole-game cost. Four full-game traces (level 4, a greedy bot, 3D stopped) of the old and the new build read 41.1, 12.8 ms per frame (old) against 11.3, 27.4 ms (new) with raf at 25 to 90 fps: the machine's load swung by more than the effect, so they say nothing. The per-frame JavaScript of the HUD (the frame bus writing `--p` and the seconds labels, the 10 Hz re-render of the whole HUD tree) is untouched; it is tf-cpu's (memo / selectors).

## Tests
`npx vitest run src/games/tiffin-centre shared/tiffin-centre` (PowerShell): 77 files, 1793 tests: 1792 pass, and `scene/loader.test.js` "prefetchChunks" fails only when the whole suite runs alongside other agents' GPU jobs (15/15 when run alone, twice). New: `hud/hud.layout.test.js` (scale formula, safe areas, one grid, no portrait phone layout, 44 px targets, compositor-only keyframes, reduced motion, coach bar placement, every rendered class styled), `hud/boardPref.test.js`, `freeBounds` with the coach bar, `pendingNote` and the Apply wiring, the `lost` status. Removed with their code: the portrait HUD CSS test and the landscape-hint tests. `scene/loader.test.js` "prefetchChunks" is a wall-clock test (waits 1.2 s for three chained loads) and failed twice in this worktree while the machine was loaded by other agents' GPU runs, and passed at once in the shared checkout; it is not touched by this branch.

## Screenshots (`docs/perf/tf-ui/`, JPEG, all under 150 KB)
Same state before and after, headless Chrome on the real GPU, tier auto (low on the touch-emulated phones, medium on the desktop sizes):

| before | after | what it shows |
|---|---|---|
| `before-844x390-tutorial-start.jpg` | `after-844x390-tutorial-start.jpg` | tutorial welcome. Before: "EMPTY EMPTY" overflowing, a 2-column dish board that clips its last row, 7 corner buttons. After: quiet hands, the coach bar centred between rail and board, a clear stove. |
| `before-844x390-level4-busy.jpg` | `after-844x390-level4-busy.jpg` | level 4 mid-shift (different customers, same minute of the shift). After: wanted badges on the dish tiles, the status button reads "1", the dock scrolls with a fade, three order bubbles clear of the HUD. |
| `before-844x390-pause.jpg` | `after-844x390-pause.jpg` | pause. Before: one column, the last button touching the bottom edge. After: two columns, Resume plus settings visible at once. |
| `before-640x360-tutorial-start.jpg` | `after-640x360-tutorial-start.jpg` | the smallest reference phone. Before: coach bar squeezed to "Nar / ann", no room. After: readable bar, a slim one-column dish board that leaves 70 % of the width to the stall. |
| `before-1920x1080-tutorial-start.jpg` | `after-1920x1080-tutorial-start.jpg` | desktop. Before: type 11 px, 12 full-width rows, the whole width of the bottom. After: 1.55x type, a compact 2-column board, a right-aligned dock, a coach bar in the middle. (Recoded to 72 % size to fit 150 KB.) |
| | `after-844x390-stall-panel.jpg` | level 5: the stall panel (LPG gauge, stock bars, Board tile) opened beside the dish board. |
| | `after-1366x600-dusk-3d-qa.jpg` | 3D QA at 19:30, HUD hidden, 2.28:1: purple dusk, warm bulbs, the pink blob (P4), the stars in squares (P1, fixed after this shot), the smeared counter (P3), the blocky scooter (P2). |

Honest description of what is still not perfect in these pictures: at 640x360 the dock shows two of its five stations (it scrolls; the stations are also tappable in the stall and from the dish tiles); the dish board's last row is behind a scroll; the results screen on a 390 px tall phone needs a short scroll before the galla.

## Reference geometry (level 12, ~30 s in, painted boxes, px)
Painted boxes of the top bar (full width), dish board, order rail, hands and dock, as a share of the viewport, level 12 about 25 s in with no bot (one or two customers). Before = main at the start of this stream (production build), after = this branch. `ready px` is the size of the big ready count on a dish tile.

| size | before: top / rail w / board w x h / bottom h | after: top / rail w / board w x h / bottom h | before covered | after covered | ready px before / after |
|---|---|---|---|---|---|
| 640x360 | 48 / 152 / 144x177 / 75 | 44 / 150 / 70x138 (slim) / 82 | 51.3 % | 45.8 % | 19 / 20 |
| 740x360 | 48 / 152 / 144x177 / 75 | 44 / 150 / 136x138 / 82 | 49.0 % | 47.7 % | 19 / 20 |
| 844x390 | 48 / 152 / 144x207 / 75 | 48 / 150 / 136x164 / 82 | 46.2 % | 45.9 % | 19 / 20 |
| 932x430 | 48 / 152 / 144x247 / 75 | 54 / 150 / 136x198 / 82 | 43.6 % | 44.4 % | 19 / 20 |
| 1024x768 | 68 / 290 / 270x146 / 259 | 67 / 158 / 207x504 / 85 | 49.1 % | 42.4 % | 24 / 23 |
| 1180x820 | 68 / 290 / 270x166 / 259 | 74 / 225 / 232x532 / 89 | 45.7 % | 44.8 % | 24 / 26 |
| 1280x720 | 69 / 290 / 270x160 / 173 | 79 / 228 / 235x345 / 169 | 39.5 % | 48.6 % | 24 / 26 |
| 1536x864 | 69 / 290 / 270x263 / 173 | 87 / 255 / 256x467 / 169 | 37.3 % | 45.5 % | 24 / 29 |
| 1920x1080 | 69 / 290 / 270x558 / 94 | 101 / 294 / 256x661 / 89 | 27.1 % | 36.2 % | 24 / 29 |

Read it honestly: on phones the footprint is the same or smaller and the picture keeps about 55 %. From 1280x720 up the panels cover **more** than before (up to 36 to 49 % of the painted area against 27 to 40 %), because the type and targets are deliberately 1.2 to 1.55 times bigger (the lead's "tiny at 1080") and the dish board now shows every dish (7 rows) where the old one showed 3 to 5 scrolling rows at 720 to 864 px. What the player sees is different from the number: the panels hug the edges (top, left rail, right board, bottom) and the middle two thirds of the picture, with the stove and the hands, is free; the old 1920x1080 HUD put a 12-row two-language list down the right and a full-width dock along the bottom. The knobs are `--tc-u` (cap 1.7 px), `--ub` (dish board, 1.3 px) and `--ud` (dock, 1.1 px). Lower them if a smaller footprint on big screens matters more than size.

## Not done, and why
* **`bench.mjs --game tiffin` before/after.** It read 7.6 to 8.9 fps with p99 of 0.7 to 16 s in this session, base and branch alike (about ten agents were sharing the GPU and the CPU); two interleaved runs gave "base 8.9 fps / branch 2.5 fps", which is the noise, not the UI, and the series was stopped. A tier-low run and the other runs of the planned series were not done. The cost evidence is therefore the in-session A/B above, plus the structural guarantees the tests enforce; nobody should read a frame-rate win into this branch.
* **Gamepad.** Tiffin Centre has no gamepad code (`getGamepads` appears nowhere in it); the controls are real buttons with a visible focus ring, so a browser or an OS that maps a pad to focus navigation works, nothing more. Not built.
* **Telugu / Hindi** render in the subtitle strip, bubbles, chits (the dish names), station labels, the banner and the briefing at every size checked; the Telugu dish names were dropped from the dish board tiles to fit six rows in 720 px (they remain on the station labels, the cook / prep / board sheets and the banner).
* The results screen was only re-arranged by the existing 2-column rule; a landscape-specific results layout was not designed.
* Street vehicle / pedestrian cubes, the smeared counter and the pink dusk blob (P2 to P4) are reported, not fixed (other streams' files).
* The co-op lobby is a hub page (`src/pages`), not part of this stream; the in-room HUD was checked with a faked online session only.

## Merge notes
Main has moved since this branch started (landscape gate, tf-logic): `ui/menus/menuModels.js` and `ui/menus/SoloHome.jsx` were touched there; this branch adds one `lost` entry to `STATUS` in `menuModels.js` and does not touch `SoloHome.jsx`. `hud.css` is a full rewrite (generated once from a template with `Nu` size tokens; edit the CSS directly from now on).

## Files changed outside `src/games/tiffin-centre/{ui/**, tiffin.css, TiffinSolo.jsx, TiffinGame.jsx, OnlineGame.jsx}`
* `src/games/tiffin-centre/TiffinGameImpl.jsx` (tf-cpu): `sceneKey` (Apply now), `lost` status, `paused` waits for the scene. Small; no change to the load or render loop.
* `src/games/tiffin-centre/models/marks.js` (tf-cpu): the star halo is a `CircleGeometry`.
