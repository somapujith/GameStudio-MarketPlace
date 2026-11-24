// Tiffin Centre speech: the PURE decisions (no speechSynthesis, no DOM, no clock), unit-tested in node.
//
//   normalizeLang(l)               'te' | 'hi' | 'dk' | null
//   chooseVoice(voices, lang)      the best installed voice for the language, or null (never a voice of another language)
//   hashString(s, salt?)           stable 32-bit hash (FNV-1a + avalanche)
//   basePersona(id)                { pitch 0.8..1.25, rate 0.9..1.1 } of a customer, the same every time
//   speechParams(customer, mood)   { pitch, rate, volume, intensity } for one line (base persona + kind + mood)
//   estimateMs(text, rate)         how long a line takes to say (drives the mouth animation and the watchdogs)
//
// Languages: Telugu -> a te voice (te-IN preferred), Hindi -> hi-IN, Hyderabadi Dakhni ('dk') is spoken with the Hindi voice.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clamp01 = (v) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0, 0, 1);

export const LANGS = Object.freeze(['te', 'hi', 'dk']);

/** The BCP-47 primary language each game language is spoken with. */
export const VOICE_FAMILY = Object.freeze({ te: 'te', hi: 'hi', dk: 'hi' });

/** Some Android engines report ISO 639-2 codes ('hin-IND'): fold them onto the 2-letter family. */
const FAMILY_ALIASES = { hin: 'hi', tel: 'te' };

export function normalizeLang(l) {
  const s = typeof l === 'string' ? l.trim().toLowerCase() : '';
  return LANGS.includes(s) ? s : null;
}

/** 'te_IN' / 'te-IN' / 'TEL-IND' -> { family: 'te', region: 'in' } (region may be ''). */
export function parseVoiceLang(tag) {
  const parts = String(tag || '').trim().toLowerCase().replace(/_/g, '-').split('-');
  const first = parts[0] || '';
  return { family: FAMILY_ALIASES[first] || first, region: parts[1] === 'ind' ? 'in' : parts[1] || '' };
}

/**
 * Picks the voice for `lang` from `voices` (what speechSynthesis.getVoices() returned).
 * Only voices of the right language qualify. Ranking: local (offline) voice > network voice, then region IN, then the platform default;
 * ties keep the engine's own order. Returns null when no voice speaks the language (the UI then keeps showing subtitles).
 */
export function chooseVoice(voices, lang) {
  const key = normalizeLang(lang);
  if (!key || !Array.isArray(voices)) return null;
  const family = VOICE_FAMILY[key];
  let best = null;
  let bestScore = -1;
  for (const v of voices) {
    if (!v || typeof v.lang !== 'string') continue;
    const p = parseVoiceLang(v.lang);
    if (p.family !== family) continue;
    const score = (v.localService !== false ? 4 : 0) + (p.region === 'in' ? 2 : 0) + (v.default ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ personas

/** FNV-1a over the string, salted, then a murmur-style finaliser so close ids (c1, c2) land far apart. */
export function hashString(str, salt = 0) {
  let h = (0x811c9dc5 ^ (salt >>> 0)) >>> 0;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export const PITCH_RANGE = Object.freeze([0.8, 1.25]);
export const RATE_RANGE = Object.freeze([0.9, 1.1]);

/** Every customer id has its own voice: pitch 0.8..1.25 and rate 0.9..1.1, deterministic. */
export function basePersona(id) {
  const u1 = hashString(id, 0x1) / 0x100000000;
  const u2 = hashString(id, 0x2) / 0x100000000;
  return {
    pitch: PITCH_RANGE[0] + u1 * (PITCH_RANGE[1] - PITCH_RANGE[0]),
    rate: RATE_RANGE[0] + u2 * (RATE_RANGE[1] - RATE_RANGE[0]),
  };
}

/** Multipliers on pitch / rate and the line's own loudness (0..1, before the hub volume). */
export const MOOD_VOICE = Object.freeze({
  angry: { pitch: 1.12, rate: 1.15, volume: 1, intensity: 1 },
  furious: { pitch: 1.15, rate: 1.2, volume: 1, intensity: 1 },
  impatient: { pitch: 1.05, rate: 1.08, volume: 0.92, intensity: 0.7 },
  surprised: { pitch: 1.1, rate: 1.04, volume: 0.9, intensity: 0.7 },
  delighted: { pitch: 1.1, rate: 1.05, volume: 0.95, intensity: 0.8 },
  laughing: { pitch: 1.1, rate: 1.06, volume: 0.95, intensity: 0.9 },
  happy: { pitch: 1.04, rate: 1.02, volume: 0.9, intensity: 0.6 },
  sad: { pitch: 0.93, rate: 0.88, volume: 0.7, intensity: 0.4 },
  sheepish: { pitch: 0.95, rate: 0.9, volume: 0.65, intensity: 0.4 },
  bored: { pitch: 0.97, rate: 0.94, volume: 0.8, intensity: 0.4 },
  neutral: { pitch: 1, rate: 1, volume: 0.85, intensity: 0.5 },
});

/** Customer kinds that sound young / old (the engine kinds are office, student, family, uncle, autowala, techie). */
const KID_KINDS = new Set(['kid', 'kids', 'child', 'boy', 'girl']);
const ELDER_KINDS = new Set(['uncle', 'elder', 'old', 'grandpa', 'grandma', 'aunty']);

function customerId(c) {
  if (c && typeof c === 'object') return c.id ?? '';
  return c ?? '';
}
function customerKind(c) {
  return c && typeof c === 'object' && typeof c.kind === 'string' ? c.kind.toLowerCase() : '';
}

/**
 * The delivery of one line. `customer` is an id or { id, kind }; `mood` one of the face expressions (unknown = neutral).
 * pitch/rate are clamped to what every browser accepts and what still sounds like a person.
 */
export function speechParams(customer, mood = 'neutral') {
  const base = basePersona(customerId(customer));
  const kind = customerKind(customer);
  const m = MOOD_VOICE[String(mood || 'neutral').toLowerCase()] || MOOD_VOICE.neutral;
  let pitch = base.pitch;
  let rate = base.rate;
  if (KID_KINDS.has(kind)) {
    pitch *= 1.2;
    rate *= 1.05;
  } else if (ELDER_KINDS.has(kind)) {
    pitch *= 0.92;
    rate *= 0.93;
  }
  pitch *= m.pitch;
  rate *= m.rate;
  return { pitch: clamp(pitch, 0.5, 1.8), rate: clamp(rate, 0.7, 1.35), volume: m.volume, intensity: m.intensity };
}

/** Priority of a line in the queue (an angry customer is heard before a polite one). */
export function moodPriority(mood) {
  const m = String(mood || '').toLowerCase();
  if (m === 'angry' || m === 'furious') return 3;
  if (m === 'impatient' || m === 'surprised') return 2;
  return 1;
}

/** Milliseconds a line takes at `rate` (about 13 characters a second at rate 1, plus a breath). */
export function estimateMs(text, rate = 1) {
  const n = String(text || '').trim().length;
  const r = clamp(Number(rate) || 1, 0.5, 2);
  return Math.round(clamp((n / 13) * 1000 + 300, 500, 12000) / r);
}
