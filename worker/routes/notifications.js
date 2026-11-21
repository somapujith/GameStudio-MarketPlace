// Player notifications (gifts and messages from the team, docs/ADMIN.md). Live delivery is the
// `{ t: 'notification' }` user-socket message; these endpoints are the inbox.
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireUser } from '../auth.js';
import { readJson } from '../http.js';
import { limit } from '../ratelimit.js';
import { isUuid } from '../validate.js';
import { NOTIFICATION_COLUMNS, rowToNotification } from '../admin.js';

export const NOTIFICATIONS_LATEST = 30;
export const READ_IDS_MAX = 100;

const notifications = new Hono();
notifications.use('*', requireUser, limit('notifications', 60, 60));

export const LIST_SQL = `
SELECT ${NOTIFICATION_COLUMNS}
  FROM notifications
 WHERE user_id = $1::uuid
 ORDER BY created_at DESC, id
 LIMIT ${NOTIFICATIONS_LATEST}`;

export const UNREAD_SQL = 'SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL';

// GET /api/notifications -> { notifications: Notification[] (latest 30), unread }
notifications.get('/', async (c) => {
  const id = c.get('user').id;
  const [rows, [count]] = await Promise.all([query(c.env, LIST_SQL, [id]), query(c.env, UNREAD_SQL, [id])]);
  return c.json({ notifications: rows.map(rowToNotification), unread: Number(count && count.unread) || 0 });
});

// One statement: mark (some or all of) my unread notifications read and return what is still unread. The outer
// query does not see the CTE's writes, so the marked rows are subtracted.
export const READ_SQL = `
WITH upd AS (
  UPDATE notifications SET read_at = now()
   WHERE user_id = $1::uuid AND read_at IS NULL AND ($2::boolean OR id = ANY($3::uuid[]))
  RETURNING id
)
SELECT ((SELECT count(*) FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL) - (SELECT count(*) FROM upd))::int AS unread`;

// POST /api/notifications/read { ids: uuid[] } | { all: true } -> { unread }
notifications.post('/read', async (c) => {
  const body = await readJson(c);
  let all = false;
  let ids = [];
  if (body.all === true) {
    all = true;
  } else if (Array.isArray(body.ids)) {
    if (body.ids.length > READ_IDS_MAX) throw new HttpError(400, `At most ${READ_IDS_MAX} ids at a time.`);
    if (!body.ids.every(isUuid)) throw new HttpError(400, 'Invalid notification id.');
    ids = [...new Set(body.ids.map((s) => s.toLowerCase()))];
  } else {
    throw new HttpError(400, 'Send { ids: [...] } or { all: true }.');
  }
  const [row] = await query(c.env, READ_SQL, [c.get('user').id, all, ids]);
  return c.json({ unread: Math.max(0, Number(row && row.unread) || 0) });
});

export default notifications;
