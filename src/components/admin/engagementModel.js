// Engagement screens view model (docs/ENGAGEMENT.md "Admin API" / "Backend notes"): events, seasons and their prize
// tiers, the payout gate, achievement rates and grants. Pure (no React, no DOM). Validation messages are the Worker's
// own (worker/events.js, worker/seasons.js), so a form shows exactly what the server would answer.
import { COSMETICS, COSMETIC_KINDS, FREE_COSMETICS, cosmeticById } from '@shared/cosmetics.js';
import { ACHIEVEMENTS, achievementById, rewardOf } from '@shared/achievements.js';
import { EVENT_KINDS, LIMITS, MULTIPLIERS } from '@/lib/adminApi.js';
import { KIND_LABEL, KIND_WORD, fmtDateTime, fmtNum, fromLocalInput, relTime, toLocalInput } from './model.js';

const len = (s) => [...String(s ?? '')].length;
const ms = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
};
const DAY = 86_400_000;

// ---- events -----------------------------------------------------------------------------------------------------

export const EVENT_ERRORS = Object.freeze({
  kind: 'Kind must be coin_boost or limited_shop.',
  name: `Name must be 1-${LIMITS.eventNameMax} characters.`,
  description: `Description must be 1-${LIMITS.eventDescriptionMax} characters.`,
  start: 'Start must be a date and time.',
  end: 'End must be a date and time.',
  order: 'The end must be after the start.',
  tooLong: `An event can last at most ${LIMITS.eventMaxDays} days.`,
  multiplier: 'The multiplier must be 1.5, 2, 2.5 or 3.',
  itemsEmpty: 'Pick at least one limited item.',
  itemsMax: `At most ${LIMITS.limitedItemsMax} limited items.`,
  itemsBad: 'Only limited event items can be sold in a limited shop.',
});

/** The cosmetics a limited shop may sell (`source: 'event'`), catalogue order. */
export const eventItems = () => COSMETICS.filter((c) => c.source === 'event');

/** 'live' | 'scheduled' | 'ended' | 'off' at `now` (the server's rule: active AND start <= now < end). */
export function eventStatus(e, now = Date.now()) {
  if (!e || e.active === false) return 'off';
  const s = ms(e.startsAt);
  const end = ms(e.endsAt);
  if (Number.isFinite(s) && now < s) return 'scheduled';
  if (Number.isFinite(end) && now >= end) return 'ended';
  return 'live';
}

/** Badge tone + label per status. */
export const EVENT_STATUS = Object.freeze({
  live: ['good', 'Live'],
  scheduled: ['info', 'Scheduled'],
  ended: ['plain', 'Ended'],
  off: ['plain', 'Off'],
});

/** 2 d 6 h / 5 h 30 min / 45 min. */
export function durationText(msLong) {
  const m = Math.round(Math.max(0, Number(msLong) || 0) / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return min ? `${h} h ${min} min` : `${h} h`;
  return `${min} min`;
}

/** A blank event form: starts at the next full hour, lasts 3 days. */
export function emptyEventForm(now = Date.now()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3 * DAY);
  return {
    kind: 'coin_boost',
    name: '',
    description: '',
    startsAt: toLocalInput(start.toISOString()),
    endsAt: toLocalInput(end.toISOString()),
    active: true,
    multiplier: 2,
    itemIds: [],
  };
}

/** An event (admin shape) -> form state. Both configs are kept, so switching kind back loses nothing. */
export function eventToForm(e) {
  const c = e && e.config && typeof e.config === 'object' ? e.config : {};
  return {
    kind: EVENT_KINDS.includes(e?.kind) ? e.kind : 'coin_boost',
    name: e?.name || '',
    description: e?.description || '',
    startsAt: toLocalInput(e?.startsAt),
    endsAt: toLocalInput(e?.endsAt),
    active: e?.active !== false,
    multiplier: MULTIPLIERS.includes(Number(c.multiplier)) ? Number(c.multiplier) : 2,
    itemIds: Array.isArray(c.itemIds) ? c.itemIds.filter((x) => typeof x === 'string') : [],
  };
}

