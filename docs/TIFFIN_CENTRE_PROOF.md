# Tiffin Centre: end-to-end proof in a real browser

Integration QA of the whole game running together in headless Chrome 158 (Windows 11): 3D first-person scene, PBR models, faces, HUD, menus,
audio, dialogue, tutorial, sessions with auto-save, the room adapter. Screenshots are in `docs/tiffin-centre-proofs/` (JPEG, each under 150 KB,
1280x800 unless the name says `390` = 390x844 or `844x390`).

## How it was run (read this before trusting any number)

* **Isolated checkout.** A detached git worktree of the branch tip, vite dev on its own port, plus a production build (`vite build`, 20 s) served by
  `vite preview`. The Autowala and engine working-tree edits never touched it.
* **Commits.** The branch moved while I worked. A first pass on `277283d` was thrown away. The main pass is `71f1ece`; the lighting-hour shots, the
  full tutorial and the tutorial-chapter shots were re-taken on `ec8e1bb` (the tip at the end). The HUD, menus and session code did not change between
  `71f1ece` and `ec8e1bb` (only scene/models did), so the menu, pause, resume, co-op and mobile shots from `71f1ece` still describe the tip.
* **No GPU.** Chrome used SwiftShader (software GL), so frames take 0.25 to 2 s. The scene auto-selects the new `lite` quality tier immediately. All frame
  and fps numbers are therefore SwiftShader numbers, not device numbers. Because frames are that slow, the screenshots of gameplay moments are taken
  with the session paused and the pause card hidden (a "freeze shot"), so what you see is the exact state at that tick.
* **Drivers.** (a) a keyboard-only bot (Tab/Enter on "Got it", A/D to walk, Space/E to work, number keys in the cook sheet); (b) page-side scripted players
  that call `window.__tiffin.session.dispatch`: `shared/tiffin-centre/tutorial.bot.js` for the tutorial, the greedy `chooseAutoAction` for practice
  shifts. Scene reached through `window.__tiffin = { session, scene, audio }`.
* **Co-op.** There is no database here. The co-op page was driven with a fake `WebSocket` (stub injected before the page loads) that replays the messages
  of a **real `GameRoom`** (the in-process harness of `worker/tiffin-centre.room.test.js`: 2 seats, level 4, bots over the wire, 407 `{t:'state'}` and
  `{t:'room'}` messages with real engine states, emotes included) and a mocked `/api/me` and `/api/rooms/:code`. The real client path (`useRoomConnection`,
  `useRoomSession`, `roomCore`, `OnlineGame`, HUD) ran unmodified. It is not a real socket, a real Durable Object or a real database.
* **Environment artifact (not a product bug).** With `node_modules` junctioned into the worktree, vite served the web fonts through `/@fs/` as HTML, so
  the fonts failed to decode. Fixed in the worktree only with `resolve.preserveSymlinks`; the main tree is unaffected.

## Result table

| # | Area | Result | Evidence |
|---|------|--------|----------|
| 1 | `/play/tiffin-centre` home, locked co-op teaser, Start tutorial | PASS | `01-solo-home-1280`, `-390`, `-844x390`; no console output |
| 2 | Tutorial start to finish (128 steps, 16 chapters) | PASS via session actions; **chapters 8 to 14 cannot be done through the HUD (bug H1)** | `02-tut-*` (30 shots), `02-dosa-*`, `02-tut-results`, `02-gamepage-*` |
| 3 | Practice shifts L1, L4, L12, six lighting hours, faces, bubbles, rings, tokens, strip, hands, off-screen chips, walk-outs, burnt dish | PASS with findings (H5, H6, H7) | `03-L01-*`, `03-L04-*`, `03-L12-*` |
| 4 | Pause, quit, auto-save, reload, Resume, state equality | PASS (one wrong sentence, H2) | `04-*`; tick/money/lives equal before and after |
| 5 | Console: errors, warnings, exceptions, unhandled rejections | PASS: no real error or exception in any normal flow | table below |
| 6 | Timing and memory | measured (SwiftShader) | section "Numbers" |
| 7 | No WebGL: status screen with a way out | PASS after my fix (it was FAIL, see "Fixed by me") | `07-webgl-*` |
| 8 | Co-op page, 2 players, teammate chip, emotes, connection chip, drop and reconnect, leave, results | PASS (fake socket replaying real room states) | `08-coop-*` |

