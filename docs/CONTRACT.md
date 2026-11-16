# Kingpin — build contract

A Hyderabad-themed Monopoly-style business game (display name Kingpin; the game id stays `hyderabad-tycoon`; maps Charminar Chaos and Andhra Aatalu). Mobile-first, desktop-friendly.
Reference screenshot: `photo_2026-10-16_15-04-12.jpg` in the repo root (read it with your image reader).
Stack: React 19 + Vite 8 (plain JS/JSX, **no TypeScript**), Cloudflare Worker (Hono) + Durable Objects, Neon Postgres, Google login.

> **Status: historical build contract of the original single-game app.** It is kept for the original engine API, the backend and the database sections. It is **not** the description of the current game: the rules, state machine, wire protocol,
> events, timers and redaction are in [`GAME_RULES.md`](GAME_RULES.md), the marketplace and plugin contract in [`MARKETPLACE.md`](MARKETPLACE.md) and the pre-game flow in the README ("How a game starts").
> Superseded since this file was written: **two dice / doubles** (now one die, a six rolls again), the **28-tile board** (now 40 tiles), **bots and bot rivals** (rooms are humans only; the bot brain only auto-plays idle seats),
> **voice lines, Telugu text, story, campaign and offline play** (all removed; English only), the **ready toggle and visibility picker** (not in the lobby UI), **open tables** (API only), `passStart` 1,500 / 3,200 (now 2,000)
> and the Laad Bazaar / Film City corners. Sections below are labelled **[current]**, **[corrected]** (rewritten to match the code) or **[historical]** (original text, may be wrong).

## 0. Rules for every agent **[historical]**
(How the original multi-agent build was organised. The current dependency list is `package.json`; fonts are not a dependency any more.)
1. **Own only your files** (section 1). Never edit another owner's file, even to unblock yourself. Other agents are building the rest at the same time, so a module you import may not exist yet. Code against this contract. If you need something not in it, code defensively and write it in your report.
2. **Never edit** `package.json`, `package-lock.json`, `vite.config.js`, `index.html`, `src/styles/tokens.css`, `shared/board.js`, `shared/format.js`, `.dev.vars` or this file. Dependencies were pre-installed (see `package.json`). Need another one? Say so in your report; do not install.
3. **No git commit/push.** **Never print or copy secrets** (`.dev.vars`). Read them only through the code paths that need them.
4. Import aliases: `@shared/...` → `shared/`, `@/...` → `src/`. Worker code uses relative imports (`../shared/engine.js`).
5. Verify your own work. Syntax-check files with `node_modules/.bin/esbuild <files> --loader:.js=jsx --log-level=warning --outdir=<scratchpad dir>`. Run `npx vitest run <path>` for tests. `npx vite build` only works once every module exists, so don't depend on it. Put throwaway files in your scratchpad dir, not in the repo.
6. UI rules: mobile-first (360–430px phones) and good at ≥1280px desktop; touch targets ≥44px; use CSS variables from `src/styles/tokens.css` (`--gold`, `--surface`, `--font-display`, …); money is always shown with `formatINR` / `compactINR` from `@shared/format.js`; respect `prefers-reduced-motion`; keyboard accessible (visible focus, Space/Enter on main buttons); no external network assets (fonts come from @fontsource, art is inline SVG/CSS).
7. Final report ≤200 words: what you built, public exports, deviations from this contract, known gaps.

