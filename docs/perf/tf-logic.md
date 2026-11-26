# tf-logic: every Tiffin Centre mechanic, implemented, correct and playable end to end

Branch `perf/tf-logic` (worktree `A:\Coding\Projects\GameHub-wt\tf-logic`). Owner area: `shared/tiffin-centre/**`, `worker/games/tiffin-centre.js` and its tests, the session logic contracts.
Everything below was measured in this session on the production build (`vite build`, `vite preview` on :5790, headless Chrome on the real GPU, `?tcdebug=1`), the pure engine and a real
`GameRoom` in the vitest harness. Numbers are quoted as measured; what could not be done is in "Remaining gaps".

## Summary

| | |
|---|---|
| Product defects found and fixed | **5** (co-op win credit, cooks flagged idle, stall ticking with nobody there, a leaving seat's dishes stranded, a difficulty curve with a cliff and unclearable late shifts) |
| Test-harness defects found and fixed | 3 (an adapter fuzz that crashed when the shift ended before the tick, an events invariant that was too tight for the festival day, UI fixtures that hard-coded star targets) |
| Areas audited with **no** defect found | tutorial (128 steps), station timing, orders / patience / tips / paying / unpaid / game over, stock / prep / gas / heat / board, results and persistence, skip, the room server against hostile clients, dialogue (1509 lines, 11.7k spoken utterances) |
| Tests (`npx vitest run src/games/tiffin-centre shared/tiffin-centre worker`) | before: 117 files, 2610 tests. after: see "Tests" |
| Commits | one per defect or feature, failing test first, see `git log perf/tf-logic` |

## Audit table

| # | Mechanic | Verified how | Result | Fix |
|---|---|---|---|---|
| 1 | Tutorial: all 128 steps reachable and completable | Real browser, production build, a scripted player (the unit tests' tutorial bot, run in node, reading the live `session.state` out of the page and dispatching its actions into it) at 4x clock: `tutorial.finished`, 599 game ticks, **0 refused actions**, local flag `jalebi.tutorial.v1.tiffin-centre = 1`, the autosave slot cleared, one `POST /api/games/tiffin-centre/tutorial/complete` attempted (401 offline: `.pending` stays up, as designed). 125 of 128 step ids were seen by the 120 ms poll; the other three (`dosa-watch`, `inspect-clean`, `outro`) pass within one tick or finish the lesson before the poll, and are visited in the node driver test `a bot player completes the whole tutorial ... visiting every chapter and every step`. Unit: full play, 40-seed chaos (a player who keeps making mistakes), per-step stuck detectors, recover / rescue paths | pass | none needed |
| 2 | Tutorial skip | Real browser: `tutorial.skip()` | `skipped` true, `finished` false, no tutorial flag (co-op stays locked), save cleared, status `paused` | none |
| 3 | Tutorial resume after reload | Real browser (see "Resume" below) and `localSession.autosave.test.js` (journal replay lands on the exact state) | see below | none |
| 4 | Tawa, steamer, kadai, chai timing (cook / ready / burn) | Real browser on level 12: one dish on each station through the real `dispatch`, ready and burnt ticks read from `session.state` every 100 ms | dosa cook 5 burn 7 (ready tick 5, burnt tick 12), idly 7 / 14 (burnt at its `burnAt`), poori 6 / 6 (burnt at its `burnAt`), irani chai 4 / 10 (ready seen the next tick). Exactly the catalogue. A 3 s main-thread hitch (first shader compile of a level-12 customer) made the local runner catch up 3 ticks inside one frame (`MAX_CATCHUP_TICKS` 5), so "ready" was first *seen* at tick 10 for a dish that became ready at 7: the engine was right, the player lost 3 s (a rendering issue, see "For other streams") | none |
| 5 | Dishes, recipes, ingredients | 13 dishes x `recipes.test.js`; the bot cooks every dish on level 12 in the balance runs; stock never negative / NaN in the 200-seed fuzz | pass | none |
| 6 | Stock, prep counter, gas, heat / tending, sold-out board, market | Engine tests, `fuzz.test.js` (200 seeds locally, 60 in CI, every level, 1-4 players, hostile parameters), balance runs, real browser (level 12 HUD) | pass. The fuzz found one wrong invariant (events <= 4: the festival day legitimately runs 5 at once) | test only |
| 7 | Customers: arrival, patience, tipping, paying, leaving unpaid (heart loss), game over | Engine tests, fuzz, 300+ simulated shifts per table below, real browser practice shift: level 1, 14 plates, combo x9, 0 lost, 0 unpaid, 2 stars | pass | none |
| 8 | The 12 shifts: unlock order, difficulty curve, targets, stars | Skill-profile simulation, 12 seeds solo, 6 duo, 4 quad, three skill levels | **defect**: the load jumped at level 4 and was beyond what the bot can serve at levels 9-12; the practice ladder stopped at level 8, a casual player lost every heart on level 4 | D5 below |
| 9 | Results screen and persistence | Real browser: practice level 1 to the end | `GREAT SHIFT`, 2 stars, takings / tips / cost / waste / fines / profit, the star ruler, "66 more profit for star 3", `jalebi.progress.v1.tiffin-centre` = `{1: {stars 2, earned 736}}`, level 2 unlocked, shift save cleared | none |
| 10 | Settings | `SETTINGS_SPEC` (level 1-12, pace relaxed / normal / rush) validated in the adapter (strict) and the lobby; `settings.test.js` | pass (UI preferences: HUD owner) | none |
| 11 | Co-op rooms, 2-4 players: roles, shared stall, 1 s server tick, reconnection | `worker/tiffin-centre.room.test.js`: a REAL `GameRoom` with the REAL adapter, fake sockets / storage / clock: lobby, start, one tick a second, every seat acts through the sanitizer and the rate limit, shared stall, reconnect, second tab, restart in the middle (coalesced writes), idle table pays nothing | pass, plus 3 defects: D1-D4 | D1-D4 |
| 12 | Co-op edge cases: disconnect / reconnect, host leaving, late join, ready-up, duplicate actions, desync | The same harness (+8 tests): all connections dropped, one dropped, leave while holding dishes, rejoin after leaving, replayed `collect` / `cook`, seq gaps and duplicates in the client core, host leaving in the lobby (`fixHost`) | A dropped table kept ticking in the dark (D3). A leaver's dishes were stranded (D4). Late join after the start is refused by design ("This game has already started."); `start` does not wait for ready flags (host decides) | D3, D4 |
| 13 | Server never trusts the client | 13 tests: oversize (> 4096 chars), binary, non-JSON, deep nesting, spoofed `playerId` / name / avatar, `tick` / `spawn` / `tutorial-flags` / `leave` from a client, replay, out-of-order, lobby and finished phases, non-host settings / start, flood (40 / 5 s) | no defect: every case refused, state and `seq` untouched | none |
| 14 | Telugu / Hindi / Dakhni lines | Script audit of 1509 lines plus a bot-played shift per language mode (11,698 utterances, 5 modes x 12 levels x 2 seeds): missing text / rom / en, wrong script, placeholder parity text / rom / en, `{dish}` in no-dish situations, kinds and tags, mood against situation, duplicates, hi / dk identical lines, unresolved `{..}` / `undefined` in any spoken line | no defect. The three voices have exactly the same number of lines in all 59 situations; 21 of 503 Dakhni lines (4%) are word for word the Hindi ones (idioms both use); no moods that contradict their situation (the sarcastic "I salute this service from a distance" is an angry line with a polite surface, on purpose). **Native-speaker review is still pending and cannot be done here** | tests pin it |
| 15 | Impossible states | 200-seed fuzz invariants after every action (money, stock, gas, heat, hands, spots, outcomes, JSON round trip, state size < 8 KB), `OVERTIME_CAP`, the `customer-turned-away` path, polite sold-out leave | none found: no negative money / stock, no NaN timer, no order that cannot be served (`fitOrder` swaps or drops what the shelf cannot cover), no dish that never finishes (burns), no stuck hands (`discard`, the bin, and now `leave`), no customer stuck in the queue (3-tick retry then turned away) | none |

## Defects found and fixed

| # | Defect | Root cause | Fix | Test |
|---|---|---|---|---|
| D1 | **A cleared co-op shift was a win for the top earner only.** The others got the rank-1 floor (e.g. 40 XP / 60 coins instead of 100 / 200) and no `wins + 1` | `match.js` credited `won = (res.winnerId === row.id)`, one id | `result().winners` = every seat with real work on a cleared shift (scoring.js `winnersOf`), `match.js` credits each, `winnerId` stays the top earner (headline, `matches.winner_id`). Rule in the plan, section 3 | `credit.test.js`, `match.test.js`, adapter `result()` tests |
| D2 | **A dedicated cook was flagged idle and paid nothing** (no XP, no coins, no win, no rating change) | the idle guard counted served + collected + prepped + tended + gasSwaps + bought; cooking did not count | new per-player `cooked` counter, credited to `slot.by` when the dish reaches somebody's hands (a burnt dish never counts: cooking food nobody takes is not a way to be paid), counted as work | `credit.test.js`, adapter idle-guard tests |
| D3 | **A table whose connections all dropped kept ticking for up to 5 minutes**: the team came back to a closed centre, and the Durable Object woke once a second (one alarm + one storage write) for nobody | `GameRoom.plan()` always scheduled the adapter's tick | generic `adapter.pauseWhenEmpty` seam: no tick timer while no seat has a live socket, the first player back restarts the timers (a full second to spare), an empty room is still abandoned after 5 minutes, one player alone keeps the clock running. Cost of a shift documented in the plan (below) | `tiffin-centre.room.test.js` x3 |
| D4 | **A seat that left a running shift kept its dishes in hands that would never act again** | no `resignAction` | adapter `resignAction` -> engine `leave` (server only, not in the client allow-list): held dishes go to the most urgent waiting customer who needs them, else the bin; the seat stays in the result, flagged `left` until it acts again | `credit.test.js`, room tests, adapter tests |
| D5 | **Difficulty curve** (below) | arrival gaps and star targets never measured against anything slower than the bot | retuned gaps, level 4 two-dish orders, star targets re-derived | `balance.test.js` |

### D5: the score curve (measured)

Reference players: **expert** = the bot of `bot.js` (a fast human: one action per tick, no thinking), **competent** = 1.45x slower per action and 8% of free turns lost, **casual** = 1.8x and 15%, **beginner** = 2.8x, 30%, and never tends the pans or touches the board. Normal pace. `starTargets` are profit (cash - costs).

Dishes asked for per tick of the shift (solo, the whole schedule plus the delivery boy, 30 seeds):

| level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before | .108 | .110 | .098 | **.197** | .156 | .144 | .137 | .139 | **.273** | **.230** | **.271** | **.268** |
| after | .094 | .099 | .104 | .109 | .111 | .114 | .108 | .123 | .122 | .123 | .125 | .132 |

The bot's own limit is about .2: before, levels 9-12 asked for more than it can serve. Measured before (6 seeds): the bot closed the centre on 6/6 seeds of level 9, 5/6 of level 10, 6/6 of 11 and 12; a casual player lost every heart on levels 4-12 on every seed (also at relaxed pace). Because a star on level n opens n + 1, the solo ladder stopped at level 8.

Stars after the change, solo, 12 seeds per cell (digits = stars per seed, `c` = centres closed, `profit` = mean). Targets are 1 / 2 / 3 stars:

| lvl | targets | expert | competent | casual | beginner |
|---|---|---|---|---|---|
| 1 | 260/440/610 | 223323333223 (612) | 223323333223 (605) | 223123332223 (571) | 101000121121 (311) |
| 2 | 300/520/740 | 223323231212 (690) | 223323231212 (666) | 212222231222 (616) | 000000110101 (250), c8 |
| 3 | 330/570/820 | 232333322223 (808) | 221332322213 (722) | 211122221102 (567) | 0 on all, c12 |
| 4 | 380/650/990 | 223222222322 (931) | 022222222211 (696) | 011000012001 (365), c4 | 0, c12 |
| 5 | 390/670/1020 | 222333222232 (962) | 211220222132 (718), c1 | 000000011102 (327), c7 | 0, c12 |
| 6 | 400/690/1040 | 322233222333 (986) | 112111021112 (591), c1 | 100010000100 (253), c9 | 0, c12 |
| 7 | 250/420/640 | 232223223222 (599) | 221113222112 (492) | 120102211011 (350), c1 | 0, c12 |
| 8 | 300/520/790 | 222232222232 (743) | 102101122021 (436), c2 | 001000001000 (172), c10 | 0, c12 |
| 9 | 430/730/1200 | 232222222322 (1042) | 111101112001 (483), c3 | 000001000000 (246), c11 | 0, c12 |
| 10 | 500/860/1410 | 222222222232 (1229) | 200012222101 (686), c3 | 000001000000 (361), c11 | 0, c12 |
| 11 | 510/860/1420 | 223222222222 (1233) | 210102211010 (577), c4 | 000001000000 (228), c11 | 0, c12 |
| 12 | 700/1300/2200 | 222232212122 (1629) | 0 on all (325), c12 | 0, c12 | 0, c12 |

Read it like this: every shift is clearable solo by a fast player on every seed, and three stars stay rare on 9-12 (a team thing). A competent human gets through 1-7 and about half of 8-11; a casual one gets through 1-3 and part of 4; a beginner gets a star on levels 1-2. The festival (12) wants a team.

Teams (6 seeds duo, 4 seeds quad; targets and arrivals both scale by `coopScale`: x1.65 for two, x2.95 for four):

| lvl | 2 players expert | 2 competent | 2 casual | 4 expert | 4 competent | 4 casual |
|---|---|---|---|---|---|---|
| 1-3 | 2-3 stars | 2-3 | 2-3 | 2-3 | 2-3 | 2-3 |
| 4-8 | 2-3 | 2-3 | 0-3 (c2 on 5, 6, 8) | 2-3 | 2-3 | 2-3 |
| 9-11 | 2-3 | 1-2 | 0-2 (c1-3) | 2-3 | 2 | 2 |
| 12 | 2-3 | 0-2 (c4) | 0 (c6) | 2-3 | 2 | 2 |

Full rows are in `shared/tiffin-centre/balance.test.js`'s comment and the commit message of `fix(tiffin-centre): difficulty curve with no cliff`. The numbers are from a scripted skill model, not from people: the real curve has to be confirmed with players (a field `?pace=relaxed` is still the escape hatch for a casual solo player).

### D3: the Durable Object tick cost

One shift is 150 to 300 ticks (`shiftTicks`) plus the stragglers; every tick is one alarm invocation and one `setAlarm` write, plus a coalesced room-record write every 5 s (`persistEveryMs`, 20% of the old writes) and one WebSocket send per seat (sends are not billed). So **a shift costs about 180 to 360 request / write units**; the free plan's 100,000 a day pays for roughly 270 to 550 shifts a day. The earlier "23 room-hours a day" counted rooms that tick for ever; they cannot: a room ends with its shift, and since D3 a room with nobody in it stops ticking at once instead of for five more minutes (about 300 wasted units per deserted shift). A cheaper per-tick scheme (lazy catch-up, ticks every 2 s) was rejected: the clients interpolate bars with `frac = (now - tickAt) / TICK_MS`, so a two-tick step would make every progress bar jump.

## The rules that changed (plan, sections 3 and 4)

- Co-op win credit: `winners` = every seat with `served + collected + cooked + prepped + tended + gasSwaps + bought > 0` on a cleared shift with at least one paid customer; the headline `winnerId` is still the top earner.
- `cooked`: counted when a dish reaches somebody's hands, credited to the player who started it.
- An empty stall is paused; a seat that leaves releases its dishes.
- Difficulty curve and the star targets (offered load .094 ... .132, level 4 without three-dish orders).

## Tests

| | files | tests |
|---|---|---|
| before (baseline on `ff7de38`) | 117 | 2610 |
| after | see final line of this section | |

New: `shared/tiffin-centre/credit.test.js` (12), `balance.test.js` (9), `dialogue/consistency.test.js` (12), 8 room-server tests (leave, pause, resume, abuse x5), an adapter registry / resign test, a `match.test.js` multi-winner test. Changed: tests that hard-coded the old star targets now derive from them (HUD and results fixtures), one statistical test replaces a single-seed one (cricket bursts), the fuzz bound for concurrent events.

## Proof screenshots (`docs/perf/tf-logic/`, JPEG, production build, 1280x800, real GPU)

| file | what it shows |
|---|---|
| `tutorial-02-prep-counter.jpg` | tutorial chapter "Stock and the prep counter" (step 3 of 13): the glowing ring on the back counter, stock bars with a sour batter warning, the dock with the Prep group |
| `tutorial-03-gas.jpg` | the gas chapter: LPG gauge and the Swap button |
| `tutorial-04-rush.jpg` | the final timed rush (Rush 1/2): three tokens with patience rings, the chit rail, availability strip, Hindi speech bubble and subtitle |
| `tutorial-05-complete.jpg` | step 128 of 128, "Shabash anna! ... CO-OP is unlocked", all 16 chapter bars green |
| `practice-01-home.jpg` | the solo home after the tutorial: "Open a table with friends", pace selector, the shift cards (level 1 open, the rest locked) |
| `practice-03-results.jpg` | the end of practice level 1 in the real browser: 2 stars, galla (takings, tips, cost, waste, fines, profit), the star ruler, the chit |
| `mechanics-01-festival-stations.jpg` | level 12 with a dish on each station: "Idly (2 pc) burnt!", the stock status panel, the dock with Wipe / Top up / Skim and the prep counter |

## Remaining known gaps

- **No native-speaker review** of the Telugu / Hindi / Dakhni lines (the files say so); the machine checks above cannot judge idiom.
- **The difficulty curve is modelled, not played by people.** The skill profiles are a stand-in; if real players find shift 4 or 5 too hard or too easy, `LEVELS[n].gap` and `.stars` in `catalog.js` are the only knobs, and `balance.test.js` shows what they have to keep.
- **A real WebSocket / Durable Object / Neon was not involved**: co-op was proven with the real `GameRoom` and adapter in the vitest harness (fake sockets, storage, clock). The browser was not pointed at a live room in this session.
- **The 3D scene still shows a seat that left** (its avatar stands at the home spot with empty hands); the `player-left` event and `players[id].left` are there for the scene / HUD owners.
- `DAILY_REWARDED_MATCHES` (12 a day) now pays a winner's XP / coins to every working seat of a cleared shift; if that is too generous the cap is the knob.
- Browser coverage is Chromium on Windows only (no Safari, Firefox, phone, sound, real touch).
- The resume run and the 4x clock: the whole tutorial was driven at 4x game speed through `session.dispatch` (the HUD's walk-then-act runner was not part of it; the keyboard-only and touch runs of `TIFFIN_CENTRE_PROOF.md` cover that).

## For other streams (found while testing, not touched)

- **tf-gpu / tf-cpu**: the first level-12 customer compiles shaders for about 3 s on the main thread (observed: a dish became ready at tick 7 and the page only reported tick 10, three ticks of catch-up in one frame). The shader warm-up of the customer kinds that appear late in a shift is not covered by the loader's parked actors. ANGLE / D3D also logs `X3595 gradient instruction used in a loop with varying iteration` and `X4000 potentially uninitialized variable (f_skinAlbedo / f_skinH)` from the skin shader on every run (warnings, harmless here).
- **tf-ui**: results for a co-op table could show a "team win" mark for every `winners` entry (the screen marks only the top earner as MVP); the HUD could grey the avatar of a `players[id].left` seat.

## Files changed outside my area

- `worker/match.js` (3 lines): `won` also honours `result.winners` (generic, optional).
- `worker/GameRoom.js` (about 25 lines): `isEmpty()`, the `pauseWhenEmpty` check in `plan()`, the re-anchor on the first reconnect (generic, opt-in per adapter).
- `src/games/tiffin-centre/session/roomCore.js` (1 line): `leave` joins the actions a client never sends.
- `src/games/tiffin-centre/ui/hud/ops.render.test.js`, `ui/menus/menus.ops.test.js` (tests only): fixtures follow the new star targets.
- `docs/TIFFIN_CENTRE_PLAN.md`: win credit, pause when empty, the leave rule, the difficulty curve.