## 1. Solo home

`01-solo-home-1280.jpg`, `01-solo-home-390.jpg`, `01-solo-home-844x390.jpg`. Shows the Start tutorial card, the padlocked "Co-op table (2 to 4 friends)" teaser
("Finish the tutorial and the shutter goes up") and the locked practice shifts with "Peek at the shifts". Telugu title renders in the web font.
After the tutorial flag is set the same page shows "Open a table with friends / Invite friends" and the 12 shift cards
(`03-practice-map-1280`, `09-home-practice-390x844`, `09-home-practice-844x390`).
Copy note: the card says "About three minutes"; the 128-step tutorial ran 371 to 470 game seconds (6 to 8 minutes of game clock) for a scripted player,
so a person will need longer (L9).

## 2. Tutorial

* Driven end to end by `tutorial.bot.js` through `session.dispatch` (it does what each lesson asks, including prep, tend, gas swap, menu board, special
  orders, rain, power cut, inspector, books). 1280x800 on `ec8e1bb`: all 128 steps, `tutorial.finished = true`, 371 game ticks, 729 s wall clock.
  Also completed at 390x844 (reduced shot list) and on `71f1ece` at 1280x800 (470 ticks).
* Keyboard-only: on the earlier 76-step tutorial (`277283d`) the keyboard bot (Tab+Enter, A/D, Space, sheet number keys) finished all 76 steps in 589 s with
  no HUD refusal. On the 128-step tutorial the keyboard path cannot reach chapters 8 to 14 because the HUD does not show or accept the operations controls
  (bug H1), so a keyboard-only end-to-end run of the current tutorial was not possible.
* One beat per chapter (the shot is taken at the first ticks of the step; `-390` = phone portrait):
  look `02-tut-01-look-hands`, `02-tut-01-look-welcome`; tokens `02-tut-02-tokens-token`, `02-tut-02-tokens-states`;
  tawa dosa `02-tut-03-tawa-dosa-cooking`, burn demo `02-tut-03-tawa-burn-demo`, masala `02-tut-03-tawa-masala`, podi `02-tut-03-tawa-podi`,
  set `02-tut-03-tawa-set`, pesarattu `02-tut-03-tawa-pesarattu`;
  **dosa life cycle** `02-dosa-a-pour-spread-masala_dosa` (pour and spread, progress under 20 %), `02-dosa-b-cooking-dosa`, `02-dosa-c-ready-dosa`, `02-dosa-d-burnt-masala_dosa` (smoke icon on the slot);
  idly `02-tut-04-idly` (+`-390`); kadai `02-tut-05-kadai-vada`, `02-tut-05-kadai-bajji`; chai `02-tut-06-chai`;
  serve and collect `02-tut-07-serve-orders`, `-carry`, `-collect` (+`-390`), `-tips`;
  stock `02-tut-08-stock-prep`, `-sold-out`; heat `02-tut-09-heat-intro`; gas `02-tut-10-gas-low` (+`-390`), `-gas-swap`, `-gas-cost`;
  board `02-tut-11-board-intro`, `02-tut-11-board-cook-390`; specials `02-tut-12-special-parcel`, `-big`; weather `02-tut-13-weather-rain`, `-power-cut`, `-inspector`;
  profit `02-tut-14-profit-books`, `-result`; game flow `02-tut-15-flow-money`, `-clock`, `-levels`, `-coop`; rush `02-tut-16-rush` (+`-390`); outro `02-tut-16-outro` (+`-390`).
  Shots that are missing from this list simply did not get a frame (a few ack-only pages go by in one tick); every chapter has at least one.
