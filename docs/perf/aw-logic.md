# aw-logic: every Autowala mechanic audited, fixed and proved

Stream `aw-logic` of the rendering and gameplay overhaul. Branch `perf/aw-logic`, 20 commits on top of `ff7de38` (19 code and test commits plus this report). Scope: `gameplay/**`, the shared pure logic, audio volume plumbing, the solo run API and its tests. Everything below was checked against the real game, not only against the specs.

## Headline
- **43 defects found and fixed** (list below), each at its root with a test next to the pure logic, **plus 2 regressions of my own** that the browser run caught and I fixed in the same branch (see "What the browser run caught").
- `npx vitest run src/games/autowala`: **82 files / 1107 tests before, 90 files / 1200 tests after** (+8 files, +93 tests). `worker/solo.test.js` also passes with the new `run-expired` code. `npx vite build` passes.
- Every mechanic was exercised on a **production build in headless Chrome** (CDP, scripts below): a complete fare driven 783 m on the real physics along the route guide, price talk (meter, fixed, bargain), missed fares, fuel (low, critical, empty, Mama, pump), damage and repair, rent and the Hisaab across midnight, the tutorial and all ten missions (daily included), speed camera, road rage, storm, the workshop (preview, nine purchase cases, persistence across a reload), corrupt storage, the four volume buses, the run API with a stubbed Worker, and leaving / re-entering the game.
- Not done: a JS-heap growth when re-entering the game (about 12 MB per idle re-entry, about 36 MB per re-entry after playing, measured after a forced GC); the cause is not isolated (see "Remaining gaps").

## How it was verified (four layers)
1. **Five read-only audits** (quests; career, fuel, rules, weather; workshop, profile, run API; fares, customers, route guide; positions). Each traced the code paths and several rebuilt the real seed-1 city and the real colliders in Node (`generateCity(1)`, `createColliders`, `addBoundaries`, the real `sim/vehicle.js`). Every finding below was re-read in the code before I fixed it; findings I could not confirm were dropped or are listed as suspected.
2. **Unit tests next to the pure logic**, each new test checked to fail without its fix (`git stash` of the fix, run, restore).
3. **Production-build browser runs** (`vite build` into `%TEMP%\aw-logic-dist`, `vite preview` on :5750, Chrome on :9790+, software GL, `window.__autowala` hooks: `ctx`, `emit`, `debug.teleport/step/drive/hour/weather`). Motion was real physics for the fare (an autopilot following `ctx.route`); other scenarios teleport to stand in for driving and say so.
4. **A stubbed Worker** in the page (`fetch` override) for the run API through the real summary screen.

The browser scripts live in the scratchpad of the session (`.../scratchpad/aw-logic/*.mjs`: `fare`, `econ`, `day`, `quests`, `metro3`, `rules`, `shop`, `vol`, `runapi`, `leave`, `leave2`, `heap*`); they are not committed (they are session tooling, not tests). The world-audit scripts are in `.../scratchpad/world-audit/`.

## Audit table

