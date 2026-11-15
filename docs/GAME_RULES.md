# Hyderabad Tycoon: game rules, state machine and wire protocol (Hyderabad Hustle rules)

This is the authoritative description of the game as it is built. The game keeps its id `hyderabad-tycoon` and its
name **Hyderabad Tycoon**, but since 2026-11-15 it plays the **Hyderabad Hustle** ruleset (design source:
`Hyderabad_Hustle_Game_Concept.md`, build contract: `docs/HUSTLE_PLAN.md` section 3). It is the contract between the
rules engine (`shared/engine.js` + `shared/{board,cards,events,modes,pieces,dice,bots}.js`), the room server
(`worker/GameRoom.js`, `worker/games/hyderabad-tycoon.js`, `worker/validate.js`, `worker/settings.js`,
`worker/mask.js`) and the client (`src/lib/session/*`, `src/components/game/*`, `src/components/online/*`).
Snatch, Shield, Traps, jail / bail / the Get-Out-of-Jail card, utilities, stations-as-property and the end-cash goal
are **gone**.

Contents: 1 fixed decisions · 2 settings, constants and the board · 3 turn flow · 4 dice and movement · 5 squares and
money · 6 auctions · 7 bankruptcy and game end · 8 wire protocol · 9 city events · 10 cards · 11 pieces ·
12 balance and simulation · 13 known discrepancies.

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

Host settings (validated by `worker/settings.js`, mirrored in `src/games/hyderabad-tycoon/settings.js`;
`settings.test.js` fails when the two drift):

| Key | Accepted | Default | Notes |
|---|---|---|---|
| `mode` | `'standard'` \| `'quick'` \| `'classic'` | `'standard'` | The only setting the lobby shows (`lobbySettings: ['mode']`). |
| `dice` | `'lucky'` \| `'fair'` | `'lucky'` | not shown in the lobby |
| `auctionOnDecline` | boolean | `true` | a skipped (or unaffordable) district goes to a sealed auction |
| `maxPlayers` | integer 2 - 6 (room setting, also accepted inside `settings`) | 4 | seats |

Modes (`shared/modes.js` `MODES`, re-exported by the engine):

| mode | label | rounds | start cash |
|---|---|---|---|
| `standard` | Standard City Hustle | 20 | ₹15,00,000 |
| `quick` | Quick Chai Break | 12 | ₹20,00,000 |
| `classic` | Classic Long Game | until one player is left (`maxRounds: null`; safety cap `ROUND_CAP` = 60) | ₹15,00,000 |

`state.cfg` = `{ mode, startCash, passStart, maxRounds|null, dice, auctionOnDecline, trafficFine, chaiCap }`
(`passStart` 2,00,000, `trafficFine` 25,000, `chaiCap` 1). Unknown keys (`debug`, `seed`, the retired `goal`,
`startCash`, `maxRounds`, `snatches`, `snatchMs`) are ignored by the server. The engine's `normalizeSettings` also
accepts `startCash`, `passStart`, `maxRounds` and `trafficFine` overrides (`SETTING_LIMITS`), for tests and the
simulator only. The room stores the 3 host keys; `room.settings` (what the lobby shows) is the engine's full `cfg`.

Constants (`shared/board.js`): `BOARD_SIZE` 36, `GRID` 10, `START_TILE` 0, `TRAFFIC_TILE` 9, `CHAI_TILE` 18,
`MUNICIPAL_TILE` 27, `AUCTION_TILE` 32, `TRANSPORT_TILES` [5, 14, 23], `CORNER_TILES`, `MAX_LEVEL` 2, `SET_BONUS.full`
1.5, `UPGRADE_RATIO` 0.5, `SELL_RATIO` 0.5, `MORTGAGE_RATIO` 0.5, `UNMORTGAGE_INTEREST` 0.1, `START_CASH` 15,00,000,
`QUICK_START_CASH` 20,00,000, `PASS_START` 2,00,000, `TRAFFIC_FINE` 25,000, `CHAI_CAP` 1, `CHAI_MIN_RENT` 20,000,
`MUNICIPAL_BASE` 40,000, `MUNICIPAL_PER_LEVEL` 10,000, `BAZAAR_MIN_RATIO` 0.5, `DECLINE_MIN_RATIO` 0.1.
Helpers: `isBuyable rentTable rentFor(tile, level, fullSet) upgradeCost sellRefund mortgageValue unmortgageCost
levelName(tile, level) nextTransport municipalFor auctionMinBid tilePosition tileSide`.
Deprecated aliases kept so older UI code still builds: `JAIL_TILE` (= `TRAFFIC_TILE`), `HOTEL_LEVEL` (= `MAX_LEVEL`),
`LEVEL_NAMES` (generic `['Business', 'Expanded', 'Flagship']`; use `levelName(tile, level)`).
`shared/events.js`: `EVENT_EVERY` 3.

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

