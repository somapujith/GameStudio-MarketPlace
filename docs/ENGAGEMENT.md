# Achievements, referrals and seasonal events: contract

Player-engagement features for Jalebi Games, all controllable from the admin console. Builds on docs/ADMIN.md
(notifications, `pushToUser` messages, audit log, roles). This file is the contract between the worker, the player UI and
the admin console. Change it first if a shape has to change.

## 1. Achievements and badges

Catalogue in `shared/achievements.js` (shared by worker and client; display copy lives there too):

```js
{ id, name, description, icon /* HubIcon name */, category: 'play'|'streak'|'collection'|'social',
  goal: number /* the target for progress bars, e.g. 10 */, metric /* see below */,
  reward: { coins?: number, itemId?: string /* an achievement-only cosmetic */ } }
```

| id | name | condition (metric >= goal) | reward |
|---|---|---|---|
| `first-win` | First Win | wins (all games) ≥ 1 | 200 coins |
| `regular` | Regular | matches played ≥ 10 | 300 coins |
| `champion` | Champion | wins ≥ 10 | title `title-champion` + 300 coins |
| `on-a-roll` | On a Roll | daily streak ≥ 3 | 100 coins |
| `ten-day-streak` | Ten Day Streak | daily streak ≥ 10 | frame `frame-streak` + 500 coins |
| `full-set` | Full Set | completed a whole district colour set in one Nawabi Raj match | 250 coins |
| `set-collector` | Set Collector | completed 3 sets in one match | title `title-collector` |
| `tycoon` | Tycoon | finished a match with net worth ≥ 40,00,000 | 400 coins |
| `adda-regular` | Adda Regular | 5 accepted friends | 200 coins |
| `recruiter` | Recruiter | 1 referred friend played their first match | title `title-recruiter` + 300 coins |
| `level-10` | Level 10 | level ≥ 10 | 500 coins |

Metrics: `wins`, `games` (sums over `user_game_stats`), `streak` (`users.daily_streak`), `friends` (accepted friendships),
`level` (from xp), `referrals` (rewarded referrals), and per-match facts `setsCompleted` / `finalWorth` (checked when a match
is persisted; a match counts only when the player finished it).

Storage: `user_achievements (user_id, achievement_id, unlocked_at, PRIMARY KEY (user_id, achievement_id))`.

Unlocking is server-side only, idempotent (`INSERT ... ON CONFLICT DO NOTHING RETURNING`), and the reward is granted only for
a row that was actually inserted. Checks run after: a match is persisted (every human player), a daily claim, a friend
request accepted (both sides), a referral reward (referrer). Guests can unlock achievements (they are kept if they upgrade).

Achievement-only cosmetics are added to `shared/cosmetics.js` with `source: 'achievement'` (never buyable).
`title-champion`, `title-collector`, `title-recruiter` (titles) and `frame-streak` (frame) are new.

Unlock = one notification `kind: 'achievement'`, `data: { achievementId, coins?, itemId?, itemName? }`, plus the usual
`wallet` / `items` socket pushes.

### Game stat needed
The Nawabi Raj adapter's `result()` must report `stats.setsCompleted` per player: the number of distinct colour groups the
player completed at any point in the match (track `set_complete` events in room meta, like `hotels` is tracked today).

## 2. Referral rewards

- A player's referral code is their friend code (`HYD-XXXX`). Their link is `/?ref=HYD-XXXX`; a friend link `/f/HYD-XXXX`
  counts too.
- The client remembers the first ref it sees (`localStorage` key `jg-ref`, value `{ code, at }`, kept 30 days) and sends it
  as `ref` in `POST /api/auth/google { credential, ref }`.
- The server stores `users.referred_by` only when the Google account is **created** by that call. It is never set on an
  existing account. The ref must resolve to a non-guest, non-banned user other than the new user.
- Reward: when the referred user's **first** match is persisted, both get `REFERRAL_COINS = 250` coins, as notifications of
  `kind: 'gift'` with `data: { coins, referral: { name } }`. Then `users.referral_rewarded_at` is set, so it pays once. The
  referrer's `recruiter` achievement is checked too.
- Cap: a referrer is paid for at most 20 referrals per rolling 30 days. Beyond that only the new player gets coins.
- Guests are never referred.

`GET /api/me/referrals` (requireMember) →
`{ code, link, invited, rewarded, coinsEarned, recent: [{ name, avatar, joinedAt, rewarded: boolean }] (latest 10) }`.

## 3. Seasonal events and seasons

### Events (`events` table): time-boxed switches the admin turns on

