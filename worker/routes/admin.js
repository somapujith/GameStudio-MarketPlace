// Admin console API (/api/admin/*, docs/ADMIN.md). Staff only (requireStaff); economy, bulk grants and roles are
// admin only. Every mutating endpoint writes one admin_actions row. Coins / XP / items are money-like: each change is
// one atomic SQL statement, with the audit row written by a CTE of the same statement.
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { readJson } from '../http.js';
import { limit } from '../ratelimit.js';
import { isUuid, validateName } from '../validate.js';
import { USER_COLUMNS, getUserById, rowEquipped } from '../users.js';
import { levelFromXp } from '../xp.js';
import { pushToUser, isUserOnline, background } from '../hub.js';
import { FREE_COSMETICS, cosmeticById } from '../../shared/cosmetics.js';
import { ownedList } from './shop.js';
import { adminAnnouncements } from './announcements.js';
import { adminEvents } from './events.js';
import { adminSeasons } from './seasons.js';
import { adminEngagement, userEngagement } from './adminEngagement.js';
import {
  ROLES,
  effectiveRole,
  adminEmails,
  permissionsFor,
  requireStaff,
  requirePermission,
  requireAdmin,
  assertCanModerate,
  parseText,
  parseReason,
  parseAmount,
  parseNotify,
  parsePage,
  escapeLike,
  AUDIT_ACTIONS,
  rowToAudit,
  rowToNotification,
  NOTIFICATION_COLUMNS,
  tellUser,
  senderName,
  writeAudit,
  iso,
  asObject,
} from '../admin.js';

const admin = new Hono();

// Rate limits first (cheap), then the staff check. Reads 120/min, writes 60/min per staff member.
const readLimit = limit('admin-read', 120, 60);
const writeLimit = limit('admin-write', 60, 60);
admin.use('*', (c, next) => (c.req.method === 'GET' || c.req.method === 'HEAD' ? readLimit(c, next) : writeLimit(c, next)));
admin.use('*', requireStaff);

admin.route('/announcements', adminAnnouncements);
// docs/ENGAGEMENT.md: events, seasons, achievements, referrals and the per-user achievement grant.
admin.route('/events', adminEvents);
admin.route('/seasons', adminSeasons);
admin.route('/', adminEngagement);

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
};
const num = (v) => Number(v) || 0;

// ---------------------------------------------------------------- shapes

/** users row -> AdminUserRow. */
export function rowToAdminUser(r, env) {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle || null,
    avatar: num(r.avatar),
    email: r.email || null,
    friendCode: r.friend_code,
    isGuest: !!r.is_guest,
    role: effectiveRole(r, env),
    banned: !!r.banned_at,
    coins: num(r.coins),
    xp: num(r.xp),
    level: levelFromXp(r.xp),
    games: num(r.games),
    wins: num(r.wins),
    createdAt: iso(r.created_at),
    lastSeen: iso(r.last_seen),
  };
}

/** users row -> AdminUserDetail. */
export function rowToAdminUserDetail(r, env, online = false) {
  return {
    ...rowToAdminUser(r, env),
    bannedAt: iso(r.banned_at),
    banReason: r.ban_reason || null,
    dailyStreak: num(r.daily_streak),
    bestWorth: num(r.best_worth),
    rentEarned: num(r.rent_earned),
    equipped: rowEquipped(r),
    online: !!online,
  };
}

/** The `:id` user: 400 for a malformed id, 404 when there is no such user. */
async function targetUser(c) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid user id.');
  const row = await getUserById(c.env, id);
  if (!row) throw new HttpError(404, 'User not found.');
  return row;
}

/** The (admin_id, admin_name) pair of the acting staff member. */
const actor = (c) => [c.get('user').id, c.get('user').name];

// ---------------------------------------------------------------- me + stats

// GET /me -> { role, name, permissions }
admin.get('/me', (c) => {
  const role = c.get('role');
  return c.json({ role, name: c.get('user').name, permissions: permissionsFor(role) });
});

export const STATS_SQL = `
SELECT u.*, m.*, r.*, (SELECT count(*) FROM user_items)::int AS items_owned
  FROM (SELECT count(*)::int AS users_total,
               (count(*) FILTER (WHERE is_guest = false))::int AS users_members,
               (count(*) FILTER (WHERE is_guest = true))::int AS users_guests,
               (count(*) FILTER (WHERE banned_at IS NOT NULL))::int AS users_banned,
               (count(*) FILTER (WHERE is_guest = false AND (role IN ('moderator', 'admin') OR lower(trim(email)) = ANY($1::text[]))))::int AS users_staff,
               (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS signups_today,
               (count(*) FILTER (WHERE created_at > now() - interval '7 days'))::int AS signups_week,
               (count(*) FILTER (WHERE last_seen > now() - interval '24 hours'))::int AS active_day,
               (count(*) FILTER (WHERE last_seen > now() - interval '7 days'))::int AS active_week,
               (coalesce(sum(coins) FILTER (WHERE is_guest = false), 0))::bigint AS coins_total,
               (coalesce(round(avg(coins) FILTER (WHERE is_guest = false)), 0))::bigint AS coins_avg
          FROM users) u,
       (SELECT (count(*) FILTER (WHERE ended_at > now() - interval '24 hours'))::int AS matches_today,
               (count(*) FILTER (WHERE ended_at > now() - interval '7 days'))::int AS matches_week,
               count(*)::int AS matches_total
          FROM matches) m,
       (SELECT count(*)::int AS rooms_live,
               (count(*) FILTER (WHERE status = 'lobby'))::int AS rooms_lobby,
               (count(*) FILTER (WHERE status = 'playing'))::int AS rooms_playing
          FROM rooms
         WHERE updated_at > now() - interval '24 hours') r`;

