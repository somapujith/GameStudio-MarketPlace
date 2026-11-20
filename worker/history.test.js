// Match history: GET /api/me/matches, and that match.js stores what the history needs
// (rank + score per seat). In-process, database faked, game adapter faked (engine-independent).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const queryMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const { sessionMiddleware, signSession } = await import('./auth.js');
const { HttpError } = await import('./db.js');
const { _resetForTests } = await import('./ratelimit.js');
const { default: meRoutes, MATCHES_SQL, parseMatchesLimit, rowToMatch } = await import('./routes/me.js');
const { buildMatchRecord, PERSIST_SQL } = await import('./match.js');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/me', meRoutes);
app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : 500));

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;
async function call(path, cookie) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const res = await app.fetch(new Request(`http://localhost${path}`, { headers }), env, {});
  return { status: res.status, json: await res.json() };
}

const meRow = { id: ME, name: 'Me', avatar: 3, friend_code: 'HYD-ME22', is_guest: false, xp: 0, coins: 500, rent_earned: 0 };
const dbRow = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  game_id: 'hyderabad-tycoon',
  ended_at: new Date('2026-11-14T10:20:00Z'),
  rounds: 12,
  player_count: 3,
  winner_id: ME,
  rank: 1,
  final_worth: '154000', // bigint comes back as text from the driver
  players: [
    { name: 'Me', avatar: 3, rank: 1, score: 154000, isMe: true },
    { name: 'Ravi', avatar: 5, rank: 2, score: 90000, isMe: false },
    { name: 'Gone', avatar: 0, rank: 3, score: -200, isMe: false },
  ],
  ...over,
});

let lastMatchesCall;
beforeEach(() => {
  _resetForTests();
  lastMatchesCall = null;
  queryMock.mockReset();
  queryMock.mockImplementation(async (e, text, params) => {
    if (/FROM users WHERE id = \$1/.test(text)) return params[0] === ME || params[0] === OTHER ? [{ ...meRow, id: params[0] }] : [];
    if (text === MATCHES_SQL) {
      lastMatchesCall = params;
      return params[0] === ME ? [dbRow(), dbRow({ id: '22222222-2222-4222-8222-222222222222', winner_id: OTHER, rank: 2, final_worth: 1 })] : [];
    }
    return [];
  });
});

describe('GET /api/me/matches', () => {
  it('returns my matches newest first with every seat, ids never exposed', async () => {
    const res = await call('/api/me/matches', await cookieFor(ME));
    expect(res.status).toBe(200);
    expect(lastMatchesCall).toEqual([ME, 20]);
    expect(res.json.matches[0]).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      gameId: 'hyderabad-tycoon',
      endedAt: '2026-11-14T10:20:00.000Z',
      rounds: 12,
      playerCount: 3,
      rank: 1,
      won: true,
      score: 154000,
      players: [
        { name: 'Me', avatar: 3, rank: 1, score: 154000, isMe: true },
        { name: 'Ravi', avatar: 5, rank: 2, score: 90000, isMe: false },
        { name: 'Gone', avatar: 0, rank: 3, score: -200, isMe: false },
      ],
    });
    expect(res.json.matches[1]).toMatchObject({ won: false, rank: 2, score: 1 });
    expect(JSON.stringify(res.json)).not.toMatch(new RegExp(`${ME}|${OTHER}`));
  });

  it('limit defaults to 20, is capped at 50, junk falls back to the default', async () => {
    expect([undefined, '', 'abc', '0', '-3', '7', '50', '51', '9999'].map(parseMatchesLimit)).toEqual([20, 20, 20, 20, 20, 7, 50, 50, 50]);
    await call('/api/me/matches?limit=500', await cookieFor(ME));
    expect(lastMatchesCall).toEqual([ME, 50]);
  });

  it('query shape: my seats joined to matches, newest first, avatars via users, parameterised', () => {
    expect(MATCHES_SQL).toMatch(/FROM match_players mine\s+JOIN matches m ON m\.id = mine\.match_id/);
    expect(MATCHES_SQL).toMatch(/WHERE mine\.user_id = \$1::uuid/);
    expect(MATCHES_SQL).toMatch(/ORDER BY m\.ended_at DESC/);
    expect(MATCHES_SQL).toMatch(/LEFT JOIN users u ON u\.id = p\.user_id/);
    expect(MATCHES_SQL).toMatch(/coalesce\(u\.avatar, 0\)/);
    expect(MATCHES_SQL).toMatch(/LIMIT \$2::int/);
  });

  it('players as a JSON string (driver variance) and an empty history both work', async () => {
    const m = rowToMatch(dbRow({ players: JSON.stringify(dbRow().players), ended_at: '2026-11-14T10:20:00+00:00' }), ME);
    expect(m.players).toHaveLength(3);
    expect(m.endedAt).toBe('2026-11-14T10:20:00.000Z');
    const res = await call('/api/me/matches', await cookieFor(OTHER));
    expect(res.json).toEqual({ matches: [] });
  });

  it('needs a session (guests with a session are fine)', async () => {
    expect((await call('/api/me/matches')).status).toBe(401);
    expect((await call('/api/me/matches', await cookieFor(OTHER, true))).status).toBe(200);
  });
});

describe('match.js stores what history needs', () => {
  // A minimal adapter in the documented result() shape, independent of the game engine.
  const adapter = {
    id: 'fake-game',
    result: () => ({
      winnerId: ME,
      reason: 'net_worth',
      rounds: 7,
      standings: [
        { id: ME, rank: 1, score: 1234.4, stats: { rentEarned: 10 } },
        { id: OTHER, rank: 2, score: -50, stats: {} },
      ],
    }),
  };
  const room = {
    matchId: '33333333-3333-4333-8333-333333333333',
    code: 'ABCD23',
    startedAt: Date.parse('2026-11-14T10:00:00Z'),
    endedAt: Date.parse('2026-11-14T10:20:00Z'),
    state: {},
    players: [{ id: ME, name: 'Me' }, { id: OTHER, name: 'Ravi' }],
  };

  it('every seat gets rank + final_worth (= rounded score) and the match keeps rounds/player_count/winner', () => {
    const rec = buildMatchRecord(room, adapter);
    expect(rec.players.map(({ user_id, name, rank, final_worth }) => ({ user_id, name, rank, final_worth }))).toEqual([
      { user_id: ME, name: 'Me', rank: 1, final_worth: 1234 },
      { user_id: OTHER, name: 'Ravi', rank: 2, final_worth: -50 },
    ]);
    expect(rec).toMatchObject({ gameId: 'fake-game', rounds: 7, playerCount: 2, winnerId: ME, endedAt: '2026-11-14T10:20:00.000Z' });
    expect(PERSIST_SQL).toMatch(/INSERT INTO match_players \(match_id, user_id, name, is_bot, rank, final_worth/);
  });
});