`state.phase` is one of: `roll`, `buy`, `auction`, `manage`, `debt`, `over`.

```
roll   --ROLL--> move clockwise, then land:
                   unowned district, cash >= price            -> buy
                   unowned district, cash < price             -> auction (reason 'unaffordable', if auctionOnDecline) | manage
                   district of someone else                   -> rent (debt if short, bankrupt if hopeless)
                   transport stop                             -> manage, state.ride offered
                   Traffic Jam / "stuck" card                 -> stuck, the turn ends at once (extra roll lost)
                   Chai Adda / Municipal / card / Bazaar Auction -> chai / tax / card effect / auction (reason 'bazaar')
roll   (stuck)  --PAY_TRAFFIC | USE_CHAI--> roll (unstuck, roll normally)
roll   (stuck)  --ROLL--> wait: no move, stuck clears, the turn ends
buy    --BUY--> manage            buy --SKIP_BUY--> auction (reason 'decline', if auctionOnDecline) | manage
manage --RIDE--> manage (moved to the next stop)     manage --END_TURN--> roll of the next active player
manage --ROLL--> ...    (only while state.extraRoll, i.e. after a six)
any    --payment too big--> debt --PAY_DEBT--> returnPhase
```

Also legal in `roll` / `manage` of your own turn: `UPGRADE`, `MORTGAGE`, `UNMORTGAGE`, `SELL_BUILDING`, `TRADE_OFFER`.
Out of turn, anybody may `BID` (auction), answer a trade addressed to them, or `RESIGN`; the debtor may mortgage /
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
  extra roll is lost and the turn ends. Next turn, in `roll`: `PAY_TRAFFIC` (25,000, cash reason `traffic`),
  `USE_CHAI` (spends a chai) - then roll normally - or `ROLL` = wait (no dice, no move, `stuck` clears, turn ends;
  `traffic` reason `waited`). Upgrading, mortgaging and trading are allowed while stuck.

## 5. Squares and money rules

* **Buying**: an unowned district you can afford offers `BUY` at its price, or `SKIP_BUY` (sealed auction when
  `auctionOnDecline`). A district you cannot afford goes straight to auction (same switch). A bought district is
  level 0 = its first business (`levelName(tile, 0)`).
