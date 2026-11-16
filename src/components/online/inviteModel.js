// Pure helpers for the invite landing (/join/:code) and the join flow: guest names, where sign-in returns to,
// the "why you cannot join" copy, and the little bit of session memory that keeps a visitor's place on reload.
import { paths } from '@/platform/paths.js';

export const GUEST_NAME_MAX = 24; // = NAME_MAX in worker/validate.js

// Same set the Worker strips (worker/validate.js INVISIBLE): controls, zero-width, bidi overrides, BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp('[\u0000-\u001f\u007f-\u009f­​-‏ -‮⁠-⁯﻿￹-￻]', 'g');

/**
 * Check a guest's display name the way the Worker does (`validateName`): invisible characters become spaces,
 * whitespace collapses, 1..24 characters. -> `{ ok: true, value }` or `{ ok: false, error }` (a sentence for the form).
 */
export function cleanGuestName(raw) {
  const cleaned = typeof raw === 'string' ? raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!cleaned) return { ok: false, error: 'Pick a name so the table knows who you are.' };
  if ([...cleaned].length > GUEST_NAME_MAX) return { ok: false, error: `Keep it to ${GUEST_NAME_MAX} characters or fewer.` };
  return { ok: true, value: cleaned };
}

const ADJECTIVES = ['Lucky', 'Sunny', 'Bold', 'Swift', 'Clever', 'Brave', 'Jolly', 'Royal', 'Mighty', 'Zesty', 'Cosmic', 'Happy'];
const NOUNS = ['Mango', 'Tiger', 'Falcon', 'Biryani', 'Chai', 'Panda', 'Rocket', 'Dosa', 'Cheetah', 'Otter', 'Comet', 'Maverick'];

/** Small stable hash so the same code always suggests the same name (no flicker on reload, stable in tests). */
export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A friendly default guest name ("Lucky Mango"), steady for a given seed. */
export function suggestGuestName(seed = '') {
  const h = hashSeed(seed);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]}`;
}

/** The name to prefill: what the visitor typed before, else the last one they played with, else a suggestion. */
export function initialGuestName({ draft, lastUsed, seed } = {}) {
  for (const candidate of [draft, lastUsed]) {
    const c = cleanGuestName(candidate);
    if (c.ok && c.value.toLowerCase() !== 'guest') return c.value;
  }
  return suggestGuestName(seed);
}

/** Where "Sign in" sends the visitor, and where it must bring them back: the same invite link. */
export function inviteLoginTarget(code) {
  return paths.login(paths.join(code));
}

/** "<Host> invited you" (or a neutral line when the host is unknown). */
export function inviteHeadline(hostName) {
  const host = typeof hostName === 'string' ? hostName.trim() : '';
  return host ? `${host} invited you` : "You're invited";
}

/**
 * Copy for each reason a code cannot be used (the status the room lookup reports): what happened, and the next move.
 * `kind`: missing | full | playing (started) | finished (closed) | forbidden (blocked) | wrongGame.
 * `max` (seats) personalises the "full" text.
 */
export function joinProblemCopy(kind, max) {
  switch (kind) {
    case 'full':
      return {
        title: 'This table is full',
        body: max ? `All ${max} seats are taken. Ask the host to make room, or start your own table.` : 'Every seat is taken. Ask the host to make room, or start your own table.',
      };
    case 'playing':
      return { title: 'The game has already started', body: 'New players cannot join a match in progress. Were you playing? You can rejoin. Otherwise ask the host for the next table.' };
    case 'finished':
      return { title: 'This game has ended', body: 'The host closed this table. Ask the host for a new code, or start your own table.' };
    case 'forbidden':
      return { title: 'You cannot join this table', body: 'The host has not let you in. Ask them for an invite, or start your own table.' };
    case 'wrongGame':
      return { title: 'This game is not in your version', body: 'The table plays a game this version does not have yet. Reload to get the latest, then try the code again.' };
    case 'missing':
    default:
      return { title: 'We could not find that table', body: 'Check the code for typos, or ask the host for a new code. Tables close when everyone leaves.' };
  }
}

// ---- session memory: keep a visitor's place if the page reloads mid-flow (private mode / SSR safe) ----

const DRAFT_KEY = 'hub.join.draft.v1';
const NAME_KEY = 'hub.guestName.v1';

function store(kind) {
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const DRAFT_TTL = 30 * 60 * 1000; // a half-finished join older than this is forgotten

/** `{ code, name }` remembered for this tab (both may be ''). The code is only kept for half an hour. */
export function readJoinDraft(now = Date.now()) {
  try {
    const raw = store('session')?.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    const fresh = typeof d?.at === 'number' && now - d.at < DRAFT_TTL;
    return { code: fresh && typeof d?.code === 'string' ? d.code : '', name: typeof d?.name === 'string' ? d.name : '' };
  } catch {
    return { code: '', name: '' };
  }
}

export function writeJoinDraft(patch) {
  try {
    const next = { ...readJoinDraft(), ...patch, at: Date.now() };
    store('session')?.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the flow still works, it just will not survive a reload */
  }
}

export function clearJoinDraft() {
  try {
    store('session')?.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function readLastGuestName() {
  try {
    return store('local')?.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function rememberGuestName(name) {
  try {
    store('local')?.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
