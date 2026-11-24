// Tutorial completion (worker/routes/tutorial.js, worker/games/tutorial.js), the `canHost` gate of POST /api/rooms (worker/routes/rooms.js)
// and `gameStats[id].tutorialDone` in /api/me (worker/users.js). In-process Hono app (worker/index.js); the database is faked by a small
// model of the statements involved (Postgres itself is not available here).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const queryMock = vi.fn(async () => []);
vi.mock('../db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const roomCallMock = vi.fn();
vi.mock('../hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  roomCall: (...a) => roomCallMock(...a),
  pushToUser: async () => 1,
  isUserOnline: async () => false,
}));

const { default: worker } = await import('../index.js');
const { signSession } = await import('../auth.js');
const { _resetForTests } = await import('../ratelimit.js');
const { GAME_ADAPTERS } = await import('../games/index.js');
const { TUTORIAL_GAMES, hasTutorial } = await import('../games/tutorial.js');
const { TUTORIAL_SQL } = await import('./tutorial.js');
const { rowsToGameStats } = await import('../users.js');
const { buildLeaderboardQuery, buildLeaderboardMeQuery } = await import('../leaderboard.js');
const { CAN_HOST_ERROR } = await import('../games/tiffin-centre.js');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const GUEST = '00000000-0000-4000-8000-0000000000c3';
const GONE = '00000000-0000-4000-8000-0000000000d4';
const TIFFIN = 'tiffin-centre';

const userRow = (id, over = {}) => ({
  id, google_sub: null, email: null, name: 'Me', avatar: 3, friend_code: 'HYD-ME22', is_guest: false,
  xp: 250, coins: 500, level: 2, games: 0, wins: 0, best_worth: 0, rent_earned: 0, ...over,
});

// ---- the fake database ------------------------------------------------------------------------------------------------
let users;
let stats; // `${userId}|${gameId}` -> { games, wins, best_score, rating, extra }
let writes; // every TUTORIAL_SQL call: [userId, gameId]

const flagged = (userId, gameId) => {
  const s = stats.get(`${userId}|${gameId}`);
  const x = s && (typeof s.extra === 'string' ? JSON.parse(s.extra) : s.extra);
  return !!x && x.tutorial === true;
};

function installDb() {
  queryMock.mockImplementation(async (e, text, p = []) => {
    if (/FROM users WHERE id = \$1/.test(text)) return users.has(p[0]) ? [{ ...users.get(p[0]) }] : [];
    if (/UPDATE users SET last_seen/.test(text)) return [users.get(p[0])].filter(Boolean);
    if (text === TUTORIAL_SQL) {
      // INSERT .. WHERE EXISTS (user) ON CONFLICT DO UPDATE SET extra = extra || {"tutorial":true}: nothing else changes
      writes.push([...p]);
      const [userId, gameId] = p;
      if (!users.has(userId)) return [];
      const key = `${userId}|${gameId}`;
      const row = stats.get(key) || { games: 0, wins: 0, best_score: 0, rating: 1000, extra: {} };
      stats.set(key, { ...row, extra: { ...(row.extra || {}), tutorial: true } });
      return [];
    }
    if (/extra ->> 'tutorial'/.test(text)) return flagged(p[0], p[1]) ? [{ ok: 1 }] : []; // the canHost gate of Tiffin Centre
    if (/FROM user_game_stats WHERE user_id = \$1/.test(text)) {
      return [...stats.entries()]
        .filter(([k]) => k.startsWith(`${p[0]}|`))
        .map(([k, s]) => ({ game_id: k.split('|')[1], ...s }));
    }
    return [];
  });
}

async function call(path, { method = 'GET', cookie, body } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    {},
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json };
}

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;
const complete = async (gameId = TIFFIN, id = ME, isGuest = false) =>
  call(`/api/games/${gameId}/tutorial/complete`, { method: 'POST', cookie: await cookieFor(id, isGuest) });
const openTable = async (body = { gameId: TIFFIN }, id = ME, isGuest = false) =>
  call('/api/rooms', { method: 'POST', cookie: await cookieFor(id, isGuest), body });
const tutorialChecks = () => queryMock.mock.calls.filter(([, text]) => /extra ->> 'tutorial'/.test(text));

