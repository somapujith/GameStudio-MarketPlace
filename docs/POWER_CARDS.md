# Power Cards

An optional rule (`powerCards`, lobby toggle, **off by default**). Each player can hold up to two short-lived Power
Cards. They are drawn from card tiles and as a turn-start bonus, and are played at the start of your turn, before you
roll. They add surprise and bluffing: everyone can see HOW MANY cards you hold, nobody can see WHICH until you play one.

This file is the single spec for the rules, the wire contract (engine, server, client) and the UX. Keep it in sync.

## 1. Rules

| Card | id | Play window | Effect |
|---|---|---|---|
| Shield | `shield` | your `roll` phase, before ROLL | Arms a shield for 3 rounds. The next rent or municipal tax you would pay is waived in full (consumed). Never blocks city-event cash or card cash. |
| Double Rent | `double` | your `roll` phase, before ROLL | For 3 rounds the next rent you COLLECT is doubled (consumed). If the payer has a Shield, the Shield wins and the rent is waived. |
| Steal a Roll | `steal` | your `roll` phase, before ROLL | You get one extra roll this turn, exactly like rolling a six (after the first roll and its landing resolve, you roll again). Cannot be combined with an already pending extra roll. |
| Swap Tiles | `swap` | your `roll` phase, before ROLL | Trade board positions with a rival of your choice (`target`). No landing is resolved for either pawn and nobody passes START. Not allowed if either pawn is stuck in the Traffic Jam, or the target is bankrupt. |

- **One card per turn.** After you play a card this turn you must roll (or end per normal rules). `state.powerPlayed` is true
  until the next turn starts.
- **Hand size 2.** A draw when the hand is full gives nothing (no discard prompt).
- **Short-lived.** Every card has `exp`, the last round it can still be played (`round drawn + 3`). Expired cards are
  removed at the start of the round with a `power_expire` event. Armed effects (`shield`, `doubleRent`) also lapse at
  their round.
- **Sources.** (1) Landing on a card tile (luck/drama deck) also draws a power card (always, if the hand has room).
  (2) Turn start: at the start of your turn, if your hand has room, a chance of `0.06`, raised to `0.15` when your net
  worth is below 0.8 x the average of active players (a soft comeback). Constants live in `shared/powerCards.js` (tuned with `npm run sim`: about 2 cards drawn per player per 10 rounds, most of them from card tiles).
- **Weights** when drawing: shield 30, double 30, steal 25, swap 15.
  **Variety:** each draw reweights those by what is already held, so the table is not dealt the same card: a type a rival holds counts x0.45 per rival, a type the drawing player holds x0.2 (`POWER.VARIETY_OTHER` / `VARIETY_OWN`). Still exactly one draw on the card stream, so it stays deterministic. In bot games the share of moments where two players hold the same card fell from 44% to 26%.
- **Determinism and fairness.** Cards are drawn from a SEPARATE random stream (`state.prng`, created only when the
  rule is on). With the rule off the engine draws nothing extra and every existing seeded game is byte-identical.
  `state.prng` is secret (masked for clients like `rng` and `deck`).
- **Bots** use simple heuristics (see `shared/bots.js`): they keep the sim meaningful, they are not clever.
- No new phase, no `pending` type, no new timer: playing a card is a normal turn-player action in phase `roll`.

## 2. Wire contract

### State (`state`)
- `cfg.powerCards: boolean` (default `false`; a normal rule in `shared/ruleSettings.js`, group `rules`).
- `state.prng: uint32` (only when on; secret).
- `state.powerPlayed: boolean` (public): the current turn player already played a card this turn.
- `player.hand: Array<{ uid: string, id: 'shield'|'double'|'steal'|'swap', exp: number }>`.
  - **Redacted per viewer** (`worker/maskStateFor`): other players' hands become `[{ hidden: true }, ...]` of the same
    length (so `hand.length` is the public count). At `phase === 'over'` every hand is revealed to everybody.
- `player.shield: number` and `player.doubleRent: number`: the round up to which the armed effect lasts, `0` = none.
  Public (everyone sees "Shield armed").
- Stored games may lack all of these: read with fallbacks (`p.hand || []`, `p.shield || 0`).

