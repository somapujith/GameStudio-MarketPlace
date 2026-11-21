// Achievements, referral rewards, seasonal events and seasons (docs/ENGAGEMENT.md), in-process through the Worker
// (as admin.test.js). The database is a small in-memory model that executes the engagement SQL by its text, so the
// money rules (unlock once, pay once, guarded payouts) are exercised end to end; the SQL text itself is pinned too.
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

const pushMock = vi.fn(async () => 1);
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  roomCall: vi.fn(),
  pushToUser: (...a) => pushMock(...a),
  isUserOnline: async () => false,
}));

let googleClaims = null;
vi.mock('./auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyGoogleCredential: async () => googleClaims,
}));

const { default: worker } = await import('./index.js');
const { signSession } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const { METRICS_SQL, UNLOCK_SQL, evaluateAchievements } = await import('./achievements.js');
const { SET_REFERRER_SQL, REFERRAL_REWARD_SQL, MY_REFERRALS_SQL, REFERRAL_COINS, REFERRAL_CAP, applyReferral } = await import('./referrals.js');
const { LIVE_EVENTS_SQL, COIN_MULTIPLIER_SQL } = await import('./events.js');
const { seasonStatus, parseTiers, STANDINGS_SQL, PAYOUT_SQL, SEASON_SQL, CURRENT_SEASON_SQL, PAID_ALREADY, NOT_ENDED } = await import('./seasons.js');
const { SEASON_CREATE_SQL } = await import('./routes/seasons.js');
const { EVENT_CREATE_SQL } = await import('./routes/events.js');
const { BUY_SQL, BUY_FAIL_SQL } = await import('./routes/shop.js');
const { AUDIT_INSERT_SQL } = await import('./admin.js');
const { PERSIST_SQL, persistMatch, buildMatchRecord } = await import('./match.js');
const { getAdapter } = await import('./games/index.js');
const engine = await import('../shared/index.js');
const { ACHIEVEMENTS, achievementById } = await import('../shared/achievements.js');
const { COSMETICS, cosmeticById } = await import('../shared/cosmetics.js');

const env = {
  JWT_SECRET: 'unit-test-secret-unit-test-secret-1234',
  DATABASE_URL: 'postgres://fake',
  GOOGLE_CLIENT_ID: 'client',
  APP_NAME: 'Jalebi Games',
};
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const MOD = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const GUEST = '00000000-0000-4000-8000-0000000000c1';
const BANNED = '00000000-0000-4000-8000-0000000000d1';
const SEASON = '50000000-0000-4000-8000-000000000001';
const DAY = 86_400_000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

// ---------------------------------------------------------------- the in-memory database

let db;
const userRow = (id, over = {}) => ({
  id, google_sub: null, email: null, name: 'Someone', avatar: 3, friend_code: 'HYD-AB22', handle: null, is_guest: false,
  xp: 0, coins: 500, level: 1, games: 0, wins: 0, best_worth: 0, rent_earned: 0, daily_streak: 0, last_daily: null,
  equipped: {}, friend_requests: 'everyone', role: 'user', banned_at: null, ban_reason: null,
  referred_by: null, referral_rewarded_at: null, created_at: isoAgo(DAY), last_seen: isoAgo(0), ...over,
});

function reset() {
  db = {
    users: new Map(),
    stats: new Map(), // userId -> { wins, games }
    friends: new Map(), // userId -> accepted friends
    achievements: new Map(), // userId -> Map(id -> at)
    items: new Map(), // userId -> Set
    notifications: [],
    events: [],
    seasons: new Map(),
    audit: [],
    persisted: [],
  };
  const add = (r) => db.users.set(r.id, r);
  add(userRow(ADMIN, { name: 'Admin', role: 'admin', friend_code: 'HYD-ADMN' }));
  add(userRow(MOD, { name: 'Mod', role: 'moderator', friend_code: 'HYD-MDMD' }));
  add(userRow(P1, { name: 'Asha', friend_code: 'HYD-AAAA' }));
  add(userRow(P2, { name: 'Bilal', friend_code: 'HYD-BBBB' }));
  add(userRow(GUEST, { name: 'Guest', is_guest: true, friend_code: 'HYD-GGGG' }));
  add(userRow(BANNED, { name: 'Banned', banned_at: isoAgo(DAY), friend_code: 'HYD-ZZZZ' }));
}

const list = (m, k) => {
  if (!m.has(k)) m.set(k, m === db.items ? new Set() : new Map());
  return m.get(k);
};
const insertNotification = (userId, kind, title, body, data) => {
  const n = { id: `n${db.notifications.length + 1}`, user_id: userId, kind, title, body, data, read_at: null, created_at: new Date().toISOString() };
  db.notifications.push(n);
  return n;
};
const isLiveAt = (e, t) => e.active && Date.parse(e.starts_at) <= t && t < Date.parse(e.ends_at);
let standingsRows = [];

