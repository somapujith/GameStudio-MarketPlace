// Voice lines, the pure parts: catalogue whitelist, message parsing, who may press what, the cooldown, the concurrency rules.
// Nothing here touches the DOM or the network, so it is all unit-tested (voiceModel.test.js).
//
// The client NEVER plays a `src` that came over the wire. A broadcast `{t:'voice', from, id, ts, seq}` is looked up by `id`
// in the shared catalogue (shared/cosmetics.js); an unknown id is dropped, the audio URL is the catalogue's.
import * as catalogue from '@shared/cosmetics.js';

const lines = () => (typeof catalogue.voiceLines === 'function' ? catalogue.voiceLines() : catalogue.COSMETICS.filter((c) => c.kind === 'voice'));

/** Per-player cooldown, mirrors the server (`VOICE_COOLDOWN_MS` in shared/cosmetics.js, 3 s). */
export const VOICE_COOLDOWN_MS = Number(catalogue.VOICE_COOLDOWN_MS) > 0 ? Number(catalogue.VOICE_COOLDOWN_MS) : 3000;
/** Clips that may sound at once (different lines from different players). The same line never stacks: it restarts. */
export const MAX_CONCURRENT = 3;
/** Fallback clip length when the catalogue has none (ms). */
export const DEFAULT_CLIP_MS = 3000;

/** All voice lines of the catalogue, in order. */
export const voiceItems = () => lines();

/** The catalogue entry for `id`, or null for anything that is not a known voice line (the whitelist). */
export function voiceItem(id) {
  if (typeof id !== 'string' || !id) return null;
  return lines().find((c) => c.id === id) || null;
}

/** Only same-origin clips under /audio/voice/ are ever loaded, whatever the catalogue says. */
export function voiceUrl(item) {
  const src = item && typeof item.src === 'string' ? item.src : '';
  return /^\/audio\/voice\/[\w.-]+\.(mp3|ogg|m4a|wav)$/i.test(src) ? src : null;
}

const ICON_EMOJI = { tiger: '🐯', cat: '🐱', oldman: '👴' };
/** The emoji of a line: the catalogue's own, else a fallback for the known icons, else a speaker. */
export const voiceEmoji = (item) => (item && item.emoji) || ICON_EMOJI[voiceIconKey(item)] || '🔊';
/** Icon key of a line ('tiger', 'cat', ...), derived from its id when the catalogue entry has none yet. */
export function voiceIconKey(item) {
  if (!item) return null;
  if (typeof item.icon === 'string' && item.icon) return item.icon;
  return item.id === 'voice-sheru-bhai' ? 'tiger' : item.id === 'voice-ladle-meow' ? 'cat' : item.id === 'voice-old-man' ? 'oldman' : null;
}

/** Milliseconds a clip is "speaking" for (pod highlight, caption), clamped to something sane. */
export const clipMs = (item) => {
  const d = Number(item && item.durationMs);
  return Math.min(15000, Math.max(1500, Number.isFinite(d) && d > 0 ? d : DEFAULT_CLIP_MS));
};

/** "🐯 Name: Sheru Bhai" (the line printed in the bubble and the chat history). */
export const speakerLine = (name, item) => `${voiceEmoji(item)} ${name || 'Player'}: ${item ? item.name : ''}`.trim();

/**
 * A server `{t:'voice'}` message as a chat-history entry, or null when it must be ignored (not an object, no speaker,
 * unknown line). `uniq` makes the id stable per (from, seq | ts) so a replay of the same message is dropped by the caller.
 */
export function voiceEntryFromMessage(msg, rand = Math.random) {
  if (!msg || typeof msg !== 'object') return null;
  const from = msg.from;
  if (typeof from !== 'string' && typeof from !== 'number') return null;
  const item = voiceItem(msg.id);
  if (!item) return null;
  const seq = Number.isFinite(Number(msg.seq)) ? Number(msg.seq) : null;
  const ts = Number.isFinite(Number(msg.ts)) ? Number(msg.ts) : null;
  const uniq = seq != null ? `s${seq}` : ts != null ? `t${ts}` : `r${Math.floor(rand() * 1e9).toString(36)}`;
  const entry = { id: `v:${from}:${item.id}:${uniq}`, from, text: '', voice: item.id };
  if (ts != null) entry.ts = ts;
  return entry;
}

