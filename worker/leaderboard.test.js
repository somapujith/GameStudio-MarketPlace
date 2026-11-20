import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const queryMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const { parseGameParam, buildLeaderboardQuery, buildLeaderboardMeQuery, rowToLeaderboardRow, LEADERBOARD_LIMIT, OVERALL } =
  await import('./leaderboard.js');
const { getAdapter } = await import('./games/index.js');
const { sessionMiddleware, signSession } = await import('./auth.js');
const { HttpError } = await import('./db.js');
const { _resetForTests } = await import('./ratelimit.js');
const { default: leaderboardRoutes, _resetLeaderboardCacheForTests } = await import('./routes/leaderboard.js');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/leaderboard', leaderboardRoutes);
app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : 500));

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;
async function call(path, cookie) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const res = await app.fetch(new Request(`http://localhost${path}`, { headers }), env, {});
  return { status: res.status, json: await res.json() };
}

beforeEach(() => _resetLeaderboardCacheForTests());

describe('?game= parameter', () => {
  it('no parameter (old clients) means overall', () => {
    for (const raw of [undefined, null, '', 'overall']) expect(parseGameParam(raw, getAdapter)).toBe(OVERALL);
  });
  it('a registered game id is accepted, anything else is unknown', () => {
    expect(parseGameParam('hyderabad-tycoon', getAdapter)).toBe('hyderabad-tycoon');
    for (const bad of ['ludo', 'Overall', 'OVERALL', '__proto__', 'x'.repeat(100), 5, {}, ['overall']]) {
      expect(parseGameParam(bad, getAdapter), String(bad)).toBeNull();
    }
  });
});

describe('leaderboard queries', () => {
  it('overall ranks by xp, never lists guests, and sums per-game stats', () => {
    const q = buildLeaderboardQuery(OVERALL);
    expect(q.params).toEqual([]);
    expect(q.text).toMatch(/ORDER BY u\.xp DESC/);
    expect(q.text).toMatch(/u\.is_guest = false/);
    expect(q.text).toMatch(/FROM user_game_stats GROUP BY user_id/);
    expect(q.text).toMatch(new RegExp(`LIMIT ${LEADERBOARD_LIMIT}$`));
    expect(q.text).toMatch(/AS rank/);
  });

  it('a game ranks by wins, then rating, from user_game_stats; the game id is a bound parameter', () => {
    const q = buildLeaderboardQuery('hyderabad-tycoon');
    expect(q.params).toEqual(['hyderabad-tycoon']);
    expect(q.text).toMatch(/FROM user_game_stats s/);
    expect(q.text).toMatch(/s\.game_id = \$1/);
    expect(q.text).toMatch(/ORDER BY s\.wins DESC, s\.rating DESC/);
    expect(q.text).toMatch(/u\.is_guest = false/);
    expect(q.text).toMatch(/s\.games > 0/);
    expect(q.text).not.toMatch(/hyderabad-tycoon/);
    expect(LEADERBOARD_LIMIT).toBe(50);
  });

  it('rows keep the old shape (bestWorth) and add bestScore / rating; level comes from xp', () => {
    const row = rowToLeaderboardRow({ rank: 1, name: 'Teja', avatar: 2, xp: 100, wins: 4, games: 9, best_score: 123456, rating: 1048 });
    expect(row).toEqual({
      rank: 1,
      name: 'Teja',
      avatar: 2,
      level: 2,
      wins: 4,
      games: 9,
      bestScore: 123456,
      rating: 1048,
      bestWorth: 123456,
      frame: null,
      title: null,
    });
  });

  it('rows carry the equipped frame / title ids (unknown ids dropped) and never the user id', () => {
    const row = rowToLeaderboardRow({
      rank: 2, id: 'secret-id', name: 'A', avatar: 1, xp: 0, wins: 0, games: 1, best_score: 0, rating: 1000,
      equipped: { frame: 'frame-nizam', title: 'title-chai', dice: 'dice-cyber' },
    });
    expect(row.frame).toBe('frame-nizam');
    expect(row.title).toBe('title-chai');
    expect(JSON.stringify(row)).not.toMatch(/secret-id/);
    expect(rowToLeaderboardRow({ rank: 1, xp: 0, equipped: { frame: 'title-chai', title: 'nope' } })).toMatchObject({ frame: null, title: null });
    expect(rowToLeaderboardRow({ rank: 1, xp: 0, equipped: '{"frame":"frame-lake"}' }).frame).toBe('frame-lake');
  });

  it('the "me" query ranks every eligible player with the same ordering and binds the user id', () => {
    const top = buildLeaderboardQuery(OVERALL);
    const mine = buildLeaderboardMeQuery(OVERALL, ME);
    expect(mine.params).toEqual([ME]);
    expect(mine.text).toMatch(/WITH ranked AS/);
    expect(mine.text).toMatch(/WHERE id = \$1::uuid/);
    expect(mine.text).not.toMatch(/LIMIT/);
    expect(mine.text).toContain(top.text.split('ORDER BY rank')[0].trim());
    const g = buildLeaderboardMeQuery('hyderabad-tycoon', ME);
    expect(g.params).toEqual(['hyderabad-tycoon', ME]);
    expect(g.text).toMatch(/s\.game_id = \$1/);
    expect(g.text).toMatch(/WHERE id = \$2::uuid/);
    expect(g.text).not.toMatch(new RegExp(ME));
  });
});