| Mechanic | Verified how | Result | Fix |
|---|---|---|---|
| Fare lifecycle: hail, select, route, pickup (E prompt), price talk, ride, drop-off, review, tip, payment | Browser: autopilot over real physics, 783 m; Node: 145-ride fuzz by the audit | Works end to end: Rs 213 + Rs 32 tip, 5 stars, meter 51 -> 211 on the way, ETA 80 s -> 2 s, wallet, session, ledger and profile agree. **Defect**: every frame of a full brake hurt the passenger (`brake` mood hit), so most drop-offs lost their tip | `5f69448` |
| Price terms: meter, fixed, bargain, decline | Browser | Fixed Rs 140 paid Rs 140 + Rs 17 tip; bargain high -> counter -> meter; unanswered question falls back to the meter | none needed |
| Customer kinds, patience, missed fares, board refill | Browser (140 s in view) and Node (2000 customers, 4000 destinations) | 6 customers walked off, the board refilled to 24; no spot or destination in a solid or off the road. **Defects**: 90 valid spots inside the lake's keep-out ring; customers floated 20 cm in park blocks | `51ba84b`, `2b54fdb` |
| Shared rides, urgent rides, peak and night modifiers | Node harness reproduction, unit tests | **Defects**: a third passenger got an invisible seat; rushers to a station never got the train reason; off-peak bands showed a surcharge chip; the urgent bonus was shown twice | `2b54fdb` |
| Route guide, minimap, ETA | Browser and the audit's Dijkstra reference (400 pairs) | Route recomputes on target change, trims monotonically, clears with no target, ETA = length / 11 | none needed |
| Fuel: warnings (15%, 5%, empty), burn, pump billing, Mama's rescue, running dry | Browser | Low / critical / empty toasts; tank empty = the auto does not move; pump: 3 -> 12 L for Rs 198 (Rs 22 / L); credit litre away from a pump. **Defects**: broke with an empty tank at a pump = soft-lock; the first fix starved the workshop door of the E key (caught by the browser run) | `448f674`, `8ffb8ce` |
| Damage, rattle, repair at the garage | Browser | Damage 0.48 -> top speed x0.87, stays x0.87 (does not compound); repair Rs 470, `expense` repair emitted, back to x1. **Defect**: the damage factor compounded every frame (damage 0.3 gave x0.51 instead of x0.92) | `e0851dd` |
| Rent, the day cycle, the Hisaab, the ledger | Browser | Pause for 10 minutes: hour 17.4836 before and after; midnight opens the Hisaab (rent Rs 165 for 6.6 h, net Rs 46 = 271 - 225), wallet -165; broke at midnight: debt Rs 400, wallet stays 0. **Defects**: day, rain, metro and rent ran behind every menu; the Hisaab showed a stale repair bill and ladder | `104933b`, `f397ead` |
| Career ladder and ranks | Browser, unit tests | Savings progress follows net profit; EMI and repossession covered by the existing career tests | none needed |
| Quests: tutorial, daily, 10 missions, all step types | Browser solver (teleports; `land` events stand in for the stunt jumps) | Tutorial +Rs 150 once; daily + biryani, chai, baraat, airport, tourist, race, stunts, cows, kites, hospital all complete and pay (reward + time / meter / clean-drive bonuses); abandon and timeout end cleanly; nothing left stuck; the quest clock stands still behind the pause menu. **Defects**: the tutorial replay paid Rs 150 + 25 rep every time (a farm); the board re-rolled under the player; a NaN position completed a ring; quests were never reported to the run API | `9e6dc46`, `663cdc0` |
| Metro Rush (train race) | Browser with the world loop emulated | Accepted from the open board, beaten (+Rs 528), trains frozen behind the pause menu. **Defect (mine, found here)**: with a frozen world clock the train speed read 0 and the mission was never offered | `4b8d75a` |
| Speed cameras, challans, wanted | Browser | 68 km/h in a 60 zone = Rs 120 (`rule:violation`, `rule:fined`, `expense challan`); the same camera at 8 m/s = no fine | none needed |
| Signals, checkpoints, school zones | Node (sites on drivable roads: 13 cameras, 5 school zones, 4 checkpoints, 36 signals, 0 in solids), existing `rules.sim.test.js` | Valid; not re-driven in the browser | none needed |
| Road rage, chase, escape, caught | Browser | Ram a car: 3-4 chasers, `rage:start`; held still: `rage:caught`, fine capped by the wallet (Rs 120 -> 0, never negative) | none needed |
| Weather and events | Browser, Node (`eventsForDay`) | Storm: grip 0.68, visibility 0.5, wet roads, clears again; day 1 runs the match (17-22.5 h) and a baraat, kites on days 2 / 4 | schedule memoised (no per-frame rebuild) |
| Workshop: preview, buy, affordability, owned, loadout, persistence | Browser | E at the garage opens it; preview changes nothing; paint Rs 260 then free to re-apply; engine 1 (Rs 600), skip-level refused, engine 2 (Rs 1,200): top speed 86 -> 97 km/h on the live physics object; garland, plate text, funds refusal; all of it back after a reload. **Defects**: a double click bought twice; the plate field cut the stock plate; text rows quoted the wrong price | `b46ba53` |
| Profile load / save | Browser: 3 corrupt stores; unit tests | `{oops`, wrong types, huge numbers all boot with sane values (wallet, upgrades clamped to the max, quality ignored). **Defects**: a null wallet became Rs 0; an infinite rating; hostile `quality`; the `career` block dropped; blocked storage crashed the boot; two tabs overwrote each other; `reset()` broke `state.upgrades` aliasing | `0f82657` |
| Audio volumes: master, effects, voices, music, mute | Browser (real click, so the audio context runs) | `fx 0.3, voice 0.6, music 0.9, master 0.4` all live on the buses. **Defects**: traffic sound, menu clicks and the browser-speech fallback ignored the sliders; a context started late ignored the saved master; the `muted` flag of the event was ignored | `5afd64a`, `b3e00bb` |
| Pause, resume | Browser | Menus freeze the day, the weather schedule, the metro, the quest clock, CNG idle burn | `104933b` |
| Leave and re-enter x3 | Browser | Fresh world each time, wallet kept, no console errors, no extra canvas or DOM nodes | open: heap growth (below) |
| Run API: start, retry, finish, keep driving | Browser with a stubbed Worker; unit and worker tests | `/start` 503 retried 4.3 s later; `/finish` sent token `tok2` with `seconds: 36` (the token's age, not the sitting's 40); KEEP DRIVING during the save started a new run. **Defects**: failed start never retried; token held during a save; expired run said "Sign in"; guests were told they are on the leaderboard | `6701909` |
| Positions: spawns, destinations, quest waypoints, map edge, wedging | Node scripts over the real city and colliders (31,699 spots, 2,536 ram-and-reverse runs, 10,000 escape trials) | All placements outside solids and reachable; no wedge found. **Defect**: 64 trees, palms and lamps stood inside carriageways | `a058167` |