function fakeDb(text, p = []) {
  if (text === METRICS_SQL) {
    return p[0].filter((id) => db.users.has(id)).map((id) => {
      const u = db.users.get(id);
      const s = db.stats.get(id) || { wins: 0, games: 0 };
      const referrals = [...db.users.values()].filter((x) => x.referred_by === id && x.referral_rewarded_at).length;
      return {
        id, xp: u.xp, daily_streak: u.daily_streak, wins: s.wins, games: s.games, friends: db.friends.get(id) || 0, referrals,
        referral_pending: !!u.referred_by && !u.referral_rewarded_at,
        unlocked: [...list(db.achievements, id)].map(([aid, at]) => ({ id: aid, at })),
      };
    });
  }
  if (text === UNLOCK_SQL) {
    const want = JSON.parse(p[0]);
    const won = want.filter((w) => db.users.has(w.user_id) && !list(db.achievements, w.user_id).has(w.achievement_id));
    const ownedBefore = [];
    const wallets = new Map();
    const items = [];
    const notifications = [];
    for (const w of won) list(db.achievements, w.user_id).set(w.achievement_id, new Date().toISOString());
    for (const w of won) {
      if (w.coins > 0) {
        db.users.get(w.user_id).coins += w.coins;
        wallets.set(w.user_id, db.users.get(w.user_id).coins);
      }
      if (w.item_id) {
        const own = list(db.items, w.user_id);
        for (const i of own) ownedBefore.push({ userId: w.user_id, itemId: i });
        if (!own.has(w.item_id)) {
          own.add(w.item_id);
          items.push({ userId: w.user_id, itemId: w.item_id });
        }
      }
      notifications.push(insertNotification(w.user_id, 'achievement', w.title, w.body, w.data));
    }
    return [{
      unlocked: won.map((w) => ({ userId: w.user_id, achievementId: w.achievement_id, unlockedAt: new Date().toISOString() })),
      wallets: [...wallets].map(([userId, coins]) => ({ userId, coins })),
      items,
      notifications,
      owned_before: ownedBefore,
    }];
  }
  if (text === SET_REFERRER_SQL) {
    const [uid, code] = p;
    const u = db.users.get(uid);
    const r = [...db.users.values()].find((x) => x.friend_code === code);
    if (!u || u.is_guest || u.referred_by || !r || r.id === u.id || r.is_guest || r.banned_at) return [];
    u.referred_by = r.id;
    return [{ referrer_id: r.id }];
  }
  if (text === REFERRAL_REWARD_SQL) {
    const [uid, coins, cap, days, title, pre, post, tail] = p;
    const u = db.users.get(uid);
    if (!u || u.referral_rewarded_at || !u.referred_by) return [{ user_id: null, referrer_id: null, referrer_paid: false, wallets: [], notifications: [] }];
    const r = db.users.get(u.referred_by);
    const recent = [...db.users.values()].filter((x) => x.referred_by === r.id && x.referral_rewarded_at && Date.parse(x.referral_rewarded_at) > Date.now() - days * DAY).length;
    const paid = !r.banned_at && recent < cap;
    u.referral_rewarded_at = new Date().toISOString();
    u.coins += coins;
    const wallets = [{ userId: u.id, coins: u.coins }];
    const notifications = [insertNotification(u.id, 'gift', title, `${pre}${r.name}${post}`, { coins, referral: { name: r.name, role: 'invitee' } })];
    if (paid) {
      r.coins += coins;
      wallets.push({ userId: r.id, coins: r.coins });
      notifications.push(insertNotification(r.id, 'gift', title, `${u.name}${tail}`, { coins, referral: { name: u.name, role: 'referrer' } }));
    }
    return [{ user_id: u.id, referrer_id: r.id, referrer_paid: paid, wallets, notifications }];
  }
  if (text === MY_REFERRALS_SQL) {
    const mine = [...db.users.values()].filter((x) => x.referred_by === p[0]);
    return [{
      invited: mine.length,
      rewarded: mine.filter((x) => x.referral_rewarded_at).length,
      coins_earned: db.notifications.filter((n) => n.user_id === p[0] && n.data.referral?.role === 'referrer').reduce((a, n) => a + n.data.coins, 0),
      recent: mine.map((x) => ({ name: x.name, avatar: x.avatar, joinedAt: x.created_at, rewarded: !!x.referral_rewarded_at })),
    }];
  }
  if (text === LIVE_EVENTS_SQL) return db.events.filter((e) => isLiveAt(e, Date.now()));
  if (text === COIN_MULTIPLIER_SQL) {
    const t = Date.parse(p[0]);
    const ms = db.events.filter((e) => e.kind === 'coin_boost' && isLiveAt(e, t)).map((e) => e.config.multiplier);
    return [{ multiplier: ms.length ? String(Math.max(...ms)) : null }];
  }
  if (text === PERSIST_SQL) {
    db.persisted.push(p);
    return [{ inserted: 1, users: [] }];
  }
  if (text === BUY_SQL) {
    const [uid, itemId, price] = p;
    const u = db.users.get(uid);
    const own = list(db.items, uid);
    const before = [...own];
    if (u.coins < price || own.has(itemId)) return [{ coins: null, bought_before: before }];
    own.add(itemId);
    u.coins -= price;
    return [{ coins: u.coins, bought_before: before }];
  }
  if (text === BUY_FAIL_SQL) return [{ had: list(db.items, p[0]).has(p[1]) }];
  if (text === AUDIT_INSERT_SQL) {
    db.audit.push({ admin_id: p[0], action: p[2], target_id: p[3], details: JSON.parse(p[5]) });
    return [{ id: db.audit.length }];
  }
  if (text === EVENT_CREATE_SQL) {
    const row = { id: `e${db.events.length + 1}`, kind: p[0], name: p[1], description: p[2], starts_at: p[3], ends_at: p[4], active: p[5], config: JSON.parse(p[6]), created_at: new Date().toISOString() };
    db.events.push(row);
    return [row];
  }
  if (text === SEASON_CREATE_SQL) {
    const row = { id: SEASON, name: p[0], starts_at: p[1], ends_at: p[2], prize_tiers: JSON.parse(p[3]), paid_at: null, created_at: new Date().toISOString() };
    db.seasons.set(row.id, row);
    return [row];
  }
  if (text === SEASON_SQL) return db.seasons.has(p[0]) ? [{ ...db.seasons.get(p[0]) }] : [];
  if (text === CURRENT_SEASON_SQL) return [...db.seasons.values()].slice(0, 1);
  if (text === STANDINGS_SQL) return standingsRows.filter((r) => r.rank <= p[2] || r.user_id === p[3]);
  if (text === PAYOUT_SQL) {
    const s = db.seasons.get(p[0]);
    if (!s || s.paid_at || Date.parse(s.ends_at) > Date.now() || JSON.stringify(s.prize_tiers) !== p[1]) {
      return [{ guarded: 0, ranked: 0, paid: 0, wallets: [], items: [], notifications: [], owned_before: [] }];
    }
    s.paid_at = new Date().toISOString();
    const tiers = JSON.parse(p[2]);
    const notifications = [];
    const wallets = [];
    for (const r of standingsRows) {
      const t = tiers.find((x) => r.rank >= x.from_rank && r.rank <= x.to_rank);
      if (!t) continue;
      const u = db.users.get(r.user_id);
      if (t.coins) {
        u.coins += t.coins;
        wallets.push({ userId: u.id, coins: u.coins });
      }
      if (t.item_id) list(db.items, u.id).add(t.item_id);
      notifications.push(insertNotification(u.id, 'gift', `${p[3]}${s.name}`, null, { coins: t.coins, season: { id: s.id, name: s.name, rank: r.rank } }));
    }
    return [{ guarded: 1, ranked: standingsRows.length, paid: notifications.length, wallets, items: [], notifications, owned_before: [] }];
  }
  if (/INSERT INTO users \(google_sub/.test(text)) {
    const [sub, email, name, avatar, code] = p;
    const existing = [...db.users.values()].find((x) => x.google_sub === sub);
    if (existing) return [{ ...existing, inserted: false }];
    const row = userRow(`00000000-0000-4000-8000-0000000001${String(db.users.size).padStart(2, '0')}`, { google_sub: sub, email, name, avatar, friend_code: code });
    db.users.set(row.id, row);
    return [{ ...row, inserted: true }];
  }
  if (/FROM users WHERE id = \$1/.test(text)) {
    const r = db.users.get(p[0]);
    return r ? [{ ...r }] : [];
  }
  if (/SELECT item_id FROM user_items WHERE user_id = \$1/.test(text)) return [...list(db.items, p[0])].map((item_id) => ({ item_id }));
  return [];
}

const cookieFor = async (id) => `hyd_session=${await signSession(env, { id, isGuest: !!db.users.get(id)?.is_guest })}`;
async function call(path, { method = 'GET', as, body } = {}) {
  const headers = new Headers();
  if (as) headers.set('cookie', await cookieFor(as));
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const pushesTo = (id) => pushMock.mock.calls.filter(([, uid]) => uid === id).map(([, , m]) => m);
const sqlCalls = (sql) => queryMock.mock.calls.filter((c) => c[1] === sql);

beforeEach(() => {
  reset();
  standingsRows = [];
  googleClaims = null;
  queryMock.mockReset();
  queryMock.mockImplementation(async (e, text, p) => fakeDb(text, p));
  pushMock.mockClear();
  _resetForTests();
});

// ---------------------------------------------------------------- achievements

describe('achievements', () => {
  it('the catalogue matches the contract and every reward item is an achievement-only cosmetic', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual(['first-win', 'regular', 'champion', 'on-a-roll', 'ten-day-streak', 'full-set', 'set-collector', 'tycoon', 'adda-regular', 'recruiter', 'level-10']);
    for (const a of ACHIEVEMENTS) {
      if (a.reward.itemId) expect(cosmeticById(a.reward.itemId)).toMatchObject({ source: 'achievement' });
      expect(a.reward.coins || a.reward.itemId).toBeTruthy();
    }
    expect(achievementById('champion').reward).toEqual({ coins: 300, itemId: 'title-champion' });
    expect(achievementById('tycoon').goal).toBe(4_000_000);
  });

  it('unlocks once and pays once: a second evaluation pays nothing', async () => {
    db.stats.set(P1, { wins: 1, games: 1 });
    const first = await evaluateAchievements(env, [P1]);
    expect(first.map((u) => u.achievementId)).toEqual(['first-win']);
    expect(db.users.get(P1).coins).toBe(700);
    const n = db.notifications.filter((x) => x.user_id === P1);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'achievement', title: 'Achievement unlocked: First Win', data: { achievementId: 'first-win', coins: 200 } });
    expect(pushesTo(P1)).toEqual([
      { t: 'notification', notification: expect.objectContaining({ kind: 'achievement', data: { achievementId: 'first-win', coins: 200 } }) },
      { t: 'wallet', coins: 700 },
    ]);

    pushMock.mockClear();
    expect(await evaluateAchievements(env, [P1])).toEqual([]);
    expect(db.users.get(P1).coins).toBe(700);
    expect(db.notifications).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
    // already-unlocked achievements are not even sent to the unlock statement
    expect(sqlCalls(UNLOCK_SQL)).toHaveLength(1);
  });

  it('an item reward is granted with the coins and pushed as items', async () => {
    db.stats.set(P1, { wins: 10, games: 12 });
    const done = await evaluateAchievements(env, [P1]);
    expect(done.map((u) => u.achievementId).sort()).toEqual(['champion', 'first-win', 'regular']);
    expect(db.users.get(P1).coins).toBe(500 + 200 + 300 + 300);
    expect(db.items.get(P1).has('title-champion')).toBe(true);
    const champ = db.notifications.find((x) => x.data.achievementId === 'champion');
    expect(champ.data).toEqual({ achievementId: 'champion', coins: 300, itemId: 'title-champion', itemName: 'Champion' });
    const items = pushesTo(P1).filter((m) => m.t === 'items');
    expect(items).toHaveLength(1);
    expect(items[0].owned).toContain('title-champion');
  });

  it('the unlock statement is idempotent: insert ON CONFLICT DO NOTHING, pay only inserted rows, in one statement', () => {
    expect(UNLOCK_SQL).toMatch(/INSERT INTO user_achievements[\s\S]*ON CONFLICT \(user_id, achievement_id\) DO NOTHING\s+RETURNING/);
    expect(UNLOCK_SQL).toMatch(/FROM ins i JOIN want w/);
    expect(UNLOCK_SQL).toMatch(/UPDATE users u SET coins = u\.coins \+ t\.total[\s\S]*FROM won/);
    expect(UNLOCK_SQL).toMatch(/INSERT INTO user_items[\s\S]*FROM won[\s\S]*ON CONFLICT \(user_id, item_id\) DO NOTHING/);
    expect(UNLOCK_SQL).toMatch(/'achievement', title, body, data FROM won/);
    expect(METRICS_SQL).toMatch(/sum\(wins\)[\s\S]*FROM user_game_stats/);
  });

  it('per-match facts: full-set, set-collector and tycoon unlock from the match just played', async () => {
    let done = await evaluateAchievements(env, [P1], { facts: { [P1]: { setsCompleted: 1, finalWorth: 3_999_999 } } });
    expect(done.map((u) => u.achievementId)).toEqual(['full-set']);
    done = await evaluateAchievements(env, [P1], { facts: { [P1]: { setsCompleted: 3, finalWorth: 4_000_000 } } });
    expect(done.map((u) => u.achievementId)).toEqual(['set-collector', 'tycoon']);
    expect(db.items.get(P1).has('title-collector')).toBe(true);
    // facts never carry over to a later check
    expect(await evaluateAchievements(env, [P2])).toEqual([]);
  });

  it('a forfeited (resigned) player gets no per-match facts', () => {
    const tycoon = getAdapter('hyderabad-tycoon');
    const players = [{ id: P1, name: 'A', avatar: 1 }, { id: P2, name: 'B', avatar: 2 }];
    const state = engine.createGame({ players, seed: 3 });
    state.phase = 'over';
    state.winner = P1;
    state.players[1].resigned = true;
    state.players[1].bankrupt = true;
    const rec = buildMatchRecord(
      { code: 'ABCD23', matchId: '11111111-1111-4111-8111-111111111111', startedAt: Date.now() - 1000, endedAt: Date.now(), state, meta: { sets: { [P1]: ['pink', 'teal'], [P2]: ['blue'] } }, players },
      tycoon,
    );
    expect(rec.facts[P1]).toMatchObject({ setsCompleted: 2 });
    expect(rec.facts[P1].finalWorth).toBeGreaterThan(0);
    expect(rec.facts[P2]).toBeUndefined();
  });

  it('GET /api/achievements: catalogue signed out (progress null), progress + unlock state signed in', async () => {
    let res = await call('/api/achievements');
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(ACHIEVEMENTS.length);
    expect(res.json.unlocked).toBe(0);
    expect(res.json.achievements[0]).toEqual({
      id: 'first-win', name: 'First Win', description: 'Win your first match.', icon: 'star', category: 'play', goal: 1,
      reward: { coins: 200 }, progress: null, unlocked: false, unlockedAt: null,
    });
    db.stats.set(P1, { wins: 1, games: 4 });
    await evaluateAchievements(env, [P1]);
    res = await call('/api/achievements', { as: P1 });
    const by = Object.fromEntries(res.json.achievements.map((a) => [a.id, a]));
    expect(res.json.unlocked).toBe(1);
    expect(by['first-win']).toMatchObject({ unlocked: true, progress: 1 });
    expect(by['first-win'].unlockedAt).toMatch(/^\d{4}-/);
    expect(by.regular).toMatchObject({ unlocked: false, progress: 4, goal: 10 });
    expect(by.tycoon).toMatchObject({ progress: 0 });
    expect(by.champion.reward).toEqual({ coins: 300, itemId: 'title-champion', itemName: 'Champion' });
  });

  it('a daily claim checks the streak achievements', async () => {
    queryMock.mockImplementation(async (e, text, p) => {
      if (/UPDATE users SET\s+daily_streak/.test(text)) {
        const u = db.users.get(p[0]);
        u.daily_streak = 3;
        u.coins += 250;
        return [{ ...u, last_daily: p[1] }];
      }
      return fakeDb(text, p);
    });
    const res = await call('/api/me/daily', { method: 'POST', as: P1 });
    expect(res.status).toBe(200);
    expect(res.json.streak).toBe(3);
    await flush();
    expect([...db.achievements.get(P1).keys()]).toEqual(['on-a-roll']);
    expect(pushesTo(P1).map((m) => m.t)).toEqual(['notification', 'wallet']);
  });

  it('accepting a friend request checks adda-regular for both players', async () => {
    db.friends.set(P1, 5);
    db.friends.set(P2, 5);
    queryMock.mockImplementation(async (e, text, p) => {
      if (/UPDATE friendships SET status = 'accepted'/.test(text)) return [{ ok: 1 }];
      return fakeDb(text, p);
    });
    const res = await call('/api/friends/accept', { method: 'POST', as: P1, body: { userId: P2 } });
    expect(res.status).toBe(200);
    expect(db.achievements.get(P1).has('adda-regular')).toBe(true);
    expect(db.achievements.get(P2).has('adda-regular')).toBe(true);
    expect(db.users.get(P2).coins).toBe(700);
  });
});