/** Client copy of the Worker's event rules; returns `{ field: message }` (fields: kind name description startsAt endsAt multiplier items). */
export function eventErrors(f) {
  const e = {};
  if (!EVENT_KINDS.includes(f.kind)) e.kind = EVENT_ERRORS.kind;
  const name = String(f.name ?? '').trim();
  if (!name || len(name) > LIMITS.eventNameMax) e.name = EVENT_ERRORS.name;
  if (len(String(f.description ?? '').trim()) > LIMITS.eventDescriptionMax) e.description = EVENT_ERRORS.description;
  const s = fromLocalInput(f.startsAt);
  const en = fromLocalInput(f.endsAt);
  if (!s) e.startsAt = EVENT_ERRORS.start;
  if (!en) e.endsAt = EVENT_ERRORS.end;
  if (s && en) {
    const d = ms(en) - ms(s);
    if (d <= 0) e.endsAt = EVENT_ERRORS.order;
    else if (d > LIMITS.eventMaxDays * DAY) e.endsAt = EVENT_ERRORS.tooLong;
  }
  if (f.kind === 'coin_boost' && !MULTIPLIERS.includes(Number(f.multiplier))) e.multiplier = EVENT_ERRORS.multiplier;
  if (f.kind === 'limited_shop') {
    const ids = Array.isArray(f.itemIds) ? f.itemIds : [];
    const allowed = new Set(eventItems().map((c) => c.id));
    if (!ids.length) e.items = EVENT_ERRORS.itemsEmpty;
    else if (ids.length > LIMITS.limitedItemsMax) e.items = EVENT_ERRORS.itemsMax;
    else if (ids.some((id) => !allowed.has(id))) e.items = EVENT_ERRORS.itemsBad;
  }
  return e;
}

/** Form -> request body (the whole event; PATCH validates the merged event anyway). PATCH sends "" to clear the description. */
export function eventBody(f, { patch = false } = {}) {
  const body = {
    kind: f.kind,
    name: String(f.name ?? '').trim(),
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    active: !!f.active,
    config: f.kind === 'coin_boost' ? { multiplier: Number(f.multiplier) } : { itemIds: [...new Set(f.itemIds || [])] },
  };
  const desc = String(f.description ?? '').trim();
  if (desc) body.description = desc;
  else if (patch) body.description = '';
  return body;
}

/** The effect chip of an event row: "×2 coins" or "2 limited items". */
export function eventEffectShort(e) {
  const c = e && e.config && typeof e.config === 'object' ? e.config : {};
  if (e?.kind === 'coin_boost') return `×${Number(c.multiplier) || 1} coins`;
  const n = Array.isArray(c.itemIds) ? c.itemIds.length : 0;
  return `${n} limited ${n === 1 ? 'item' : 'items'}`;
}

/** "ends in 2 d" / "starts in 5 h" / "ended 3 d ago" for an event or season window. */
export function windowHint(startsAt, endsAt, now = Date.now()) {
  const s = ms(startsAt);
  const e = ms(endsAt);
  if (Number.isFinite(s) && now < s) return `starts ${relTime(startsAt, now)}`;
  if (Number.isFinite(e) && now < e) return `ends ${relTime(endsAt, now)}`;
  if (Number.isFinite(e)) return `ended ${relTime(endsAt, now)}`;
  return '';
}

/**
 * Which form field a server 400 belongs to (so it shows inline): kind name description startsAt endsAt multiplier
 * items tiers, or 'form' for anything else.
 */
export function serverField(message) {
  const m = String(message || '');
  if (/^Kind /.test(m)) return 'kind';
  if (/^Name /.test(m)) return 'name';
  if (/^Description /.test(m)) return 'description';
  if (/^Start /.test(m)) return 'startsAt';
  if (/^End |end must be after|last at most/.test(m)) return 'endsAt';
  if (/multiplier/i.test(m)) return 'multiplier';
  if (/limited item|limited shop/i.test(m)) return 'items';
  if (/prize|tier/i.test(m)) return 'tiers';
  return 'form';
}

// ---- seasons ----------------------------------------------------------------------------------------------------

export const TIER_ERRORS = Object.freeze({
  list: 'prizeTiers must be a list.',
  max: `At most ${LIMITS.tiersMax} prize tiers.`,
  rank: `Each prize tier needs whole-number ranks from 1 to ${LIMITS.rankMax} (fromRank <= toRank).`,
  overlap: 'Prize tiers must not overlap.',
  coins: `Prize coins must be a whole number from 1 to ${LIMITS.prizeCoinsMax.toLocaleString('en-US')}.`,
  item: 'Unknown prize item.',
  empty: 'Each prize tier needs coins, an item or both.',
});

