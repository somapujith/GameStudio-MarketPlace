// Pure helpers behind the simple portrait-phone table (PhoneTable and its parts). No React in here.
//   objectiveFor(session)      the top-bar line: "₹50L net worth to win · Round 7 of 20"
//   eventChipOf(session)       the live city event for the slim chip under it, or null
//   attentionOf(session, spec) why the "..." menu button carries a dot (an upgrade, a trade offer, a debt)
//   gridFor(n) / cellSpans(n)  the players area: columns, density and the span of every cell on a 6-column grid
//   orderPlayers(players, me)  the others in turn order, then me (so I sit bottom-right)
//   captionFor(session, spec)  the one status line at the top of the board centre
//   chipFor(session, ...)      the tile chip under it (name, price or rent, owner colour)
//   primaryFor(spec) / pillFor(sec, session)  the plain-words labels of the action row
//   buyCardData(tile, ...)     everything the buy popup prints
//   faceTones(color)           flat body / lighter band / ink for a district tile face (AA with its ink)
import { compactINR, formatINR } from '@shared/format.js';
import { TILES } from '@shared/board.js';
import { bandTones, contrastRatio, mixHex } from '../PropertySheet.jsx';
import { statusLine } from '../ControlPanel.jsx';
import { bubbleSpeaker } from '../turn/SpeechBubble.jsx';
import { roundBadgeInfo } from '../turn/RoundBadge.jsx';
import { compactTarget, targetOf } from '../turn/target.js';
import { labelLines } from '../tileLabel.js';
import {
  MAX_LEVEL, collectionOf, levelNameOf, mortgageOf, rentLadder, tileAccent, unmortgageOf, upgradeCostOf,
} from '../ui/helpers.js';

const cfgOf = (session) => session?.display?.cfg || session?.view?.cfg || {};
const playersOf = (session) => session?.display?.players ?? session?.view?.players ?? [];
const stateOf = (session) => session?.display ?? session?.view ?? {};

/* ------------------------------------------------------------------ top bar */

/** "Round 7 of 20" / "Round 12" / "Final round". Classic ignores its safety cap. */
export function roundPhrase(session) {
  const b = roundBadgeInfo(session);
  const info = b.text.match(/Round (\d+)(?: \/ (\d+))?/);
  const round = info ? Number(info[1]) : 1;
  const max = info && info[2] ? Number(info[2]) : null;
  if (b.final && max != null) return 'Final round';
  return max != null ? `Round ${round} of ${max}` : `Round ${round}`;
}

/**
 * The objective line. -> { kind: 'target'|'rounds'|'last', target: '₹50L'|null, lead, tail, text, sr }
 *   target set         "<b>₹50L</b> net worth to win · Round 7 of 20"   (render lead, then <b>target</b>, then tail)
 *   rounds, no target  "Round 7 of 20 · richest wins"
 *   neither (classic)  "Last one standing wins · Round 12"
 */
export function objectiveFor(session) {
  const cfg = cfgOf(session);
  const round = roundPhrase(session);
  const t = targetOf(cfg);
  if (t) {
    const target = compactTarget(t);
    const tail = ` net worth to win · ${round}`;
    return { kind: 'target', target, lead: '', tail, text: `${target}${tail}`, sr: `First to a net worth of ${formatINR(t)} wins. ${round}` };
  }
  const limited = cfg.mode !== 'classic' && Number.isFinite(cfg.maxRounds);
  if (limited) {
    const text = `${round} · richest wins`;
    return { kind: 'rounds', target: null, lead: text, tail: '', text, sr: `${round}. The richest player wins` };
  }
  const text = `Last one standing wins · ${round}`;
  return { kind: 'last', target: null, lead: text, tail: '', text, sr: text };
}

/** The live city event: only while it applies to this round. -> { title, text, id } | null */
export function eventChipOf(session) {
  const d = stateOf(session);
  const ev = d.event !== undefined ? d.event : session?.view?.event;
  if (!ev) return null;
  const round = d.round ?? session?.view?.round;
  if (ev.round != null && round != null && ev.round !== round) return null;
  const title = ev.title || 'City event';
  return { id: ev.id || ev.type || 'event', title, text: ev.text || '' };
}

