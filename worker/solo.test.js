// Solo-game run API (worker/routes/solo.js, worker/solo.js): in-process Hono app (worker/index.js) with the database
// faked by a small model of what SOLO_SQL does (Postgres itself is not available here).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const queryMock = vi.fn(async () => []);
const transactionMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  query: (...a) => queryMock(...a),
  transaction: (...a) => transactionMock(...a),
}));

const roomCallMock = vi.fn();
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  roomCall: (...a) => roomCallMock(...a),
  pushToUser: async () => 1,
  isUserOnline: async () => false,
}));

const achievementsMock = vi.fn(async () => []);
vi.mock('./achievements.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkAchievements: (...a) => achievementsMock(...a),
}));

const { default: worker } = await import('./index.js');
const { signSession, signSoloToken, verifySoloToken, SOLO_TOKEN_SECONDS } = await import('./auth.js');
const { SOLO_GAMES, getSoloGame } = await import('./games/solo.js');
const { GAME_ADAPTERS, getAdapter } = await import('./games/index.js');
const { soloRewards, SOLO_DAILY_CAP, levelFromXp } = await import('./xp.js');
const { SOLO_SQL, REPLAY_SQL, LOCK_SQL, parseFinishBody, assertPlausible, MAX_FIELD } = await import('./solo.js');
const { COIN_MULTIPLIER_SQL } = await import('./events.js');
const { buildLeaderboardQuery, buildLeaderboardMeQuery } = await import('./leaderboard.js');
const { _resetForTests } = await import('./ratelimit.js');
const { _resetLeaderboardCacheForTests } = await import('./routes/leaderboard.js');
const { STANDINGS_SQL } = await import('./seasons.js');
const { SignJWT } = await import('jose');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const GUEST = '00000000-0000-4000-8000-0000000000c3';
const nowSec = () => Math.floor(Date.now() / 1000);

const userRow = (id, over = {}) => ({
  id, google_sub: null, email: null, name: 'Me', avatar: 3, friend_code: 'HYD-ME22', is_guest: false,
  xp: 250, coins: 500, level: 2, games: 0, wins: 0, best_worth: 0, rent_earned: 0, ...over,
});

// ---- the fake database: users, solo matches, user_game_stats -------------------------------------------------------
let users;
let matches; // id -> { userId, gameId, earned, xp, coins, newBest, endedAt, winReason }
let stats; // `${userId}|${gameId}` -> { games, wins, best_score, extra }
let multiplier;

function soloSql(p) {
  const [id, userId, gameId, , , endedAt, earned, seconds, distance, quests, fares, style, win, rawXp, rawCoins, capXp, capCoins, dayStart] = p;
  const user = users.get(userId);
  const mine = [...matches.values()].filter((m) => m.userId === userId && m.endedAt >= Date.parse(dayStart));
  const usedXp = mine.reduce((s, m) => s + m.xp, 0);
  const usedCoins = mine.reduce((s, m) => s + m.coins, 0);
  const xp = Math.min(rawXp, Math.max(0, capXp - usedXp));
  const coins = Math.min(rawCoins, Math.max(0, capCoins - usedCoins));
  const key = `${userId}|${gameId}`;
  const prevBest = stats.get(key)?.best_score ?? 0;
  const newBest = earned > prevBest;
  if (matches.has(id)) return [[], [{ inserted: 0 }]]; // ON CONFLICT (id) DO NOTHING
  matches.set(id, { userId, gameId, earned, xp, coins, newBest, endedAt: Date.parse(endedAt), winReason: JSON.stringify({ xp, coins, newBest }) });
  user.xp += xp;
  user.coins += coins;
  const s = stats.get(key) || { games: 0, wins: 0, best_score: 0, extra: {} };
  s.games += 1;
  s.wins += win;
  s.best_score = Math.max(s.best_score, earned);
  const add = { quests, fares, distance, seconds, style };
  for (const k of Object.keys(add)) s.extra[k] = (s.extra[k] || 0) + add[k];
  stats.set(key, s);
  return [[], [{ inserted: 1, paid_xp: xp, paid_coins: coins, new_best: newBest, total_xp: user.xp, games: s.games, wins: s.wins, best_score: s.best_score }]];
}