// ---------------------------------------------------------------- referrals

describe('referrals', () => {
  const signIn = (sub, ref) => {
    googleClaims = { sub, email: `${sub}@example.com`, name: `User ${sub}` };
    return call('/api/auth/google', { method: 'POST', body: { credential: 'x', ...(ref === undefined ? {} : { ref }) } });
  };
  const newest = () => [...db.users.values()].find((u) => u.google_sub === googleClaims.sub);

  it('the ref is stored only when the Google account is created by that call', async () => {
    let res = await signIn('new-1', 'hyd-aaaa');
    expect(res.status).toBe(200);
    expect(newest().referred_by).toBe(P1);
    expect(sqlCalls(SET_REFERRER_SQL)[0][2]).toEqual([newest().id, 'HYD-AAAA']);

    // an existing account signing in again with another ref: never touched
    queryMock.mockClear();
    res = await signIn('new-1', 'HYD-BBBB');
    expect(res.status).toBe(200);
    expect(newest().referred_by).toBe(P1);
    expect(sqlCalls(SET_REFERRER_SQL)).toHaveLength(0);
  });

  it('self, guest, banned, unknown and malformed refs are ignored (and never fail the sign-in)', async () => {
    for (const [sub, ref] of [['g', 'HYD-GGGG'], ['b', 'HYD-ZZZZ'], ['u', 'HYD-QQQQ'], ['m', 'not a code'], ['n', 42], ['l', 'x'.repeat(100)]]) {
      const res = await signIn(sub, ref);
      expect(res.status, String(ref)).toBe(200);
      expect(newest().referred_by, String(ref)).toBeNull();
    }
    // self: the new account's own friend code
    googleClaims = { sub: 'self', email: 's@example.com', name: 'Self' };
    await call('/api/auth/google', { method: 'POST', body: { credential: 'x' } });
    const self = newest();
    expect(await applyReferral(env, self.id, self.friend_code)).toBeNull();
    expect(self.referred_by).toBeNull();
    expect(SET_REFERRER_SQL).toMatch(/r\.id <> u\.id AND r\.is_guest = false AND r\.banned_at IS NULL/);
    expect(SET_REFERRER_SQL).toMatch(/u\.is_guest = false AND u\.referred_by IS NULL/);
    // a failing referral write does not fail the sign-in
    queryMock.mockImplementation(async (e, text, p) => {
      if (text === SET_REFERRER_SQL) throw new Error('db down');
      return fakeDb(text, p);
    });
    expect((await signIn('z', 'HYD-AAAA')).status).toBe(200);
  });

  it('guests are never referred', async () => {
    expect(await applyReferral(env, GUEST, 'HYD-AAAA')).toBeNull();
    expect(db.users.get(GUEST).referred_by).toBeNull();
  });

  const finishedMatch = (ids) => ({
    id: '22222222-2222-4222-8222-222222222222',
    gameId: 'hyderabad-tycoon',
    roomCode: 'ABCD23',
    startedAt: isoAgo(60_000),
    endedAt: new Date().toISOString(),
    rounds: 5,
    winnerId: ids[0],
    winReason: 'rounds',
    goal: null,
    maxRounds: 20,
    diceMode: 'lucky',
    playerCount: ids.length,
    players: [],
    users: ids.map((id, i) => ({ user_id: id, won: i === 0 ? 1 : 0, xp: 50, coins: 100, score: 0, lg: 1, lw: 0, lworth: 0, lrent: 0 })),
    seats: ids.map((id, i) => ({ id, rank: i + 1 })),
    facts: {},
  });

  it("the invitee's first persisted match pays both 250 coins once, then never again; the referrer gets recruiter", async () => {
    const NEW = '00000000-0000-4000-8000-0000000000e1';
    db.users.set(NEW, userRow(NEW, { name: 'Newbie', friend_code: 'HYD-NNNN', referred_by: P1 }));
    await persistMatch(env, finishedMatch([NEW, P2]));
    expect(db.users.get(NEW).coins).toBe(500 + REFERRAL_COINS);
    // the referrer: 250 + the recruiter achievement (300 coins + title)
    expect(db.users.get(P1).coins).toBe(500 + REFERRAL_COINS + 300);
    expect(db.achievements.get(P1).has('recruiter')).toBe(true);
    expect(db.items.get(P1).has('title-recruiter')).toBe(true);
    const gifts = db.notifications.filter((n) => n.kind === 'gift');
    expect(gifts.map((n) => [n.user_id, n.data])).toEqual([
      [NEW, { coins: 250, referral: { name: 'Asha', role: 'invitee' } }],
      [P1, { coins: 250, referral: { name: 'Newbie', role: 'referrer' } }],
    ]);
    expect(pushesTo(NEW).map((m) => m.t)).toEqual(['notification', 'wallet']);
    // a second match pays nothing
    await persistMatch(env, { ...finishedMatch([NEW, P2]), id: '33333333-3333-4333-8333-333333333333' });
    expect(db.users.get(NEW).coins).toBe(500 + REFERRAL_COINS);
    expect(db.users.get(P1).coins).toBe(500 + REFERRAL_COINS + 300);
    expect(sqlCalls(REFERRAL_REWARD_SQL)).toHaveLength(1); // not pending any more: the reward statement is not even run
    expect(REFERRAL_REWARD_SQL).toMatch(/WHERE id = \$1::uuid AND referral_rewarded_at IS NULL AND referred_by IS NOT NULL/);

    const mine = await call('/api/me/referrals', { as: P1 });
    expect(mine.json).toEqual({
      code: 'HYD-AAAA', link: '/?ref=HYD-AAAA', invited: 1, rewarded: 1, coinsEarned: 250,
      recent: [{ name: 'Newbie', avatar: 3, joinedAt: expect.any(String), rewarded: true }],
    });
    expect((await call('/api/me/referrals', { as: GUEST })).status).toBe(403);
  });

  it('the cap: past 20 rewarded referrals in 30 days only the new player is paid', async () => {
    for (let i = 0; i < REFERRAL_CAP; i += 1) {
      const id = `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`;
      db.users.set(id, userRow(id, { referred_by: P1, referral_rewarded_at: isoAgo((i + 1) * 3600_000) }));
    }
    const NEW = '00000000-0000-4000-8000-0000000000e2';
    db.users.set(NEW, userRow(NEW, { name: 'Late', referred_by: P1 }));
    await persistMatch(env, finishedMatch([NEW]));
    expect(db.users.get(NEW).coins).toBe(500 + REFERRAL_COINS);
    // over the cap: P1 gets nothing from the referral (only the recruiter achievement, 300)
    expect(db.users.get(P1).coins).toBe(500 + 300);
    expect(db.notifications.filter((n) => n.user_id === P1 && n.kind === 'gift')).toHaveLength(0);
    expect(REFERRAL_REWARD_SQL).toMatch(/referral_rewarded_at > now\(\) - make_interval\(days => \$4::int\)\) < \$3::int/);
    expect(sqlCalls(REFERRAL_REWARD_SQL)[0][2].slice(1, 4)).toEqual([250, 20, 30]);

    // referrals older than 30 days free slots (every rewarded referral counts, paid or not: 'Late' holds one now)
    db.users.get('00000000-0000-4000-8000-000000000200').referral_rewarded_at = isoAgo(31 * DAY);
    db.users.get('00000000-0000-4000-8000-000000000201').referral_rewarded_at = isoAgo(31 * DAY);
    const NEXT = '00000000-0000-4000-8000-0000000000e3';
    db.users.set(NEXT, userRow(NEXT, { name: 'Next', referred_by: P1 }));
    await persistMatch(env, { ...finishedMatch([NEXT]), id: '44444444-4444-4444-8444-444444444444' });
    expect(db.users.get(P1).coins).toBe(500 + 300 + REFERRAL_COINS);
  });
});