beforeEach(() => {
  queryMock.mockReset();
  roomCallMock.mockReset();
  roomCallMock.mockResolvedValue({ status: 201, data: {} });
  _resetForTests();
  users = new Map([[ME, userRow(ME)], [GUEST, userRow(GUEST, { is_guest: true, name: 'Guest' })]]);
  stats = new Map();
  writes = [];
  installDb();
});

// ---------------------------------------------------------------------------------------------------------------------

describe('registry', () => {
  it('only Tiffin Centre has a tutorial; ids are matched exactly', () => {
    expect([...TUTORIAL_GAMES]).toEqual([TIFFIN]);
    expect(hasTutorial(TIFFIN)).toBe(true);
    for (const bad of ['hyderabad-tycoon', 'autowala', '', 'Tiffin-Centre', 'tiffin-centre ', '__proto__', 'constructor', 'toString', 'has', null, undefined, 5, {}, [TIFFIN]]) {
      expect(hasTutorial(bad), String(bad)).toBe(false);
    }
  });
});

describe('POST /api/games/:gameId/tutorial/complete', () => {
  it('needs a session', async () => {
    const res = await call(`/api/games/${TIFFIN}/tutorial/complete`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(writes).toEqual([]);
  });

  it('answers 404 for an unknown game and for a game without a tutorial (nothing is written)', async () => {
    for (const id of ['hyderabad-tycoon', 'autowala', 'nope', 'TIFFIN-CENTRE', '__proto__', 'constructor', 'toString', 'tiffin-centre%20', '%5F%5Fproto%5F%5F']) {
      const res = await complete(id);
      expect(res.status, id).toBe(404);
      expect(res.json).toEqual({ error: 'unknown game' });
    }
    expect(writes).toEqual([]);
    expect(stats.size).toBe(0);
  });

  it('records the flag for a member and answers { ok, tutorialDone }', async () => {
    const res = await complete();
    expect(res).toEqual({ status: 200, json: { ok: true, tutorialDone: true } });
    expect(writes).toEqual([[ME, TIFFIN]]);
    expect(flagged(ME, TIFFIN)).toBe(true);
  });

  it('works for guests too, and for each user separately', async () => {
    expect((await complete(TIFFIN, GUEST, true)).json).toEqual({ ok: true, tutorialDone: true });
    expect(flagged(GUEST, TIFFIN)).toBe(true);
    expect(flagged(ME, TIFFIN)).toBe(false);
  });

  it('is idempotent and keeps the other numbers and keys of the row', async () => {
    stats.set(`${ME}|${TIFFIN}`, { games: 4, wins: 2, best_score: 321, rating: 1032, extra: { note: 'kept' } });
    for (let i = 0; i < 3; i++) expect((await complete()).json).toEqual({ ok: true, tutorialDone: true });
    expect(stats.get(`${ME}|${TIFFIN}`)).toEqual({ games: 4, wins: 2, best_score: 321, rating: 1032, extra: { note: 'kept', tutorial: true } });
  });

  it('a first completion leaves games / wins / best score / rating alone: the row has games = 0 and never reaches a leaderboard', async () => {
    await complete();
    expect(stats.get(`${ME}|${TIFFIN}`)).toEqual({ games: 0, wins: 0, best_score: 0, rating: 1000, extra: { tutorial: true } });
    // the statement only inserts (user, game, extra, updated_at) and only ever updates extra / updated_at
    const set = TUTORIAL_SQL.slice(TUTORIAL_SQL.indexOf('DO UPDATE SET'));
    expect(set).toMatch(/extra\s*=/);
    expect(set).toMatch(/updated_at\s*=/);
    for (const col of ['games', 'wins', 'best_score', 'rating']) expect(set).not.toMatch(new RegExp(`\\b${col}\\b`));
    expect(TUTORIAL_SQL).toMatch(/INSERT INTO user_game_stats \(user_id, game_id, extra, updated_at\)/);
    expect(TUTORIAL_SQL).toContain("'{\"tutorial\":true}'::jsonb");
    expect(TUTORIAL_SQL).toContain('$1::uuid');
    expect(TUTORIAL_SQL).toContain('$2::text');
    // every leaderboard of a game (and a player's own row) requires games > 0
    for (const q of [buildLeaderboardQuery(TIFFIN), buildLeaderboardMeQuery(TIFFIN, ME)]) expect(q.text).toMatch(/s\.games > 0/);
  });

  it('writes nothing for an account that no longer exists (the statement is guarded; no error)', async () => {
    const res = await complete(TIFFIN, GONE);
    expect(res.status).toBe(401); // the session points at a deleted user: signed out
    expect(TUTORIAL_SQL).toMatch(/WHERE EXISTS \(SELECT 1 FROM users x WHERE x\.id = \$1::uuid\)/);
  });

  it('is rate limited (20 per minute)', async () => {
    const cookie = await cookieFor(ME);
    let last;
    for (let i = 0; i < 21; i++) last = await call(`/api/games/${TIFFIN}/tutorial/complete`, { method: 'POST', cookie });
    expect(last.status).toBe(429);
  });
});

describe('GET /api/me: gameStats[id].tutorialDone', () => {
  const me = async () => (await call('/api/me', { cookie: await cookieFor(ME) })).json.user.gameStats;

  it('is absent until the player has a row, then a boolean for Tiffin Centre only', async () => {
    expect(await me()).toEqual({});
    await complete();
    expect(await me()).toEqual({ [TIFFIN]: { games: 0, wins: 0, bestScore: 0, rating: 1000, tutorialDone: true } });
  });

  it('is false for a Tiffin row without the flag (played before / extra empty) and keeps counting real games', async () => {
    stats.set(`${ME}|${TIFFIN}`, { games: 3, wins: 1, best_score: 400, rating: 1012, extra: {} });
    stats.set(`${ME}|hyderabad-tycoon`, { games: 5, wins: 2, best_score: 900, rating: 1040, extra: { tutorial: true } });
    expect(await me()).toEqual({
      [TIFFIN]: { games: 3, wins: 1, bestScore: 400, rating: 1012, tutorialDone: false },
      'hyderabad-tycoon': { games: 5, wins: 2, bestScore: 900, rating: 1040 }, // no tutorial: no flag, whatever extra says
    });
  });

  it('reads extra as an object or as its JSON text, and only a real true counts', () => {
    const row = (extra) => ({ game_id: TIFFIN, games: 0, wins: 0, best_score: 0, rating: 1000, extra });
    const done = (extra) => rowsToGameStats([row(extra)])[TIFFIN].tutorialDone;
    expect(done({ tutorial: true })).toBe(true);
    expect(done('{"tutorial":true}')).toBe(true);
    for (const extra of [{}, null, undefined, '', 'not json', '{"tutorial":"true"}', { tutorial: 1 }, { tutorial: 'true' }, { tutorial: false }, [], 'true', 7]) {
      expect(done(extra), JSON.stringify(extra)).toBe(false);
    }
    expect(rowsToGameStats([{ game_id: 'autowala', games: 1, wins: 1, best_score: 5, rating: 1000, extra: { tutorial: true } }])).toEqual({
      autowala: { games: 1, wins: 1, bestScore: 5, rating: 1000 },
    });
    expect(rowsToGameStats(undefined)).toEqual({});
  });
});

describe('POST /api/rooms: the canHost gate', () => {
  it('refuses a host who has not finished the tutorial with 403 and the tutorial message; no room is made', async () => {
    const res = await openTable();
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Finish the Tiffin Centre tutorial first to open a table.' });
    expect(res.json.error).toBe(CAN_HOST_ERROR);
    expect(roomCallMock).not.toHaveBeenCalled();
    expect(tutorialChecks()).toHaveLength(1);
    expect(tutorialChecks()[0][2]).toEqual([ME, TIFFIN]);
  });

  it('refuses a player whose row exists but has no flag (they played, or the flag is false)', async () => {
    stats.set(`${ME}|${TIFFIN}`, { games: 2, wins: 0, best_score: 10, rating: 990, extra: {} });
    expect((await openTable()).status).toBe(403);
    stats.set(`${ME}|${TIFFIN}`, { games: 2, wins: 0, best_score: 10, rating: 990, extra: { tutorial: false } });
    expect((await openTable()).status).toBe(403);
    expect(roomCallMock).not.toHaveBeenCalled();
  });

  it('opens the table once the tutorial is done (member and guest), with validated settings and 4 seats by default', async () => {
    await complete();
    const res = await openTable({ gameId: TIFFIN, settings: { level: 4, pace: 'rush', junk: 1 } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ gameId: TIFFIN, code: expect.stringMatching(/^[A-Z0-9]{6}$/) });
    expect(roomCallMock).toHaveBeenCalledTimes(1);
    const [, , path, payload] = roomCallMock.mock.calls[0];
    expect(path).toBe('/init');
    expect(payload).toMatchObject({ gameId: TIFFIN, visibility: 'private', maxPlayers: 4, host: { id: ME, guest: false } });
    expect(payload.settings).toEqual({ level: 4, pace: 'rush' });

    await complete(TIFFIN, GUEST, true);
    const guest = await openTable({ gameId: TIFFIN, maxPlayers: 2 }, GUEST, true);
    expect(guest.status).toBe(201);
    expect(roomCallMock.mock.calls[1][3]).toMatchObject({ maxPlayers: 2, settings: { level: 1, pace: 'normal' }, host: { id: GUEST, guest: true } });
  });

  it('is only asked for the HOST of a table: it never runs for bad input (400 first) or for another game', async () => {
    for (const body of [{ gameId: TIFFIN, settings: { level: 99 } }, { gameId: TIFFIN, maxPlayers: 9 }, { gameId: TIFFIN, visibility: 'friends' }, { gameId: 'nope' }]) {
      expect((await openTable(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(tutorialChecks()).toHaveLength(0);
    // Nawabi Raj has no canHost: unaffected (and the database is not asked about any tutorial)
    expect(GAME_ADAPTERS['hyderabad-tycoon'].canHost).toBeUndefined();
    expect((await openTable({ gameId: 'hyderabad-tycoon' })).status).toBe(201);
    expect((await openTable({})).status).toBe(201); // old clients: no gameId
    expect(tutorialChecks()).toHaveLength(0);
    expect(roomCallMock).toHaveBeenCalledTimes(2);
  });

  describe('with an adapter that has its own gate', () => {
    afterEach(() => {
      delete GAME_ADAPTERS['gated-test'];
    });
    const register = (canHost) => {
      GAME_ADAPTERS['gated-test'] = {
        ...GAME_ADAPTERS['hyderabad-tycoon'],
        id: 'gated-test',
        name: 'Gated',
        canHost,
        validateSettings: () => ({ ok: true, settings: {} }),
      };
    };

    it('passes { env, user } and honours { ok:true }', async () => {
      const canHost = vi.fn(async () => ({ ok: true }));
      register(canHost);
      expect((await openTable({ gameId: 'gated-test' })).status).toBe(201);
      const arg = canHost.mock.calls[0][0];
      expect(arg.env).toMatchObject({ DATABASE_URL: 'postgres://fake' });
      expect(arg.user).toMatchObject({ id: ME, name: 'Me', is_guest: false });
    });

    it('refuses with 403 and the adapter message, or a default one; anything but { ok:true } is a refusal', async () => {
      register(async () => ({ ok: false, error: 'Not yet, friend.' }));
      let res = await openTable({ gameId: 'gated-test' });
      expect(res).toEqual({ status: 403, json: { error: 'Not yet, friend.' } });
      register(async () => ({ ok: false }));
      res = await openTable({ gameId: 'gated-test' });
      expect(res.status).toBe(403);
      expect(res.json.error).toMatch(/cannot open a table/);
      for (const odd of [undefined, null, true, 'ok', { ok: 'yes' }, {}]) {
        register(async () => odd);
        expect((await openTable({ gameId: 'gated-test' })).status, String(odd)).toBe(403);
      }
      expect(roomCallMock).not.toHaveBeenCalled();
    });

    it('a failing gate is a 500, never an open table', async () => {
      register(async () => {
        throw new Error('db down');
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await openTable({ gameId: 'gated-test' });
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(roomCallMock).not.toHaveBeenCalled();
    });
  });
});
