# Nawabi Raj: game rules, state machine and wire protocol (Hyderabad Hustle rules)

This is the authoritative description of the game as it is built. The game keeps its id `hyderabad-tycoon` and its
display name **Nawabi Raj** (renamed from "Hyderabad Tycoon", later "Kingpin"; ids, routes and storage keys are unchanged), and since 2026-11-15 it plays the **Hyderabad Hustle** ruleset (design source:
`Hyderabad_Hustle_Game_Concept.md`, build contract: `docs/HUSTLE_PLAN.md` section 3). It is the contract between the
rules engine (`shared/engine.js` + `shared/{board,cards,events,modes,pieces,dice,bots}.js`), the room server
(`worker/GameRoom.js`, `worker/games/hyderabad-tycoon.js`, `worker/validate.js`, `worker/settings.js`,
`worker/mask.js`) and the client (`src/lib/session/*`, `src/components/game/*`, `src/components/online/*`).
Shield, Traps, lap / chai tokens as Snatch fuel, jail / bail / the Get-Out-of-Jail card, utilities, stations-as-property
and the end-cash goal are **gone**. **Snatch is back in a simpler form** (section 14: one button per player, at most two
more from chance cards, a 5 second window after a purchase).

Contents: 1 fixed decisions · 2 settings, constants and the board · 3 turn flow · 4 dice and movement · 5 squares and
money · 6 auctions · 7 bankruptcy and game end · 8 wire protocol · 9 city events · 10 cards · 11 pieces ·
12 balance and simulation · 13 known discrepancies · 14 Snatch.

## 1. Fixed decisions

* **One die, always.** `state.dice` is a one-element array `[d]` (`[0]` = not rolled yet) and every `dice` event
  carries a one-element array. A **six rolls again** (`state.extraRoll`). The `dice` setting only chooses how the die
  is drawn (`lucky` helps the player behind, `fair` is uniform).
* **Humans only (2-6 per room), online only.** No bots in the product, no pass-and-play. The server *auto-plays* an
  idle or disconnected seat with the engine's move chooser (`shared/bots.js`, see 8.8). Auto-play never rides a
  transport shortcut, never offers trades, and pays its way out of a traffic jam only with comfortable cash.
* **English only.** No voice lines or translated strings.
* **Server authoritative.** Clients send intents, the room forces `playerId`, validates through the adapter allow-list
  and the engine, applies the action and broadcasts `{state, events, seq, clock}`.
* **Heritage rule.** Players buy fictional commercial ventures in each precinct, never the landmarks themselves.
* **Money** is whole rupees. ₹1L = ₹1,00,000. Format with `formatINR` / `compactINR` (`shared/format.js`).

## 2. Settings, constants and the board

The host decides **every rule of the table** (since 2026-11-15): money, timers, board rules and Snatch. The one source of truth
is `shared/ruleSettings.js` (`RULE_FIELDS`, `RULE_GROUPS`, `ruleDefaults(mode)`, `sanitizeRules`, `customRuleCount`): the lobby
renders it (`src/components/online/RulesEditor.jsx`), `worker/settings.js` validates a host patch with it, the engine reads the
result from `state.cfg`. `settings.test.js` fails when the lobby schema and the server drift apart. Keys never change once shipped.

| Key | Group | Legal values | Default (standard / quick / classic) | What it does |
|---|---|---|---|---|
| `mode` | | `'standard'` \| `'quick'` \| `'classic'` | `'standard'` | Picks the **defaults** of `startCash`, `maxRounds` and `targetWorth` (modes table below). |
| `startCash` | money | ₹5,00,000 - ₹10,00,00,000 in steps of ₹1,00,000 | ₹15L / ₹20L / ₹15L | Cash every player starts with. Net worth at the start is this amount, so a win target at or below it ends the game on the first move (the lobby warns about it, `ruleWarnings`). |
| `passStart` | money | ₹0 - ₹10,00,000 in steps of ₹25,000 | ₹2,00,000 | Paid every time a move passes **or lands on** START (once per move; also by a move-to card and a ride). `0` = no salary: no `cash` event, the lap is still counted. |
| `targetWorth` | money | `null` (off) or any amount ₹10,00,000 - ₹50,00,00,000 in steps of ₹5,00,000 (the presets are `TARGET_OPTIONS`: ₹25L, ₹30L, ₹40L, ₹50L, ₹75L, ₹1Cr) | ₹50L / ₹50L / ₹30L | **Win target** (net worth): the first player to reach it wins at once (7.4). Never an error: anything illegal is replaced by the mode default, and `null` too for a mode **without a round limit by default** (classic is never "off"). |
| `rentPercent` | money | 50, 75, 100, 125, 150, 200 | 100 | Scales every rent (see below). |
| `trafficFine` | money | ₹0 - ₹1,00,000 in steps of ₹5,000 | ₹25,000 | Paid to leave the Traffic Jam at once (`PAY_TRAFFIC`). `0` = a free jam: the jammed player is let out when their next turn comes (a `traffic` event `{ stuck: false, reason: 'free' }`), so no pay button exists. The `paid` event carries the `amount`. |
| `turnSeconds` | timers | 15 - 180 seconds in steps of 5 | 60 | The decision timer of the room (8.8): a human who has not acted this long after the last animation is played for. |
| `tradeSeconds` | timers | 15 - 120 seconds in steps of 5 | 45 | An unanswered trade offer is rejected after this (8.8). |
| `auctionSeconds` | timers | 10 - 90 seconds in steps of 5 | 20 | The sealed-auction window (section 6): players who have not bid when it ends pass. Not mode-bound. Snatch bidding (14.5) uses `min(auctionSeconds, 15 s)`. |
| `maxRounds` | timers | `null` (no limit) or 10, 12, 15, 20, 25, 30, 40, 50, 60 | 20 / 12 / `null` | After the last round the richest player wins (`winReason: 'rounds'`). `null` = play to the target; the safety cap `ROUND_CAP` = 60 rounds always stays. |
| `dice` | rules | `'lucky'` \| `'fair'` | `'lucky'` | How the one die is drawn (`shared/dice.js`): lucky nudges whoever is stuck, fair is uniform. |
| `requireFullSet` | rules | boolean | `true` | On: a district can only be upgraded once the player owns **every** district of its collection (reason text `Own all N districts of <collection> first (you have M)`). Off: owning the district is enough (turn, cash, mortgage and level checks still apply). The 1.5x set bonus on first businesses always needs the whole collection. |
| `eventEvery` | rules | 0 (off), 2, 3, 4, 5, 6 | 3 | A city event in every N-th round (never round 1; section 9). `0` = no city events at all. |
| `chaiCap` | rules | 1 - 3 | 1 | Chai tokens a player can hold; at the cap Chai Adda and the free-chai card give nothing. |
| `powerCards` | rules | boolean | `false` | Short-lived Power cards: Shield, Double Rent, Steal a Roll, Swap Tiles (section 16, `docs/POWER_CARDS.md`). Off: no extra state, no extra random draw, seeded games are byte-identical. |
| `snatches` | snatch | 0 - 3 | 1 | Snatch buttons each player starts with; `0` turns Snatch off (section 14). |
| `snatchMs` | snatch | 3000 - 10000 ms in steps of 1000 | 5000 | The Snatch window (section 14). |
| `snatchCardCap` | snatch | 0 - 2 | 2 | Extra buttons one player can win from chance cards per game (section 14.2). |
| `map` | | `'hyderabad'` \| `'andhra'` | `'hyderabad'` | The **map** (section 15): the names, decks and wording of the board. Not a host rule: it is not in `RULE_FIELDS`, `customRuleCount` never counts it, and it is stored only when it is not the default (an absent `map` is Hyderabad). |
| `maxPlayers` | | integer 2 - 6 (room setting, also accepted inside `settings`) | 4 | Seats. |

**`rentPercent` in the engine** (`rentOf`, so `previewRent`, landing rent, the lucky-dice rent look-ahead and the client previews agree): rent =
`round(rentFor(tile, level, fullSet) x city-event multiplier x Cricket-night boost x rentPercent / 100)`. It is applied **last**, then
rounded to whole rupees; the chai threshold (`CHAI_MIN_RENT`) is checked on the scaled bill. The client's static rent ladders take
`cfg.rentPercent` into account (`rentLadder(tile, cfg)`).

A **mode change** (`mergeSettingsPatch`, adapter hook `mergeSettings`) resets only `startCash`, `maxRounds` and `targetWorth` to the new
mode's defaults, each unless the same message changes that rule itself (a value that merely echoes the current one is not a change: the
lobby sends everything). **Every other customised rule is kept.** Anything outside a field's legal values is refused with
one message naming the rule and its range (e.g. `Decision timer must be a whole number from 15 to 180 seconds in steps of 5.`), except
`targetWorth` (see above); unknown keys (`debug`, `seed`, the retired `goal`) are ignored. Settings are host-only
(`Only the host can change settings.`) and lobby-only (`Settings are locked once the game starts.`).

Modes (`shared/modes.js` `MODES`, re-exported by the engine):

| mode | label | rounds | start cash | default win target |
|---|---|---|---|---|
| `standard` | Standard City Hustle | 20 | ₹15,00,000 | ₹50,00,000 (a safety valve: games almost always end by rounds) |
| `quick` | Quick Chai Break | 12 | ₹20,00,000 | ₹50,00,000 (same) |
| `classic` | Classic Long Game | none (`maxRounds: null`; safety cap `ROUND_CAP` = 60) | ₹15,00,000 | ₹30,00,000 (what ends the game, section 12) |

`state.cfg` = `{ mode, ...every rule above except maxPlayers }` = `{ mode, startCash, passStart, targetWorth, rentPercent, trafficFine,
turnSeconds, tradeSeconds, auctionSeconds, maxRounds, dice, requireFullSet, eventEvery, chaiCap, powerCards, snatches, snatchMs, snatchCardCap }`
(`engine.normalizeSettings`; the engine clamps numbers to the wider `SETTING_LIMITS`, so tests and the simulator may go outside the
host bounds; the server enforces the host bounds). Every rule is **read from `state.cfg`** by the engine, with the old constant as the
fallback for a game stored before the rule existed (`PASS_START`, `EVENT_EVERY`, 60 s / 45 s / 20 s). The room stores the full normalised
settings (`mode` plus all 16 rules); `room.settings` (what the lobby shows to the host **and** the guests) is the engine's full `cfg`,
so an older room that lacks a key simply shows (and plays with) its default. Old finished games without `cfg.targetWorth` have no target.
`customRuleCount(settings, mode)` (`shared/ruleSettings.js`) = how many rules differ from the defaults of the mode; open tables carry it
as `customRules` (`GET /api/rooms/open`, 8.10) so the home page can say "Custom rules".

Constants (`shared/board.js`): `BOARD_SIZE` 36, `GRID` 10, `START_TILE` 0, `TRAFFIC_TILE` 9, `CHAI_TILE` 18,
`MUNICIPAL_TILE` 27, `AUCTION_TILE` 32, `TRANSPORT_TILES` [5, 14, 23], `CORNER_TILES`, `MAX_LEVEL` 2, `SET_BONUS.full`
1.5, `RENT_RATIO` 0.1, `LEVEL_RENT_MULT` [1, 2.7, 4.4], `UPGRADE_RATIO` 0.4, `SELL_RATIO` 0.5, `MORTGAGE_RATIO` 0.5, `UNMORTGAGE_INTEREST` 0.1, `START_CASH` 15,00,000,
`QUICK_START_CASH` 20,00,000, `PASS_START` 2,00,000, `TRAFFIC_FINE` 25,000, `CHAI_CAP` 1, `CHAI_MIN_RENT` 20,000,
`MUNICIPAL_BASE` 40,000, `MUNICIPAL_PER_LEVEL` 10,000, `BAZAAR_MIN_RATIO` 0.5, `DECLINE_MIN_RATIO` 0.1.
Helpers: `isBuyable rentTable rentFor(tile, level, fullSet) upgradeCost sellRefund mortgageValue unmortgageCost
levelName(tile, level) nextTransport municipalFor auctionMinBid tilePosition tileSide`.
Deprecated aliases kept so older UI code still builds: `JAIL_TILE` (= `TRAFFIC_TILE`), `HOTEL_LEVEL` (= `MAX_LEVEL`),
`LEVEL_NAMES` (generic `['Business', 'Expanded', 'Flagship']`; use `levelName(tile, level)`).
`shared/events.js`: `EVENT_EVERY` 3 (the default of `cfg.eventEvery`).

### 2.1 The board (36 tiles, clockwise, 10x10 ring)

`tilePosition(i) -> {col,row}` (row 0 = top): START is the **bottom-left** corner; play goes up the left side, right
along the top, down the right, left along the bottom. Corners: 0 START, 9 Traffic Jam (top-left), 18 Chai Adda
(top-right), 27 Municipal Charges (bottom-right). `tileSide(i)` = `left` (0-9) · `top` (10-18) · `right` (19-27) ·
`bottom` (28-35).

