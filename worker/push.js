// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291, RFC 8188),
// built on WebCrypto only. Everything is a harmless no-op unless all three secrets are set:
//   VAPID_PUBLIC_KEY   base64url, uncompressed P-256 point (65 bytes, starts with 0x04)
//   VAPID_PRIVATE_KEY  base64url, the raw 32-byte private scalar `d`
//   VAPID_SUBJECT      `mailto:you@example.com` or an https URL (push services contact it on abuse)
// Subscriptions live in `push_subscriptions`; the ones a push service answers 404 / 410 for are deleted.
import { query } from './db.js';

const enc = new TextEncoder();
const PUSH_TTL_SECONDS = 2 * 60 * 60; // an invite is fresh for 2 h, so is its notification
const RECORD_SIZE = 4096;
const JWT_SECONDS = 12 * 60 * 60;
const MAX_SUBSCRIPTIONS_PER_USER = 5;
const SEND_TIMEOUT_MS = 10_000;

// Push services of the browsers that support Web Push. Only these hosts are ever contacted, so a
// subscription cannot turn the Worker into a request relay for arbitrary URLs.
export const PUSH_HOST_SUFFIXES = Object.freeze([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
]);

// ---------------------------------------------------------------- base64url

export function b64uEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (or base64, padded or not) -> bytes; null when it is not valid. */
export function b64uDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_\-+/]*={0,2}$/.test(str)) return null;
  const b64 = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4 === 1) return null;
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// ---------------------------------------------------------------- configuration

/** Are all three VAPID secrets present? */
export function pushConfigured(env) {
  return !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** The public key the browser subscribes with (`applicationServerKey`), or null when push is off. */
export const pushPublicKey = (env) => (pushConfigured(env) ? String(env.VAPID_PUBLIC_KEY) : null);

// ---------------------------------------------------------------- subscription validation

/**
 * Validate an untrusted PushSubscription JSON (`{ endpoint, keys: { p256dh, auth } }`).
 * Returns `{ ok: true, sub: { endpoint, p256dh, auth } }` or `{ ok: false, error }`.
 */
export function parseSubscription(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Subscription must be an object.' };
  const endpoint = raw.endpoint;
  if (!validEndpoint(endpoint)) return { ok: false, error: 'Invalid push endpoint.' };
  const keys = raw.keys;
  if (!keys || typeof keys !== 'object') return { ok: false, error: 'Invalid push keys.' };
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || p256dh.length < 86 || p256dh.length > 90) return { ok: false, error: 'Invalid push keys.' };
  if (typeof auth !== 'string' || auth.length < 22 || auth.length > 24) return { ok: false, error: 'Invalid push keys.' };
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) return { ok: false, error: 'Invalid push keys.' };
  const pk = b64uDecode(p256dh);
  const as = b64uDecode(auth);
  if (!pk || pk.length !== 65 || pk[0] !== 4 || !as || as.length !== 16) return { ok: false, error: 'Invalid push keys.' };
  return { ok: true, sub: { endpoint, p256dh: b64uEncode(pk), auth: b64uEncode(as) } };
}

/** An https URL on a known push service, without credentials, of a sane length. */
export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 1024) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

// ---------------------------------------------------------------- RFC 8291 encryption

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** A P-256 key pair from a raw private scalar + its uncompressed public point (both bytes). */
async function importEcdhPrivate(d, publicRaw) {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: b64uEncode(d),
    x: b64uEncode(publicRaw.slice(1, 33)),
    y: b64uEncode(publicRaw.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

/**
 * Encrypt `plaintext` (bytes) for one subscription (`uaPublic` 65 bytes, `authSecret` 16 bytes).
 * Returns the aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid(65 = sender public key) | ciphertext.
 * `opts.salt` and `opts.senderKeys` ({ privateKey: CryptoKey, publicRaw: bytes }) are for tests (RFC 8291 vector).
 */
export async function encryptPayload(plaintext, uaPublic, authSecret, opts = {}) {
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  let sender = opts.senderKeys;
  if (!sender) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    sender = { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));

  // RFC 8291 3.3/3.4: IKM from the ECDH secret and the auth secret, then CEK and nonce (RFC 8188).
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, sender.publicRaw);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // One record: plaintext followed by the last-record delimiter 0x02 (no padding).
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('Push payload too large.');
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + sender.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicRaw.length;
  header.set(sender.publicRaw, 21);
  return concat(header, cipher);
}

export { importEcdhPrivate as _importEcdhPrivateForTests };

// ---------------------------------------------------------------- VAPID (RFC 8292)

const keyCache = new Map(); // private key string -> CryptoKey (one per isolate)
const jwtCache = new Map(); // audience -> { jwt, exp }

async function vapidSigningKey(env) {
  const cacheKey = `${env.VAPID_PUBLIC_KEY}|${env.VAPID_PRIVATE_KEY}`;
  let key = keyCache.get(cacheKey);
  if (key) return key;
  const pub = b64uDecode(String(env.VAPID_PUBLIC_KEY));
  const d = b64uDecode(String(env.VAPID_PRIVATE_KEY));
  if (!pub || pub.length !== 65 || pub[0] !== 4 || !d || d.length !== 32) throw new Error('VAPID keys are malformed.');
  const jwk = { kty: 'EC', crv: 'P-256', d: b64uEncode(d), x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)) };
  key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

