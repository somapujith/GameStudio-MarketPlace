// Web Push subscriptions (docs/HUSTLE_PLAN.md section 4). Without the VAPID secrets every call is a
// harmless no-op: the key is null and nothing is stored.
//   GET  /api/push/key                       -> { key: string|null }
//   POST /api/push/subscribe { subscription } -> { ok: true, stored: boolean }   (signed in)
//   POST /api/push/unsubscribe { endpoint }   -> { ok: true }                     (signed in)
import { Hono } from 'hono';
import { HttpError } from '../db.js';
import { requireUser } from '../auth.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { pushConfigured, pushPublicKey, parseSubscription, saveSubscription, deleteSubscription } from '../push.js';

const push = new Hono();

const missingTable = (err) => err && err.code === '42P01'; // the migration has not run yet

push.get('/key', limit('push-key', 60, 60), (c) => c.json({ key: pushPublicKey(c.env) }));

push.post('/subscribe', requireUser, limit('push-subscribe', 10, 60), async (c) => {
  const body = await readJson(c);
  const parsed = parseSubscription(body.subscription);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  if (!pushConfigured(c.env)) return c.json({ ok: true, stored: false });
  try {
    await saveSubscription(c.env, c.get('user').id, parsed.sub);
  } catch (err) {
    if (missingTable(err)) return c.json({ ok: true, stored: false });
    throw err;
  }
  return c.json({ ok: true, stored: true });
});

push.post('/unsubscribe', requireUser, limit('push-unsubscribe', 10, 60), async (c) => {
  const body = await readJson(c);
  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1024) throw new HttpError(400, 'Invalid push endpoint.');
  try {
    await deleteSubscription(c.env, c.get('user').id, endpoint); // always allowed: forgetting a device is harmless
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  return c.json({ ok: true });
});

export default push;