## Defects fixed (43, plus 2 own regressions)
Commit ids in brackets.
1. Damage slowed the auto far more than intended: the speed factor compounded every frame [`e0851dd`].
2. Broke with an empty tank at a CNG pump: Mama's free litre never came, the player was stuck [`448f674`].
3. "Best fare" counted tips and quest bonuses [`be08300`].
4. "Workshop spend" counted fuel, rent and fines [`be08300`].
5-11. Profile: a null wallet became Rs 0; an infinite rating sum; hostile `settings.quality` forced "player chose a quality"; the `career` block was dropped on load; blocked storage crashed the boot; a stale tab overwrote the other tab's progress; `reset()` broke `state.upgrades` aliasing [`0f82657`].
12-13. A hard stop hurt the passenger once per frame of braking; closing a menu at speed read as a crash stop [`5f69448`].
14-16. The day, rain, metro and rent kept running behind every menu; idling behind a menu burned CNG; the start tank ignored the tank upgrade [`104933b`].
17-18. The open Hisaab showed a stale repair bill and a stale ladder [`f397ead`].
19-21. Quests: the tutorial replay was a money farm; the job board re-rolled under the player; a NaN position completed a `reach` ring [`9e6dc46`] (the same commit adds a test that every plan uses only step types the engine can finish).
22-25. Run API: a failed `/start` was never retried (and the run could claim more seconds than the token had lived); a save in flight lost the next shift; an expired run read "Sign in"; guests were told they are on the leaderboard [`6701909`].
26. Completed missions were never reported (`quests: 0`) [`663cdc0`].
27-29. Workshop: a double click bought twice (or paid and switched a toggle off); the plate input cut the 11-character stock plate; text rows quoted the wrong price [`b46ba53`].
30-34. Volumes: traffic horns and thuds, menu clicks and the browser-speech fallback bypassed their sliders; a late audio context ignored the saved master; the `muted` flag of `audio:volume` was ignored [`5afd64a`, `b3e00bb`].
35. Customers could stand inside the lake's keep-out ring [`51ba84b`].
36-41. Fares: a third share passenger got an invisible seat; rushers to a metro station never got the train reason; off-peak bands showed a surcharge chip; the urgent bonus was shown twice in the toast; customers floated 20 cm in parks; "Hold E to refuel" said hold while a tap toggles [`2b54fdb`].
42. Trees, palms and lamps stood in the middle of roads [`a058167`].
43. The weather schedule (96 slots, an rng, closures) was rebuilt every frame; now memoised per day [`d9124ec`].
Own regressions, fixed in the same branch:
- R1. Metro Rush would never be offered from the job board once the world clock froze behind menus (caused by 14-16, found by the browser run) [`4b8d75a`].
- R2. The first fuel fix read the E tap every frame and starved the workshop door and the job board (caused by 2, found by the browser run) [`8ffb8ce`].