## 1. File ownership **[historical]**
| Owner | Files |
|---|---|
| orchestrator (done) | `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `.dev.vars`, `docs/CONTRACT.md`, `shared/board.js`, `shared/format.js`, `src/styles/tokens.css` |
| **engine** | `shared/engine.js`, `shared/cards.js`, `shared/rng.js`, `shared/bots.js`, `shared/index.js`, `shared/*.test.js`, `scripts/simulate.js` |
| **dice** | `shared/dice.js`, `shared/dice.test.js` |
| **art** | `src/components/art/**`, `public/favicon.svg` |
| **lib** | `src/lib/storage.js`, `src/lib/sfx.js`, `src/lib/messages.js`, `src/lib/session/**` (`usePresenter.js`) |
| **gameui-board** | `src/components/game/{Board,Tile,Pawn,Dice,CenterStage}.jsx`, `src/styles/board.css` |
| **gameui-panels** | every other file in `src/components/game/**` (incl. `GameView.jsx`), `src/styles/game.css` |
| **shell** | `src/main.jsx`, `src/App.jsx`, `src/styles/global.css`, `src/components/shell/**`, `src/pages/{Home,Leaderboard,NotFound}.jsx` |
| **backend** | `wrangler.toml`, `worker/**`, `db/**`, `scripts/migrate.js`, `README.md`, `.github/**`, `public/_headers` |
| **online** | `src/lib/api.js`, `src/lib/auth.jsx`, `src/lib/socket.js`, `src/lib/session/useOnlineGame.js`, `src/components/online/**`, `src/pages/{Login,Friends,Lobby,JoinRoom,OnlineGame}.jsx`, `src/styles/online.css` |

## 2. Board **[corrected]** (`shared/board.js` is the source of truth; spec in `hyderabad-monopoly.md`)
40 tiles on an 11x11 ring, laid out like classic Monopoly. START (tile 0, Rajiv Gandhi Airport) is the bottom-left corner and play runs **clockwise**: up the left column to the Jail corner (10, top-left),
right along the top row to the Irani Chai & Biryani Break corner (20, top-right), down the right column to the Go-to-Jail corner (30, bottom-right), then left along the bottom row back to START. The cheapest plots come right after START.
Exports: `BOARD_SIZE=40`, `GRID=11`, `START_TILE=0`, `JAIL_TILE=10`, `PARKING_TILE=20`, `GO_TO_JAIL_TILE=30`, `MAX_LEVEL=5`, `HOTEL_LEVEL`, `LEVEL_NAMES`, `TRANSPORT_RENT`, `UTILITY_MULT`, `SELL_RATIO`, `START_CASH`, `PASS_START`, `BAIL_FINE`, `TOKEN_CAP`, `LAPS_PER_TOKEN`, `TRAPS_EACH`,
`GROUPS`, `TILES`, `TILE_TYPES`, `GROUP_TILES`, `isBuyable`, `rentFor`, `upgradeCost`, `setMultiplier`, `mortgageValue`, `unmortgageCost`, `taxDue`, `tilePosition(i) -> {col,row}` (11x11 grid, row 0 = top), `tileSide(i)`.
Tile: `{ id, type: start|property|transport|utility|kismet|tax|jail|parking|gotojail, corner?, name, short, price?, group?, rent?, houseCost?, mortgage?, deck?, taxFlat?, taxPercent?, art, emoji, lore }` (no translated names).
Levels: 0 plot, 1 Kirana, 2 Apartments, 3 Mall, 4 Tower, **5 Hotel** (`MAX_LEVEL = 5`). `tilePosition()` is the single source of truth for layout.

## 3. Engine (`shared/*`) **[corrected]**: pure, deterministic, runs in the browser AND the Worker
```js
import { createGame, applyAction, getOptions, canUpgrade, previewRent, netWorth, liquidationValue, standings,
         chooseBotAction, DEFAULT_SETTINGS, SETTING_LIMITS, normalizeSettings, PLAYER_COLORS, KISMET, CITY_EVENTS } from '@shared/index.js';
```
- `createGame({ players:[{id,name,avatar}], settings?, seed? }) -> state` (2-6 players; settings are normalised, see `normalizeSettings`). `players[].isBot` / `bot` still exist in the engine for the simulator; the server never sets them.
- `applyAction(state, action) -> { state, events, error? }`: pure, never mutates the input. An invalid action returns the SAME state, `events: []` and `error: 'message'`.
- `getOptions(state, playerId)`: what that player may do right now (keys listed in `GAME_RULES.md` 8.4). The client computes it locally; it is not sent over the wire.
- `canUpgrade(state, playerId, tileId) -> { ok, reason?, cost }` (Hustle rule: you may only upgrade a district when you own every district of its collection; reason `Own all 3 districts of <collection> first (you have N)`), `previewRent(state, tileId, diceSum=7)`, `netWorth`, `liquidationValue`, `standings(state) -> [{id, cash, worth, rank}]`.
- `chooseBotAction(state, playerId, rnd)`: the move chooser the server uses to auto-play an idle or disconnected seat (and the simulator uses for its bots). `nextBotMove` is the simulator's variant.
- `DEFAULT_SETTINGS = { startCash:15000, goal:70000, passStart:2000, jailTurns:1, bailFine:500, maxRounds:50, dice:'lucky', snatches:1, snatchMs:3000 }`; `PLAYER_COLORS`; `KISMET` (24 cards `{ id, kind, title, text, effect }`); `CITY_EVENTS`.

State, phases, actions and events are specified in `GAME_RULES.md` (sections 3, 7, 8.4-8.6). In short: phases `roll buy snatch auction manage debt over`; **one die** (`state.dice = [d]`), a six rolls again;
passing or landing on START pays `passStart`; owning a whole collection pays 1.5x on level-0 districts and is required before any district of it can be upgraded; stations pay 250/500/1000/2000, utilities 40x / 100x the die;
a skipped tile simply stays free (never an auction); cash shortfalls go to the debt phase, then bankruptcy; you win by net worth >= `goal`, as last player standing, or by being richest when `maxRounds` runs out.
Test-only: if `state.cfg.debug === true`, `ROLL` honours `action.dice = [d]`. The server never sets `debug`.

## 3b. Pre-game settings **[current; the full table is `GAME_RULES.md` section 2]**
The host chooses these BEFORE a game starts. Today the lobby shows only the **end-cash limit** (`goal`, below); the other settings keep their defaults and are not shown (the quick flow is described in the README, "Player flow"):
- **End cash limit** (the winning target) `goal` (net worth, ₹): presets ₹30,000 · ₹50,000 · ₹70,000 (default) · ₹1,00,000, plus a custom stepper. Valid range 10,000–1,000,000 (integer).
- **Round limit** `maxRounds`: **30 · 50 (default) · Unlimited**. Unlimited is `null` (JSON-safe; never `Infinity`). `undefined` means "use the default". Only 30, 50 and `null` are offered in the UI and accepted by the server.
- **Start cash** `startCash`: presets ₹10,000 · ₹15,000 (default) · ₹20,000 · ₹25,000. Valid range 5,000–100,000.
- **One round = every active (non-bankrupt) player has taken one turn.** Extra rolls after a six do not add a round. The counter starts at 1 and shows as "Round 7 / 30" (or "Round 7 · ∞" when unlimited). When the last player of round `maxRounds` ends their turn the game ends and the richest player (net worth) wins, `winReason: 'rounds'`. Reaching `goal` ends the game immediately at any time; "last player standing" also ends it.
- Engine: `DEFAULT_SETTINGS.maxRounds = 50`; `createGame` normalises settings (`null` → unlimited, `undefined` → default, anything else must be a positive integer). `state.cfg.maxRounds` is therefore `number|null`. `display.cfg` mirrors `state.cfg`.
- `session.result` also carries `rounds` (rounds played) and `maxRounds`.
- The lobby shows one summary line: "First to reach ₹70,000 wins".

## 3d. Win target (net worth) **[current; the numbers above that mention `goal` are historical]**
- Host / lobby setting `targetWorth`: `null` (off) or any legal amount (`TARGET_RANGE` = ₹10L - ₹50Cr in steps of ₹5L; the presets are `TARGET_OPTIONS` = `[null, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000]`, `shared/modes.js`). Anything else from a client is sanitised to the mode default (no error). Mode defaults: standard 5000000, quick 5000000, classic 3000000. `null` is refused for a mode without a round limit (classic), so a game always has a way to end (the engine's 60-round cap stays as the last resort). The lobby shows it as "Win target (net worth)" next to the mode; changing the mode resets it to the new mode's default (server: `mergeSettingsPatch` via the adapter hook `mergeSettings`; client: the schema field's `dependsOn`).
- `DEFAULT_SETTINGS` / `ROOM_DEFAULTS` = `{ mode:'standard', ...ruleDefaults('standard') }` (17 keys, section 3e; the retired `auctionOnDecline` is gone and any stored value is ignored). The room view's `settings` is the engine `cfg`: `{ mode, startCash, passStart, targetWorth:number|null, rentPercent, trafficFine, turnSeconds, tradeSeconds, auctionSeconds, maxRounds:number|null, dice, requireFullSet, eventEvery, chaiCap, snatches, snatchMs, snatchCardCap }`.
- Engine: after every applied action `checkWin` ends the game when a non-bankrupt player's `netWorth(state, id) >= cfg.targetWorth` and nothing is pending (no debt, auction or trade): `phase = 'over'`, `winner = id`, `winReason = 'target'`, event `{ type:'win', player, reason:'target', worth }`. Several players over the line: richest, then more cash, then lower seat. `winReason` is now `'last_standing' | 'target' | 'rounds'`; match persistence stores it as `win_reason` text unchanged.

## 3e. Host rules: the settings message and `state.cfg` **[current; the table of keys, bounds and defaults is `GAME_RULES.md` section 2]**
The host customises **every rule of the game** in the lobby: money, timers, board rules and Snatch. One source of truth, `shared/ruleSettings.js`
(also exported by `shared/index.js`): `RULE_FIELDS` (each `{ key, group, label, help, type: 'number'|'choice'|'boolean', unit?, min?, max?, step?, options?, nullable?, default(mode) }`),
`RULE_GROUPS`, `RULE_KEYS`, `ruleDefaults(mode)`, `isRuleValue(field, v)`, `cleanRule(key, v, mode)`, `sanitizeRules(patch, mode)`, `ruleRangeText(field, fmt)`,
`customRuleKeys(settings, mode?)` / `customRuleCount(settings, mode?)` (how many rules differ from the mode defaults) and `ruleWarnings(settings, mode?)`.
- **Wire**: `{ t: 'settings', settings: { ...any subset of the keys below, maxPlayers? } }` (host only, lobby only; `POST /api/rooms { settings }` takes the same keys). Keys: `mode startCash passStart targetWorth rentPercent trafficFine turnSeconds tradeSeconds auctionSeconds maxRounds dice requireFullSet eventEvery chaiCap snatches snatchMs snatchCardCap`.
  An illegal value gets `{ t: 'error', message }` naming the rule and its range (`Decision timer must be a whole number from 15 to 180 seconds in steps of 5.`) and changes nothing; an unknown key is ignored; `targetWorth` is never an error (the mode default replaces an illegal one). A mode change resets only `startCash`, `maxRounds`, `targetWorth` to the new mode's defaults (each unless the same message changes it); every other customised rule is kept.
- **Room view**: `room.settings` carries `mode` and **every rule key** (the defaults filled in for a room stored before a rule existed), for the host and for everyone else.
- **`state.cfg`**: `mode` + the 16 rules, read by the engine for every rule (`passStart` salary, `rentPercent` applied last on every rent, `trafficFine`, `chaiCap`, `dice`, `maxRounds` / `targetWorth`, `eventEvery` 0 = no city events, `requireFullSet`, `startCash`, Snatch). `turnSeconds` / `tradeSeconds` / `auctionSeconds` are read by the room (and by the client clock): the adapter hook `turnMs(state)` replaces the fixed 60 s decision timer, `adapter.deadlines` uses `tradeMsOf(cfg)` for the trade offer and `pending.ms` (`auctionMsOf(cfg)`) for the auction window; helpers `turnMsOf(cfg)`, `tradeMsOf(cfg)`, `auctionMsOf(cfg)`, `snatchBidMsOf(cfg)`, `warnMsFor(turnMs)` in `shared/timing.js`.
- **Listings**: `GET /api/rooms/open` rows carry `customRules` (a count, adapter hook `customRules(settings)`) and, for a table on a non-default map, `map`.
- **Maps (`map`)**: a lobby setting beside `mode`, NOT a rule (not in `RULE_FIELDS`, never counted by `customRuleCount`). `'hyderabad'` (default) or `'andhra'` (`shared/maps.js`, `GAME_RULES.md` section 15). `{ t: 'settings', settings: { map: 'andhra' } }` and `POST /api/rooms { settings: { map } }` accept it; anything else is an error `Map must be one of 'hyderabad', 'andhra'.`. `room.settings.map` and `state.cfg.map` exist ONLY for a non-default map (absent = Hyderabad, also for rooms and games stored before maps): read it with `mapOf(cfg)` / `mapIdOf(cfg)`, never as `cfg.map` alone. `shared/maps.js` exports `MAP_IDS`, `DEFAULT_MAP`, `MAPS` (`{ id, name, te?, tagline, blurb, palette, groups, tiles, terms, decks, events, pieceNames, tokenNames }`), `MAP_LIST`, `mapOf`, `mapIdOf`, `isMapId`, `sanitizeMap`, `applyMap` (CLIENT ONLY: rewrites the display fields of `TILES` / `GROUPS` in place; returns `{ id, version }`), `activeMapId`, `getMapVersion`, `subscribeMap`, and per-map readers `tileName tileShort tileLore tileSkin groupName groupSkin levelNameOf deckName deckCards cardOf cityEventsOf cityEventOf rushFlavourOf monsoonTextOf festivalsOf termsOf pieceNameOf`. The engine and the Worker read names ONLY through these readers (never `applyMap`); the structure (ids, types, prices, groups, fares) is identical on every map.
- **Events**: `traffic` has a new `reason: 'free'` and `amount?` on `paid` (GAME_RULES 8.6).

## 3c. Rules v2 **[corrected]**: Monopoly-grade business logic (details and exact error strings: `GAME_RULES.md`)

**Hotel + set bonus.** `MAX_LEVEL = 5`. Owning EVERY property of a colour doubles the base rent of its unbuilt tiles (`setMultiplier`: full colour x2, anything less x1) and is the only way to build; the even-build rule applies. Event `set_complete {player, group}` fires when a player completes a colour.

**Dice** (`shared/dice.js`; setting `cfg.dice = 'lucky' | 'fair'`, default `'lucky'`). Exactly **one die**. `fair` = each face 1/6. `lucky` = a small, disclosed, bounded bias: comeback help for the player behind, mercy after two big rent turns, a pity six after six non-sixes, an anti-streak brake after two sixes
in a turn; every face's multiplier is clamped to [0.6, 1.5] (`DICE_RULES`). The `dice` event carries `values: [d]` and `assist` (`null | 'comeback' | 'mercy' | 'pity' | 'antibust'`). `diceOdds` / `landingOdds` use the same weights as the real roll (the UI odds overlay).

**Mortgage / sell.** `MORTGAGE`, `UNMORTGAGE` (+10%), `SELL_BUILDING` (refund 50% of the build cost, even-sell rule). Mortgaged tiles collect no rent and block building on their whole colour. Net worth counts a mortgaged tile at price - mortgage value.

**Passing never starts an auction.** `SKIP_BUY` leaves the district free (event `skip { player, tile }`, phase `manage`); a tile the player cannot afford is not offered at all. There is no host rule for this (`auctionOnDecline` is retired: the engine ignores a stored value and `sanitizeSettings` drops it without an error), because declining into an auction let a buyer dodge Snatch, which only opens after a `BUY`. Sealed auctions remain only for the Bazaar Auction corner (`reason: 'bazaar'`) and Snatch bidding (`reason: 'snatch'`).

**Debt phase + bankruptcy to a creditor.** See `GAME_RULES.md` 7.2-7.4: `state.debt = {player, amount, creditor|null, reason, returnPhase, rest}`; the debtor acts out of turn with `MORTGAGE` / `SELL_BUILDING` / `PAY_DEBT` / `RESIGN`; unpayable debts (or `RESIGN`) bankrupt the player: the BANK takes ALL their cash and districts (districts are free again), and a creditor player is paid ONLY the debt, by the bank, up to the player's estate (`estateValue` = cash + `liquidationValue`; exports `estateValue`, `owedPayments`, `bankruptcyPayouts`). The `bankrupt` event may carry `paid: [{to, amount}]`; creditors get a `cash` event reason `bankrupt`. Debts to the bank pay nobody.

**Jail card.** One of the 24 Kismet cards is "Get out of jail free" (`jailCards`, `USE_JAIL_CARD`, `jail` reason `card_used`); it returns to the deck when used.

**Trading.** `TRADE_OFFER {to, give:{cash,tiles}, get:{cash,tiles}}` by the turn player in `roll`/`manage`/`buy` (`tradeBlock` in the engine gives the exact reason when not); one offer at a time; the recipient answers with `TRADE_ACCEPT` / `TRADE_REJECT` / `TRADE_COUNTER {give, get}` (a changed deal that atomically replaces the offer, from the recipient to the proposer, max 5 counters; events `trade_countered` + `trade_offer {counter:true}`), the offerer may `TRADE_CANCEL`. Tiles must be owned by the right side with no buildings in their colour. The server auto-rejects an unanswered offer after 30 s. Auto-play never proposes trades.

**Added later** (specified in `GAME_RULES.md`): Snatch (section 14, simplified; shapes in 3e below), city events (9). Shield, token earning (laps / chai) and traps are gone.

**Implementation notes.** Exports `SETTING_LIMITS`, `normalizeSettings`, `liquidationValue`, `diceCtx`. Players carry `jailCards, sixes, rollsSinceSix, rentStreak, rentThisTurn, lastOfferTurn, snatches, laps, traps`. `PAY_BAIL` needs cash >= `bailFine`, so mortgage first.
**Sealed bids:** `state.pending.bids` holds every bid in clear in the engine; the server masks other players' amounts before sending (`worker/mask.js`, `GAME_RULES.md` 8.7). `auction_end` reveals all bids.

## 3f. Sealed auctions: the process **[current; the rules are `GAME_RULES.md` section 6, the timer 8.8]**
Shapes the client builds against (host rule `auctionSeconds`, 10 - 90 s step 5, default 20, group `timers`; Snatch bidding `min(auctionSeconds, 15 s)`):
```
state.phase = 'auction'
state.pending = { type:'auction', id, tile, minBid,
                  bids: { id: amount }   /*sealed: others' amounts are 0 on the wire; keys = who has a bid in (incl. auto-passes)*/,
                  bidIn: playerId[]      /*PUBLIC: who SUBMITTED a bid (a pass counts; resigned too), amounts stay sealed*/,
                  eligible: playerId[]   /*PUBLIC: who may bid = active players who can afford minBid; Snatch bidding: the claimants who can*/,
                  ms,                    /*the window, ms; the server adds remainingMs (display only) to every view*/
                  reason: 'decline'|'unaffordable'|'bazaar'|'snatch', returnPhase:'manage', snatch?, buyer?, claimants? }
