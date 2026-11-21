// Pure rules for the player-facing engagement screens (docs/ENGAGEMENT.md): achievements, referrals, live events,
// seasons and the shop's limited / reward items. No React, no network. Times are local (the player's clock).
import { ACHIEVEMENT_CATEGORIES, MATCH_METRICS, achievementById } from '@shared/achievements.js';
import { cosmeticById } from '@shared/cosmetics.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Countdowns tick this often (and aria-live regions update no faster). */
export const COUNTDOWN_TICK_MS = 60_000;
/** The live-event chip refetches this often while the tab is visible. */
export const EVENTS_REFRESH_MS = 5 * 60_000;

const fmt = (n) => Number(n).toLocaleString('en-IN');
const timeOf = (iso) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/**
 * A short countdown for `ms` milliseconds left: '3d 4h', '4h 12m', '12m', 'under a minute'; '' when nothing is left.
 * Minute-granular on purpose (it is re-rendered once a minute).
 */
export function formatCountdown(ms) {
  const left = Number(ms);
  if (!Number.isFinite(left) || left <= 0) return '';
  if (left < MIN) return 'under a minute';
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / HOUR);
  const m = Math.floor((left % HOUR) / MIN);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** The same countdown, spelled out for screen readers: '3 days 4 hours'. */
export function spokenCountdown(ms) {
  const left = Number(ms);
  if (!Number.isFinite(left) || left <= 0) return '';
  if (left < MIN) return 'less than a minute';
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / HOUR);
  const m = Math.floor((left % HOUR) / MIN);
  const part = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  const bits = d ? [part(d, 'day'), part(h, 'hour')] : h ? [part(h, 'hour'), part(m, 'minute')] : [part(m, 'minute')];
  return bits.filter(Boolean).join(' ');
}