/** What needs me right now (the dot on the menu button). */
export function attentionOf(session, spec) {
  const view = session?.view || {};
  const me = session?.me;
  const upgrade = Number(spec?.upgrades) || 0;
  const trade = !!view.trade && view.trade.to === me;
  const debt = view.phase === 'debt' && view.debt?.player === me;
  const reasons = [];
  if (upgrade > 0) reasons.push(`${upgrade} ${upgrade === 1 ? 'district' : 'districts'} can be upgraded`);
  if (trade) reasons.push('a trade offer waits for your answer');
  if (debt) reasons.push('you owe money');
  return { upgrade, trade, debt, any: reasons.length > 0, reasons };
}

/* ------------------------------------------------------------------ players area */

/**
 * Columns / density by player count (the grid is 6 columns wide so 2 and 3 columns both divide it).
 *   1-2  roomy stacks side by side      3-4  two-column grid of rows      5-6  three-column grid of compact stacks
 */
export function gridFor(n) {
  const count = Math.max(1, Math.min(6, Number(n) || 1));
  if (count <= 2) return { cols: count, density: 'roomy', rows: 1 };
  if (count <= 4) return { cols: 2, density: 'row', rows: 2 };
  return { cols: 3, density: 'compact', rows: 2 };
}

/** The column span (of 6) of every cell: full rows share the width equally, an incomplete last row stretches. */
export function cellSpans(n) {
  const count = Math.max(1, Math.min(6, Number(n) || 1));
  const { cols } = gridFor(count);
  const spans = [];
  for (let i = 0; i < count; i += 1) {
    const rowStart = Math.floor(i / cols) * cols;
    const inRow = Math.min(cols, count - rowStart);
    spans.push(6 / inRow);
  }
  return spans;
}

/** The other players in turn order after me, then me last (a spectator sees everybody in seat order). */
export function orderPlayers(players, meId) {
  const list = Array.isArray(players) ? players : [];
  const at = list.findIndex((p) => p.id === meId);
  if (at < 0) return list.slice(0, 6);
  const after = [...list.slice(at + 1), ...list.slice(0, at)];
  return [...after, list[at]].slice(0, 6);
}

/** "₹8,20,000" shrink hint: how many characters the cash text has (CSS divides the cell width by it). */
export const cashChars = (cash) => formatINR(Number(cash) || 0).length;

/* ------------------------------------------------------------------ the board centre */

const fits = (text, max = 44) => (typeof text === 'string' && text.length > 0 && text.length <= max ? text : null);

/** Who a bubble is about: its player, else the newest log line's, else whose turn it is. */
function whoOf(session, id) {
  const p = playersOf(session).find((x) => String(x.id) === String(id));
  const isMe = String(id) === String(session?.me);
  return { id, isMe, name: isMe ? 'You' : p?.name || 'Someone', first: isMe ? 'You' : p?.name || 'Someone' };
}

function activeId(session) {
  const d = stateOf(session);
  return d.players?.[d.turn]?.id ?? null;
}

/**
 * The caption an engine event gets in the centre ("You bought", "Sana bought", "Paid ₹34,000 rent to Sana", ...).
 * -> { key, text, tone, tile, who } | null when the bubble has nothing short and calm to say.
 */
