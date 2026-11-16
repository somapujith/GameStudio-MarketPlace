// "Play again with the same group": who to bring back and what to say about it. Pure, no React, unit-tested.
// Nothing here knows a game: a room is { players: [{ id, name, left?, guest? }], ... } and friends are ids.
import { inviteText } from './codes.js';

/** The server's batch invite limit (POST /api/invites/batch). */
export const INVITE_CAP = 7;

const idOf = (p) => (p && p.id != null && p.id !== '' ? String(p.id) : '');
const nameOf = (p) => (p && typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'A player');

/** A set of id strings from whatever holds friends: a Set, an array of ids or people, or the friend store's `{ friends }`. */
export function friendIdSet(source) {
  const list = source instanceof Set ? [...source] : Array.isArray(source) ? source : Array.isArray(source && source.friends) ? source.friends : [];
  const out = new Set();
  for (const f of list) {
    const id = f && typeof f === 'object' ? idOf(f) : f != null && f !== '' ? String(f) : '';
    if (id) out.add(id);
  }
  return out;
}

/**
 * Split the previous table into who can be invited in one tap and who needs the link.
 *   players   the finished room's players (`left: true` = already gone, never counted)
 *   meId      my id (never counted)
 *   friends   my accepted friends (see friendIdSet); a guest has none
 *   cap       the batch limit
 * -> { friends: [{id,name}] (<= cap, table order), others: [{id,name}] (not friends, guests, or over the cap),
 *      expected: [{id,name}] (friends + others), left: n, total: n }
 */
export function planRematch({ players, meId, friends, cap = INVITE_CAP } = {}) {
  const mine = meId != null ? String(meId) : '';
  const mates = friendIdSet(friends);
  const seen = new Set();
  const out = { friends: [], others: [], expected: [], left: 0, total: 0 };
  for (const p of Array.isArray(players) ? players : []) {
    const id = idOf(p);
    if (!id || id === mine || seen.has(id)) continue;
    seen.add(id);
    if (p.left) {
      out.left += 1;
      continue;
    }
    const person = { id, name: nameOf(p) };
    out.expected.push(person);
    if (!p.guest && mates.has(id) && out.friends.length < Math.max(0, cap)) out.friends.push(person);
    else out.others.push(person);
  }
  out.total = out.expected.length;
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What the batch answered, for the toast: `results` = [{ userId, ok, delivered, error? }] (or null when the call itself failed).
 * -> { invited: n, failed: [{id,name,error}] }
 */
export function inviteOutcome(plan, results) {
  const byId = new Map((Array.isArray(results) ? results : []).map((r) => [String(r && r.userId), r]));
  let invited = 0;
  const failed = [];
  for (const f of plan.friends) {
    const r = byId.get(f.id);
    if (r && r.ok) invited += 1;
    else failed.push({ ...f, error: (r && r.error) || 'Not invited' });
  }
  return { invited, failed };
}

/**
 * The message the new lobby greets you with (`{ text, tone }`, the lobby's `location.state.toast`).
 *   outcome   inviteOutcome(...)
 *   copied    the invite link was put on the clipboard (only tried when nobody could be invited)
 *   code      the new room code
 */
export function composeToast({ plan, outcome, copied = false, code }) {
  const { invited, failed } = outcome;
  const others = plan.others.length;
  if (invited > 0) {
    const base = failed.length ? `Invited ${invited} of ${plan.friends.length} friends` : `Invited ${plural(invited, 'friend', 'friends')}`;
    if (others > 0) return { text: `${base}. Share the code with the others.`, tone: failed.length ? 'info' : 'good' };
    if (failed.length) return { text: `${base}. ${failed.map((f) => f.name).join(', ')} could not be invited.`, tone: 'info' };
    return { text: base, tone: 'good' };
  }
  if (plan.total === 0) return { text: 'New table ready. Invite someone from the panel.', tone: 'info' };
  if (plan.friends.length > 0) {
    // we tried and nothing went out: the table still exists, the link is the way in
    return copied
      ? { text: 'Invites did not go out, so the link is copied. Send it to the group.', tone: 'info' }
      : { text: `Invites did not go out. Share the code ${code} with the group.`, tone: 'bad' };
  }
  return copied
    ? { text: 'New table ready. Invite link copied: send it to the group.', tone: 'good' }
    : { text: `New table ready. Share the code ${code} with the group.`, tone: 'info' };
}

/** Should the link be put on the clipboard? Only when no friend was invited and somebody (anybody) is expected back. */
export const wantsLinkCopy = (plan, outcome) => outcome.invited === 0 && plan.total > 0;

/** The clipboard text for the new table. */
export const rematchLinkText = (code, gameLabel) => inviteText(code, gameLabel);

/** One line under the button: who gets what. '' when there is nobody to bring back. */
export function planSummary(plan) {
  const f = plan.friends.length;
  const o = plan.others.length;
  if (!f && !o) return '';
  const names = (list) => (list.length <= 2 ? list.map((p) => p.name).join(' and ') : `${list[0].name} and ${list.length - 1} others`);
  if (f && !o) return `We will invite ${names(plan.friends)}.`;
  if (f && o) return `We will invite ${names(plan.friends)}. ${names(plan.others)} ${o === 1 ? 'is not a friend yet: you can send them the code' : 'are not friends yet: you can send them the code'}.`;
  return `${names(plan.others)} ${o === 1 ? 'is not a friend yet' : 'are not friends yet'}: we will copy the invite link for you.`;
}

/** What the lobby carries to the new table: `location.state.rematchFrom`. */
export function rematchFrom(code, plan) {
  return { code: String(code || ''), ids: plan.expected.map((p) => p.id) };
}

/** Validate `location.state.rematchFrom` (it comes from history state: never trust its shape). -> { code, ids } | null */
export function readRematchFrom(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.ids)) return null;
  const ids = [...new Set(raw.ids.filter((x) => typeof x === 'string' && x).slice(0, 12))];
  return ids.length ? { code: typeof raw.code === 'string' ? raw.code : '', ids } : null;
}

/** How many of the people we are waiting for are in the new lobby: `{ total, here, waiting }`. */
export function rematchProgress(from, players, meId) {
  const mine = meId != null ? String(meId) : '';
  const ids = from ? from.ids.filter((id) => id !== mine) : [];
  const present = new Set((Array.isArray(players) ? players : []).map(idOf));
  const here = ids.filter((id) => present.has(id)).length;
  return { total: ids.length, here, waiting: ids.length - here };
}

/** The post-game list of people to add as friends: everybody but me and anyone who left, each once. */
export function otherHumans(players, meId) {
  const mine = meId != null ? String(meId) : '';
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(players) ? players : []) {
    const id = idOf(p);
    if (!id || id === mine || seen.has(id) || p.left || p.guest) continue;
    seen.add(id);
    out.push({ id, name: nameOf(p), avatar: p.avatar });
  }
  return out;
}