| id | tile | type | collection | price / fare |
|---:|---|---|---|---:|
| 0 | START — Namma Hyderabad | start | | |
| 1, 3, 4 | Sultan Bazaar, Monda Market, Begum Bazaar | property | bazaar | 60,000 / 70,000 / 80,000 |
| 2, 21 | Nawabi Luck | card `luck` | | |
| 5 | Auto Stand | transport | | fare 25,000 -> 14 |
| 6, 7, 8 | Laad Bazaar, Charminar Precinct, Chowmahalla Precinct | property | oldcity | 1,00,000 / 1,10,000 / 1,20,000 |
| 9 | Traffic Jam | traffic | | |
| 10, 11, 13 | Malakpet, Mehdipatnam, Tolichowki | property | everyday | 1,40,000 / 1,50,000 / 1,60,000 |
| 12, 30 | City Drama | card `drama` | | |
| 14 | Metro Interchange | transport | | fare 35,000 -> 23 |
| 15, 16, 17 | Sainikpuri, Patny Centre, Paradise Circle | property | twin | 1,80,000 / 1,90,000 / 2,00,000 |
| 18 | Chai Adda | chai | | |
| 19, 20, 22 | Lumbini Park Precinct, Tank Bund, Necklace Road | property | lake | 2,20,000 / 2,30,000 / 2,40,000 |
| 23 | MMTS Express | transport | | fare 45,000 -> 5 (passes START) |
| 24, 25, 26 | Film Nagar, Banjara Hills, Jubilee Hills | property | luxury | 2,60,000 / 2,70,000 / 2,80,000 |
| 27 | Municipal Charges | municipal | | 40,000 + 10,000 per upgrade level owned |
| 28, 29, 31 | Kondapur, Madhapur, HITEC City | property | cyber | 3,00,000 / 3,20,000 / 3,40,000 |
| 32 | Bazaar Auction | auction | | |
| 33, 34, 35 | Gachibowli, Kokapet, Financial District | property | newcity | 3,60,000 / 3,80,000 / 4,00,000 |

Every tile has `name`, `short`, a one-line `lore`, `art` and `emoji`. `GROUPS[g]` = `{ id, name, color, ink, tiles,
levelNames: [L0, L1, L2], theme }` (themes `bazaar food transit venue tech`), e.g. Cyberabad = Startup Office ->
Business Centre -> Tech Campus. Only `property` tiles can be bought (`isBuyable`).

## 3. Turn flow (phases)

`state.phase` is one of: `roll`, `buy`, `snatch`, `auction`, `manage`, `debt`, `over`.

```
roll   --ROLL--> move clockwise, then land:
                   unowned district, cash >= price            -> buy
                   unowned district, cash < price             -> manage (nothing is offered, no auction: the district stays free)
                   district of someone else                   -> rent (debt if short, bankrupt if hopeless)
                   transport stop                             -> manage, state.ride offered
                   Traffic Jam / "stuck" card                 -> stuck, the turn ends at once (extra roll lost)
                   Chai Adda / Municipal / card / Bazaar Auction -> chai / tax / card effect / auction (reason 'bazaar')
roll   (stuck)  --PAY_TRAFFIC | USE_CHAI--> roll (unstuck, roll normally)
roll   (stuck)  --ROLL--> wait: no move, stuck clears, the turn ends
buy    --BUY--> manage            buy --SKIP_BUY--> manage (the district stays free: never an auction)
buy    --BUY--> snatch (if another active player holds a Snatch button; section 14)
snatch --SNATCH_CLOSE (the room's timer, or the last eligible press)--> manage | auction (sealed bidding among the pressers)
manage --RIDE--> manage (moved to the next stop)     manage --END_TURN--> roll of the next active player
manage --ROLL--> ...    (only while state.extraRoll, i.e. after a six)
any    --payment too big--> debt --PAY_DEBT--> returnPhase
```

Also legal in `roll` / `manage` of your own turn: `UPGRADE`, `MORTGAGE`, `UNMORTGAGE`, `SELL_BUILDING`, `TRADE_OFFER`.
Out of turn, anybody may `BID` (auction), `SNATCH` (Snatch window), answer a trade addressed to them, or `RESIGN`; the debtor may mortgage /
sell / pay in `debt`. One **round** = every active player has taken one turn (bonus rolls do not count).
`state.round` starts at 1 and increases when play wraps past the last seat; a city event may start with it (9).
Seat order is shuffled with a CSPRNG when the host presses Start; seat 0 plays first.

## 4. Dice and movement

* ROLL draws one die. Movement is clockwise, tile 35 wraps to 0; passing **or** landing on START pays the salary
  (2,00,000) exactly once per move (rolls, card moves and rides alike) and counts a lap. Moving backwards never pays.
* A six grants one extra roll; three sixes are not special. Getting stuck removes the extra roll.
* **Lucky dice** (`shared/dice.js`, `DICE_RULES`, disclosed in the Rules sheet): comeback (below 0.8x / 0.5x of the
  average net worth: more weight on useful landings, less on landings with rent >= 25% of cash), mercy (after 2 turns
  paying rent >= 20,000: less weight on landings with rent >= 20,000), pity six (after 6 non-sixes a six is 1.5x),
  anti-streak (after 2 sixes in a turn a six is 0.5x); each face is clamped to 0.6x-1.5x before normalising. The
  `dice` event reports the strongest rule in `assist` (or `null`). `fair` is uniform. A stuck player only gets pity
  (their ROLL does not move them; `landingOdds` reports their own tile with probability 1).
* **Transport (5, 14, 23)**: landing sets `state.ride = { player, from, to: nextTransport(from), fare }`. `RIDE` pays
  the fare to the bank (cash reason `fare`), emits `ride` and then a `move` with `ride: true` to the next stop
  (MMTS -> Auto Stand passes START and pays the salary). Arriving has no further effect. The offer ends with
  `END_TURN` or `ROLL`.
* **Traffic Jam (9)** and the "stuck" cards set `player.stuck = true` (`traffic` event, reason `tile` | `card`), the
  extra roll is lost and the turn ends. Next turn, in `roll`: `PAY_TRAFFIC` (`cfg.trafficFine`, 25,000 by default, cash reason `traffic`; with a fine of 0 the jam never holds anyone on their own turn),
  `USE_CHAI` (spends a chai) - then roll normally - or `ROLL` = wait (no dice, no move, `stuck` clears, turn ends;
  `traffic` reason `waited`). Upgrading, mortgaging and trading are allowed while stuck.

## 5. Squares and money rules

* **Buying**: an unowned district you can afford offers `BUY` at its price, or `SKIP_BUY` (**pass**: the district
  simply stays free, emits `skip { player, tile }` and the phase is `manage`; **there is never an auction for a passed
  or an unaffordable district**, the host rule `auctionOnDecline` was retired and old stored values are ignored). The only
  ways to get a free district are a `BUY` (which opens the Snatch window, section 14), the Bazaar Auction below, or a
  trade of a district someone already owns; so nobody can dodge Snatch by declining. A bought district is
  level 0 = its first business (`levelName(tile, 0)`).