// ---------------------------------------------------------------- events

describe('coin boost', () => {
  it('the multiplier live at ended_at is applied to the match coins only and recorded', async () => {
    db.events.push({ id: 'e1', kind: 'coin_boost', name: 'Double coins', active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { multiplier: 2 } });
    db.events.push({ id: 'e2', kind: 'coin_boost', name: 'Off', active: false, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { multiplier: 3 } });
    const tycoon = getAdapter('hyderabad-tycoon');
    const players = [{ id: P1, name: 'A', avatar: 1 }, { id: P2, name: 'B', avatar: 2 }];
    const state = engine.createGame({ players, seed: 5 });
    state.phase = 'over';
    state.winner = P1;
    const rec = buildMatchRecord({ code: 'ABCD23', matchId: '55555555-5555-4555-8555-555555555555', startedAt: Date.now() - 1000, endedAt: Date.now(), state, meta: {}, players }, tycoon);
    const res = await persistMatch(env, rec);
    expect(res).toEqual({ inserted: true, coinMultiplier: 2 });
    const params = db.persisted[0];
    expect(params[14]).toBe(2);
    const users = JSON.parse(params[11]);
    for (const u of users) {
      const base = rec.users.find((x) => x.user_id === u.user_id);
      expect(u.coins).toBe(Math.round(base.coins * 2));
      expect(u.xp).toBe(base.xp); // XP is never boosted
    }
    expect(PERSIST_SQL).toMatch(/coin_multiplier\)\s+VALUES[\s\S]*\$15::numeric\)/);
    expect(sqlCalls(COIN_MULTIPLIER_SQL)[0][2]).toEqual([rec.endedAt]);
  });

  it('a 1.5x boost rounds; no event or a failing lookup means 1', async () => {
    db.events.push({ id: 'e1', kind: 'coin_boost', active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { multiplier: 1.5 } });
    const rec = { ...buildMinimal(), users: [{ user_id: P1, won: 1, xp: 10, coins: 45, score: 0, lg: 0, lw: 0, lworth: 0, lrent: 0 }] };
    await persistMatch(env, rec);
    expect(JSON.parse(db.persisted[0][11])[0].coins).toBe(68); // Math.round(67.5)
    queryMock.mockImplementation(async (e, text, p) => {
      if (text === COIN_MULTIPLIER_SQL) throw new Error('down');
      return fakeDb(text, p);
    });
    expect(await persistMatch(env, rec)).toEqual({ inserted: true, coinMultiplier: 1 });
    expect(JSON.parse(db.persisted[1][11])[0].coins).toBe(45);
  });

  it('GET /api/events/live: live events, the highest multiplier, cached 60 s', async () => {
    db.events.push({ id: 'e1', kind: 'coin_boost', name: 'x1.5', description: null, active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { multiplier: 1.5 }, created_at: isoAgo(DAY) });
    db.events.push({ id: 'e2', kind: 'coin_boost', name: 'Double', description: 'Till Sunday', active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { multiplier: 2 }, created_at: isoAgo(DAY) });
    db.events.push({ id: 'e3', kind: 'limited_shop', name: 'Diwali', description: null, active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { itemIds: ['frame-diwali'] }, created_at: isoAgo(DAY) });
    db.events.push({ id: 'e4', kind: 'coin_boost', name: 'Old', active: true, starts_at: isoAgo(3 * DAY), ends_at: isoAgo(DAY), config: { multiplier: 3 } });
    const res = await call('/api/events/live');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.json.coinMultiplier).toBe(2);
    expect(res.json.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(res.json.events[1]).toEqual({ id: 'e2', kind: 'coin_boost', name: 'Double', description: 'Till Sunday', startsAt: expect.any(String), endsAt: expect.any(String), config: { multiplier: 2 } });
    db.events.length = 0;
    expect((await call('/api/events/live')).json).toEqual({ events: [], coinMultiplier: 1 });
  });
});