| kind | config | effect |
|---|---|---|
| `coin_boost` | `{ multiplier: 1.5..3 }` | multiplies the **match** coin reward while live (highest multiplier wins if several overlap) |
| `limited_shop` | `{ itemIds: string[] }` | those `source: 'event'` cosmetics are buyable in the shop only while live |

An event is live when `active AND starts_at <= now() < ends_at`.

The persisted match reward uses the multiplier live at `ended_at`. `matches.coin_multiplier numeric NOT NULL DEFAULT 1`
records it.

New limited cosmetics in `shared/cosmetics.js` carry `source: 'event'` and a price. At least two: a festive frame and a
festive dice finish, using existing kinds and fields so the art already renders.

### Seasons (`seasons` table): a points race with prize tiers

- Points come from matches **ended inside the season window**: `points = 3 * wins + 1 * games`. Ties break by more wins,
  then the earlier last match.
- Only non-guest, non-banned users are ranked.
- `prize_tiers`: an array of `{ fromRank, toRank, coins?, itemId? }` (non-overlapping, ranks 1-based). Season prize items
  are cosmetics with `source: 'season'`. Add `title-season-champ` (rank 1) and `frame-season` (top 10).
- Status is derived: `scheduled` before start, `active` inside the window, `ended` after `ends_at` until paid, `paid` once
  `paid_at` is set.
- Payout (admin action, after the season ends):
  - Computes final standings and writes `season_results (season_id, user_id, rank, points, prize jsonb)`.
  - Grants coins and items set-based, with item grants `ON CONFLICT DO NOTHING`.
  - Inserts one `kind: 'gift'` notification per winner, with `data: { coins?, itemId?, itemName?, season: { id, name, rank } }`.
  - Sets `paid_at`, guarded with `UPDATE seasons SET paid_at = now() WHERE id = $1 AND paid_at IS NULL AND ends_at <= now()
    RETURNING id`, so it can never pay twice.

### Database (append to db/schema.sql; additive only)
```sql
CREATE TABLE IF NOT EXISTS user_achievements (user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  achievement_id text NOT NULL, unlocked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, achievement_id));
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamptz;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS coin_multiplier numeric NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, name text NOT NULL,
  description text, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_window_idx ON events (starts_at, ends_at);
CREATE TABLE IF NOT EXISTS seasons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, prize_tiers jsonb NOT NULL DEFAULT '[]',
  paid_at timestamptz, created_by uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS season_results (season_id uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE, rank integer NOT NULL, points integer NOT NULL,
  wins integer NOT NULL DEFAULT 0, games integer NOT NULL DEFAULT 0,
  prize jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (season_id, user_id));
```
(`season_results.wins / games` were added so a paid season's table still has the SeasonRow numbers. `matches_ended_idx`
already exists on `matches (ended_at DESC)`, so it is not repeated. Extra indexes: `user_achievements_achievement_idx`,
`season_results_rank_idx`.)

## Shapes

```ts
Achievement = { id, name, description, icon, category, goal, reward: { coins?, itemId?, itemName? },
                progress: number|null /* null when signed out */, unlocked: boolean, unlockedAt: ISO|null }
LiveEvent   = { id, kind: 'coin_boost'|'limited_shop', name, description: string|null, startsAt: ISO, endsAt: ISO,
                config: { multiplier? : number, itemIds?: string[] } }
Season      = { id, name, startsAt: ISO, endsAt: ISO, status: 'scheduled'|'active'|'ended'|'paid',
                prizeTiers: [{ fromRank, toRank, coins?, itemId?, itemName? }] }
SeasonRow   = { rank, userId, name, avatar, points, wins, games, equipped: { frame?, title? }, isMe: boolean }
```

## Player API

