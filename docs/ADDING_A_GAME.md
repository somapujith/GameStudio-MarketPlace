# Adding a game to Jalebi Games

A game is three small pieces that share one **id** (url-safe, lowercase, never changes, e.g. `ludo-lanes`):

1. **Rules** in `shared/<id>/`: pure JS, no DOM, no Worker APIs. Runs in the Worker (online) and, for board data and derived views, in the browser. Every game is played online in a room of humans; there is no offline mode and no bot players (an engine may ship a move chooser that the adapter's `idleAction` uses to auto-play an idle or disconnected seat).
2. **Frontend plugin** in `src/games/<id>/`: a tiny manifest plus lazy-loaded screens.
3. **Server adapter** in `worker/games/<id>.js`: the only place the Worker learns the rules.

Nothing else may know the game: the hub, lobby, `GameRoom`, leaderboard and database are generic.
**Nawabi Raj is the reference**: copy its shape (`src/games/hyderabad-tycoon/`, `worker/games/hyderabad-tycoon.js`). The full contract is `docs/MARKETPLACE.md` (sections 3, 4, 5). The wire protocol every game gets for free (room messages, `state` / `events` / `seq`, timers, reconnect, redaction hook) is `docs/GAME_RULES.md` section 8; its rules sections are Tycoon's own.

## 1. Folder layout

```
shared/<id>/index.js          createGame, applyAction, auto-play move chooser, result (+ *.test.js)
src/games/<id>/
  manifest.js                 TINY: metadata, settings schema, loaders (no engine, no pages)
  settings.js                 presets, schema, summary (pure, unit-tested)
  OnlineGame.jsx              full-screen online game; reads useParams().code; exit -> paths.game(id)
  <id>.css                    optional: the game's own styles (import it from the screen)
worker/games/<id>.js          the adapter (default export)
```

Rules for screens: every URL comes from `paths.*` (`src/platform/paths.js`), never a string like `'/play'`. The game screen renders
full screen and must not assume any hub chrome. Money: `formatINR` from `@shared/format.js`. The pre-game flow (game page with
"How many players?" -> Create table -> lobby with the seat grid, invite block and Start) is the hub's, the same for every game:
a game only supplies its manifest, settings schema and `OnlineGame`.

## 2. The manifest

```js
import { MyCover, MyIcon } from '@/components/art/hub/index.js'; // 16:9 cover + square icon
export default {
  id: 'my-game', name: 'My Game', tagline: 'One line, 48 chars max', description: '1-2 sentences',
  category: 'board',            // board | card | arcade | social | word | sports  (CATEGORIES in registry.js)
  status: 'live',               // 'coming_soon' needs only id, name, tagline, category, status, players, duration, theme, art
  players: { min: 2, max: 4 }, duration: '10-20 min',
  theme: { accent: '#ffc857', accent2: '#ff8a3d', bg: '#1b1340' },
  art: { cover: MyCover, icon: MyIcon },
  modes: { friends: true, open: false },    // online-only: private tables for friends
  features: ['Play with friends'],                          // small chips
  settings: SETTINGS_SCHEMA,    // host settings, see below
  lobbySettings: ['goal'],      // optional: the schema keys the lobby shows (the rest keep their defaults); omit to show all
  summarize: (s) => 'First to 50 points wins',              // the one line the lobby shows everyone
  loaders: { onlineGame },      // () => import('./OnlineGame.jsx'), default export
  stats: [{ key: 'wins', label: 'Wins' }],                // user_game_stats fields to highlight
};
```

**Optional store-listing fields.** The game page, the catalogue and search read these when present; leave out whatever you cannot state truthfully (no ratings, install counts or made-up dates, ever):

```js
  publisher: 'Jalebi Games',                 // string
  version: '1.0',                       // string
  released: '2026-11-15',               // ISO date; omit until it is real
  ageRating: '12+',                     // string
  languages: ['English'],               // string[]
  platforms: ['Phone', 'Tablet', 'Desktop'],
  tags: ['Dice race', 'Classic'],       // search and chips
  highlights: [{ icon: 'users', title: 'Two to four players', text: 'One sentence.' }],   // icon = a HubIcon name
  howToPlay: [{ icon: 'dice', title: 'Roll', text: 'One sentence per step, 3-5 steps.' }],
  gallery: [{ kind: 'cover', caption: 'Cover art' }, { kind: 'scene', caption: 'A closer look' }],   // 'cover' | 'scene' | 'board'
```

Everything above is also listed, with where each field is used, in `docs/MARKETPLACE.md` section 3. The game page, About page and search read the registry, so a new game appears everywhere (including `/about`) without touching them.

**Settings schema** (rendered by the lobby for the host, a read-only summary for everyone else; only the keys in `lobbySettings` when it is set): `{ key, label, type: 'segmented'|'stepper'|'toggle',
options?, min?, max?, step?, default, format?: 'inr'|'number'|'text', help? }`. A `stepper` with `options` shows quick-pick chips
beside the +/- buttons. Defaults and limits **must equal** the adapter's `validateSettings`: copy
`src/games/hyderabad-tycoon/settings.test.js`, which fails when schema and server drift apart.

**Rules editor** (optional, the host's full "Game rules" section; Nawabi Raj builds it from `shared/ruleSettings.js`): list `settingsGroups: [{ id, label, note? }]`
in the manifest and give fields a `group`. Fields without a group (the mode) become preset cards; the others render in collapsible groups (an accordion on a
phone, two columns on a wide card) with a reset per rule, "Reset all to defaults", a "Custom rules" badge and a read-only copy of the same list for everyone else. Extra field
keys: `slider: true` (a stepper with a slider; `scale: 'curve'` bends a wide range), `nullable: true` (an explicit "Off" chip), `format: 'seconds' | 'ms'`, `dependsOn: { key, defaults }`
(the preset that resets it). `note` is a string or `(settings) => string` shown under the group title. The edit logic (optimistic draft, debounce, the server's `room.settings`
as truth, an inline error for a refused patch) is `src/components/online/editSession.js`. The `summarize` line should end in `Custom rules (N)` when a rule differs from its default.

The only screen a game provides is `onlineGame`. A host creates a *private* table from the game page with the number of seats
picked from `players.min`..`players.max` and the schema defaults (`POST /api/rooms { gameId, maxPlayers, visibility: 'private', settings }`).
Online games use `useOnlineGame(code)` (`src/lib/session/useOnlineGame.js`) and the Tycoon `GameView` as a model: one `session`
object (`view`, `me`, `dispatch(action)`, `result`, `restart()`, `quit()`); the server redacts hidden state per viewer.

## 3. The server adapter

Start from `worker/games/hyderabad-tycoon.js`; the interface is documented at the top of `worker/games/index.js`
(`missingFromAdapter(adapter)` lists what is absent). Required: `id, name, minPlayers, maxPlayers, defaultSettings,
validateSettings(raw)`, `createGame({ players, settings, seed })`, `applyAction(state, action)` (**pure**; invalid -> same
state + `error`), `turnPlayerId(state)`, `deadlines(state)`, `idleAction(state, playerId)`,
`isOver(state)`, `result(state, meta)` -> `{ winnerId, reason, standings: [{ id, rank, score }] }`, `redact(state, viewerId)`. Optional hooks (`pendingPlayerIds`, `sanitizeAction`, `lobbySettings`, `summarize`, `customRules`, `turnMs`, `animationMs`, `resignAction`, `track`, `emotes`, ...) are listed in the header of `worker/games/index.js`; `GameRoom` runs the decision timer (60 s, or the adapter's `turnMs(state)`, e.g. a host-chosen time), the 15 s disconnect grace and the `deadlines` for you.
Treat every client value as hostile: `validateSettings` and `sanitizeAction` are allow-lists, never trust ids,
amounts or `playerId` from a message. State must be JSON-serialisable (no Infinity, Map or Set); randomness only via `seed`/`rnd`.

## 4. Register it

```js
// src/games/registry.js          (frontend)       // worker/games/index.js        (server)
import myGame from './my-game/manifest.js';         import myGame from './my-game.js';
const MANIFESTS = [tycoon, myGame, ...SOON_GAMES];  export const GAME_ADAPTERS = { ..., [myGame.id]: myGame };
```

Promoting a teaser: delete its file in `src/games/_soon/` and its line in `_soon/index.js`, then register the real manifest.
`getGame`, `/api/games`, the game page, the lobby, invites and the leaderboard tab pick the new game up automatically.

## 5. Database and stats (nothing to migrate)

A finished room is saved by `worker/match.js` from `result()`: `matches.game_id`, one `match_players` row per seat, and
`user_game_stats(user_id, game_id)` (games, wins, best_score = highest `score`, rating). XP and coins are platform-wide.
Rooms are listed from the `rooms` table, written by the Durable Object. Only add SQL if you need a new table, and keep it
additive and idempotent in `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

## 6. Art

Add `<Name>Cover` (16:9) and `<Name>Icon` (square) as inline SVG/CSS (no external assets) under `src/components/art/hub/` and
export them from its `index.js`. They take `className`/`style`, scale to their box and read well at 64 px and 640 px.

## 7. Testing checklist

- `npx vitest run src shared worker` green; add tests for the engine (rules, fuzz with random legal actions to game over), the adapter
  (`missingFromAdapter` is empty, `validateSettings`, `redact`, `idleAction` always has a move) and the manifest/schema.
- `npx vite build` passes; the game page is its own chunk and the manifest import stays small.
- Visual: game page, lobby (host and guest views), a few rounds, game over, at 390x844 and 1280x800; no console errors with
  the API down.
- Online: two browsers, a private room, disconnect and reconnect, AFK auto-play, a hostile client action rejected.

## 8. Game plugin checklist

| Piece | Where | Done when |
|---|---|---|
| Rules + auto-play chooser + tests | `shared/<id>/` | pure JS, deterministic from a seed, fuzzed to game over |
| Manifest | `src/games/<id>/manifest.js` | fields above, tagline <= 48 chars, no heavy imports |
| Settings schema | manifest + `settings.js` | equals `validateSettings`; test proves it |
| Online game | `OnlineGame.jsx` | joins `:code`, reconnects, leave works, results shown |
| Lobby settings | `manifest.lobbySettings` | optional: the lobby shows only these schema keys |
| Server adapter | `worker/games/<id>.js` | `missingFromAdapter` empty; strict validation; redaction |
| Registration | `registry.js`, `worker/games/index.js` | one line each |
| Art | `src/components/art/hub/` | cover + icon, dark and light backgrounds |
| Stats | `result().standings` | wins, best score, rating appear in Profile and the Leaderboard |
| QA | section 7 | all boxes ticked at both sizes |

## 9. A solo game (no room, no server adapter): Autowala is the reference

Not every game is an online table. A **solo** game is single-player and runs full screen on its own route. It needs a manifest and a screen; there is no `shared/<id>/`, no `worker/games/<id>.js` and no `OnlineGame.jsx`.

```
src/games/<id>/manifest.js    `solo: true`, `players: { min: 1, max: 1 }`, `modes: { friends: false, open: false }`,
                              `loaders: { soloGame: () => import('./Game.jsx') }` (default export, props `{ game }`), no `settings`
src/games/<id>/...            the game itself (Autowala: game/, render/, world/, sim/, gameplay/, audio/, ui/; see its ARCHITECTURE.md)
```

- The game screen lives at `paths.solo(id)` = `/play/<slug>` (route `/play/:gameId`, rendered by `src/pages/SoloGame.jsx`, full screen, dark game theme, no hub chrome). The game page shows "Play now" instead of "Create table".
- **The hub's CSP applies** (`public/_headers`: `script-src 'self'`, `connect-src 'self'`, no `unsafe-eval`): bundle dependencies with Vite (Autowala uses `three`, lazy-loaded with the screen), no CDN, no inline script, no external fonts or audio, and never a secret in client code.
- Scores: if the game saves them (see the run API below) give the manifest `stats` (and optional `badges`): a solo game with `stats` gets a leaderboard tab, profile stats and a Leaderboard section on its page (`rankedList()` in `src/platform/home/catalog.js`); one without stays out of them. Solo games are never offered in "Invite to game". The Browse "Players: 1" filter finds them.
- Art, tags, the store-listing fields and registration are the same as for any game (sections 2, 4 and 6); leave out `ageRating`, `released` and anything you cannot state truthfully.

### Solo games: the run API

A solo game can save a finished run ("shift", "lap", ...) to the player's stats, earn XP and coins and appear on its own leaderboard. Register it in `worker/games/solo.js` (`SOLO_GAMES`, keyed by id; deliberately **not** in `GAME_ADAPTERS`, so it can never be created as a room) with its limits: `{ id, name, minSeconds, maxSeconds, maxEarnPerSecond, earnGrace, winEarned, maxDistancePerSecond, maxQuests }` (Autowala: 30, 7200, 25, 1500, 3000, 60, 200). Any signed-in user, guests included, may play.

1. `POST /api/solo/:gameId/start` -> `{ ok, token, seed, expiresAt }`. `token` is a 3-hour signed token (claims `sub`, `gid`, `jti`, `seed`, `iat`; its own audience, so it is never a session). `seed` is a random 32-bit integer for the game's world / quest RNG.
2. `POST /api/solo/:gameId/finish { token, earned, seconds, distance, quests, fares, style }` -> `{ ok, duplicate, earned, newBest, bestScore, games, wins, xp, coins, level }` (`xp` / `coins` = what this run paid, `level` = the player's level afterwards). Every number must be a whole number from 0 to 1,000,000,000 (else 400). Other refusals: 401 bad / expired token, 403 token of another player, 400 token of another game, 422 implausible run.
3. A run is plausible when `minSeconds <= seconds <= maxSeconds`, `seconds <= (now - iat) + 5` (no claiming more play time than has passed), `earned <= seconds * maxEarnPerSecond + earnGrace`, `distance <= seconds * maxDistancePerSecond` and `quests <= maxQuests`.
4. **A token finishes once.** Its `jti` is the id of the run's `matches` row (`room_code 'solo'`, one `match_players` row), so a replay is a no-op that answers with the stored outcome and `duplicate: true` and awards nothing.
5. A finished run does `user_game_stats`: `games + 1`, `wins + 1` when `earned >= winEarned`, `best_score = GREATEST(...)`, totals of quests / fares / distance / seconds / style in `extra` (rating is left alone: solo games are unrated). Rewards (`soloRewards` in `worker/xp.js`): `xp = min(120, 10 + floor(earned / 100) + quests * 5)`, `coins = min(60, floor(earned / 250) + quests * 2)`; coins get the live `coin_boost` multiplier. **Daily cap**: 600 xp and 300 coins (after the boost) from solo runs per IST day, summed from the player's solo matches of that day (each stores what it paid in `matches.win_reason` as JSON); a run past the cap still saves its stats and pays 0 for the excess. The achievement check runs after a first save; referral rewards do not (too cheap to fake). Solo runs never count towards seasons.
6. `GET /api/leaderboard?game=<id>` and `user.gameStats[<id>]` (`GET /api/me`) work for solo ids; the board is ranked by best score. `GET /api/games` still lists room games only.

**Scores are client-reported and only sanity-checked.** The server cannot see the game, so anyone who reads the client can send a plausible-looking run (the limits only make absurd ones, and unlimited farming, impossible). Do not give solo runs rewards that matter beyond the daily cap.

## 10. A solo tutorial that unlocks rooms (a hybrid game: Tiffin Centre is the reference)

A game can have a solo screen **and** private rooms. Typical use: a short scripted tutorial the host must finish before they can open a table. The hub does the gating from the manifest; it never names a game.

```js
// manifest.js
solo: true,                                  // a solo screen at paths.solo(id) = /play/<slug>
tutorial: { requiredForRooms: true },        // rooms stay locked until the tutorial is done (omit for "practice only")
players: { min: 2, max: 4 }, modes: { friends: true, open: false },
loaders: { soloGame: () => import('./Solo.jsx'), onlineGame: () => import('./OnlineGame.jsx') },
```

- **Pages.** A game with `solo: true` **and** `loaders.onlineGame` gets the normal room title page (not the solo one). `src/pages/SoloGame.jsx` renders any game that has `loaders.soloGame` (props `{ game }`), also when it has an online mode. The solo route is a plain link (full page load), never a router `<Link>`, see section 9.
- **The unlock.** `src/platform/game/tutorial.js`: `tutorialRequired(game)` (= `game.tutorial?.requiredForRooms === true`), `tutorialDone(user, game, storage = localStorage)` and `roomsLocked(user, game)` (= required and not done). A tutorial is done when the server says so (`user.gameStats[id].tutorialDone === true` from `GET /api/me`) **or** this browser says so (`localStorage['jalebi.tutorial.v1.<id>'] === '1'`, `tutorialKey(id)`). On finishing, the game screen must do both: write the local key (instant unlock, also works offline and for a signed-out visitor) and report it to the server (`POST /api/games/:gameId/tutorial/complete`, see `worker/games/tutorial.js`; the same flag is what the adapter's `canHost` checks, so a hostile client cannot skip the lock).
- **While locked** the game page shows **Play tutorial** (a plain link to `paths.solo(id)`) instead of Create table, hides join-with-a-code, invite, the table setup, the open tables and the phone bar, and says "Finish the tutorial to open a table with friends"; the home hero's Play opens the tutorial and hides "Invite friends"; `inviteGames(user)` leaves the game out. **When unlocked** the page offers Create table (primary) and **Play solo / practice** (a link to the same solo route). Joining a friend's table never needs the tutorial.
- **Refresh.** After the tutorial the unlock shows without a reload: `UserRefresh` in `src/App.jsx` re-reads `/api/me` whenever the player leaves a `/play/*` route in the app, and the local key covers the same browser immediately. A game that leaves with a full page load re-reads `/api/me` on boot anyway.
- **Server.** Add the id to `TUTORIAL_GAMES` (`worker/games/tutorial.js`), give the adapter `canHost({ env, user })`, and expose `tutorialDone` in `gameStats` of `/api/me`.
- A game without `tutorial.requiredForRooms` is untouched by all of this.