state.auctionSeq                         // auctions started in this game (pending.id)
clock = { deadline: epochMs|null, waitingFor: playerId[] }   // deadline = when the window closes (counted from the end of the animation of the opening action, + 400 ms grace); waitingFor = eligible players without a bid
getOptions(state, me).bid = { tile, min, max } | null
action  { type:'BID', amount }           client, once per player (0 = pass), amount >= minBid and <= cash
action  { type:'AUCTION_CLOSE' }         server only (adapter.deadlines key `auction:<pending.id>`): every active player without a bid passes, then it resolves; a client send fails with "Invalid action."
events  auction_start { tile, minBid, reason, eligible, ms }
        auction_end   { tile, winner: id|null, amount, bids: {id: amount} /*all revealed*/, order: playerId[] /*bidders highest first (winner leads a tie), then passers*/,
                        tie: boolean, reason, saved?: number /*price - amount, only when > 0*/, timedOut?: playerId[] /*passed by the timer*/, buyer?: id /*snatch bidding*/ }
        cash { player, delta: -amount, reason:'auction' }, own { tile, owner, reason:'auction' }      // only with a winner
```
First price: the winner pays their own bid to the bank. A tie for the top bid is drawn with the game's seeded rng among the tied bidders. No valid bid: the district stays unowned (`winner: null`). The last bid resolves the auction at once; otherwise `AUCTION_CLOSE` does at the end of the window. Nobody is auto-played in an auction before the window ends (`idleAction` is null). A resigning bidder passes (`bidIn` updated). The idle auto-play of a human seat is a pass; a simulator bot bids by `auctionBid` (`shared/bots.js`).

## 3e. Snatch **[current; the full rules are `GAME_RULES.md` section 14]**
Every player holds `cfg.snatches` Snatch buttons (default 1; `player.snatches`, public) and can win at most `cfg.snatchCardCap` (default 2) more from Nawabi Luck cards (`player.snatchCards`, public; at the cap the card pays ₹50,000 and its event says so). After a successful `BUY` of a free district on landing, if another active player holds a button, `phase = 'snatch'` for `cfg.snatchMs` (default 5000 ms, plus a 400 ms server grace). Shapes the client builds against:
```
state.phase = 'snatch'
state.pending = { type:'snatch', tile, buyer, price, eligible: playerId[], claims: playerId[] /*redacted: [] or [me]*/, ms, returnPhase:'manage', remainingMs? /*room-added, display only*/ }
getOptions(state, me).snatch   = { tile, ms } | null      // eligible and not pressed yet
getOptions(state, me).snatched = true | undefined         // eligible and pressed ("locked in")
action  { type:'SNATCH' }                 client; sealed (no event, no broadcast, no seq bump; only the presser gets a snapshot)
action  { type:'SNATCH_CLOSE' }           server only (room timer / adapter.deadlines); a client send fails with "Invalid action."
events  snatch_open  { tile, buyer, price, eligible, ms }
        snatch_end   { tile, buyer, outcome:'none'|'snatched'|'bidding', winner?, claimants? }
        snatch_token { player, snatches }                  // a button was spent
        token_earned { player, reason:'card', snatches }   // a button from a Nawabi Luck card
        own          { tile, owner, reason:'snatch' }      // the free district (bidding winners: reason 'auction')
        auction_start{ tile, minBid, reason:'snatch', eligible, ms }   /   auction_end { ..., reason:'snatch', buyer }   (section 3f)
        card         { ..., capped?: true }                // a Snatch card at the cap: text = capText, pays 50,000