/** '11 pm', '11:30 pm', '12 am' (local clock). */
export function clockLabel(date) {
  const d = date instanceof Date ? date : new Date(date);
  const h = d.getHours();
  const mm = d.getMinutes();
  const hour = h % 12 || 12;
  return `${hour}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * When something ends, short and local: '11 pm' (today), 'Sun 11 pm' (within the coming 6 days), '24 Nov' (later).
 * '' for a bad time.
 */
export function endsLabel(iso, now = Date.now()) {
  const t = timeOf(iso);
  if (!Number.isFinite(t)) return '';
  const end = new Date(t);
  const today = new Date(now);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(end) - startOfDay(today)) / DAY);
  if (days <= 0) return clockLabel(end);
  if (days <= 6) return `${DAYS[end.getDay()]} ${clockLabel(end)}`;
  return `${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** '2×', '1.5×' (a multiplier as shown on chips). */
export const multiplierLabel = (m) => `${Number(Number(m).toFixed(2))}×`;

// ------------------------------------------------------------------------------------------------ live events

const cleanEvent = (e) => {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' && typeof e.id !== 'number') return null;
  if (e.kind !== 'coin_boost' && e.kind !== 'limited_shop') return null;
  const endsAt = Number.isFinite(timeOf(e.endsAt)) ? e.endsAt : null;
  return { id: String(e.id), kind: e.kind, name: typeof e.name === 'string' ? e.name : '', endsAt, config: e.config && typeof e.config === 'object' ? e.config : {} };
};

/**
 * What the live-event strip shows, from GET /api/events/live: a coin chip when `coinMultiplier > 1` (ending with the
 * boost that gives the multiplier) and one shop chip for a live limited shop. Ended events are dropped.
 *   -> [{ id, kind: 'coin_boost'|'limited_shop', label, name, endsAt, to? }]
 */
export function liveEventChips(data, now = Date.now()) {
  const events = (Array.isArray(data?.events) ? data.events : []).map(cleanEvent).filter((e) => e && (!e.endsAt || timeOf(e.endsAt) > now));
  const out = [];
  const mult = Number(data?.coinMultiplier);
  if (Number.isFinite(mult) && mult > 1) {
    const boosts = events.filter((e) => e.kind === 'coin_boost');
    const best = boosts.filter((e) => Number(e.config.multiplier) === mult).sort((a, b) => timeOf(a.endsAt) - timeOf(b.endsAt))[0] || boosts[0] || null;
    const till = best?.endsAt ? ` till ${endsLabel(best.endsAt, now)}` : '';
    out.push({ id: best?.id || 'boost', kind: 'coin_boost', name: best?.name || 'Coin boost', label: `${multiplierLabel(mult)} coins${till}`, endsAt: best?.endsAt || null });
  }
  const shop = events.filter((e) => e.kind === 'limited_shop').sort((a, b) => timeOf(b.endsAt) - timeOf(a.endsAt))[0];
  if (shop) {
    const till = shop.endsAt ? ` till ${endsLabel(shop.endsAt, now)}` : '';
    out.push({ id: shop.id, kind: 'limited_shop', name: shop.name || 'Limited shop', label: `Limited items${till}`, endsAt: shop.endsAt, to: '/shop' });
  }
  return out;
}

/** The earliest end among the chips (to drop them the moment one ends), or null. */
export function nextChipEnd(chips, now = Date.now()) {
  const ends = (chips || []).map((c) => timeOf(c.endsAt)).filter((t) => Number.isFinite(t) && t > now);
  return ends.length ? Math.min(...ends) : null;
}

/** Paths where the live-event strip is never shown (the viewport-fit leaderboard, full-screen play, the lobby). */
const STRIP_HIDDEN = ['/play', '/lobby', '/leaderboard'];
export const eventStripAllowed = (pathname) =>
  typeof pathname === 'string' && pathname.startsWith('/') && !STRIP_HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// ------------------------------------------------------------------------------------------------ achievements

export const CATEGORY_LABEL = Object.freeze({ play: 'Play', streak: 'Streaks', collection: 'Nawabi Raj', social: 'Friends' });

/** A clean Achievement from the API (null without an id). The catalogue fills missing display copy. */
export function normalizeAchievement(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const cat = achievementById(raw.id);
  const goal = Number(raw.goal ?? cat?.goal);
  const progress = raw.progress === null || raw.progress === undefined ? null : Number(raw.progress);
  const reward = raw.reward && typeof raw.reward === 'object' ? raw.reward : cat?.reward || {};
  const itemId = typeof reward.itemId === 'string' ? reward.itemId : null;
  return {
    id: raw.id,
    name: String(raw.name || cat?.name || raw.id),
    description: String(raw.description || cat?.description || ''),
    icon: String(raw.icon || cat?.icon || 'star'),
    category: ACHIEVEMENT_CATEGORIES.includes(raw.category) ? raw.category : cat?.category || 'play',
    goal: Number.isFinite(goal) && goal > 0 ? goal : 1,
    metric: cat?.metric || null,
    reward: {
      coins: Number(reward.coins) > 0 ? Math.floor(Number(reward.coins)) : 0,
      itemId,
      itemName: typeof reward.itemName === 'string' ? reward.itemName : itemId ? cosmeticById(itemId)?.name || '' : '',
    },
    progress: progress !== null && Number.isFinite(progress) ? Math.max(0, progress) : null,
    unlocked: raw.unlocked === true,
    unlockedAt: raw.unlocked === true && Number.isFinite(timeOf(raw.unlockedAt)) ? raw.unlockedAt : null,
  };
}

/** `{ value, goal, pct, text, spoken }` for a progress bar; null when there is no progress (signed out). */
export function achievementProgress(a) {
  if (!a || a.progress === null || a.progress === undefined) return null;
  const goal = a.goal > 0 ? a.goal : 1;
  const value = Math.min(goal, Math.max(0, Math.floor(a.unlocked ? goal : a.progress)));
  const pct = Math.round((value / goal) * 100);
  const oneMatch = a.metric && MATCH_METRICS.includes(a.metric);
  const text = oneMatch && !a.unlocked ? 'In one match' : `${fmt(value)} / ${fmt(goal)}`;
  return { value, goal, pct, text, spoken: oneMatch && !a.unlocked ? 'Done in a single match' : `${fmt(value)} of ${fmt(goal)}` };
}

/**
 * Achievements grouped by category in catalogue category order: [{ category, label, items, unlocked }]. Inside a group
 * unlocked ones come first (newest first), then locked by how close they are; the catalogue order breaks ties.
 */
export function groupAchievements(list) {
  const clean = (Array.isArray(list) ? list : []).map(normalizeAchievement).filter(Boolean);
  return ACHIEVEMENT_CATEGORIES.map((category) => {
    const items = clean
      .map((a, at) => ({ a, at }))
      .filter(({ a }) => a.category === category)
      .sort((x, y) => {
        if (x.a.unlocked !== y.a.unlocked) return x.a.unlocked ? -1 : 1;
        if (x.a.unlocked) return (timeOf(y.a.unlockedAt) || 0) - (timeOf(x.a.unlockedAt) || 0) || x.at - y.at;
        const px = achievementProgress(x.a)?.pct ?? 0;
        const py = achievementProgress(y.a)?.pct ?? 0;
        return py - px || x.at - y.at;
      })
      .map(({ a }) => a);
    return { category, label: CATEGORY_LABEL[category] || category, items, unlocked: items.filter((a) => a.unlocked).length };
  }).filter((g) => g.items.length);
}

/** '7 / 11 unlocked' from the response (counts what it can when the totals are missing). */
export function achievementSummary(data) {
  const list = Array.isArray(data?.achievements) ? data.achievements : [];
  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : list.length;
  const unlocked = Number.isFinite(Number(data?.unlocked)) ? Number(data.unlocked) : list.filter((a) => a?.unlocked).length;
  return { unlocked, total, text: `${unlocked} / ${total} unlocked` };
}

/** '12 Nov 2026' (local), '' for a bad date. */
export function dateLabel(iso) {
  const t = timeOf(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Reward chips: [{ kind: 'coins', label: '+300' } , { kind: 'item', itemId, label: 'Champion', item }]. */
export function rewardChips(reward) {
  const out = [];
  if (reward && Number(reward.coins) > 0) out.push({ kind: 'coins', label: `+${fmt(reward.coins)}`, spoken: `${fmt(reward.coins)} coins` });
  if (reward && reward.itemId) {
    const item = cosmeticById(reward.itemId);
    const name = reward.itemName || item?.name || 'A new item';
    out.push({ kind: 'item', itemId: reward.itemId, item, label: name, spoken: `${name}${item ? ` ${item.kind === 'dice' ? 'dice skin' : item.kind}` : ''}` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ referrals

export const REFERRAL_COINS = 250;

/** `link` from the API is a site path: prefix the page origin (absolute https links pass through). */
export function referralUrl(link, origin = '') {
  if (typeof link !== 'string' || !link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  if (!link.startsWith('/') || link.startsWith('//')) return '';
  return `${origin}${link}`;
}

/** What sharing the referral link says. */
export function referralShare(url, brand = 'Jalebi Games') {
  return {
    title: brand,
    text: `Play ${brand} with me! Sign up with my link and we both get ${REFERRAL_COINS} coins when you finish your first match.`,
    url,
  };
}

/** WhatsApp share URL for the referral link. */
export function referralWhatsApp(url, brand) {
  const m = referralShare(url, brand);
  return `https://wa.me/?text=${encodeURIComponent(`${m.text}\n${m.url}`)}`;
}

/** Clean GET /api/me/referrals numbers: `{ code, link, invited, rewarded, coinsEarned, recent }`. */
export function normalizeReferrals(raw) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  const recent = (Array.isArray(raw?.recent) ? raw.recent : [])
    .filter((r) => r && typeof r.name === 'string')
    .slice(0, 10)
    .map((r) => ({ name: r.name, avatar: Number(r.avatar) || 0, joinedAt: r.joinedAt || null, rewarded: r.rewarded === true }));
  return {
    code: typeof raw?.code === 'string' ? raw.code : '',
    link: typeof raw?.link === 'string' ? raw.link : '',
    invited: n(raw?.invited),
    rewarded: n(raw?.rewarded),
    coinsEarned: n(raw?.coinsEarned),
    recent,
  };
}

// ------------------------------------------------------------------------------------------------ seasons

export const SEASON_COLS = Object.freeze([
  { key: 'points', label: 'Points' },
  { key: 'wins', label: 'Wins' },
  { key: 'games', label: 'Games' },
]);

const STATUS_LABEL = { scheduled: 'Starting soon', active: 'Live', ended: 'Ended', paid: 'Prizes paid' };
export const seasonStatusLabel = (status) => STATUS_LABEL[status] || 'Season';

/**
 * The countdown line of a season at `now`: `{ label, ms, text, spoken }`. Active -> 'Ends in 4d 7h'; scheduled ->
 * 'Starts in 2d'; ended -> 'Ended, prizes coming soon'; paid -> 'Ended 24 Nov'. The status is re-derived from the
 * window, so a page left open flips from live to ended on its own.
 */
export function seasonCountdown(season, now = Date.now()) {
  if (!season) return null;
  const start = timeOf(season.startsAt);
  const end = timeOf(season.endsAt);
  if (season.status === 'paid') return { label: 'Ended', ms: 0, text: `Ended ${dateLabel(season.endsAt)}`.trim(), spoken: `Ended ${dateLabel(season.endsAt)}`.trim() };
  if (Number.isFinite(start) && now < start) {
    const ms = start - now;
    return { label: 'Starts in', ms, text: `Starts in ${formatCountdown(ms)}`, spoken: `Starts in ${spokenCountdown(ms)}` };
  }
  if (Number.isFinite(end) && now < end) {
    const ms = end - now;
    return { label: 'Ends in', ms, text: `Ends in ${formatCountdown(ms)}`, spoken: `Ends in ${spokenCountdown(ms)}` };
  }
  return { label: 'Ended', ms: 0, text: 'Ended. Prizes are on their way.', spoken: 'Ended. Prizes are on their way.' };
}

/** The status at `now` (the server's word, unless the window says it has moved on since). */
export function seasonStatusAt(season, now = Date.now()) {
  if (!season) return null;
  if (season.status === 'paid') return 'paid';
  const start = timeOf(season.startsAt);
  const end = timeOf(season.endsAt);
  if (Number.isFinite(start) && now < start) return 'scheduled';
  if (Number.isFinite(end) && now < end) return 'active';
  return 'ended';
}

/** '#1', '#2–3', '#4–10'. */
export const tierRanks = (t) => (t.fromRank === t.toRank ? `#${t.fromRank}` : `#${t.fromRank}–${t.toRank}`);

/** Prize tiers cleaned and sorted: [{ fromRank, toRank, ranks, coins, itemId, itemName, item }]. */
export function prizeTiers(season) {
  return (Array.isArray(season?.prizeTiers) ? season.prizeTiers : [])
    .filter((t) => t && Number.isInteger(Number(t.fromRank)) && Number.isInteger(Number(t.toRank)))
    .map((t) => {
      const item = t.itemId ? cosmeticById(t.itemId) : null;
      const tier = { fromRank: Number(t.fromRank), toRank: Number(t.toRank), coins: Number(t.coins) > 0 ? Number(t.coins) : 0, itemId: t.itemId || null, itemName: t.itemName || item?.name || '', item };
      return { ...tier, ranks: tierRanks(tier) };
    })
    .sort((a, b) => a.fromRank - b.fromRank);
}

/** Spoken summary of a tier: 'Rank 1: 5,000 coins and Season Champion'. */
export function tierSpoken(t) {
  const what = [t.coins ? `${fmt(t.coins)} coins` : '', t.itemName].filter(Boolean).join(' and ');
  const ranks = t.fromRank === t.toRank ? `Rank ${t.fromRank}` : `Ranks ${t.fromRank} to ${t.toRank}`;
  return `${ranks}: ${what || 'a prize'}`;
}

/** A SeasonRow -> the leaderboard's row shape (frame / title flattened). Rows without a name are dropped (null). */
export function seasonRowToBoard(r) {
  if (!r || typeof r !== 'object' || typeof r.name !== 'string') return null;
  const eq = r.equipped && typeof r.equipped === 'object' ? r.equipped : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { rank: num(r.rank), name: r.name, avatar: num(r.avatar), frame: eq.frame, title: eq.title, points: num(r.points), wins: num(r.wins), games: num(r.games), isMe: r.isMe === true };
}

/** "You are #14 this season with 8 points." style line parts, or null when the viewer is not ranked. */
export function seasonStanding(me) {
  if (!me || !Number(me.rank)) return null;
  return { rank: Number(me.rank), points: Number(me.points) || 0 };
}

// ------------------------------------------------------------------------------------------------ shop

export const NOT_AVAILABLE = 'Not available right now.';

/**
 * How a shop card treats an item (`item` = catalogue entry merged with the server's view):
 *   'shop'     a normal item
 *   'limited'  an event item on sale now (ribbon + countdown to `until`)
 *   'offsale'  an event item off sale (disabled: "On sale during events")
 *   'locked'   an achievement or season reward (lock + `hint`, never a buy button)
 * Owned items are always plain 'shop' (equip as usual).
 */
export function shopItemMode(item) {
  if (!item || item.owned) return { mode: 'shop' };
  const source = item.source || 'shop';
  if (source === 'achievement' || source === 'season') {
    return { mode: 'locked', hint: item.unlockHint || (source === 'season' ? 'Season prize' : 'Unlock: an achievement') };
  }
  if (source === 'event') {
    if (item.available === true) return { mode: 'limited', until: Number.isFinite(timeOf(item.availableUntil)) ? item.availableUntil : null };
    return { mode: 'offsale', hint: 'On sale during events' };
  }
  return { mode: 'shop' };
}

/** Is a 409 from POST /api/shop/buy the "not on sale" one (vs "already owned")? */
export const isUnavailableError = (e) => Number(e?.status) === 409 && (e?.message === NOT_AVAILABLE || /not available/i.test(String(e?.message || '')));