export const SEASON_ERRORS = Object.freeze({
  name: `Name must be 1-${LIMITS.seasonNameMax} characters.`,
  start: 'Start must be a date and time.',
  end: 'End must be a date and time.',
  order: 'The end must be after the start.',
});

/** 'scheduled' | 'active' | 'ended' | 'paid' at `now` (the server's derivation). */
export function seasonStatus(s, now = Date.now()) {
  if (!s) return 'scheduled';
  if (s.paidAt || s.status === 'paid') return 'paid';
  const start = ms(s.startsAt);
  const end = ms(s.endsAt);
  if (Number.isFinite(start) && now < start) return 'scheduled';
  if (Number.isFinite(end) && now < end) return 'active';
  return 'ended';
}

export const SEASON_STATUS = Object.freeze({
  scheduled: ['info', 'Scheduled'],
  active: ['good', 'Live'],
  ended: ['warn', 'Ended'],
  paid: ['gold', 'Paid'],
});

/** The payout column: "Paid 21 Nov 2026, 18:00" / "Awaiting payout" / "After the end". */
export function payoutState(s, now = Date.now()) {
  const st = seasonStatus(s, now);
  if (st === 'paid') return { tone: 'good', text: s.paidAt ? `Paid ${fmtDateTime(s.paidAt)}` : 'Paid' };
  if (st === 'ended') return { tone: 'warn', text: 'Awaiting payout' };
  return { tone: 'plain', text: 'After the end' };
}

/** One editable tier row (strings, as typed). */
export const emptyTier = (fromRank = '', toRank = '') => ({ fromRank: String(fromRank), toRank: String(toRank), coins: '', itemId: '' });

/** Stored tiers -> editable rows. */
export const tiersToRows = (tiers) =>
  (Array.isArray(tiers) ? tiers : []).map((t) => ({
    fromRank: t.fromRank != null ? String(t.fromRank) : '',
    toRank: t.toRank != null ? String(t.toRank) : '',
    coins: t.coins != null ? String(t.coins) : '',
    itemId: t.itemId || '',
  }));

/** The next row's suggested ranks: right after the highest one so far. */
export function nextTier(rows) {
  const top = Math.max(0, ...rows.map((r) => Number.parseInt(r.toRank, 10)).filter(Number.isFinite));
  const from = Math.min(top + 1, LIMITS.rankMax);
  return emptyTier(from, from);
}

const whole = (s) => /^\d+$/.test(String(s ?? '').trim());

/**
 * Validate tier rows like `parseTiers` on the Worker. Returns
 * `{ ok, list: message|'', rows: [{ ranks?, coins?, item?, empty?, overlap? }] }`, one entry per row.
 */
export function tierErrors(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = list.map(() => ({}));
  let listError = '';
  if (list.length > LIMITS.tiersMax) listError = TIER_ERRORS.max;
  const ranked = [];
  list.forEach((r, i) => {
    const e = out[i];
    const from = whole(r.fromRank) ? Number(r.fromRank) : NaN;
    const to = whole(r.toRank) ? Number(r.toRank) : NaN;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > LIMITS.rankMax || from > to) e.ranks = TIER_ERRORS.rank;
    else ranked.push({ i, from, to });
    const coins = String(r.coins ?? '').trim();
    if (coins && (!whole(coins) || Number(coins) < 1 || Number(coins) > LIMITS.prizeCoinsMax)) e.coins = TIER_ERRORS.coins;
    const item = r.itemId ? cosmeticById(r.itemId) : null;
    if (r.itemId && (!item || FREE_COSMETICS.includes(item.id))) e.item = TIER_ERRORS.item;
    if (!coins && !r.itemId) e.empty = TIER_ERRORS.empty;
  });
  ranked.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let k = 1; k < ranked.length; k += 1) {
    if (ranked[k].from <= ranked[k - 1].to) {
      out[ranked[k].i].overlap = TIER_ERRORS.overlap;
      out[ranked[k - 1].i].overlap = TIER_ERRORS.overlap;
      if (!listError) listError = TIER_ERRORS.overlap;
    }
  }
  const ok = !listError && out.every((e) => !Object.keys(e).length);
  return { ok, list: listError, rows: out };
}