* **Rent** = `rentTable(tile)[level]`: base 10% of the price, level 1 = round1000(base x 2.7), level 2 =
  round1000(base x 4.4) (HITEC City 34,000 / 92,000 / 1,50,000). Owning the whole collection pays **1.5x on level-0
  tiles only**. A mortgaged district collects nothing. City events (9) and the owner's "rents x2" card boost
  (`player.rentBoost`, until that player's next turn) multiply on top. `previewRent(state, tile)` gives the exact
  figure the visitor would owe before chai.
* **Upgrades**: `MAX_LEVEL` 2, each costs 40% of the price (24,000 - 1,60,000; always whole thousands). **You may only upgrade a district once you
  own EVERY district of its collection** (all tiles of its `group`, `GROUP_TILES[group]`; today 3 per collection, the check
  is by group size). Ownership is all that counts, so a mortgaged sibling still counts. Then it needs the tile
  unmortgaged, your turn in `roll`/`manage` and the cash: no even-building rule, no limit per turn. Refusal reason:
  `Own all 3 districts of Cyberabad first (you have 1)`. Levels already built stay if the set is later broken (a
  trade, say): only further `UPGRADE` is blocked; `SELL_BUILDING`, mortgage and rent rules are
  unchanged. `SELL_BUILDING` refunds 50% of one upgrade's cost (any order).
* **Mortgage**: 50% of the price, only at level 0 (sell that tile's upgrades first); lifting costs +10%.
* **Chai Adda (18)**: +1 chai (`player.chai`, cap 1; nothing happens at the cap). A chai is spent **automatically** on
  the next rent payment of at least 20,000 (halves it, `chai` event reason `rent` with `saved`, `stats.chaiSaved`), or
  manually with `USE_CHAI` to leave traffic.
* **Municipal Charges (27)**: pay 40,000 + 10,000 per upgrade level you own (`municipalDue`), cash reason `tax`.
* **Bazaar Auction (32)**: if any district is unowned a seeded-random one goes to a sealed auction (reason `bazaar`,
  min bid 50% of its price); the lander bids like everyone. None unowned: nothing.
* **Cards (2, 21 Nawabi Luck; 12, 30 City Drama)**: see 10.
* **Trades** move districts (with their upgrades and mortgages) and cash. Only districts can be traded. Either side may be cash only, a
  district only or both; a side may be empty as long as the deal is not (an outright gift is legal). **District limit (fixed, always on): one trade moves at most `MAX_TRADE_TILES` = 2 districts from each player** (give <= 2 and get <= 2, in an offer, in a counter-offer and again when it is accepted), so nobody can hand over everything they own in one go and wipe the other player out; cash is not limited. Error: `A trade can include at most 2 districts from each player.`; `getOptions().trade.maxTiles` tells the client. **When may I propose one?** On my own turn
  in any quiet moment: before the roll, while deciding about the district I landed on (phase `buy`: the district stays mine to buy or pass
  afterwards), after buying / managing, and on an extra roll (a six). Never during a debt, an auction or a Snatch window, never while another
  offer is open, never when I am the only active player. `shared/engine.js tradeBlock(state, playerId)` is the one rule (it returns the exact
  reason, shown on the Trade button; `getOptions().trade.canOffer` and `TRADE_OFFER` both use it). The answerer may reply at any time, also
  out of turn, also while the table is still animating (the room never drops an action for an animation, and the client sends trade actions
  without waiting for the presenter).
* **Counter-offers** (`TRADE_COUNTER`). The recipient of a pending offer has three answers: accept, reject, or *change the offer*. A counter
  replaces the pending offer in one step (the state never has no trade, or two): the new `state.trade` goes from the recipient to the
  original proposer, with a fresh `id` (so a fresh `tradeSeconds` timer), `counters` (1, 2, ...) and `replaces: { id, give, get }` (the
  replaced deal, kept for the "what changed" view). `give` leaves the sender of the counter, `get` leaves the original proposer; the same
  `tradeProblem` rules apply seen from the recipient's chair. The original proposer now answers (accept / reject / counter again). One
  negotiation allows `MAX_COUNTERS` = 5 counters; then only accept or reject (`Counter-offers are used up (5). Accept or reject`).
  Events: `trade_countered` (old id, `by`) then a normal `trade_offer` with `counter: true`. Resign / bankruptcy cancel it like any offer;
  auto-play never counters.
* **Net worth** = cash + price of each unmortgaged district + (price - mortgage value) for mortgaged ones + 50% of the
  upgrade costs paid (levels x upgradeCost x 0.5) - unpaid debt (the open `state.debt` and its `rest`).
* `liquidationValue` = for each owned district: levels x sell refund + its mortgage value if not mortgaged yet.

### 5.1 Economy of an upgrade (price : upgrade cost : rent)

One ratio set covers all 24 districts (`shared/board.js`): rent level 0 = 10% of the price (`RENT_RATIO`), level 1 = 2.7x and
level 2 = 4.4x that base (`LEVEL_RENT_MULT`, rounded to whole thousands), each of the two upgrades costs 40% of the price
(`UPGRADE_RATIO`, always whole thousands because every price is a multiple of 10,000). Selling an upgrade refunds 50% of its cost
(`SELL_RATIO`, unchanged); net worth counts 50% of the upgrade cost paid, so an upgrade adds 20% of the price to net worth.

**What an upgrade really replaces.** An upgrade needs the whole collection, so the level-0 rent it replaces already carries the
1.5x set bonus (0.15 x price). The fair yardstick is therefore *landings to pay back*: upgrade cost / extra rent per landing.

| step | cost | rent before -> after (x price) | extra per landing | pays back in |
|---|---|---|---|---|
| level 0 -> 1 | 0.40 | 0.15 (set bonus) -> 0.27 | +0.12 | about 3.3 opponent landings |
| level 1 -> 2 | 0.40 | 0.27 -> 0.44 | +0.17 | about 2.4 opponent landings |

(The previous numbers were 0.50 / 0.15 -> 0.19 / 0.35: level 1 took 12-15 landings to pay back and level 2 about 3.) Rounding keeps every
district inside the band: level 1 pays back in 3.2-3.4 landings and level 2 in 2.3-2.5 on all 24 districts, including the cheapest
(`shared/board.test.js` asserts 3-5 and 2-4 for every district, strictly increasing rents, a spread under 0.6, one rent never above
15% of the starting cash). The dearest rent on the board is Financial District at level 2: 1,76,000 (11.7% of the 15,00,000 start).
A district fully built costs 1.8 x price in all and asks 4.4x the rent of a bare one (2.9x a bare full-set one).
A given opponent lands on a given district about once in 36 turns (one die, 36 squares), so with k opponents expect about k/36 landings
per round on one district; a fully upgraded collection (three districts) is hit about k/12 times a round.

Municipal Charges (40,000 + 10,000 per upgrade level) and the Bazaar / Snatch-bidding minimum bids (50% / 10% of the price) are tied to the
price or to levels, not to the upgrade cost, and were left alone: one level's charge is at most 42% of the cheapest upgrade and 6% of the dearest.

| District | Price | Upgrade (each) | Rent L0 / L0 with set / L1 / L2 | Payback L1 / L2 (landings) |
|---|---:|---:|---|---|
| Sultan Bazaar | 60,000 | 24,000 | 6,000 / 9,000 / 16,000 / 26,000 | 3.4 / 2.4 |
| Monda Market | 70,000 | 28,000 | 7,000 / 10,500 / 19,000 / 31,000 | 3.3 / 2.3 |
| Begum Bazaar | 80,000 | 32,000 | 8,000 / 12,000 / 22,000 / 35,000 | 3.2 / 2.5 |
| Laad Bazaar | 1,00,000 | 40,000 | 10,000 / 15,000 / 27,000 / 44,000 | 3.3 / 2.4 |
| Charminar Precinct | 1,10,000 | 44,000 | 11,000 / 16,500 / 30,000 / 48,000 | 3.3 / 2.4 |
| Chowmahalla Precinct | 1,20,000 | 48,000 | 12,000 / 18,000 / 32,000 / 53,000 | 3.4 / 2.3 |
| Malakpet | 1,40,000 | 56,000 | 14,000 / 21,000 / 38,000 / 62,000 | 3.3 / 2.3 |
| Mehdipatnam | 1,50,000 | 60,000 | 15,000 / 22,500 / 41,000 / 66,000 | 3.2 / 2.4 |
| Tolichowki | 1,60,000 | 64,000 | 16,000 / 24,000 / 43,000 / 70,000 | 3.4 / 2.4 |
| Sainikpuri | 1,80,000 | 72,000 | 18,000 / 27,000 / 49,000 / 79,000 | 3.3 / 2.4 |
| Patny Centre | 1,90,000 | 76,000 | 19,000 / 28,500 / 51,000 / 84,000 | 3.4 / 2.3 |
| Paradise Circle | 2,00,000 | 80,000 | 20,000 / 30,000 / 54,000 / 88,000 | 3.3 / 2.4 |
| Lumbini Park Precinct | 2,20,000 | 88,000 | 22,000 / 33,000 / 59,000 / 97,000 | 3.4 / 2.3 |
| Tank Bund | 2,30,000 | 92,000 | 23,000 / 34,500 / 62,000 / 1,01,000 | 3.3 / 2.4 |
| Necklace Road | 2,40,000 | 96,000 | 24,000 / 36,000 / 65,000 / 1,06,000 | 3.3 / 2.3 |
| Film Nagar | 2,60,000 | 1,04,000 | 26,000 / 39,000 / 70,000 / 1,14,000 | 3.4 / 2.4 |
| Banjara Hills | 2,70,000 | 1,08,000 | 27,000 / 40,500 / 73,000 / 1,19,000 | 3.3 / 2.3 |
| Jubilee Hills | 2,80,000 | 1,12,000 | 28,000 / 42,000 / 76,000 / 1,23,000 | 3.3 / 2.4 |
| Kondapur | 3,00,000 | 1,20,000 | 30,000 / 45,000 / 81,000 / 1,32,000 | 3.3 / 2.4 |
| Madhapur | 3,20,000 | 1,28,000 | 32,000 / 48,000 / 86,000 / 1,41,000 | 3.4 / 2.3 |
| HITEC City | 3,40,000 | 1,36,000 | 34,000 / 51,000 / 92,000 / 1,50,000 | 3.3 / 2.3 |
| Gachibowli | 3,60,000 | 1,44,000 | 36,000 / 54,000 / 97,000 / 1,58,000 | 3.3 / 2.4 |
| Kokapet | 3,80,000 | 1,52,000 | 38,000 / 57,000 / 1,03,000 / 1,67,000 | 3.3 / 2.4 |
| Financial District | 4,00,000 | 1,60,000 | 40,000 / 60,000 / 1,08,000 / 1,76,000 | 3.3 / 2.4 |


## 6. Auctions

**Passing never starts an auction.** `SKIP_BUY` (and a district you cannot afford) leaves the district free and moves on
(section 5); `auctionOnDecline` is retired (a stored `auctionOnDecline`, on or off, is ignored by the engine, the room
validation drops it, and it is not a host rule any more). The reason: a buyer could otherwise be dodged by declining into
an auction instead of buying, and the Snatch window (section 14) only opens after a `BUY`. A sealed auction therefore only
exists for the two cases below, neither of which a player can choose to start:

* the **Bazaar Auction** corner (tile 32, reason `bazaar`): landed on by the dice or a card's forward / backward move, a
  random free district, **every** active player may bid (min 50% of the price); no Snatch window follows, it is already an
  all-player contest;
* **Snatch bidding** (reason `snatch`, section 14.5): two or more players pressed Snatch after a `BUY`.

Sealed, simultaneous, **first price**. The state while it is open:

```
pending = { type:'auction', id, tile, minBid,
            bids:     { playerId: amount },   // SEALED: other players' amounts are sent as 0 (8.7)
            bidIn:    playerId[],             // PUBLIC: who has submitted a bid (a pass counts), in the order they did
            eligible: playerId[],             // PUBLIC: who may bid (active players who can afford minBid; Snatch bidding: the claimants who can)
            ms,                               // the bidding window in ms (the host rule auctionSeconds; Snatch bidding min(that, 15 s))
            reason, returnPhase,              // reason 'bazaar' | 'snatch'
            snatch?, buyer?, claimants? }     // Snatch bidding only (14.5)
```

`id` counts the auctions of the game (`state.auctionSeq`); the room keys its timer on it. `bidIn` is what the UI shows as
"Ravi has bid / Sana is thinking": the thinkers are `eligible` minus `bidIn`. Players who cannot afford `minBid` (and, in
Snatch bidding, everybody who is not a claimant) are passed at once: `bids[id] = 0`, **not** in `eligible`, not in
`bidIn`. When nobody can bid the auction ends in the very action that opened it (`auction_start` then `auction_end`,
no `pending`, no timer). The server adds `pending.remainingMs` (<= `ms`, display only, 8.8) to every view.

* **Bids.** `BID {amount}` once per player (0 = pass), `amount` 0 or `>= minBid` and `<= cash`, validated when it is sent.
  Cash cannot change mid-auction (every other action is refused while the phase is `auction`; only `RESIGN` is legal out
  of turn), so a bid is always affordable at resolution; the engine still ignores a bid above cash or below the minimum.
  `minBid` = 10% of the price (rounded to 1,000, at least 1,000) for Snatch bidding, 50% for the Bazaar Auction
  (`auctionMinBid`). Everyone active may bid, including the lander.
* **The window.** `cfg.auctionSeconds` (default 20 s) counted from the end of the animation that opened the sheet (the room
  timer, 8.8), plus a 400 ms grace for a bid sent at the last moment. When it ends the room sends the server-only action
  `AUCTION_CLOSE` (a client send fails with `Invalid action.`): every active player who has not bid passes (bid 0, listed in
  `auction_end.timedOut`) and the auction resolves. The **last bid resolves it at once**; the window is only for the stragglers.
  An AFK or disconnected human is **not** auto-played earlier: they are passed at the window end, never before.
* **Resolution.** The highest valid bid wins and pays **its own bid** to the bank. **Tie** for the top bid: the winner is
  drawn with the game's seeded rng among the tied bidders (counted from the turn player, so a replay of the same seed gives
  the same draw; nobody, not even the lander, is favoured), and `tie: true`. No valid bid: the district stays unowned
  (`winner: null, amount: 0`, the event says so). Afterwards the phase is `returnPhase` (`manage`); a six's extra roll
  (`extraRoll`) is kept and continues, and a turn player who resigned during the auction hands the turn on afterwards.
* **`auction_end`** (8.6): `bids` (every amount, now revealed), `order` = the eligible players ranked highest bid first (the
  winner leads its tie, equal losers in seat order from the turn player) then the passers in seat order; `tie`; `saved`
  = the district price minus the winning bid, only when positive; `timedOut` = the players the timer passed (only when the
  window ran out); `buyer` in Snatch bidding. The presenter's reveal follows `order`.
* **Resigning** mid-auction: their bid becomes 0 and they join `bidIn` (7.3). If they were the last open bidder the auction
  resolves at once. If the game ends because of it (one player left) the auction resolves first.
* **One eligible bidder** is not special-cased: they still decide (bid or pass) within the window, and the timer runs for
  them. Their bid, if any, wins at that price.
* **Bots and auto-play** (`shared/bots.js auctionBid`). A simulator bot values the district at its price x 0.85, x 1.1 when
  it extends a collection it already has a piece of, x 1.2 when winning it stops a rival who owns the other districts of
  the collection from completing it, x 1.6 when it completes the bot's own collection; times the bot's `greed` and a
  seeded +-15% variation (so bots do not all bid the same number); never more than cash minus half its `reserve`
  (it can not bid itself into debt); 0 when that is below the minimum bid; rounded down to 1,000. The auto-play of an idle
  *human* seat is a pass (0), and it only happens when the window ends (`AUCTION_CLOSE`). It never throws.
* The sealed bidding between two or more Snatch pressers (14.5) is the same machinery: `reason: 'snatch'`, only the
  pressers bid, the buyer never takes part, and the window is `min(auctionSeconds, 15 s)`.

## 7. Bankruptcy and game end

### 7.1 Debt phase
A payment (rent, municipal tax, card, wedding-season charge, including the several payees of a "pay every player"
card) that the payer's **cash cannot cover** is handled so:
* cash >= amount: paid at once (`cash` events, creditor gets the money).
* cash < amount but `cash + liquidationValue >= amount`: the game pauses in `phase 'debt'` with
  `state.debt = { player, amount, creditor|null, reason: 'rent'|'tax'|'card'|'event', returnPhase, rest }` and a `debt`
  event. `rest` holds the remaining payments of the same cause, replayed after the debt is settled.
* otherwise: immediate bankruptcy (7.2).

In the debt phase **the debtor acts even when it is not their turn**; only `MORTGAGE`, `SELL_BUILDING`, `PAY_DEBT` and
`RESIGN` are legal (anything else fails with `Raise cash and settle the debt first`). `PAY_DEBT` needs
`cash >= amount` (`Raise ₹X more first`). Auto-play mortgages the cheapest district first, then sells upgrades, then pays.

### 7.2 Bankruptcy
Triggered by an unpayable debt or by `RESIGN` (same rule for both). **The BANK takes ALL the bankrupt player's cash and
EVERY district; the creditor never inherits districts or cash. Only the amount in debt is paid to the creditor, by
the bank, and never more than the assets were worth.**
1. Every upgrade is sold off (`level` events level 0, reason `bankrupt`) and every district goes back to the bank
   (`own` events `owner: null`, reason `bankrupt`; mortgages cleared): the districts are free tiles again, they can be
   bought, auctioned or snatched later. No `liquidate` cash events: the proceeds go to the bank, not to the player.
2. `cash = 0`: the bank takes all of it (no cash event for the seizure).
3. **Estate** = `estateValue(state, id)` = the player's **cash** + `liquidationValue` (the bank's **mortgage value**
   (`mortgageValue`, 50% of the price) of every district that is **not already mortgaged** + the **sell-back value** of
   every upgrade (`level x sellRefund`, `SELL_RATIO` 50% of the upgrade cost)). This is the most the player's assets
   could have raised, so a creditor is never paid more than the assets were worth and no money appears from nothing
   beyond the bank covering the debt out of that worth.
4. The payments the player still owes are paid **in order**: the open debt first (`state.debt.amount` to `debt.creditor`),
   then their other queued payments of the same cause (`debt.rest`, e.g. the next payees of a "pay every player" card).
   Each is paid **in full** while the estate lasts; when it runs out the creditor gets what is left and everyone after
   them gets nothing (the rest is forgiven). `amount = min(owed, estate left)`. One `cash` event per creditor:
   `{ player: creditor, delta: +amount, reason: 'bankrupt', other: bankruptPlayerId }`. The `bankrupt` event lists the same
   payouts in `paid: [{ to, amount }]` (only when somebody was paid), which the log reads ("Ravi went bankrupt: the bank
   took everything; Sana was paid ₹40,000"). The creditor's `rentEarned` / `biggestRent` stats count a paid rent.
5. A debt to the **bank** (municipal charges, a fine, a card or event charge: `creditor null`), a creditor who is
   already out, and `RESIGN` **without a debt** pay nobody: the bank simply keeps everything.
6. Then `stuck` / `chai` / `snatches` / `rentBoost` are cleared, a pending trade of theirs is cancelled (`trade_rejected`
   reason `bankrupt`), a ride offer is dropped, `player.outOrder` records the order of going out, and a `bankrupt`
   event `{ player, reason?: 'resign', paid? }` is emitted. Bankrupt players never act again and are skipped in turn order.
   `set_complete` / win checks are unchanged: nobody gains a district from a bankruptcy.

Because the bank absorbs the assets, the total cash on the table is **not conserved** in a bankruptcy: it falls by the
bankrupt player's cash and rises by what the bank pays the creditor (at most the estate, and never more than the debt).

### 7.3 Resign
`RESIGN` is legal at any time for any non-bankrupt player. It is the 7.2 bankruptcy. In their own debt: the debt and
their queued `rest` payments are paid as in 7.2 (up to the estate), then the other payers' `rest` is replayed. While
another player's debt is open, the resigner's own queued payments in its `rest` are paid out of their estate the same
way and removed from the queue. Without a debt: everything to the bank, nobody is paid. In an auction their bid becomes 0 and they join `pending.bidIn` (section 6). In a Snatch window they are
removed from `claims` and the window keeps running (a resigning buyer loses the district to the bank at once; it can
still be snatched for free, see 14.6). A pending trade involving them is cancelled. `{t:'leave'}` from a running game resigns the player and marks the seat `left`.

### 7.4 Winning (`checkWin`, after **every** applied action)
1. **Last standing** (`winReason 'last_standing'`): at most one non-bankrupt player is left.
2. **Win target** (`'target'`, setting `targetWorth`, `state.cfg.targetWorth` number or `null`): a non-bankrupt
   player's net worth (`netWorth`: cash + printed price of districts (a mortgaged district counts the price minus
   its mortgage value) + 50% of the upgrade cost - unpaid debt) is **at least** the target. It is looked at after every
   applied action, but only when nothing is in flight: no `debt` phase, no `auction` phase and no open `trade`, so
   rent that was just paid has settled (a payee over the line wins with the rent included), and a worth that is only
   high in the middle of a debt, an auction or a trade offer never decides the game; the check runs again as soon as
   that is resolved. Mortgaging a district or selling an upgrade does not change net worth (cash gained = value lost),
   so neither triggers nor dodges the target. If several players are at or over the target at the same moment, the
   **richest** wins (then more cash, then the lower seat), which is always `standings()` rank 1.
