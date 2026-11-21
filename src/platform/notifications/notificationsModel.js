// Pure rules for player notifications (gifts and messages from the Jalebi Games team). No React, no network.
// Shapes: docs/ADMIN.md, "Shared shapes" (Notification) and "Player-facing API".
//
//   Notification = { id, kind: 'gift'|'message'|'system'|'achievement', title, body: string|null,
//                    data: { coins?, xp?, itemId?, itemName?, from?, achievementId?, season?: { id, name, rank },
//                            referral?: { name, role? } }, createdAt: ISO, read: boolean }
// `achievement` (docs/ENGAGEMENT.md) is an unlock with its reward; season prizes and referral rewards are gifts that
// carry `data.season` / `data.referral`. All of them pop in the gift popup.

/** The inbox keeps this many (the server sends the latest 30). */
export const INBOX_MAX = 30;
/** A window-focus refetch happens at most this often. */
export const FOCUS_REFETCH_MS = 30_000;
/** Wait this long on a hub page before the gift popup may open (the daily reward popup waits 3.5 s, so gifts go first). */
export const GIFT_POPUP_DELAY_MS = 1200;
/** Something else (a dialog, a sheet, the tour, the inbox) is open: look again after this long. */
export const GIFT_POPUP_RECHECK_MS = 1500;
/** After "Collect" the popup closes itself this long afterwards. */
export const GIFT_POPUP_AUTOCLOSE_MS = 1600;

const KINDS = new Set(['gift', 'message', 'system', 'achievement']);
/** Kinds the gift popup celebrates (unread ones). */
export const POP_KINDS = Object.freeze(['gift', 'achievement']);

const posInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A clean Notification, or null when it has no id. Unknown kinds count as 'system'; bad numbers as absent. */
export function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id == null ? '' : String(raw.id);
  if (!id) return null;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const data = {};
  if (posInt(d.coins)) data.coins = posInt(d.coins);
  if (posInt(d.xp)) data.xp = posInt(d.xp);
  if (str(d.itemId, 80)) data.itemId = str(d.itemId, 80);
  if (str(d.itemName, 80)) data.itemName = str(d.itemName, 80);
  if (str(d.from, 80)) data.from = str(d.from, 80);
  if (str(d.achievementId, 40)) data.achievementId = str(d.achievementId, 40);
  if (d.season && typeof d.season === 'object' && str(d.season.name, 60)) {
    data.season = { id: str(String(d.season.id ?? ''), 60), name: str(d.season.name, 60), rank: posInt(d.season.rank) || null };
  }
  if (d.referral && typeof d.referral === 'object' && str(d.referral.name, 60)) {
    data.referral = { name: str(d.referral.name, 60) };
    if (d.referral.role === 'invitee' || d.referral.role === 'referrer') data.referral.role = d.referral.role;
  }
  const t = Date.parse(raw.createdAt);
  return {
    id,
    kind: KINDS.has(raw.kind) ? raw.kind : 'system',
    title: str(raw.title, 120) || (raw.kind === 'gift' ? 'A gift for you' : raw.kind === 'achievement' ? 'Achievement unlocked' : 'Notification'),
    body: str(raw.body, 500) || null,
    data,
    createdAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    read: raw.read === true,
  };
}

const timeOf = (n) => {
  const t = Date.parse(n?.createdAt);
  return Number.isFinite(t) ? t : 0;
};

/** Newest first, one entry per id, at most `max`. Accepts anything (non-arrays and bad rows are dropped). */
export function normalizeList(list, max = INBOX_MAX) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const n = normalizeNotification(raw);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  out.sort((a, b) => timeOf(b) - timeOf(a));
  return out.slice(0, max);
}

/**
 * Insert (or replace) one live notification at its place. Returns `{ list, added }`, where `added` is true when it
 * was new and unread (so the unread count goes up by one). A replay of a known id never double counts.
 */
export function insertNotification(list, raw, max = INBOX_MAX) {
  const n = normalizeNotification(raw);
  const cur = Array.isArray(list) ? list : [];
  if (!n) return { list: cur, added: false };
  const known = cur.find((x) => x.id === n.id);
  const next = normalizeList([n, ...cur.filter((x) => x.id !== n.id)], max);
  return { list: next, added: !known && !n.read };
}

/** Mark `ids` (array) or everything (`'all'`) as read. Returns `{ list, changed }` (how many flipped). */
export function markRead(list, ids) {
  const cur = Array.isArray(list) ? list : [];
  const all = ids === 'all';
  const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
  let changed = 0;
  const next = cur.map((n) => {
    if (n.read || !(all || want.has(n.id))) return n;
    changed += 1;
    return { ...n, read: true };
  });
  return { list: changed ? next : cur, changed };
}

/** The unread count to show: the server's number when it gave one (it counts beyond the latest 30), else the list's. */
export function unreadOf(list, serverUnread) {
  const s = Math.floor(Number(serverUnread));
  if (Number.isFinite(s) && s >= 0 && serverUnread !== null && serverUnread !== '') return s;
  return (Array.isArray(list) ? list : []).filter((n) => !n.read).length;
}

/**
 * Which gifts the popup shows: unread `gift` and `achievement` notifications not already waved away this session
 * (`skip` = Set of ids), oldest first (so a stack reads in the order they were sent).
 */
