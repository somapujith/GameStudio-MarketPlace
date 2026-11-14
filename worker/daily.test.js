// Server-side daily reward + the /api/me additions (daily, equipped). In-process: Hono app with
// the database faked by a tiny model of the users row (no real DB).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const queryMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const { dailyReward, istDay, istYesterday, dailyState, dayString } = await import('./xp.js');
const { rowToUser, rowToFriend, USER_COLUMNS } = await import('./users.js');
const { sessionMiddleware, signSession } = await import('./auth.js');
const { HttpError } = await import('./db.js');
const { _resetForTests } = await import('./ratelimit.js');
const { default: meRoutes, DAILY_SQL } = await import('./routes/me.js');
const client = await import('../src/lib/storage.js');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const GUEST = '00000000-0000-4000-8000-0000000000c3';

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/me', meRoutes);
app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : 500));

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;
async function call(path, { method = 'GET', cookie } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers }), env, {});
  return { status: res.status, json: await res.json() };
}

const users = new Map();
const userRow = (id, over = {}) => ({
  id, name: 'Me', avatar: 3, friend_code: 'HYD-ME22', is_guest: false, xp: 0, coins: 500, level: 1,
  games: 0, wins: 0, best_worth: 0, rent_earned: '0', daily_streak: 0, last_daily: null, equipped: {}, ...over,
});

/** Executes DAILY_SQL the way Postgres would (SET reads the old row; WHERE guards the day). */
function fakeDb(text, p) {
  if (text === DAILY_SQL) {
    const row = users.get(p[0]);
    if (!row || row.last_daily === p[1]) return [];
    const streak = row.last_daily === p[2] ? row.daily_streak + 1 : 1;
    row.coins += p[3] + p[4] * Math.min(streak, p[5]);
    row.daily_streak = streak;
    row.last_daily = p[1];
    return [{ ...row }];
  }
  if (/FROM users WHERE id = \$1/.test(text) || /UPDATE users SET last_seen/.test(text)) {
    const row = users.get(p[0]);
    return row ? [{ ...row }] : [];
  }
  return [];
}

// 2026-11-15 20:00 IST = 14:30 UTC; 23:59 IST = 18:29 UTC; 00:01 IST next day = 18:31 UTC.
const T = (iso) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  queryMock.mockReset();
  queryMock.mockImplementation(async (e, text, p) => fakeDb(text, p));
  _resetForTests();
  users.clear();
  users.set(ME, userRow(ME));
  users.set(GUEST, userRow(GUEST, { is_guest: true, name: 'Guest' }));
});
afterEach(() => vi.useRealTimers());

describe('daily maths', () => {
  it('reward mirrors the client formula: 150, 200 ... capped at 400', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 30].map(dailyReward)).toEqual([150, 150, 200, 250, 300, 350, 400, 400, 400]);
    for (let s = 0; s < 12; s += 1) expect(dailyReward(s)).toBe(client.dailyReward(s));
  });

  it('days are Asia/Kolkata calendar days (UTC+05:30)', () => {
    expect(istDay(Date.parse('2026-11-15T18:29:00Z'))).toBe('2026-11-15'); // 23:59 IST
    expect(istDay(Date.parse('2026-11-15T18:30:00Z'))).toBe('2026-11-16'); // 00:00 IST
    expect(istDay(new Date('2026-11-14T20:00:00Z'))).toBe('2026-11-15'); // 01:30 IST
    expect(istYesterday(Date.parse('2026-03-01T00:00:00Z'))).toBe('2026-02-28');
    expect(dayString(new Date('2026-11-15T00:00:00Z'))).toBe('2026-11-15');
    expect(dayString('2026-11-15')).toBe('2026-11-15');
    expect(dayString(null)).toBeNull();
    expect(dayString('garbage')).toBeNull();
  });

  it('dailyState: claimable / claimed / streak alive / streak broken', () => {
    const now = Date.parse('2026-11-15T10:00:00Z');
    expect(dailyState({ streak: 0, lastClaim: null }, now)).toEqual({ streak: 0, lastClaim: null, canClaim: true, nextReward: 150 });
    expect(dailyState({ streak: 3, lastClaim: '2026-11-14' }, now)).toEqual({ streak: 3, lastClaim: '2026-11-14', canClaim: true, nextReward: 300 });
    expect(dailyState({ streak: 3, lastClaim: '2026-11-15' }, now)).toEqual({ streak: 3, lastClaim: '2026-11-15', canClaim: false, nextReward: 300 });
    expect(dailyState({ streak: 9, lastClaim: '2026-11-12' }, now)).toEqual({ streak: 0, lastClaim: '2026-11-12', canClaim: true, nextReward: 150 });
  });
});

