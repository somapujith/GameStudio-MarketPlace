// Pure helpers for room codes, friend codes and share links (no React, unit-tested).
// Alphabet: no 0/O/1/I so codes survive being read out loud or typed from a screenshot.
import { paths } from '@/platform/paths.js';
import BRAND from '@/platform/brand.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const FRIEND_PREFIX = BRAND.friendCodePrefix || 'HYD';
export const FRIEND_CODE_BODY = 4;

const ALLOWED = new Set(CODE_ALPHABET);

const safeDecode = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/**
 * The code-bearing part of a pasted link: `?code=ABC234`, or the last path segment of `/join/ABC234`. A bare `/join`
 * or a link with no path (`https://x.dev`) carries no code, so it yields ''. Anything else comes back trimmed (typing).
 */
function stripUrl(raw) {
  let s = String(raw ?? '').trim();
  const isLink = /^https?:\/\//i.test(s);
  if (isLink || s.includes('/') || s.includes('?')) {
    const q = s.match(/[?&](?:code|room)=([^&#\s]*)/i);
    if (q) return safeDecode(q[1]);
    if (isLink) s = s.replace(/^https?:\/\/[^/?#]*/i, '');
    s = s.split(/[?#]/)[0].replace(/\/+$/, '');
    s = s.slice(s.lastIndexOf('/') + 1);
    if (/^join$/i.test(s)) s = '';
  }
  return s;
}

/** Normalise user input to at most 6 valid room-code characters (uppercase, junk removed). */
export function normalizeRoomCode(raw) {
  let out = '';
  for (const ch of stripUrl(raw).toUpperCase()) {
    if (ALLOWED.has(ch)) out += ch;
    if (out.length >= ROOM_CODE_LENGTH) break;
  }
  return out;
}

/**
 * The look-alike characters (O, I, 0, 1) found in what was typed or pasted, so the join screen can say why they
 * disappeared. Links and other text with a slash are not checked. -> unique, in the order typed.
 */
export function rejectedChars(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.includes('/')) return [];
  const out = [];
  for (const ch of s.toUpperCase()) if (/[A-Z0-9]/.test(ch) && !ALLOWED.has(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

export function isRoomCode(code) {
  return typeof code === 'string' && code.length === ROOM_CODE_LENGTH && [...code].every((c) => ALLOWED.has(c));
}

/** Is this just a code someone typed or copied bare ("abc 234", "ab-c2-34"), not a sentence or a link? */
export function isPlainCodeText(raw) {
  const s = String(raw ?? '').trim();
  if (!/^[A-Za-z0-9\s-]*$/.test(s)) return false;
  const tokens = s.split(/[\s-]+/).filter(Boolean);
  return tokens.length <= 3 && tokens.every((t) => t.length <= 6) && s.replace(/[\s-]/g, '').length <= 12;
}

/**
 * Find the room code in whatever was copied: a bare code in any case or spacing, a link (`/join/ABC234`,
 * `/join?code=ABC234`, the whole invite URL), or the invite message ("Room code: ABC234 ..."). Used for paste
 * (button, long-press, link opened). Returns up to 6 valid characters, or '' when there is no code to be found.
 * Look-alike characters (O I 0 1) never count, so "ABC-0O1" does not turn into a code by accident.
 */
export function extractRoomCode(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const link = s.match(/\/join\/([A-Za-z0-9%-]+)/i) || s.match(/[?&](?:code|room)=([A-Za-z0-9%-]+)/i);
  if (link) return normalizeRoomCode(safeDecode(link[1]));
  const labelled = s.match(/\bcode\b(?:\s+is)?\W{0,3}([A-Za-z0-9]{3}[ -]?[A-Za-z0-9]{3})(?![A-Za-z0-9])/i);
  if (labelled) {
    const c = normalizeRoomCode(labelled[1]);
    if (isRoomCode(c)) return c;
  }
  if (isPlainCodeText(s)) return normalizeRoomCode(s);
  // an upper-case token inside a longer message: "ABC234" or "ABC 234"
  const token = s.match(/(?:^|[^A-Za-z0-9])([A-HJ-NP-Z2-9]{3})[ -]?([A-HJ-NP-Z2-9]{3})(?![A-Za-z0-9])/);
  return token ? token[1] + token[2] : '';
}

/** The room code in a query string (`?code=ABC234`), or ''. `search` is `location.search` or a URLSearchParams. */
export function codeFromSearch(search) {
  try {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
    return normalizeRoomCode(params.get('code') || params.get('room') || '');
  } catch {
    return '';
  }
}

/**
 * Normalise a friend code while typing. Accepts "7k2q", "hyd7k2q", "HYD-7K2Q", "hyd 7k2q".
 * Returns '' for empty input, otherwise "HYD-" + up to 4 valid characters (so "HYD-7K" mid-typing).
 */
export function normalizeFriendCode(raw) {
  let s = String(raw ?? '').toUpperCase();
  s = s.replace(/[^A-Z0-9]/g, '');
  if (s.startsWith(FRIEND_PREFIX)) s = s.slice(FRIEND_PREFIX.length);
  let body = '';
  for (const ch of s) {
    if (ALLOWED.has(ch)) body += ch;
    if (body.length >= FRIEND_CODE_BODY) break;
  }
  if (!body) return '';
  return `${FRIEND_PREFIX}-${body}`;
}

export function isFriendCode(code) {
  return typeof code === 'string' && new RegExp(`^${FRIEND_PREFIX}-[${CODE_ALPHABET}]{${FRIEND_CODE_BODY}}$`).test(code);
}

/**
 * Pull a friend code out of anything a person might paste: a friend link (`https://x/f/HYD-7K2Q`, `/f/hyd7k2q?x=1`),
 * an old share link (`/friends?add=HYD-7K2Q`) or the bare code in any case or spacing.
 * Returns a complete `HYD-XXXX` code, or '' when there is none.
 */
export function parseFriendLink(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let candidate = s;
  if (/^https?:\/\//i.test(s) || s.includes('/') || s.includes('?')) {
    let url = null;
    try {
      url = new URL(s, 'https://gamehub.invalid');
    } catch {
      url = null;
    }
    if (!url) return '';
    const m = url.pathname.match(/\/f\/([^/]+)/i);
    if (m) {
      try {
        candidate = decodeURIComponent(m[1]);
      } catch {
        candidate = m[1];
      }
    } else if (url.searchParams.get('add')) {
      candidate = url.searchParams.get('add');
    } else {
      return '';
    }
  }
  // strict: after removing spaces/dashes the code is exactly "HYD" + 4 valid characters (or just the 4 characters),
  // so ordinary words and half-typed codes never turn into a "valid" code
  const cleaned = String(candidate).toUpperCase().replace(/[\s-]/g, '');
  const bodies = cleaned.startsWith(FRIEND_PREFIX) ? [cleaned.slice(FRIEND_PREFIX.length), cleaned] : [cleaned];
  for (const body of bodies) {
    if (body.length === FRIEND_CODE_BODY && [...body].every((c) => ALLOWED.has(c))) return `${FRIEND_PREFIX}-${body}`;
  }
  return '';
}

/** Only allow same-site relative redirects (`?next=`): no `//evil.com`, no `https:`, no backslashes. */
export function safeNext(next, fallback = '/') {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/^\/(login)(\/|\?|$)/.test(next)) return fallback;
  return next;
}

/** Room-code characters laid out for display: "ABC 234". */
export function spacedCode(code) {
  const c = String(code ?? '');
  return c.length === ROOM_CODE_LENGTH ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

const here = () => globalThis.location?.origin ?? '';

/** The shared room link, `<origin>/join/ABC234`: the join page checks the room, then opens the lobby. */
export function joinLink(code, origin = here()) {
  return `${origin}${paths.join(code)}`;
}

/** A room invite as two short lines (`text`) plus the link (`url`), so Web Share can use them separately. */
export function inviteMessage(code, gameName, origin) {
  const name = gameName || BRAND.name;
  return {
    title: name,
    text: `Come play ${name} with me on ${BRAND.name}! 🎲\nRoom code: ${code}`,
    url: joinLink(code, origin),
  };
}

/** WhatsApp / copy-paste invite text (message + link). */
export function inviteText(code, gameName, origin) {
  const m = inviteMessage(code, gameName, origin);
  return `${m.text}\n${m.url}`;
}

export function whatsappUrl(code, gameName, origin) {
  return `https://wa.me/?text=${encodeURIComponent(inviteText(code, gameName, origin))}`;
}

/** The friend link for a friend code: `<origin>/f/HYD-7K2Q`. */
export function friendLinkUrl(friendCode, origin = here()) {
  return `${origin}${paths.friendLink(friendCode)}`;
}

/** What sharing your friend link says. */
export function friendInviteMessage(friendCode, origin) {
  return {
    title: BRAND.name,
    text: `Add me on ${BRAND.name}! Friend code: ${friendCode}`,
    url: friendLinkUrl(friendCode, origin),
  };
}

export function friendShareText(friendCode, origin) {
  const m = friendInviteMessage(friendCode, origin);
  return `${m.text}\n${m.url}`;
}

/**
 * Why the current user cannot enter this room, as a kind: 'missing' | 'finished' | 'playing' | 'full', or null
 * when they can. `info` is GET /api/rooms/:code. Players already in the room may always come back
 * (reconnect to a running game, rejoin a full lobby).
 */
export function roomProblemKind(info, myId) {
  if (!info || info.exists === false) return 'missing';
  if (info.isMember === true) return null;
  const players = Array.isArray(info.players) ? info.players : null;
  if (players && myId != null && players.some((p) => p && p.id != null && String(p.id) === String(myId))) return null;
  if (info.status === 'finished') return 'finished';
  if (info.status === 'playing') return 'playing';
  const count = players ? players.length : Number(info.players);
  if (Number.isFinite(count) && Number.isFinite(info.maxPlayers) && info.maxPlayers > 0 && count >= info.maxPlayers) return 'full';
  return null;
}

const PROBLEM_TEXT = {
  missing: 'No room with that code. Check it and try again.',
  finished: 'That game has already ended.',
  playing: 'That game has already started.',
  full: 'That room is full.',
};

/** Can the current user enter this room? A human message when not, or null when fine (see `roomProblemKind`). */
export function roomProblem(info, myId) {
  const kind = roomProblemKind(info, myId);
  return kind ? PROBLEM_TEXT[kind] : null;
}

/** Player count from a room-info payload (`players` is a count over HTTP, a list elsewhere). */
export function playerCountOf(info) {
  if (!info) return 0;
  if (Array.isArray(info.players)) return info.players.length;
  const n = Number(info.players);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