3. **Rounds** (`'rounds'`): `state.round > maxRounds` (classic: `> ROUND_CAP` 60), i.e. the moment the last player of
   the final round ends their turn. The **richest** active player wins: highest net worth, then most cash, then seat
   order.

The checks run in that order, so when two apply at once the earlier reason is reported (the winner is the same richest
player for 2 and 3). `targetWorth: null` (only for modes with a round limit) switches 2 off and plays exactly as
before the target existed. A classic game with the target off (engine / simulator only) still stops at the 60-round
cap, so no game can run forever.

There is no end-cash goal any more (the old `goal` setting is retired; the win target replaces it as a net-worth
target). Ending sets `phase 'over'`, clears `pending`, `trade`, `debt`, `ride`, `extraRoll`, fills
`winner` and `winReason`, and emits `{type:'win', player, reason, worth}`. Every later action fails with
`The game is over`. A room nobody is connected to for 5 minutes is **abandoned** (finished, not recorded).

### 7.5 Result and ranks
`standings(state)` = active players by net worth, then cash, then seat; bankrupt players after them, the last to go
out first: `[{ id, cash, worth, rank, bankrupt }]`. Rank 1 is always the winner. The adapter's `result()` is written
once to Neon: `{ winnerId, reason, rounds: min(round, maxRounds ?? 60), standings: [{ id, rank, score: round(net
worth), stats: { rentEarned, hotelsBuilt /* districts raised to level 2 */ } }], legacy: { goal: null, maxRounds,
diceMode, mode } }`. The legacy users columns get best_worth = final net worth and rent_earned.

## 8. Wire protocol

### 8.1 Connection
* `GET /ws/room/:code` (room code = 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, case-insensitive). The Worker requires a WebSocket upgrade
  (`426 Expected a WebSocket upgrade.`), a same-origin `Origin` (`403 Cross-origin request refused.`) and the session cookie, then forwards to the room's
  Durable Object with trusted headers `X-User-Id`, `X-User-Name` (percent-encoded), `X-User-Avatar`, `X-User-Guest`. Clients cannot set these.
* A refusal is delivered as an accepted socket that is closed at once with an application close code (so the client stops retrying):

| Code | Reason text | When |
|---|---|---|
| 4001 | `Please sign in first.` | no valid session (sent by the Worker) |
| 4004 | `That room code is not valid.` | malformed code (Worker) |
| 4004 | `That room does not exist.` | no such room (an `error` message with the same text is sent first) |
| 4004 | `This game is no longer available.` | the room's `gameId` is not registered any more |
| 4003 | `You were removed from this room.` | kicked less than 10 minutes ago |
| 4003 | `This game has already started.` | not a member and the room is not in the lobby |
| 4003 | `This room is full.` | lobby with `maxPlayers` seated |
| 4009 | `replaced` | the user already had 3 open sockets here: the oldest is closed |
| 4003 | `kicked` | after the `kicked` message |
| 4004 | `expired` | after the `error` `This room has expired.` |
| 1000 | `left` / `closed` | after `leave` / normal close |

* **Connecting is joining.** There is no HTTP join call: a non-member who connects while the room is a lobby with a free seat is seated
  (display name and avatar come from the session). A member can reconnect at any time (lobby, playing, finished); their `left` flag is cleared.
* Frames are UTF-8 JSON text, at most 4,096 characters, with a string field `t`. Binary: `error` `Only text messages are supported.`;
  too long: `Message too large.`; bad JSON or no `t`: `Invalid message.`
* Rate limit: more than 40 messages in 5 seconds from one user (pings excluded): `You are sending messages too fast.`
* On accept the server broadcasts `room` to everybody, then (if a game exists) sends `state` with `events: []` to the new socket only.
* When the host starts the game, everybody receives `room` (status `playing`) and then the first `state` (`seq` 1, `events: []`).
* Heartbeat: the client sends `{"t":"ping"}` every 20 s; the Durable Object answers `{"t":"pong"}` from an auto-response without waking up.


### 8.2 Client -> server

| `t` | Fields | Who / when | Errors (`{t:'error', message}`) |
|---|---|---|---|
| `ping` | | anyone | none (reply `pong`) |
| `settings` | `settings`: object with any of `mode targetWorth dice maxPlayers` | host, lobby only. The patch is merged over the current settings and re-validated (a `targetWorth` that is not on the list becomes the mode default, no error; a changed `mode` resets the target, section 2). | `Only the host can change settings.` · `Settings are locked once the game starts.` · `Settings must be an object.` · `Mode must be one of 'standard', 'quick', 'classic'.` · `Dice must be 'lucky' or 'fair'.` · `Players must be between 2 and 6.` · `There are already more players than that.` |
| `piece` | `piece`: one of the adapter's `pieces` (`pearl auto handi chai bat camera`) | any member, lobby only; picks a free piece | an `error` when the piece is taken or unknown |
| `kick` | `id`: user id | host, lobby only. Removes the player and bans them for 10 minutes. | `Only the host can remove players.` · `Players can only be removed in the lobby.` · `That player is not in the room.` · `You cannot remove yourself.` |
| `start` | | host, lobby, at least `minPlayers` (2) seated | `Only the host can start the game.` · `The game has already started.` · `You need at least 2 players to start.` · `Too many players for this room.` · `Could not start the game.` |
| `action` | `action`: object (8.5) | any member while `status 'playing'` | `No game is in progress.` · `Invalid action.` (failed the allow-list) · the engine's reason (for example `Not your turn`) |
| `voice` | `id` (a voice line the sender bought in the shop) | any member, lobby or game, any time (not only on your turn). Errors `Unknown voice line.`, `Buy voice lines in the shop (sign in).`, `Voice lines are limited: wait a few seconds.`, `Voice line limit reached for this game.`; limits: 3 s cooldown, 3 per 10 s, 60 per match per player, 6 per 5 s per room | none (broadcasts `voice`; not an action, resets no timer) |
| `chat` | `text?` (<= 200 chars, control characters stripped), `emote?` (one of `emote_mass emote_cheer emote_shock emote_laugh emote_thanks emote_hurry emote_taunt`) | any member, any status. At most one message per 700 ms per user; floods and empty messages are **silently dropped** | none |
| `leave` | | any member. Lobby: removed from the room (host passes on). Playing: resigns, seat marked `left`. Sockets are closed with 1000. | none |

Common errors for everything except `ping`: `You are not in this room.` (sender is not a member) · `This game is no longer available.` · `Unknown message type.`
(this also answers the retired `addBot` / `removeBot`).

**Legacy, accepted but not used by the shipped client:** `{t:'ready', ready:boolean}` (lobby only; `The game has already started.` / `Invalid ready value.`) sets the
`ready` flag shown in `room.players`; `{t:'visibility', visibility:'private'|'public'}` (host, lobby only; `Only the host can change who can see this room.` /
`Visibility is locked once the game starts.` / `Visibility must be private or public.`). Starting never requires anyone to be ready. See section 13.

### 8.3 Server -> client

