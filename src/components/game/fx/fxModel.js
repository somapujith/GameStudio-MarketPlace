// Pure model of the board effects (no DOM): which words go with a payment, which legs of a flight show a signed
// amount, which tile effect an event earns, and the governor that keeps the overlay cheap (a cap on what is alive at
// once, and silence while the presenter is catching up). Everything here is unit-tested (fxModel.test.js).

import { GROUP_TILES, TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { DEFAULT_MAP, activeMapId } from '@shared/maps.js';
import { coinTier } from './coins.js';

export const BANK = 'bank';
/** The typographic minus (U+2212): same width as the plus, never confused with a hyphen. */
export const MINUS = '−';

/** The small-caps word that says WHY money moved. */
const REASONS = {
  rent: 'RENT',
  salary: 'SALARY',
  tax: 'TAX',
  traffic: 'FINE',
  card: 'CARD',
  event: 'EVENT',
  fare: 'RIDE',
  trade: 'TRADE',
  buy: 'BOUGHT',
  auction: 'AUCTION',
  upgrade: 'BUILD',
  sell: 'SOLD',
  mortgage: 'MORTGAGE',
  unmortgage: 'UNLOCKED',
  liquidate: 'SOLD OFF',
  chai: 'CHAI',
};

/** 'RENT' / 'SALARY' / ... or '' for a reason without a word. */
export const reasonLabel = (reason) => (reason === 'chai' && activeMapId() !== DEFAULT_MAP ? 'TOKEN' : REASONS[String(reason || '')]) || '';

/** '+₹34,000' / '−₹34,000' (sign = +1 / -1; the amount's own sign is ignored). */
export function signedAmount(amount, sign = 1) {
  const text = formatINR(Math.abs(Number(amount) || 0));
  return `${sign < 0 ? MINUS : '+'}${text}`;
}

/**
 * One flight -> the floating amounts to show. A flight between two players shows a loss on the payer and a gain on
 * the payee; a flight to or from the bank shows only the player's side.
 * -> { label, count, tier, legs: [{ who, sign, when: 'start' | 'end', mine }], involvesMe }
 */
export function flightPlan(flight, me) {
  if (!flight) return { label: '', count: 0, tier: 0, legs: [], involvesMe: false };
  const legs = [];
  if (flight.from !== undefined && flight.from !== null && flight.from !== BANK) {
    legs.push({ who: flight.from, sign: -1, when: 'start', mine: flight.from === me });
  }
  if (flight.to !== undefined && flight.to !== null && flight.to !== BANK) {
    legs.push({ who: flight.to, sign: 1, when: 'end', mine: flight.to === me });
  }
  const t = coinTier(flight.amount);
  return { label: reasonLabel(flight.reason), count: t.count, tier: t.tier, legs, involvesMe: legs.some((l) => l.mine) };
}

/**
 * The tile effect(s) an activity-log entry earns (`entry.ev` is the engine event the presenter described).
 * `ctx.colorOf(playerId)` gives a player's colour, `ctx.owners` the owners at that moment.
 * -> [{ kind, tile?, tiles?, color?, top?, prio }]   kinds: buy sold snatch upgrade lock unlock set
 * Landing ripples come from `display.landing`, rent tolls from flights (see FxLayer).
 */
export function tileEffectsFor(entry, ctx = {}) {
  const ev = entry && entry.ev;
  if (!ev || typeof ev.type !== 'string') return [];
  const color = (id) => (typeof ctx.colorOf === 'function' && id !== undefined && id !== null ? ctx.colorOf(id) || null : null);
  switch (ev.type) {
    case 'own':
      return ev.reason === 'buy' && Number.isInteger(ev.tile) ? [{ kind: 'buy', tile: ev.tile, color: color(ev.owner), prio: 2 }] : [];
    case 'auction_end':
      if (ev.winner === null || ev.winner === undefined || !Number.isInteger(ev.tile)) return [];
      return [{ kind: ev.reason === 'snatch' ? 'snatch' : 'sold', tile: ev.tile, color: color(ev.winner), prio: 2 }];
    case 'snatch_end':
      if (ev.outcome !== 'snatched' || ev.winner === null || ev.winner === undefined || !Number.isInteger(ev.tile)) return [];
      return [{ kind: 'snatch', tile: ev.tile, color: color(ev.winner), prio: 2 }];
    case 'level': {
      if (ev.reason !== 'upgrade' || !Number.isInteger(ev.tile)) return [];
      const owner = ctx.owners ? ctx.owners[ev.tile] : null;
      return [{ kind: 'upgrade', tile: ev.tile, color: color(owner), top: Number(ev.level) >= 2, prio: 2 }];
    }
    case 'mortgage':
      return Number.isInteger(ev.tile) ? [{ kind: 'lock', tile: ev.tile, color: color(ev.player), prio: 1 }] : [];
    case 'unmortgage':
      return Number.isInteger(ev.tile) ? [{ kind: 'unlock', tile: ev.tile, color: color(ev.player), prio: 1 }] : [];
    case 'set_complete': {
      const tiles = (GROUP_TILES[ev.group] || []).slice(0, 6);
      return tiles.length ? [{ kind: 'set', tiles, color: color(ev.player), prio: 3 }] : [];
    }
    default:
      return [];
  }
}

/**
 * Where a floating amount starts for an avatar's box and which way it drifts: up from the avatar, or down from it when
 * there is no room above (pods at the very top of the screen). `stack` = amounts already floating there.
 * -> { y, dir }   dir = -1 up / +1 down
 */
export function amountSpot(rect, stack = 0) {
  if (!rect) return { y: 72, dir: 1 };
  const up = rect.top >= 96;
  const y = up ? rect.top + rect.height * 0.3 : rect.top + rect.height * 0.7;
  const dir = up ? -1 : 1;
  return { y: y + dir * stack * 30, dir };
}

/**
 * The log entries newer than `seen` (a numeric id, or null = first look: nothing is new, only the baseline is taken).
 * Entries with a non-numeric id (the heads-up notes merged into the log) are skipped.
 * -> { fresh: [entry] oldest first, newest: number | null }
 */
export function freshEntries(log, seen) {
  const list = Array.isArray(log) ? log : [];
  const out = [];
  let newest = seen === undefined ? null : seen;
  let top = true;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (!e || typeof e.id !== 'number') continue;
    if (top) {
      if (newest === null || e.id > newest) newest = e.id;
      top = false;
      if (seen === null || seen === undefined) break;
    }
    if (e.id <= seen) break;
    out.push(e);
  }
  return { fresh: out.reverse(), newest };
}