describe('user rows', () => {
  it('USER_COLUMNS reads the new columns, last_daily as text', () => {
    expect(USER_COLUMNS).toMatch(/daily_streak/);
    expect(USER_COLUMNS).toMatch(/to_char\(last_daily, 'YYYY-MM-DD'\) AS last_daily/);
    expect(USER_COLUMNS).toMatch(/equipped/);
  });

  it('rowToUser adds daily + cleaned equipped; old rows without the columns still map', () => {
    const now = Date.parse('2026-11-15T10:00:00Z');
    const u = rowToUser(userRow(ME, { daily_streak: 2, last_daily: '2026-11-14', equipped: { frame: 'frame-lake', dice: 'nope', title: 'frame-pearl' } }), undefined, now);
    expect(u.daily).toEqual({ streak: 2, lastClaim: '2026-11-14', canClaim: true, nextReward: 250 });
    expect(u.equipped).toEqual({ frame: 'frame-lake' });
    const old = rowToUser({ id: ME, name: 'x', avatar: 0, xp: 0, coins: 1, rent_earned: 0 }, undefined, now);
    expect(old.daily).toEqual({ streak: 0, lastClaim: null, canClaim: true, nextReward: 150 });
    expect(old.equipped).toEqual({});
    expect(rowToFriend({ id: ME, xp: 0, equipped: '{"title":"title-chai"}' }).equipped).toEqual({ title: 'title-chai' });
  });
});

describe('GET /api/me', () => {
  it('includes daily and equipped', async () => {
    T('2026-11-15T10:00:00Z');
    users.get(ME).equipped = { dice: 'dice-cyber' };
    const res = await call('/api/me', { cookie: await cookieFor(ME) });
    expect(res.status).toBe(200);
    expect(res.json.user.daily).toEqual({ streak: 0, lastClaim: null, canClaim: true, nextReward: 150 });
    expect(res.json.user.equipped).toEqual({ dice: 'dice-cyber' });
  });
});

describe('POST /api/me/daily', () => {
  it('claims once per IST day; streak grows on consecutive days and resets after a gap', async () => {
    const cookie = await cookieFor(ME);
    T('2026-11-15T10:00:00Z');
    let res = await call('/api/me/daily', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reward: 150, streak: 1, coins: 650, daily: { streak: 1, lastClaim: '2026-11-15', canClaim: false, nextReward: 200 } });

    // same IST day (23:59 IST) -> 409, nothing paid
    T('2026-11-15T18:29:00Z');
    res = await call('/api/me/daily', { method: 'POST', cookie });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'Already claimed today.' });
    expect(users.get(ME).coins).toBe(650);

    // one minute later it is the next IST day -> streak 2
    T('2026-11-15T18:31:00Z');
    res = await call('/api/me/daily', { method: 'POST', cookie });
    expect(res.json).toMatchObject({ reward: 200, streak: 2, coins: 850 });

    // skip a day -> back to 1
    T('2026-11-17T18:31:00Z'); // 2026-11-18 IST
    res = await call('/api/me/daily', { method: 'POST', cookie });
    expect(res.json).toMatchObject({ reward: 150, streak: 1, coins: 1000 });
  });

  it('caps the reward at day 6, binds every value as a parameter', async () => {
    T('2026-11-15T10:00:00Z');
    Object.assign(users.get(ME), { daily_streak: 8, last_daily: '2026-11-14' });
    const res = await call('/api/me/daily', { method: 'POST', cookie: await cookieFor(ME) });
    expect(res.json).toMatchObject({ reward: 400, streak: 9 });
    const call0 = queryMock.mock.calls.find((c) => c[1] === DAILY_SQL);
    expect(call0[2]).toEqual([ME, '2026-11-15', '2026-11-14', 100, 50, 6]);
    expect(DAILY_SQL).toMatch(/last_daily IS DISTINCT FROM \$2::date/);
  });

  it('guests with a session can claim; signed out is 401', async () => {
    T('2026-11-15T10:00:00Z');
    expect((await call('/api/me/daily', { method: 'POST', cookie: await cookieFor(GUEST, true) })).status).toBe(200);
    expect((await call('/api/me/daily', { method: 'POST' })).status).toBe(401);
  });

  it('is rate limited', async () => {
    T('2026-11-15T10:00:00Z');
    const cookie = await cookieFor(ME);
    const statuses = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await call('/api/me/daily', { method: 'POST', cookie })).status);
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(1, 10).every((s) => s === 409)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