export function captionFromBubble(session) {
  const b = session?.bubble;
  if (!b) return null;
  const d = stateOf(session);
  const speakerId = bubbleSpeaker(session) ?? activeId(session);
  const who = whoOf(session, speakerId);
  const make = (text, tone = b.tone || 'info', tile = Number.isInteger(b.tile) ? b.tile : null, whoId = speakerId) => ({
    key: `b${b.id}`, text, tone, tile, who: whoId,
  });
  switch (b.type) {
    case 'own': {
      const ownerId = d.owners?.[b.tile] ?? speakerId;
      const w = whoOf(session, ownerId);
      if (b.reason === 'buy') return make(`${w.name} bought`, 'good', b.tile, ownerId);
      if (b.reason === 'auction') return make(`${w.name} won the auction`, 'good', b.tile, ownerId);
      return null;
    }
    case 'level': {
      const ownerId = d.owners?.[b.tile] ?? speakerId;
      const w = whoOf(session, ownerId);
      if (b.reason === 'upgrade') return make(`${w.name} upgraded`, 'good', b.tile, ownerId);
      if (b.reason === 'sell') return make(`${w.name} sold a building`, 'warn', b.tile, ownerId);
      return null;
    }
    case 'cash': {
      const c = session.lastCash || d.lastCash;
      if (!c || !c.delta) return null;
      const amount = formatINR(Math.abs(c.delta));
      const payer = whoOf(session, c.player);
      if (c.reason === 'rent') {
        const stage = Number.isInteger(session.stageTile) ? session.stageTile : null;
        const ownerId = stage != null ? d.owners?.[stage] : null;
        const turnId = activeId(session);
        const payerId = c.delta < 0 ? c.player : turnId;
        const p = whoOf(session, payerId);
        const o = ownerId != null ? whoOf(session, ownerId) : null;
        const head = p.isMe ? `Paid ${amount} rent` : `${p.name} paid ${amount} rent`;
        return make(o && o.id !== payerId ? `${head} to ${o.name}` : head, p.isMe ? 'bad' : 'info', stage, payerId);
      }
      if (c.reason === 'salary') return make(`${payer.name} collected ${amount}`, 'good', null, c.player);
      const gain = c.delta > 0;
      const noun = { fare: ' for the ride', traffic: ' fine', tax: ' in charges', buy: '', upgrade: '', auction: '' }[c.reason] ?? '';
      const text = gain ? `${payer.name} got ${amount}` : `${payer.isMe ? 'Paid' : `${payer.name} paid`} ${amount}${noun}`;
      return make(text, gain ? 'good' : 'bad', null, c.player);
    }
    case 'card': return make(`${who.name} drew a card`, 'info', null);
    case 'traffic': {
      const p = d.players?.find((x) => String(x.id) === String(speakerId));
      if (p?.stuck) return make(who.isMe ? 'Stuck in traffic' : `${who.name} is stuck in traffic`, 'bad', null);
      return make(who.isMe ? 'Back on the road' : `${who.name} is back on the road`, 'good', null);
    }
    case 'chai': return make(fits(b.text) || `${who.name} had a chai`, 'good', null);
    case 'ride': return make(`${who.name} took a ride`, 'good');
    case 'dice': {
      const n = (d.dice || [])[0];
      return n ? make(`${who.name} rolled ${n}`, 'info', null) : null;
    }
    case 'land': {
      const tile = TILES[b.tile];
      return tile ? make(`${who.name} landed on ${tile.short || tile.name}`, 'info', b.tile) : null;
    }
    case 'city_event': return make(fits(b.text, 40) ? `City event: ${b.text}` : 'A city event!', 'cheer', null);
    case 'set_complete': return make(`${who.name} completed a collection`, 'cheer', null);
    case 'turn':
    case 'win':
    case 'trade_offer':
    case 'trade_done':
    case 'trade_rejected':
      return null;
    default: {
      const text = fits(b.text);
      return text ? make(text, b.tone || 'info', Number.isInteger(b.tile) ? b.tile : null) : null;
    }
  }
}

/** The status line when no event caption is on: "Your turn — roll!", "Sana is playing…", ... (ControlPanel's statusLine). */
export function captionFromStatus(session, spec) {
  const s = statusLine(session, spec);
  const pend = session?.view?.pending;
  const tile = (spec?.kind === 'buy' || spec?.kind === 'skip') && pend?.type === 'buy' && Number.isInteger(pend.tile) ? pend.tile : null;
  return { key: `s:${s.text}`, text: s.text, tone: s.tone, tile, who: activeId(session) };
}

/** The caption to show: a fresh event caption while `fresh`, else the status line. */
export function captionFor(session, spec, { fresh = true } = {}) {
  return (fresh ? captionFromBubble(session) : null) || captionFromStatus(session, spec);
}

/**
 * The tile chip under the caption: { id, name, amount, amountLabel, color, ink, owner: { color, piece, name } | null }.
 * `amount` = rent when the tile has an owner (at its level), else the price; null for tiles without either.
 */