/** An ES256 JWT for the push service origin `aud` (cached until 1 h before it expires). */
export async function vapidJwt(env, aud, now = Date.now()) {
  const hit = jwtCache.get(aud);
  if (hit && hit.key === env.VAPID_PRIVATE_KEY && hit.exp * 1000 - now > 60 * 60 * 1000) return hit.jwt;
  const exp = Math.floor(now / 1000) + JWT_SECONDS;
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp, sub: String(env.VAPID_SUBJECT) })));
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(env), enc.encode(input));
  const jwt = `${input}.${b64uEncode(new Uint8Array(sig))}`; // WebCrypto already yields the raw r||s JWS wants
  if (jwtCache.size > 20) jwtCache.clear();
  jwtCache.set(aud, { jwt, exp, key: env.VAPID_PRIVATE_KEY });
  return jwt;
}

// ---------------------------------------------------------------- sending

export const DELETE_SUBSCRIPTION_SQL = 'DELETE FROM push_subscriptions WHERE endpoint = $1';
export const USER_SUBSCRIPTIONS_SQL = `SELECT endpoint, p256dh, auth FROM push_subscriptions
  WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT ${MAX_SUBSCRIPTIONS_PER_USER}`;
export const UPSERT_SUBSCRIPTION_SQL = `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ($1, $2::uuid, $3, $4)
ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now()`;
// Keep the newest few subscriptions of a user (old browsers / devices fall off).
export const TRIM_SUBSCRIPTIONS_SQL = `DELETE FROM push_subscriptions
  WHERE user_id = $1::uuid
    AND endpoint NOT IN (SELECT endpoint FROM push_subscriptions WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT ${MAX_SUBSCRIPTIONS_PER_USER})`;
export const UNSUBSCRIBE_SQL = 'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2::uuid';

/**
 * Send one notification. `subscription` is a PushSubscription JSON (`{ endpoint, keys }`) or a
 * database row (`{ endpoint, p256dh, auth }`); `payload` any JSON-serialisable object.
 * Resolves to `{ ok, status?, gone?, skipped? }`, never throws. 404/410 deletes the subscription.
 */
export async function sendPush(env, subscription, payload, { fetchImpl = fetch } = {}) {
  if (!pushConfigured(env)) return { ok: false, skipped: true };
  try {
    const sub = subscription && subscription.keys ? { endpoint: subscription.endpoint, ...subscription.keys } : subscription;
    if (!sub || !validEndpoint(sub.endpoint)) return { ok: false, skipped: true };
    const uaPublic = b64uDecode(sub.p256dh);
    const authSecret = b64uDecode(sub.auth);
    if (!uaPublic || uaPublic.length !== 65 || !authSecret || authSecret.length !== 16) return { ok: false, skipped: true };

    const body = await encryptPayload(enc.encode(JSON.stringify(payload ?? {})), uaPublic, authSecret);
    const aud = new URL(sub.endpoint).origin;
    const jwt = await vapidJwt(env, aud);
    const init = {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'high',
      },
      body,
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
    const res = await fetchImpl(sub.endpoint, init);
    const gone = res.status === 404 || res.status === 410;
    if (gone) await query(env, DELETE_SUBSCRIPTION_SQL, [sub.endpoint]).catch(() => {});
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone };
  } catch (err) {
    console.error('push failed:', err && err.message);
    return { ok: false };
  }
}

/** Push to every subscription of a user. Resolves to the number accepted by the push services (0 when off). */
export async function sendPushToUser(env, userId, payload, opts) {
  if (!pushConfigured(env)) return 0;
  let rows;
  try {
    rows = await query(env, USER_SUBSCRIPTIONS_SQL, [userId]);
  } catch {
    return 0;
  }
  const results = await Promise.all(rows.map((row) => sendPush(env, row, payload, opts)));
  return results.filter((r) => r.ok).length;
}

/** Store (or move to this user) a validated subscription and trim the user's old ones. */
export async function saveSubscription(env, userId, sub) {
  await query(env, UPSERT_SUBSCRIPTION_SQL, [sub.endpoint, userId, sub.p256dh, sub.auth]);
  await query(env, TRIM_SUBSCRIPTIONS_SQL, [userId]).catch(() => {});
}

export async function deleteSubscription(env, userId, endpoint) {
  await query(env, UNSUBSCRIBE_SQL, [endpoint, userId]);
}

/** The notification an invite produces (the service worker reads title / body / url / tag). */
export function inviteNotification({ fromName, gameName, code }) {
  return {
    title: `${fromName || 'A friend'} invited you to play`,
    body: `${gameName || 'A game'} · room ${code}. Tap to join.`,
    url: `/join/${code}`,
    tag: `invite-${code}`,
  };
}

export function _resetPushCachesForTests() {
  keyCache.clear();
  jwtCache.clear();
}
