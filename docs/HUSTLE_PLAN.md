# Hyderabad Hustle rules + GameHub UI overhaul — build contract

Source of the rules: `Hyderabad_Hustle_Game_Concept.md` (repo root). Product decisions (owner, 2026-11-15):
the live game keeps its id `hyderabad-tycoon` and name **Hyderabad Tycoon** (since renamed **Kingpin**; the Hyderabad map is now **Charminar Chaos**), but its rules are **replaced** by the Hustle ruleset below;
online only (no pass-and-play); **one die** (a six rolls again, as today); everything else uses the concept doc's recommended defaults.
Snatch, Shield, Traps and the Get-Out-of-Jail card are **removed**. The hub/UI/animation plan runs in parallel.

Everything here is a contract: if you need to deviate, keep the names and shapes and say so in your report.

## 0. Rules for every agent

* Work only in `A:\Coding\Projects\GameHub-marketplace`. Edit **only the files your brief says you own**. Other agents edit other files at the same time.
  Shared files (`src/App.jsx`, `src/main.jsx`, `package.json`, `worker/index.js`, `db/schema.sql`, `src/lib/api.js`, this file) are owned by the
  brief that names them or by the orchestrator; if you need a change there, put it in your report.
* The working tree contains uncommitted work from another session (lobby share card, `online.css`, `hub.css`, `GameDetail.jsx` ...). It is the base: keep it.
* **No git commits, no pushes, no deploys, no migrations against the database** (`npm run migrate` / `scripts/migrate.js` hit PRODUCTION). Tests use fakes.
* No new npm dependencies. No external assets: inline SVG/CSS art only. Money via `formatINR` / `compactINR` from `@shared/format.js`.
* Mobile-first (360-430 px) and good at >= 1280 px; 44 px touch targets; keyboard accessible; loading / empty / error states;
  respect `prefers-reduced-motion` and `:root[data-motion='reduced']`; no console errors when the API is unreachable.
