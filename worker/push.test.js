// Web Push: the RFC 8291 test vector, a decrypt round trip with a test key pair, VAPID JWTs,
// subscription validation, the no-op without secrets, and the /api/push routes.
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
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const push = await import('./push.js');
const { signSession } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const worker = await miniApp({ '/api/push': (await import('./routes/push.js')).default });

/** The routes under test behind the same session middleware and error mapping as worker/index.js. */
async function miniApp(routes) {
  const { Hono } = await import('hono');
  const { sessionMiddleware } = await import('./auth.js');
  const { HttpError } = await import('./db.js');
  const app = new Hono();
  app.use('*', sessionMiddleware);
  for (const [path, r] of Object.entries(routes)) app.route(path, r);
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: 'Something went wrong.' }, 500)));
  return { fetch: (req, env, ctx) => app.fetch(req, env, ctx) };
}

const { b64uDecode, b64uEncode, encryptPayload, _importEcdhPrivateForTests: importEcdhPrivate } = push;
const enc = new TextEncoder();

// RFC 8291 Appendix A
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function hkdf(salt, ikm, info, n) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, n * 8));
}

/** The receiving side (what a browser does), written independently from the sender for the round trip. */
async function decrypt(body, uaPrivateKey, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1; // strip padding
  expect(plain[end]).toBe(2); // last-record delimiter
  return { rs, text: new TextDecoder().decode(plain.slice(0, end)) };
}

async function testKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

async function vapidEnv() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    env: { VAPID_PUBLIC_KEY: b64uEncode(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com', DATABASE_URL: 'postgres://fake' },
    verifyKey: pair.publicKey,
  };
}

const subscriptionFor = (keys, auth, endpoint = 'https://fcm.googleapis.com/fcm/send/abc123def456') => ({
  endpoint,
  keys: { p256dh: b64uEncode(keys.publicRaw), auth: b64uEncode(auth) },
});

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async () => []);
  push._resetPushCachesForTests();
  _resetForTests();
});

describe('RFC 8291 payload encryption', () => {
  it('reproduces the RFC 8291 Appendix A message byte for byte', async () => {
    const asPublic = b64uDecode(RFC.asPublic);
    const sender = { privateKey: await importEcdhPrivate(b64uDecode(RFC.asPrivate), asPublic), publicRaw: asPublic };
    const body = await encryptPayload(b64uDecode(RFC.plaintext), b64uDecode(RFC.uaPublic), b64uDecode(RFC.auth), {
      salt: b64uDecode(RFC.salt),
      senderKeys: sender,
    });
    expect(b64uEncode(body)).toBe(RFC.body);
  });

  it('decrypts the RFC message with the user agent key', async () => {
    const uaPublic = b64uDecode(RFC.uaPublic);
    const uaKey = await importEcdhPrivate(b64uDecode(RFC.uaPrivate), uaPublic);
    const { rs, text } = await decrypt(b64uDecode(RFC.body), uaKey, uaPublic, b64uDecode(RFC.auth));
    expect(rs).toBe(4096);
    expect(text).toBe('When I grow up, I want to be a watermelon');
  });

  it('round trip with a fresh test key pair and random salt / sender key', async () => {
    const ua = await testKeyPair();
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ title: 'Teja invited you', body: 'Room ABCD23', url: '/join/ABCD23' });
    const a = await encryptPayload(enc.encode(msg), ua.publicRaw, auth);
    const b = await encryptPayload(enc.encode(msg), ua.publicRaw, auth);
    expect(b64uEncode(a)).not.toBe(b64uEncode(b)); // fresh salt and ephemeral key every time
    expect((await decrypt(a, ua.privateKey, ua.publicRaw, auth)).text).toBe(msg);
    expect(a.length).toBe(16 + 4 + 1 + 65 + enc.encode(msg).length + 1 + 16);
  });
});