| Method + path | Response | Auth |
|---|---|---|
| GET `/api/achievements` | `{ achievements: Achievement[], unlocked: number, total: number }` | optional (progress only when signed in) |
| GET `/api/me/referrals` | see section 2 | member |
| GET `/api/events/live` | `{ events: LiveEvent[], coinMultiplier: number /* 1 when none */ }` | public, `Cache-Control: public, max-age=60` |
| GET `/api/seasons/current` | `{ season: Season\|null, standings: SeasonRow[] (top 50), me: { rank, points, wins, games }\|null }`. The current season is the active one, else the most recent ended or paid one, else the next scheduled one. | optional |
| GET `/api/seasons/:id` | same shape for a past season; `standings` from `season_results` once paid | optional |
| GET `/api/shop` (changed) | each item gains `source: 'shop'\|'achievement'\|'event'\|'season'`, `available: boolean` (buyable right now), `availableUntil: ISO\|null` (the live limited event's end) and `unlockHint: string\|null` (e.g. "Unlock: Champion achievement") | as today |
| POST `/api/shop/buy` (changed) | an item that is not `available` → `409 { error: 'Not available right now.' }` | as today |
| POST `/api/auth/google` (changed) | body may carry `ref` | |

Matches report the multiplier: `GET /api/me` and other existing match shapes are unchanged. The in-game results screen may
show "×2 coins" from `GET /api/events/live` (best effort).

## Admin API (extends docs/ADMIN.md; audit every write)

| Method + path | Body | Response | Who |
|---|---|---|---|
| GET `/api/admin/events` | | `{ events: (LiveEvent & { active, createdAt, live: boolean })[] }` | staff |
| POST `/api/admin/events` | `{ kind, name 1–60, description? ≤200, startsAt, endsAt (> startsAt, ≤ 31 days long), active?, config }` (validated per kind: multiplier 1.5–3 in 0.5 steps; itemIds must be `source: 'event'` cosmetics) | `{ event }` | admin |
| PATCH `/api/admin/events/:id` | subset | `{ event }` | admin |
| DELETE `/api/admin/events/:id` | | `{ ok: true }` | admin |
| GET `/api/admin/seasons` | | `{ seasons: (Season & { createdAt, paidAt })[] }` | staff |
| POST `/api/admin/seasons` | `{ name 1–60, startsAt, endsAt, prizeTiers }` (tiers non-overlapping, ranks 1–1000, coins ≤ 100,000, items `source: 'season'` or any cosmetic) | `{ season }` | admin |
| PATCH `/api/admin/seasons/:id` | subset; not after payout | `{ season }` | admin |
| GET `/api/admin/seasons/:id/standings` | | `{ season, standings: SeasonRow[] (top 100), prizesPreview: [{ rank, userId, name, coins?, itemId? }] }` | staff |
| POST `/api/admin/seasons/:id/payout` | `{ confirm: true }` | `{ paid: number }` (409 if not ended yet or already paid) | admin |
| GET `/api/admin/achievements` | | `{ achievements: [{ id, name, unlocked: number }], members: number }` | staff |
| POST `/api/admin/users/:id/achievements` | `{ achievementId, reason }` (unlocks + pays the reward like a real unlock) | `{ unlocked: true }` (409 already) | admin |
| GET `/api/admin/referrals` | | `{ top: [{ id, name, avatar, invited, rewarded }] (top 20), recent: [{ referrer: { id, name }, invitee: { id, name }, joinedAt, rewarded }] (latest 50), totals: { invited, rewarded, coinsPaid } }` | staff |

Audit actions: `event.create|update|delete`, `season.create|update|payout`, `achievement.grant`.

## Admin console screens (new sidebar entries)
**Events** (list + create/edit, live badge, coin-boost multiplier, limited-item picker), **Seasons** (list, create with a prize-tier
editor, live standings, a payout preview, and a confirmed payout), **Achievements** (unlock counts and rates), **Referrals** (top
referrers, recent referrals, totals). On a user's detail page: their achievements, their referrer and the people they referred,
and a "Grant achievement" action.

## Player screens
- Profile: an Achievements grid (unlocked, locked with progress, and reward chips) and a Referral card (link, copy/share/WhatsApp,
  counts, recent invites).
- Leaderboard: a **Season** tab: name, countdown, prize tiers, standings with my rank. It must keep the viewport-fit layout
  (see `src/platform/home/leaderboard-*.css`).
- Shop: limited items with a countdown badge; achievement and season items show a lock and their unlock hint.
- Hub: a live-event chip or banner ("Double coins till Sunday") from `/api/events/live`.
- The gift popup handles `kind: 'achievement'` with a badge-unlocked treatment.

## Backend notes (worker/achievements.js, referrals.js, events.js, seasons.js and their routes)

Details the tables above leave open, and the small deviations.

- **Notifications.** `rowToNotification` knows the kind `'achievement'` (title `Achievement unlocked: <name>`, body = the
  achievement's description, `data { achievementId, coins?, itemId?, itemName? }`). Referral gifts carry
  `data.referral = { name, role: 'invitee'|'referrer' }` (name = the other person); `role` is additive and is what
  `coinsEarned` / `coinsPaid` sum. Season gifts: title `Season prize: <season>`, body `You finished #<rank> in <season>.`.
  Every reward pushes `notification`, then `wallet { coins }` and / or `items { owned }`.
- **When achievements are checked.** Only on the triggers in section 1 (match persisted, daily claim, friend accepted,
  including a mutual request that auto-accepts, referral reward, admin grant); `GET /api/achievements` never unlocks, so a
  veteran whose numbers already qualify unlocks at their next trigger. All checks are best effort: they never fail the
  match write, the claim or the accept. `POST /api/me/daily` keeps its response; an achievement reward arrives as pushes.
- **Progress.** `min(metric, goal)`; the per-match achievements (`full-set`, `set-collector`, `tycoon`) are all or nothing
  (`goal` once unlocked, else 0). A match counts for them only when the player did not forfeit (resign).
- **Referrals.** `link` is a site path (`/?ref=HYD-XXXX`): prefix the page origin. A `ref` that is not a string, is over
  40 characters or is not a friend code is ignored without a query; self / guest / banned / unknown codes are ignored by the
  SQL. A failing referral write never fails the sign-in. The cap counts every rewarded referral of the last 30 days, paid
  or not (so a referrer is never paid more than 20 in any 30 days). A banned referrer is not paid (the invitee still is).
- **Coin boost.** Match coins only (`Math.round(coins * m)`), never XP, daily or other rewards; a failed multiplier lookup
  counts as 1. `persistMatch` resolves to `{ inserted, coinMultiplier }`.
- **Shop.** `available` ignores ownership (an owned shop item is still `available: true`; `owned` says it is owned).
  Shop items: `available: true, availableUntil: null, unlockHint: null`. Event items on sale: `availableUntil` = the latest
  end of the live events listing them, `unlockHint: null`; off sale: `unlockHint: 'Limited: on sale during special events'`.
  Achievement items: `Unlock: <Achievement name> achievement`. Season items: `Season prize: finish 1st in a season`
  (`title-season-champ`), `Season prize: finish in a season's top 10` (`frame-season`). Buy order of checks: unknown 400,
  free 409 `Already owned.`, not available 409 `Not available right now.`, then the usual 402 / 409.
- **Events (admin).** Errors (400): `Kind must be coin_boost or limited_shop.`, `Name must be 1-60 characters.`,
  `Description must be 1-200 characters.`, `Start must be a date and time.` / `End ...`, `The end must be after the start.`,
  `An event can last at most 31 days.`, `config must be an object.`, `The multiplier must be 1.5, 2, 2.5 or 3.`,
  `Pick at least one limited item.`, `At most 20 limited items.`, `Only limited event items can be sold in a limited shop.`,
  `active must be true or false.`; bad id 400 `Invalid event id.`, unknown 404 `Event not found.`. Config is cleaned to the
  kind's key (item ids de-duplicated). PATCH validates the merged event (changing `kind` needs a matching `config`).
  `GET /api/admin/events` returns at most 200, newest start first. `GET /api/events/live` returns at most 50.
- **Seasons (admin).** Errors (400): `Name must be 1-60 characters.`, `The end must be after the start.`,
  `prizeTiers must be a list.`, `At most 20 prize tiers.`,
  `Each prize tier needs whole-number ranks from 1 to 1000 (fromRank <= toRank).`, `Prize tiers must not overlap.`,
  `Prize coins must be a whole number from 1 to 100,000.`, `Unknown prize item.` (also for a free item),
  `Each prize tier needs coins, an item or both.`; tiers are stored sorted by `fromRank`. Bad id 400 `Invalid season id.`,
  unknown 404 `Season not found.`. PATCH / payout after the payout 409 `This season has already been paid out.`; payout
  before `ends_at` 409 `The season has not ended yet.`; payout without `confirm: true` 400
  `Send { confirm: true } to pay out the season.`. The payout statement is also guarded by the stored tiers, so a tier edit
  racing the payout makes it a 409 instead of paying the old tiers. `paid` = winners who received coins or a new item;
  live pushes go to at most 100 of them (the rest see the gift on their next load). `prizesPreview` rows also carry
  `itemName`, and cover every prize rank (not only the top 100). Standings ranks are unique (`row_number`; the last
  tie-break is the user id) so a tier never splits a tie. `SeasonRow.equipped` has only `frame` / `title`.
- **Achievements (admin).** `unlocked` counts members only (rates are over `members`). Grant: non-string id 400
  `Invalid achievement id.`, unknown 404 `Unknown achievement.`, reason 400 `Give a reason (3-200 characters).`, unknown user
  404 `User not found.`, already unlocked 409 `Already unlocked.`; guests and banned users can be granted. Audit details:
  `{ reason, achievementId, achievementName, coins?, itemId?, itemName? }`.
- **User detail.** `GET /api/admin/users/:id` gains `achievements: [{ id, name, unlockedAt }]` (newest first) and
  `referral: { referrer: { id, name }|null, invitedCount, invited: [{ id, name, joinedAt, rewarded }] (latest 50) }`.
- **Referrals (admin).** `coinsPaid` sums every referral gift (both sides).
- **Rate limits.** `GET /api/events/live` 120 / minute, `/api/seasons/*` 60, `/api/achievements` 60, `/api/me/referrals` 60;
  the admin endpoints use the admin read / write limits.