function installDb() {
  transactionMock.mockImplementation(async (e, statements) => {
    const [[lockText], [text, params]] = statements;
    expect(lockText).toBe(LOCK_SQL);
    expect(text).toBe(SOLO_SQL);
    return soloSql(params);
  });
  queryMock.mockImplementation(async (e, text, p = []) => {
    if (/FROM users WHERE id = \$1/.test(text)) return users.has(p[0]) ? [{ ...users.get(p[0]) }] : [];
    if (/UPDATE users SET last_seen/.test(text)) return [users.get(p[0])].filter(Boolean);
    if (text === COIN_MULTIPLIER_SQL) return [{ multiplier }];
    if (text === REPLAY_SQL) {
      const m = matches.get(p[0]);
      if (!m || m.userId !== p[1] || m.gameId !== p[2]) return [];
      const s = stats.get(`${p[1]}|${p[2]}`);
      return [{ earned: m.earned, win_reason: m.winReason, total_xp: users.get(p[1]).xp, games: s.games, wins: s.wins, best_score: s.best_score }];
    }
    if (/FROM user_game_stats WHERE user_id = \$1/.test(text)) {
      return [...stats.entries()]
        .filter(([k]) => k.startsWith(`${p[0]}|`))
        .map(([k, s]) => ({ game_id: k.split('|')[1], games: s.games, wins: s.wins, best_score: s.best_score, rating: 1000 }));
    }
    return [];
  });
}

async function call(path, { method = 'GET', cookie, body, raw } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined || raw !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) }),
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
/** A run token that was issued `ago` seconds ago (so a run of up to `ago` seconds is plausible). */
const tokenFor = async (userId = ME, { ago = 600, gameId = 'autowala', now = nowSec() - ago } = {}) =>
  signSoloToken(env, { userId, gameId, now });
const good = { earned: 2000, seconds: 120, distance: 1500, quests: 4, fares: 6, style: 10 };
async function finish(token, over = {}, { cookie, gameId = 'autowala' } = {}) {
  return call(`/api/solo/${gameId}/finish`, {
    method: 'POST',
    cookie: cookie || (await cookieFor(ME)),
    body: { token, ...good, ...over },
  });
}

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  achievementsMock.mockClear();
  roomCallMock.mockReset();
  _resetForTests();
  _resetLeaderboardCacheForTests();
  users = new Map([[ME, userRow(ME)], [OTHER, userRow(OTHER, { name: 'Other' })], [GUEST, userRow(GUEST, { is_guest: true, name: 'Guest' })]]);
  matches = new Map();
  stats = new Map();
  multiplier = null;
  installDb();
});

// ---------------------------------------------------------------------------------------------------------------------

describe('solo registry', () => {
  it('has autowala with the agreed limits, and is separate from the room adapters', () => {
    expect(getSoloGame('autowala')).toEqual({
      id: 'autowala', name: 'Autowala', minSeconds: 30, maxSeconds: 7200, maxEarnPerSecond: 25, earnGrace: 1500,
      winEarned: 3000, maxDistancePerSecond: 60, maxQuests: 200,
    });
    expect(Object.keys(SOLO_GAMES)).toEqual(['autowala']);
    expect(Object.keys(GAME_ADAPTERS)).toEqual(['hyderabad-tycoon', 'tiffin-centre']);
    expect(getAdapter('autowala')).toBeNull();
    expect(getSoloGame('hyderabad-tycoon')).toBeNull();
  });

  it('is safe against prototype keys and non-strings', () => {
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'Autowala', 'ludo', null, undefined, 5, {}, [], ['autowala']]) {
      expect(getSoloGame(bad), String(bad)).toBeNull();
    }
  });
});