* Results: `02-tut-results.jpg` ("TUTORIAL COMPLETE! Co-op with friends unlocked / Invite friends / Back"), `02-tut-results-390.jpg`.
* Game page. Locked: `02-gamepage-locked-1280` ("Play tutorial", "Finish the tutorial to open a table with friends"). Unlocked: `02-gamepage-unlocked-1280`,
  `-390` show **Create table**. Note: for a *signed-in* user the page trusts the server flag (`user.gameStats['tiffin-centre'].tutorialDone`), not
  `localStorage['jalebi.tutorial.v1.tiffin-centre']` (`platform/game/tutorial.js`, by design: the local mirror is for signed-out visitors). I mocked `/api/me`
  with the server flag to get the unlocked page. The tutorial-complete POST returned 401 here (API down), which is the expected offline path.

## 3. Practice shifts

* Lighting hours 6.3, 9, 13, 17.7, 19.5, 22 on L1, L4 and L12, all six taken on one frozen frame per level so the only difference is the light
  (`03-L01-hour-*`, `03-L04-hour-*`, `03-L12-hour-*`, on `ec8e1bb`): dawn warm, flat daylight, low gold sun, dusk, lamplit evening, night with the HUD still legible.
* What the shots show: customers with different faces and expressions (scowling, shouting, laughing), order tokens over their heads and on the chit rail,
  coin patience rings with seconds, the availability strip with READY / needs counts, the cook's own hands on the tawa and the dishes in the held slots,
  Telugu and Hindi subtitles with the English line (`03-L01-speech-1280`; spoken lines seen in the run log, for example "ఓయ్ అన్నా! దూరం నుంచే వాసన వచ్చింది / Hey anna! I could
  smell it from far away" and "हमेकू 2 दोसा लगा दे आपा / 2 dosa for us, aapa"), off-screen indicators (`03-L01-head-left-1280`, `03-L01-head-right-1280`: the head turned and a token chip
  with an arrow pointing at the off-screen customer).
* Provoked on purpose with a "neglect" script on L1: pay warning `03-L01-pay-warning-1280`, an **unpaid walk-out** `03-L01-unpaid-1280`, a lost heart
  `03-L01-life-lost-1280`, an **angry walk-out** `03-L01-angry-1280`, and the burnt-dish events (`03-L01-burnt-1280` is the moment of the event but the camera faced the chai counter;
  the clear burnt-dish picture is `02-dosa-d-burnt-masala_dosa`).
* Results: `03-L01-results-1280`, `03-L01-results-390` (PERFECT SHIFT, 3 stars, takings, tips, cost), `03-L04-results-1280` (CLOSED FOR THE DAY, 0 stars, takings/tips/cost still shown).
  The dispatch bot cleared L1 with 3 stars on `71f1ece` and on the earlier commit also L4; on `71f1ece` the same greedy bot loses L4 and L12 (customers walk away). That is a bot limit, not a verdict on balance.
* Retry and Next level work: Results then "Retry shift" restarted at tick 0 with the HUD back; "Next level" showed the level-2 briefing and started level 2; progress was saved
  (`{"1":{"stars":2,"earned":687}}`, level 2 unlocked) and the home card list updated (`03-home-after-progress-1280`).
* Phone: portrait and landscape HUD, pause, help (`09-hud-*`, `09-pause-*`, `09-help-*`).

## 4. Pause, quit, auto-save, reload, Resume

Verified on `71f1ece` with level 1 (`04-*`):

* Esc opens "Chai break" (`04-pause-menu-1280`); the tick stays frozen while paused (71 then 71); Resume advances it.
* Pause then "Leave the stall" then confirm (`04-quit-confirm-1280`) returns home with a **Resume your shift** card (`04-home-resume-after-quit-1280`); reload keeps the card
  ("49% done, 1:16 left", `04-resume-card-after-reload-1280`); Resume opens straight into the pause card (`04-resumed-paused-1280`); pressing Resume continues.
* **State equality: tick 74 = 74, money 0 = 0, lives 4 = 4** before quitting and after resuming (`q4` run). A second run (level 3, no quit, hard reload while playing) also offered the card and
  resumed at the same tick or one tick later (the save is written on `pagehide`); money equal.
