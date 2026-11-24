# Tiffin Centre: build plan and contracts

Game id `tiffin-centre`, display name **Tiffin Centre**, publisher Jalebi Games. A real-time, 3D, co-op Hyderabadi tiffin stall.
Read `docs/ADDING_A_GAME.md` and `shared/tiffin-centre/catalog.js` first. **catalog.js is the data contract** (dishes, stations, levels,
layout, timings). Run tests with the **PowerShell** tool: `Set-Location A:\Coding\Projects\GameHub; npx vitest run <path>` (Git Bash fails).
The working tree has many uncommitted changes by the owner: **edit only the files you own; never revert or reformat anything else.**

## 1. Brief

- **Goal:** the player runs a Hyderabadi tiffin centre in 3D, in real time. Customers walk up with orders, lose patience while they wait,
  you cook (dosa types, idly, poori, mysore bonda, vada, mirchi bajji, irani chai ...), serve, and then must **collect the money before
  they walk away; late = they leave without paying**. Levels are shifts at different times of day (morning tiffins, afternoon lunch,
  evening chai and bajji, night tiffins, a full festival day) with changing light, menu, stations and crowd.
- **Modes:** (A) **Tutorial** (level 0): solo, scripted, teaches every rule. Completing it sets `tutorialDone` (server + local mirror) and
  **unlocks** (B) **Co-op table** (2-4 friends, private room via the hub's Create table / invite flow, all running one stall, real time).
  Also (C) **Practice shifts**: solo, any level 1..12 (local, uses the same engine), stars saved in localStorage.
- **Platform:** phone (touch, 390x844 portrait AND landscape) and desktop (mouse + keys). Hub CSP: no CDN, no inline script, no external assets
  (everything procedural: geometry, canvas textures, Web Audio). Fonts Bricolage Grotesque + Noto Sans Telugu (Telugu dish names shown on signs/UI).
- **Item availability (user requirement):** the HUD always shows, per menu dish, how many are ready, cooking, held and still wanted by waiting customers (`availability(state, meId)` in `ui/hud`), derived from state only. Ingredient stock is not part of the game.
- **Out of scope:** voice chat, ingredient stock, free-roaming avatars, player money shops, ranking, achievements.
- **Acceptance:** `npx vitest run shared/tiffin-centre worker src/games/tiffin-centre src/games src/platform` green; `npx vite build` passes;
  tutorial playable start to finish; two browsers can play a private table; no console errors; 60fps-ish on a mid phone (quality auto-downgrade).

## 2. Design direction

**"Chai-stall golden hour"**: a warm, tactile, slightly toy-like low-poly stall (think a diorama / Monument Valley proportions but spicy):
steel counter, striped awning in saffron and teal, hand-painted Telugu + English signboard, brass kadai, steaming idly cookers, a chai samovar.
Light is the signature: **the sky and the whole stall re-light as the shift's hour advances** (dawn rose, morning gold, harsh noon, amber
evening with string-bulb glow, deep-blue night with warm bulbs and neon). UI is chunky and friendly: rounded "order ticket" cards like
a kitchen chit rail, big thumb-sized station buttons, coin ring timers.
- Palette (CSS vars on the root `.tc`, prefix `--tc-`): saffron `#ff8a1f`, turmeric `#ffc83d`, chilli `#e0392b`, curry-leaf `#2f9e5b`,
  teal `#12908e`, cream `#fff4dc`, charcoal `#241a14`, steel `#c9d1d6`, night `#141a33`. Text on dark panels cream; panels `rgba(36,26,20,.82)` with 14-18px radii.
- Type: Bricolage Grotesque Variable for UI, Noto Sans Telugu Variable for Telugu. Numbers tabular.
- Motion: springy (180-260ms ease-out-back) for tickets and coins; steam/oil/coin particles in 3D; everything respects `prefers-reduced-motion`.
- **Signature element:** day-part lighting + the live "patience" language: every customer wears a coin-shaped ring that drains
  (green -> amber -> red, then a shake), and a paying customer holds a glowing rupee note out that visibly counts down. Readable from 3 m away.
