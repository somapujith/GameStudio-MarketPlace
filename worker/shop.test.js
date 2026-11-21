// Cosmetics shop (GET /api/shop, buy, equip) and equipped cosmetics shown to others (friends).
// In-process Hono app; the database is a small in-memory model that executes the shop SQL by name.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const queryMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isUserOnline: async () => true,
  pushToUser: async () => 1,
}));

const { sessionMiddleware, signSession } = await import('./auth.js');
const { HttpError } = await import('./db.js');
const { _resetForTests } = await import('./ratelimit.js');
const shopModule = await import('./routes/shop.js');
const { default: shopRoutes, BUY_SQL, BUY_FAIL_SQL, EQUIP_SQL, UNEQUIP_SQL, ownedList } = shopModule;
const { default: friendRoutes } = await import('./routes/friends.js');
const { COSMETICS, FREE_COSMETICS } = await import('../shared/cosmetics.js');

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const FRIEND = '00000000-0000-4000-8000-0000000000b2';

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/shop', shopRoutes);
app.route('/api/friends', friendRoutes);
app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : 500));

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;
async function call(path, { method = 'GET', cookie, body } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await app.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    {},
  );
  return { status: res.status, json: await res.json() };
}

const users = new Map();
const items = new Map(); // userId -> Set(itemId)
const userRow = (id, over = {}) => ({
  id, name: id === ME ? 'Me' : 'Friend', avatar: 3, friend_code: id === ME ? 'HYD-ME22' : 'HYD-FR22', is_guest: false,
  xp: 0, coins: 1000, level: 1, rent_earned: 0, daily_streak: 0, last_daily: null, equipped: {}, ...over,
});
const owned = (id) => items.get(id) || new Set();

function fakeDb(text, p) {
  if (/^SELECT .* FROM users WHERE id = \$1$/s.test(text.trim())) {
    const r = users.get(p[0]);
    return r ? [{ ...r }] : [];
  }
  if (/SELECT item_id FROM user_items WHERE user_id = \$1/.test(text)) return [...owned(p[0])].map((item_id) => ({ item_id }));
  if (text === BUY_SQL) {
    const [uid, itemId, price] = p;
    const u = users.get(uid);
    const before = [...owned(uid)];
    if (!u || u.coins < price || owned(uid).has(itemId)) return [{ coins: null, bought_before: before }];
    items.set(uid, new Set([...before, itemId]));
    u.coins -= price;
    return [{ coins: u.coins, bought_before: before }];
  }
  if (text === BUY_FAIL_SQL) return [{ had: owned(p[0]).has(p[1]) }];
  if (text === EQUIP_SQL) {
    const [uid, kind, itemId, free] = p;
    if (!free && !owned(uid).has(itemId)) return [];
    const u = users.get(uid);
    u.equipped = { ...u.equipped, [kind]: itemId };
    return [{ equipped: u.equipped }];
  }
  if (text === UNEQUIP_SQL) {
    const u = users.get(p[0]);
    const { [p[1]]: _drop, ...rest } = u.equipped;
    u.equipped = rest;
    return [{ equipped: rest }];
  }
  if (/FROM friendships f/.test(text)) {
    const f = users.get(FRIEND);
    return [{ status: 'accepted', outgoing: true, id: f.id, name: f.name, avatar: f.avatar, friend_code: f.friend_code, xp: f.xp, equipped: f.equipped }];
  }
  return [];
}

beforeEach(() => {
  _resetForTests();
  users.clear();
  items.clear();
  users.set(ME, userRow(ME));
  users.set(FRIEND, userRow(FRIEND));
  queryMock.mockReset();
  queryMock.mockImplementation(async (e, text, p) => fakeDb(text, p));
});

describe('GET /api/shop', () => {
  it('signed out: the whole catalogue, only free items owned, nothing equipped', async () => {
    const res = await call('/api/shop');
    expect(res.status).toBe(200);
    expect(res.json.coins).toBeNull();
    expect(res.json.equipped).toEqual({});
    expect(res.json.items).toHaveLength(COSMETICS.length);
    expect(res.json.items.filter((i) => i.owned).map((i) => i.id)).toEqual(FREE_COSMETICS);
    const lake = res.json.items.find((i) => i.id === 'frame-lake');
    expect(lake).toEqual({
      id: 'frame-lake', kind: 'frame', name: 'Hussain Sagar', price: 800, rarity: 'rare',
      source: 'shop', available: true, availableUntil: null, unlockHint: null,
      colors: ['#4cc9f0', '#2a6fdb'], owned: false, equipped: false,
    });
    expect('colors' in res.json.items.find((i) => i.kind === 'title')).toBe(false);
  });

  it('signed in: my coins, owned + equipped flags (an equipped item no longer owned is not shown as equipped)', async () => {
    items.set(ME, new Set(['frame-lake']));
    users.get(ME).equipped = { frame: 'frame-lake', title: 'title-nawab', dice: 'dice-ivory' };
    const res = await call('/api/shop', { cookie: await cookieFor(ME) });
    expect(res.json.coins).toBe(1000);
    expect(res.json.equipped).toEqual({ frame: 'frame-lake', dice: 'dice-ivory' });
    const byId = Object.fromEntries(res.json.items.map((i) => [i.id, i]));
    expect(byId['frame-lake']).toMatchObject({ owned: true, equipped: true });
    expect(byId['title-nawab']).toMatchObject({ owned: false, equipped: false });
    expect(byId['dice-ivory']).toMatchObject({ owned: true, equipped: true });
  });
});