/** The tile a rent flight belongs to, or null (only rent earns the toll sweep). */
export function tollTile(flight) {
  if (!flight || !(flight.reason === 'rent') || !Number.isInteger(flight.tile) || !TILES[flight.tile]) return null;
  return flight.tile;
}

/**
 * Keeps the overlay cheap. `admit({ now, prio })` -> a token (call `token.done()` when the effect ends) or null when
 * the effect should be skipped: too many alive at once, or a burst of effects inside `burstMs` (the presenter
 * catching up after a reconnect plays everything in a blink: nobody can read that). Priority 3 (set complete)
 * always gets through, up to twice the cap.
 */
export function createGovernor({ maxLive = 6, burstMs = 600, burstMax = 4 } = {}) {
  let live = 0;
  let recent = [];
  return {
    admit({ now = Date.now(), prio = 1 } = {}) {
      recent = recent.filter((t) => now - t < burstMs);
      const cap = prio >= 3 ? maxLive * 2 : maxLive;
      if (live >= cap) return null;
      if (prio < 3 && recent.length >= burstMax) return null;
      live += 1;
      recent.push(now);
      let open = true;
      return {
        done() {
          if (!open) return;
          open = false;
          live = Math.max(0, live - 1);
        },
      };
    },
    live: () => live,
  };
}
