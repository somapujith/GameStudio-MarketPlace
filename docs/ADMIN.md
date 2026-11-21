# Admin console and player notifications: contract

Platform-level operations for Jalebi Games (not game rules). The backend lives in `worker/`, the admin console at
`/admin`, the player-facing parts (gift notifications, announcement banner, suspended screen) in the hub shell.
This file is the contract between the worker and the two front ends. Change it first if a shape has to change.

## Roles and permissions

`users.role` is `'user'` (default), `'moderator'` or `'admin'`. Guests are never staff.

Bootstrap: the comma-separated `ADMIN_EMAILS` Worker variable (case-insensitive, trimmed) makes a signed-in Google
account with one of those emails an **admin** regardless of `users.role`. Set it as a Worker secret / in `.dev.vars`;
never commit real addresses.

| Permission | moderator | admin |
|---|---|---|
| View dashboard, users, user detail, rooms, matches, audit log | yes | yes |
| Ban / unban, rename, reset handle, send a message to a user | yes (not on staff) | yes (not on self) |
| Manage announcements | yes | yes |
| Give / take coins and XP, grant / revoke items | no | yes |
| Bulk grants | no | yes |
| Change roles | no | yes (not own role, never a guest) |

`GET /api/admin/me` returns the permission keys:
`view`, `moderate`, `announce`, `economy`, `bulk`, `roles`.

Every mutating admin endpoint writes one `admin_actions` row (who, what, target, details incl. the reason).

## Database (db/schema.sql, additive only: the migrate script refuses anything else)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';       -- 'user' | 'moderator' | 'admin'
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason text;