describe('GET /api/leaderboard: isMe and me', () => {
  const rowsFor = (n) =>
    Array.from({ length: n }, (_, i) => ({
      rank: i + 1, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `P${i}`, avatar: 0, xp: 100,
      wins: 1, games: 2, best_score: 10, rating: 1000, equipped: {},
    }));

  beforeEach(() => {
    queryMock.mockReset();
    _resetForTests();
  });

  it('flags my own row, gives me the same row, and never sends ids', async () => {
    const rows = rowsFor(3);
    rows[1].id = ME;
    rows[1].equipped = { frame: 'frame-pearl', title: 'title-nawab' };
    queryMock.mockImplementation(async (e, text) => (/LIMIT 50/.test(text) ? rows : []));
    const res = await call('/api/leaderboard?game=hyderabad-tycoon', await cookieFor(ME));
    expect(res.status).toBe(200);
    expect(res.json.rows.map((r) => r.isMe)).toEqual([false, true, false]);
    expect(res.json.me).toEqual({ ...res.json.rows[1], isMe: true });
    expect(res.json.me).toMatchObject({ rank: 2, frame: 'frame-pearl', title: 'title-nawab', rating: 1000, level: 2 });
    expect(JSON.stringify(res.json)).not.toMatch(/00000000-/);
    expect(queryMock).toHaveBeenCalledTimes(1); // in the top N: no extra query
  });

  it('outside the top N: me comes from the rank query (true rank), rows stay cached', async () => {
    const me = { ...rowsFor(1)[0], rank: 137, id: ME, name: 'Me' };
    const seen = [];
    queryMock.mockImplementation(async (e, text, params) => {
      seen.push({ text, params });
      if (/WITH ranked AS/.test(text)) return [me];
      return rowsFor(2);
    });
    const res = await call('/api/leaderboard?game=overall', await cookieFor(ME));
    expect(res.json.rows.every((r) => r.isMe === false)).toBe(true);
    expect(res.json.me).toMatchObject({ rank: 137, name: 'Me', isMe: true });
    expect(seen[1].params).toEqual([ME]);
    // signed out / guest: no me query, me = null
    queryMock.mockClear();
    expect((await call('/api/leaderboard?game=overall')).json.me).toBeNull();
    expect((await call('/api/leaderboard?game=overall', await cookieFor(ME, true))).json.me).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('unranked caller -> me null; a failing me query never breaks the board', async () => {
    queryMock.mockImplementation(async (e, text) => (/WITH ranked AS/.test(text) ? [] : []));
    expect((await call('/api/leaderboard?game=hyderabad-tycoon', await cookieFor(OTHER))).json).toEqual({ rows: [], me: null });
    queryMock.mockImplementation(async (e, text) => {
      if (/WITH ranked AS/.test(text)) throw new Error('boom');
      return [];
    });
    const res = await call('/api/leaderboard?game=hyderabad-tycoon', await cookieFor(ME));
    expect(res.status).toBe(200);
    expect(res.json.me).toBeNull();
  });
});