function buildMinimal() {
  return {
    id: '66666666-6666-4666-8666-666666666666', gameId: 'hyderabad-tycoon', roomCode: 'ABCD23', startedAt: isoAgo(1000), endedAt: new Date().toISOString(),
    rounds: 1, winnerId: P1, winReason: null, goal: null, maxRounds: null, diceMode: null, playerCount: 1, players: [], users: [], seats: [{ id: P1, rank: 1 }], facts: {},
  };
}

describe('limited shop', () => {
  const live = (over = {}) => ({ id: 'e1', kind: 'limited_shop', name: 'Diwali', active: true, starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), config: { itemIds: ['frame-diwali'] }, ...over });

  it('an event item is refused outside its window and bought inside it', async () => {
    db.users.get(P1).coins = 10_000;
    let res = await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId: 'frame-diwali' } });
    expect(res).toMatchObject({ status: 409, json: { error: 'Not available right now.' } });
    db.events.push(live({ ends_at: isoAgo(1000) })); // already over
    res = await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId: 'frame-diwali' } });
    expect(res.status).toBe(409);
    db.events.push(live({ id: 'e2', config: { itemIds: ['dice-diwali'] } })); // live, but another item
    expect((await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId: 'frame-diwali' } })).status).toBe(409);
    db.events.push(live({ id: 'e3' }));
    res = await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId: 'frame-diwali' } });
    expect(res.status).toBe(200);
    expect(res.json.coins).toBe(10_000 - cosmeticById('frame-diwali').price);
    expect(res.json.owned).toContain('frame-diwali');
  });

  it('achievement and season items are never buyable; shop items are unaffected', async () => {
    db.users.get(P1).coins = 100_000;
    for (const itemId of ['title-champion', 'frame-streak', 'title-season-champ', 'frame-season']) {
      const res = await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId } });
      expect(res, itemId).toMatchObject({ status: 409, json: { error: 'Not available right now.' } });
    }
    expect((await call('/api/shop/buy', { method: 'POST', as: P1, body: { itemId: 'frame-lake' } })).status).toBe(200);
  });

  it('GET /api/shop: source, available, availableUntil and unlockHint', async () => {
    const end = isoAgo(-2 * DAY);
    db.events.push(live({ ends_at: end }));
    const res = await call('/api/shop');
    const by = Object.fromEntries(res.json.items.map((i) => [i.id, i]));
    expect(res.json.items).toHaveLength(COSMETICS.length);
    expect(by['frame-diwali']).toMatchObject({ source: 'event', available: true, availableUntil: new Date(end).toISOString(), unlockHint: null });
    expect(by['dice-diwali']).toMatchObject({ source: 'event', available: false, availableUntil: null, unlockHint: 'Limited: on sale during special events' });
    expect(by['title-champion']).toMatchObject({ source: 'achievement', available: false, unlockHint: 'Unlock: Champion achievement' });
    expect(by['frame-streak']).toMatchObject({ unlockHint: 'Unlock: Ten Day Streak achievement' });
    expect(by['title-season-champ']).toMatchObject({ source: 'season', available: false, unlockHint: 'Season prize: finish 1st in a season' });
    expect(by['frame-lake']).toMatchObject({ source: 'shop', available: true, availableUntil: null, unlockHint: null });
  });
});