/** Tier rows -> the request's `prizeTiers` (numbers; sorted by rank like the server stores them). */
export function tiersBody(rows) {
  return (rows || [])
    .map((r) => {
      const t = { fromRank: Number.parseInt(r.fromRank, 10), toRank: Number.parseInt(r.toRank, 10) };
      const coins = String(r.coins ?? '').trim();
      if (coins) t.coins = Number(coins);
      if (r.itemId) t.itemId = r.itemId;
      return t;
    })
    .sort((a, b) => a.fromRank - b.fromRank);
}

/** The editor's rows as display tiers (only the valid ones), for the summary. */
export function rowsToTiers(rows) {
  const { rows: errs } = tierErrors(rows);
  return tiersBody(rows.filter((_, i) => !errs[i].ranks && !errs[i].coins && !errs[i].item && !errs[i].empty));
}

/** A blank season: starts at the next full hour, lasts 30 days, with the usual podium tiers. */
export function emptySeasonForm(now = Date.now()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 30 * DAY);
  return {
    name: '',
    startsAt: toLocalInput(start.toISOString()),
    endsAt: toLocalInput(end.toISOString()),
    tiers: [
      { fromRank: '1', toRank: '1', coins: '6000', itemId: 'title-season-champ' },
      { fromRank: '2', toRank: '3', coins: '3000', itemId: '' },
      { fromRank: '4', toRank: '10', coins: '1000', itemId: 'frame-season' },
    ],
  };
}

export const seasonToForm = (s) => ({
  name: s?.name || '',
  startsAt: toLocalInput(s?.startsAt),
  endsAt: toLocalInput(s?.endsAt),
  tiers: tiersToRows(s?.prizeTiers),
});

/** Name and window checks (the tiers are `tierErrors`). */
export function seasonErrors(f) {
  const e = {};
  const name = String(f.name ?? '').trim();
  if (!name || len(name) > LIMITS.seasonNameMax) e.name = SEASON_ERRORS.name;
  const s = fromLocalInput(f.startsAt);
  const en = fromLocalInput(f.endsAt);
  if (!s) e.startsAt = SEASON_ERRORS.start;
  if (!en) e.endsAt = SEASON_ERRORS.end;
  if (s && en && ms(en) <= ms(s)) e.endsAt = SEASON_ERRORS.order;
  return e;
}

export const seasonBody = (f) => ({
  name: String(f.name ?? '').trim(),
  startsAt: fromLocalInput(f.startsAt),
  endsAt: fromLocalInput(f.endsAt),
  prizeTiers: tiersBody(f.tiers),
});

/** Prize item options: season items first, then every other non-free cosmetic by kind. */
export function prizeItemGroups() {
  const free = new Set(FREE_COSMETICS);
  const season = COSMETICS.filter((c) => c.source === 'season');
  const rest = COSMETIC_KINDS.map((kind) => ({
    kind,
    label: KIND_LABEL[kind] || kind,
    items: COSMETICS.filter((c) => c.kind === kind && c.source !== 'season' && !free.has(c.id)),
  })).filter((g) => g.items.length);
  return [{ kind: 'season', label: 'Season prizes', items: season }, ...rest];
}

/** prizesPreview -> `{ winners, coins, items: [{ itemId, name, kind, count }] }`. */
export function payoutTotals(preview) {
  const rows = Array.isArray(preview) ? preview : [];
  const items = new Map();
  let coins = 0;
  for (const r of rows) {
    coins += Number(r.coins) || 0;
    if (r.itemId) {
      const cur = items.get(r.itemId) || { itemId: r.itemId, name: r.itemName || cosmeticById(r.itemId)?.name || r.itemId, kind: cosmeticById(r.itemId)?.kind || '', count: 0 };
      cur.count += 1;
      items.set(r.itemId, cur);
    }
  }
  return { winners: rows.length, coins, items: [...items.values()] };
}

const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * May the Pay out button be pressed? `{ enabled, reason }`: admins only, and only once the season has ended and is
 * not paid yet (the server answers 409 otherwise).
 */