## What the browser run caught that no unit test did
Two regressions of my own: (a) the first fuel fix made `fuel.js` consume the E tap every frame, so "Press E to enter Mama's Garage" did nothing (the unit tests only covered fuel in isolation); fixed by a lazy tap and three tests that assert the tap is left alone. (b) Freezing the world clock behind menus made the quest system's train-speed measurement read 0, so Metro Rush was never offered from the board; fixed by measuring over world time (`createTrainTracker`). Both are in the commit log with the finding.

## Remaining gaps and known limits
- **Heap growth on re-entry** (not fixed, not isolated). After a forced GC, `performance.memory.usedJSHeapSize` grows about 12 MB per leave / re-enter without pressing START (38, 51, 63, 75, 88 MB) and about 36 MB per cycle after playing (66, 100, 136). Live DOM stays constant (297 nodes, 12 SVGs, 2 canvases) and my instance counts of Scene / Mesh / Geometry / Material read 0 after re-entry (that instrument is not trustworthy: it also read 0 for the live game). A snapshot diff only pointed at the live game's own buffers. Owner: aw-cpu (dispose paths of Game.js / world); repro: leave the game through the pause menu "QUIT TO HUB" -> "LEAVE THE GAME", click Play, repeat, `HeapProfiler.collectGarbage` between rounds.
- **No "unstuck" / respawn feature.** The audit could not wedge the auto (2,536 ram-and-reverse runs, 10,000 escape trials), so this is a safety net that does not exist, not a live bug. Suggested: a pure `nearestSafeRoadPoint` behind a "Mama tows you" key.
- **`ctx.fares.abandon()` has no caller**: the player cannot cancel a ride (`fare:abandon`, the rating penalty and `sessionLog.abandoned` are unreachable).
- **`ctx.career.endShift()` is never called**: "clock out" opens the score summary but does not close the career books, so rent and the Hisaab only happen at midnight and the "CLOCKED OUT" Hisaab branch is dead. Calling it would charge at least 25% of the day's rent per clock-out, so it needs a design decision (prorate rent per day first).
- **Session-only state**: day, hour, fatigue, fuel and the open shift are not saved (a load starts on day 1 at 17:24 with a full tank). By design for the "shift" model; it means a reload before the first midnight skips that day's rent.
- Rules: `rule:violation` kind `wrongside` is never emitted (ARCHITECTURE lists wrong-way streets as not done); a checkpoint in the "checking" phase completes even if the player drives away and fines wherever they are; cameras can fine a player on the pavement within `w/2 + 2` (both suspected from the code, not reproduced).
- Per-frame allocation left in aw-cpu's hot paths: `events.js` (`Object.keys(run)` twice), `roadRage.js` (a dispatch literal and `{...state}`), `fuel.js` (`vehicle.params()`), `weather.js` (`W.event` object while an event runs). Only the 96-slot schedule rebuild was fixed here (it was the largest).
- Workshop purchases are not in the Hisaab's expenses (treated as an investment, like the down payment): by design, now documented here.
- UI findings for aw-ui: the Mega Hero subtitle shows through the Hisaab card; `JobBoard.jsx` may accept on the first click in browsers that focus buttons on click (suspected); a quest `seat` step repaints a real fare's passenger (cosmetic).
- The server accepts `earned <= 25 x seconds + 1500` and 20 tokens a minute (documented design); it never cross-checks fares or distance.
- Not re-driven in the browser: signal red-light running, the night police checkpoint, the baraat and kite crowds (covered by `rules.sim.test.js`, `event-logic.test.js` and the Node site checks), fatigue and chai (career tests).