export function chipFor(session, tileId) {
  const tile = Number.isInteger(tileId) ? TILES[tileId] : null;
  if (!tile) return null;
  const d = stateOf(session);
  const ownerId = tile.type === 'property' ? d.owners?.[tile.id] : null;
  const owner = ownerId != null ? playersOf(session).find((p) => p.id === ownerId) : null;
  const { color, ink } = tileAccent(tile);
  let amount = null;
  let amountLabel = '';
  if (tile.type === 'property') {
    if (owner) {
      const lvl = Math.max(0, Math.min(MAX_LEVEL, d.levels?.[tile.id] || 0));
      amount = rentLadder(tile)[lvl] ?? 0;
      amountLabel = `rent ${formatINR(amount)}`;
    } else {
      amount = tile.price ?? 0;
      amountLabel = `for sale ${formatINR(amount)}`;
    }
  }
  return {
    id: tile.id,
    name: tile.name,
    short: tile.short || tile.name,
    amount,
    amountText: amount == null ? '' : compactINR(amount),
    amountLabel,
    color,
    ink,
    owner: owner ? { id: owner.id, color: owner.color, piece: owner.piece || 'pearl', name: owner.name } : null,
  };
}

/* ------------------------------------------------------------------ the action row */

const SOUND = { RIDE: 'ride', USE_CHAI: 'chai', PAY_TRAFFIC: 'pay' };
export const soundOf = (action) => SOUND[action?.type] || 'click';

/**
 * The primary button in plain words. -> { text, aria, sub, disabled, tone, key, kind }
 *   ROLL / ROLL AGAIN / BUY ₹70,000 / PASS / END TURN / USE CHAI / PAY ₹25,000 / WAIT IT OUT; waiting states are a calm,
 *   disabled "Waiting for Sana…" (or the spec's own line: "Settle your debt", "Auction in progress…", ...).
 */
export function primaryFor(spec) {
  const p = spec?.primary;
  const kind = spec?.kind || 'status';
  if (p) {
    let text = String(p.label || '').trim();
    let aria = p.sub ? `${text}. ${p.sub}` : text;
    switch (p.key) {
      case 'buy': text = `Buy ${p.amount || ''}`.trim(); aria = `Buy for ${p.amount}`; break;
      case 'skip': text = 'Pass'; aria = `${p.label}. ${p.sub || ''}`.trim(); break;
      case 'pay': text = p.label; break;
      default: break;
    }
    return { text: text.toUpperCase(), aria, sub: p.sub || '', disabled: false, tone: p.tone || 'gold', key: p.key, kind };
  }
  if (kind === 'busy') return { text: '', aria: 'Please wait', sub: '', disabled: true, tone: 'wait', key: 'busy', kind };
  const label = String(spec?.label || '').trim();
  const text = spec?.waitFor && label ? `${label}…` : label;
  return { text, aria: spec?.sr || text, sub: spec?.sub || '', disabled: true, tone: 'wait', key: kind === 'out' ? 'out' : 'wait', kind, waitFor: spec?.waitFor || null };
}

/** A secondary action as a small pill: { key, text, aria, action, icon }. */
export function pillFor(sec, session) {
  const o = session?.options || {};
  let text = String(sec.label || '');
  let icon = sec.icon || null;
  switch (sec.key) {
    case 'skip': text = 'Pass'; icon = null; break;
    case 'ride': {
      const fare = o.ride?.fare;
      text = fare != null ? `Ride ${formatINR(fare)}` : 'Ride';
      icon = 'swap';
      break;
    }
    case 'end': text = 'End turn'; icon = 'check'; break;
    default: break;
  }
  const aria = sec.sub ? `${sec.label}. ${sec.sub}` : sec.label;
  return { key: sec.key, text, aria, action: sec.action, icon };
}

/* ------------------------------------------------------------------ the buy popup */

/**
 * Everything the buy popup prints for `tile` (a district up for sale to me).
 * state = { cash, auction: boolean (passing sends it to a sealed auction), canBuy, price }.
 */