export function payoutGate({ season, adminWrite, now = Date.now() }) {
  if (!season) return { enabled: false, reason: 'Loading the season.' };
  const st = seasonStatus(season, now);
  if (st === 'paid') return { enabled: false, reason: season.paidAt ? `Paid out ${fmtDateTime(season.paidAt)}.` : 'Already paid out.' };
  if (!adminWrite) return { enabled: false, reason: 'Only admins can pay out a season.' };
  if (st === 'scheduled') return { enabled: false, reason: `Opens when the season ends. It has not started yet (${relTime(season.startsAt, now)}).` };
  if (st === 'active') return { enabled: false, reason: `Opens when the season ends, ${relTime(season.endsAt, now)}.` };
  return { enabled: true, reason: '' };
}

/** The strong confirmation's copy: restates the winners, the coins and the items. */
export function payoutConfirmCopy(season, totals) {
  const t = totals || { winners: 0, coins: 0, items: [] };
  const title = `Pay out ${season?.name || 'this season'}?`;
  if (!t.winners) {
    return { title, body: 'Nobody holds a prize rank. Paying out freezes the final standings and pays nothing. This cannot be undone.' };
  }
  const gifts = [];
  if (t.coins) gifts.push(plural(t.coins, 'coin'));
  for (const it of t.items) gifts.push(`${fmtNum(it.count)} × ${it.name}${it.kind ? ` ${KIND_WORD[it.kind] || it.kind}` : ''}`);
  return {
    title,
    body: `${plural(t.winners, 'winner')} get ${andList(gifts)} in total. The final standings are frozen and each winner gets a gift notification. This cannot be undone.`,
  };
}

// ---- achievements -----------------------------------------------------------------------------------------------

/** "<0.1%", "4.2%", "37%". */
export function rateText(rate) {
  const r = Number(rate) || 0;
  if (r <= 0) return '0%';
  if (r < 0.1) return '<0.1%';
  if (r < 10) return `${r.toFixed(1).replace(/\.0$/, '')}%`;
  return `${Math.round(r)}%`;
}

/** GET /api/admin/achievements + the catalogue -> table rows with the unlock rate over members (0-100). */
export function achievementRows(stats) {
  const counts = new Map((stats?.achievements || []).map((a) => [a.id, Number(a.unlocked) || 0]));
  const members = Number(stats?.members) || 0;
  return ACHIEVEMENTS.map((a) => {
    const unlocked = counts.get(a.id) || 0;
    const rate = members ? Math.min(100, (unlocked / members) * 100) : 0;
    return { id: a.id, name: a.name, description: a.description, icon: a.icon, category: a.category, reward: rewardOf(a), unlocked, rate, rateLabel: rateText(rate) };
  });
}

/** "title + 300 coins" (kind words, for the grant confirmation). */
export function rewardPhrase(achievement) {
  const r = achievement?.reward || {};
  const parts = [];
  const item = r.itemId ? cosmeticById(r.itemId) : null;
  if (item) parts.push(KIND_WORD[item.kind] || item.kind);
  if (r.coins) parts.push(plural(r.coins, 'coin'));
  return parts.join(' + ');
}

/** Catalogue achievements not unlocked yet (the grant select). */
export const grantableAchievements = (unlocked = []) => {
  const have = new Set((unlocked || []).map((x) => (typeof x === 'string' ? x : x?.id)));
  return ACHIEVEMENTS.filter((a) => !have.has(a.id));
};

/** "Unlock Champion for Rio?" + "This also pays its reward (title + 300 coins)." */
export function grantAchievementCopy(achievementId, userName) {
  const a = achievementById(achievementId);
  if (!a) return { title: 'Unlock this achievement?', body: '' };
  const reward = rewardPhrase(a);
  return {
    title: `Unlock ${a.name} for ${userName || 'this player'}?`,
    body: reward ? `This also pays its reward (${reward}).` : 'It has no reward to pay.',
  };
}

// ---- referrals --------------------------------------------------------------------------------------------------

/** Share of invited friends who played their first match (rewarded), as "42%". */
export const conversionText = (totals) => (Number(totals?.invited) ? rateText((Number(totals.rewarded) / Number(totals.invited)) * 100) : '–');