- States to design: empty stall, cooking, ready (ping), burnt (smoke), customer waiting/eating/paying/angry/walked-out-unpaid, hands full,
  teammate present/away, connection lost, pause, shift end (stars), failed shift, level locked, tutorial coach marks.

## 2b. Movement and street style (user requirements, binding on every WP)

**Characters move and do the work.** Nobody teleports. `shared/tiffin-centre/movement.js` is the shared kinematics (read it): everyone works on one line
behind the counter; `players[id].at` is `null | stationId | 'spot:N' | 'bin'`; `move {to}` accepts exactly those (engine validates with `validTarget` against
`cfg.stations` / `cfg.spots`). **Walk, then work:** when a player taps a target the HUD's action runner (1) dispatches `move {to: workTarget(action, state)}` at once
so teammates see the walk, (2) waits `walkSeconds(currentX, standX(to))` (the runner tracks the avatar's x with the same `stepWalker`, so scene and runner agree
without extra messages), (3) dispatches the real action (`cook/take/serve/collect/discard`) on arrival, and the avatar plays the WORK animation for `WORK_MS`.
One queued action per player: a new tap replaces it; a refusal from the engine shows a toast. The engine itself has no range check (co-op trust), actions are
still valid whenever they arrive. Keyboard: A/D or arrows walk the avatar along the line (nearest target highlighted), Space/E acts on it. Tutorial steps wait for the walk.
Work animations per station kind (tied to the level's stations and menu): tawa = pour and spread batter in circles, flip with the spatula, fold; steamer = lift the lid in
a steam cloud, tap the trays; kadai = drop batter/dough, swirl, lift with the jhara spoon; chai = the long Irani high pour between two vessels; serve = slide the plate across the
counter; collect = take the note, tuck it into the money box (gallaa) with a coin ping; discard = tip into the bin. Walking = bob + arm swing; carrying shows plates in hands.
Co-op: avatars share the line, so two at one station stand in offset lanes (`LANE_OFFSET`) and never overlap.

**Everything is STREET style.** This is a Hyderabadi roadside tiffin stall on a footpath (not a restaurant): a tin-roof or tarpaulin-and-bamboo stall with a flex banner sign,
a hand-painted menu board with prices, a steel counter and a wooden thela hand-cart, LPG cylinders and brick stoves, big steel tiffin drums and batter buckets,
stacked steel plates, plastic stools and a bench, a hanging tube-light and bare bulbs on a wire, newspaper-lined baskets, dishes on steel plates / banana leaf /
newspaper cones, chai in small glasses, a wet road with puddle reflections at dusk, autos, scooters and bikes passing, a pani-puri cart neighbour, a kirana shutter,
posters and flex banners, electric poles with tangled wires, a street dog, a cow at noon, Charminar in the haze, and customers who stand and eat at the counter.
UI follows suit: flex-banner headers, hand-painted lettering, order chits on a spike/clip, chalk/enamel board price tags, gunny-sack and tin textures, no glossy app chrome.
Audio: the street (horns, hawkers, pressure cookers, frying, steel plates). Art and copy: Hyderabadi street voice ("Anna, one masala dosa!", "Chai ready, miyan!").

## 2c. FIRST PERSON, real faces, real dialogue (user requirement, supersedes the 3/4 camera of sections 2 and 5)

**The player sees through the cook's eyes**, as in real life: standing behind the counter of a roadside stall, eye height `LAYOUT.eyeHeight`, looking at -z. The cooking row (tawa, idly
steamer, kadai, chai counter) is on the counter in front of you (`STATIONS`, z = -1.0, fronts face +z towards you), customers stand beyond it (`LAYOUT.spotX/spotZ`), the street and
traffic behind them, Charminar in the haze, and the tin roof and bamboo posts overhead. **+x is the cook's right**; `catalog.js` LAYOUT is the source of truth. You walk along the cook line
(`standX`): the camera glides to that x with a walking bob (stride-synced, reduced-motion safe), the head turns towards the target, then your own HANDS do the work in view: spatula and
batter ladle on the tawa, the idly lid, the jhara spoon in the kadai, the long Irani chai pour, plates passed across the counter, money taken. Other players appear as full 3D cooks beside you on
the line. The head can also be turned freely (drag on empty space, or Q/E and arrow keys): `LAYOUT.view` limits. Customers wearing off-screen are shown by edge indicators in the HUD
(patience colour) and by their order chits; tapping a chit acts on that customer without looking at them.
- Scene API additions: `lookBy(dYaw, dPitch)`, `lookAt(target | null)` (smoothly, `null` returns to centre), `getLook() -> {yaw, pitch}`, `setViewmodel(on)`; `project()` returns `visible:false` plus an `edge` hint
  `{ side: 'left'|'right'|'behind', x, y }` for off-screen targets.