// ---------------------------------------------------------------- seasons

describe('seasons', () => {
  it('status is derived from the window and paid_at', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    const s = { starts_at: '2026-11-22T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', paid_at: null };
    expect(seasonStatus(s, now)).toBe('scheduled');
    expect(seasonStatus({ ...s, starts_at: '2026-11-21T12:00:00Z' }, now)).toBe('active');
    expect(seasonStatus({ ...s, starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-21T12:00:00Z' }, now)).toBe('ended');
    expect(seasonStatus({ ...s, starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-10T00:00:00Z', paid_at: '2026-11-11T00:00:00Z' }, now)).toBe('paid');
  });

  it('prize tiers: non-overlapping, ranks 1-1000, coins <= 100,000, a real item, coins or an item', () => {
    expect(parseTiers([{ fromRank: 2, toRank: 10, coins: 500, itemId: 'frame-season' }, { fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ' }])).toEqual([
      { fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ' },
      { fromRank: 2, toRank: 10, coins: 500, itemId: 'frame-season' },
    ]);
    const bad = [
      [[{ fromRank: 1, toRank: 5, coins: 1 }, { fromRank: 5, toRank: 9, coins: 1 }], 'Prize tiers must not overlap.'],
      [[{ fromRank: 0, toRank: 5, coins: 1 }], /ranks from 1 to 1000/],
      [[{ fromRank: 1, toRank: 1001, coins: 1 }], /ranks from 1 to 1000/],
      [[{ fromRank: 3, toRank: 2, coins: 1 }], /ranks from 1 to 1000/],
      [[{ fromRank: 1, toRank: 1, coins: 100_001 }], /Prize coins must be a whole number from 1 to 100,000/],
      [[{ fromRank: 1, toRank: 1, coins: 1.5 }], /Prize coins/],
      [[{ fromRank: 1, toRank: 1 }], 'Each prize tier needs coins, an item or both.'],
      [[{ fromRank: 1, toRank: 1, itemId: 'nope' }], 'Unknown prize item.'],
      [[{ fromRank: 1, toRank: 1, itemId: 'dice-ivory' }], 'Unknown prize item.'],
      ['x', 'prizeTiers must be a list.'],
    ];
    for (const [input, msg] of bad) expect(() => parseTiers(input), JSON.stringify(input)).toThrow(msg);
  });

  const createSeason = (body) => call('/api/admin/seasons', { method: 'POST', as: ADMIN, body });

  it('POST /api/admin/seasons validates and audits', async () => {
    let res = await createSeason({ name: 'S1', startsAt: isoAgo(0), endsAt: isoAgo(DAY), prizeTiers: [] });
    expect(res).toMatchObject({ status: 400, json: { error: 'The end must be after the start.' } });
    res = await createSeason({ name: 'S1', startsAt: isoAgo(0), endsAt: isoAgo(-DAY), prizeTiers: [{ fromRank: 1, toRank: 3, coins: 1 }, { fromRank: 2, toRank: 4, coins: 1 }] });
    expect(res).toMatchObject({ status: 400, json: { error: 'Prize tiers must not overlap.' } });
    res = await createSeason({ name: '', startsAt: isoAgo(0), endsAt: isoAgo(-DAY) });
    expect(res.status).toBe(400);
    res = await createSeason({ name: 'Monsoon Cup', startsAt: isoAgo(0), endsAt: isoAgo(-DAY), prizeTiers: [{ fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ' }] });
    expect(res.status).toBe(200);
    expect(res.json.season).toMatchObject({ id: SEASON, name: 'Monsoon Cup', status: 'active', paidAt: null, prizeTiers: [{ fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ', itemName: 'Season Champion' }] });
    expect(db.audit.at(-1)).toMatchObject({ admin_id: ADMIN, action: 'season.create' });
  });

  it('payout: refused before the end and when already paid; pays the tiers once', async () => {
    db.seasons.set(SEASON, { id: SEASON, name: 'Monsoon Cup', starts_at: isoAgo(10 * DAY), ends_at: isoAgo(-DAY), prize_tiers: [{ fromRank: 1, toRank: 1, coins: 5000 }, { fromRank: 2, toRank: 3, coins: 1000 }], paid_at: null, created_at: isoAgo(10 * DAY) });
    standingsRows = [
      { user_id: P1, name: 'Asha', avatar: 1, equipped: {}, rank: 1, points: 30, wins: 8, games: 6 },
      { user_id: P2, name: 'Bilal', avatar: 2, equipped: { frame: 'frame-lake', dice: 'dice-ivory' }, rank: 2, points: 20, wins: 5, games: 5 },
    ];
    const payout = (body = { confirm: true }) => call(`/api/admin/seasons/${SEASON}/payout`, { method: 'POST', as: ADMIN, body });
    expect(await payout()).toMatchObject({ status: 409, json: { error: NOT_ENDED } });
    expect(sqlCalls(PAYOUT_SQL)).toHaveLength(0);
    db.seasons.get(SEASON).ends_at = isoAgo(1000);
    expect(await payout({})).toMatchObject({ status: 400 });
    let res = await payout();
    expect(res).toEqual({ status: 200, json: { paid: 2 }, headers: expect.anything() });
    expect(db.users.get(P1).coins).toBe(5500);
    expect(db.users.get(P2).coins).toBe(1500);
    expect(db.notifications.find((n) => n.user_id === P1)).toMatchObject({ kind: 'gift', title: 'Season prize: Monsoon Cup', data: { coins: 5000, season: { id: SEASON, name: 'Monsoon Cup', rank: 1 } } });
    expect(db.audit.at(-1)).toMatchObject({ action: 'season.payout', details: { id: SEASON, paid: 2 } });
    await flush();
    expect(pushesTo(P1).map((m) => m.t)).toEqual(['notification', 'wallet']);

    res = await payout();
    expect(res).toMatchObject({ status: 409, json: { error: PAID_ALREADY } });
    expect(db.users.get(P1).coins).toBe(5500);
    // a race lost at the guard is a 409 too, never a second payment
    db.seasons.get(SEASON).paid_at = null;
    const real = db.seasons.get(SEASON);
    queryMock.mockImplementation(async (e, text, p) => {
      if (text === PAYOUT_SQL) {
        real.paid_at = new Date().toISOString(); // someone else paid first
        return [{ guarded: 0 }];
      }
      return fakeDb(text, p);
    });
    expect(await payout()).toMatchObject({ status: 409, json: { error: PAID_ALREADY } });
    expect(db.users.get(P1).coins).toBe(5500);
  });

  it('the payout statement is guarded by paid_at, the end and the stored tiers; standings use window functions', () => {
    expect(PAYOUT_SQL).toMatch(/UPDATE seasons SET paid_at = now\(\)\s+WHERE id = \$1::uuid AND paid_at IS NULL AND ends_at <= now\(\)/);
    expect(PAYOUT_SQL).toMatch(/INSERT INTO user_items[\s\S]*ON CONFLICT \(user_id, item_id\) DO NOTHING/);
    expect(PAYOUT_SQL).toMatch(/INSERT INTO season_results/);
    expect(STANDINGS_SQL).toMatch(/row_number\(\) OVER \(ORDER BY 3 \* a\.wins \+ a\.games DESC, a\.wins DESC, a\.last_at ASC/);
    expect(STANDINGS_SQL).toMatch(/u\.is_guest = false AND u\.banned_at IS NULL/);
    expect(STANDINGS_SQL).toMatch(/m\.ended_at >= \$1::timestamptz AND m\.ended_at < \$2::timestamptz/);
  });

  it('GET /api/seasons/current: the season, standings with my row flagged, and me; equipped is frame/title only', async () => {
    db.seasons.set(SEASON, { id: SEASON, name: 'Monsoon Cup', starts_at: isoAgo(DAY), ends_at: isoAgo(-DAY), prize_tiers: [], paid_at: null });
    standingsRows = [
      { user_id: P1, name: 'Asha', avatar: 1, equipped: {}, rank: 1, points: 30, wins: 8, games: 6 },
      { user_id: P2, name: 'Bilal', avatar: 2, equipped: { frame: 'frame-lake', dice: 'dice-ivory' }, rank: 2, points: 20, wins: 5, games: 5 },
    ];
    let res = await call('/api/seasons/current', { as: P2 });
    expect(res.json.season).toMatchObject({ id: SEASON, status: 'active', prizeTiers: [] });
    expect(res.json.standings[1]).toEqual({ rank: 2, userId: P2, name: 'Bilal', avatar: 2, points: 20, wins: 5, games: 5, equipped: { frame: 'frame-lake' }, isMe: true });
    expect(res.json.me).toEqual({ rank: 2, points: 20, wins: 5, games: 5 });
    res = await call('/api/seasons/current');
    expect(res.json.me).toBeNull();
    db.seasons.clear();
    expect((await call('/api/seasons/current')).json).toEqual({ season: null, standings: [], me: null });
    expect((await call('/api/seasons/nope')).status).toBe(400);
    expect((await call(`/api/seasons/${SEASON}`)).status).toBe(404);
  });

  it('PATCH is refused after the payout', async () => {
    db.seasons.set(SEASON, { id: SEASON, name: 'Done', starts_at: isoAgo(10 * DAY), ends_at: isoAgo(DAY), prize_tiers: [], paid_at: isoAgo(1000) });
    const res = await call(`/api/admin/seasons/${SEASON}`, { method: 'PATCH', as: ADMIN, body: { name: 'Again' } });
    expect(res).toMatchObject({ status: 409, json: { error: PAID_ALREADY } });
  });
});

// ---------------------------------------------------------------- admin permissions and validation

describe('admin endpoints', () => {
  const event = { kind: 'coin_boost', name: 'Double coins weekend', startsAt: isoAgo(0), endsAt: isoAgo(-2 * DAY), config: { multiplier: 2 } };

  it('players get 403 Staff only.; moderators may read but not write; admins write (audited)', async () => {
    for (const path of ['/api/admin/events', '/api/admin/seasons', '/api/admin/achievements', '/api/admin/referrals']) {
      expect((await call(path, { as: P1 })).json, path).toEqual({ error: 'Staff only.' });
      expect((await call(path, { as: MOD })).status, path).toBe(200);
    }
    const writes = [
      ['/api/admin/events', 'POST', event],
      ['/api/admin/events/00000000-0000-4000-8000-00000000eeee', 'PATCH', { name: 'x' }],
      ['/api/admin/events/00000000-0000-4000-8000-00000000eeee', 'DELETE', undefined],
      ['/api/admin/seasons', 'POST', { name: 'S', startsAt: isoAgo(0), endsAt: isoAgo(-DAY) }],
      [`/api/admin/seasons/${SEASON}`, 'PATCH', { name: 'x' }],
      [`/api/admin/seasons/${SEASON}/payout`, 'POST', { confirm: true }],
      [`/api/admin/users/${P1}/achievements`, 'POST', { achievementId: 'first-win', reason: 'bug fix' }],
    ];
    for (const [path, method, body] of writes) {
      const res = await call(path, { method, as: MOD, body });
      expect(res, `${method} ${path}`).toMatchObject({ status: 403, json: { error: 'You do not have permission to do that.' } });
      expect((await call(path, { method, as: P1, body })).status).toBe(403);
    }
    expect(db.audit).toHaveLength(0);
    const res = await call('/api/admin/events', { method: 'POST', as: ADMIN, body: event });
    expect(res.status).toBe(200);
    expect(res.json.event).toMatchObject({ kind: 'coin_boost', name: 'Double coins weekend', config: { multiplier: 2 }, active: true, live: true });
    expect(db.audit).toEqual([expect.objectContaining({ admin_id: ADMIN, action: 'event.create' })]);
  });

  it('event validation: multiplier steps, 31 days, event-only items, kinds', async () => {
    const post = (over) => call('/api/admin/events', { method: 'POST', as: ADMIN, body: { ...event, ...over } });
    expect((await post({ config: { multiplier: 1.7 } })).json).toEqual({ error: 'The multiplier must be 1.5, 2, 2.5 or 3.' });
    expect((await post({ config: { multiplier: 4 } })).status).toBe(400);
    expect((await post({ endsAt: isoAgo(-32 * DAY) })).json).toEqual({ error: 'An event can last at most 31 days.' });
    expect((await post({ endsAt: isoAgo(DAY) })).json).toEqual({ error: 'The end must be after the start.' });
    expect((await post({ kind: 'party' })).json).toEqual({ error: 'Kind must be coin_boost or limited_shop.' });
    expect((await post({ kind: 'limited_shop', config: { itemIds: [] } })).json).toEqual({ error: 'Pick at least one limited item.' });
    expect((await post({ kind: 'limited_shop', config: { itemIds: ['frame-lake'] } })).json).toEqual({ error: 'Only limited event items can be sold in a limited shop.' });
    expect((await post({ name: 'x'.repeat(61) })).status).toBe(400);
    expect((await post({ description: 'x'.repeat(201) })).status).toBe(400);
    const ok = await post({ kind: 'limited_shop', config: { itemIds: ['dice-diwali', 'frame-diwali', 'dice-diwali'], junk: 1 } });
    expect(ok.json.event.config).toEqual({ itemIds: ['dice-diwali', 'frame-diwali'] });
  });

  it('GET /api/admin/achievements counts unlocks per achievement over members', async () => {
    queryMock.mockImplementation(async (e, text, p) => {
      if (/GROUP BY a\.achievement_id/.test(text)) return [{ achievement_id: 'first-win', unlocked: 7 }];
      if (/AS members FROM users/.test(text)) return [{ members: 40 }];
      return fakeDb(text, p);
    });
    const res = await call('/api/admin/achievements', { as: MOD });
    expect(res.json.members).toBe(40);
    expect(res.json.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(res.json.achievements[0]).toEqual({ id: 'first-win', name: 'First Win', unlocked: 7 });
    expect(res.json.achievements[1]).toEqual({ id: 'regular', name: 'Regular', unlocked: 0 });
  });

  it('POST /api/admin/users/:id/achievements unlocks + pays like a real unlock, 409 the second time', async () => {
    const grant = (body) => call(`/api/admin/users/${P1}/achievements`, { method: 'POST', as: ADMIN, body });
    expect((await grant({ achievementId: 'nope', reason: 'test grant' })).json).toEqual({ error: 'Unknown achievement.' });
    expect((await grant({ achievementId: 5, reason: 'test grant' })).json).toEqual({ error: 'Invalid achievement id.' });
    expect((await grant({ achievementId: 'champion' })).json).toEqual({ error: 'Give a reason (3-200 characters).' });
    expect((await call('/api/admin/users/00000000-0000-4000-8000-00000000ffff/achievements', { method: 'POST', as: ADMIN, body: { achievementId: 'champion', reason: 'ok ok' } })).status).toBe(404);
    let res = await grant({ achievementId: 'champion', reason: 'lost by a bug' });
    expect(res.json).toEqual({ unlocked: true });
    expect(db.users.get(P1).coins).toBe(800);
    expect(db.items.get(P1).has('title-champion')).toBe(true);
    expect(db.notifications.at(-1)).toMatchObject({ user_id: P1, kind: 'achievement' });
    expect(db.audit.at(-1)).toMatchObject({ action: 'achievement.grant', target_id: P1, details: { reason: 'lost by a bug', achievementId: 'champion', coins: 300, itemId: 'title-champion' } });
    res = await grant({ achievementId: 'champion', reason: 'lost by a bug' });
    expect(res).toMatchObject({ status: 409, json: { error: 'Already unlocked.' } });
    expect(db.users.get(P1).coins).toBe(800);
  });

  it('GET /api/admin/actions accepts the new action names', async () => {
    for (const action of ['event.create', 'event.update', 'event.delete', 'season.create', 'season.update', 'season.payout', 'achievement.grant']) {
      expect((await call(`/api/admin/actions?action=${action}`, { as: MOD })).status, action).toBe(200);
    }
  });
});

// ---------------------------------------------------------------- the adapter

describe('Nawabi Raj adapter: setsCompleted', () => {
  const tycoon = getAdapter('hyderabad-tycoon');

  it('tracks the distinct colour groups each player completed, from set_complete events', () => {
    const s = engine.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 1 });
    let meta = tycoon.track({ hotels: { a: 1 } }, [{ type: 'set_complete', player: 'a', group: 'pink' }], s);
    expect(meta).toEqual({ hotels: { a: 1 }, sets: { a: ['pink'] } });
    const before = meta;
    meta = tycoon.track(meta, [{ type: 'set_complete', player: 'a', group: 'pink' }, { type: 'cash' }], s);
    expect(meta).toBe(before); // a repeat of the same group changes nothing
    meta = tycoon.track(meta, [{ type: 'set_complete', player: 'a', group: 'teal' }, { type: 'set_complete', player: 'b', group: 'pink' }], s);
    expect(meta.sets).toEqual({ a: ['pink', 'teal'], b: ['pink'] });
    expect(before.sets).toEqual({ a: ['pink'] }); // never mutated

    const over = { ...s, phase: 'over', winner: 'a', winReason: 'rounds' };
    const res = tycoon.result(over, meta);
    const by = Object.fromEntries(res.standings.map((r) => [r.id, r.stats]));
    expect(by.a).toMatchObject({ setsCompleted: 2, finished: true });
    expect(by.b).toMatchObject({ setsCompleted: 1 });
    expect(by.a.finalWorth).toBe(res.standings.find((r) => r.id === 'a').score);
    expect(tycoon.result(over, {}).standings.every((r) => r.stats.setsCompleted === 0)).toBe(true);
  });
});