* Verify: `npx vitest run <your tests>`; syntax-check JSX with `node_modules/.bin/esbuild <files> --loader:.js=jsx --log-level=warning --outdir=<your scratchpad>`.
  `npx vite build` must pass at the end (the orchestrator runs it; you may run it too, but other agents' half-finished files can break it: judge only your own files).
* Final report <= 250 words: files changed, contract deviations, what others must wire up, known gaps, test results (honest).

## 1. Design direction (hub + game)

**Concept: "Hyderabad after dark."** The existing hub language stays: deep night-navy surfaces, hub violet brand (`--hub-brand #7b6dff`), each game's own
accent (Tycoon: saffron/gold `#ffc857` -> `#ff8a3d`), big friendly display type, 18-26 px radii, soft shadows. We raise quality, we do not invent a new system.
* **Signature element:** *string-light gold.* Money is always physical: coins fly from payer to payee, counters roll up, the active tile glows like a
  festival lantern, rewards burst as a short shower of gold coins. Gold is reserved for money and "your turn"; violet for navigation and the hub.
* **Light theme (hub only):** warm sandstone paper (`#f7f1e6` bg, `#fffaf2` surfaces, ink `#1b1d33`), the same violet brand and game accents.
  Game screens (`/play/**`) always stay dark.
* **Motion language** (tokens in `src/styles/tokens.css`): `--dur-1` 120ms (press, hover), `--dur-2` 220ms (chips, toasts, small enter/exit),
  `--dur-3` 360ms (sheets, cards, page enter), `--dur-4` 600ms (celebrations, hand-offs); easings `--ease-out` (default enter), `--ease-in` (exit),
  `--ease-spring` (pop / overshoot for rewards and builds), `--ease-std`. Animate `transform` / `opacity` only (no `left`/`top`/`box-shadow` loops).
  Every animation has an exit, can be interrupted without jumping, and collapses to an instant change under reduced motion.
  Charm never slows play: in-game animations must fit the presenter's pacing (section 3.8) and be skippable via the playback speed.
* **Sound + haptics:** WebAudio synth in `src/lib/sfx.js`; `buzz(kind)` from `src/lib/haptics.js` (`tap turn pay earn warn win`).

## 2. Foundation already in place (import, do not re-create)

| Path | What |
|---|---|
| `shared/timing.js` | `ANIM_MS` (all presenter delays incl. new `ride`, `chai`, `turn`), `LONG_TRIP`, `MAX_ANIM_MS`, reading-time helpers `readMs` / `cardMs` / `eventMs`, and the human decision limits (`DECISION_MS` 60 s, `TRADE_MS` 45 s, `WARN_MS` 15 s). Single source for client pacing AND the server's `estimateAnimMs`. |
| `shared/cosmetics.js` | `COSMETICS` catalogue (kinds `frame`, `dice`, `title`, plus the owned-only `voice`), `COSMETIC_KINDS`, `EQUIPPABLE_KINDS`, `FREE_COSMETICS`, `cosmeticById`, `cleanEquipped(raw)`, `voiceLines()`, `isVoiceId(id)`, `voiceSrc(id)`, `VOICE_LIMITS` / `VOICE_COOLDOWN_MS` / `VOICE_BURST`. |
| `src/lib/haptics.js` | `buzz(kind)` |
| `src/lib/storage.js` | settings now also hold `theme: 'system'\|'dark'\|'light'`, `playbackSpeed: 0.75\|1\|1.5\|2`, `haptics: boolean` (`THEMES`, `PLAYBACK_SPEEDS`). Level curve now matches the server (`100 + (L-1)*50` per level). |
| `src/lib/api.js` | `getMyRooms getOpenRooms getGamesLive claimDailyReward getMyMatches getShop buyCosmetic equipCosmetic getInvites dismissInvite getPushKey pushSubscribe pushUnsubscribe` (shapes in section 4). |
| `src/platform/paths.js` | `paths.shop()` -> `/shop` |
| `src/styles/tokens.css` | motion tokens above |
| `db/schema.sql` | `users.daily_streak`, `users.last_daily`, `users.equipped jsonb`, tables `user_items`, `invites`, `push_subscriptions` |
| `worker/routes/shop.js`, `worker/routes/push.js` | empty Hono routers, already mounted at `/api/shop` and `/api/push` |

## 3. Hustle rules (engine contract)

### 3.1 Board — 36 tiles, ids 0-35, clockwise, 10x10 ring
Corners: 0 START, 9 Traffic Jam, 18 Chai Adda, 27 Municipal Charges. `BOARD_SIZE = 36`, `GRID = 10`.
`tilePosition(i) -> {col,row}` on the 10x10 ring (row 0 = top) with **START bottom-left**, play going **up the left side, right along the top, down the right, left along the bottom** (same orientation the current uncommitted board uses).

| id | name | type | group | price |
|---:|---|---|---|---:|
| 0 | START — Namma Hyderabad | start | | |
| 1 | Sultan Bazaar | property | bazaar | 60,000 |
| 2 | Nawabi Luck | card (deck `luck`) | | |
| 3 | Monda Market | property | bazaar | 70,000 |
| 4 | Begum Bazaar | property | bazaar | 80,000 |
| 5 | Auto Stand | transport | | fare 25,000 |
| 6 | Laad Bazaar | property | oldcity | 1,00,000 |
| 7 | Charminar Precinct | property | oldcity | 1,10,000 |
| 8 | Chowmahalla Precinct | property | oldcity | 1,20,000 |
| 9 | Traffic Jam | traffic | | |
| 10 | Malakpet | property | everyday | 1,40,000 |
| 11 | Mehdipatnam | property | everyday | 1,50,000 |
| 12 | City Drama | card (deck `drama`) | | |
| 13 | Tolichowki | property | everyday | 1,60,000 |
| 14 | Metro Interchange | transport | | fare 35,000 |
| 15 | Sainikpuri | property | twin | 1,80,000 |
| 16 | Patny Centre | property | twin | 1,90,000 |
| 17 | Paradise Circle | property | twin | 2,00,000 |
| 18 | Chai Adda | chai | | |
| 19 | Lumbini Park Precinct | property | lake | 2,20,000 |
| 20 | Tank Bund | property | lake | 2,30,000 |
| 21 | Nawabi Luck | card (deck `luck`) | | |
| 22 | Necklace Road | property | lake | 2,40,000 |
| 23 | MMTS Express | transport | | fare 45,000 |
| 24 | Film Nagar | property | luxury | 2,60,000 |
| 25 | Banjara Hills | property | luxury | 2,70,000 |
| 26 | Jubilee Hills | property | luxury | 2,80,000 |
| 27 | Municipal Charges | municipal | | 40,000 + 10,000 per upgrade level you own |
| 28 | Kondapur | property | cyber | 3,00,000 |
| 29 | Madhapur | property | cyber | 3,20,000 |
| 30 | City Drama | card (deck `drama`) | | |
| 31 | HITEC City | property | cyber | 3,40,000 |
| 32 | Bazaar Auction | auction | | |
| 33 | Gachibowli | property | newcity | 3,60,000 |
| 34 | Kokapet | property | newcity | 3,80,000 |
| 35 | Financial District | property | newcity | 4,00,000 |

`GROUPS` (id -> `{ name, color, tiles, levelNames: [L0, L1, L2], theme }`):

| id | name | colour (suggested) | levelNames | theme |
|---|---|---|---|---|
| bazaar | Bazaar Beginnings | `#c98b4a` sandstone | Stall, Shop, Trading Hub | bazaar |
| oldcity | Old City Icons | `#e2725b` terracotta | Irani Cafe, Biryani House, Food Franchise | food |
| everyday | Everyday Hyderabad | `#f2b134` turmeric | Tiffin Centre, Restaurant, Food Court | food |
| twin | Twin Cities | `#3fb68b` emerald | Kiosk, Showroom, Transit Mall | transit |
| lake | Lake & Leisure | `#3aa7e0` lake blue | Snack Kiosk, Boathouse Cafe, Lakeside Resort | venue |
| luxury | Lights, Camera, Luxury | `#b06ad9` amethyst | Studio, Entertainment Venue, Premium Complex | venue |
| cyber | Cyberabad | `#4f7cff` electric blue | Startup Office, Business Centre, Tech Campus | tech |
| newcity | The New City | `#1fb5a6` glass teal | Co-working Floor, Corporate Tower, Skyline Campus | tech |

Tiles are **fictional commercial ventures** in the precincts (heritage rule), each tile has a one-line `lore`.

### 3.2 Economy
* Start cash 15,00,000 (`quick` mode 20,00,000). START pays **2,00,000** when passed or landed on (once per move; backwards never pays).
* Buying: land on an unowned property -> buy at price, or pass -> the district stays free (**no auction**, so nobody can dodge Snatch; the old `auctionOnDecline` rule is retired and ignored). Unaffordable -> no buy offer, it stays free.
* **Levels:** a bought district is level 0 (its first business, `levelNames[0]`). `MAX_LEVEL = 2`. Upgrade cost = 40% of price (24,000 - 1,60,000; see docs/GAME_RULES.md 5.1).
  Upgrading needs the **whole collection** (you own every district of the tile's `group`; mortgaged siblings still count; levels already built stay if the set is later broken), no even-building rule, the tile unmortgaged, your turn in `roll`/`manage`, cash >= cost. Reason: `Own all 3 districts of <collection> first (you have N)`.
* **Rent** = `rentTable(tile) = [base, round1000(base*2.7), round1000(base*4.4)]` with base = 10% of price (HITEC: 34,000 / 92,000 / 1,50,000).
  **Full set bonus: 1.5x on level-0 tiles only.** Mortgaged tiles collect nothing. City events multiply on top (3.6).
* Selling an upgrade (`SELL_BUILDING`) refunds 50% of its cost. Mortgage = 50% of price, lifting costs +10%. Mortgage needs level 0.
* **Net worth** = cash + price of each owned unmortgaged property + (price - mortgage value) for mortgaged ones + 50% of upgrade costs paid - unpaid debt.

### 3.3 Specials
* **Transport (5, 14, 23)** — not buyable. Landing gives the option `RIDE` (pay the tile's fare to the bank, move forward along the board to the **next** transport stop;
  passing START pays salary; arriving on the stop has no further effect). The option lasts until END_TURN / ROLL. Auto-play never rides. Flavour line on ride: "Meter kharab hai, saab!" etc.
* **Traffic Jam (9)** and the "Ameerpet traffic" card make you **stuck** where you stand (`player.stuck = true`, the extra roll is lost, turn ends).
  On your next turn, in phase `roll`: `PAY_TRAFFIC` (25,000, then roll normally), `USE_CHAI` (spend chai, then roll normally), or `ROLL` = you wait: no move, `stuck` clears, turn ends.
* **Chai Adda (18)** — gain a chai token (`player.chai`, max **1**; at the cap nothing happens). Chai is spent **automatically** on the next rent payment of >= 20,000 (halves it), or manually with `USE_CHAI` to leave traffic.
* **Municipal Charges (27)** — pay 40,000 + 10,000 per upgrade level you own (cash reason `tax`).
* **Bazaar Auction (32)** — if any property is unowned, a seeded-random one goes to a sealed auction (`auction_start.reason = 'bazaar'`), min bid 50% of its price; the lander bids like everyone. None unowned -> nothing.
* **Cards (2, 21 = Nawabi Luck; 12, 30 = City Drama)** — two seeded decks, >= 16 cards each, reshuffled when exhausted. Card = one funny hook (`title`), one short sentence (`text`), one clear effect.
  Must include the concept doc's six examples (Shaadi ka season! pay 50,000 · Biryani franchise goes viral +80,000 · Ameerpet traffic. Baigan! stuck · Cricket night at Uppal! your rents x2 until your next turn ·
  The landlord wants an advance pay 35,000 · An investor is impressed! +1,00,000), plus move-to cards (e.g. "Take the Metro to HITEC City"), "collect 10,000 from every player", "pay 15,000 per upgrade", a free chai card.

### 3.4 Modes and winning (host setting `mode`)
| mode | label | rounds | start cash |
|---|---|---|---|
| `standard` (default) | Standard City Hustle | 20 | 15,00,000 |
| `quick` | Quick Chai Break | 12 | 20,00,000 |
| `classic` | Classic Long Game | until one player is left (safety cap 60 rounds) | 15,00,000 |

Win: last player standing, or highest **net worth** when the last round ends (tie: more cash, then seat order; `standings()` must agree with the winner).
`winReason: 'last_standing' | 'target' | 'rounds'`. **Win target (added 2026-11-15):** host setting `targetWorth` (`null` | ₹25L | ₹30L | ₹40L | ₹50L | ₹75L | ₹1Cr; default ₹50L for standard and quick, ₹30L for classic, which cannot be switched off): the first player whose net worth reaches it wins at once (only when no debt, auction or trade is pending); `state.cfg.targetWorth`, `win` event `reason: 'target'`. See `GAME_RULES.md` 7.4.
Host settings: `mode` and `targetWorth` (another mode resets the target), `dice: 'lucky'|'fair'` (default lucky), `maxPlayers` 2-6. **Host rules (added 2026-11-15): the host customises every rule** (`startCash passStart targetWorth rentPercent trafficFine turnSeconds tradeSeconds maxRounds dice requireFullSet eventEvery chaiCap` + the three Snatch keys): one source of truth `shared/ruleSettings.js`, read from `state.cfg`; table in `GAME_RULES.md` section 2, wire in `CONTRACT.md` 3e; a mode change resets only `startCash`, `maxRounds`, `targetWorth`.

### 3.5 Pieces
`PIECES = [{id:'pearl',name:'Pearl'},{id:'auto',name:'Auto-rickshaw'},{id:'handi',name:'Biryani handi'},{id:'chai',name:'Irani chai glass'},{id:'bat',name:'Cricket bat'},{id:'camera',name:'Film camera'}]` (in `shared/board.js`).
`createGame({players:[{id,name,avatar,piece?}]})` keeps a requested free piece, else assigns the first free one: `player.piece`. Player colours stay as today.

### 3.6 City events ("Hyderabad Rush Hour")
Drawn when the round number becomes a multiple of **3** (never round 1), lasting that round, public in `state.event` as today
(`{ id, title, text, kind, round, group?, groups?, mult?, amount? }`):
`rush_hour` (one random collection that someone owns, rent x1.5; flavour per group: Cyberabad office traffic / Old City shopping / lakefront visitors / cricket crowds),
`biryani_boom` (food groups `oldcity`+`everyday`: upgraded tiles pay x2), `wedding_season` (every player pays 30,000; each upgraded tile in `lake`/`luxury` pays its owner 20,000),
`festival` (Bonalu / Bathukamma / Eid festive bonus: every player +50,000, respectful text), `monsoon` (one collection pays half rent).

### 3.7 State, actions, options, events (deltas vs docs/GAME_RULES.md section 8)
* `phase`: `roll | buy | auction | manage | debt | over` (no `snatch`).
* `cfg`: `{ mode, startCash, passStart, maxRounds|null, dice, trafficFine, chaiCap }`.
* `owners[36]`, `levels[36]` (0-2), `mortgaged[36]`. `state.ride = null | { player, from, to, fare }` (offer open for the turn player).
* Player: `{ id, name, avatar, color, piece, cash, pos, stuck, chai, laps, bankrupt, sixes, rollsSinceSix, rentStreak, rentThisTurn, lastOfferTurn,
  stats: { rentPaid, rentEarned, taxPaid, propertiesBought, upgrades, biggestRent, rides, chaiSaved } }`. Removed: `jailTurns jailCards snatches traps`. `state.traps` removed.
* Actions: `ROLL PAY_TRAFFIC USE_CHAI BUY SKIP_BUY RIDE UPGRADE SELL_BUILDING MORTGAGE UNMORTGAGE PAY_DEBT END_TURN BID TRADE_OFFER TRADE_ACCEPT TRADE_REJECT TRADE_CANCEL RESIGN`.
  Removed: `PAY_BAIL USE_JAIL_CARD SNATCH SNATCH_CLOSE PLACE_TRAP`, `BUY.shield`. Tile fields are ints 0-35.
* `getOptions(state, me)` keys: `roll payTraffic useChai buy skipBuy ride endTurn upgrade[] bid mortgage[] unmortgage[] sellBuilding[] debt payDebt trade tradeOffer tradeSent sets[] resign`
  (`ride` = `{ to, fare } | null`; `payTraffic` = fine or false; `useChai` boolean).
* Events (new / changed; the rest as GAME_RULES 8.6 minus snatch/trap/shield/token/jail):
  `move {player, from, to, path, passedStart, teleport?, ride?}` ·
  `traffic {player, stuck: boolean, reason: 'tile'|'card'|'paid'|'chai'|'waited'}` ·
  `ride {player, from, to, fare}` (before its `move`) ·
  `chai {player, chai /*new count*/, change: 1|-1, reason: 'adda'|'card'|'rent'|'traffic', saved? /*rupees saved*/}` ·
  `card {player, cardId, kind:'good'|'bad'|'neutral', deck:'luck'|'drama', title, text}` ·
  `auction_start {tile, minBid, reason?: 'bazaar'|'decline'|'unaffordable'}` ·
  `cash` reasons: `salary rent tax buy upgrade auction card fare traffic liquidate mortgage unmortgage sell trade event` ·
  `level {tile, level, reason}` · `set_complete {player, group}` · `turn {player, round}` · `win {player, reason, worth}`.
* Redaction: only sealed bids (as today) and the engine secrets (`rng`, `deck` -> 0 / []).

### 3.8 Pacing
The presenter's base delays live in `shared/timing.js` `ANIM_MS`. The server's `estimateAnimMs(events)` must use the same table
(dice + afterDice, step x path length (faster for trips > LONG_TRIP), card, auctionEnd, cityEvent, ride, chai, level, own, rent, turn, win ...), capped at `MAX_ANIM_MS`.
The client `playbackSpeed` setting may only make playback faster (>= 1) or slightly slower (0.75); the server never waits less than the speed-1 estimate.

### 3.9 Room / clock / presence (GameRoom contract)
* `{t:'state', state, events, seq, clock}` — `clock = { deadline: epochMs|null, waitingFor: playerId[] }` = when the decision timer (60 s after the animation) auto-plays.
* `{t:'room', room}` — `room.players[i]` gains `connected: boolean`, `piece: string|null`, `cosmetics: { frame?, dice?, title? }` (from `users.equipped`).
* Lobby: client -> `{t:'piece', piece}` picks a free piece (adapter optional hook `pieces: string[]`); taken / unknown -> `{t:'error'}`. Pieces are passed to `createGame` as `players[i].piece`.

## 4. Hub API contract (all JSON, cookie session; errors `{ error }`)
* `GET /api/me` -> user gains `daily: { streak, lastClaim /*'YYYY-MM-DD' IST or null*/, canClaim, nextReward }` and `equipped: { frame?, dice?, title? }`.
* `POST /api/me/daily` (requireUser) -> `{ reward, streak, coins, daily }`; 409 `{error:'Already claimed today.'}`. IST (Asia/Kolkata) calendar days; streak +1 if the last claim was yesterday else 1; reward `100 + 50*min(streak,6)` (150..400).
* `GET /api/me/matches?limit=20` (requireUser, max 50) -> `{ matches: [{ id, gameId, endedAt, rounds, playerCount, rank, won, score, players: [{ name, avatar, rank, score, isMe }] }] }`.
* `GET /api/shop` (session optional; signed-out -> owned = free only) -> `{ items: [{ id, kind, name, price, rarity, colors?, icon?, emoji?, src?, durationMs?, caption?, owned, equipped }], coins, equipped }`. Kind `voice` (voice lines: Sheru Bhai 900 coins, Ladle Meow 700 coins, Old Man 500 coins) is **owned-only**: it carries `icon`/`emoji` (the symbol), `src` (`/audio/voice/<name>.mp3`, served from `public/`), `durationMs` and `caption`, is bought with the same `POST /api/shop/buy`, and is never `equipped` (`POST /api/shop/equip` with kind `voice` -> 400). The owner plays it in a room with `{t:'voice', id}`; see `CONTRACT.md` section 9b.
* `POST /api/shop/buy { itemId }` -> `{ coins, owned: string[] }`; 400 unknown item, 402 `Not enough coins.`, 409 `Already owned.` (atomic: coins checked and spent in one UPDATE).
* `POST /api/shop/equip { kind, itemId|null }` -> `{ equipped }`; 403 when not owned.
* `GET /api/leaderboard?game=` rows gain `isMe`, `rating`, `level`, `frame`, `title`; response gains `me: row|null` (the caller's own row and rank even outside the top N).
* Friends rows (`GET /api/friends`) gain `equipped`.
* `POST /api/invites { code, userId }` additionally **stores** the invite and still returns `{ ok: true, delivered }`. `GET /api/invites` -> `{ invites: [{ id, from:{id,name,avatar}, code, gameId, gameName, createdAt }] }` (to me, not dismissed, < 2 h old). `POST /api/invites/:id/dismiss`.
* Push (only when env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are set; otherwise every call is a harmless no-op): `GET /api/push/key` -> `{ key|null }`; `POST /api/push/subscribe { subscription }`; `POST /api/push/unsubscribe { endpoint }`. Invites push a notification to the invitee's subscriptions.

## 5. Manifest additions (`src/games/hyderabad-tycoon/manifest.js`)
`tagline` "Own the city. Survive the madness." · `description` from the concept pitch · `duration` '35-60 min' · `features` · `createHint` (the line under Create table) ·
`howToPlay: [{ title, text }]` (4 steps: Roll, Buy or pass, Upgrade, Richest after the last round wins) · `pieces: PIECES` · `badges: [{ id, label, desc, stat, target, icon }]`
(game-specific badges such as "Landlord: collect ₹5,00,000 in rent") · `stats` adds `{ key: 'rating', label: 'Rating' }` · `lobbySettings: ['mode', 'targetWorth']` · `tableRules` · `summarize`.

## 6. Work packages (owner = only agent allowed to edit)
| WP | Owns |
|---|---|
| ENGINE | `shared/**` except `timing.js`/`cosmetics.js`, `worker/games/hyderabad-tycoon.js`, `worker/mask.js`, `worker/settings.js`, `worker/validate.js` (+ their tests, `worker/snatch.test.js`, `worker/tokens.test.js`), `scripts/simulate.js`, `docs/GAME_RULES.md`, `src/games/hyderabad-tycoon/{settings,manifest,constants}.js` (+tests), `src/lib/messages.js` (+test), `src/lib/session/gateOptions.js` (+test) |
| B-ECON | `worker/routes/me.js`, `worker/routes/shop.js`, `worker/routes/leaderboard.js`, `worker/leaderboard.js`, `worker/routes/friends.js`, `worker/users.js`, `worker/xp.js`, `worker/match.js`, `worker/rating.js` (+ tests, new `worker/shop.test.js`, `worker/daily.test.js`) |
| B-ROOMS | `worker/GameRoom.js`, `worker/UserHub.js`, `worker/hub.js`, `worker/roomsdb.js`, `worker/games/index.js`, `worker/routes/rooms.js`, `worker/routes/invites.js`, `worker/routes/push.js`, new `worker/push.js`, `public/sw.js`, new `src/lib/push.js` (+ tests) |
| THEME | `src/styles/hub.css`, `src/styles/hubhome.css`, `src/styles/online.css`, `src/styles/global.css` |
| G-TURN | `src/components/game/{GameView,ControlPanel,ActionBar,EventBanner,LogPanel,MenuSheet,EmoteBar,MoneyBar}.jsx`, `ControlPanel.test.js`, `EventBanner.test.js`, new `src/components/game/turn/**`, `src/styles/{controlpanel,game,chat}.css`, new `src/styles/turn.css`, `src/lib/session/useOnlineGame.js`, `src/games/hyderabad-tycoon/OnlineGame.jsx`, `src/pages/OnlineGame.jsx`, `src/lib/sfx.js`, `src/lib/cardClips.js` |
| G-SHEETS | `src/components/game/{PropertySheet,AuctionSheet,TradeSheet,DebtSheet,PlayerSheet,MyProperties,RulesSheet,GameOverModal,SetCelebration}.jsx`, `src/components/game/ui/**`, `snatch.js`, `oddsPref.js`, `sheets.test.js`, `PropertySheet.test.js`, `src/styles/deed.css`, new `src/styles/sheets.css` |
| G-BOARD | `src/components/game/{Board,Tile,Pawn,Dice}.jsx`, `board.test.js`, `Dice.test.js`, new `src/components/game/fx/**`, `src/styles/{board,dice}.css`, new `src/styles/fx.css`, `src/lib/session/usePresenter.js` (+test) |
| ART | `src/components/art/**` (incl. `hub/`) |
| H-HOME | `src/pages/Home.jsx`, `src/platform/home/{Hero,GameCard,CategoryRow,CategoryChips,GameArt,TopPlayers,catalog,gameTheme}.js(x)`, `src/components/shell/home/**`, new `src/styles/x-home.css` |
| H-LOBBY | `src/pages/{GameDetail,Lobby,JoinRoom}.jsx`, `src/platform/game/**`, `src/components/online/{Seat,ShareCard,SettingsPanel,CodeInput,GameIcon,ConfirmDialog,Sheet,useRoomConnection,lobbyModel,gameHelpers,gameRoute,codes,clipboard}.js(x)` (+tests), new `src/styles/x-lobby.css` |
| H-SOCIAL | `src/pages/{Friends,FriendLink,Login,NotFound}.jsx`, `src/components/online/{InviteBanner,InviteFriends,InviteToGameSheet,Toasts,friendsModel,settings}.js(x)` (+tests), `src/lib/socket.js` (+test), new `src/styles/x-social.css` |
| H-PROFILE | `src/pages/{Leaderboard,Profile}.jsx`, new `src/pages/Shop.jsx`, `src/platform/home/{Podium,RankRow,LeaderTabs,ProfileHeader,BadgeGrid,badges,GameStatCards,gameStats,SettingsSection,AccountSection,AboutSection,PageHead,Ava,useApi,home.test}.js(x)`, new `src/styles/x-profile.css` |
| H-SHELL | `src/App.jsx`, `src/main.jsx`, `src/components/shell/**` except `home/`, `src/lib/auth.jsx`, `src/platform/brand.js`, `public/manifest.webmanifest`, `index.html`, new `src/styles/x-shell.css` |