describe('soloRewards', () => {
  it('xp = min(120, 10 + earned/100 + quests*5), coins = min(60, earned/250 + quests*2)', () => {
    expect(soloRewards({ earned: 0, quests: 0, seconds: 60 })).toEqual({ xp: 10, coins: 0 });
    expect(soloRewards({ earned: 2000, quests: 4, seconds: 120 })).toEqual({ xp: 10 + 20 + 20, coins: 8 + 8 });
    expect(soloRewards({ earned: 99, quests: 0 })).toEqual({ xp: 10, coins: 0 });
    expect(soloRewards({ earned: 100, quests: 0 })).toEqual({ xp: 11, coins: 0 });
    expect(soloRewards({ earned: 250, quests: 0 })).toEqual({ xp: 12, coins: 1 });
  });
  it('caps one run at 120 xp / 60 coins and treats junk as zero', () => {
    expect(soloRewards({ earned: 180000, quests: 200, seconds: 7200 })).toEqual({ xp: 120, coins: 60 });
    expect(soloRewards({ earned: -5, quests: -1 })).toEqual({ xp: 10, coins: 0 });
    expect(soloRewards({ earned: NaN, quests: 'x' })).toEqual({ xp: 10, coins: 0 });
    expect(soloRewards()).toEqual({ xp: 10, coins: 0 });
    expect(SOLO_DAILY_CAP).toEqual({ xp: 600, coins: 300 });
  });
});