```
0 claimants: nothing, the buyer keeps the district. 1: the claimant gets it free and spends 1 button (the buyer is NOT refunded). 2+: sealed bidding among the claimants (the auction machinery, `pending.snatch === true`, `pending.claimants` public); the winner pays the bank and spends 1 button. Auto-play and bots never press (`botSnatchAction` is for the simulator only). `cfg.snatches = 0` turns Snatch off entirely.

## 4. Content data **[removed]**
Voice lines, actors, the story slides, the campaign and the bot rivals (`src/data/*`, `public/voices/**`) no longer exist: the game has no voices or subtitles, no story mode or campaign and no bots.

## 5. Art **[corrected]** (`src/components/art`, import from `@/components/art/index.js`; hub art lives in `src/components/art/hub/`)
Inline SVG React components, flat/isometric style, no assets. Current exports: `Avatar({ preset /*0..11*/, size, ring, className })` + `AVATAR_PRESETS`, `TileIcon({ tile, size })`, `BuildingArt({ level /*0..5*/, color, size })`, `Logo({ size, compact })`, `BrandMark({ size })`.
`CenterArt`, `Scene` and the diorama files were removed with the old centre stage. `public/favicon.svg`.

## 6. Lib (`src/lib`) **[historical, mostly current]**
- **storage.js** — localStorage with try/catch around every access (private-mode safe), tiny subscribe/notify so hooks update.
  `loadSettings()/saveSettings(patch)`, `useSettings() → [settings, update(patch)]`, settings: `{ sfx:true, volume:0.8, reducedMotion:false }` (older persisted objects with extra keys, e.g. the retired voice settings, load fine and the extra keys are ignored).
  `loadProfile()`, `useProfile() → [profile, update(patch)]`, profile: `{ name:'Guest', avatar:0, xp:0, level:1, coins:500, stats:{games,wins,rentEarned,bestWorth,propertiesBought,hotelsBuilt}, lastDailyClaim:null /*'YYYY-MM-DD'*/, dailyStreak:0 }`.
  `levelInfo(xp) → { level, into, need, pct }`; `claimDaily() → { ok, coins, streak }|{ok:false}`. (The offline-game, campaign and match-result helpers were removed with offline play.)
- **sfx.js** — WebAudio synthesised sounds, no asset files: `export const sfx = { unlock(), play(name), setEnabled(b), setVolume(v) }` — names: `click dice step coin pay buy upgrade hotel mortgage trade lucky jail card win lose cheer error`. Respects settings; silent if AudioContext is unavailable.
- **messages.js** — `describeEvent(ev, ctx) → { text, tone:'info'|'good'|'bad'|'warn'|'cheer', tile?, icon? } | null`, `ctx = { players:[{id,name}], me }` (use "You" for `me`). English; tile names from `TILES`. Used by the log and the centre bubble.
- **session/usePresenter.js** — the presenter used by the online game: `usePresenter({ meId, initialState }) → { display, busy, rolling, bubble, stageTile, log, enqueue(events, newState), reset(state) }`.
  `enqueue` replays an event list with timing (dice roll ~900 ms, token steps ~170 ms each, cash popups, card reveal, auction result…), updating `display` as it goes, firing `sfx`, and finally snaps `display` to `newState`. While the queue is non-empty `busy` is true. Calls made during playback are queued in order.
  - `display` = `{ players:[{id,name,avatar,color,cash,pos,jailTurns,bankrupt,isBot}], owners, levels, turn, round, dice:[d], phase, goal, cfg }`.
  - `rolling`: true while the dice animate. `bubble`: `{ text, tone, tile?, id }|null`. `stageTile`: tile id for the centre art (the tile the last mover landed on; default 0).
  - `log`: `[{ id, text, tone, player?, tile? }]` newest last, capped at 200.

### The `session` interface (the ONLY thing `GameView` depends on; `useOnlineGame` returns the same shape)
```js
session = {
  mode: 'online',
  me: playerId,
  view: state,                 // authoritative engine state
  display,                     // from usePresenter (animated, may lag `view`)
  busy, rolling, bubble, stageTile, log,   // from usePresenter
  options,                     // getOptions(view, me), but ALL false/null while `busy` or when it isn't my moment
  dispatch(actionWithoutPlayerId),         // adds playerId = me; no-op while busy
  chat: [{id, from, text, emote?}],
  sendChat(text, emote?),
  result: null | { winner, reason, standings:[{id,name,avatar,cash,worth,rank}], me:{won,rank,worth,rentEarned,propertiesBought} }, // set only after the win presentation finishes
  connection: 'connecting'|'open'|'closed',
  restart(), quit()
}
```

## 7. Game UI **[corrected]** (`src/components/game`)
- `GameView({ session, onExit })` is the whole game screen; it depends only on the `session` interface (section 6). Layout: on wide screens the square board (with the `ControlPanel` in its centre: dice, action buttons, city event banner, Snatch button) next to a scoreboard column (`MoneyBar`, chat); on phones a slim top bar, the board at full width, the scoreboard as a compact list and chat.
- Board = 11x11 CSS grid placed with `tilePosition()`, square, sized with container-query units; 40 tiles with colour header, price tag, owner flag and building level; pawns lift and place tile to tile along `display.players[i].pos`.
- Components: `Board`, `Tile`, `Pawn`, `Dice` (one die), `ControlPanel`, `ActionBar`, `MoneyBar`, `EventBanner`, `PropertySheet` (the tile's deed: rent ladder, owner, build / mortgage / **Set trap here**), `AuctionSheet`, `TradeSheet`, `DebtSheet`, `PlayerSheet`, `MyProperties`, `LogPanel`, `EmoteBar` (Mass, Cheer, Shock, Laugh, Thanks, Hurry, Taunt), `SetCelebration`, `GameOverModal`, `MenuSheet`, `RulesSheet`. English only; no voice, subtitles or translated names.
- Keyboard: Space = roll / confirm main action, Esc closes sheets.
- Guided tours (`src/components/tour`, `game/GameTour.jsx`) are for NEW players only: a tour starts by itself only when `canAutoStart(user)` (tourState.js) is true, i.e. the user has played 0 games (`user.stats.games`, else the sum of `gameStats[*].games`) AND the account is at most 7 days old (`createdAt` if sent, else this browser's `tour:v1:firstSeen` stamp); unknown data counts as not new. The table tour / invite is offered only in the player's FIRST game ever (`firstGameEligible`); when that game starts every auto tour is marked seen for good (`tour:v1:autoDone`), so nothing replays on a later game even after clearing storage. At most one auto hub tour per page load and one invite per session, never during a decision. Explicit starts (the "?" buttons, Menu > Take the tour, Profile > Settings > Replay tutorials) are never gated.

## 8. Routes and shell **[current; hub-level routes are in `MARKETPLACE.md` section 2]**
`App.jsx` (shell) wraps everything in `<AuthProvider>` (from `@/lib/auth.jsx`), `<BrowserRouter>`, and lazy-loads pages. Routes: `/` Home · `/games/:gameId` quick start · `/leaderboard` · `/profile` · `/login` · `/friends` · `/f/:code` · `/lobby/:code` · `/join` and `/join/:code` · `/play/:gameId/online/:code` · `*` NotFound. The old `/story`, `/play`, `/campaign`, `/game/offline` and `/settings` URLs redirect (see `src/platform/paths.js`).
`AppShell` (shell): soft hub backdrop, top bar with logo and profile chip, bottom tab bar on mobile (Home · Play · Friends · Profile) / side or top nav on desktop. The game screens (`/play/**`) render without the shell chrome.
Home (shell): featured-game hero, friends-online strip, browse by category, top players, daily reward. There is no offline mode, story or campaign.
Online pages (owned by *online*): `Login` (Google button via Google Identity Services + "Play as guest"), `Friends` (friend code with copy/share, add by code, requests, online dots, invite to room), `Lobby` (room code, QR via qrcode.react, share link and WhatsApp share, the seat grid, the host's end-cash limit and Start; no bots, ready toggle or visibility picker), `JoinRoom` (enter code → `/lobby/:code`), `OnlineGame` (uses `useOnlineGame(code)` + `GameView`).
`useAuth()` (`src/lib/auth.jsx`): `{ user|null, loading, configured:boolean /*Google client id present*/, loginWithGoogle(), loginGuest(name), logout(), refresh() }` plus `AuthProvider`. Everything that talks to the Worker goes through `src/lib/api.js` (`api.get/post/patch/del`, throws `{status,message}`; returns JSON). If `/api/me` is unreachable (static dev without the Worker), treat the user as signed out and never crash.

## 9. Backend (Worker + Durable Objects + Neon)
- `wrangler.toml` at the repo root: `name = "gamehub"`, `main = "worker/index.js"`, compatibility_date current, `assets = { directory = "./dist", binding = "ASSETS", not_found_handling = "single-page-application", run_worker_first = ["/api/*", "/ws/*"] }`, SQLite-backed Durable Objects `GAME_ROOM` (class `GameRoom`) and `USER_HUB` (class `UserHub`) via `[[migrations]] new_sqlite_classes`. Secrets/vars: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID` (locally from `.dev.vars`).
- **Auth**: `POST /api/auth/google {credential}` verifies the Google ID token (`jose` + Google JWKS `https://www.googleapis.com/oauth2/v3/certs`, check `aud === GOOGLE_CLIENT_ID`, `iss` ∈ {accounts.google.com, https://accounts.google.com}, `exp`, `email_verified`), upserts the user in Neon and sets an HS256 session JWT (30 days) in the httpOnly cookie `hyd_session` (`SameSite=Lax`, `Path=/`, `Secure` on https). Guests: `POST /api/auth/guest {name}` creates a guest user (`isGuest:true`). Guests can play rooms but cannot use friends or the leaderboard.
- **API** (JSON; errors `{error:'message'}` with proper status):
  - `GET /api/config → { googleClientId:string|null, appName }`
  - `POST /api/auth/google`, `POST /api/auth/guest`, `POST /api/auth/logout`, `GET /api/me → { user|null }`, `PATCH /api/me {name?, avatar?}`
  - `user` = `{ id, name, avatar:int, friendCode:'HYD-7K2Q', isGuest, level, xp, coins, stats:{games,wins,bestWorth,rentEarned} }`
  - `GET /api/friends → { friends:[{id,name,avatar,friendCode,online,level}], incoming:[…], outgoing:[…] }`; `POST /api/friends/request {friendCode}` or `{userId}` (same checks and answer `{ok,status:'pending'|'accepted',friend}`; 400 bad id/code or yourself, 404 unknown or guest; a mutual request auto-accepts); `POST /api/friends/accept {userId}`; `POST /api/friends/decline {userId}`; `DELETE /api/friends/:userId` (unfriend or cancel; also pushes `friend_removed` to the other player when a row was removed)
  - Friend discovery (members only, rate-limited, never returns email, Google id or friend code): `GET /api/friends/by-code/:friendCode → { user:{id,name,avatar,level,friendCode,relation} }`; `GET /api/friends/search?q= → { results:[{id,name,avatar,level,equipped,relation}] }` (`q` trimmed, 2-40 chars else 400; case-insensitive name match, prefix matches first then contains, members only, never yourself, max 8); `GET /api/friends/recent → { players:[{id,name,avatar,level,equipped,relation:'none'}] }` (up to 12 distinct members who shared a finished match with you, most recent first, excluding friends and pending requests; `[]` when none). `relation` is `'none'|'friends'|'outgoing'|'incoming'`. Client wrappers: `searchPlayers(q,{signal})`, `getRecentPlayers()`, `requestFriendById(userId)` in `src/lib/api.js`
  - `POST /api/rooms {gameId?, settings?, maxPlayers?, visibility?} → { code, gameId }` (original form: `{settings?, maxPlayers?} → { code }`); `GET /api/rooms/:code → { code, exists, status:'lobby'|'playing'|'finished', players (count), maxPlayers, hostName, isMember, gameId, visibility, settings }`. Marketplace additions (`/api/games`, `/api/rooms/open|mine`, `user_game_stats`): `MARKETPLACE.md` section 7
  - `POST /api/invites {code, userId}` → pushes an `invite` message to that friend's `UserHub`.
  - `GET /api/leaderboard → { rows:[{rank,name,avatar,level,wins,games,bestWorth}] }`
  - Room codes: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Friend codes `HYD-XXXX` from the same alphabet.
- **WebSockets** (cookie-authenticated in the Worker, then forwarded to the Durable Object with trusted headers `X-User-Id`, `X-User-Name`, `X-User-Avatar`, `X-User-Guest`): `GET /ws/room/:code` → `GameRoom` (id = `idFromName(code)`), `GET /ws/user` → that user's `UserHub`. Use the **WebSocket Hibernation API**.
  - **WebSocket room protocol [corrected]**: the complete, current specification (every client and server message, fields, error strings, close codes, the `room` view, the `state` shape, events, redaction, timers, reconnect) is `GAME_RULES.md` section 8. Summary: client -> room `ping`, `settings` (host, lobby), `kick` (host, lobby), `start` (host, >= 2 players), `action {action}` (the server forces `playerId`), `chat {text?, emote?}`, `leave` (the server still accepts the unused `ready` and `visibility` messages); room -> client `pong`, `room`, `state {state, events, seq}` (redacted per recipient; on connect or reconnect `events: []`), `error {message}`, `chat {id, from, name, text, emote, ts}`, `kicked`.
  - Room rules: the server owns the engine (`../shared/engine.js`). There are no bots: every seat is a real player. A player has 60 s per decision; on timeout the server plays the engine's move chooser on their behalf (DO alarms, ~1.5 s between moves) and keeps doing so until they act. Disconnected players are auto-played after 30 s. A pending trade offer is auto-rejected after 45 s. On game over the match is written to Neon (`matches`, `match_players`, `user_game_stats`) and `users` xp/coins are updated (once). Max players 2-6.
  - **Connection strength (wifi bars) [current]**: presence data only, never stored and never part of the game. Client -> room `{t:'net', rtt}`: the member's OWN measured round-trip time in ms (a finite number 0..20000; the room socket pings every 4 s, the client sends the median of the last 3 samples when its level changed or every 10 s; the Worker uses at most one report per 2 s per member and ignores the rest silently, never with an error). Room -> client: every `room.players[i]` carries `net: { q, rtt, stale? }`: `q` 0 = gone (no live socket, or an open socket silent for 30 s), `null` = connected but nothing reported yet ("measuring"), 1..4 = bars from `shared/signal.js` (`<= 90 ms` 4 Excellent, `<= 180` 3 Good, `<= 350` 2 Fair, else 1 Poor, with 12% hysteresis); `stale: true` when the last report is older than 15 s. A `room` message is re-sent only when someone's `q`/`stale` changes (at most one per second, coalesced) or someone connects/disconnects. Kept in `GameRoom` memory (`worker/netpresence.js`), so it is empty again after a hibernation and refills within ~10 s. UI: `src/components/game/ui/SignalBars.jsx` (+ `signalModel.js`, `src/styles/signal.css`); your own bars come from the local measurement (`src/lib/netStats.js`, `useNetStats()`), not from the server's echo.
  - `UserHub` messages → client: `{t:'friend_request',from:{id,name,avatar}}`, `{t:'friend_accepted',by:{…}}`, `{t:'friend_removed',by:{id,name,avatar}}` (the other player unfriended you or cancelled their request; clients refetch and ignore unknown types), `{t:'invite',from:{id,name,avatar},code}`, `{t:'presence',userId,online}`. Presence = the hub has ≥1 live socket.
- **DB** (`db/schema.sql`, idempotent `CREATE TABLE IF NOT EXISTS`; `scripts/migrate.js` applies it using `DATABASE_URL` from `.dev.vars`/env via `@neondatabase/serverless`): `users`, `friendships`, `matches`, `match_players` (+ indexes). Use parameterised queries only. The Worker uses the `neon()` HTTP driver (works in Workers).
- Worker also exports `GameRoom` and `UserHub` classes and falls through to `env.ASSETS.fetch` for everything else.
- `README.md`: how to run locally (`npm run dev` + `npx wrangler dev`), how to migrate, secrets (`wrangler secret put …`), Google OAuth setup, deploy.

## 9b. Voice lines (soundboard) **[current]**
A cosmetic kind `voice`, sold in the shop for coins, **owned-only** (never equipped), playable only by owners, heard by everybody in the room. No schema change: ownership is a `user_items` row like any other item.

* **Catalogue** (`shared/cosmetics.js`): `{ id, kind:'voice', name, price, rarity, icon, emoji, src, durationMs, caption }`.
  * `voice-sheru-bhai`: name `Sheru Bhai`, 900 coins, rare, `icon:'tiger'`, `emoji:'🐯'`, `src:'/audio/voice/sheru-bhai.mp3'` (332 KB), `durationMs:8300`, caption `Sheru Bhai!`.
  * `voice-ladle-meow`: name `Ladle Meow`, 700 coins, rare, `icon:'cat'`, `emoji:'🐱'`, `src:'/audio/voice/ladle-meow.mp3'` (254 KB), `durationMs:6350`, caption `Ladle meow! gop gop gop`.
  * `voice-old-man`: name `Old Man`, 500 coins, rare, `icon:'oldman'`, `emoji:'👴'`, `src:'/audio/voice/old-man.mp3'` (104 KB), `durationMs:2590`, caption `Oye!`.
  * Helpers: `voiceLines()`, `isVoiceId(id)`, `voiceSrc(id)`; `COSMETIC_KINDS` includes `voice`, `EQUIPPABLE_KINDS` does not. The files live in `public/audio/voice/` (Vercel / Vite serve them as static files; the client fetches them lazily, they are not in the bundle and not in the service worker cache).
* **Buying**: `POST /api/shop/buy { itemId }` (price and kind come from the catalogue, never the body); `GET /api/shop` lists the items with `owned`. The client learns what it owns from `GET /api/shop` (`owned: true`). Guests with a session can buy and use them like any cosmetic.
* **Playing** (client -> room, lobby or game, any time, not only on your turn): `{t:'voice', id}`.
* **Broadcast** (room -> EVERY open socket, the sender's included): `{t:'voice', from:<playerId>, id, ts, seq}`. `seq` counts the sender's accepted lines (1, 2, ...), so a client that plays optimistically drops its own echo by `(from, seq)`. Nothing is stored and it is not a game action: no state change, no `seq`/`clock` bump, no turn or idle timer reset, no afk/idle flag cleared.
* **Errors** (to the sender only, `{t:'error', message}`): `Unknown voice line.` (unknown or malformed id), `Buy voice lines in the shop (sign in).` (does not own it), `Voice lines are limited: wait a few seconds.` (cooldown, burst or room cap), `Voice line limit reached for this game.`, `Could not check your voice lines. Try again.` (ownership lookup failed).
* **Limits** (`VOICE_LIMITS`, in memory): per player 3000 ms cooldown, at most 3 in 10 s, 60 per match (the lobby counts separately); whole room at most 6 voice broadcasts per 5 s. The general 40-messages-per-5-s limit also applies.
* **Ownership check**: one `SELECT item_id FROM user_items` per player, cached 60 s; a "not owned" answer is re-read at most every 5 s, so a purchase made mid-game works within seconds.

## 10. Quality bar
It must look like a polished mobile game, not a prototype: consistent tokens, smooth transitions, no layout shift, no text overflow on 360px screens, empty/error/loading states everywhere, no console errors.