* **Rent** = `rentTable(tile)[level]`: base 10% of the price, level 1 = round1000(base x 1.9), level 2 =
  round1000(base x 3.5) (HITEC City 34,000 / 65,000 / 1,19,000). Owning the whole collection pays **1.5x on level-0
  tiles only**. A mortgaged district collects nothing. City events (9) and the owner's "rents x2" card boost
  (`player.rentBoost`, until that player's next turn) multiply on top. `previewRent(state, tile)` gives the exact
  figure the visitor would owe before chai.
* **Upgrades**: `MAX_LEVEL` 2, each costs 50% of the price (30,000 - 2,00,000). **You may only upgrade a district once you
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
* **Trades** move districts (with their upgrades and mortgages) and cash. Only districts can be traded.
* **Net worth** = cash + price of each unmortgaged district + (price - mortgage value) for mortgaged ones + 50% of the
  upgrade costs paid (levels x upgradeCost x 0.5) - unpaid debt (the open `state.debt` and its `rest`).
* `liquidationValue` = for each owned district: levels x sell refund + its mortgage value if not mortgaged yet.

## 6. Auctions

Sealed, simultaneous. `pending = { type:'auction', tile, minBid, bids, reason, returnPhase }`, reason `'decline'` |
`'unaffordable'` | `'bazaar'`. `BID {amount}` once per player (0 = pass), amount `>= minBid` and `<= cash`. Highest
valid bid wins; ties go to the earliest seat counted from the current turn player. Players who cannot afford `minBid`
are auto-passed. `minBid` = 10% of the price (rounded to 1,000, at least 1,000) for decline / unaffordable, 50% for
the Bazaar Auction (`auctionMinBid`). Everyone active may bid, including the lander. The winner pays the bank.
No valid bid: the district stays unowned. Afterwards the phase is `returnPhase` (`manage`).

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
Triggered by an unpayable debt or by `RESIGN`. Every upgrade is sold to the bank (`level` events reason `bankrupt`,
`cash` reason `liquidate`). A **creditor** player gets all the cash and every district (`own` reason `bankrupt`;
mortgaged stays mortgaged; `set_complete` for collections they now hold). With the bank as creditor every district
becomes unowned and unmortgaged. Then `cash = 0`, `stuck` / `chai` / `rentBoost` are cleared, a pending trade of theirs
is cancelled (`trade_rejected` reason `bankrupt`), a ride offer is dropped, `player.outOrder` records the order of
going out, and a `bankrupt` event is emitted. Bankrupt players never act again and are skipped in turn order.

### 7.3 Resign
`RESIGN` is legal at any time for any non-bankrupt player. In their own debt: bankruptcy to the debt's creditor, then
`rest` is replayed. Otherwise: bankruptcy to the bank. In an auction their bid becomes 0. A pending trade involving
them is cancelled. `{t:'leave'}` from a running game resigns the player and marks the seat `left`.

### 7.4 Winning (`checkWin`, after **every** applied action)
1. **Last standing** (`winReason 'last_standing'`): at most one non-bankrupt player is left.
2. **Rounds** (`'rounds'`): `state.round > maxRounds` (classic: `> ROUND_CAP` 60), i.e. the moment the last player of
   the final round ends their turn. The **richest** active player wins: highest net worth, then most cash, then seat
   order.

There is no end-cash goal. Ending sets `phase 'over'`, clears `pending`, `trade`, `debt`, `ride`, `extraRoll`, fills
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
| `settings` | `settings`: object with any of `mode dice auctionOnDecline maxPlayers` | host, lobby only. The patch is merged over the current settings and re-validated. | `Only the host can change settings.` · `Settings are locked once the game starts.` · `Settings must be an object.` · `Mode must be one of 'standard', 'quick', 'classic'.` · `Dice must be 'lucky' or 'fair'.` · `Auction on decline must be true or false.` · `Players must be between 2 and 6.` · `There are already more players than that.` |
| `piece` | `piece`: one of the adapter's `pieces` (`pearl auto handi chai bat camera`) | any member, lobby only; picks a free piece | an `error` when the piece is taken or unknown |
| `kick` | `id`: user id | host, lobby only. Removes the player and bans them for 10 minutes. | `Only the host can remove players.` · `Players can only be removed in the lobby.` · `That player is not in the room.` · `You cannot remove yourself.` |
| `start` | | host, lobby, at least `minPlayers` (2) seated | `Only the host can start the game.` · `The game has already started.` · `You need at least 2 players to start.` · `Too many players for this room.` · `Could not start the game.` |
| `action` | `action`: object (8.5) | any member while `status 'playing'` | `No game is in progress.` · `Invalid action.` (failed the allow-list) · the engine's reason (for example `Not your turn`) |
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
| `state` | `state`, `events`, `seq`, `clock` | after every applied action (to every socket, each with its own redacted view), and once to a socket that connects while a game exists (`events: []`). `clock = { deadline: epochMs\|null, waitingFor: playerId[] }` = when the decision timer (45 s after the animation) auto-plays. |
| `error` | `message` | a rejected request (8.2), a refused join (8.1) or `This room has expired.` |
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
  cfg: { mode, startCash, passStart, maxRounds: number|null, dice, auctionOnDecline, trafficFine, chaiCap },
  rng: 0, deck: [], deckPos: { luck, drama },     // rng and deck are server secrets: always sent as 0 / [] (8.7)
  round, turn /*index into players*/, turnCount,
  phase: 'roll'|'buy'|'auction'|'manage'|'debt'|'over',
  extraRoll: boolean, dice: [d],                  // [0] = no roll yet
  owners: (playerId|null)[36], levels: number[36] /*0-2*/, mortgaged: boolean[36],
  pending: null | { type:'buy', tile, price } | { type:'auction', tile, minBid, bids, reason, returnPhase },
  ride: null | { player, from, to, fare },        // a transport ride on offer to the turn player
  trade: null | { id, from, to, give:{cash,tiles[]}, get:{cash,tiles[]} },   // `give` leaves `from`, `get` leaves `to`
  debt:  null | { player, amount, creditor: playerId|null, reason, returnPhase, rest: [{from,to,amount,reason}] },
  tradeSeq, outCount,
  event: null | { id, title, text, kind, round, group?, groups?, mult?, upgradedOnly?, amount?, bonus? },   // 9
  winner: playerId|null, winReason: 'last_standing'|'rounds'|null,
  players: [{ id, name, avatar, color, piece, cash, pos, stuck, chai, laps, bankrupt, outOrder,
              sixes, rollsSinceSix, rentStreak, rentThisTurn, rentBoost, lastOfferTurn, isBot /*false online*/, bot /*null*/,
              stats: { rentPaid, rentEarned, taxPaid, propertiesBought, upgrades, biggestRent, rides, chaiSaved } }]
}
```
The client computes `getOptions(state, me)` from `shared/engine.js` on the (redacted) view. Keys:
`roll payTraffic useChai buy skipBuy ride endTurn upgrade[] bid mortgage[] unmortgage[] sellBuilding[] debt payDebt
trade tradeOffer tradeSent sets[] resign` (everything false / null / [] when it is not that player's moment).
`roll` is also true while stuck (it means "wait"); `payTraffic` = the fine or `false`; `useChai` boolean;
`ride` = `{ to, fare } | null`; `upgrade[]` = `{ tile, cost, level }`; `bid` = `{ tile, min, max }`;
`sets[]` = `{ group, owned, size, multiplier }`. Other queries: `previewRent`, `municipalDue`, `canUpgrade`,
`netWorth`, `liquidationValue`, `standings`.

`seq` starts at 1 when the game starts and grows by one per applied action. The state is always the **full** state.

### 8.5 Client actions (allow-list in `worker/validate.js` `sanitizeAction`)
`playerId` is always overwritten with the socket's user; unknown fields are dropped; anything not listed (including the
retired `PAY_BAIL USE_JAIL_CARD SNATCH SNATCH_CLOSE PLACE_TRAP` and `BUY.shield`) fails with `Invalid action.`
Tile fields are integers 0-35.

| `type` | Fields | Legal when | Engine errors (selection) |
|---|---|---|---|
| `ROLL` | | your turn, phase `roll` (while stuck: wait), or `manage` with `extraRoll` | `Not your turn` · `Decide about the district first` · `An auction is in progress` · `You already rolled. End your turn` |
| `PAY_TRAFFIC` | | your turn, phase `roll`, stuck, cash >= 25,000 | `You are not stuck in traffic` · `Getting out costs ₹25,000` · `You can only pay before rolling` |
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
| `TRADE_OFFER` | `to`, `give`/`get`: `{cash:int>=0, tiles:int[]}` (unique, on board, not both empty) | your turn, `roll`/`manage`, nothing pending | `Finish the current step before trading` · `Only districts can be traded` · `You do not have that much cash` |
| `TRADE_ACCEPT` / `TRADE_REJECT` | | the recipient of the pending offer | `There is no trade offer` · `This offer is not for you` |
| `TRADE_CANCEL` | | the offerer | `Only the player who made the offer can cancel it` |
| `RESIGN` | | any non-bankrupt player, any time (7.3) | `You are out of the game` |

While a trade is pending only the three trade answers and `RESIGN` are legal (`A trade offer is waiting for an
answer`); while the phase is `debt` see 7.1. After the game ends: `The game is over`.

### 8.6 Events (`events` in a `state` message, replayed by the client presenter and written to the log)

| `type` | Fields |
|---|---|
| `dice` | `player, values:[d], assist: null\|'comeback'\|'mercy'\|'pity'\|'antibust'` |
| `move` | `player, from, to, path: tile[] (excluding from), passedStart, teleport?, ride?` |
| `land` | `player, tile` |
| `cash` | `player, delta (signed), reason, other?` - reasons `salary rent tax buy upgrade auction card fare traffic liquidate mortgage unmortgage sell trade event` (a transfer emits one event per side; `other` = counterparty) |
| `own` | `tile, owner (id\|null), reason: 'buy'\|'auction'\|'trade'\|'bankrupt'` |
| `level` | `tile, level, reason: 'upgrade'\|'sell'\|'bankrupt'` |
| `ride` | `player, from, to, fare` (after the fare's `cash`, before its `move`) |
| `traffic` | `player, stuck: boolean, reason: 'tile'\|'card'\|'paid'\|'chai'\|'waited'` |
| `chai` | `player, chai /*new count*/, change: 1\|-1, reason: 'adda'\|'card'\|'rent'\|'traffic', saved? /*rupees saved*/` |
| `card` | `player, cardId, kind: 'good'\|'bad'\|'neutral', deck: 'luck'\|'drama', title, text` |
| `auction_start` | `tile, minBid, reason: 'bazaar'\|'decline'\|'unaffordable'` |
| `auction_end` | `tile, winner (id\|null), amount, bids: {id: amount}` (reveals every bid), `reason` |
| `city_event` | same fields as `state.event` (emitted before that round's first `turn` event) |
| `mortgage` / `unmortgage` | `player, tile, value` / `player, tile, cost` |
| `set_complete` | `player, group` |
| `debt` | `player, amount, creditor` |
| `bankrupt` | `player` |
| `trade_offer` / `trade_done` | `id, from, to, give, get` |
| `trade_rejected` | `id, from, to, reason: 'rejected'\|'cancelled'\|'bankrupt'\|'invalid'` |
| `turn` | `player, round` |
| `win` | `player (id\|null), reason, worth` |

Order of a typical roll: `dice, move, (cash salary), land, ...effect`. A stuck turn that waits: `traffic (waited), turn`.

### 8.7 Redaction (what each viewer is not told)
`worker/mask.js` (`adapter.redact`) runs for every recipient. It always returns a copy with the engine secrets removed
(`state.rng` -> `0`, `state.deck` -> `[]`; one stripped copy is cached per authoritative state), so a client cannot
compute the next die, card or city event. **Sealed bids:** while `pending.type === 'auction'`, `pending.bids` keeps
every key but shows `0` for every player except the viewer; `auction_end.bids` reveals all amounts. Everything else is
public (cash, districts, chai, stuck, pieces, `deckPos`).

### 8.8 Timers, auto-play and presence (server side, Durable Object alarms)
* **Decision timer, 45 s (`TURN_MS`).** Everyone the game is waiting for (the turn player; the debtor in a debt; every
  player who has not bid in an auction; the recipient and the offerer of a pending trade) gets 45 s, counted from when
  the client animation of the last applied action ends (`lastApplyAt + animationMs`). It is announced in
  `state.clock`. The animation estimate (`estimateAnimMs(events, state?)` in the adapter) uses the presenter's own
  table, `ANIM_MS` / `LONG_TRIP` / `MAX_ANIM_MS` from `shared/timing.js`: dice + afterDice; step x path length (a trip
  longer than `LONG_TRIP` squares hops faster: step x max(0.3, LONG_TRIP / length) per square); teleport; land; rent
  out/in; cash; own; level (x1.5 for level 2); set_complete; mortgage; trade; debt; card; auctionStart / auctionEnd;
  cityEvent; ride; chai; traffic (jail when stuck, jailStay when waited, else quiet); bankrupt; turn (turn, a new
  round max(round, turn), the final round finalRound - this needs the state; without it every turn counts as a new
  round); win; capped at `MAX_ANIM_MS` (8 s). The game start adds 1.5 s. The client's `playbackSpeed` may only make
  playback faster (or 0.75x), so the server never waits less than the speed-1 estimate.
* When it fires the player is flagged **idle** and the engine's move chooser plays one move for them (~900 ms per
  move, ~400 ms for bids, never faster than the animation) until they send any `action` (or reconnect).
* **Disconnect grace, 15 s.** A member with no open socket is auto-played once 15 s have passed since the last socket
  closed. Reconnecting cancels it.
* **Trade, 30 s.** A pending trade offer is auto-rejected (`TRADE_REJECT` for the recipient) 30 s after it appears
  (`adapter.deadlines`). If the recipient is out of the game the offerer's offer is cancelled after 0.9 s.
* What auto-play does (`idleAction`): a pending trade is rejected / cancelled; otherwise the move chooser buys when its
  heuristic likes the district else skips, bids, lifts mortgages and upgrades when rich, pays a traffic fine only with
  comfortable cash (else waits), rolls, ends the turn, settles debts. It never rides and never proposes a trade.
* **Safety net:** if the engine refuses three automated moves in a row for the same player, that player is resigned.
* **Lobby:** a member with no socket for 60 s is dropped; an empty lobby expires in about 10 minutes.
* **Abandon:** no non-left member connected for 5 minutes while playing: `status 'finished'`, not recorded.
* **Expiry:** 24 h after the last activity the room sends `error` `This room has expired.` and deletes itself.
* **Persistence:** the room record is in Durable Object storage after every change; a finished match is written to
  Neon once (with retries). A stored game from the old rules (40 squares, jail, snatch) cannot be resumed:
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
| `GET /api/rooms/open?game=<id>&limit=20` | none | public lobbies with a free seat, active in the last hour. Not used by the current UI. |
| `POST /api/invites` `{ code, userId }` | signed-in, non-guest | the inviter must be a member of a lobby and a friend of `userId`; pushes `{t:'invite', from, code, gameId, gameName}` to that friend's `/ws/user` |

Pre-game flow: game page (`/games/:gameId`: pick players, **Create table**) -> `POST /api/rooms` -> `/lobby/:code` (open the socket: connecting seats you) -> host picks the game mode (`settings`), players pick pieces (`piece`) and presses
**Start** (`start`) -> everyone navigates to `/play/:gameId/online/:code` when `room.status` becomes `playing`. A finished room offers "New room, same settings" (a fresh `POST /api/rooms`); a game cannot be restarted in the same room.


## 9. City events ("Hyderabad Rush Hour")

`shared/events.js` exports `CITY_EVENTS`, `EVENT_EVERY = 3`, `RUSH_FLAVOUR`, `FESTIVALS`. When the round counter rises
to a multiple of 3 (3, 6, 9, ...; never round 1, never after the last round) one event is drawn with the seeded rng and
lasts that round. `state.event = { id, title, text, kind, round, group?, groups?, mult?, upgradedOnly?, amount?,
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

Two decks in `shared/cards.js` (`LUCK_CARDS` 18 cards, `DRAMA_CARDS` 18 cards, `DECKS`, `DECK_NAMES`, `cardById`).
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

`node scripts/simulate.js [--games N] [--players 2,4,6] [--modes standard,quick,classic] [--set k=v] [--bot k=v]`
plays bot-only games, checks invariants after every action (cash, ownership, levels, mortgages, phases, debts, ride
offers, unique pieces, winner = rank 1) and prints balance numbers. 300 games per row, default bots (2026-11-15, after
the whole-collection upgrade rule of section 5):

| mode, players | rounds / turns | districts owned after round 3 / 5 | ended by bankruptcy | final net-worth spread (richest - poorest) | upgrades / game |
|---|---|---|---|---|---|
| standard, 2 | 20 / 40 | 19% / 31% | 0% | ₹2.7L | 1.8 |
| standard, 4 | 20 / 80 | 30% / 49% | 0% | ₹4.3L | 1.9 |
| standard, 6 | 20 / 120 | 40% / 62% | 0% | ₹6.5L | 1.7 |
| quick, 4 | 12 / 48 | 31% / 49% | 0% | ₹3.2L | 1.2 |
| classic, 4 | 60 (cap) / 240 | 31% / 50% | 0% | ₹10.1L | 4.6 |

The standard and quick economies behave as designed: districts sell steadily (about half by round 5 with 4 players)
and the winner ends around ₹21-24L. Before the whole-collection upgrade rule the same bots built 19 / 35 / 47 / 37 / 55
upgrades per game and rents averaged ₹55-65k a payment; now bots rarely complete a collection (they never trade with
each other, only buy and bid), so they build 1-5 upgrades per game, rents average about ₹20k and the net-worth spread
roughly halves. Human tables trade and complete collections far more often, so expect more building there. No numbers
were changed from the concept doc's recommended defaults. Known balance caveat: with ₹2L per lap and these rents nobody is
squeezed out, so **classic games run to the 60-round cap** (also with ₹1L laps or aggressive bots); the seat that
moves first wins a little more often (about 30% in 4-player games).

## 13. Known discrepancies (open items, not hidden)

1. **Classic mode does not end by bankruptcy in simulation** (12): it effectively plays as "60 rounds, richest wins".
   A harsher economy for classic only (higher rents, smaller laps) would be a product decision.
2. **`ready` and `visibility` messages are still live on the server although the product has neither** (`worker/GameRoom.js`).
3. **Kick wording.** The kick dialog says the player "can rejoin with the code", but the server bans a removed player for 10 minutes.
4. **A player who left a running game is un-flagged on reconnect** (`handleUpgrade` clears `member.left`).
5. `adapter.animationMs(events, state)` takes the state after the action as an optional second argument; without it
   every `turn` event is timed as a new round (slightly long, never short) and the final-round pause is not known.