### Action (player -> server)
`{ type: 'PLAY_POWER', card: '<uid>', target?: '<playerId>' }`
- Allow-listed in `worker/validate.js` (`card`: string, `target`: string, both bounded). `target` is required for
  `swap`, forbidden otherwise.
- Valid only for the turn player, phase `roll`, no debt/trade open, `!state.powerPlayed`, the card in their hand and not
  expired, rule on. Errors are plain strings like the other actions.
- `getOptions(state, playerId).power` (for the client; the engine builds it):
  `{ canPlay: boolean, reason?: string, cards: [{ uid, id, exp, ok: boolean, reason?: string, targets?: string[] }] }`.
  `reason` strings are user-facing ("Play a card before you roll", "Already played a card this turn", "Not your turn",
  "No rival can swap right now").

### Events (public: never put an unplayed card's identity in an event)
- `{ type: 'power_draw', player, source: 'tile'|'turn', tile? }`: someone drew a card (identity NOT included; the owner
  learns it from their own redacted state).
- `{ type: 'power_play', player, card: 'shield'|'double'|'steal'|'swap', target? }`: a card was played (now public).
- `{ type: 'power_trigger', player, card: 'shield'|'double', amount, other? }`: an armed card did its job. `amount` =
  cash saved (shield) or extra rent earned (double); `other` = counterparty.
- `{ type: 'power_expire', player, count }`: `count` cards expired (identity not included).
- Swap emits two `move` events with `teleport: true` (no `passedStart`) so existing pawn animation plays.
- Steal sets the same state as a six (`extraRoll`) without a `dice` event.
- Animation timing: add to `shared/timing.js` `ANIM_MS`: `powerDraw` 900, `powerPlay` 1500, `powerTrigger` 1400,
  `powerExpire` 700, and a matching `case` in `worker/games/hyderabad-tycoon.js` `estimateAnimMs` (an unknown event type
  adds 0 ms, so this is mandatory for the decision timers to stay correct). The presenter may only wait with these keys.

## 3. UX spec (senior-level, phone first)

**Principles:** one obvious action per moment; hidden information stays hidden; every state has an explanation; nothing
important is conveyed by colour or motion alone; fast to use, hard to misfire.

### 3.1 Your hand (the "power tray")
- Lives next to the Roll control (board centre on wide layouts, directly above the action bar on phones), never covering
  the board tiles, never shifting the Roll button. Hidden entirely when the rule is off; when on but the hand is empty it
  collapses to a slim "No power cards" chip with an info button (the guide).
- Cards are shown as a small fan of up to 2 illustrated cards (aspect 5:7, min width 64px phone / 96px wide). Each card:
  artwork (Hyderabad-themed SVG, see 3.5), name, a one-line effect, and an **expiry meter** (3 pips: rounds left). When a
  card expires this round the meter turns warning-amber and the card gets a calm pulsing ring (static outline under
  reduced motion) plus the text "Last round".
- **Select, then confirm** (no accidental plays): tap a card -> it lifts and a detail panel/popover shows full effect
  text, expiry and a primary **Play card** button plus **Cancel**. Keyboard: arrow keys move across cards, Enter/Space
  selects, Esc cancels; focus returns to the card. Drag-to-play is NOT required (optional later).
- **Swap Tiles** adds a targeting step: after Play is pressed, enter targeting mode: eligible rivals are highlighted on the
  board AND shown as a list of avatar buttons in the panel (the list is the accessible path); tapping one shows a
  confirm line "Trade places with Ravi?" with Confirm/Back. Ineligible rivals are listed disabled with the reason.
- **Disabled states are explained** (from `options.power.reason`): not your turn, already played this turn, roll
  already made, debt open. The card stays visible but dimmed with the reason under the panel's button.
- Playing is optimistic only visually (a pending spinner on the button); the server decides; errors show as a toast and
  the card returns to the hand.
- A one-time **coach mark** the first time you hold a card (stored in localStorage `hg:power-coach`): "Play one power
  card before you roll. Others can see how many you hold, not which."

### 3.2 Opponents and bluffing
- Each player's pod/row shows a **face-down card stack** with a count badge (0 = nothing shown). Use the existing
  `CardBack` art. Tooltip/aria: "Ravi holds 2 power cards".
