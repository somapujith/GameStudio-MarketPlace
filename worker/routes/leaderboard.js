import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { getAdapter } from '../games/index.js';
import { getSoloGame } from '../games/solo.js';
import { limit } from '../ratelimit.js';
import { parseGameParam, buildLeaderboardQuery, buildLeaderboardMeQuery, rowToLeaderboardRow } from '../leaderboard.js';

const leaderboard = new Hono();

// A board exists for every room game and every solo game (solo: ranked by best score, see worker/leaderboard.js).
const lookupGame = (id) => getAdapter(id) || getSoloGame(id);

const caches = new Map(); // game -> { at, entries: [{ uid, row }] }  (uid stays server-side)
const TTL_MS = 15_000;

/** The caller's own row (true rank, even outside the top N) or null. Best effort. */
async function loadMyRow(env, game, uid, entries) {
  const hit = entries.find((e) => e.uid === uid);
  if (hit) return { ...hit.row, isMe: true };
  try {
    const q = buildLeaderboardMeQuery(game, uid);
    const rows = await query(env, q.text, q.params);
    return rows[0] ? { ...rowToLeaderboardRow(rows[0]), isMe: true } : null;
  } catch {
    return null; // the board itself must still load
  }
}

// GET /api/leaderboard?game=<id>|overall
//   -> { rows:[{ rank, name, avatar, level, wins, games, bestScore, rating, bestWorth, frame, title, isMe }], me: row|null }
// No parameter = overall (ranked by xp). Per game: wins, then rating. Top 50, cached 15 s.
// Public (no sign-in): guests can look at the Rank tab; guests themselves are never listed (me = null).
// isMe compares user ids on the server; ids are never sent.
leaderboard.get('/', limit('leaderboard', 60, 60), async (c) => {
  const game = parseGameParam(c.req.query('game'), lookupGame);
  if (game === null) throw new HttpError(400, 'unknown game');
  const now = Date.now();
  let hit = caches.get(game);
  if (!hit || now - hit.at > TTL_MS) {
    const q = buildLeaderboardQuery(game);
    const rows = await query(c.env, q.text, q.params);
    hit = { at: now, entries: rows.map((r) => ({ uid: r.id, row: rowToLeaderboardRow(r) })) };
    if (caches.size > 20) caches.clear();
    caches.set(game, hit);
  }
  const session = c.get('session');
  const uid = session && !session.guest ? session.uid : null;
  const rows = hit.entries.map((e) => ({ ...e.row, isMe: uid != null && e.uid === uid }));
  const me = uid ? await loadMyRow(c.env, game, uid, hit.entries) : null;
  return c.json({ rows, me });
});

export const _resetLeaderboardCacheForTests = () => caches.clear();

export default leaderboard;