export function buyCardData(tile, { cash = 0, price = null, auction = true, canBuy = null } = {}) {
  if (!tile) return null;
  const coll = collectionOf(tile);
  const { color } = tileAccent(tile);
  const tones = bandTones(color);
  const cost = price ?? tile.price ?? 0;
  const afford = canBuy == null ? cash >= cost : !!canBuy;
  const ladder = rentLadder(tile);
  return {
    id: tile.id,
    name: tile.name,
    collection: coll?.name || 'District',
    theme: coll?.theme,
    group: tile.group,
    color,
    tones,
    price: cost,
    rent: ladder[0] ?? 0,
    mortgage: mortgageOf(tile),
    unmortgage: unmortgageOf(tile),
    levels: ladder.map((rent, level) => ({ level, rent, name: levelNameOf(tile, level) })),
    upgradeCost: upgradeCostOf(tile),
    auction,
    canBuy: afford,
    short: afford ? 0 : Math.max(0, cost - cash),
    passNote: auction ? 'Pass and it goes to a sealed auction' : 'Pass and the district stays with the city',
    reason: afford ? '' : `Need ${formatINR(Math.max(0, cost - cash))} more`,
  };
}

/* ------------------------------------------------------------------ board tile faces */

const cache = new Map();

/**
 * Flat face of a district tile: the collection colour as the body, a LIGHTER band across the top for the price, and the
 * ink that reads on both at AA (4.5:1). The band is the lightest shade that still keeps that contrast with the ink.
 */
export function faceTones(color) {
  const hit = cache.get(color);
  if (hit) return hit;
  const t = bandTones(color);
  const body = t.from;
  let band = body;
  for (let k = 0.04; k <= 0.3; k += 0.02) {
    const next = mixHex(body, '#ffffff', k);
    if (contrastRatio(next, t.ink) < 4.5) break;
    band = next;
  }
  const out = { body, band, ink: t.ink };
  cache.set(color, out);
  return out;
}

/** The printed name of a tile in capitals: { lines, chars } (chars = the longest line, drives the font size). */
export function faceName(tile) {
  const lines = labelLines(tile).map((l) => l.toUpperCase());
  return { lines, chars: lines.reduce((m, l) => Math.max(m, l.length), 1) };
}

/** 'prop' (district) | 'transport' | 'card' | 'corner' (START, Traffic Jam, Chai Adda, Municipal, Bazaar Auction). */
export function faceKind(tile) {
  if (tile?.type === 'property') return 'prop';
  if (tile?.type === 'transport') return 'transport';
  if (tile?.type === 'card') return 'card';
  return 'corner';
}

/** 'auto' | 'metro' | 'mmts' for a transport stop (Tile.jsx has the same rule; copied so the model stays import-light). */
export function stopKind(tile) {
  const k = tile?.mode || tile?.ride || tile?.art;
  if (k === 'auto' || k === 'metro' || k === 'mmts') return k;
  const n = String(tile?.name || '').toLowerCase();
  if (n.includes('auto')) return 'auto';
  if (n.includes('metro')) return 'metro';
  return 'mmts';
}

const FACE_WORDS = {
  start: 'START', traffic: 'TRAFFIC', chai: 'CHAI ADDA', municipal: 'MUNICIPAL', auction: 'AUCTION',
};

/** The capitals printed on a non-district tile: the pill under a corner icon, the small label on a stop or a card. */
export function faceLabel(tile) {
  if (!tile) return '';
  if (tile.type === 'card') return tile.deck === 'drama' ? 'DRAMA' : 'LUCK';
  if (tile.type === 'transport') return stopKind(tile).toUpperCase();
  return FACE_WORDS[tile.type] || String(tile.short || tile.name || '').toUpperCase();
}

/** The two actions of a purchase decision from the shared spec: { buy, skip } (null where the spec does not offer one). */
export function buyActions(spec) {
  if (spec?.kind === 'buy') {
    return { buy: spec.primary?.action || null, skip: (spec.secondaries || []).find((s) => s.key === 'skip')?.action || null };
  }
  if (spec?.kind === 'skip') return { buy: null, skip: spec.primary?.action || null };
  return { buy: null, skip: null };
}