describe('run tokens', () => {
  it('sign + verify: claims sub, gid, jti, seed, iat, 3 hour expiry; every token is unique', async () => {
    const a = await signSoloToken(env, { userId: ME, gameId: 'autowala' });
    const b = await signSoloToken(env, { userId: ME, gameId: 'autowala' });
    const claims = await verifySoloToken(env, a.token);
    expect(claims).toMatchObject({ sub: ME, gid: 'autowala', jti: a.jti, seed: a.seed, iat: a.iat });
    expect(claims.exp - claims.iat).toBe(3 * 60 * 60);
    expect(SOLO_TOKEN_SECONDS).toBe(10800);
    expect(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff).toBe(true);
    expect(a.jti).not.toBe(b.jti);
  });

  it('rejects tampered, expired, foreign-secret, wrong-audience and junk tokens', async () => {
    const t = await signSoloToken(env, { userId: ME, gameId: 'autowala' });
    const [h, p, s] = t.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: OTHER })).toString('base64url');
    expect(await verifySoloToken(env, `${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySoloToken(env, `${h}.${p}.${s.slice(0, -2)}xx`)).toBeNull();
    expect(await verifySoloToken({ JWT_SECRET: 'another-secret-another-secret-12345' }, t.token)).toBeNull();
    const old = await signSoloToken(env, { userId: ME, gameId: 'autowala', now: nowSec() - SOLO_TOKEN_SECONDS - 60 });
    expect(await verifySoloToken(env, old.token)).toBeNull();
    const session = await signSession(env, { id: ME, isGuest: false });
    expect(await verifySoloToken(env, session)).toBeNull(); // a session is not a run token
    for (const junk of ['', 'abc', null, undefined, 5, 'x'.repeat(3000)]) expect(await verifySoloToken(env, junk)).toBeNull();
    const noJti = await new SignJWT({ gid: 'autowala', seed: 1 })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(ME).setIssuer('hyderabad-tycoon').setAudience('hyd-solo')
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifySoloToken(env, noJti)).toBeNull();
  });

  it('a run token is never accepted as a session', async () => {
    const t = await signSoloToken(env, { userId: ME, gameId: 'autowala' });
    const res = await call('/api/me', { cookie: `hyd_session=${t.token}` });
    expect(res.json).toEqual({ user: null });
  });
});

describe('POST /api/solo/:gameId/start', () => {
  it('returns { ok, token, seed, expiresAt } for a member and for a guest', async () => {
    for (const [id, guest] of [[ME, false], [GUEST, true]]) {
      const res = await call('/api/solo/autowala/start', { method: 'POST', cookie: await cookieFor(id, guest) });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: true, seed: expect.any(Number) });
      const claims = await verifySoloToken(env, res.json.token);
      expect(claims).toMatchObject({ sub: id, gid: 'autowala', seed: res.json.seed });
      expect(Date.parse(res.json.expiresAt)).toBe(claims.exp * 1000);
    }
  });

  it('needs a session, knows only solo games, and is rate limited', async () => {
    expect((await call('/api/solo/autowala/start', { method: 'POST' })).status).toBe(401);
    const cookie = await cookieFor(ME);
    for (const bad of ['hyderabad-tycoon', '__proto__', 'constructor', 'nope']) {
      expect((await call(`/api/solo/${bad}/start`, { method: 'POST', cookie })).status, bad).toBe(404);
    }
    let last;
    for (let i = 0; i < 25; i += 1) last = await call('/api/solo/autowala/start', { method: 'POST', cookie });
    expect(last.status).toBe(429);
  });
});

describe('POST /api/solo/:gameId/finish: first finish', () => {
  it('saves the run once: stats, rewards, response shape, achievements', async () => {
    const t = await tokenFor();
    const res = await finish(t.token);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ok: true, duplicate: false, earned: 2000, newBest: true, bestScore: 2000, games: 1, wins: 0,
      xp: 50, coins: 16, level: levelFromXp(250 + 50),
    });
    expect(users.get(ME)).toMatchObject({ xp: 300, coins: 516 });
    expect(stats.get(`${ME}|autowala`)).toMatchObject({ games: 1, wins: 0, best_score: 2000, extra: { quests: 4, fares: 6, distance: 1500, seconds: 120, style: 10 } });
    expect(matches.get(t.jti)).toMatchObject({ userId: ME, gameId: 'autowala', earned: 2000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(achievementsMock).toHaveBeenCalledTimes(1);
    expect(achievementsMock.mock.calls[0][1]).toEqual([ME]);
  });

  it('passes the right values to SQL: id = jti, game, win flag, caps, IST day start, multiplier', async () => {
    const t = await tokenFor();
    await finish(t.token, { earned: 3000 });
    const [, [, params]] = transactionMock.mock.calls[0][1];
    expect(params.slice(0, 4)).toEqual([t.jti, ME, 'autowala', 'Me']);
    expect(params.slice(6, 14)).toEqual([3000, 120, 1500, 4, 6, 10, 1, 10 + 30 + 20]); // win = 1 at winEarned
    expect(params.slice(15, 17)).toEqual([600, 300]);
    expect(params[17]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+05:30$/);
    expect(params[18]).toBe(1);
    expect(SOLO_SQL).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(SOLO_SQL).toMatch(/best_score = GREATEST\(user_game_stats\.best_score, EXCLUDED\.best_score\)/);
    expect(SOLO_SQL).not.toMatch(/rating =/); // solo games are unrated
  });

  it('wins + 1 only from winEarned; best score keeps the maximum; newBest tracks it', async () => {
    const a = await finish((await tokenFor()).token, { earned: 3500, seconds: 300 });
    expect(a.json).toMatchObject({ newBest: true, wins: 1, games: 1, bestScore: 3500 });
    const b = await finish((await tokenFor()).token, { earned: 1000 });
    expect(b.json).toMatchObject({ newBest: false, wins: 1, games: 2, bestScore: 3500 });
    const c = await finish((await tokenFor()).token, { earned: 4000, seconds: 300 });
    expect(c.json).toMatchObject({ newBest: true, wins: 2, games: 3, bestScore: 4000 });
    expect(stats.get(`${ME}|autowala`).extra.quests).toBe(12);
  });

  it('guests may play and save runs', async () => {
    const t = await tokenFor(GUEST);
    const res = await finish(t.token, {}, { cookie: await cookieFor(GUEST, true) });
    expect(res.status).toBe(200);
    expect(stats.get(`${GUEST}|autowala`).games).toBe(1);
  });

  it('applies the coin_boost event multiplier to coins (not xp)', async () => {
    multiplier = 2;
    const res = await finish((await tokenFor()).token);
    expect(res.json).toMatchObject({ xp: 50, coins: 32 });
  });

  it('a failing event lookup means no boost, never a failed run', async () => {
    const base = queryMock.getMockImplementation();
    queryMock.mockImplementation(async (e, text, p) => {
      if (text === COIN_MULTIPLIER_SQL) throw new Error('neon down');
      return base(e, text, p);
    });
    expect((await finish((await tokenFor()).token)).json).toMatchObject({ ok: true, coins: 16 });
  });
});

describe('POST /api/solo/:gameId/finish: replay', () => {
  it('a second finish with the same token is a no-op: same outcome, duplicate:true, nothing awarded', async () => {
    const t = await tokenFor();
    const first = await finish(t.token);
    const before = { user: { ...users.get(ME) }, stats: JSON.stringify([...stats]), matches: matches.size };
    const again = await finish(t.token);
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ ...first.json, duplicate: true });
    expect(Object.keys(again.json)).toEqual(Object.keys(first.json));
    expect(users.get(ME)).toEqual(before.user);
    expect(JSON.stringify([...stats])).toBe(before.stats);
    expect(matches.size).toBe(before.matches);
    await new Promise((r) => setTimeout(r, 0));
    expect(achievementsMock).toHaveBeenCalledTimes(1); // not for the replay
  });

  it('a replay with different (higher) numbers still answers with the stored run', async () => {
    const t = await tokenFor();
    const first = await finish(t.token, { earned: 1000 });
    const again = await finish(t.token, { earned: 9000, seconds: 500 });
    expect(again.json).toMatchObject({ duplicate: true, earned: 1000, bestScore: first.json.bestScore, xp: first.json.xp });
    expect(stats.get(`${ME}|autowala`).best_score).toBe(1000);
  });

  it('answers 409 when a token was reported finished but its run cannot be found', async () => {
    const t = await tokenFor();
    transactionMock.mockImplementation(async () => [[], [{ inserted: 0 }]]);
    expect((await finish(t.token)).status).toBe(409);
  });
});

describe('POST /api/solo/:gameId/finish: daily cap', () => {
  it('pays only what is left of 600 xp / 300 coins per IST day, still saves the stats, then pays 0', async () => {
    const todayMs = Date.now();
    matches.set('prev-1', { userId: ME, gameId: 'autowala', earned: 1, xp: 580, coins: 290, newBest: false, endedAt: todayMs });
    const a = await finish((await tokenFor()).token); // would pay 50 xp / 16 coins
    expect(a.json).toMatchObject({ ok: true, xp: 20, coins: 10, games: 1 });
    expect(users.get(ME)).toMatchObject({ xp: 270, coins: 510 });
    const b = await finish((await tokenFor()).token);
    expect(b.json).toMatchObject({ xp: 0, coins: 0, games: 2, bestScore: 2000 });
    expect(users.get(ME)).toMatchObject({ xp: 270, coins: 510 });
    expect(stats.get(`${ME}|autowala`).games).toBe(2);
  });

  it('yesterday and other players do not count against today', async () => {
    matches.set('old', { userId: ME, gameId: 'autowala', earned: 1, xp: 600, coins: 300, newBest: false, endedAt: Date.now() - 3 * 86_400_000 });
    matches.set('theirs', { userId: OTHER, gameId: 'autowala', earned: 1, xp: 600, coins: 300, newBest: false, endedAt: Date.now() });
    expect((await finish((await tokenFor()).token)).json).toMatchObject({ xp: 50, coins: 16 });
  });

  it('the cap is computed from this player\'s solo matches of the IST day, under a per-user lock', () => {
    expect(SOLO_SQL).toMatch(/m\.room_code = 'solo' AND m\.ended_at >= \$18::timestamptz/);
    expect(SOLO_SQL).toMatch(/LEAST\(\$14::int, GREATEST\(0, \$16::int - used\.xp\)\)/);
    expect(SOLO_SQL).toMatch(/LEAST\(\$15::int, GREATEST\(0, \$17::int - used\.coins\)\)/);
    expect(LOCK_SQL).toMatch(/pg_advisory_xact_lock/);
  });
});

describe('POST /api/solo/:gameId/finish: rejections', () => {
  const wrote = () => transactionMock.mock.calls.length;

  it('needs a session', async () => {
    const t = await tokenFor();
    const res = await call('/api/solo/autowala/finish', { method: 'POST', body: { token: t.token, ...good } });
    expect(res.status).toBe(401);
    expect(wrote()).toBe(0);
  });

  it("another player's token (wrong user) is refused", async () => {
    const t = await tokenFor(OTHER);
    const res = await finish(t.token);
    expect(res.status).toBe(403);
    expect(wrote()).toBe(0);
  });

  it('a token for another game is refused', async () => {
    const t = await tokenFor(ME, { gameId: 'hyderabad-tycoon' });
    const res = await finish(t.token);
    expect(res.status).toBe(400);
    expect(wrote()).toBe(0);
  });

  it('unknown game ids in the path are 404', async () => {
    const t = await tokenFor();
    for (const bad of ['hyderabad-tycoon', '__proto__', 'nope']) expect((await finish(t.token, {}, { gameId: bad })).status, bad).toBe(404);
  });

  it('expired, tampered and missing tokens are 401 / 400', async () => {
    const old = await tokenFor(ME, { now: nowSec() - SOLO_TOKEN_SECONDS - 100 });
    expect((await finish(old.token)).status).toBe(401);
    const t = await tokenFor();
    const [h, p, s] = t.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), iat: nowSec() - 7000 })).toString('base64url');
    expect((await finish(`${h}.${forged}.${s}`)).status).toBe(401);
    expect((await finish(`${h}.${p}.${s.slice(0, -3)}abc`)).status).toBe(401);
    expect((await finish('not-a-token')).status).toBe(401);
    expect((await finish(undefined)).status).toBe(400);
    expect((await finish(12345)).status).toBe(400);
    expect(wrote()).toBe(0);
  });

  it('floats, NaN, strings, negatives, huge, missing and non-object bodies are 400', async () => {
    const t = await tokenFor();
    const bads = [1.5, -1, '5', '', null, true, [1], {}, NaN, Infinity, MAX_FIELD + 1, 2 ** 53, 1e21];
    for (const field of ['earned', 'seconds', 'distance', 'quests', 'fares', 'style']) {
      for (const v of bads) {
        _resetForTests(); // the limiter allows 20 finishes a minute
        const res = await finish(t.token, { [field]: v });
        expect(res.status, `${field}=${String(v)}`).toBe(400);
        expect(res.json.error).toMatch(/whole number/);
      }
      _resetForTests();
      const missing = await call('/api/solo/autowala/finish', { method: 'POST', cookie: await cookieFor(ME), body: { token: t.token, ...good, [field]: undefined } });
      expect(missing.status, `${field} missing`).toBe(400);
    }
    _resetForTests();
    const cookie = await cookieFor(ME);
    expect((await call('/api/solo/autowala/finish', { method: 'POST', cookie, raw: '[1,2]' })).status).toBe(400);
    expect((await call('/api/solo/autowala/finish', { method: 'POST', cookie, raw: '{nope' })).status).toBe(400);
    expect((await call('/api/solo/autowala/finish', { method: 'POST', cookie, body: {} })).status).toBe(400);
    expect(wrote()).toBe(0);
  });

  it('earning faster than maxEarnPerSecond (+ grace) is refused; the exact limit is fine', async () => {
    const t = await tokenFor();
    const limit = 120 * 25 + 1500;
    const over = await finish(t.token, { earned: limit + 1 });
    expect(over.status).toBe(422);
    expect(over.json.error).toMatch(/score is too high/);
    expect(wrote()).toBe(0);
    expect((await finish(t.token, { earned: limit })).status).toBe(200);
  });

  it('too short, too long, and more seconds than have passed are refused', async () => {
    const t = await tokenFor(ME, { ago: 600 });
    expect((await finish(t.token, { seconds: 29, earned: 0, distance: 0 })).status).toBe(422);
    expect((await finish(t.token, { seconds: 606 })).status).toBe(422); // 600 s have passed (+5 slack)
    const long = await tokenFor(ME, { now: nowSec() - 3 * 3600 + 60 });
    expect((await finish(long.token, { seconds: 7201, earned: 0, distance: 0 })).status).toBe(422); // over maxSeconds
    const fresh = await tokenFor(ME, { ago: 0 });
    const res = await finish(fresh.token); // 120 s claimed right after /start
    expect(res.status).toBe(422);
    expect(res.json.error).toMatch(/passed/);
    expect(wrote()).toBe(0);
    expect((await finish(t.token, { seconds: 605 })).status).toBe(200); // the slack boundary
  });

  it('too much distance and too many quests are refused', async () => {
    const t = await tokenFor();
    expect((await finish(t.token, { distance: 120 * 60 + 1 })).status).toBe(422);
    expect((await finish(t.token, { quests: 201 })).status).toBe(422);
    expect(wrote()).toBe(0);
    expect((await finish(t.token, { distance: 120 * 60, quests: 200 })).status).toBe(200);
  });

  it('parseFinishBody / assertPlausible work standalone', () => {
    expect(parseFinishBody({ token: 'a', ...good }).run).toEqual(good);
    expect(() => parseFinishBody(null)).toThrow(/token/);
    const game = getSoloGame('autowala');
    const claims = { iat: 1000 };
    expect(() => assertPlausible(game, claims, good, 1000 * 1000 + 200_000)).not.toThrow();
    expect(() => assertPlausible(game, claims, good, 1000 * 1000 + 100_000)).toThrow(/passed/);
  });
});

describe('rooms, leaderboard and /api/me', () => {
  it('a solo game cannot be created as a room, listed as a game, or used as an open-table filter', async () => {
    const cookie = await cookieFor(ME);
    const res = await call('/api/rooms', { method: 'POST', cookie, body: { gameId: 'autowala' } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/unknown game/);
    expect(roomCallMock).not.toHaveBeenCalled();
    expect((await call('/api/rooms/open?game=autowala')).status).toBe(400);
    expect(getAdapter('autowala')).toBeNull();
  });

  it('GET /api/leaderboard?game=autowala is accepted and ranked by best score from user_game_stats', async () => {
    const seen = [];
    const base = queryMock.getMockImplementation();
    queryMock.mockImplementation(async (e, text, p) => {
      if (/FROM user_game_stats s/.test(text)) {
        seen.push({ text, p });
        return [{ rank: 1, id: OTHER, name: 'Other', avatar: 1, xp: 0, wins: 2, games: 5, best_score: 4000, rating: 1000, equipped: {} }];
      }
      return base(e, text, p);
    });
    const res = await call('/api/leaderboard?game=autowala');
    expect(res.status).toBe(200);
    expect(res.json.rows).toEqual([
      { rank: 1, name: 'Other', avatar: 1, level: 1, wins: 2, games: 5, bestScore: 4000, rating: 1000, bestWorth: 4000, frame: null, title: null, isMe: false },
    ]);
    expect(seen[0].p).toEqual(['autowala']);
    expect(seen[0].text).toMatch(/ORDER BY s\.best_score DESC/);
    expect((await call('/api/leaderboard?game=ludo')).status).toBe(400);
    expect((await call('/api/leaderboard?game=__proto__')).status).toBe(400);
  });

  it('solo boards rank by best score, room boards still by wins then rating (queries)', () => {
    const solo = buildLeaderboardQuery('autowala');
    expect(solo.params).toEqual(['autowala']);
    expect(solo.text).toMatch(/s\.game_id = \$1/);
    expect(solo.text).toMatch(/ORDER BY s\.best_score DESC, s\.wins DESC/);
    expect(solo.text).toMatch(/u\.is_guest = false/);
    expect(buildLeaderboardMeQuery('autowala', ME).text).toMatch(/s\.best_score DESC/);
    expect(buildLeaderboardQuery('hyderabad-tycoon').text).toMatch(/ORDER BY s\.wins DESC, s\.rating DESC/);
  });

  it('/api/me carries autowala in user.gameStats once the player has a run', async () => {
    await finish((await tokenFor()).token, { earned: 3200, seconds: 300 });
    const res = await call('/api/me', { cookie: await cookieFor(ME) });
    expect(res.json.user.gameStats).toEqual({ autowala: { games: 1, wins: 1, bestScore: 3200, rating: 1000 } });
  });

  it('solo runs never count towards seasons', () => {
    expect(STANDINGS_SQL).toMatch(/m\.room_code <> 'solo'/);
  });
});
