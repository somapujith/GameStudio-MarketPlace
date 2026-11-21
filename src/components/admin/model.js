// Admin console view model: pure helpers (no React, no DOM) for formatting, audit details, previews and URL state.
import { COSMETICS, COSMETIC_KINDS, FREE_COSMETICS, cosmeticById } from '@shared/cosmetics.js';
import { getGame } from '@/games/registry.js';
import { USER_FILTERS, USER_SORTS } from '@/lib/adminApi.js';

// ---- numbers and time -------------------------------------------------------------------------------------------

export const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '–');

/** 1234 -> "1.2k", 2_500_000 -> "2.5M" (tile numbers). */
export function fmtCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`;
  return fmtNum(v);
}

const toDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a short date. Future times read "in 5 min". */
export function relTime(iso, now = Date.now()) {
  const d = toDate(iso);
  if (!d) return '–';
  const diff = now - d.getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const say = (v, u) => (future ? `in ${v} ${u}` : `${v} ${u} ago`);
  if (s < 45) return future ? 'in a moment' : 'just now';
  if (s < 3600) return say(Math.max(1, Math.round(s / 60)), 'min');
  if (s < 86400) return say(Math.round(s / 3600), 'h');
  if (s < 86400 * 30) return say(Math.round(s / 86400), 'd');
  return fmtDate(iso);
}

export function fmtDate(iso) {
  const d = toDate(iso);
  if (!d) return '–';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  const d = toDate(iso);
  if (!d) return '–';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 'YYYY-MM-DD' -> "21 Nov" (chart axis). */
export function fmtDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** ISO -> the value a `<input type="datetime-local">` wants (local time, minutes). */
export function toLocalInput(iso) {
  const d = toDate(iso);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value -> ISO string, or null when empty / invalid. */
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- names ------------------------------------------------------------------------------------------------------

export const gameName = (id) => getGame(id)?.name || id || 'Unknown game';
export const shortId = (id) => (id ? String(id).slice(0, 8) : '');
export const ROLE_LABEL = { user: 'User', moderator: 'Moderator', admin: 'Admin' };
export const KIND_LABEL = { frame: 'Frames', dice: 'Dice', trail: 'Trails', board: 'Boards', title: 'Titles', voice: 'Voice lines' };
export const itemName = (id) => cosmeticById(id)?.name || id || 'item';

// ---- items ------------------------------------------------------------------------------------------------------

/**
 * Grant-item options grouped by kind: `[{ kind, label, items: [{ id, name, rarity, price, disabled, note }] }]`.
 * Owned and free items are disabled (the server answers 409 for them).
 */
export function itemGroups(owned = []) {
  const have = new Set(owned);
  const free = new Set(FREE_COSMETICS);
  return COSMETIC_KINDS.map((kind) => ({
    kind,
    label: KIND_LABEL[kind] || kind,
    items: COSMETICS.filter((c) => c.kind === kind).map((c) => {
      const isFree = free.has(c.id);
      const isOwned = have.has(c.id);
      return { id: c.id, name: c.name, rarity: c.rarity, price: c.price, disabled: isFree || isOwned, note: isFree ? 'free' : isOwned ? 'owned' : '' };
    }),
  })).filter((g) => g.items.length);
}

/** Every grantable item (for the bulk form): not free. */
export const grantableItems = () => COSMETICS.filter((c) => c.price > 0);

// ---- audit ------------------------------------------------------------------------------------------------------

export const ACTION_LABEL = {
  coins: 'Coins',
  xp: 'XP',
  'item.grant': 'Item granted',
  'item.revoke': 'Item revoked',
  ban: 'Ban',
  unban: 'Unban',
  rename: 'Rename',
  'handle.reset': 'Handle reset',
  role: 'Role',
  notify: 'Message',
  'grant.bulk': 'Bulk grant',
  'announcement.create': 'Announcement +',
  'announcement.update': 'Announcement edit',
  'announcement.delete': 'Announcement −',
  'event.create': 'Event +',
  'event.update': 'Event edit',
  'event.delete': 'Event −',
  'season.create': 'Season +',
  'season.update': 'Season edit',
  'season.payout': 'Season payout',
  'achievement.grant': 'Achievement',
};

/** Colour family of an action chip. */
export function actionTone(action) {
  if (action === 'ban' || action === 'item.revoke' || action === 'announcement.delete' || action === 'event.delete') return 'bad';
  if (action === 'unban') return 'good';
  if (action === 'coins' || action === 'xp' || action === 'item.grant' || action === 'grant.bulk' || action === 'season.payout' || action === 'achievement.grant') return 'gold';
  if (action === 'event.create' || action === 'season.create') return 'info';
  if (action === 'role') return 'info';
  return 'plain';
}

const signed = (n) => (Number(n) > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const AUDIENCE_LABEL = { ids: 'selected users', members: 'all members', active7d: 'active in last 7 days' };

// ---- prizes, ranks and event effects (shared by the engagement screens and the audit log) -----------------------

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v)) return String(n ?? '');
  const t = Math.abs(v) % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[Math.abs(v) % 10] || 'th');
  return `${v}${suffix}`;
}

/** A rank range: "1st", "4th–10th". */
export const rankRange = (from, to) => (Number(from) === Number(to) ? ordinal(from) : `${ordinal(from)}–${ordinal(to)}`);

/** A cosmetic kind as a noun ("title", "frame", "voice line"). */
export const KIND_WORD = { frame: 'frame', dice: 'dice', trail: 'trail', board: 'board', title: 'title', voice: 'voice line' };

/** `{ coins?, itemId?, itemName? }` -> "6,000 coins + Season Champion title" ("no prize" when empty). */
export function prizeText({ coins, itemId, itemName: name } = {}) {
  const parts = [];
  if (Number(coins) > 0) parts.push(`${fmtNum(coins)} ${Number(coins) === 1 ? 'coin' : 'coins'}`);
  if (itemId) {
    const item = cosmeticById(itemId);
    parts.push(item ? `${name || item.name} ${KIND_WORD[item.kind] || item.kind}` : name || itemId);
  }
  return parts.length ? parts.join(' + ') : 'no prize';
}

/** Prize tiers -> one line each, by rank: ["1st: 6,000 coins + Season Champion title", "2nd–3rd: 3,000 coins"]. */
export function tierSummary(tiers) {
  return (Array.isArray(tiers) ? tiers : [])
    .filter((t) => t && Number.isFinite(Number(t.fromRank)) && Number.isFinite(Number(t.toRank)))
    .slice()
    .sort((a, b) => Number(a.fromRank) - Number(b.fromRank))
    .map((t) => `${rankRange(t.fromRank, t.toRank)}: ${prizeText(t)}`);
}

export const EVENT_KIND_LABEL = { coin_boost: 'Coin boost', limited_shop: 'Limited shop' };

/** "×2 coins" / "×1.5 coins" for a multiplier. */
export const multiplierText = (m) => `×${Number(m)} coins`;

/** What an event does: "×2 coins", "Limited shop: Diwali Diya, Festive Diya". */
export function eventEffectText(kind, config) {
  const c = config && typeof config === 'object' ? config : {};
  if (kind === 'coin_boost') return multiplierText(c.multiplier ?? 1);
  if (kind === 'limited_shop') {
    const ids = Array.isArray(c.itemIds) ? c.itemIds : [];
    return ids.length ? `Limited shop: ${ids.map((id) => itemName(id)).join(', ')}` : 'Limited shop: no items';
  }
  return String(kind || 'event');
}

const windowText = (s, e) => `${fmtDateTime(s)} → ${fmtDateTime(e)}`;
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const prizesText = (tiers) => {
  const lines = tierSummary(tiers);
  return lines.length ? lines.join('; ') : 'none';
};

/** Field-by-field "before → after" lines of an event.update / season.update entry. */
function changeParts(action, d) {
  const before = asObj(d.before);
  const after = asObj(d.after);
  const changed = Array.isArray(d.changed) ? d.changed : [];
  const isEvent = action === 'event.update';
  const fmt = {
    name: ['Name', (v) => String(v ?? '–')],
    description: ['Description', (v) => (v ? String(v) : '–')],
    kind: ['Kind', (v) => EVENT_KIND_LABEL[v] || String(v ?? '–')],
    startsAt: ['Starts', fmtDateTime],
    endsAt: ['Ends', fmtDateTime],
    active: ['Active', (v) => (v ? 'on' : 'off')],
    config: ['Effect', null],
    prizeTiers: ['Prizes', prizesText],
  };
  const parts = [];
  for (const k of changed) {
    const [label, f] = fmt[k] || [k, (v) => (v == null ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v))];
    if (k === 'config' && isEvent) {
      parts.push({ k: label, v: `${eventEffectText(before.kind, before.config)} → ${eventEffectText(after.kind, after.config)}` });
      continue;
    }
    const b = f(before[k]);
    const a = f(after[k]);
    parts.push({ k: label, v: b === a ? a : `${b} → ${a}` });
  }
  if (!changed.length) parts.push({ k: 'Changed', v: 'nothing' });
  return parts;
}

/** The engagement actions (events, seasons): readable parts, or null for any other action. */
function engagementParts(entry, d) {
  const a = entry && entry.action;
  if (a === 'event.create' || a === 'event.delete') {
    const parts = [{ k: 'Event', v: String(d.name ?? '–') }, { k: 'Effect', v: eventEffectText(d.kind, d.config) }];
    if (d.startsAt || d.endsAt) parts.push({ k: 'Window', v: windowText(d.startsAt, d.endsAt) });
    if (d.active === false) parts.push({ k: 'State', v: 'off' });
    return parts;
  }
  if (a === 'event.update' || a === 'season.update') {
    const name = asObj(d.after).name ?? asObj(d.before).name;
    return [{ k: a === 'event.update' ? 'Event' : 'Season', v: String(name ?? '–') }, ...changeParts(a, d)];
  }
  if (a === 'season.create') {
    const parts = [{ k: 'Season', v: String(d.name ?? '–') }];
    if (d.startsAt || d.endsAt) parts.push({ k: 'Window', v: windowText(d.startsAt, d.endsAt) });
    parts.push({ k: 'Prizes', v: prizesText(d.prizeTiers) });
    return parts;
  }
  if (a === 'season.payout') {
    const parts = [{ k: 'Season', v: String(d.name ?? '–') }, { k: 'Winners paid', v: fmtNum(d.paid ?? 0) }];
    if (d.ranked !== undefined) parts.push({ k: 'Ranked', v: fmtNum(d.ranked) });
    if (Array.isArray(d.prizeTiers)) parts.push({ k: 'Prizes', v: prizesText(d.prizeTiers) });
    return parts;
  }
  return null;
}

/**
 * `details` -> readable parts: `[{ k, v }]`. Known keys get labels and formats (amount signed, before → after),
 * anything else is shown as `key: value` so nothing is hidden.
 */
export function detailParts(entry) {
  const d = entry && entry.details && typeof entry.details === 'object' ? entry.details : {};
  const engagement = engagementParts(entry, d);
  if (engagement) return d.reason ? [...engagement, { k: 'Reason', v: String(d.reason), reason: true }] : engagement;
  const parts = [];
  const used = new Set(['reason']);
  const take = (k) => {
    used.add(k);
    return d[k];
  };
  if (d.achievementId !== undefined) {
    const id = take('achievementId');
    parts.push({ k: 'Achievement', v: String(take('achievementName') || id) });
  }
  if (d.amount !== undefined) parts.push({ k: entry.action === 'xp' ? 'XP' : 'Amount', v: signed(take('amount')) });
  if (d.before !== undefined || d.after !== undefined) {
    const fmt = (v) => (typeof v === 'number' ? fmtNum(v) : v == null || v === '' ? '–' : String(v));
    parts.push({ k: 'Change', v: `${fmt(take('before'))} → ${fmt(take('after'))}` });
  }
  if (d.itemId !== undefined) {
    const id = take('itemId');
    parts.push({ k: 'Item', v: take('itemName') || itemName(id) });
  }
  if (d.coins !== undefined) parts.push({ k: 'Coins', v: fmtNum(take('coins')) });
  if (d.audience !== undefined) parts.push({ k: 'Audience', v: AUDIENCE_LABEL[take('audience')] || String(d.audience) });
  if (d.count !== undefined) parts.push({ k: 'Users', v: fmtNum(take('count')) });
  if (d.title !== undefined) parts.push({ k: 'Title', v: String(take('title')) });
  if (d.message !== undefined) parts.push({ k: 'Message', v: String(take('message')) });
  for (const [k, v] of Object.entries(d)) {
    if (used.has(k) || v === null || v === undefined || v === '') continue;
    parts.push({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v) });
  }
  if (d.reason) parts.push({ k: 'Reason', v: String(d.reason), reason: true });
  return parts;
}

// ---- grants -----------------------------------------------------------------------------------------------------

const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Give 200 coins and the Aurora frame to all members". */
export function grantPreview({ audience, count = 0, coins, itemId }) {
  const gifts = [];
  const c = Number(coins);
  if (c > 0) gifts.push(`${fmtNum(c)} ${c === 1 ? 'coin' : 'coins'}`);
  const item = itemId ? cosmeticById(itemId) : null;
  if (item) gifts.push(`the ${item.name} ${item.kind === 'voice' ? 'voice line' : item.kind}`);
  if (!gifts.length) return 'Pick coins, an item or both.';
  const who =
    audience === 'members'
      ? 'all members'
      : audience === 'active7d'
        ? 'every member active in the last 7 days'
        : count === 1
          ? '1 selected user'
          : `${fmtNum(count)} selected users`;
  return `Give ${andList(gifts)} to ${who}`;
}

// ---- announcements ----------------------------------------------------------------------------------------------

/** 'live' | 'scheduled' | 'ended' | 'off' */
export function announcementStatus(a, now = Date.now()) {
  if (!a || !a.active) return 'off';
  const s = toDate(a.startsAt);
  const e = toDate(a.endsAt);
  if (s && s.getTime() > now) return 'scheduled';
  if (e && e.getTime() <= now) return 'ended';
  return 'live';
}

// ---- users list URL state ---------------------------------------------------------------------------------------

/** URLSearchParams -> { q, filter, sort, page } with unknown values dropped to defaults. */
export function readUserQuery(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null) || '';
  const filter = USER_FILTERS.includes(get('filter')) ? get('filter') : 'all';
  const sort = USER_SORTS.includes(get('sort')) ? get('sort') : 'newest';
  const page = Math.max(1, Number.parseInt(get('page'), 10) || 1);
  return { q: get('q'), filter, sort, page };
}

/** { q, filter, sort, page } -> a plain object for setSearchParams (defaults left out so URLs stay short). */
export function writeUserQuery({ q, filter, sort, page }) {
  const out = {};
  if (q && String(q).trim()) out.q = String(q).trim();
  if (filter && filter !== 'all') out.filter = filter;
  if (sort && sort !== 'newest') out.sort = sort;
  if (page > 1) out.page = String(page);
  return out;
}

export const pageCount = (total, pageSize) => Math.max(1, Math.ceil((Number(total) || 0) / (Number(pageSize) || 1)));