CREATE TABLE IF NOT EXISTS admin_actions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  admin_name  text NOT NULL,
  action      text NOT NULL,            -- see "Audit action names"
  target_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  target_name text,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_target_idx ON admin_actions (target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL,             -- 'gift' | 'message' | 'system'
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message    text NOT NULL,
  tone       text NOT NULL DEFAULT 'info',   -- 'info' | 'event' | 'warning'
  link_url   text,
  link_label text,
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,
  active     boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## Bans

A banned user (`banned_at IS NOT NULL`):
- gets `403 { error: 'Your account has been suspended.', code: 'banned', reason }` from every endpoint that loads
  the user (`requireUser`, `requireMember`) **and from `GET /api/me`**;
- cannot open `/ws/user` or `/ws/room/:code` (closed with code 4003, reason "Your account has been suspended.");
- receives `{ t: 'suspended', reason }` on the user socket at the moment of the ban (if online).
Public endpoints (config, games, leaderboard, announcements) keep working.

## Shared shapes

```ts
AdminUserRow = {
  id, name, handle: string|null, avatar: number, email: string|null, friendCode,
  isGuest: boolean, role: 'user'|'moderator'|'admin', banned: boolean,
  coins: number, xp: number, level: number, games: number, wins: number,
  createdAt: ISO, lastSeen: ISO
}
AdminUserDetail = AdminUserRow & {
  bannedAt: ISO|null, banReason: string|null, dailyStreak: number, bestWorth: number, rentEarned: number,
  equipped: { frame?, dice?, title? }, online: boolean
}
AuditEntry = { id: number, action: string, adminId: uuid|null, adminName, targetId: uuid|null, targetName: string|null,
               details: object, createdAt: ISO }
Announcement = { id, message, tone: 'info'|'event'|'warning', linkUrl: string|null, linkLabel: string|null,
                 startsAt: ISO, endsAt: ISO|null, active: boolean, createdAt: ISO }
Notification = { id, kind: 'gift'|'message'|'system', title, body: string|null,
                 data: { coins?, xp?, itemId?, itemName?, from? }, createdAt: ISO, read: boolean }
```

Errors are `{ error: string }` with 400 (validation), 401 (signed out), 403 (not staff / not allowed / banned),
404 (unknown user/item/announcement), 409 (conflict: would go negative, already owned, not owned).

## Admin API (`/api/admin/*`, staff only; mutating calls need the usual same-origin / bearer rules)

| Method + path | Body / query | Response | Who |
|---|---|---|---|
| GET `/me` | | `{ role, name, permissions: string[] }` | staff |
| GET `/stats` | | see below | staff |
| GET `/users` | `q` (name, handle, email, friend code, id), `filter` all\|members\|guests\|banned\|staff, `sort` newest\|last_seen\|coins\|level\|games, `page` (1-based), `pageSize` (≤100, default 25) | `{ users: AdminUserRow[], total, page, pageSize }` | staff |
| GET `/users/:id` | | `{ user: AdminUserDetail, items: [{ id, name, kind, rarity, acquiredAt, pricePaid }], friends: { count }, matches: [{ id, gameId, endedAt, rank, playerCount, finalWorth, won }] (latest 20), actions: AuditEntry[] (latest 50 on this user), notifications: Notification[] (latest 20), rooms: [{ code, gameId, status }] }` | staff |
| POST `/users/:id/coins` | `{ amount: int ≠0, |amount| ≤ 1,000,000, reason: 3–200 chars, notify?: bool=true }` | `{ coins }` (409 if the balance would go below 0) | admin |
| POST `/users/:id/xp` | `{ amount: int ≠0, |amount| ≤ 1,000,000, reason }` (xp floors at 0) | `{ xp, level }` | admin |
| POST `/users/:id/items` | `{ itemId, reason, notify?: bool=true }` | `{ owned: string[] }` (409 already owned / free item) | admin |
| DELETE `/users/:id/items/:itemId` | `?reason=` | `{ owned: string[] }` (also unequips it; 409 not owned) | admin |
| POST `/users/:id/ban` | `{ reason: 3–200 }` | `{ banned: true }` | moderator (not on staff) / admin (not self) |
| POST `/users/:id/unban` | `{ reason? }` | `{ banned: false }` | staff |
| POST `/users/:id/rename` | `{ name, reason }` (validateName rules) | `{ name }` | staff |
| POST `/users/:id/reset-handle` | `{ reason }` | `{ handle: null }` | staff |
| POST `/users/:id/role` | `{ role: 'user'\|'moderator'\|'admin' }` | `{ role }` | admin |
| POST `/users/:id/notify` | `{ title: 1–80, body?: ≤500 }` | `{ ok: true }` | staff |
| POST `/grants` | `{ audience: 'ids'\|'members'\|'active7d', ids?: uuid[] (≤500, when 'ids'), coins?: 1–100,000, itemId?, title?: ≤80, message?: ≤500, reason }` at least one of coins / itemId | `{ count }` users granted (items: only those who did not own it) | admin |
| GET `/rooms` | | `{ rooms: [{ code, gameId, hostName, status, visibility, playerCount, maxPlayers, members: [{ id, name, avatar }], createdAt, updatedAt }] }` (updated in the last 24 h) | staff |
| GET `/matches` | `page`, `pageSize` (≤50, default 20) | `{ matches: [{ id, gameId, roomCode, startedAt, endedAt, rounds, playerCount, winner: { id, name }\|null, players: [{ userId, name, rank, isBot, finalWorth }] }], total, page, pageSize }` | staff |
| GET `/actions` | `page`, `pageSize` (≤100, default 50), `targetId?`, `adminId?`, `action?` | `{ actions: AuditEntry[], total, page, pageSize }` | staff |
| GET `/announcements` | | `{ announcements: Announcement[] }` (all, newest first) | staff |
| POST `/announcements` | `{ message: 1–200, tone?, linkUrl?, linkLabel?: ≤40, startsAt?, endsAt?, active?: bool=true }` | `{ announcement }` | staff |
| PATCH `/announcements/:id` | any subset of the POST fields | `{ announcement }` | staff |
| DELETE `/announcements/:id` | | `{ ok: true }` | staff |

`linkUrl` is either a same-site path starting with `/` (not `//`) or an `https://` URL; anything else is 400.

`GET /stats` response:
```ts
{
  users:    { total, members, guests, banned, staff },
  signups:  { today, week },              // created_at in the last 24 h / 7 days (non-guests and guests)
  active:   { day, week },                // last_seen in the last 24 h / 7 days
  matches:  { today, week, total },
  rooms:    { live, lobby, playing },     // rooms updated in the last 24 h
  economy:  { coinsInCirculation, avgCoins, itemsOwned },   // members only for coins
  series:   { days: string[14] /* 'YYYY-MM-DD', oldest first */, signups: number[14], active: number[14], matches: number[14] },
  topCoins: [{ id, name, avatar, coins }]   // top 5 members
}
```
(`series.active` = users whose `last_seen` falls on that day: an approximation, labelled as such in the UI.)

## Audit action names

`coins`, `xp`, `item.grant`, `item.revoke`, `ban`, `unban`, `rename`, `handle.reset`, `role`, `notify`,
`grant.bulk`, `announcement.create`, `announcement.update`, `announcement.delete`.
`details` always carries `reason` when one was given, plus the values (e.g. `{ amount, before, after }`).

## Player-facing API

| Method + path | Response | Notes |
|---|---|---|
| GET `/api/announcements` | `{ announcements: Announcement[] }` | public; only active ones inside their window, newest first, at most 3; `Cache-Control: public, max-age=60` |
| GET `/api/notifications` | `{ notifications: Notification[] (latest 30), unread: number }` | requireUser |
| POST `/api/notifications/read` | `{ ids?: uuid[] } or { all: true }` → `{ unread }` | requireUser |
| GET `/api/me` | the user object gains `role: 'user'\|'moderator'\|'admin'` | effective role (ADMIN_EMAILS → 'admin') |

## Live messages on the user socket (`pushToUser`)

- `{ t: 'notification', notification: Notification }`: a gift or message was just created for this user.
- `{ t: 'wallet', coins?, xp?, level? }`: the balance changed by an admin action (refresh the coin chip).
- `{ t: 'items', owned: string[] }`: items were granted or revoked.
- `{ t: 'suspended', reason }`: the account was banned; show the suspended screen.

## Front-end routes

`/admin` (dashboard), `/admin/users`, `/admin/users/:id`, `/admin/rooms`, `/admin/matches`, `/admin/grants`,
`/admin/announcements`, `/admin/audit`. Non-staff visitors get a plain 404 (the console's existence is not advertised).
`paths.admin(section?)` builds them.

## Backend notes (worker/admin.js, worker/routes/admin.js, announcements.js, notifications.js)

Details the tables above leave open; no shape differs from them.

- **Who may moderate whom.** A moderator gets 403 `Moderators cannot <ban|unban|rename|reset the handle of|message> staff.`
  for any staff target (ADMIN_EMAILS admins included). The admin "not on self" rule is enforced for **ban**
  (`You cannot ban yourself.`) and **role** (`You cannot change your own role.`); an admin may rename or message
  themselves. An admin may ban another admin.
- **Roles.** `POST /users/:id/role` on a guest is 400 `Guests cannot be given a role.`; an unknown role is 400. The
  response is the *effective* role, so demoting an ADMIN_EMAILS account answers `{ role: 'admin' }`.
- **Common errors.** Bad `:id` 400 `Invalid user id.`; unknown user 404 `User not found.`; reason 400
  `Give a reason (3-200 characters).`; non-staff 403 `Staff only.`; staff without the permission 403
  `You do not have permission to do that.`; rate limit 429 `Too many requests, slow down.`; banned 403
  `{ error: 'Your account has been suspended.', code: 'banned', reason }` (`reason` may be null). Google sign-in of
  a suspended account also answers that 403 (the session cookie is still set, so a reload shows the suspended screen
  again; no bearer token is returned in cross-origin mode). Logout always works.
- **Economy.** Coins 409 `Not enough coins: the balance cannot go below 0.` XP also accepts `notify?`. Item grant: a
  non-string id 400 `Invalid item id.`, an unknown id 404 `Unknown item.`, a free item 409
  `Everyone already owns that item.`, owned 409 `Already owned.`. Revoke: `?reason=` is required (3-200),
  `&notify=false` is optional; a free item 409 `Free items cannot be taken away.`, not owned 409 `Not owned.`.
  Single-user notifications: `gift` for positive coins / XP and item grants, `system` for removals. Pushes:
  `notification` (unless `notify: false`) plus `wallet` (coins / XP) or `items` (grant / revoke).
- **Unban** is idempotent; `reason` is optional but, when given, must be 3-200 characters. **Reset handle** clears it;
  the player may claim a new one at once.
- **Notification `data.from`** is always `"<APP_NAME> team"` (e.g. `Jalebi Games team`), never a staff member's name,
  and admin reasons are never shown to players (they only go to the audit log).
- **Bulk grants.** `members` and `active7d` mean signed-in (non-guest), not banned accounts (`active7d`: `last_seen`
  in the last 7 days); `ids` is any existing account. Ids are de-duplicated. Without a `title` the notification says
  `You received N coins`, `You received <item>` or both, per user (someone who already owned the item gets the coins
  title). `message` becomes the body (default `A gift from the Jalebi Games team.`). The request body may be up to
  32 KB (500 ids do not fit the usual 16 KB cap). Rate limit 5 / minute.
- **Lists.** `GET /rooms` returns at most 200 rooms, `GET /announcements` (admin) at most 200. Unknown `filter` /
  `sort` / `action` values and malformed `targetId` / `adminId` are 400; junk `page` / `pageSize` fall back to the
  defaults and `pageSize` is capped. `q` (max 100 characters) is an exact id match when it is a uuid.
- **Announcements.** Bad link 400 `The link must be a path starting with / or an https:// address.` (also refused:
  whitespace, backslashes, `user:pass@`). `endsAt` must be after `startsAt` (400 `The end must be after the start.`).
  PATCH accepts `endsAt: null` / `linkUrl: null` to clear them. Unknown id 404 `Announcement not found.`, malformed 400.
- **Player notifications.** `POST /api/notifications/read` takes at most 100 ids (400 otherwise, and 400 for a body
  with neither `ids` nor `all: true`). Guests have an inbox too (requireUser).
- **Rate limits.** Admin reads 120 / minute, writes 60 / minute, bulk 5 / minute; notifications 60 / minute;
  public announcements 120 / minute.
- **Extra indexes** (db/schema.sql): `users_banned_idx`, `users_staff_idx` (partial), `users_created_idx`,
  `admin_actions_admin_idx`, `announcements_live_idx` (partial).
