// The activity feed's model (pure, unit-tested in feedModel.test.js): turns engine events / presenter log entries into
// rows that tell the story in plain words: an icon + tone, the players and tiles named as chips, the money that moved and
// WHY, a relative age that fades. The words themselves always come from messages.js (`describeEvent`): nothing here
// duplicates a sentence.
//
//   feedItem(ev, ctx)      wraps describeEvent: { text, tone, icon, kind, label, tile, tiles, amount, amountWho, players } | null
//   feedEntry(entry, ctx)  the same for a presenter log entry ({ text, tone, icon, player, tile, ev, at }): reuses the entry's
//                          own text (describeEvent needs the owners BEFORE the event, which the log no longer has)
//   buildFeed(log, opts)   newest first; "rolled 5" + "landed on Madhapur" become one row
//   chipify(text, ctx)     text -> [{ t: 'text' | 'player' | 'tile' | 'amount', s, color? }] so names render as chips

import { GROUP_TILES, TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { describeEvent } from '@/lib/messages.js';
import { DEFAULT_MAP, activeMapId } from '@shared/maps.js';
import { MINUS, reasonLabel } from '../fx/fxModel.js';

/** What a row is about (drives its icon colour and the small caps label). */
export const KIND_LABEL = {
  roll: 'ROLL',
  move: 'MOVE',
  rent: 'RENT',
  tax: 'TAX',
  salary: 'SALARY',
  fine: 'FINE',
  cash: 'CASH',
  buy: 'BOUGHT',
  build: 'BUILD',
  sell: 'SCALED BACK',
  card: 'CARD',
  event: 'EVENT',
  ride: 'RIDE',
  traffic: 'TRAFFIC',
  chai: 'CHAI',
  auction: 'AUCTION',
  snatch: 'SNATCH',
  set: 'COLLECTION',
  power: 'POWER',
  mortgage: 'MORTGAGE',
  trade: 'TRADE',
  debt: 'DEBT',
  bankrupt: 'OUT',
  round: 'ROUND',
  win: 'WINNER',
  note: 'NOTE',
  info: '',
};

/** Icon for a row that has no emoji of its own. */
export const KIND_ICON = {
  roll: '🎲', move: '👣', rent: '🏠', tax: '🏛️', salary: '💰', fine: '🚦', cash: '💸', buy: '🔑', build: '🏗️', sell: '📉',
  card: '🃏', event: '🌆', ride: '🛺', traffic: '🚦', chai: '☕', auction: '🔨', snatch: '⚡', set: '🎉', power: '🃏', mortgage: '🏦',
  trade: '🤝', debt: '⚠️', bankrupt: '💥', round: '🔔', win: '🏆', note: '📌', info: '•',
};

const isId = (v) => typeof v === 'string'; // player ids are strings; tile numbers (a ride's from / to) are not

/** The kind of a row for an engine event. */
export function kindOf(ev) {
  if (!ev || typeof ev.type !== 'string') return 'note';
  switch (ev.type) {
    case 'dice': return 'roll';
    case 'move': case 'land': return 'move';
    case 'cash':
      switch (ev.reason) {
        case 'rent': return 'rent';
        case 'tax': return 'tax';
        case 'salary': return 'salary';
        case 'traffic': return 'fine';
        case 'card': return 'card';
        case 'event': return 'event';
        default: return 'cash';
      }
    case 'own': return 'buy';
    case 'skip': return 'info';
    case 'level': return ev.reason === 'sell' ? 'sell' : 'build';
    case 'card': return 'card';
    case 'city_event': return 'event';
    case 'ride': return 'ride';
    case 'traffic': return 'traffic';
    case 'chai': return 'chai';
    case 'auction_start': case 'auction_end': return 'auction';
    case 'snatch_open': case 'snatch_end': case 'token_earned': return 'snatch';
    case 'set_complete': return 'set';
    case 'power_draw': case 'power_play': case 'power_trigger': case 'power_expire': return 'power';
    case 'mortgage': case 'unmortgage': return 'mortgage';
    case 'trade_offer': case 'trade_countered': case 'trade_done': case 'trade_rejected': return 'trade';
    case 'debt': return 'debt';
    case 'bankrupt': return 'bankrupt';
    case 'turn': return 'round';
    case 'win': return 'win';
    default: return 'info';
  }
}

/**
 * How much money an event moved and for whom: { amount (signed, from `who`'s side), who } or null.
 * Only events that carry a number the player cares about: cash, a purchase, an auction, a ride, a mortgage.
 */
export function moneyOf(ev) {
  if (!ev) return null;
  switch (ev.type) {
    case 'cash':
      return Number(ev.delta) ? { amount: Number(ev.delta), who: ev.player, other: ev.other ?? null } : null;
    case 'auction_end':
      return ev.winner !== null && ev.winner !== undefined && Number(ev.amount) > 0 ? { amount: -Number(ev.amount), who: ev.winner } : null;
    case 'ride':
      return Number(ev.fare) > 0 ? { amount: -Number(ev.fare), who: ev.player } : null;
    case 'mortgage':
      return Number(ev.value) > 0 ? { amount: Number(ev.value), who: ev.player } : null;
    case 'unmortgage':
      return Number(ev.cost) > 0 ? { amount: -Number(ev.cost), who: ev.player } : null;
    case 'own': {
      const tile = TILES[ev.tile];
      return ev.reason === 'buy' && tile && tile.price ? { amount: -Number(tile.price), who: ev.owner } : null;
    }
    default:
      return null;
  }
}

/** The tiles a row points at (the first one is what a tap highlights). */
function tilesOf(ev, tile) {
  if (ev && ev.type === 'set_complete') return (GROUP_TILES[ev.group] || []).slice();
  return Number.isInteger(tile) ? [tile] : [];
}

/** Who is in the story (ids, no repeats, no tile numbers). */
function playersOf(ev, main) {
  const out = [];
  const add = (v) => {
    if (isId(v) && !out.includes(v)) out.push(v);
  };
  add(main);
  if (ev) [ev.player, ev.other, ev.owner, ev.winner, ev.buyer, ev.from, ev.to, ev.creditor].forEach(add);
  return out;
}

function classify(ev, d, main) {
  const kind = ev ? kindOf(ev) : 'note';
  const money = moneyOf(ev);
  const tile = d.tile !== undefined ? d.tile : ev ? ev.tile : undefined;
  const tiles = tilesOf(ev, tile);
  return {
    kind,
    label: (ev && ev.type === 'cash' && reasonLabel(ev.reason)) || (kind === 'chai' && activeMapId() !== DEFAULT_MAP ? 'TOKEN' : KIND_LABEL[kind]) || '',
    icon: d.icon || KIND_ICON[kind] || KIND_ICON.info,
    tile: tiles.length ? tiles[0] : null,
    tiles,
    amount: money ? money.amount : null,
    amountWho: money ? money.who : null,
    amountOther: money ? money.other ?? null : null, // the other side of a payment between players (rent): their gain is my loss
    players: playersOf(ev, main),
  };
}

/** describeEvent + the feed extras. `ctx` is describeEvent's (players, me, owners, round, ...). null when the event has no line. */
export function feedItem(ev, ctx) {
  const d = describeEvent(ev, ctx);
  if (!d) return null;
  const main = ev && (ev.player ?? ev.owner ?? ev.winner);
  return { text: d.text, tone: d.tone || 'info', ...classify(ev, d, main) };
}

/** A presenter log entry as a feed item (its text is already the finished sentence). */
export function feedEntry(entry) {
  if (!entry) return null;
  const ev = entry.ev || null;
  return {
    id: entry.id,
    at: Number.isFinite(entry.at) ? entry.at : null,
    text: String(entry.text || ''),
    tone: entry.tone || 'info',
    player: entry.player ?? null,
    ...classify(ev, { icon: entry.icon, tile: entry.tile }, entry.player),
  };
}

/**
 * "Sana rolled 5" + "Sana landed on Madhapur" -> "Sana rolled 5 and landed on Madhapur"; null when the two lines are not
 * about the same player (or the roll was a six: "roll again!" stands on its own).
 */
export function mergeRollText(rollText, landText) {
  const subject = String(rollText || '').split(' rolled ')[0];
  if (!subject || !/ rolled \d$/.test(rollText) || !String(landText || '').startsWith(`${subject} `)) return null;
  return `${rollText} and ${landText.slice(subject.length + 1)}`;
}

/**
 * The feed rows, newest first, at most `max`. "Sana rolled 5" followed by "Sana landed on Madhapur" is one row:
 * "Sana rolled 5 and landed on Madhapur". Rows keep the id of their first entry (so a row that grows keeps its place).
 */
export function buildFeed(log, { max = 12 } = {}) {
  const all = Array.isArray(log) ? log : [];
  // Only the tail can show: a row holds at most two entries (roll + move), so `2 * max + 2` entries always yield `max`
  // whole rows (only the oldest one could lose its merge partner). The presenter keeps 200 entries and re-renders the feed
  // on every event: classifying all of them each time was wasted main-thread work.
  const keep = 2 * Math.max(1, max) + 2;
  const list = all.length > keep ? all.slice(all.length - keep) : all;
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    const cur = feedEntry(list[i]);
    if (!cur || !cur.text) continue;
    const prev = rows[rows.length - 1];
    const joined = prev && prev.kind === 'roll' && cur.kind === 'move' && !prev.merged && prev.player === cur.player && cur.tile !== null ? mergeRollText(prev.text, cur.text) : null;
    if (joined) {
      rows[rows.length - 1] = { ...cur, id: prev.id, at: prev.at ?? cur.at, kind: 'move', merged: true, text: joined };
      continue;
    }
    rows.push(cur);
  }
  return rows.slice(-Math.max(1, max)).reverse();
}