/** The voice lines in a `GET /api/shop` response that the player owns (ids, catalogue order, unknown ids ignored). */
export function ownedVoiceIds(items) {
  const owned = new Set((Array.isArray(items) ? items : []).filter((x) => x && x.owned === true && typeof x.id === 'string').map((x) => x.id));
  return lines().filter((c) => owned.has(c.id)).map((c) => c.id);
}

/**
 * May this press go out? `{ ok, reason }` with reason one of 'signed-out' | 'unknown' | 'not-owned' | 'offline' | 'cooldown'.
 * Ownership is only a convenience here: the server checks it again.
 */
export function pressGate({ signedIn, owned, id, connected, cooldownLeft = 0 }) {
  if (!signedIn) return { ok: false, reason: 'signed-out' };
  if (!voiceItem(id)) return { ok: false, reason: 'unknown' };
  const has = owned instanceof Set ? owned.has(id) : Array.isArray(owned) && owned.includes(id);
  if (!has) return { ok: false, reason: 'not-owned' };
  if (!connected) return { ok: false, reason: 'offline' };
  if (cooldownLeft > 0) return { ok: false, reason: 'cooldown' };
  return { ok: true, reason: null };
}

/** Milliseconds left of a cooldown that ends at `until`. */
export const cooldownLeft = (until, now) => Math.max(0, Math.ceil((Number(until) || 0) - now));
/** Whole seconds to print for a cooldown ("3", "2", "1"). */
export const cooldownSeconds = (ms) => (ms > 0 ? Math.ceil(ms / 1000) : 0);

// ---- cooldown store (shared by the desktop and the phone picker, survives their unmounting) -------------------

export function createCooldown({ ms = VOICE_COOLDOWN_MS, now = () => Date.now() } = {}) {
  let startedAt = 0;
  let until = 0;
  const subs = new Set();
  const notify = () => subs.forEach((f) => { try { f(); } catch { /* a bad subscriber must not break the others */ } });
  return {
    start(at = now()) {
      startedAt = at;
      until = at + ms;
      notify();
    },
    left: (at = now()) => cooldownLeft(until, at),
    state: () => ({ startedAt, until, ms }),
    reset() {
      startedAt = 0;
      until = 0;
      notify();
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

// ---- concurrency ---------------------------------------------------------------------------------------------

/**
 * Decides what a new clip does given the clips that are playing (`active`: `[{ id }]`):
 *   'restart'  the same line is already sounding: restart it, never stack
 *   'play'     room for one more
 *   'drop'     `max` different lines already sound: the newcomer is dropped (its caption still shows)
 */
export function admitClip(active, id, max = MAX_CONCURRENT) {
  const list = Array.isArray(active) ? active : [];
  if (list.some((a) => a.id === id)) return 'restart';
  return list.length >= max ? 'drop' : 'play';
}

/**
 * Remembers recent broadcasts so a message is acted on once: my own echo (the clip played the moment I pressed), a replay
 * after a reconnect. `seen(key)` is true the second time. Keeps the last `cap` keys.
 */
export function createSeen(cap = 64) {
  const keys = new Set();
  return {
    seen(key) {
      if (keys.has(key)) return true;
      keys.add(key);
      if (keys.size > cap) keys.delete(keys.values().next().value);
      return false;
    },
    clear: () => keys.clear(),
  };
}

/**
 * The voice entries of `chat` newer than `lastId` that someone ELSE sent and that were not handled yet, oldest first.
 * My own entries are the server's echo of a press that already played locally. Pure: the host feeds it `createSeen()`.
 */
export function newRemoteVoices(chat, lastId, me, seen) {
  const list = Array.isArray(chat) ? chat : [];
  const from = lastId == null ? -1 : list.findIndex((m) => m.id === lastId);
  const out = [];
  for (const m of list.slice(from + 1)) {
    if (!m || !m.voice || !voiceItem(m.voice)) continue;
    if (seen && seen.seen(m.id)) continue;
    if (String(m.from) === String(me)) continue;
    out.push({ from: m.from, id: m.voice });
  }
  return out;
}

/** What the picker prints for each state of access. Pure so the text is tested. */
export function accessHint(state) {
  switch (state) {
    case 'signed-out': return 'Sign in to buy voice lines.';
    case 'offline': return 'Could not check your voice lines.';
    case 'loading': return 'Checking your voice lines…';
    case 'locked': return 'Get it in the shop: buy it once with coins, play it any time.';
    default: return '';
  }
}