- Models API additions: `buildViewmodel() -> { group (attach to the camera), setAction(kind|null, t), setHands(dishes), update(dt,t), dispose() }`; customers face +z (towards the cook) and get proper FACES.
- **Faces and emotions:** each customer has a designed face (eyes with whites, iris, highlights and lids; brows; nose; mouth; ears; cheeks; hairstyles incl. receding grey hair, topknot, bun, plaits, dupatta or
  headscarf, topi/skull cap, moustaches and beards, glasses, bindi, tilak, kids with big eyes), varied by kind and seed. Expressions: `neutral | bored | impatient | angry | happy | delighted | eating | paying |
  sheepish | surprised | laughing | sad`; head and eyes follow the cook (the camera); `setSpeaking(ms, intensity)` moves the mouth and head while a line is spoken; blink; brow and mouth morphs
  are cheap scale/rotation changes of a few meshes (no external assets).
- **Dialogue** (`shared/tiffin-centre/dialogue/`, pure, deterministic, tested): hundreds of authentic lines in **Telugu** (తెలుగు), **Hindi** (हिन्दी) and **Hyderabadi Dakhni Hindi-Urdu** ("kya miyan", "nakko", "mereku", "hau", "bol
  na bhai"), each `{ id, lang, text (script), rom (Roman letters), en (gloss), mood, sit, kinds? }`, written by native-sounding phrasing, never machine-literal, with the emotional range of a real street stall:
  greeting, ordering (dish names in the customer's language), polite waiting -> hurrying -> furious, praise and thanks, complaints (late, cold, burnt, small portion), haggling and extra chutney/sambar requests,
  paying (change, UPI jokes, "keep the change"), blessing and gossip, kids' demands, elders' remarks, office-goers on the phone, students broke at month end, auto drivers, festival and rain and cricket talk,
  regulars teasing the cook, apologising for walking off unpaid, storming off angry. The director `createDialogueDirector({ lang, seed })` maps engine state and events to spoken lines
  (`update(state, events) -> [{ customer, line, ttlMs }]`); the player's setting chooses subtitles: `native | roman | english | both` and optional speech (Web Speech API, `te-IN` / `hi-IN`, no network).
  Lines are flagged for native-speaker review in the file header; no API keys or external services are used at runtime.

## 3. Rules (the engine implements exactly this)

- State advances only by `tick` actions (once per `TICK_MS`) and player actions. Same seed + same actions = same game.
- **Customers** arrive on a schedule built at `createGame` from the seed: gap sampled from `level.gap * PACE[pace].gap / coopScale(players)`;
  kind by `weight`; order size from `kind.order` capped by `level.orderMax`, dishes drawn from `level.menu` (at most 1 repeat);
  patience `PATIENCE_BASE * kind.patience * level.patience * PACE[pace].patience`. They take a free spot (lowest index) or wait
  `ARRIVAL_RETRY` ticks then are turned away (no penalty).
- Customer states: `waiting` (patience drains 1/tick; each dish served refills `PATIENCE_REFILL` of max) -> all dishes delivered ->
  `eating` for `EAT_TICKS` -> `paying` (money out, `payLeft = PAY_WINDOW`) -> `collect` => `paid`. Patience 0 while waiting => leaves
  `angry` (-1 life, combo reset). `payLeft` 0 while paying => leaves `unpaid` (walks away WITHOUT paying, -1 life, combo reset).
- **Stations:** `cook {station, slot, dish}` needs an empty slot, a dish of that station's kind that is on the level menu, and the station unlocked
  by the level. A slot goes `cooking` -> `ready` at `cook` ticks -> `burnt` `burn` ticks later. `take` moves a ready dish into the player's hands
  (`HANDS_MAX`) with quality `perfect | good | ok` (see catalog); `take` on a burnt slot just clears it (event `burnt-cleared`). Hands are per player.
- `serve {customer, hand}` gives the dish in hand index `hand` to that customer if they still need it. `collect {customer}` takes the money from a
  `paying` customer: `total = sum(prices)`, `tip = round(total * kind.tip * (0.04 + 0.12 * patienceFrac) + perfectBonus)` where `perfectBonus` is 5% of each
  perfect dish price, plus `combo` bonus +2% of total per consecutive collect (max +20%). Any player may serve/collect for any customer (that is the co-op).
- `discard {hand}` throws a held dish away. `move {to}` (`null`, a station id, `spot:N` or `bin`: see 2b) sets `players[id].at`; cosmetic for rules, clients animate the walk.
- **Lives:** `LIVES` hearts, shared by the team. At 0 the shift ends as `closed` (failed). Tutorial has none.
- **Shift end:** at `tick >= shiftTicks` no new customers arrive; once everyone present has left, `status = 'done'`. Stars: `money >= stars[i] *
  PACE.stars * coopScale` for i = 0,1,2 gives 1-3 stars; 0 stars = failed. Level 0 always completes when the script ends.
- **Hour:** `hourOf(state) = lerp(level.hour[0], level.hour[1], tick / shiftTicks)`; light and the clock follow it.
- **Co-op win credit:** `result()`: everyone on the team gets rank 1 when stars >= 1 (rank = player count when 0 stars); `winnerId` = top earner (most
  collected money) on success, `null` on failure; `score` of each player = money they collected.

### Engine API (`shared/tiffin-centre/index.js` re-exports all; pure JS, JSON-serialisable state, no Date/Math.random)

```js
createGame({ players:[{id,name,avatar?}], settings:{level,pace}, seed }) -> state
applyAction(state, action) -> { state, events, error? }       // invalid: same state, events [], error string
isOver(state) -> boolean                                      // status !== 'playing'
result(state) -> { winnerId, reason: 'cleared'|'closed'|'tutorial', standings:[{id,rank,score,stats}], stars, money, level }
hourOf(state), daypartId(state), shiftProgress(state) -> 0..1, secondsLeft(state), livesLeft(state)
slotInfo(state, stationId, slot) -> { st, dish, progress 0..1 (cooking) , age (ready), burnLeft }
customerInfo(state, id) -> { patienceFrac, payFrac, needs:[dish] }
chooseAutoAction(state, playerId) -> action | null            // a competent bot for tests/balance (NOT used by the server for AFK)
```
Actions (all carry the acting `playerId`, forced by the server): `cook`, `take`, `serve`, `collect`, `discard`, `move`, `emote {e}`
(`e` in `['thumbs','fire','help','thanks']`), plus server/tutorial-only: `tick`, `spawn {customer}` and `tutorial-flags {patience, pay}`
(accepted only when `cfg.tutorial`; `tick` only from the room server / local runner, never from a client in a room).

State shape (the scene and HUD read this; add fields, never rename):

```js
{ v:1, status:'playing'|'done'|'closed', level, pace, tick, shiftTicks, seed, cfg:{ tutorial, spots, stations:[ids], menu:[dishIds], hour:[a,b], noPatience, noPayExpiry },
  players:{ [id]:{ id, name, avatar, at:stationId|null, hands:[{dish,q}], served, collected, earned, tips } }, order:[playerIds],
  stations:{ [id]:{ id, kind, slots:[{ st:'empty'|'cooking'|'ready'|'burnt', dish, t0, readyAt, burnAt, by }] } },
  customers:[{ id, name, kind, look, spot, st:'waiting'|'eating'|'paying'|'left', order:[dish], got:[dish], arrivedAt, patience, patienceMax,
               eatLeft, payLeft, total, tip, outcome:null|'paid'|'angry'|'unpaid', qs:[q], leftAt }],   // 'left' ones stay ~3 ticks for the walk-out animation, then are pruned
  schedule:[{ at, kind, name, look, order, patienceMax }], nextArrival, money, tips, served, lost, unpaid, combo, lives, stars, emotes:[{by,e,tick}] }
```

Events (the array returned by every applyAction; scene = animation, audio = sound, HUD = toasts): `{type, ...}` with types
`cook-start{station,slot,dish,by}` `ready{station,slot,dish}` `burnt{station,slot,dish}` `burnt-cleared{station,slot,by}` `take{station,slot,dish,q,by}`
`serve{customer,dish,by}` `customer-arrive{customer,spot}` `customer-turned-away{customer}` `eating{customer}` `pay-ready{customer}`
`pay-warning{customer}` (at payLeft 3) `collect{customer,amount,tip,by,combo}` `customer-angry{customer}` `customer-unpaid{customer,owed}`
`discard{dish,by}` `life-lost{lives}` `combo{combo}` `emote{by,e}` `tick{tick}` `shift-end{status,stars}` `tutorial-spawn{customer}`.

## 4. Real time, networking, sessions

- **Server tick:** the adapter's `deadlines(state)` returns `[{ key:`tick-${state.tick}`, afterMs:TICK_MS, playerId:null, action:{type:'tick'}, anchor:'apply' }]`
  while playing; `turnPlayerId`/`idleAction` return `null`, `pendingPlayerIds` returns `[]` (nobody is "on turn"); `sanitizeAction` is an allow-list that
  REJECTS `tick`, `spawn`, `tutorial-flags` and unknown types. Each tick persists + broadcasts the whole state (small: keep state < 3 KB).
- **Client:** `useRoomConnection(code, { onState })` from `src/components/online/useRoomConnection.js` (NOT `useOnlineGame`, which is Tycoon-coupled and
  locks input). Send with `send({ t:'action', action }, { queue:false })`. Rate limit is 40 messages / 5 s / user: coalesce, never spam `move`.
- **Smoothness:** every incoming state records `tickAt = performance.now()`; the scene and HUD interpolate progress with
  `frac = clamp((now - tickAt) / TICK_MS, 0, 1)` between ticks (cooking bars, patience rings, pay timers). Never assume a state arrived exactly on time.
- **Local runner (solo):** same engine, `setInterval`-free: a rAF loop accumulates real time and calls `applyAction(state,{type:'tick'})` per `TICK_MS`; pausable.

### Session interface (the ONE object the 3D scene, HUD, audio and menus consume; local and room sessions both implement it)

```js
session = {
  mode: 'tutorial' | 'practice' | 'online',
  meId, players:[{id,name,avatar,online?}],
  get state(),                 // latest engine state (or null before start)
  get tickAt(),                // performance.now() when `state` arrived
  status: 'loading'|'playing'|'paused'|'done'|'closed'|'disconnected'|'error',
  connection: 'open'|'reconnecting'|'closed',   // solo: always 'open'
  dispatch(action) -> boolean,                  // adds playerId; false when refused locally (hands full etc.: also returns {error} via lastError)
  subscribe(fn) -> unsubscribe,                 // fn({ state, events, tickAt }) on EVERY state change (events may be [])
  lastError,                                    // last refusal text, for toasts
  pause()/resume() (solo only), restart() (solo), quit(),
  result: null | engineResult,
  tutorial: null | { steps, index, step, done, skip() },   // only in mode 'tutorial', see tutorial.js
}
```
`useSession(session)` (React) returns `{ state, tickAt, status, connection, result }` and re-renders ~10x/s plus on every state/event.

## 5. Scene API (`src/games/tiffin-centre/scene/index.js`) and Models API (`src/games/tiffin-centre/models/index.js`)

```js
createTiffinScene(canvas, { quality:'auto'|'low'|'medium'|'high', reducedMotion }) -> {
  setState(state, tickAt),        // call on every session notification; scene interpolates itself between ticks via performance.now()
  handleEvents(events),           // trigger one-shot animation/particles/sounds-sync
  setMe(playerId),
  setHighlight(target|null),      // tutorial pulse: { kind:'station'|'slot'|'customer'|'bin'|'hands', id?, slot? }
  pick(clientX, clientY) -> null | { kind:'slot', station, slot } | { kind:'station', station } | { kind:'customer', id } | { kind:'bin' },
  project(target) -> { x, y, visible }   // CSS px of the target's anchor (customer head, slot top, station) for DOM bubbles
  resize(w, h), start(), stop(), dispose(), getQuality(), onQuality(fn)
}
```
`models/index.js` exports factories; each returns `{ group, update(dt, t, ...), dispose() }` where noted (geometry/material/texture cleanup is mandatory):
`buildStationProp(kindId) -> { group, slotAnchors:[Vector3], setSlot(i, {st, dish, progress}), update(dt,t) , dispose }`,
`buildDish(dishId, q='good') -> Group` (on its plate/glass/leaf, ~0.35 m), `buildCustomer(kindId, seed) -> { group, setMood('waiting'|'eating'|'paying'|'happy'|'angry'|'walkaway'), setPatience(0..1), update(dt,t), dispose }`,
`buildAvatar({ color, name }) -> { group, setPose('idle'|'cook'|'carry'|'walk'|'cheer'), setHands(dishes[]), update(dt,t), dispose }`.
Stall shell (counter, awning, signboard, floor, street, backdrop) belongs to the scene agent (`scene/stall.js`). All textures are canvas-generated; text signs
use a `canvasTexture` helper you write in `scene/textures.js` (do NOT import from `src/games/autowala`).
HUD/DOM uses `scene.project()` for bubbles: the scene does not render DOM-style UI itself.

## 6. Tutorial (`shared/tiffin-centre/tutorial.js`, pure)

Steps are data: `{ id, text, te?, spotlight:{ kind, id?, slot? }|null, flags:{patience,pay}, onEnter:[actions to apply, e.g. spawn], done:(state, events, ctx) => boolean, hint? }`.
Required beats: welcome and look around -> a customer arrives, read the order bubble -> tap the tawa -> choose Dosa -> it cooks (watch the bar) -> take it
the moment it is ready (a deliberately burnt demo explains burning) -> serve the customer -> the customer eats, then holds money out: **collect it quickly or they walk
away unpaid** (patience frozen until this step; pay window demonstrated) -> irani chai on the chai counter, carry two dishes (hands) -> a real timed mini-rush with
two customers -> "You are ready. Invite friends to run the centre together!" -> `onComplete`. Every step can be skipped with Skip tutorial (still counts as not completed
unless finished). Finishing writes `localStorage[TUTORIAL_LOCAL_KEY]='1'` and calls `POST /api/games/tiffin-centre/tutorial/complete`.

## 7. Server (`worker/games/tiffin-centre.js` + a few generic seams)

Adapter per `docs/ADDING_A_GAME.md` section 3 with the real-time settings of section 4 above. `minPlayers 2`, `maxPlayers 4`, `defaultSettings = DEFAULT_SETTINGS`,
`validateSettings` strict from `SETTINGS_SPEC`. New optional adapter hook **`canHost({ env, user }) -> { ok:true } | { ok:false, error }`** called in
`worker/routes/rooms.js` after `parseRoomInit` (403 with the message when not ok). Tiffin's `canHost` requires `user_game_stats.extra->>'tutorial' = 'true'`.
New generic route `POST /api/games/:gameId/tutorial/complete` (requires a user; guests allowed; only for ids in a `TUTORIAL_GAMES` set in `worker/games/tutorial.js`;
upserts `user_game_stats(user_id, game_id, extra = extra || '{"tutorial":true}')` WITHOUT bumping games/wins). `GET /api/me` exposes
`gameStats[id].tutorialDone` (boolean). Joiners do NOT need the tutorial (only the host who creates the table).

## 8. Hub seam (generic, no Tiffin names in hub code)

Manifest fields: `solo: true` (has a solo screen at `paths.solo(id)` = `/play/tiffin-centre`, `loaders.soloGame` = the tutorial/practice screen), `loaders.onlineGame`,
`modes.friends: true`, and **`tutorial: { requiredForRooms: true }`**. Helper `tutorialDone(user, game)` in `src/platform/game/tutorial.js` =
`user?.gameStats?.[game.id]?.tutorialDone === true || localStorage[`jalebi.tutorial.v1.${game.id}`] === '1'`. When `game.tutorial?.requiredForRooms` and not done:
the game page shows a primary **Play tutorial** link (`paths.solo(id)`) instead of Create table, hides join/invite/open-tables for that game and shows a lock note
("Finish the tutorial to open a table with friends"); `inviteGames()` and the home hero hide it; unlocking is instant after completion (re-read `/api/me`).
`SoloGame.jsx` must render a game that has both `solo` and `loaders.onlineGame`; `GameDetail` shows the live (room) detail for such a hybrid.

## 9. Work packages and file ownership (no two WPs own a file)

| WP | Owner of | Notes |
|---|---|---|
| ENGINE | `shared/tiffin-centre/{engine,schedule,scoring,bot,index}.js`, `shared/tiffin-centre/*.test.js` (not tutorial) | pure; fuzz to game over; balance with the bot; may retune NUMBERS in catalog.js `LEVELS`/`PACE` |
| TUTORIAL+SESSIONS | `shared/tiffin-centre/tutorial*.js`, `src/games/tiffin-centre/session/*` | local runner, room session, `useSession`, progress storage, tutorial driver |
| SERVER | `worker/games/tiffin-centre.js` (+test), `worker/games/tutorial.js`, `worker/games/index.js`, `worker/routes/rooms.js`, `worker/routes/tutorial.js`, `worker/users.js`, `worker/index.js` (mount only), `worker/games/games.test.js` and other worker tests that enumerate adapters | |
| SCENE | `src/games/tiffin-centre/scene/*` | renderer, stall shell, lighting by hour, camera, picking, particles, interpolation, quality |
| MODELS | `src/games/tiffin-centre/models/*` | dishes, station props, customers, avatars (procedural low-poly) |
| HUD | `src/games/tiffin-centre/ui/hud/*` | in-game overlay: clock, money, lives, order rail, bubbles, hands, action sheet, controls, co-op bar |
| MENUS | `src/games/tiffin-centre/ui/menus/*` | solo home (tutorial / practice / levels), shift results, pause, coach marks, loading/error/disconnect panels |
| AUDIO | `src/games/tiffin-centre/audio/*` | Web Audio synthesis, per-daypart ambience, event sounds, haptics, mute |
| MANIFEST+ART | `src/games/tiffin-centre/{manifest,settings}*.js`, `src/components/art/hub/TiffinArt.jsx`, one line in `art/hub/index.js`, one entry in `src/games/registry.js` | |
| HUB | `src/pages/GameDetail.jsx`, `src/pages/SoloGame.jsx`, `src/platform/game/tutorial.js` (+test), `src/platform/home/HomeHero.jsx`, `src/components/online/games.js`, `docs/ADDING_A_GAME.md` (new section) | generic only |
| GLUE (Wave 2, lead) | `src/games/tiffin-centre/{TiffinGame,TiffinSolo,OnlineGame}.jsx`, `tiffin.css` | wires session + scene + hud + audio + menus; loaders in the manifest point here |

Shared-file edits that a WP needs but does not own: put the exact request in the final report instead of editing.