describe('VAPID', () => {
  it('signs an ES256 JWT for the push origin that verifies with the public key', async () => {
    const { env, verifyKey } = await vapidEnv();
    const jwt = await push.vapidJwt(env, 'https://fcm.googleapis.com', Date.parse('2026-11-15T10:00:00Z'));
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(new TextDecoder().decode(b64uDecode(c)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:test@example.com' });
    expect(claims.exp - Date.parse('2026-11-15T10:00:00Z') / 1000).toBe(12 * 3600);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64uDecode(s), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('sendPush', () => {
  it('is a no-op without the three VAPID secrets', async () => {
    const fetchImpl = vi.fn();
    const ua = await testKeyPair();
    const sub = subscriptionFor(ua, crypto.getRandomValues(new Uint8Array(16)));
    for (const env of [{}, { VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' }, { VAPID_SUBJECT: 'mailto:a@b.c' }]) {
      expect(push.pushConfigured(env)).toBe(false);
      expect(push.pushPublicKey(env)).toBeNull();
      expect(await push.sendPush(env, sub, { title: 'x' }, { fetchImpl })).toEqual({ ok: false, skipped: true });
      expect(await push.sendPushToUser(env, 'u', { title: 'x' }, { fetchImpl })).toBe(0);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('POSTs an encrypted aes128gcm body with VAPID auth the subscriber can decrypt', async () => {
    const { env } = await vapidEnv();
    const ua = await testKeyPair();
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const fetchImpl = vi.fn(async () => ({ status: 201 }));
    const res = await push.sendPush(env, subscriptionFor(ua, auth), { title: 'Hi', url: '/join/ABCD23' }, { fetchImpl });
    expect(res).toEqual({ ok: true, status: 201, gone: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc123def456');
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '7200' });
    expect(init.headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_PUBLIC_KEY}$`));
    expect(JSON.parse((await decrypt(init.body, ua.privateKey, ua.publicRaw, auth)).text)).toEqual({ title: 'Hi', url: '/join/ABCD23' });
  });

  it('deletes subscriptions the push service says are gone (404 / 410) and keeps others', async () => {
    const { env } = await vapidEnv();
    const ua = await testKeyPair();
    const sub = subscriptionFor(ua, crypto.getRandomValues(new Uint8Array(16)));
    for (const status of [404, 410]) {
      queryMock.mockClear();
      const res = await push.sendPush(env, sub, {}, { fetchImpl: async () => ({ status }) });
      expect(res).toMatchObject({ ok: false, gone: true });
      expect(queryMock).toHaveBeenCalledWith(env, push.DELETE_SUBSCRIPTION_SQL, [sub.endpoint]);
    }
    queryMock.mockClear();
    expect(await push.sendPush(env, sub, {}, { fetchImpl: async () => ({ status: 500 }) })).toMatchObject({ ok: false, gone: false });
    expect(await push.sendPush(env, sub, {}, { fetchImpl: async () => { throw new Error('net'); } })).toEqual({ ok: false });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('sendPushToUser reads the user subscriptions and counts accepted pushes', async () => {
    const { env } = await vapidEnv();
    const a = await testKeyPair();
    const b = await testKeyPair();
    const rows = [a, b].map((k, i) => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/device${i}xxxxxxxx`,
      p256dh: b64uEncode(k.publicRaw),
      auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
    }));
    queryMock.mockImplementation(async (e, text) => (text === push.USER_SUBSCRIPTIONS_SQL ? rows : []));
    const fetchImpl = vi.fn(async (url) => ({ status: url.includes('device0') ? 201 : 410 }));
    expect(await push.sendPushToUser(env, '00000000-0000-4000-8000-0000000000a1', { title: 'x' }, { fetchImpl })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('subscription validation', () => {
  const p256dh = b64uEncode(new Uint8Array([4, ...new Uint8Array(64).fill(7)]));
  const auth = b64uEncode(new Uint8Array(16).fill(1));
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abcdefghijk', keys: { p256dh, auth } };

  it('accepts real push services and normalises the keys', () => {
    expect(push.parseSubscription(good)).toEqual({ ok: true, sub: { endpoint: good.endpoint, p256dh, auth } });
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
      'https://web.push.apple.com/QGuQyavXutnMA',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
    ]) {
      expect(push.parseSubscription({ ...good, endpoint }).ok, endpoint).toBe(true);
    }
  });

  it('refuses http, unknown hosts, credentials, odd ports and malformed keys', () => {
    const bad = [
      null,
      'x',
      [],
      { ...good, endpoint: 'http://fcm.googleapis.com/fcm/send/abcdefghijk' },
      { ...good, endpoint: 'https://evil.example.com/fcm.googleapis.com/x' },
      { ...good, endpoint: 'https://fcm.googleapis.com.evil.com/send/abcdefgh' },
      { ...good, endpoint: 'https://user:pw@fcm.googleapis.com/fcm/send/abcdefghijk' },
      { ...good, endpoint: 'https://fcm.googleapis.com:8443/fcm/send/abcdefghijk' },
      { ...good, endpoint: `https://fcm.googleapis.com/${'a'.repeat(1100)}` },
      { ...good, keys: null },
      { ...good, keys: { p256dh, auth: 'short' } },
      { ...good, keys: { p256dh: p256dh.slice(0, 80), auth } },
      { ...good, keys: { p256dh: `${p256dh.slice(0, 85)}!!`, auth } },
      { ...good, keys: { p256dh: b64uEncode(new Uint8Array(65).fill(3)), auth } }, // not an uncompressed point
    ];
    for (const raw of bad) expect(push.parseSubscription(raw).ok, JSON.stringify(raw)?.slice(0, 80)).toBe(false);
  });

  it('builds the invite notification', () => {
    expect(push.inviteNotification({ fromName: 'Teja', gameName: 'Nawabi Raj', code: 'ABCD23' })).toEqual({
      title: 'Teja invited you to play',
      body: 'Nawabi Raj · room ABCD23. Tap to join.',
      url: '/join/ABCD23',
      tag: 'invite-ABCD23',
    });
  });
});

// ---- routes -----------------------------------------------------------------------------------------

const ME = '00000000-0000-4000-8000-0000000000a1';
const userRow = { id: ME, name: 'Me', avatar: 3, friend_code: 'HYD-ME22', is_guest: false, xp: 0, coins: 0, level: 1, games: 0, wins: 0 };

async function call(env, path, { method = 'GET', body, signedIn = true } = {}) {
  const headers = new Headers();
  if (signedIn) headers.set('cookie', `hyd_session=${await signSession(env, { id: ME, isGuest: false })}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    {},
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

function installDb(onQuery = () => undefined) {
  queryMock.mockImplementation(async (e, text, params = []) => {
    const custom = onQuery(text, params);
    if (custom !== undefined) return custom;
    if (/FROM users WHERE id = \$1/.test(text)) return [userRow];
    return [];
  });
}

describe('/api/push routes', () => {
  const base = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
  const p256dh = b64uEncode(new Uint8Array([4, ...new Uint8Array(64).fill(9)]));
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/routetest123', keys: { p256dh, auth: b64uEncode(new Uint8Array(16).fill(2)) } };

  it('GET /key answers null when push is not configured, the key when it is', async () => {
    installDb();
    expect((await call(base, '/api/push/key', { signedIn: false })).json).toEqual({ key: null });
    const { env } = await vapidEnv();
    expect((await call({ ...base, ...env }, '/api/push/key', { signedIn: false })).json).toEqual({ key: env.VAPID_PUBLIC_KEY });
  });

  it('subscribe is a stored no-op without VAPID, needs a session, and validates the subscription', async () => {
    const writes = [];
    installDb((text, params) => (/push_subscriptions/.test(text) ? (writes.push({ text, params }), []) : undefined));
    expect((await call(base, '/api/push/subscribe', { method: 'POST', body: { subscription }, signedIn: false })).status).toBe(401);
    expect((await call(base, '/api/push/subscribe', { method: 'POST', body: { subscription } })).json).toEqual({ ok: true, stored: false });
    expect(writes).toEqual([]);

    const { env } = await vapidEnv();
    const full = { ...base, ...env };
    const bad = await call(full, '/api/push/subscribe', { method: 'POST', body: { subscription: { ...subscription, endpoint: 'https://evil.example/x/y/z/w' } } });
    expect(bad.status).toBe(400);
    expect(writes).toEqual([]);
    const ok = await call(full, '/api/push/subscribe', { method: 'POST', body: { subscription } });
    expect(ok.json).toEqual({ ok: true, stored: true });
    expect(writes[0]).toEqual({ text: push.UPSERT_SUBSCRIPTION_SQL, params: [subscription.endpoint, ME, p256dh, subscription.keys.auth] });
    expect(writes[1].text).toBe(push.TRIM_SUBSCRIPTIONS_SQL);
  });

  it('unsubscribe deletes only my own subscription', async () => {
    const writes = [];
    installDb((text, params) => (/push_subscriptions/.test(text) ? (writes.push({ text, params }), []) : undefined));
    expect((await call(base, '/api/push/unsubscribe', { method: 'POST', body: { endpoint: 42 } })).status).toBe(400);
    const res = await call(base, '/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
    expect(res.json).toEqual({ ok: true });
    expect(writes).toEqual([{ text: push.UNSUBSCRIBE_SQL, params: [subscription.endpoint, ME] }]);
  });
});