describe('POST /api/shop/buy', () => {
  it('spends the catalogue price (never the client one) and returns coins + owned', async () => {
    const cookie = await cookieFor(ME);
    const res = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'frame-lake', price: 1 } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ coins: 200, owned: ownedList(['frame-lake']) });
    expect(res.json.owned).toEqual(expect.arrayContaining([...FREE_COSMETICS, 'frame-lake']));
    const buy = queryMock.mock.calls.find((c) => c[1] === BUY_SQL);
    expect(buy[2]).toEqual([ME, 'frame-lake', 800]);
  });

  it('409 already owned (bought or free), 402 too poor, 400 unknown', async () => {
    const cookie = await cookieFor(ME);
    expect((await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'frame-lake' } })).status).toBe(200);
    let res = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'frame-lake' } });
    expect(res).toEqual({ status: 409, json: { error: 'Already owned.' } });
    expect(users.get(ME).coins).toBe(200);
    res = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'dice-ivory' } });
    expect(res).toEqual({ status: 409, json: { error: 'Already owned.' } });
    res = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'frame-nizam' } });
    expect(res).toEqual({ status: 402, json: { error: 'Not enough coins.' } });
    expect(users.get(ME).coins).toBe(200);
    for (const itemId of ['nope', '', 5, null, undefined, { id: 'frame-lake' }]) {
      expect((await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId } })).status).toBe(400);
    }
  });

  it('a lost race on the CHECK (coins >= 0) is a 402, not a 500', async () => {
    queryMock.mockImplementation(async (e, text, p) => {
      if (text === BUY_SQL) throw Object.assign(new Error('violates check constraint'), { code: '23514' });
      return fakeDb(text, p);
    });
    const res = await call('/api/shop/buy', { method: 'POST', cookie: await cookieFor(ME), body: { itemId: 'title-chai' } });
    expect(res.status).toBe(402);
  });

  it('the statement is atomic: lock + affordable check, insert, spend only for an inserted row', () => {
    expect(BUY_SQL).toMatch(/coins >= \$3::int FOR UPDATE/);
    expect(BUY_SQL).toMatch(/ON CONFLICT \(user_id, item_id\) DO NOTHING/);
    expect(BUY_SQL).toMatch(/UPDATE users u SET coins = u\.coins - \$3::int\s+FROM ins/);
  });

  it('needs a session; guests with a session may buy; rate limited', async () => {
    expect((await call('/api/shop/buy', { method: 'POST', body: { itemId: 'title-chai' } })).status).toBe(401);
    const guest = '00000000-0000-4000-8000-0000000000c3';
    users.set(guest, userRow(guest, { is_guest: true }));
    expect((await call('/api/shop/buy', { method: 'POST', cookie: await cookieFor(guest, true), body: { itemId: 'title-chai' } })).status).toBe(200);
    const cookie = await cookieFor(ME);
    let last;
    for (let i = 0; i < 21; i += 1) last = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: 'nope' } });
    expect(last.status).toBe(429);
  });
});

describe('POST /api/shop/equip', () => {
  it('equips owned and free items, unequips with null', async () => {
    const cookie = await cookieFor(ME);
    items.set(ME, new Set(['title-hitec']));
    let res = await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'title', itemId: 'title-hitec' } });
    expect(res).toEqual({ status: 200, json: { equipped: { title: 'title-hitec' } } });
    res = await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'dice', itemId: 'dice-ivory' } });
    expect(res.json).toEqual({ equipped: { dice: 'dice-ivory', title: 'title-hitec' } });
    res = await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'title', itemId: null } });
    expect(res.json).toEqual({ equipped: { dice: 'dice-ivory' } });
    const eq = queryMock.mock.calls.filter((c) => c[1] === EQUIP_SQL).map((c) => c[2]);
    expect(eq).toEqual([
      [ME, 'title', 'title-hitec', false],
      [ME, 'dice', 'dice-ivory', true],
    ]);
  });

  it('403 when not owned; 400 for a bad kind, unknown item or the wrong slot', async () => {
    const cookie = await cookieFor(ME);
    let res = await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'frame', itemId: 'frame-nizam' } });
    expect(res).toEqual({ status: 403, json: { error: 'You do not own that item.' } });
    expect(users.get(ME).equipped).toEqual({});
    for (const body of [{ kind: 'hat', itemId: 'frame-lake' }, { itemId: 'frame-lake' }, { kind: 'frame', itemId: 'nope' }, { kind: 'frame', itemId: 'title-chai' }, { kind: 'frame', itemId: 7 }]) {
      res = await call('/api/shop/equip', { method: 'POST', cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('/api/shop/equip', { method: 'POST', body: { kind: 'frame', itemId: null } })).status).toBe(401);
  });
});