// The last 14 UTC days, oldest first, each with signups (created_at), active (last_seen: an approximation) and matches.
export const SERIES_SQL = `
WITH days AS (
  SELECT d::date AS day
    FROM generate_series((now() AT TIME ZONE 'UTC')::date - 13, (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS d
), since AS (
  SELECT (((now() AT TIME ZONE 'UTC')::date - 13)::timestamp AT TIME ZONE 'UTC') AS t
)
SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
       coalesce(s.n, 0)::int AS signups,
       coalesce(a.n, 0)::int AS active,
       coalesce(m.n, 0)::int AS matches
  FROM days
  LEFT JOIN (SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
               FROM users, since WHERE created_at >= since.t GROUP BY 1) s ON s.day = days.day
  LEFT JOIN (SELECT (last_seen AT TIME ZONE 'UTC')::date AS day, count(*) AS n
               FROM users, since WHERE last_seen >= since.t GROUP BY 1) a ON a.day = days.day
  LEFT JOIN (SELECT (ended_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
               FROM matches, since WHERE ended_at >= since.t GROUP BY 1) m ON m.day = days.day
 ORDER BY days.day`;

export const TOP_COINS_SQL = 'SELECT id, name, avatar, coins FROM users WHERE is_guest = false ORDER BY coins DESC, id LIMIT 5';

// GET /stats
admin.get('/stats', async (c) => {
  const [[s = {}], series, top] = await Promise.all([
    query(c.env, STATS_SQL, [adminEmails(c.env)]),
    query(c.env, SERIES_SQL),
    query(c.env, TOP_COINS_SQL),
  ]);
  return c.json({
    users: { total: num(s.users_total), members: num(s.users_members), guests: num(s.users_guests), banned: num(s.users_banned), staff: num(s.users_staff) },
    signups: { today: num(s.signups_today), week: num(s.signups_week) },
    active: { day: num(s.active_day), week: num(s.active_week) },
    matches: { today: num(s.matches_today), week: num(s.matches_week), total: num(s.matches_total) },
    rooms: { live: num(s.rooms_live), lobby: num(s.rooms_lobby), playing: num(s.rooms_playing) },
    economy: { coinsInCirculation: num(s.coins_total), avgCoins: num(s.coins_avg), itemsOwned: num(s.items_owned) },
    series: {
      days: series.map((d) => d.day),
      signups: series.map((d) => num(d.signups)),
      active: series.map((d) => num(d.active)),
      matches: series.map((d) => num(d.matches)),
    },
    topCoins: top.map((u) => ({ id: u.id, name: u.name, avatar: num(u.avatar), coins: num(u.coins) })),
  });
});

// ---------------------------------------------------------------- users

export const USER_FILTERS = Object.freeze(['all', 'members', 'guests', 'banned', 'staff']);
export const USER_SORTS = Object.freeze({
  newest: 'created_at DESC, id',
  last_seen: 'last_seen DESC, id',
  coins: 'coins DESC, id',
  level: 'xp DESC, id',
  games: 'games DESC, id',
});
export const SEARCH_MAX = 100;

/**
 * The WHERE clause + params of GET /users. Only fixed fragments are concatenated; every value is a bound parameter.
 * `q`: an exact id when it is a uuid, otherwise ILIKE on name / handle / email / friend code (pattern escaped).
 */
