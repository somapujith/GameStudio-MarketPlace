// Tiffin Centre: the storage layer under progress.js and autosave.js. Everything here is "never throws": a storage object that is
// missing, blocked (private mode), full (quota) or just wrong gives a result code, never an exception. Versioned, checksummed
// envelopes turn "whatever is in the key" into either good data or a reason it was refused.
//
//   envelope = { v: 1, kind: 'shift', sum: '1a2b3c4d', data: {...} }      sum = FNV-1a of JSON.stringify(data)

const memory = new Map();
/** A per-page store used when localStorage does not work (private mode, blocked storage, node tests). */
export const memoryStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => void memory.set(k, String(v)),
  removeItem: (k) => void memory.delete(k),
};

/** localStorage when it works, else the memory store. */
export function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* blocked */
  }
  return memoryStorage;
}

/** sessionStorage when it works, else the memory store. */
export function defaultSessionStorage() {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
  } catch {
    /* blocked */
  }
  return memoryStorage;
}

/** Read one key: `{ ok, value }`. ok=false means the storage itself failed (so "nothing there" is ok=true, value=null). */
export function readKey(storage, key) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return { ok: false, value: null };
    const v = storage.getItem(key);
    return { ok: true, value: typeof v === 'string' ? v : null };
  } catch {
    return { ok: false, value: null };
  }
}

/** The raw string or null. */
export const readRaw = (storage, key) => readKey(storage, key).value;

/** Write one key: `{ ok:true }` or `{ ok:false, reason: 'quota' | 'unavailable' | 'too-big' }`. */
export function writeRaw(storage, key, value, maxBytes = Infinity) {
  if (typeof value !== 'string') return { ok: false, reason: 'unavailable' };
  if (byteLength(value) > maxBytes) return { ok: false, reason: 'too-big' };
  try {
    if (!storage || typeof storage.setItem !== 'function') return { ok: false, reason: 'unavailable' };
    storage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    const name = e && typeof e === 'object' ? String(e.name || '') : '';
    const code = e && typeof e === 'object' ? e.code : 0;
    return { ok: false, reason: /quota/i.test(name) || code === 22 || code === 1014 ? 'quota' : 'unavailable' };
  }
}

export function removeRaw(storage, key) {
  try {
    if (storage && typeof storage.removeItem === 'function') storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function byteLength(str) {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  } catch {
    /* fall through */
  }
  return str.length * 2;
}

/** 32-bit FNV-1a of a string, as 8 hex digits. Detects truncation and hand edits; it is not a security feature. */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Wrap `data` in a versioned, checksummed envelope and return the JSON text, or null when it cannot be serialised. */
export function seal(kind, version, data, extra = {}) {
  try {
    const body = JSON.stringify(data);
    if (body === undefined) return null;
    return JSON.stringify({ v: version, kind, ...extra, sum: checksum(body), data });
  } catch {
    return null; // circular, BigInt ...
  }
}

/**
 * Read an envelope back. `migrations` maps an OLDER version number to a function(data) -> data of the next version.
 * Result: `{ ok:true, data, v, savedAt }` or `{ ok:false, reason }` with reason in
 * 'missing' | 'corrupt' | 'foreign' | 'checksum' | 'old-version' | 'new-version'.
 */
export function unseal(raw, kind, version, migrations = {}) {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'missing' };
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isObj(env) || typeof env.sum !== 'string' || !('data' in env)) return { ok: false, reason: 'foreign' };
  if (env.kind !== kind) return { ok: false, reason: 'foreign' };
  if (!Number.isInteger(env.v) || env.v < 1) return { ok: false, reason: 'foreign' };
  let body;
  try {
    body = JSON.stringify(env.data);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (body === undefined || checksum(body) !== env.sum) return { ok: false, reason: 'checksum' };
  if (env.v > version) return { ok: false, reason: 'new-version' };
  let data = env.data;
  let v = env.v;
  while (v < version) {
    const step = migrations[v];
    if (typeof step !== 'function') return { ok: false, reason: 'old-version' };
    try {
      data = step(data);
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
    v += 1;
  }
  return { ok: true, data, v: env.v, savedAt: Number.isFinite(env.savedAt) ? env.savedAt : null };
}