## Files changed outside my area (all small)
- `src/games/autowala/game/Game.js` (aw-cpu): `advanceClock` call, `clock.sim` passed to `world.update`, the idle-burn undo and the upgraded start tank (about 10 lines); new `game/clock.js` + test.
- `src/games/autowala/world/props.js` (aw-gpu): one import and five lines (the road filter); new `world/prop-spots.js` + test.
- `src/games/autowala/sim/traffic-audio.js` (aw-cpu): connects to the effects bus.
- `src/games/autowala/audio/sound.js`, `audio/voice-player.js`, `audio/ctx.js`, `audio/sound-bus.js` (aw-cpu): master level, speech volume, `muted`.
- `src/games/autowala/ui/Hisaab.jsx`, `ui/Workshop.jsx`, `ui/menus/SummaryScreen.jsx`, `ui/menus/PausePanels.jsx`, `ui/menus/PauseMenu.jsx`, `ui/menus/settings.js`, `ui/menus/sitting.js` (aw-ui): a few lines each (live Hisaab data, repeat guard and typing filters, retry button rule and wording, stat labels, master level).
- `worker/routes/solo.js`: the `run-expired` code on a dead run token (in my area, listed for the lead).
- `docs/AUTOWALA_PERFORMANCE.md`: the stale "only master volume is live" line.

## Proof screenshots (`docs/perf/aw-logic/`, 11 JPEGs, headless Chrome, software GL)
The game UI reads the last published snapshot, which the render loop publishes; after a long `debug.step` the HUD can lag the simulation by a few seconds, so some shots were retaken after waiting. What each shows:
- `fare-2-pickup-price-talk.jpg`: just after pickup of "Suresh Bhai" (regular): the "Meter, fixed price or bargain?" question with Rs 265 fixed, the trip card (940 m, 1 min, mood bar, "Turn left in 20 m"), the evening-rush x1.24 chip and the minimap route.
- `fare-4-dropoff-review.jpg`: after the drop-off: "Rs 213 + Rs 32 tip" with five stars, 5.0 rating, wallet Rs 805, "Today Rs 245", the passenger's line "Keep it, babu, have some chai", the tutorial card still on its horn step.
- `fuel-pump-refuelling.jpg`: "Refuelling... 0.5 L, Rs 11" at a CNG pump at night, tank 3.5 L.
- `hisaab-end-of-day.jpg`: the end-of-day accounts: fares Rs 191, tips Rs 80, CNG Rs 60, rent Rs 165, net Rs 46, 3 rides, 6.6 hours, the savings ladder. Behind the card a hero-narrator subtitle shows through (UI finding above).
- `summary-clock-out.jpg`: the clock-out summary: Rs 271 earned, 3 fares, best fare Rs 71, and the "drive a little longer" note (a shift needs 30 s; this one was driven by teleports).
- `quest-job-board.jpg`: the job board at rank "Hero Mama": the daily Tourist Trail x1.5, nine more missions, the detail pane with steps. The wallet in the corner reads a stale value.
- `quest-metro-rush.jpg`: "MISSION COMPLETE Metro Rush": pay +480, clean drive +48, Rs 528, +60 rep (the corner wallet is stale).
- `workshop-open.jpg`: Mama's Garage after the purchases: the auto in Bonalu Red, top speed 97 (engine level 2), the category list. The wallet in the corner reads Rs 600 because the shot was taken right after I overwrote the wallet in memory to test the funds refusal; it is a harness artefact, not a game value.
- `rules-speed-camera.jpg`: after the Rs 120 challan: wallet Rs 1,668, the WANTED badge, 59 km/h under the 60 sign, the cyan camera flash across the road.
- `rules-road-rage.jpg`: "ROAD RAGE 3 on you", WANTED, a "GO" signal chip, speedometer 21 km/h.
- `weather-storm.jpg`: storm: rain streaks, "Storm" badge in the clock, the "roads are slick" toast, wallet Rs 1,042.

## Risks
- `Game.js` and `world/props.js` are edited in other owners' files: expect trivial merge conflicts with aw-cpu and aw-gpu (the hunks are small and described above).
- Freezing the world clock behind menus (`clock.sim`) also freezes the shader time and the metro while a menu is open (like traffic already did). `clock.time` still runs (animations, play time, the run API's seconds).
- Profile merging on write never lowers a counter, owned part or upgrade: if a future feature lets the player lose parts, `mergeProfiles` must learn about it.
- The run client now reports at most the token's age as `seconds`: a sitting whose `/start` succeeded late reports fewer seconds than it lasted.