export function buildUserFilter({ q, filter, emails }) {
  const params = [];
  const where = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (filter === 'members') where.push('is_guest = false');
  else if (filter === 'guests') where.push('is_guest = true');
  else if (filter === 'banned') where.push('banned_at IS NOT NULL');
  else if (filter === 'staff') where.push(`is_guest = false AND (role IN ('moderator', 'admin') OR lower(trim(email)) = ANY(${p(emails)}::text[]))`);
  if (q) {
    if (isUuid(q)) {
      where.push(`id = ${p(q.toLowerCase())}::uuid`);
    } else {
      const pat = p(`%${escapeLike(q)}%`);
      where.push(`(name ILIKE ${pat} ESCAPE '\\' OR handle ILIKE ${pat} ESCAPE '\\' OR email ILIKE ${pat} ESCAPE '\\' OR friend_code ILIKE ${pat} ESCAPE '\\')`);
    }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// GET /users?q=&filter=&sort=&page=&pageSize= -> { users, total, page, pageSize }
admin.get('/users', async (c) => {
  const filter = c.req.query('filter') || 'all';
  if (!USER_FILTERS.includes(filter)) throw new HttpError(400, 'Unknown filter.');
  const sort = c.req.query('sort') || 'newest';
  if (!Object.hasOwn(USER_SORTS, sort)) throw new HttpError(400, 'Unknown sort.');
  const q = (c.req.query('q') || '').trim().slice(0, SEARCH_MAX);
  const { page, pageSize, offset } = parsePage(c.req.query('page'), c.req.query('pageSize'), { def: 25, max: 100 });
  const { where, params } = buildUserFilter({ q, filter, emails: adminEmails(c.env) });
  const n = params.length;
  const [rows, [count]] = await Promise.all([
    query(c.env, `SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY ${USER_SORTS[sort]} LIMIT $${n + 1}::int OFFSET $${n + 2}::int`, [...params, pageSize, offset]),
    query(c.env, `SELECT count(*)::int AS total FROM users ${where}`, params),
  ]);
  return c.json({ users: rows.map((r) => rowToAdminUser(r, c.env)), total: num(count && count.total), page, pageSize });
});

export const DETAIL_ITEMS_SQL = 'SELECT item_id, price_paid, acquired_at FROM user_items WHERE user_id = $1::uuid ORDER BY acquired_at DESC, item_id LIMIT 500';
export const DETAIL_FRIENDS_SQL = "SELECT count(*)::int AS n FROM friendships WHERE status = 'accepted' AND (user_id = $1::uuid OR friend_id = $1::uuid)";
export const DETAIL_MATCHES_SQL = `
SELECT m.id, m.game_id, m.ended_at, m.player_count, m.winner_id, mine.rank, mine.final_worth
  FROM match_players mine
  JOIN matches m ON m.id = mine.match_id
 WHERE mine.user_id = $1::uuid
 ORDER BY m.ended_at DESC, m.id DESC
 LIMIT 20`;
export const AUDIT_COLUMNS = 'id, action, admin_id, admin_name, target_id, target_name, details, created_at';
export const DETAIL_ACTIONS_SQL = `SELECT ${AUDIT_COLUMNS} FROM admin_actions WHERE target_id = $1::uuid ORDER BY created_at DESC, id DESC LIMIT 50`;
export const DETAIL_NOTIFICATIONS_SQL = `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE user_id = $1::uuid ORDER BY created_at DESC, id LIMIT 20`;
export const DETAIL_ROOMS_SQL = `
SELECT code, game_id, status FROM rooms
 WHERE member_ids @> ARRAY[$1::uuid] AND updated_at > now() - interval '24 hours'
 ORDER BY updated_at DESC
 LIMIT 20`;

// GET /users/:id -> { user, items, friends, matches, actions, notifications, rooms, achievements, referral }
admin.get('/users/:id', async (c) => {
  const row = await targetUser(c);
  const id = row.id;
  const [items, [friends], matches, actions, notifications, rooms, online, engagement] = await Promise.all([
    query(c.env, DETAIL_ITEMS_SQL, [id]),
    query(c.env, DETAIL_FRIENDS_SQL, [id]),
    query(c.env, DETAIL_MATCHES_SQL, [id]),
    query(c.env, DETAIL_ACTIONS_SQL, [id]),
    query(c.env, DETAIL_NOTIFICATIONS_SQL, [id]),
    query(c.env, DETAIL_ROOMS_SQL, [id]),
    isUserOnline(c.env, id),
    userEngagement(c.env, id),
  ]);
  return c.json({
    user: rowToAdminUserDetail(row, c.env, online),
    items: items.map((r) => {
      const item = cosmeticById(r.item_id);
      return {
        id: r.item_id,
        name: item ? item.name : r.item_id,
        kind: item ? item.kind : null,
        rarity: item ? item.rarity : null,
        acquiredAt: iso(r.acquired_at),
        pricePaid: num(r.price_paid),
      };
    }),
    friends: { count: num(friends && friends.n) },
    matches: matches.map((m) => ({
      id: m.id,
      gameId: m.game_id,
      endedAt: iso(m.ended_at),
      rank: num(m.rank),
      playerCount: num(m.player_count),
      finalWorth: num(m.final_worth),
      won: m.winner_id != null && m.winner_id === id,
    })),
    actions: actions.map(rowToAudit),
    notifications: notifications.map(rowToNotification),
    rooms: rooms.map((r) => ({ code: r.code, gameId: r.game_id, status: r.status })),
    // docs/ENGAGEMENT.md: achievements [{ id, name, unlockedAt }], referral { referrer, invitedCount, invited }
    ...engagement,
  });
});

// ---------------------------------------------------------------- economy (admin only)

const fmt = (n) => Math.abs(n).toLocaleString('en-US');
const isOverflow = (err) => err && err.code === '22003'; // numeric_value_out_of_range (integer columns)

export const COINS_SQL = `
WITH upd AS (
  UPDATE users SET coins = coins + $2::int
   WHERE id = $1::uuid AND coins + $2::int >= 0
  RETURNING id, name, coins
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'coins', upd.id, upd.name,
         jsonb_build_object('reason', $5::text, 'amount', $2::int, 'before', upd.coins - $2::int, 'after', upd.coins)
    FROM upd
  RETURNING id
)
SELECT coins FROM upd`;

export const COINS_NEGATIVE = 'Not enough coins: the balance cannot go below 0.';

// POST /users/:id/coins { amount, reason, notify? } -> { coins }   409 when the balance would go below 0
admin.post('/users/:id/coins', requireAdmin, async (c) => {
  const body = await readJson(c);
  const amount = parseAmount(body.amount);
  const reason = parseReason(body.reason);
  const notify = parseNotify(body.notify);
  const target = await targetUser(c);
  let row;
  try {
    [row] = await query(c.env, COINS_SQL, [target.id, amount, ...actor(c), reason]);
  } catch (err) {
    if (isOverflow(err)) throw new HttpError(409, 'That would make the balance too large.');
    if (err && err.code === '23514') throw new HttpError(409, COINS_NEGATIVE); // coins >= 0 CHECK (race)
    throw err;
  }
  if (!row) throw new HttpError(409, COINS_NEGATIVE);
  const coins = num(row.coins);
  const gift = amount > 0;
  await tellUser(
    c,
    target.id,
    notify && {
      kind: gift ? 'gift' : 'system',
      title: gift ? `You received ${fmt(amount)} coins` : `${fmt(amount)} coins were removed from your balance`,
      body: gift ? `A gift from the ${senderName(c.env)}.` : null,
      data: gift ? { coins: amount, from: senderName(c.env) } : { coins: amount },
    },
    [{ t: 'wallet', coins }],
  );
  return c.json({ coins });
});

// The row is locked (FOR UPDATE) so `before` is the value the update starts from; XP floors at 0.
export const XP_SQL = `
WITH old AS (
  SELECT id, xp FROM users WHERE id = $1::uuid FOR UPDATE
), upd AS (
  UPDATE users u SET xp = GREATEST(0, old.xp + $2::int)
    FROM old
   WHERE u.id = old.id
  RETURNING u.id, u.name, u.xp, old.xp AS before
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'xp', upd.id, upd.name,
         jsonb_build_object('reason', $5::text, 'amount', $2::int, 'before', upd.before, 'after', upd.xp)
    FROM upd
  RETURNING id
)
SELECT xp, before FROM upd`;

// POST /users/:id/xp { amount, reason, notify? } -> { xp, level }   (xp floors at 0)
admin.post('/users/:id/xp', requireAdmin, async (c) => {
  const body = await readJson(c);
  const amount = parseAmount(body.amount);
  const reason = parseReason(body.reason);
  const notify = parseNotify(body.notify);
  const target = await targetUser(c);
  let row;
  try {
    [row] = await query(c.env, XP_SQL, [target.id, amount, ...actor(c), reason]);
  } catch (err) {
    if (isOverflow(err)) throw new HttpError(409, 'That would make the XP too large.');
    throw err;
  }
  if (!row) throw new HttpError(404, 'User not found.');
  const xp = num(row.xp);
  const level = levelFromXp(xp);
  try {
    // Level is derived from XP (also recomputed when read); keep the column in step, as match.js does.
    await query(c.env, 'UPDATE users SET level = $2 WHERE id = $1 AND level <> $2', [target.id, level]);
  } catch {
    /* cosmetic */
  }
  const gift = amount > 0;
  await tellUser(
    c,
    target.id,
    notify && {
      kind: gift ? 'gift' : 'system',
      title: gift ? `You received ${fmt(amount)} XP` : `${fmt(amount)} XP was removed`,
      body: gift ? `A gift from the ${senderName(c.env)}.` : null,
      data: gift ? { xp: amount, from: senderName(c.env) } : { xp: amount },
    },
    [{ t: 'wallet', xp, level }],
  );
  return c.json({ xp, level });
});

/** A catalogue item an admin may grant / revoke: 400 malformed, 404 unknown, 409 free (everyone owns those). */
function grantableItem(itemId) {
  if (typeof itemId !== 'string' || !itemId || itemId.length > 100) throw new HttpError(400, 'Invalid item id.');
  const item = cosmeticById(itemId);
  if (!item) throw new HttpError(404, 'Unknown item.');
  if (FREE_COSMETICS.includes(item.id)) throw new HttpError(409, 'Everyone already owns that item.');
  return item;
}

export const ITEM_GRANT_SQL = `
WITH ins AS (
  INSERT INTO user_items (user_id, item_id, price_paid)
  VALUES ($1::uuid, $2::text, 0)
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING item_id
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'item.grant', $1::uuid, $6::text,
         jsonb_build_object('reason', $5::text, 'itemId', $2::text, 'itemName', $7::text)
    FROM ins
  RETURNING id
)
SELECT (SELECT count(*) FROM ins)::int AS inserted,
       coalesce((SELECT json_agg(item_id) FROM user_items WHERE user_id = $1::uuid), '[]'::json) AS bought_before`;

// POST /users/:id/items { itemId, reason, notify? } -> { owned }   409 already owned / free item
admin.post('/users/:id/items', requireAdmin, async (c) => {
  const body = await readJson(c);
  const item = grantableItem(body.itemId);
  const reason = parseReason(body.reason);
  const notify = parseNotify(body.notify);
  const target = await targetUser(c);
  let row;
  try {
    [row] = await query(c.env, ITEM_GRANT_SQL, [target.id, item.id, ...actor(c), reason, target.name, item.name]);
  } catch (err) {
    if (err && err.code === '23503') throw new HttpError(404, 'User not found.'); // deleted meanwhile
    throw err;
  }
  if (!row || num(row.inserted) === 0) throw new HttpError(409, 'Already owned.');
  const owned = ownedList([...parseList(row.bought_before), item.id]);
  await tellUser(
    c,
    target.id,
    notify && {
      kind: 'gift',
      title: `You received ${item.name}`,
      body: `A gift from the ${senderName(c.env)}.`,
      data: { itemId: item.id, itemName: item.name, from: senderName(c.env) },
    },
    [{ t: 'items', owned }],
  );
  return c.json({ owned });
});

// Deletes the row and, when the item was equipped in its slot, unequips it (same statement).
// owned_before = the rows before this statement (CTE writes are invisible to the outer query).
export const ITEM_REVOKE_SQL = `
WITH del AS (
  DELETE FROM user_items WHERE user_id = $1::uuid AND item_id = $2::text
  RETURNING item_id
), unequip AS (
  UPDATE users SET equipped = equipped - $3::text
   WHERE id = $1::uuid AND equipped ->> $3::text = $2::text AND EXISTS (SELECT 1 FROM del)
  RETURNING id
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $4::uuid, $5::text, 'item.revoke', $1::uuid, $7::text,
         jsonb_strip_nulls(jsonb_build_object('reason', $6::text, 'itemId', $2::text, 'itemName', $8::text,
                                              'unequipped', EXISTS (SELECT 1 FROM unequip)))
    FROM del
  RETURNING id
)
SELECT (SELECT count(*) FROM del)::int AS deleted,
       EXISTS (SELECT 1 FROM unequip) AS unequipped,
       coalesce((SELECT json_agg(item_id) FROM user_items WHERE user_id = $1::uuid), '[]'::json) AS owned_before`;

// DELETE /users/:id/items/:itemId?reason= -> { owned }   (also unequips it; 409 not owned)
admin.delete('/users/:id/items/:itemId', requireAdmin, async (c) => {
  const itemId = c.req.param('itemId');
  if (typeof itemId !== 'string' || !itemId || itemId.length > 100) throw new HttpError(400, 'Invalid item id.');
  const item = cosmeticById(itemId);
  if (item && FREE_COSMETICS.includes(item.id)) throw new HttpError(409, 'Free items cannot be taken away.');
  const reason = parseReason(c.req.query('reason'));
  const notify = parseNotify(c.req.query('notify') === 'false' ? false : undefined);
  const target = await targetUser(c);
  const name = item ? item.name : itemId;
  const [row] = await query(c.env, ITEM_REVOKE_SQL, [target.id, itemId, item ? item.kind : '', ...actor(c), reason, target.name, name]);
  if (!row || num(row.deleted) === 0) throw new HttpError(409, 'Not owned.');
  const owned = ownedList(parseList(row.owned_before).filter((id) => id !== itemId));
  await tellUser(
    c,
    target.id,
    notify && { kind: 'system', title: `${name} was removed from your collection`, body: null, data: { itemId, itemName: name } },
    [{ t: 'items', owned }],
  );
  return c.json({ owned });
});

// ---------------------------------------------------------------- moderation (moderators: never on staff)

export const BAN_SQL = `
WITH upd AS (
  UPDATE users SET banned_at = coalesce(banned_at, now()), ban_reason = $2::text
   WHERE id = $1::uuid
  RETURNING id, name
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'ban', upd.id, upd.name, jsonb_build_object('reason', $2::text)
    FROM upd
  RETURNING id
)
SELECT id FROM upd`;

// POST /users/:id/ban { reason } -> { banned: true }
admin.post('/users/:id/ban', requirePermission('moderate'), async (c) => {
  const body = await readJson(c);
  const reason = parseReason(body.reason);
  const target = await targetUser(c);
  assertCanModerate(c, target, { verb: 'ban', selfForbidden: true });
  const [row] = await query(c.env, BAN_SQL, [target.id, reason, ...actor(c)]);
  if (!row) throw new HttpError(404, 'User not found.');
  background(c, pushToUser(c.env, target.id, { t: 'suspended', reason }));
  return c.json({ banned: true });
});

export const UNBAN_SQL = `
WITH upd AS (
  UPDATE users SET banned_at = NULL, ban_reason = NULL
   WHERE id = $1::uuid
  RETURNING id, name
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'unban', upd.id, upd.name,
         jsonb_strip_nulls(jsonb_build_object('reason', $2::text, 'previousReason', $5::text))
    FROM upd
  RETURNING id
)
SELECT id FROM upd`;

// POST /users/:id/unban { reason? } -> { banned: false }
admin.post('/users/:id/unban', requirePermission('moderate'), async (c) => {
  const body = await readJson(c);
  const reason = parseReason(body.reason, { optional: true });
  const target = await targetUser(c);
  assertCanModerate(c, target, { verb: 'unban' });
  const [row] = await query(c.env, UNBAN_SQL, [target.id, reason, ...actor(c), target.ban_reason || null]);
  if (!row) throw new HttpError(404, 'User not found.');
  return c.json({ banned: false });
});

export const RENAME_SQL = `
WITH upd AS (
  UPDATE users SET name = $2::text WHERE id = $1::uuid
  RETURNING id, name
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'rename', upd.id, upd.name,
         jsonb_build_object('reason', $5::text, 'before', $6::text, 'after', upd.name)
    FROM upd
  RETURNING id
)
SELECT name FROM upd`;

// POST /users/:id/rename { name, reason } -> { name }
admin.post('/users/:id/rename', requirePermission('moderate'), async (c) => {
  const body = await readJson(c);
  const v = validateName(body.name);
  if (!v.ok) throw new HttpError(400, v.error);
  const reason = parseReason(body.reason);
  const target = await targetUser(c);
  assertCanModerate(c, target, { verb: 'rename' });
  const [row] = await query(c.env, RENAME_SQL, [target.id, v.value, ...actor(c), reason, target.name]);
  if (!row) throw new HttpError(404, 'User not found.');
  return c.json({ name: row.name });
});

export const RESET_HANDLE_SQL = `
WITH upd AS (
  UPDATE users SET handle = NULL WHERE id = $1::uuid
  RETURNING id, name
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $2::uuid, $3::text, 'handle.reset', upd.id, upd.name,
         jsonb_strip_nulls(jsonb_build_object('reason', $4::text, 'before', $5::text))
    FROM upd
  RETURNING id
)
SELECT id FROM upd`;

// POST /users/:id/reset-handle { reason } -> { handle: null }   (the user may claim a new one straight away)
admin.post('/users/:id/reset-handle', requirePermission('moderate'), async (c) => {
  const body = await readJson(c);
  const reason = parseReason(body.reason);
  const target = await targetUser(c);
  assertCanModerate(c, target, { verb: 'reset the handle of' });
  const [row] = await query(c.env, RESET_HANDLE_SQL, [target.id, ...actor(c), reason, target.handle || null]);
  if (!row) throw new HttpError(404, 'User not found.');
  return c.json({ handle: null });
});

// POST /users/:id/notify { title: 1-80, body?: <= 500 } -> { ok: true }
admin.post('/users/:id/notify', requirePermission('moderate'), async (c) => {
  const body = await readJson(c);
  const title = parseText(body.title, { label: 'Title', max: 80 });
  const text = parseText(body.body, { label: 'Message', max: 500, optional: true, multiline: true });
  const target = await targetUser(c);
  assertCanModerate(c, target, { verb: 'message' });
  await writeAudit(c.env, { admin: c.get('user'), action: 'notify', target, details: { title, ...(text ? { body: text } : {}) } });
  await tellUser(c, target.id, { kind: 'message', title, body: text, data: { from: senderName(c.env) } });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- roles (admin only)

export const ROLE_SQL = `
WITH upd AS (
  UPDATE users SET role = $2::text WHERE id = $1::uuid AND is_guest = false
  RETURNING id, name, role
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $3::uuid, $4::text, 'role', upd.id, upd.name, jsonb_build_object('before', $5::text, 'after', $2::text)
    FROM upd
  RETURNING id
)
SELECT role FROM upd`;

// POST /users/:id/role { role } -> { role }  (the effective role afterwards: an ADMIN_EMAILS account stays admin)
admin.post('/users/:id/role', requireAdmin, async (c) => {
  const body = await readJson(c);
  if (!ROLES.includes(body.role)) throw new HttpError(400, 'Role must be user, moderator or admin.');
  const target = await targetUser(c);
  if (target.id === c.get('user').id) throw new HttpError(403, 'You cannot change your own role.');
  if (target.is_guest) throw new HttpError(400, 'Guests cannot be given a role.');
  const before = ROLES.includes(target.role) ? target.role : 'user';
  const [row] = await query(c.env, ROLE_SQL, [target.id, body.role, ...actor(c), before]);
  if (!row) throw new HttpError(404, 'User not found.');
  return c.json({ role: effectiveRole({ ...target, role: row.role }, c.env) });
});

// ---------------------------------------------------------------- bulk grants (admin only, 5/min)

export const AUDIENCES = Object.freeze(['ids', 'members', 'active7d']);
export const BULK_IDS_MAX = 500;
export const BULK_COINS_MAX = 100_000;
export const BULK_PUSH_MAX = 50;
// 500 quoted uuids are ~19.5 KB of JSON: more than the default 16 KB body cap.
export const BULK_BODY_BYTES = 32 * 1024;

// Who a bulk grant reaches. Fixed fragments only. $1 is the id list: the audience for 'ids'; for the others it is
// always empty and only keeps the parameter typed (Postgres refuses an unused, untyped parameter).
const AUDIENCE_SQL = {
  ids: 'SELECT id FROM users WHERE id = ANY($1::uuid[])',
  members: 'SELECT id FROM users WHERE is_guest = false AND banned_at IS NULL AND NOT (id = ANY($1::uuid[]))',
  active7d:
    "SELECT id FROM users WHERE is_guest = false AND banned_at IS NULL AND last_seen > now() - interval '7 days' AND NOT (id = ANY($1::uuid[]))",
};

// Set-based: one UPDATE for coins, one INSERT ... SELECT for items and one for notifications, one audit row.
// $1 ids, $2 coins|null, $3 itemId|null, $4 custom title|null, $5 message|null, $6 base data, $7/$8 admin,
// $9 audit details, $10 return per-user rows for live pushes, $11 item name, $12-$14 default titles.
export const bulkSql = (audience) => `
WITH target AS (
  ${AUDIENCE_SQL[audience]}
), coin AS (
  UPDATE users u SET coins = u.coins + $2::int
    FROM target t
   WHERE u.id = t.id AND $2::int IS NOT NULL AND u.coins <= 2147483647 - $2::int
  RETURNING u.id, u.coins
), item AS (
  INSERT INTO user_items (user_id, item_id, price_paid)
  SELECT t.id, $3::text, 0 FROM target t WHERE $3::text IS NOT NULL
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING user_id
), granted AS (
  SELECT t.id, c.coins, (c.id IS NOT NULL) AS got_coins, (i.user_id IS NOT NULL) AS got_item
    FROM target t
    LEFT JOIN coin c ON c.id = t.id
    LEFT JOIN item i ON i.user_id = t.id
   WHERE c.id IS NOT NULL OR i.user_id IS NOT NULL
), notif AS (
  INSERT INTO notifications (user_id, kind, title, body, data)
  SELECT g.id, 'gift',
         coalesce($4::text, CASE WHEN g.got_coins AND g.got_item THEN $12::text WHEN g.got_coins THEN $13::text ELSE $14::text END),
         $5::text,
         $6::jsonb || jsonb_strip_nulls(jsonb_build_object(
           'coins', CASE WHEN g.got_coins THEN $2::int END,
           'itemId', CASE WHEN g.got_item THEN $3::text END,
           'itemName', CASE WHEN g.got_item THEN $11::text END))
    FROM granted g
  RETURNING ${NOTIFICATION_COLUMNS}, user_id
), aud AS (
  INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
  SELECT $7::uuid, $8::text, 'grant.bulk', NULL, NULL, $9::jsonb || jsonb_build_object('count', (SELECT count(*) FROM granted))
  RETURNING id
)
SELECT (SELECT count(*) FROM granted)::int AS count,
       CASE WHEN $10::boolean THEN (
         SELECT coalesce(json_agg(json_build_object(
                  'userId', n.user_id,
                  'notification', row_to_json(n),
                  'coins', g.coins,
                  'gotCoins', g.got_coins,
                  'gotItem', g.got_item,
                  'owned', (SELECT coalesce(json_agg(ui.item_id), '[]'::json) FROM user_items ui WHERE ui.user_id = n.user_id))), '[]'::json)
           FROM notif n JOIN granted g ON g.id = n.user_id)
       END AS pushes`;

/** Validated bulk-grant body. */
export function parseGrant(body) {
  if (!AUDIENCES.includes(body.audience)) throw new HttpError(400, 'Audience must be ids, members or active7d.');
  let ids = [];
  if (body.audience === 'ids') {
    if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(400, 'Give at least one user id.');
    if (body.ids.length > BULK_IDS_MAX) throw new HttpError(400, `At most ${BULK_IDS_MAX} user ids at a time.`);
    if (!body.ids.every(isUuid)) throw new HttpError(400, 'Invalid user id.');
    ids = [...new Set(body.ids.map((s) => s.toLowerCase()))];
  }
  let coins = null;
  if (body.coins !== undefined && body.coins !== null) {
    if (!Number.isInteger(body.coins) || body.coins < 1 || body.coins > BULK_COINS_MAX) {
      throw new HttpError(400, `Coins must be a whole number from 1 to ${BULK_COINS_MAX.toLocaleString('en-US')}.`);
    }
    coins = body.coins;
  }
  const item = body.itemId !== undefined && body.itemId !== null && body.itemId !== '' ? grantableItem(body.itemId) : null;
  if (coins === null && !item) throw new HttpError(400, 'Give coins, an item, or both.');
  const title = parseText(body.title, { label: 'Title', max: 80, optional: true });
  const message = parseText(body.message, { label: 'Message', max: 500, optional: true, multiline: true });
  const reason = parseReason(body.reason);
  return { audience: body.audience, ids, coins, item, title, message, reason };
}

// POST /grants { audience, ids?, coins?, itemId?, title?, message?, reason } -> { count }
// Live pushes only for audience 'ids' with at most 50 users; everyone else sees the gift on their next load.
admin.post('/grants', requireAdmin, limit('admin-bulk', 5, 60), async (c) => {
  const g = parseGrant(await readJson(c, BULK_BODY_BYTES));
  const wantPushes = g.audience === 'ids' && g.ids.length <= BULK_PUSH_MAX;
  const from = senderName(c.env);
  const coinsText = g.coins ? `${fmt(g.coins)} coins` : '';
  const details = {
    reason: g.reason,
    audience: g.audience,
    ...(g.audience === 'ids' ? { ids: g.ids.length } : {}),
    ...(g.coins ? { coins: g.coins } : {}),
    ...(g.item ? { itemId: g.item.id, itemName: g.item.name } : {}),
    ...(g.title ? { title: g.title } : {}),
  };
  const [row] = await query(c.env, bulkSql(g.audience), [
    g.ids,
    g.coins,
    g.item ? g.item.id : null,
    g.title,
    g.message ?? `A gift from the ${from}.`,
    JSON.stringify({ from }),
    ...actor(c),
    JSON.stringify(details),
    wantPushes,
    g.item ? g.item.name : null,
    `You received ${coinsText} and ${g.item ? g.item.name : ''}`,
    `You received ${coinsText}`,
    `You received ${g.item ? g.item.name : 'a gift'}`,
  ]);
  const count = num(row && row.count);
  if (wantPushes && row) {
    const list = parseList(row.pushes);
    background(
      c,
      Promise.all(
        list.map(async (p) => {
          const notification = rowToNotification(asObject(p.notification));
          const msgs = [{ t: 'notification', notification }];
          if (p.gotCoins) msgs.push({ t: 'wallet', coins: num(p.coins) });
          if (p.gotItem) msgs.push({ t: 'items', owned: ownedList([...parseList(p.owned), g.item.id]) });
          for (const m of msgs) await pushToUser(c.env, p.userId, m);
        }),
      ),
    );
  }
  return c.json({ count });
});

// ---------------------------------------------------------------- rooms, matches, audit (read-only)

export const ROOMS_SQL = `
SELECT r.code, r.game_id, r.host_name, r.status, r.visibility, r.player_count, r.max_players, r.created_at, r.updated_at,
       (SELECT coalesce(json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar', u.avatar)), '[]'::json)
          FROM users u WHERE u.id = ANY(r.member_ids)) AS members
  FROM rooms r
 WHERE r.updated_at > now() - interval '24 hours'
 ORDER BY r.updated_at DESC
 LIMIT 200`;

// GET /rooms -> { rooms } (updated in the last 24 h, at most 200)
admin.get('/rooms', async (c) => {
  const rows = await query(c.env, ROOMS_SQL);
  return c.json({
    rooms: rows.map((r) => ({
      code: r.code,
      gameId: r.game_id,
      hostName: r.host_name || null,
      status: r.status,
      visibility: r.visibility,
      playerCount: num(r.player_count),
      maxPlayers: num(r.max_players),
      members: parseList(r.members).map((m) => ({ id: m.id, name: m.name, avatar: num(m.avatar) })),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })),
  });
});

export const MATCHES_SQL = `
SELECT m.id, m.game_id, m.room_code, m.started_at, m.ended_at, m.rounds, m.player_count, m.winner_id,
       coalesce((SELECT p.name FROM match_players p WHERE p.match_id = m.id AND p.user_id = m.winner_id ORDER BY p.rank LIMIT 1),
                (SELECT u.name FROM users u WHERE u.id = m.winner_id)) AS winner_name,
       (SELECT coalesce(json_agg(json_build_object(
                 'userId', p.user_id, 'name', p.name, 'rank', p.rank, 'isBot', p.is_bot, 'finalWorth', p.final_worth
               ) ORDER BY p.rank, p.id), '[]'::json)
          FROM match_players p WHERE p.match_id = m.id) AS players
  FROM matches m
 ORDER BY m.ended_at DESC, m.id DESC
 LIMIT $1::int OFFSET $2::int`;

// GET /matches?page=&pageSize= (<= 50, default 20) -> { matches, total, page, pageSize }
admin.get('/matches', async (c) => {
  const { page, pageSize, offset } = parsePage(c.req.query('page'), c.req.query('pageSize'), { def: 20, max: 50 });
  const [rows, [count]] = await Promise.all([
    query(c.env, MATCHES_SQL, [pageSize, offset]),
    query(c.env, 'SELECT count(*)::int AS total FROM matches'),
  ]);
  return c.json({
    matches: rows.map((m) => ({
      id: m.id,
      gameId: m.game_id,
      roomCode: m.room_code,
      startedAt: iso(m.started_at),
      endedAt: iso(m.ended_at),
      rounds: num(m.rounds),
      playerCount: num(m.player_count),
      winner: m.winner_id ? { id: m.winner_id, name: m.winner_name || null } : null,
      players: parseList(m.players).map((p) => ({
        userId: p.userId || null,
        name: p.name,
        rank: num(p.rank),
        isBot: p.isBot === true,
        finalWorth: num(p.finalWorth),
      })),
    })),
    total: num(count && count.total),
    page,
    pageSize,
  });
});

// GET /actions?page=&pageSize= (<= 100, default 50)&targetId=&adminId=&action= -> { actions, total, page, pageSize }
admin.get('/actions', async (c) => {
  const { page, pageSize, offset } = parsePage(c.req.query('page'), c.req.query('pageSize'), { def: 50, max: 100 });
  const where = [];
  const params = [];
  for (const [key, col] of [
    ['targetId', 'target_id'],
    ['adminId', 'admin_id'],
  ]) {
    const v = c.req.query(key);
    if (v === undefined || v === '') continue;
    if (!isUuid(v)) throw new HttpError(400, `Invalid ${key}.`);
    params.push(v.toLowerCase());
    where.push(`${col} = $${params.length}::uuid`);
  }
  const action = c.req.query('action');
  if (action !== undefined && action !== '') {
    if (!AUDIT_ACTIONS.includes(action)) throw new HttpError(400, 'Unknown action.');
    params.push(action);
    where.push(`action = $${params.length}::text`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const n = params.length;
  const [rows, [count]] = await Promise.all([
    query(c.env, `SELECT ${AUDIT_COLUMNS} FROM admin_actions ${w} ORDER BY created_at DESC, id DESC LIMIT $${n + 1}::int OFFSET $${n + 2}::int`, [
      ...params,
      pageSize,
      offset,
    ]),
    query(c.env, `SELECT count(*)::int AS total FROM admin_actions ${w}`, params),
  ]);
  return c.json({ actions: rows.map(rowToAudit), total: num(count && count.total), page, pageSize });
});

export default admin;
