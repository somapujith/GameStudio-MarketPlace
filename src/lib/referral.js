// Referral capture (docs/ENGAGEMENT.md section 2). Pure rules plus a guarded localStorage wrapper; no React.
//
// A visitor arriving on `/?ref=HYD-XXXX` (any page) or a friend link `/f/HYD-XXXX` remembers the FIRST code it saw for
// 30 days under `jg-ref` as `{ code, at }`. The Google sign-in sends it as `ref`; the server only uses it when that call
// creates the account. A signed-in player never stores their own code.
import { isFriendCode, parseFriendLink } from '@/components/online/codes.js';

export const REF_KEY = 'jg-ref';
export const REF_TTL_MS = 30 * 24 * 3600_000;

/** A clean `HYD-XXXX` code from a raw `?ref=` value or friend-link segment, or ''. */
export function cleanRefCode(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 40) return '';
  const code = parseFriendLink(raw.trim());
  return isFriendCode(code) ? code : '';
}

/** The referral code a location carries: `?ref=` wins, else a `/f/:code` friend link. '' when none. */
export function refFromLocation({ pathname = '', search = '' } = {}) {
  let fromQuery = '';
  try {
    fromQuery = new URLSearchParams(search).get('ref') || '';
  } catch {
    fromQuery = '';
  }
  const q = cleanRefCode(fromQuery);
  if (q) return q;
  const m = /^\/f\/([^/?#]+)/i.exec(String(pathname));
  if (!m) return '';
  let seg = m[1];
  try {
    seg = decodeURIComponent(seg);
  } catch {
    /* keep it raw */
  }
  return cleanRefCode(seg);
}

/** Does `search` carry a `ref` parameter (valid or not)? */
export function hasRefParam(search = '') {
  try {
    return new URLSearchParams(search).has('ref');
  } catch {
    return false;
  }
}

/** `search` without its `ref` parameter ('' or '?a=b'). */
export function stripRefParam(search = '') {
  let p;
  try {
    p = new URLSearchParams(search);
  } catch {
    return '';
  }
  p.delete('ref');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** A stored `{ code, at }` that is still good at `now`, else null (junk, expired or from the future by over a day). */
export function liveRef(stored, now = Date.now()) {
  if (!stored || typeof stored !== 'object') return null;
  const code = cleanRefCode(stored.code);
  const at = Number(stored.at);
  if (!code || !Number.isFinite(at)) return null;
  if (now - at >= REF_TTL_MS || at - now > 86_400_000) return null;
  return { code, at };
}

/**
 * Should `code` be stored? Not when it is empty, when it is the viewer's own code (`ownCode`, signed in), or when an
 * unexpired ref is already kept (the FIRST one wins).
 */
export function shouldStoreRef(existing, code, { now = Date.now(), ownCode = '' } = {}) {
  const c = cleanRefCode(code);
  if (!c) return false;
  if (ownCode && cleanRefCode(ownCode) === c) return false;
  return !liveRef(existing, now);
}

const store = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The stored ref, parsed (no expiry check). Never throws. */
function readRaw(storage) {
  try {
    const s = storage === undefined ? store() : storage;
    const raw = s?.getItem(REF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The kept, unexpired referral code, or ''. Never throws. */
export function readRef({ now = Date.now(), storage } = {}) {
  return liveRef(readRaw(storage), now)?.code || '';
}

/** Store `code` if `shouldStoreRef` agrees. Returns true when it was written. Never throws. */
export function captureRef(code, { now = Date.now(), ownCode = '', storage } = {}) {
  const s = storage === undefined ? store() : storage;
  if (!s || !shouldStoreRef(readRaw(s), code, { now, ownCode })) return false;
  try {
    s.setItem(REF_KEY, JSON.stringify({ code: cleanRefCode(code), at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Forget the kept ref (after a successful sign-in). Never throws. */
export function clearRef({ storage } = {}) {
  try {
    (storage === undefined ? store() : storage)?.removeItem(REF_KEY);
  } catch {
    /* blocked storage */
  }
}

/** The Google sign-in body: `{ credential }` plus `ref` when one is kept. */
export function googleSignInBody(credential, ref = '') {
  const c = cleanRefCode(ref);
  return c ? { credential, ref: c } : { credential };
}