// ---- ages -----------------------------------------------------------------------------------------------------

/** 'now' / '12s' / '3m' / '2h' for an age in ms. */
export function relativeAge(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 8) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** 0 (fresh) .. 1 (old): rows fade from 20 s to 4 min. */
export function ageFade(ms) {
  const a = Number(ms) || 0;
  if (a <= 20000) return 0;
  return Math.min(1, (a - 20000) / 220000);
}

// ---- chips ---------------------------------------------------------------------------------------------------------

const ESC = /[.*+?^${}()|[\]\\]/g;
const escRe = (s) => String(s).replace(ESC, '\\$&');
let tileRe = null;
function tileNames() {
  if (!tileRe) {
    const names = [...new Set(TILES.filter((t) => t && t.name).map((t) => t.name))].sort((a, b) => b.length - a.length);
    tileRe = names.map(escRe);
  }
  return tileRe;
}

/**
 * Split a sentence into text / player / tile / amount pieces. `ctx.players` = [{ id, name, color }], `ctx.me` the local
 * player's id ("You" / "you" become that player's chip). Names shorter than 2 characters are left alone.
 */
export function chipify(text, ctx = {}) {
  const s = String(text || '');
  if (!s) return [];
  const players = Array.isArray(ctx.players) ? ctx.players : [];
  const byName = new Map();
  for (const p of players) if (p && p.name && String(p.name).length >= 2) byName.set(String(p.name).toLowerCase(), p);
  const me = players.find((p) => p && p.id === ctx.me);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escRe);
  // words (players, "you", tiles) are whole words: a leading boundary is consumed as group 1 (no look-behind: older iOS lacks it)
  const words = [...names];
  if (me) words.push('you');
  words.push(...tileNames());
  const wordRe = words.length ? `(^|[^\\p{L}\\p{N}])(${words.join('|')})(?![\\p{L}\\p{N}])|` : '';
  const re = new RegExp(`${wordRe}([+\\u2212-]?\\u20B9[\\d,]+(?:\\.\\d+)?[kL]?)`, 'giu');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    const word = m[2];
    const start = m.index + (word ? m[1].length : 0);
    const hit = word || m[3];
    if (start > last) out.push({ t: 'text', s: s.slice(last, start) });
    const low = hit.toLowerCase();
    if (!word) out.push({ t: 'amount', s: hit });
    else if (byName.has(low)) out.push({ t: 'player', s: hit, color: byName.get(low).color || null });
    else if (me && low === 'you') out.push({ t: 'player', s: hit, color: me.color || null });
    else out.push({ t: 'tile', s: hit });
    last = start + hit.length;
    if (hit.length === 0) re.lastIndex += 1;
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}

/** The right-hand money chip of a row: { text, sign: 1 | -1 | 0, mine } or null. Signed only when it is the local player's money. */
export function moneyChip(item, me) {
  if (!item || item.amount === null || item.amount === undefined || !item.amount) return null;
  const known = me !== undefined && me !== null;
  const text = formatINR(Math.abs(item.amount));
  // my side of the payment: mine if I am the one it is booked on, or the other party (rent paid to me) with the sign flipped
  let amount = null;
  if (known && item.amountWho === me) amount = item.amount;
  else if (known && item.amountOther === me) amount = -item.amount;
  if (amount === null) return { text, sign: 0, mine: false };
  return { text: `${amount < 0 ? MINUS : '+'}${text}`, sign: amount < 0 ? -1 : 1, mine: true };
}

/** A plain-language label for a row's tap target. */
export function rowLabel(item) {
  const t = item && Number.isInteger(item.tile) && TILES[item.tile] ? TILES[item.tile].name : null;
  return t ? `${item.text}. Show ${t} on the board` : item ? item.text : '';
}