* Restart from the pause menu asks first ("Restart this shift? Today's tally so far is lost"), then resets to tick 5 (the old save is replaced by the new shift's).

## 5. Console

Collected from `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded` (unhandled promise rejections arrive as exceptions) for every flow on the new commits.

| Class | Message | Where | Verdict |
|---|---|---|---|
| expected | `AudioContext was not allowed to start` (25x) | every game flow, before the first gesture | headless, autoplay policy |
| expected | `Blocked call to navigator.vibrate` (5x) | first haptic before a tap | headless |
| expected | `GL Driver Message ... GPU stall due to ReadPixels` (19x) | SwiftShader, every game flow | software GL |
| expected | `KHR_parallel_shader_compile extension not supported` (1 per game page) | three.js on SwiftShader | software GL |
| expected | `Failed to load resource ... 401` for `/api/games/tiffin-centre/tutorial/complete` (2x) | tutorial end, API down | offline path |
| expected | `THREE.WebGLRenderer: Error creating WebGL context` (x2, React StrictMode) | only the no-WebGL runs | the point of that test |

**Real errors, exceptions or unhandled rejections: none** in the solo home, tutorial (2 viewports), practice L1/L4/L12, pause/resume, co-op replay (3 viewports), Results, game page.
The only genuinely wrong message was the web-font decode failure, which was the worktree artifact above.

## 6. Numbers (SwiftShader, 1280x800; treat as upper bounds for cost, not as device fps)

| Measure | Dev server (cold-cache first load 21 s; warm below) | Production build |
|---|---|---|
| Solo home ready | 0.8 s | 0.52 s |
| Home resources / transferred | 250 requests, 11.9 MB (unbundled) | 38 requests, 591 KB (uncompressed preview) |
| "Open the stall" to HUD on screen | 5.9 s | 5.8 s |
| ... to shift clock running (two frames drawn) = first interactive frame | 9.5 s | 6.1 s |
| JS heap at start of play, 31 s, 91 s, 151 s, 183 s | 35.7, 49.1, 32.9, 52.2, 60.5 MB (GC saw-tooth) | 28.8, 34.7, 29.9, 29.2, 29.2 MB (flat) |
| After 3 minutes (two shifts) | 60.5 MB | 29.2 MB |
| Heap after leaving the stall and a forced GC (before play: 11.7 / 5.0 MB) | 22.4 MB | 18.2 MB |
| Average JS time of a rendered frame, `lite` tier (auto tier here) | 6.7 to 28.9 ms, p95 24 to 55 ms | 4.9 to 23.9 ms, p95 7.7 to 21.8 ms |
| Main thread busy / script CPU, `lite` | 39 to 50 % / 36 to 46 % | 6.5 to 15.7 % / 4.5 to 12.7 % |
| Draw calls per frame (avg / max), `lite` | 132 to 141 / 152 | 137 / 154 |
| Triangles per frame (avg / max), `lite` | 97 to 98 k / 106 k | 96 to 99 k / 109 k |
| `low` tier | 135 calls, 99 k tris, 2.7 fps | 135 calls, 98 k tris, 3.1 fps |
| `medium` tier | 255 calls, 179 k tris, 1.3 fps | 285 calls, 181 k tris, 1.5 fps |
| `high` tier | 423 calls, 195 k tris, 0.5 fps | 388 calls, 187 k tris, 0.9 fps |
| DOM nodes after play / JS event listeners (GC-dependent counter) | 850 to 1070 / 800 to 8600 | 750 to 1020 / 900 to 3300 |

Frame rate here is limited by the software rasteriser (about 4 fps at `lite`), so the JS columns are the meaningful ones: `lite` costs 5 ms of JS per frame in the production build.
`renderer.info` geometries and textures grow from 138 and 84 at the start to about 286 and 176 during the first 150 s (customers' bodies and faces being built and cached), then stay flat
(the next shift in the same session added none: 282 and 176). I read that as a cache that fills up, not a leak, but it was not proven over a longer session.
Production bundle (gzip): `tiffin-three` 151 KB, `tiffin-dialogue` 92 KB, `tiffin-people` 83 KB, `tiffin-scene` 63 KB, `tiffin-models` 46 KB, `tiffin-audio` 40 KB, `TiffinGameImpl` 35 KB, plus 11 KB CSS;
the solo home itself loads none of the 3D chunks until the idle prefetch or "Open the stall".

## 7. WebGL unavailable

Chrome launched with `--disable-gpu --disable-3d-apis` (`07-webgl-fallback-flags-1280`) and, separately, `getContext('webgl*')` overridden to return null (`07-webgl-fallback-override-1280`).
Both show the status card "3D / NOT SUPPORTED HERE / This device cannot draw the 3D stall" with **Check again** and **Back to games**; "Back to games" lands on `/games/tiffin-centre`.
The tutorial path shows the same card (`07-webgl-tutorial-*-1280`).
Before my fix the practice shift kept running behind that card (see "Fixed by me" 1).

## 8. Co-op (fake socket, real room states)

`08-coop-hud-1280` (and `-390`, `-844x390`): connection pill "Connected", the teammate chip "Cook 2 / Empty hands", the four emote buttons, the Leave button, the shared stock board and the dock.
`08-coop-emote-*`: the other player's `thumbs` emote at tick 21 arrived in the state (`emotes: [{by: Cook 2, e: thumbs}]`); the local emote dispatch went out as
`{"t":"action","action":{"type":"emote","e":"fire","playerId":...}}` over the (fake) socket. `08-coop-disconnected-*`: after the link dropped the "Connection lost / Reconnect / Leave table"
screen; the socket backed off, reopened, and `08-coop-reconnected-*` shows the table back with a fresh snapshot (no status screen). `08-coop-leave-*`: "Leave the stall? The shift keeps running for the others and your seat ends."
`08-coop-results-*`: the shift ended with the server standings (BREAKFAST RUSH, takings, cost, profit, star targets on profit).

---

## Bugs

### Fixed by me (copied to the main tree)

1. **The local shift clock ran while the stall was still loading or when WebGL was missing** (`TiffinGameImpl.jsx`, successor of `TiffinGame.jsx`). A local session starts ticking when it is created; on a
   slow first load the first customers lost patience before the first frame (old tip: tick 9 to 15 at the moment the HUD appeared), and on a device without WebGL the shift played on behind the error card, took
   hearts, and left a "Resume your shift 14 %" card for a shift nobody saw. Fix: the clock is held (paused, no Chai break card) until two frames are on screen, and again if WebGL is lost or missing; the
   no-WebGL "Back to games" now quits, clears the save and goes to `/games/tiffin-centre`. Verified: tick 0 at the first sample, no save and no Resume card after leaving the error card.
2. **Co-op Leave button covered the first dock slot on phones** (`tiffin.css`). In portrait it now sits in the free pause slot at the top right (`08-coop-hud-390`). Landscape is still affected (H3, HUD side).
3. `TiffinGame.jsx` itself needed no change (it is now only the lazy shell). The "blank black screen while the scene builds" I also hit on the earlier commit is already fixed upstream by the loading screen and progress bar.

### For others (nothing here was edited)

| # | Sev | File | Symptom and evidence | Suggested fix |
|---|---|---|---|---|
| H1 | **High** | `ui/hud/opsLogic.js` (`opsOn`, `gasOnLevel`, `heatOnLevel`, `hasOps`, lines 24 to 30, 327, 354) and `ui/hud/HudLayer.jsx` (hotkeys guarded by `opsOn` at 274, 539, 546) | The tutorial chapters stock, heat, gas, board, special, weather, profit teach the prep counter, tend, Swap cylinder and menu board, but every HUD ops control is hidden when `cfg.tutorial` is true. DOM probe at those steps: `.tc-hud-gas` 0, stock bars 0, tend 0, events 0, no "Prep counter" in the dock; `02-tut-10-gas-low` shows Chotu saying "gas kam hai" with no gauge; the P, T, B hotkeys are inert. Only a scripted `dispatch` can pass those chapters. `ops.render.test.js` even asserts "the tutorial has no stall status", so it is a contract mismatch between the HUD tests and the extended tutorial. | Drive visibility from the flags the tutorial switches on (`cfg.stock`, `cfg.gas`, `cfg.heat`, `events`), not from `cfg.tutorial`; update those two tests. |
| H2 | Medium | `ui/menus/PauseMenu.jsx` | "Leave the stall? This shift will not be saved." is false: quitting saves it and the home screen offers Resume (`04-quit-confirm-1280`, `04-home-resume-after-quit-1280`). | Say "Your shift is saved. You can pick it up from the home screen." |
| H3 | Medium | `ui/hud` (TopBar, emote group) | Co-op landscape 844x390: the emote buttons sit on top of the gas gauge and Swap button, and the Leave button covers the first held-dish slot (`08-coop-emote-844x390`). Online has no pause button, so the pause slot could host Leave. | Add an `onLeave` prop to `Hud`/`TopBar` that fills the pause slot when `session.mode === 'online'`; move the emote group clear of the stock board. |
| H4 | Medium, unverified on the tip | `shared/tiffin-centre/tutorial.js` (`cook2`, `serve2`) | Possible soft-lock. Under slow frames (1280x800 on SwiftShader, three runs on the older commit) the tutorial sat in `cook2` for 800 to 1400 ticks: only customer B was alive, customer C (the idly) was gone, and `done = needCovered(B) && needCovered(C)` needs both customer objects, with no `recover` on that step. Not reproduced with the dispatch bot or at a small viewport, and not rechecked on the 128-step tutorial. | Give `cook2` and `serve2` the same `recover: pairLost` as `carry`, and treat a customer who is gone as covered. |
| H5 | Low | `ui/hud/StationsDock.jsx`, `hud.css` | At L4 and L12 on 1280 the dock is wider than the screen: the first station is cut off at the left edge or the last at the right (`03-L12-hour-13-1280`, `03-L04-hour-22-1280`), so some slots are only partly tappable. | Scroll the dock to the active station with visible edge fades, or shrink slots when more than four stations. |
| H6 | Low | `ui/hud/WorldBubbles.jsx` | A customer's token bubble is drawn on top of the stock board (`03-L04-hour-17_7-1280`, `03-L12-hour-13-1280`, `03-L04-hour-22-1280`); at the left it can slide under the chit rail. | Clamp bubbles to the free scene rectangle (outside the rail and the right boards). |
| H7 | Low | `ui/hud/StallStatus.jsx`, `hud.css` | The Board chip reads "BOARI": the last letter is clipped (`03-L12-hour-6_3-1280`). | Allow the label to size to its text or drop the icon at narrow widths. |
| H8 | Low | `ui/menus/menuModels.js` (`statusCopy` icon for `disconnected`) | The "Connection lost" card shows a tiny 10 px squiggle in a 64 px tile (`08-coop-disconnected-390`). | Use a proper glyph or size the text icon up. |
| H9 | Low | `ui/menus/SoloHome.jsx` | "About three minutes" for a tutorial that is 6 to 8 game minutes. | Change the copy. |
| H10 | Low | `ui/hud` (landscape phones) | 844x390 is crowded: the chit rail and the right-hand boards leave a thin strip of scene (`09-hud-844x390`). Usable, but tight. | Collapse the boards in landscape. |

## Not verified

* Any real GPU: all frame numbers are software GL. Safari, iOS and Firefox were not run.
* Sound: headless Chrome never lets the AudioContext start, so audio mixing, ambience and the speech synthesis voices were not heard (the pause card correctly says "No Telugu voice on this device").
* Real touch gestures (drag to look, tap on stations, double-tap a chit): only the touch viewport and the dispatch path were exercised.
* A real room: no WebSocket server, Durable Object or database was involved; only the client side with real engine states was proven.
* A keyboard-only run of the current 128-step tutorial (blocked by H1), and a human winning L4 and L12.
* The scene work in `ec8e1bb` (prep counter, gas, weather, inspector models) was checked only through the lighting-hour shots, the tutorial run and no console errors, not the individual effects (rain, power cut visuals) up close.
* Longer-than-three-minute memory behaviour.
