// Browser side of Web Push: the service worker (public/sw.js) and the push subscription.
//
//   registerServiceWorker()  once at startup; a safe no-op where unsupported (and in `vite` dev)
//   pushSupported()          can this browser do Web Push at all? (iOS: only as an installed app)
//   pushEnabled()            Promise<boolean>: permission granted and a subscription exists
//   enablePush()             asks permission, subscribes with the server key, stores it -> { ok, reason? }
//   disablePush()            unsubscribes here and on the server -> { ok, reason? }
//
// `reason` values: 'unsupported' | 'unconfigured' (server has no VAPID key) | 'denied' | 'dismissed' |
// 'offline' | 'failed'. Nothing here throws.
import { getPushKey, pushSubscribe, pushUnsubscribe } from './api.js';

const SW_URL = '/sw.js';
const READY_TIMEOUT_MS = 10_000;

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

const isDev = () => {
  try {
    return !!(import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
};

export function pushSupported() {
  return (
    hasWindow() &&
    window.isSecureContext !== false &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Register the service worker. Skipped in `vite` dev so a dev build never leaves a worker behind
 * on localhost (enablePush still registers on demand, so push can be tried in dev).
 */
export async function registerServiceWorker() {
  if (!hasWindow() || !('serviceWorker' in navigator) || isDev()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });
  } catch {
    return null;
  }
}

async function registration() {
  if (!(await navigator.serviceWorker.getRegistration('/'))) {
    await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });
  }
  return withTimeout(navigator.serviceWorker.ready, READY_TIMEOUT_MS); // subscribing needs an active worker
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** base64url -> Uint8Array (the VAPID public key the browser subscribes with). */
export function keyBytes(b64url) {
  const b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const sameKey = (buffer, bytes) => {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
};

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return !!(reg && (await reg.pushManager.getSubscription()));
  } catch {
    return false;
  }
}

export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let key;
  try {
    ({ key } = await getPushKey());
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (!key) return { ok: false, reason: 'unconfigured' };

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'default';
    }
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

  let sub;
  try {
    const reg = await registration();
    const bytes = keyBytes(key);
    sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, bytes)) {
      await sub.unsubscribe().catch(() => {}); // the server key changed: subscribe again
      sub = null;
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  try {
    await pushSubscribe(sub.toJSON());
  } catch (err) {
    return { ok: false, reason: err && err.status === 0 ? 'offline' : 'failed' };
  }
  return { ok: true };
}

export async function disablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return { ok: true };
    const { endpoint } = sub;
    await sub.unsubscribe().catch(() => {});
    try {
      await pushUnsubscribe(endpoint);
    } catch {
      /* the server forgets it when the push service answers 410 */
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