| `t` | Payload | When |
|---|---|---|
| `pong` | | reply to `ping` |
| `room` | `room` (below) | on every join, leave, disconnect, reconnect, settings change, piece pick, kick, start, game over and abandon. Not after every action. |
| `state` | `state`, `events`, `seq`, `clock` | after every applied action (to every socket, each with its own redacted view), and once to a socket that connects while a game exists (`events: []`). `clock = { deadline: epochMs\|null, waitingFor: playerId[] }` = when the decision timer (the room's `turnSeconds`, 60 s by default, after the animation) auto-plays. |
| `error` | `message` | a rejected request (8.2), a refused join (8.1) or `This room has expired.` |
| `voice` | `from` (user id), `id` (voice line), `ts` (ms), `seq` (the sender's accepted-line counter) | an owner's voice line (client `voice`, `CONTRACT.md` 9b), to all sockets including the sender; never part of the game state or its timers |
| `chat` | `id`, `from` (user id), `name`, `text`, `emote`, `ts` (ms) | every accepted chat message, to all sockets including the sender |
| `kicked` | | to the removed player's sockets, just before they are closed |

**`room` view:**
```
{ code, status: 'lobby'|'playing'|'finished', hostId, maxPlayers, gameId, visibility: 'private'|'public',
  settings,                      // the engine's full normalised cfg (see 2)
  players: [{ id, name, avatar, ready, connected, piece: string|null, cosmetics: { frame?, dice?, title? } }] }
```
Pieces chosen in the lobby are passed to `createGame` as `players[i].piece`; the engine keeps a requested free piece
and gives everyone else the first free one (11).

### 8.4 The `state` shape (everything the client receives)

```
state = {
  cfg: { mode, startCash, passStart, targetWorth: number|null, rentPercent, trafficFine, turnSeconds, tradeSeconds, auctionSeconds, maxRounds: number|null,
         dice, requireFullSet, eventEvery, chaiCap, snatches, snatchMs, snatchCardCap /* the host rules, section 2 (Snatch 14.1) */ },
  rng: 0, deck: [], deckPos: { luck, drama },     // rng and deck are server secrets: always sent as 0 / [] (8.7)
  round, turn /*index into players*/, turnCount,
  phase: 'roll'|'buy'|'snatch'|'auction'|'manage'|'debt'|'over',
  extraRoll: boolean, dice: [d],                  // [0] = no roll yet
  owners: (playerId|null)[36], levels: number[36] /*0-2*/, mortgaged: boolean[36],
  pending: null | { type:'buy', tile, price } | { type:'auction', id, tile, minBid, bids /*sealed*/, bidIn: playerId[], eligible: playerId[], ms, reason, returnPhase, remainingMs? }
         | { type:'snatch', tile, buyer, price, eligible: playerId[], claims: playerId[] /*redacted*/, ms, returnPhase:'manage', remainingMs? }
         // snatch bidding is an auction: { type:'auction', ..., reason:'snatch', snatch:true, buyer, claimants: playerId[] }  (14.5)
  ride: null | { player, from, to, fare },        // a transport ride on offer to the turn player
  trade: null | { id, from, to, give:{cash,tiles[]}, get:{cash,tiles[]} },   // `give` leaves `from`, `get` leaves `to`
  debt:  null | { player, amount, creditor: playerId|null, reason, returnPhase, rest: [{from,to,amount,reason}] },
  tradeSeq, outCount, auctionSeq,
  event: null | { id, title, text, kind, round, group?, groups?, mult?, upgradedOnly?, amount?, bonus? },   // 9
  winner: playerId|null, winReason: 'last_standing'|'target'|'rounds'|null,
  players: [{ id, name, avatar, color, piece, cash, pos, stuck, chai, snatches, snatchCards, laps, bankrupt, outOrder,
              sixes, rollsSinceSix, rentStreak, rentThisTurn, rentBoost, lastOfferTurn, isBot /*false online*/, bot /*null*/,
              stats: { rentPaid, rentEarned, taxPaid, propertiesBought, upgrades, biggestRent, rides, chaiSaved } }]
}
```
The client computes `getOptions(state, me)` from `shared/engine.js` on the (redacted) view. Keys:
`roll payTraffic useChai buy skipBuy ride endTurn upgrade[] bid mortgage[] unmortgage[] sellBuilding[] debt payDebt
trade tradeOffer tradeSent sets[] resign snatch snatched` (`trade: { canOffer, maxTiles }`; `tradeOffer` also carries `counters, canCounter`; everything false / null / [] when it is not that player's moment).
`roll` is also true while stuck (it means "wait"); `payTraffic` = the fine or `false`; `useChai` boolean;
`ride` = `{ to, fare } | null`; `upgrade[]` = `{ tile, cost, level }`; `bid` = `{ tile, min, max }`;
`sets[]` = `{ group, owned, size, multiplier }`; `snatch` = `{ tile, ms } | null` (an eligible player who has not
pressed); `snatched` = `true` for an eligible player who has pressed (absent otherwise, 14.3). Other queries: `previewRent`, `municipalDue`, `canUpgrade`,
`netWorth`, `liquidationValue`, `standings`.

`seq` starts at 1 when the game starts and grows by one per applied action. The state is always the **full** state.

### 8.5 Client actions (allow-list in `worker/validate.js` `sanitizeAction`)
`playerId` is always overwritten with the socket's user; unknown fields are dropped; anything not listed (including the
retired `PAY_BAIL USE_JAIL_CARD PLACE_TRAP` and `BUY.shield`, and the server-only `SNATCH_CLOSE` / `AUCTION_CLOSE`) fails with `Invalid action.`
Tile fields are integers 0-35.

| `type` | Fields | Legal when | Engine errors (selection) |
|---|---|---|---|
| `ROLL` | | your turn, phase `roll` (while stuck: wait), or `manage` with `extraRoll` | `Not your turn` · `Decide about the district first` · `An auction is in progress` · `You already rolled. End your turn` |
| `PAY_TRAFFIC` | | your turn, phase `roll`, stuck, cash >= `cfg.trafficFine` (25,000 by default) | `You are not stuck in traffic` · `Getting out costs ₹25,000` (the room's fine) · `You can only pay before rolling` |
| `USE_CHAI` | | your turn, phase `roll`, stuck, chai > 0 | `You have no chai token` · `You can only use chai before rolling` |
| `BUY` | | your turn, phase `buy`, cash >= price | `Nothing to buy right now` · `Not enough cash` |
| `SKIP_BUY` | | your turn, phase `buy` | `Nothing to skip right now` |
| `RIDE` | | your turn, phase `manage`, `state.ride` is yours, cash >= fare | `There is no ride to take` · `The fare is ₹X` |
| `UPGRADE` | `tile` | your turn, `roll`/`manage`, own district, **own every district of its collection**, level < 2, unmortgaged, cash >= cost | `Own all 3 districts of Cyberabad first (you have 1)` · `Already a Tech Campus` · `Unmortgage this district first` · `Need ₹X more` |
| `SELL_BUILDING` | `tile` | your district with an upgrade, `roll`/`manage` of your turn or your own debt | `Nothing to sell here` |
| `MORTGAGE` | `tile` | your level-0 district, `roll`/`manage` of your turn or your own debt | `Sell its upgrades first` · `Already mortgaged` |
| `UNMORTGAGE` | `tile` | your mortgaged district, `roll`/`manage` of your turn, cash >= cost | `This district is not mortgaged` · `Need ₹X more` |
| `PAY_DEBT` | | you are the debtor, cash >= amount | `You do not owe anything right now` · `Raise ₹X more first` |
| `END_TURN` | | your turn, phase `manage`, no `extraRoll` | `You cannot end your turn yet` · `You rolled a six. Roll again` |
| `BID` | `amount` (int 0 - 100,000,000; 0 = pass) | auction, once per player | `There is no auction right now` · `You already placed your bid` · `The minimum bid is ₹X` · `You cannot bid more than your cash` |
| `TRADE_OFFER` | `to`, `give`/`get`: `{cash:int>=0, tiles:int[]}` (unique, on board, at most 2 tiles per side, not both empty) | your turn, phase `roll` / `manage` / `buy` (8.8), no other offer open | `You can propose a trade on your own turn` · `Trading opens again when the auction ends` · `Settle the debt before trading` · `Trading opens again when the Snatch window closes` · `Only districts can be traded` · `A trade can include at most 2 districts from each player.` · `You do not have that much cash` |
| `TRADE_ACCEPT` / `TRADE_REJECT` | | the recipient of the pending offer | `There is no trade offer` · `This offer is not for you` |
| `TRADE_CANCEL` | | the offerer | `Only the player who made the offer can cancel it` |
| `TRADE_COUNTER` | `give`/`get` as in `TRADE_OFFER` (no `to`: the proposer is implied) | the recipient of the pending offer, fewer than 5 counters so far | `There is no trade offer` · `This offer is not for you` · `Counter-offers are used up (5). Accept or reject` · the `TRADE_OFFER` deal errors |
| `SNATCH` | | an eligible player who has not pressed, phase `snatch` (14.4) | `There is nothing to snatch` · `You cannot snatch this one` · `You already pressed Snatch` |
| `PLAY_POWER` | `card` (uid), `target?` (player id, swap only) | your turn, phase `roll`, rule on, no card played yet this turn (16) | `Power cards are not enabled` · `Not your turn` · `Play a card before you roll` · `Already played a card this turn` · `You do not hold that card` · `That card has expired` · `Pick a rival to swap with` · `No rival can swap right now` · `This card has no target` |
| `RESIGN` | | any non-bankrupt player, any time (7.3) | `You are out of the game` |

While a trade is pending only the four trade answers (accept, reject, cancel, counter) and `RESIGN` are legal (`A trade offer is waiting for an
answer`); while the phase is `debt` see 7.1; while it is `snatch` only `SNATCH` and `RESIGN` are legal (`Wait for the
snatch window`). `SNATCH_CLOSE` is issued by the room only (14.4), `AUCTION_CLOSE` too (section 6, 8.8): it carries no player. After the game ends: `The game is over`.

### 8.6 Events (`events` in a `state` message, replayed by the client presenter and written to the log)

| `type` | Fields |
|---|---|
| `dice` | `player, values:[d], assist: null\|'comeback'\|'mercy'\|'pity'\|'antibust'` |
| `move` | `player, from, to, path: tile[] (excluding from), passedStart, teleport?, ride?` |
| `land` | `player, tile` |
| `cash` | `player, delta (signed), reason, other?` - reasons `salary rent tax buy upgrade auction card fare traffic liquidate mortgage unmortgage sell trade event` (a transfer emits one event per side; `other` = counterparty) |
| `skip` | `player, tile`: the turn player passed on a free district (`SKIP_BUY`); it stays free, no auction. The log says "X passed on Y". |
| `own` | `tile, owner (id\|null), reason: 'buy'\|'auction'\|'snatch'\|'trade'\|'bankrupt'` |
| `level` | `tile, level, reason: 'upgrade'\|'sell'\|'bankrupt'` |
| `ride` | `player, from, to, fare` (after the fare's `cash`, before its `move`) |
| `traffic` | `player, stuck: boolean, reason: 'tile'\|'card'\|'paid'\|'chai'\|'waited'\|'free'`, `amount?` (the fine, on `paid`). `free` = a jam with `trafficFine` 0: the jammed player is let out when their turn comes (after that turn's `turn` event). |
| `chai` | `player, chai /*new count*/, change: 1\|-1, reason: 'adda'\|'card'\|'rent'\|'traffic', saved? /*rupees saved*/` |
| `card` | `player, cardId, kind: 'good'\|'bad'\|'neutral', deck: 'luck'\|'drama', title, text, capped?` (`capped: true` and the card's `capText` as `text` for a Snatch card at the card cap: it pays 50,000 instead, 14.2) |
| `auction_start` | `tile, minBid, reason: 'bazaar'\|'snatch', eligible: playerId[]` (== `pending.eligible`: who may bid), `ms` (the window) |
| `auction_end` | `tile, winner (id\|null), amount, bids: {id: amount}` (reveals every bid), `order: playerId[]` (bidders highest first, the winner leading its tie, then the passers), `tie: boolean`, `reason`, `saved?` (district price - `amount`, only when positive), `timedOut?: playerId[]` (passed by the timer), `buyer?` (snatch bidding only) |
| `snatch_open` | `tile, buyer, price, eligible, ms` |
| `snatch_end` | `tile, buyer, outcome: 'none'\|'snatched'\|'bidding', winner?, claimants?` (the pressers are revealed only now) |
| `snatch_token` | `player, snatches` (a Snatch button was spent; public) |
| `token_earned` | `player, reason: 'card', snatches` (a Snatch button from a Nawabi Luck card) |
| `city_event` | same fields as `state.event` (emitted before that round's first `turn` event) |
| `mortgage` / `unmortgage` | `player, tile, value` / `player, tile, cost` |
| `set_complete` | `player, group` (held back while a Snatch window is open on the district, 14.6) |
| `debt` | `player, amount, creditor` |
| `bankrupt` | `player`, `reason?: 'resign'`, `paid?: [{ to, amount }]` (who the bank paid, 7.2; absent when nobody was paid). Preceded by `level` / `own` events reason `bankrupt` (owner `null`) and one `cash` event `+amount` reason `bankrupt`, `other` = the bankrupt player, per paid creditor. |
| `trade_offer` / `trade_done` | `id, from, to, give, get` (`trade_offer` after a counter also has `counter: true, counters`) |
| `trade_countered` | `id (the replaced offer), from, to (its proposer / recipient), by (who countered), newId, counters` - always followed by the `trade_offer` of the counter |
| `trade_rejected` | `id, from, to, reason: 'rejected'\|'cancelled'\|'bankrupt'\|'invalid'` |
| `turn` | `player, round` |
| `power_draw` | `player, source: 'tile'\|'turn', tile?` (a Power card was drawn; the card is NOT named, 16) |
| `power_play` | `player, card: 'shield'\|'double'\|'steal'\|'swap', target?` |
| `power_trigger` | `player, card: 'shield'\|'double', amount, other?` (a Shield waived `amount` of a rent / tax; a Double Rent earned `amount` extra; `other` = counterparty) |
| `power_expire` | `player, count` (cards that expired at the start of a round; not named) |
| `win` | `player (id\|null), reason: 'last_standing'\|'target'\|'rounds', worth` (the winner's net worth; for `'target'` it is at least `cfg.targetWorth`) |

Order of a typical roll: `dice, move, (cash salary), land, ...effect`. A stuck turn that waits: `traffic (waited), turn`.

### 8.7 Redaction (what each viewer is not told)
`worker/mask.js` (`adapter.redact`) runs for every recipient. It always returns a copy with the engine secrets removed
(`state.rng` -> `0`, `state.deck` -> `[]`; one stripped copy is cached per authoritative state), so a client cannot
compute the next die, card or city event. **Sealed bids:** while `pending.type === 'auction'`, `pending.bids` keeps
every key but shows `0` for every player except the viewer; `auction_end.bids` reveals all amounts. `pending.bidIn`, `eligible`, `ms` and `remainingMs` are public (who has bid is not a secret, what they bid is). **Snatch presses:**
while `pending.type === 'snatch'`, `pending.claims` is `[viewerId]` if the viewer pressed, else `[]`; a press emits no
event and `snatch_end.claimants` reveals the pressers at the close (once the bidding between two or more pressers starts,
`pending.claimants` is public). Everything else is public (cash, districts, chai, Snatch buttons, stuck, pieces, `deckPos`).

### 8.8 Timers, auto-play and presence (server side, Durable Object alarms)
* **Decision timer, the host rule `turnSeconds` (15 - 180 s, default 60 s = `DECISION_MS` = `TURN_MS`).** Everyone the game is waiting for (the turn player; the debtor in a debt; every
  player who has not bid in an auction (their own window, below); the recipient and the offerer of a pending trade) gets the room's time, counted from when
  the client animation of the last applied action ends (`lastApplyAt + animationMs`). `GameRoom.plan()` asks the adapter hook
  `turnMs(state)` (Tycoon: `turnMsOf(state.cfg)` of `shared/timing.js`; the running game keeps its own rules; an adapter without the hook, or a game stored
  without `cfg.turnSeconds`, gets `TURN_MS`). It is announced in `state.clock`; the client's bar (`src/components/game/turn/clock.js`)
  drains over `cfg.turnSeconds` and its warning starts at `warnMsFor(turnMs)` = 15 s, but never more than half of a short timer.
  A running adapter timer (a pending trade) is *the* timer of what it waits on: the idle move never comes before it. The animation estimate (`estimateAnimMs(events, state?)` in the adapter) uses the presenter's own
  table, `ANIM_MS` / `LONG_TRIP` / `MAX_ANIM_MS` from `shared/timing.js`: dice + afterDice; step x path length (a trip
  longer than `LONG_TRIP` squares hops faster: step x max(0.3, LONG_TRIP / length) per square); teleport; land; rent
  out/in; cash; own; level (x1.5 for level 2); set_complete; mortgage; trade; debt; card; auctionStart / auctionEnd;
  cityEvent; ride; chai; traffic (jail when stuck, jailStay when waited, else quiet); bankrupt; turn (turn, a new
  round max(round, turn), the final round finalRound - this needs the state; without it every turn counts as a new
  round); win; capped at `MAX_ANIM_MS` (24 s). Cards and city events are held for the time it takes to read them (`cardMs` / `eventMs`: about 330 ms a word, 4-9 s for a card, 3.2-7 s for an event). The game start adds 2.5 s. The client's `playbackSpeed` may only make
  playback faster (or 0.75x), so the server never waits less than the speed-1 estimate.
* **A present player is never rushed, and the die never rolls by itself.** When the timer of a *connected* player fires, the
  engine's move chooser plays one move for them and the player is flagged `afk` (a record, not a speed-up). The NEXT decision
  of that player (their next turn included) gets the **full decision timer again**, counted from the end of the animation,
  exactly like anyone else's. It used to be a ~1.5 s pace until the player acted, so a player who was slow once had every later
  roll played for them a moment after their turn began. A decision is never played earlier than `turnSeconds` for a connected player, whatever
  happened on earlier turns, after a trade, a Snatch window or an auction.
* **Away players.** `room.idle[id]` counts the TURNS in a row a connected player let run out without any action (roll + buy + end
  turn of one idle turn are one strike, `room.idleTurn[id]` remembers the turn). From `AFK_STRIKES` (2) strikes on their window is
  shortened to `min(turnSeconds, AFK_TURN_MS = 10 s)`, never to the 1.5 s pace. Any `action` by that player, or a reconnect, clears the
  strikes and the flag (`GameRoom.clearIdle`).
* **Disconnect grace, 30 s.** A member with no open socket is auto-played once 30 s have passed since the last socket
  closed (the idle flag does not shorten it: a flaky connection or a backgrounded tab that comes back within 30 s is never
  played for). Once the grace has run out the room plays for them at the ~1.5 s pace (~400 ms for bids, never faster than the
  animation) until they reconnect, which cancels it.
* **The client never rolls without a press** (`src/components/game/rollGuard.js`): every ROLL path (Roll button, Space / Enter,
  tap on the die, shake, "Wait it out") goes through `guardAction`, which drops a ROLL during the first 450 ms after a Roll was
  offered (the primary slot turned from "End turn" / "Buy" into "Roll" under the finger: ghost click, double tap) and for 1.2 s
  after the last ROLL it sent. Space / Enter never fires inside a text field, a button, an open sheet or dialog, a decision card,
  on key repeat, during IME composition or with Shift / Ctrl / Alt / Meta. Shake-to-roll is off by default.
* **Trade, the host rule `tradeSeconds` (15 - 120 s, default 45 s = `TRADE_MS`).** A pending trade offer is auto-rejected (`TRADE_REJECT` for the recipient) that long after it appears
  (`adapter.deadlines`, `tradeMsOf(state.cfg)`). If the recipient is out of the game the offerer's offer is cancelled after 0.9 s.
* **Snatch window, `pending.ms` (5 s default) + 400 ms grace (`SNATCH_GRACE_MS`).** Counted from the moment the
  `snatch_open` state is sent (`anchor: 'apply'`), not after the animation: the window is real time. The room issues
  `SNATCH_CLOSE` when it ends (an adapter deadline, so it survives Durable Object eviction); nobody is auto-played in it
  (see 14.7).
* **Auction window, the host rule `auctionSeconds` (10 - 90 s, default 20 s; Snatch bidding `min(that, 15 s)`; `pending.ms`) + 400 ms grace (`AUCTION_GRACE_MS`).**
  An ordinary adapter timer (key `auction:<pending.id>`), counted like the trade timer from the end of the animation of the action
  that opened the auction, so the countdown starts when the sheet is on screen. Its start is stored with the room like the Snatch
  timer, so it survives Durable Object eviction and a reconnect. `clock.deadline` is when it fires, `clock.waitingFor` the players who
  have not bid; a bid never moves the deadline. It issues `AUCTION_CLOSE` once (section 6). Nobody is auto-played in an auction
  before it: `idleAction` is null in the auction phase, so an AFK or disconnected bidder is passed at the end of the window only.
* What auto-play does (`idleAction`): in a Snatch window or an auction nothing (it never snatches, and a bidder is passed only by the window's end); a pending trade is rejected / cancelled; otherwise the move chooser buys when its
  heuristic likes the district else skips, bids, lifts mortgages and upgrades when rich, pays a traffic fine only with
  comfortable cash (else waits), rolls, ends the turn, settles debts. It never rides and never proposes a trade.
* **Safety net:** if the engine refuses three automated moves in a row for the same player, that player is resigned.
* **Lobby:** a member with no socket for 60 s is dropped; an empty lobby expires in about 10 minutes.
* **Abandon:** no non-left member connected for 5 minutes while playing: `status 'finished'`, not recorded.
* **Expiry:** 24 h after the last activity the room sends `error` `This room has expired.` and deletes itself.
* **Persistence:** the room record is in Durable Object storage after every change; a finished match is written to
  Neon once (with retries). A stored game from the old rules (40 squares, jail, old snatch) cannot be resumed:
  `upgradeRecord` calls it off (finished, abandoned, unrecorded), drops old snatch timers and replaces old lobby
  settings with the Hustle defaults.

### 8.9 Reconnect and resync
* The client socket (`src/lib/socket.js`) reconnects with exponential backoff (about 0.5 s to 8 s, jittered), also on `online` and tab-visible events, and stops for close codes 1008, 4001, 4003, 4004, 4009.
* On every (re)connect the server sends `room` (to everyone) and then the current redacted `state` with `events: []` to the new socket. The client treats the first state after a connect as a **snapshot**
  (`fresh`): it resets the presenter instead of animating, so nothing plays twice. A `room` message with `status 'lobby'` resets the client's `seq` tracking.
* There is **no resync request**: every `state` is the full state, so a missed message only costs the animation of its events. The client ignores a `state` whose `seq` is not newer than the last one it saw (unless it is a snapshot).
* A member who disconnects keeps their seat for the whole game (lobby: 60 s).

### 8.10 HTTP endpoints of the pre-game flow
All JSON, same origin, cookie session; errors are `{ "error": "message" }`. (Full API table: README.)

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /api/games` | none | `{ games:[{ id, name, minPlayers, maxPlayers, openTables }] }`, cached 5 s |
| `POST /api/rooms` `{ gameId?, settings?, maxPlayers?, visibility? }` | signed in (guest or Google), 10 / min | Creates a room, returns `201 { code, gameId }`. Missing `gameId` = `hyderabad-tycoon`. `maxPlayers` (2-6, default 4) may also be inside `settings`. `visibility` `private` (default) \| `public`. Settings are validated by the adapter, then again by the room. Errors `400`: `unknown game` · `Visibility must be private or public.` · `Settings must be an object.` · `Players must be between 2 and 6.` · the settings messages of 8.2. `502 Could not create the room.` / `503 Could not allocate a room code, please try again.` (up to 8 code collisions are retried). |
| `GET /api/rooms/:code` | optional | `{ code, exists, status, players (count), maxPlayers, hostName, isMember, gameId, visibility, settings }` (zeros / nulls and `exists:false` for an unknown room). `400 Room codes are 6 letters/numbers.` Used by the Join page and by the client to diagnose a failing socket. |
| `GET /api/rooms/mine` | signed in | `{ rooms:[{ code, gameId, status:'lobby'\|'playing', players, maxPlayers }] }` (rooms I am a member of, newest first) |
| `GET /api/rooms/open?game=<id>&limit=20` | none | public lobbies with a free seat, active in the last hour: `{ rooms:[{ code, gameId, hostName, players, maxPlayers, summary?, customRules, createdAt }] }`. `customRules` = how many host rules differ from the stock rules of the table's mode (adapter hook `customRules(settings)` = `customRuleCount`, 0 for a room stored before the rules existed), so the home page can say "Custom rules". |
| `POST /api/invites` `{ code, userId }` | signed-in, non-guest | the inviter must be a member of a lobby and a friend of `userId`; pushes `{t:'invite', from, code, gameId, gameName}` to that friend's `/ws/user` |

Pre-game flow: game page (`/games/:gameId`: pick players, **Create table**) -> `POST /api/rooms` -> `/lobby/:code` (open the socket: connecting seats you) -> host picks the game mode (`settings`), players pick pieces (`piece`) and presses
**Start** (`start`) -> everyone navigates to `/play/:gameId/online/:code` when `room.status` becomes `playing`. A finished room offers "New room, same settings" (a fresh `POST /api/rooms`); a game cannot be restarted in the same room.


## 9. City events ("Hyderabad Rush Hour")

`shared/events.js` exports `CITY_EVENTS`, `EVENT_EVERY = 3` (the default of the host rule `eventEvery`), `RUSH_FLAVOUR`, `FESTIVALS`. When the round counter rises
to a multiple of `cfg.eventEvery` (3, 6, 9, ... by default; 2, 4, 6 ... for 2; never round 1, never after the last round) one event is drawn with the seeded rng and
lasts that round. `cfg.eventEvery` 0 = **no city events at all** (`state.event` stays `null`, no `city_event` event). `state.event = { id, title, text, kind, round, group?, groups?, mult?, upgradedOnly?, amount?,
bonus? }` is public and cleared when the next round begins; `{ type: 'city_event', ...same fields }` is emitted before
that round's first `turn` event.

| id | kind | effect during the round |
|---|---|---|
| `rush_hour` | rent | one random collection that someone owns (else any) pays **1.5x** rent (`group`, `mult` 1.5); title and text per collection (Cyberabad office traffic, Old City shopping, lakefront visitors, cricket crowds, ...) |
| `biryani_boom` | rent | upgraded (level >= 1) districts in `oldcity` + `everyday` pay **2x** (`groups`, `mult` 2, `upgradedOnly`) |
| `wedding_season` | cash | each upgraded, unmortgaged `lake` / `luxury` district pays its owner **20,000** (`bonus`), then every active player pays **30,000** (`amount: -30000`; debt rules apply, reason `event`) |
| `festival` | cash | every active player receives **50,000** (`amount: 50000`); a Bonalu, Bathukamma or Eid festive title and text |
| `monsoon` | rent | one collection (picked like rush hour) pays **half** rent (`group`, `mult` 0.5) |

Rent changes apply through the engine's rent calculation, so `previewRent`, the odds overlay and the UI always agree.

## 10. Cards

Two decks in `shared/cards.js` (`LUCK_CARDS` 21 cards, `DRAMA_CARDS` 18 cards, `DECKS`, `DECK_NAMES`, `cardById`,
`SNATCH_CAP_PAYOUT`).
Each is shuffled with the seeded rng at the start (`state.deck = { luck, drama }`, secret) and reshuffled when it runs
out (`state.deckPos`). A card = one funny hook (`title`), one short sentence (`text`), one effect:

| effect | meaning |
|---|---|
| `cash {amount}` | + from the bank / - to the bank (debt rules apply), reason `card` |
| `moveTo {tile}` | travel clockwise to `tile` (salary when passing START), then that tile takes effect |
| `moveBy {n}` | forwards (salary applies) or backwards (never salary), then that tile takes effect |
| `nextTransport` | travel clockwise to the next Auto / Metro / MMTS stop (a ride is then offered) |
| `stuck` | stuck in traffic where you stand (`traffic` reason `card`), the turn ends |
| `rentBoost {mult}` | your rents x mult until your next turn begins (`player.rentBoost`) |
| `chai` | +1 chai (nothing at the cap), `chai` reason `card` |
| `snatch {amount}` | +1 Snatch button (Nawabi Luck only; 14.2): at most `cfg.snatchCardCap` per player per game, at the cap the card pays 50,000 instead; `token_earned` reason `card` |
| `collectFromAll {amount}` / `payAll {amount}` | every other active player pays you / you pay each of them |
| `perLevel {amount}` / `perProperty {amount}` | pay the bank per upgrade level / per district you own |

The concept doc's six examples are in: Shaadi ka season! (pay 50,000) · Biryani franchise goes viral (+80,000) ·
Ameerpet traffic. Baigan! (stuck) · Cricket night at Uppal! (rents x2) · The landlord wants an advance (pay 35,000) ·
An investor is impressed! (+1,00,000); plus Take the Metro to HITEC City, collect 10,000 from every player, 15,000
per upgrade, a free chai, and more. Card moves never end on another card tile (depth limit 2).

## 11. Pieces

`PIECES` (`shared/pieces.js`, re-exported by `shared/board.js`): `pearl` Pearl · `auto` Auto-rickshaw · `handi`
Biryani handi · `chai` Irani chai glass · `bat` Cricket bat · `camera` Film camera. `createGame({ players:[{ id,
name, avatar, piece? }] })` keeps a requested free piece (seat order decides a clash) and gives everyone else the
first free one; `player.piece` is always set and unique. Player colours are unchanged (`PLAYER_COLORS`).

## 12. Balance and simulation

`node scripts/simulate.js [--games N] [--players 2,4,6] [--modes standard,quick,classic] [--set k=v] [--bot k=v] [--targets off,2500000,...]`
plays bot-only games, checks invariants after every action (cash, ownership, levels, mortgages, phases, debts, ride
offers, unique pieces, winner = rank 1, nobody sits at the win target while the game goes on, a `'target'` win really
is at or above it) and prints balance numbers, including how the games end (win target / round limit / last
standing). `--set targetWorth=null` plays the old rules (target off); `--targets` sweeps a list of targets per mode and player count.
**Bankruptcy checks** (7.2, `checkBankruptcy`): a bankrupt player holds no cash and no district, the `cash` and `bankrupt` events agree on
who was paid, a creditor is never paid to themselves or when out, a resignation pays at most the estate and at most what was
owed, and a rent bankruptcy pays at most the rent. Total money is deliberately not asserted as conserved across a bankruptcy
(the bank absorbs the assets and pays the creditor, 7.2); the auction rule "the table loses exactly the winning bid" is unchanged.
`--resign P` (default 0 = off) makes the debtor, or a random active player, resign with chance `P` per action (a debtor with
at least 0.5) so those paths run in the simulator. 300 games per row, default bots (2026-11-15, after
the whole-collection upgrade rule of section 5):

| mode, players | rounds / turns | districts owned after round 3 / 5 | ended by bankruptcy | final net-worth spread (richest - poorest) | upgrades / game |
|---|---|---|---|---|---|
| standard, 2 | 20 / 40 | 19% / 31% | 0% | ₹2.7L | 1.8 |
| standard, 4 | 20 / 80 | 30% / 49% | 0% | ₹4.3L | 1.9 |
| standard, 6 | 20 / 120 | 40% / 62% | 0% | ₹6.5L | 1.7 |
| quick, 4 | 12 / 48 | 31% / 49% | 0% | ₹3.2L | 1.2 |
| classic, 4 | 60 (cap) / 240 | 31% / 50% | 0% | ₹10.1L | 4.6 |

The table above was measured before the win target existed. With it (section 12.1) the standard and quick numbers are unchanged
(the ₹50L target is never reached), only classic changes.

The standard and quick economies behave as designed: districts sell steadily (about half by round 5 with 4 players)
and the winner ends around ₹21-24L. Before the whole-collection upgrade rule the same bots built 19 / 35 / 47 / 37 / 55
upgrades per game and rents averaged ₹55-65k a payment; now bots rarely complete a collection (they never trade with
each other, only buy and bid), so they build 1-5 upgrades per game, rents average about ₹20k and the net-worth spread
roughly halves. Human tables trade and complete collections far more often, so expect more building there. No numbers
were changed from the concept doc's recommended defaults. Known balance caveat: with ₹2L per lap and these rents nobody is
squeezed out, so **classic games used to run to the 60-round cap** (also with ₹1L laps or aggressive bots), which is why
classic now has a net-worth win target (12.1); the seat that moves first wins a little more often (about 30% in 4-player games).

**Upgrade economy retune (5.1), 300 games per row, default bots, 2026-11-16.** Old numbers (upgrade 50% of the price, rent x1.9 / x3.5) against the
new ones (40%, x2.7 / x4.4): standard and quick still end by the round limit in 100% of the games (20 / 12 rounds), the average rent payment
moves from about ₹0.20-0.22L to ₹0.21-0.23L, bots upgrade about 8% more often (standard 4 players 4.6 -> 5.0 upgrades a game, classic 2 players 7.0 -> 7.8),
classic ends by the win target a little more often (3 players 86% -> 91%, 6 players 99.3% -> 99.7%) and a few percent sooner (3 players 49.2 -> 47.6 rounds,
4 players 46.9 -> 45.4, 6 players 41.7 -> 40.2), bankruptcies stay at 0 per game, seat 1 wins as often as before (4 players 20.3% -> 20.3%,
6 players 16% -> 15%). Stress test with `--set requireFullSet=false` (everyone upgrades everything): average rent ₹0.52L -> ₹0.71L at 4 players,
bankruptcies 0.03 -> 0.12 a game (classic, 4 players) and 0.15 -> 0.33 (6 players), games 1-7 rounds shorter; the first proposal (x2.8 / x5.0, rent 0.5 x price)
gave 0.23 and 0.52 bankruptcies in the same test, so level 2 was trimmed to x4.4.


### 12.1 Win target: how the default was chosen (2026-11-15)

Default bots, 200 games per cell (seeds fixed by the script), classic mode, share of games ending by the win target
(the rest ends at the 60-round cap; nobody ever goes bankrupt, so "last standing" is 0% everywhere), and the average length:

| classic, players | target off (before): by target / avg rounds | ₹25L | **₹30L (default)** | ₹40L | ₹50L | ₹75L |
|---|---|---|---|---|---|---|
| 2 | 0% / 60.0 | 100% / 25.9 | **98.5% / 40.7** | 3.0% / 59.9 | 0% / 60.0 | 0% / 60.0 |
| 3 | 0% / 60.0 | 100% / 33.2 | **87.0% / 50.2** | 1.0% / 60.0 | 0% / 60.0 | 0% / 60.0 |
| 4 | 0% / 60.0 | 100% / 32.5 | **96.5% / 47.7** | 3.0% / 59.9 | 0% / 60.0 | 0% / 60.0 |
| 5 | 0% / 60.0 | 100% / 28.7 | **99.5% / 42.1** | 24.0% / 58.8 | 1.5% / 60.0 | 0% / 60.0 |
| 6 | 0% / 60.0 | 100% / 26.2 | **100% / 39.6** | 35.0% / 57.6 | 5.0% / 59.8 | 0% / 60.0 |

Before the target, 100% of classic games hit the 60-round cap. **Classic defaults to ₹30L**: the largest listed target
that ends at least 87% of the simulated games by target at every player count (₹40L and above mostly run into the cap).
₹25L would end every game and about 13-17 rounds sooner (26-33 rounds) if a shorter classic game is wanted. Winners finish
at about ₹30.4-30.6L (they cross the line by one lap's salary or one rent at most).

Standard and quick keep **₹50L as a safety valve**: in 1,000 simulated games each the target was reached 0 times (winners
end at ₹21-25L after 20 / 12 rounds), so rounds still decide those games. A table can pick a lower target in the lobby to
end earlier, or Off (round-limited modes only; classic can never be Off). Human tables that trade and build will reach
the targets sooner than the bots do, so treat these as upper bounds for game length.

### 12.2 Host-rule extremes (2026-11-15)

`node scripts/simulate.js --extremes [name,...] [--games 60] [--players 2,4,6] [--modes standard,quick,classic] [--set key=value,...]` plays every
preset of the `EXTREMES` list (stock, startCash min / max, passStart 0 / ₹10L, rent 50 / 200 %, turn 15 s / 180 s (no clocks in the simulator: it only
checks that the setting flows into `cfg`), events off / every 2nd round, no full set needed, fine 0 / ₹1L, chai cap 3, 10 / 60 rounds, no round limit
and no target, a custom ₹1.25Cr target, a ₹10L target on ₹5L cash, fair dice, the retired `auctionOnDecline` key (ignored), Snatch off, an "everything hard" and an "everything soft"
table) in every mode and player count and checks the invariants of the engine (**every action: an auction only ever opens for the Bazaar corner or Snatch bidding, and `SKIP_BUY` always ends in `manage` on the same turn**) **plus** "the rule really changed the game": every rule is in
`cfg` as asked (clamped like the engine), everybody starts with `startCash`, every salary equals `passStart` (none when 0), every fine equals
`trafficFine`, a plain landing pays exactly `previewRent` (rent level included) or its chai-halved half, no city event unless `eventEvery` > 0
and only in its rounds, no upgrade without the full collection while `requireFullSet`, no round past `maxRounds` (or the 60-round cap), no
jammed player on their own turn when the fine is 0. `--set` takes any rule key (`requireFullSet=false`, `dice=fair`, `maxRounds=null` ...).

Result of the run of 2026-11-15 (25 presets x 3 modes x 3 player counts x 60 games = 13,500 bot games): **every game ended and every invariant
held.** Things worth knowing: a start cash of ₹10Cr with the default ₹50L target ends the game on the first move (net worth is already above the
target; `ruleWarnings` tells the lobby); a ₹1.25Cr target is never reached by bots inside 60 rounds in classic (the round cap decides); no salary
makes the classic game run to the 60-round cap (about 58 rounds) and a ₹10L salary ends it in about 12; `requireFullSet` off multiplies the upgrades per game (about 19 instead of 3 in a
two-player standard game) and doubles the average rent paid.

## 13. Known discrepancies (open items, not hidden)

1. **Classic mode does not end by bankruptcy in simulation** (12): nobody goes bust. It now ends by the net-worth win target
   (12.1, about 40-50 rounds with the ₹30L default); only 0-13% of the simulated games still hit the 60-round cap.
   A harsher economy for classic only (higher rents, smaller laps) would be a product decision.
2. **`ready` and `visibility` messages are still live on the server although the product has neither** (`worker/GameRoom.js`).
3. **Kick wording.** The kick dialog says the player "can rejoin with the code", but the server bans a removed player for 10 minutes.
4. **A player who left a running game is un-flagged on reconnect** (`handleUpgrade` clears `member.left`).
5. `adapter.animationMs(events, state)` takes the state after the action as an optional second argument; without it
   every `turn` event is timed as a new round (slightly long, never short) and the final-round pause is not known.

## 14. Snatch

### 14.1 Idea and settings
Every player holds **one Snatch button** from the start (`cfg.snatches`, default 1) and can win **at most two more from
Nawabi Luck cards** over the whole game (`cfg.snatchCardCap`, default 2). When a player **buys** a free district on
landing, every other player who still holds a button gets a **5 second window** (`cfg.snatchMs`, default 5000) to press
**Snatch**: the pop-up appears, counts down and goes off. A button is spent only by the player who ends up with the
district. Auto-play and bots never press it.

| Key | Accepted | Default | Notes |
|---|---|---|---|
| `snatches` | integer 0 - 3 | 1 | buttons each player starts with; `0` turns Snatch off entirely (no window, no Snatch cards in the deck) |
| `snatchMs` | integer 3000 - 10000 in steps of 1000 (ms) | 5000 | length of the window, plus a 400 ms server grace |
| `snatchCardCap` | integer 0 - 2 | 2 | buttons one player can win from cards per game; `0` keeps the Snatch cards out of the deck |

The engine reads them from `state.cfg` and falls back to these defaults for a game stored without them (the engine's
own `normalizeSettings` clamps `snatchMs` to 500 - 60,000 for tests and the simulator; the room server enforces the host
ranges above). Shield, traps and lap / chai tokens are gone: the only sources of buttons are the start and the cards.

### 14.2 Snatch cards
Three Nawabi Luck cards (`snatch_tip` "Auction-house tip-off", `snatch_haggle` "Haggle like a Laad Bazaar pro",
`snatch_broker` "The broker saves your number"), effect `{ type: 'snatch', amount: 1 }`. Drawing one gives +1 button
(`player.snatches`, `player.snatchCards` both +1, event `token_earned { player, reason: 'card', snatches }`) while
`snatchCards < cfg.snatchCardCap`. A player at the cap (spent buttons do not free capacity) **collects 50,000
(`SNATCH_CAP_PAYOUT`) instead**; the `card` event then carries the card's `capText` as `text` and `capped: true`. The
cards are only in the shuffled deck while Snatch is on and `snatchCardCap > 0` (`deckOrder`, also used when the deck is
reshuffled). A stacked Snatch card drawn anyway (tests) pays out.

### 14.3 When a window opens, and its state
Only after a successful `BUY` of a free district on landing (also when a card moved the player there, and also on the
extra roll of a six). It does **not** open for auction wins, trades, card effects, mortgages or a skipped district (passing never starts an auction). It
opens only when at least one other active player holds a button; otherwise the buy completes as before.

```
phase: 'snatch'
pending: { type:'snatch', tile, buyer, price /*paid by the buyer*/, eligible: playerId[] /*fixed at the open*/,
           claims: playerId[] /*REDACTED: a viewer only ever sees [] or [viewerId]*/, ms /*= cfg.snatchMs*/,
           returnPhase: 'manage', remainingMs? /*added by the room per viewer: time left, for a reload mid-window*/ }
options.snatch   = { tile, ms } | null     // eligible player who has not pressed
options.snatched = true | undefined        // eligible player who has pressed ("locked in")
```
The buyer has already paid and already owns the district during the window (a crash or reconnect cannot lose the
purchase); resolution moves it if needed. The turn stays with the buyer; `extraRoll` (a six) is kept, so the turn
continues after the window. The set celebration (`set_complete`) is held back until the window closes.

### 14.4 Actions
* `{ type: 'SNATCH' }` (client). Legal only in phase `snatch`, by an eligible player who has not pressed. Pressing is
  **sealed**: it emits no event, is not broadcast and does not change `seq`; only the presser receives a snapshot of
  the state (same `seq`, `events: []`) so their button locks. When every eligible player who is still in the game has
  pressed, the window resolves at once (the same path as the timer).
* `{ type: 'SNATCH_CLOSE' }` (server only, carries no player). Issued by the room when the timer fires. The adapter's
  `sanitizeAction` rejects it from clients (`Invalid action.`); the engine rejects it outside a window
  (`There is nothing to snatch`).
* While the phase is `snatch` every other action is refused with `Wait for the snatch window`, except `RESIGN`.

### 14.5 Resolution
Claimants = `claims` minus bankrupt players (none at all when somebody other than the buyer or the bank now holds the
district).
* **0 claimants**: `snatch_end { outcome: 'none' }`; the buyer keeps the district (then `set_complete` for the buyer).
* **1 claimant**: the district moves to them **for free** and they spend 1 button; **the buyer is not refunded**:
  `snatch_end { outcome: 'snatched', winner, claimants: [winner] }`, `own { reason: 'snatch' }`,
  `snatch_token { player, snatches }`, then `set_complete` for the taker.
* **2 or more**: `snatch_end { outcome: 'bidding', claimants }`, then a sealed auction among exactly the claimants
  (`auction_start { reason: 'snatch', eligible, ms }`, `eligible` = the claimants who can afford the minimum; pending `{ type:'auction', reason:'snatch', snatch:true,
  buyer, claimants, minBid /*10% of the price*/, bids /*non-claimants and the broke pre-passed*/, bidIn, eligible, ms: min(auctionSeconds, 15 s) }`; section 6).
  The winner pays the bid to the bank, gets the district (`own { reason: 'auction' }`) and spends 1 button
  (`snatch_token`); losing claimants keep theirs. No valid bid: the district stays with the buyer, no button is spent.
  `auction_end` carries `reason: 'snatch'` and `buyer`; a window that runs out passes the claimants who have not bid (`AUCTION_CLOSE`, section 6).
Afterwards the phase is `returnPhase` (`manage`).

### 14.6 Resignation, bankruptcy and the end of the game
A resigning presser is removed from `claims` (the window keeps running, and resolves at once if everyone who is left
has pressed). A resigning **buyer** loses the district to the bank at once (`own` owner `null`); the window runs on,
and the free district can still be snatched (or bid for); if nobody presses it stays unowned. The bankrupt turn
player's turn is ended after the window closes (not before). A resignation that leaves one player ends the game at
once (`last_standing`). The win target is only checked once the window has resolved, so a snatched district can win
the game for the taker. Bankrupt players are never eligible and their buttons are zeroed.

### 14.7 Server
`adapter.deadlines(state)` returns, while a window is open, `{ key: 'snatch:<turnCount>:<tile>', afterMs: pending.ms +
SNATCH_GRACE_MS (400), playerId: pending.buyer, action: { type: 'SNATCH_CLOSE' }, anchor: 'apply' }` (`anchor:
'apply'`: the clock starts when the state is sent, not after the animation). Derived from state, so it survives
Durable Object eviction. `turnPlayerId` = the buyer, `pendingPlayerIds` = the eligible players who have not pressed (so
`state.clock.waitingFor` names them and `clock.deadline` is the close time), `idleAction` = null for everyone.
`estimateAnimMs`: `snatch_open` 300 ms (`ANIM_MS.snatchOpen`, the window is the phase, not an animation), `snatch_end`
1,800 ms (`ANIM_MS.snatchEnd`), `token_earned` 1,100 ms, `own` reason `snatch` like a purchase. Win reasons and
settlement are unaffected. Tests: `shared/snatch.test.js` (engine), `worker/snatch.test.js` (timer, sealed presses,
reconnect), the Snatch cases of `shared/fuzz.test.js`; the simulator (`scripts/simulate.js`) plays windows with
`botSnatchAction` and checks the button invariants (never negative, never above `snatches + snatchCardCap`).

### 14.8 Client rules
* The pop-up is driven by the **latest authoritative state** (`session.view`), not the delayed animation display: the
  window is real time. Count down `pending.ms` from when the state arrived, or from `pending.remainingMs` when it is
  present (a reload mid-window); `state.clock.deadline` (with the server's `now`) is the close time. The server decides
  the result.
* A `SNATCH` press is sent at once (not queued behind the animation) and at most once per window; after it the button
  shows "locked in" (`options.snatched`). Everyone else (the buyer, players without a button) sees a status line with
  the same countdown and no button. The scoreboard shows `player.snatches` for everybody.
* Snatch bidding reuses the auction sheet (only the claimants, `pending.claimants`, see a bid form).

## 15. Maps

A **map** is a skin on the one Hustle board. The host picks it in the lobby (setting `map`, section 2); the board, the prices and every rule
stay exactly the same. Everything below lives in `shared/maps.js` (the registry and the helpers) and `shared/maps/andhra.js` (the Andhra data).

| Map id | Name | What it is |
|---|---|---|
| `hyderabad` (default) | Charminar Chaos (was "Hyderabad Hustle") | The board as it always was: Sultan Bazaar to Financial District, Nawabi Luck and City Drama, Chai Adda. Generated from `board.js`, `cards.js` and `events.js`, so the default behaviour is unchanged. |
| `andhra` | Andhra Aatalu (ఆంధ్ర ఆటలు) | Built from `Andhra_Empire_Game_Concept.md`: the 24 destinations of the concept in its 8 collections, Mana Adrushtam and Oori Kaburlu decks, Andhra city events, the concept's palette. |

### 15.1 What never changes between maps

36 tiles with the same ids, types and positions (START 0, Traffic Jam 9, the corner 18, the corner 27, the auction 32, the transport tiles 5 / 14 / 23, the card tiles
2 / 12 / 21 / 30); the 24 districts on the same slots with the **same per-slot price ladder** (₹60,000 on slot 1 ... ₹4,00,000 on slot 35); the same rents, upgrade
costs, fares, mortgage values, Snatch, auctions, trading, bankruptcy and win rules; the same eight collection ids (`bazaar oldcity everyday twin lake luxury cyber newcity`)
over the same slots `[1,3,4] [6,7,8] [10,11,13] [15,16,17] [19,20,22] [24,25,26] [28,29,31] [33,34,35]`. The engine is map-agnostic: it never looks at a name.
Andhra deliberately keeps this proven price ladder instead of the concept's 40-space board with its ₹60,000 to ₹5,20,000 ladder, and the economy constants of
`board.js` (rent ratio, level multipliers, upgrade ratio) are shared too, so every balance result carries over.

### 15.2 What a map changes (display only)

* **Tiles:** `name`, `short` (at most 14 characters), `lore`, `emoji`, optional `te` (Telugu) and `lines` (phone-board label lines).
* **Collections:** `name`, `color`, `ink` (AA contrast 4.5:1), three `levelNames`, optional `te`, optional `identity` (the one-line blurb on the deed sheet; every map of the repo has one; the client writes it onto the shared `GROUPS` only for a non-default map). A collection id is a slot, so on Andhra `oldcity` means "Andhra Crafts".
* **Words (`terms`):** the token (chai token on Hyderabad, festival token on Andhra: same mechanic, `CHAI_MIN_RENT` halving, same cap), and the corner names.
* **Decks:** `decks.luck` / `decks.drama` = `{ id, name, te?, cards }`, same effect kinds, same sizes (21 and 18) and the same three Snatch cards.
* **City events:** the same five events (same ids, kinds, groups, multipliers and amounts) in the map's wording.
* **Palette and token names** (for the UI): `palette`, `pieceNames`, `tokenNames`.

### 15.3 The Andhra Aatalu board (slot: name, collection, price)

| Slot | Tile | Collection | Price / fare |
|---:|---|---|---:|
| 0 | START, Andhra Yatra | | salary |
| 1 | Chirala | Towns & Markets | ₹60,000 |
| 2 | Mana Adrushtam | luck deck | |
| 3 | Ongole | Towns & Markets | ₹70,000 |
| 4 | Nellore | Towns & Markets | ₹80,000 |
| 5 | Visakhapatnam Port | transport (ride) | fare ₹25,000 |
| 6 | Kondapalli | Andhra Crafts | ₹1,00,000 |
| 7 | Machilipatnam | Andhra Crafts | ₹1,10,000 |
| 8 | Mangalagiri | Andhra Crafts | ₹1,20,000 |
| 9 | Traffic Jam | corner | |
| 10 | Amalapuram | Godavari Gold | ₹1,40,000 |
| 11 | Kakinada | Godavari Gold | ₹1,50,000 |
| 12 | Oori Kaburlu | drama deck | |
| 13 | Rajamahendravaram (Rajahmundry) | Godavari Gold | ₹1,60,000 |
| 14 | Vijayawada Junction | transport (ride) | fare ₹35,000 |
| 15 | Srikakulam | Uttarandhra | ₹1,80,000 |
| 16 | Vizianagaram | Uttarandhra | ₹1,90,000 |
| 17 | Visakhapatnam (Vizag) | Uttarandhra | ₹2,00,000 |
| 18 | Sankranti Fair | corner: take a festival token | |
| 19 | Araku Valley | Nature & Heritage | ₹2,20,000 |
| 20 | Lepakshi | Nature & Heritage | ₹2,30,000 |
| 21 | Mana Adrushtam | luck deck | |
| 22 | Gandikota | Nature & Heritage | ₹2,40,000 |
| 23 | Tirupati Airport | transport (ride) | fare ₹45,000 |
| 24 | Kadapa | Rayalaseema | ₹2,60,000 |
| 25 | Anantapur | Rayalaseema | ₹2,70,000 |
| 26 | Kurnool | Rayalaseema | ₹2,80,000 |
| 27 | Road Toll | corner: flat fee + per upgrade | ₹40,000 + ₹10,000 per level |
| 28 | Srikalahasti | Spiritual Andhra | ₹3,00,000 |
| 29 | Srisailam | Spiritual Andhra | ₹3,20,000 |
| 30 | Oori Kaburlu | drama deck | |
| 31 | Tirupati | Spiritual Andhra | ₹3,40,000 |
| 32 | Mirchi Market Auction | auction tile (half-price minimum bid) | |
| 33 | Guntur | Capital & Commerce | ₹3,60,000 |
| 34 | Vijayawada | Capital & Commerce | ₹3,80,000 |
| 35 | Amaravati | Capital & Commerce | ₹4,00,000 |

The collections follow the concept's collections table in its order, laid on the board's slots by ascending price (so the cheapest collection is first after START, as on every map).
The prices here are the per-slot ladder, not the concept's (the concept's Chirala ₹60,000 ... Amaravati ₹5,20,000 on a 40-space board). Collection colours come from the concept's palette
(deep indigo, terracotta, turmeric yellow, river green, coastal blue, antique cream) with an AA-contrast ink on each. The heritage rule of the concept holds: for a temple, fort or
monument town the thing you buy is a fictional local business (the lore says so), never the landmark.

### 15.4 Deviations from the concept (and why)

* **36 tiles, not 40.** The board structure is shared with the Hyderabad map. The concept's fourth transport hub (Rajahmundry Airport), its two utilities (Krishna River Ferries,
  Coastal Solar Utility) and its second Road Block / Festival Contribution tiles have no slot. Hubs are the three ride tiles (Visakhapatnam Port, Vijayawada Junction, Tirupati
  Airport); Road Toll and Festival Contribution are one tile (the flat fee plus a contribution per upgrade); "Road Block" is the Traffic Jam corner.
* **Same economy.** The salary, start cash, rents, upgrade costs and per-slot prices are the Hustle's. The concept's own numbers (₹15 lakh start, ₹2 lakh salary) are already the Hustle's.
* **Cards with no engine analogue use the nearest existing effect** (no new mechanics): *Sankranti Homecoming* ("double one transport rent") is `rentBoost x2` (your rents are doubled until
  your next turn); *Smart Investment* ("₹40,000 off one upgrade") is `cash +40,000`; *Power Cut!* ("forgo your next rent collection") is `cash -30,000`. *Business Expansion* pays ₹1,00,000
  instead of ₹1,25,000 (the Hyderabad luck deck pays at most ₹1,00,000 a card). The decks are topped up to the Hyderabad sizes (21 luck cards with the three Snatch cards, 18 drama cards
  with two good ones) with the same effect mix, and the average cash of a card stays within 30% of the Hyderabad deck (`shared/maps.test.js`).
* **The advanced modules are not built** (Sankranti Business Boom as a phase, Mirchi Market investments, craft objectives, coastal contracts, the transport-hub shortcut for ₹20,000,
  the upgrade discount). The city events carry their flavour instead: *Sankranti Boom* (upgraded Andhra Crafts and Godavari Gold pay double), *Tourism Season* (everyone pays
  ₹30,000, upgraded Nature & Heritage and Rayalaseema businesses earn ₹20,000), *Mirchi Market Swing* (one collection pays half rent), the regional "Boom" events (including *Coastal Trade*), and Sankranti / Ugadi / Dasara festive bonuses.
* **Telugu** is given only where it is certain: the title, the two decks, the 24 destinations, the Sankranti Fair and two collection names; every other name has no `te`.

### 15.5 Where the map lives (`cfg.map`)

* **Settings.** `map` is a lobby setting beside `mode` and the rules, validated by `worker/settings.js` (`sanitizeSettings`: `'hyderabad'` or `'andhra'`, anything else is an error
  `Map must be one of 'hyderabad', 'andhra'.`). It is stored only for a non-default map; `normalizeSettings` drops `'hyderabad'`. A host patch keeps it (a mode change does not reset it).
* **`state.cfg.map`.** `createGame` stores `cfg.map = 'andhra'` for an Andhra game. A default game has **no** `cfg.map` key, and neither has a game stored before maps existed:
  always read it with `mapOf(cfg | state | settings)` / `mapIdOf(...)`, which fall back to Hyderabad.
* **The engine** reads names and texts through the map (`mapOf(state.cfg)`): the decks it shuffles and draws (`deckCards`), the city events (`cityEventsOf`, rush-hour / monsoon / festival
  wording), the refusal texts (`levelNameOf`, `groupName`, `tileName`, `termsOf(...).chaiUse` / `chaiToken`). It never calls `applyMap`.
* **The client** calls `applyMap(cfg)` once it knows the map (lobby settings, `state.cfg`): it rewrites the display fields of the shared `TILES` / `GROUPS` in place so every module that
  imports them shows the active map, and returns `{ id, version }` (the version grows on every change; use it as a React key). Do not call it in the Worker (a Durable Object serves many rooms).
* **Listings.** `summarize` appends " · Andhra Aatalu map" for a non-default map, and `GET /api/rooms/open` rows carry `map` (only when it is not the default).
* **Simulation.** `node scripts/simulate.js --map andhra` (or `--map all`) plays bot games on the map with every invariant, including "every card and city event belongs to the map".

## 16. Power cards

An optional rule (`cfg.powerCards`, default off; the spec with the UX is `docs/POWER_CARDS.md`, the metadata and tuning in `shared/powerCards.js`, the rules in `shared/engine.js`).

* **State** (only when on): `state.prng` (uint32, secret; derived from the seed with a fixed XOR constant), `state.powerPlayed`, and per player `hand: [{ uid, id, exp }]` (at most 2, `exp` = the last round
  it can be played = round drawn + 3), `shield` and `doubleRent` (the round the armed effect lasts to, 0 = none). Read all of them with fallbacks: a stored game lacks them.
  Cards use their OWN random stream: the board stream `rng` never draws for a card, so the rule never shifts a dice roll, deck or event, and with the rule off the engine makes no extra draw at all.
* **Draw sources** (`drawPower`): a card tile always draws one (after the Luck / Drama card, `power_draw source:'tile'`); at the START of a turn (`endTurn`, after the round start and the `turn` event, so in phase `roll`)
  the new turn player draws with a chance of `POWER.TURN_START_CHANCE` (0.06), `POWER.TRAILING_CHANCE` (0.15) when their net worth is below 0.8 x the average of the active players. A full hand draws nothing. The first turn
  of a game has no turn-start draw. The card is chosen by `POWER.WEIGHTS` (shield 30, double 30, steal 25, swap 15). Tuned with the simulator (about 2 cards per player per 10 rounds for a bot that plays at once).
* **Playing** (`PLAY_POWER`): the turn player, phase `roll`, nothing else open, one card per turn (`powerPlayed`, reset when the next turn starts); `getOptions().power = { canPlay, reason?, cards: [{ uid, id, exp, ok, reason?, targets? }] }`.
  Every play emits the public `power_play`. No new phase, pending type or timer.
* **Shield** arms `shield = round + 3`. The next rent or municipal tax the player would pay is waived in full (`power_trigger`), in `settlePayment` before chai, and the shield is consumed. Card and city-event cash is never waived.
* **Double Rent** arms `doubleRent = round + 3`. The owner's next rent is doubled INSIDE `rentOf` (so `previewRent`, the lucky-dice look-ahead and the client previews agree) and the card is spent when that rent is paid
  (`settlePayment`, `power_trigger card:'double'`, `amount` = the extra). A rent waived by a Shield does not spend it (the Shield wins).
* **Steal a Roll** sets `extraRoll = true` in phase `roll` (no `dice` event). `doRoll` keeps it through the first roll (`s.phase === 'roll' && extraRoll`) and the extra roll is spent like a six. A six on the first roll and a
  Steal coincide (one extra roll only); landing in the Traffic Jam on the first roll loses it, like a six. It cannot be played while stuck.
* **Swap Tiles** (`target` = an active rival; not allowed while either pawn is stuck, nor on the same tile): two `move` events with `teleport: true`, no landing, no salary (`passedStart: false`).
* **Expiry** (`startRound`): cards with `exp < round` leave every hand (`power_expire { player, count }`, never the identity); armed effects past their round lapse silently.
* **Bankruptcy / resign:** the cards and armed effects are discarded. Nothing blocks `checkWin`.
* **Events are public:** `power_draw` and `power_expire` never name a card; the owner learns it from their own (redacted) state. A played card is public by design.
* **Simulator:** `node scripts/simulate.js --set powerCards=true` checks the invariants (hand cap, expiry, armed rounds, no state when off, shield/double/steal/swap consistency) and prints cards drawn / played per card, triggers, expiries
  and the "winner not leading at round 6" rate. Bots play cards only as simulator bots (`isBot`); the auto-play of an idle human keeps its hand.
