import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireUser } from '../auth.js';
import { hasTutorial } from '../games/tutorial.js';
import { limit } from '../ratelimit.js';

const tutorial = new Hono();

// Records that the player finished a game's tutorial: `extra = extra || {"tutorial":true}` for (user, game). It never touches games / wins /
// best_score / rating, so the row stays at games = 0 and the leaderboards (which need games > 0) do not list it. Idempotent: repeating it
// only refreshes updated_at. The users-row guard keeps a deleted account from raising a foreign-key error.
export const TUTORIAL_SQL = `
INSERT INTO user_game_stats (user_id, game_id, extra, updated_at)
SELECT $1::uuid, $2::text, '{"tutorial":true}'::jsonb, now()
 WHERE EXISTS (SELECT 1 FROM users x WHERE x.id = $1::uuid)
ON CONFLICT (user_id, game_id) DO UPDATE SET
       extra = coalesce(user_game_stats.extra, '{}'::jsonb) || '{"tutorial":true}'::jsonb,
       updated_at = now()`;

// POST /api/games/:gameId/tutorial/complete -> { ok:true, tutorialDone:true }   (signed in; guests included; no body needed)
// 401 without a session, 404 for an unknown game or one without a tutorial.
tutorial.post('/:gameId/tutorial/complete', requireUser, limit('tutorial-complete', 20, 60), async (c) => {
  const gameId = c.req.param('gameId');
  if (!hasTutorial(gameId)) throw new HttpError(404, 'unknown game');
  await query(c.env, TUTORIAL_SQL, [c.get('user').id, gameId]);
  return c.json({ ok: true, tutorialDone: true });
});

export default tutorial;