describe('equipped cosmetics are visible to friends', () => {
  it('GET /api/friends rows carry equipped (cleaned)', async () => {
    users.get(FRIEND).equipped = { frame: 'frame-nizam', title: 'bogus' };
    const res = await call('/api/friends', { cookie: await cookieFor(ME) });
    expect(res.status).toBe(200);
    expect(res.json.friends[0]).toMatchObject({ id: FRIEND, name: 'Friend', online: true, equipped: { frame: 'frame-nizam' } });
    const sql = queryMock.mock.calls.find((c) => /FROM friendships f/.test(c[1]))[1];
    expect(sql).toMatch(/u\.equipped/);
  });
});

describe('voice lines in the shop', () => {
  const V = 'voice-sheru-bhai';
  const price = COSMETICS.find((c) => c.id === V).price;

  it('GET /api/shop lists the voice line with its symbol, clip and caption, never equipped', async () => {
    const out = await call('/api/shop', { cookie: await cookieFor(ME) });
    const v = out.json.items.find((i) => i.id === V);
    expect(v).toEqual({
      id: V, kind: 'voice', name: 'Sheru Bhai', price, rarity: 'rare', source: 'shop', available: true, availableUntil: null, unlockHint: null, icon: 'tiger', emoji: '🐯',
      src: '/audio/voice/sheru-bhai.mp3', durationMs: 8300, caption: 'Sheru Bhai!', owned: false, equipped: false,
    });
    items.set(ME, new Set([V]));
    const after = await call('/api/shop', { cookie: await cookieFor(ME) });
    expect(after.json.items.find((i) => i.id === V)).toMatchObject({ owned: true, equipped: false });
  });

  it('buy: coins drop by exactly the catalogue price (a client price is ignored), it is owned, and not buyable twice', async () => {
    const cookie = await cookieFor(ME);
    users.get(ME).coins = price + 250;
    const res = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: V, price: 1, kind: 'title' } });
    expect(res.status).toBe(200);
    expect(res.json.coins).toBe(250);
    expect(res.json.owned).toContain(V);
    expect(queryMock.mock.calls.find((c) => c[1] === BUY_SQL)[2]).toEqual([ME, V, price]);
    const again = await call('/api/shop/buy', { method: 'POST', cookie, body: { itemId: V } });
    expect(again).toEqual({ status: 409, json: { error: 'Already owned.' } });
    expect(users.get(ME).coins).toBe(250);
  });

  it('buy: 402 when it costs more than the balance, nothing is spent', async () => {
    users.get(ME).coins = price - 1;
    const res = await call('/api/shop/buy', { method: 'POST', cookie: await cookieFor(ME), body: { itemId: V } });
    expect(res).toEqual({ status: 402, json: { error: 'Not enough coins.' } });
    expect(users.get(ME).coins).toBe(price - 1);
    expect(owned(ME).has(V)).toBe(false);
  });

  it('all three voice lines are listed (owned-only) and each buys for exactly its own catalogue price', async () => {
    const out = await call('/api/shop', { cookie: await cookieFor(ME) });
    const voices = out.json.items.filter((i) => i.kind === 'voice');
    expect(voices.map((i) => i.id)).toEqual(['voice-sheru-bhai', 'voice-ladle-meow', 'voice-old-man']);
    expect(voices.map((i) => [i.icon, i.emoji])).toEqual([['tiger', '🐯'], ['cat', '🐱'], ['oldman', '👴']]);
    users.get(ME).coins = 5000;
    let left = 5000;
    for (const v of voices) {
      const res = await call('/api/shop/buy', { method: 'POST', cookie: await cookieFor(ME), body: { itemId: v.id } });
      left -= v.price;
      expect(res.json.coins).toBe(left);
    }
  });

  it('voice lines are never equipped', async () => {
    items.set(ME, new Set([V]));
    const cookie = await cookieFor(ME);
    const res = await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'voice', itemId: V } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/not equipped/);
    expect((await call('/api/shop/equip', { method: 'POST', cookie, body: { kind: 'frame', itemId: V } })).status).toBe(400);
    expect(users.get(ME).equipped).toEqual({});
  });
});