- Armed effects are public **status chips** on the pod: "Shield" and "Double rent" with rounds left; they disappear when
  consumed or expired (with a small flash).
- The player sheet shows the stack and chips too. At game over, hands are revealed in the results (optional).

### 3.3 Moments (all one-shot, none can block input; they run inside existing presenter waits)
- **Draw:** card tile landing: a card-back flips out of the tile into your tray with a soft gold sparkle; for rivals a
  card-back flies to their pod and the count ticks up. You also see the revealed card (lift + name).
- **Play:** a centre-screen reveal (about 1.5 s): the card slams in with its name ribbon (a new `power` tone on
  `MomentBanner`), a hit sound, and a one-line effect; for Swap the two pawns arc past each other with a ripple.
- **Trigger:** Shield = blue ring flash on the pod plus "BLOCKED  saved Rs X"; Double Rent = gold coin burst and
  "x2 RENT" on the rent flight.
- **Expire:** the card crumbles to dust in the tray with a toast "Shield expired".
- Sounds (new recipes in `src/lib/soundscape/recipes.js`, all synthesised like the rest): `powerDraw`, `powerPlay`,
  `powerShield`, `powerDouble`, `powerSwap`, `powerSteal`, `powerExpire`; haptics for the local player.
- Reduced motion / `data-perf='low'`: reveals become short opacity fades, no particles, no pawn arcs (pawns just move),
  the info is the same. Moments never replay on resume (the presenter `reset` path already guarantees it).

### 3.4 Feed, rules and onboarding
- Feed lines (public text): "Ravi drew a power card", "Ravi played Shield", "Ravi's Shield blocked Rs 42,000 rent",
  "Gita swapped places with Ravi", "Ravi's Double Rent earned Rs 30,000 extra", "A power card expired".
- The lobby rules panel shows the toggle automatically from the rule schema ("Power cards"; help: "Short-lived cards:
  Shield, Double Rent, Steal a Roll, Swap Tiles. Held in secret, played before your roll.").
- The in-game Rules sheet and a **Power cards guide** sheet (opened from the tray's info button) explain the four cards with
  their art, the one-per-turn rule, hand size and lifetime.

### 3.5 Card art and visual language
- Four SVG illustrations in the game's illustrated style (outlined with ink `#1b1340`, gradient fills, no filters):
  Shield = a Charminar-arch shield with a glint; Double Rent = two stacked gold coins with "x2" and a rupee mark;
  Steal a Roll = a hand snatching a spinning die; Swap Tiles = two pawns exchanging along curved arrows.
- Card frame: rounded 14px, paper gradient on a night-indigo back, a coloured top band per card (Shield blue, Double
  gold, Steal teal, Swap violet; never colour-only: each also has its icon and name), light specular sweep on hover/focus
  only (not a loop). Back of card = existing `CardBack`.
- Tokens only (`--hub-*`, `--g-*`, `--hb-*`); class prefix `pw-`; 44px minimum targets; works at 360px; the light hub
  theme is not used in game routes (dark only) but keep contrast >= 4.5:1.

## 4. Balance and testing
- Tuning constants are in `shared/powerCards.js`. Use `npm run sim` A/B (`--set powerCards=false|true`, same seeds) and
  compare spread, rounds, seat-1 win rate and the "trailing at round N wins" rate before turning anything on by default.
- Tests: engine (same seed + actions -> same events; no extra draws when off; each card's rules and illegal plays),
  mask (others never see ids; reveal at game over), fuzz/sim invariants (new fields are legal), UI model + SSR render
  tests for tray, pods, guide and moments.

## 5. Implementation notes (as built)

- Steal a Roll is refused while stuck in the Traffic Jam, and Swap Tiles is refused when the target is on the same tile, so a card is never wasted.
- `extraRoll` can be true in phase `roll` after a Steal (with `powerPlayed` true): treat it as roll available. A six on the first roll and a Steal coincide into ONE extra roll.
- A Shield-waived payment emits no `cash` events. Armed effects lapse silently; only expired CARDS emit `power_expire`.
- The first turn of a game has no turn-start draw (createGame returns no events).
- The client omits `target` for every card except Swap Tiles (the server rejects `target: null`).
- Idle (AFK) humans never auto-play cards; bots do.