export function giftsToPop(list, skip = new Set()) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && POP_KINDS.includes(n.kind) && !n.read && !skip.has(n.id))
    .sort((a, b) => timeOf(a) - timeOf(b));
}

/** Add the gifts that arrived while the popup was open to its stack (keeps the order, no duplicates). */
export function growStack(stack, gifts) {
  const cur = Array.isArray(stack) ? stack : [];
  const have = new Set(cur.map((g) => g.id));
  const more = (Array.isArray(gifts) ? gifts : []).filter((g) => !have.has(g.id));
  return more.length ? [...cur, ...more] : cur;
}

/** Totals over a stack of gifts: `{ coins, xp, items, count }`. */
export function giftTotals(gifts) {
  const out = { coins: 0, xp: 0, items: 0, count: 0 };
  for (const g of Array.isArray(gifts) ? gifts : []) {
    if (!g) continue;
    out.count += 1;
    out.coins += posInt(g.data?.coins);
    out.xp += posInt(g.data?.xp);
    if (g.data?.itemId || g.data?.itemName) out.items += 1;
  }
  return out;
}

const fmt = (n) => Number(n).toLocaleString('en-IN');

/** The rewards one gift carries, as short labels: ['+500 coins', '+100 XP', 'Nizam Gold']. */
export function giftRewards(gift, itemName = '') {
  const d = gift?.data || {};
  const out = [];
  if (posInt(d.coins)) out.push({ kind: 'coins', label: `+${fmt(d.coins)} coins` });
  if (posInt(d.xp)) out.push({ kind: 'xp', label: `+${fmt(d.xp)} XP` });
  const name = itemName || d.itemName || (d.itemId ? 'A new item' : '');
  if (name) out.push({ kind: 'item', label: name });
  return out;
}

/** The popup's title for `count` gifts; `gifts` (optional) makes an all-badges stack read "Badge unlocked". */
export function giftHeadline(count, gifts) {
  const list = Array.isArray(gifts) ? gifts : [];
  if (list.length && list.every((g) => g?.kind === 'achievement')) return count > 1 ? `${count} badges unlocked` : 'Badge unlocked';
  return count > 1 ? `${count} gifts for you` : 'A gift for you';
}

/**
 * The small tag above a gift that says what it is for, or null for a plain gift:
 *   achievement -> { kind: 'achievement', label: 'Badge unlocked' }
 *   season      -> { kind: 'season', label: 'Monsoon Season: rank 2' }
 *   referral    -> { kind: 'referral', label: 'Meera joined with your link' | 'Invited by Meera' | 'Referral: Meera' }
 */
export function giftContext(gift) {
  const d = gift?.data || {};
  if (gift?.kind === 'achievement') return { kind: 'achievement', label: 'Badge unlocked' };
  if (d.season && d.season.name) return { kind: 'season', label: d.season.rank ? `${d.season.name}: rank ${d.season.rank}` : d.season.name };
  if (d.referral && d.referral.name) {
    const who = d.referral.name;
    const label = d.referral.role === 'referrer' ? `${who} joined with your link` : d.referral.role === 'invitee' ? `Invited by ${who}` : `Referral: ${who}`;
    return { kind: 'referral', label };
  }
  return null;
}

/** The Collect button's label from the totals. */
export function collectLabel(totals) {
  if (!totals || totals.count <= 0) return 'Collect';
  if (totals.coins > 0) return `Collect +${fmt(totals.coins)}`;
  return totals.count > 1 ? 'Collect all' : 'Collect';
}

/** "From the Jalebi Games team" unless the gift names a sender. */
export function giftFrom(gift, team = 'Jalebi Games team') {
  const from = gift?.data?.from;
  return typeof from === 'string' && from.trim() ? from.trim() : team;
}

/** One live-region sentence after a collect. */
export function collectAnnouncement(totals) {
  if (!totals || !totals.count) return '';
  const bits = [];
  if (totals.coins) bits.push(`${fmt(totals.coins)} coins`);
  if (totals.xp) bits.push(`${fmt(totals.xp)} XP`);
  if (totals.items) bits.push(totals.items === 1 ? '1 item' : `${totals.items} items`);
  return `${totals.count === 1 ? 'Gift' : `${totals.count} gifts`} collected${bits.length ? `: ${bits.join(', ')}` : ''}.`;
}

/** Icon name (shell icon set) and screen-reader word per kind. */
export const KIND_META = Object.freeze({
  gift: { icon: 'gift', word: 'Gift' },
  message: { icon: 'message', word: 'Message' },
  system: { icon: 'info', word: 'Notice' },
  achievement: { icon: 'medal', word: 'Badge' },
});

/** The bell's accessible name: "Notifications, 2 unread". */
export function bellLabel(unread) {
  const n = posInt(unread);
  return n ? `Notifications, ${n > 99 ? '99+' : n} unread` : 'Notifications';
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Short relative time: 'Just now', '5 min ago', '3 h ago', 'Yesterday', '4 days ago', then '12 Nov' (and the year when
 * it is not this year). Future times (clock skew) read as 'Just now'. '' for a missing or bad time.
 */
export function relativeTime(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const ago = now - t;
  if (ago < 45_000) return 'Just now';
  if (ago < HOUR) return `${Math.max(1, Math.round(ago / MIN))} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  if (ago < 2 * DAY) return 'Yesterday';
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)} days ago`;
  const d = new Date(t);
  const y = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}
