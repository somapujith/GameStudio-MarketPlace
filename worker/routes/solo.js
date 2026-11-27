import { Hono } from 'hono';
import { HttpError } from '../db.js';
import { requireUser, signSoloToken, verifySoloToken } from '../auth.js';
import { getSoloGame } from '../games/solo.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { background } from '../hub.js';
import { checkAchievements } from '../achievements.js';
import { parseFinishBody, assertPlausible, persistSoloRun } from '../solo.js';

const solo = new Hono();

const gameOr404 = (c) => {
  const game = getSoloGame(c.req.param('gameId'));
  if (!game) throw new HttpError(404, 'unknown game');
  return game;
};

// POST /api/solo/:gameId/start -> { ok:true, token, seed, expiresAt }   (signed in; guests included)
// token = a 3-hour signed run token (claims sub, gid, jti, seed, iat); seed = a random 32-bit int for the client's world / quest RNG.
// expiresAt = ISO time the token stops being accepted.
solo.post('/:gameId/start', requireUser, limit('solo-start', 20, 60), async (c) => {
  const game = gameOr404(c);
  const { token, seed, exp } = await signSoloToken(c.env, { userId: c.get('user').id, gameId: game.id });
  return c.json({ ok: true, token, seed, expiresAt: new Date(exp * 1000).toISOString() });
});

// POST /api/solo/:gameId/finish { token, earned, seconds, distance, quests, fares, style } (whole numbers >= 0)
//   -> { ok, duplicate, earned, newBest, bestScore, games, wins, xp, coins, level }   (xp / coins = what THIS run paid)
// 400 malformed numbers, 401 bad / expired token (code 'run-expired'), 403 token of another player, 422 implausible run. A token finishes once:
// a replay is a no-op answering with the stored outcome and duplicate:true. Scores are client-reported (see worker/solo.js).
solo.post('/:gameId/finish', requireUser, limit('solo-finish', 20, 60), async (c) => {
  const game = gameOr404(c);
  const user = c.get('user');
  const { token, run } = parseFinishBody(await readJson(c));
  const claims = await verifySoloToken(c.env, token);
  // `code` tells the client this is the RUN token (it lives 3 hours), not the player's session: nothing to sign in to
  if (!claims) return c.json({ error: 'This run has expired or is not valid. Start a new one.', code: 'run-expired' }, 401);
  if (claims.sub !== user.id) throw new HttpError(403, 'This run belongs to another player.');
  if (claims.gid !== game.id) throw new HttpError(400, 'This run is for a different game.');
  assertPlausible(game, claims, run);
  // Achievements only (best effort, never fails the save). Referral rewards are not paid for solo runs: they are too cheap to fake.
  const after = (id) => background(c, checkAchievements(c.env, [id], { defer: (p) => background(c, p) }));
  return c.json(await persistSoloRun(c.env, { game, user, claims, run, after }));
});

export default solo;
