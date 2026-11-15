// Pure helpers for the board's desktop extras: the hover / focus tooltip card, where it sits, and what a
// building site does when a level changes. No React here so every rule is unit-testable.

import * as B from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import { cornerOf, sideOf, tileCenter } from '../fx/geometry.js';

const { GROUPS, MAX_LEVEL } = B;

/** 'up' when a level was added, 'down' when one was sold, else null. */
export function siteEvent(prev, next) {
  const a = Number(prev) || 0;
  const b = Number(next) || 0;
  if (b > a) return 'up';
  if (b < a) return 'down';
  return null;
}

/** Short plain-words caption for a site event. */
export function siteCaption(kind, level) {
  if (kind === 'up') return level >= MAX_LEVEL ? 'Maxed out' : 'Level up';
  if (kind === 'down') return 'Sold back';
  if (kind === 'new') return 'Opened';
  return '';
}

/** Which way the tooltip opens so it never sits on its own tile: toward the middle of the board. */
export function tipPlacement(id) {
  const corner = cornerOf(id);
  if (corner === 'bl' || corner === 'br') return 'above';
  if (corner === 'tl' || corner === 'tr') return 'below';
  switch (sideOf(id)) {
    case 'bottom': return 'above';
    case 'top': return 'below';
    case 'left': return 'right';
    default: return 'left';
  }
}

/** Anchor of the tooltip as fractions (0..1) of the ring box. */
export const tipAnchor = (id) => tileCenter(id);

const KIND_LABEL = {
  start: 'Starting point',
  transport: 'Transit stop',
  card: 'Card square',
  traffic: 'Corner',
  chai: 'Corner',
  municipal: 'Corner',
  auction: 'Auction house',
};
const KIND_COLOR = {
  start: '#17995b',
  transport: '#2f7fd8',
  card: '#d9811a',
  traffic: '#f59e0b',
  chai: '#b5512b',
  municipal: '#34548a',
  auction: '#b0384a',
};

function rentAt(tile, level, rentPct) {
  let table = [];
  try {
    table = typeof B.rentTable === 'function' ? B.rentTable(tile) : [];
  } catch {
    table = [];
  }
  const v = Array.isArray(table) && table.length ? table[Math.max(0, Math.min(table.length - 1, level))] || 0 : B.rentFor(tile, level) || 0;
  return Math.round((v * (Number(rentPct) > 0 ? Number(rentPct) : 100)) / 100);
}

/**
 * What the tooltip card says about a tile.
 *   { id, title, kicker, color, status, tone, rows: [{ label, value }], ladder: [{ name, rent, current }] | null, foot }
 * `info` = { owner: { name, color, piece } | null, level, mortgaged, setFull, rentPct, salary, stuck }.
 */
export function tipModel(tile, info = {}) {
  if (!tile) return null;
  const { owner = null, level = 0, mortgaged = false, setFull = false, rentPct = 100, salary = 200000, stuck = 0, event = null } = info;
  const lvl = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  const group = tile.group ? GROUPS[tile.group] : null;
  const out = {
    id: tile.id,
    title: tile.name,
    kicker: group ? group.name : KIND_LABEL[tile.type] || '',
    color: group ? group.color : KIND_COLOR[tile.type] || '#8a7a66',
    status: '',
    tone: 'plain',
    rows: [],
    ladder: null,
    foot: tile.lore || '',
  };

  if (tile.type === 'property') {
    const names = group && Array.isArray(group.levelNames) ? group.levelNames : B.LEVEL_NAMES;
    out.ladder = [0, 1, 2].slice(0, MAX_LEVEL + 1).map((l) => ({ name: names[l] || `Level ${l}`, rent: rentAt(tile, l, rentPct), current: !!owner && l === lvl }));
    out.rows.push({ label: 'Price', value: formatINR(tile.price) });
    if (owner) {
      out.rows.push({ label: 'Owner', value: owner.name || 'A player' });
      if (mortgaged) {
        out.rows.push({ label: 'Rent', value: 'None, mortgaged' });
        out.status = 'Mortgaged';
        out.tone = 'warn';
      } else {
        out.rows.push({ label: 'Rent', value: formatINR(rentAt(tile, lvl, rentPct)) });
        out.status = setFull ? 'Full collection' : `${names[lvl] || `Level ${lvl}`}`;
        out.tone = setFull ? 'gold' : 'owned';
      }
      if (!mortgaged && setFull && lvl === 0) out.rows.push({ label: 'Set bonus', value: 'Rent x1.5' });
    } else {
      out.rows.push({ label: 'Owner', value: 'Nobody yet' });
      out.status = 'For sale';
      out.tone = 'sale';
    }
    if (event && event.text) out.rows.push({ label: 'This round', value: event.text });
    return out;
  }
  if (tile.type === 'transport') {
    if (tile.fare != null) out.rows.push({ label: 'Ride fare', value: formatINR(tile.fare) });
    out.rows.push({ label: 'Takes you', value: 'To the next stop' });
    out.status = 'Landing here: ride on if you like';
    return out;
  }
  if (tile.type === 'start') {
    out.rows.push({ label: 'Pass or land', value: `Collect ${formatINR(salary)}` });
    out.status = 'Every lap pays';
    out.tone = 'gold';
    return out;
  }
  if (tile.type === 'card') {
    out.rows.push({ label: 'Deck', value: tile.deck === 'drama' ? 'City Drama' : 'Nawabi Luck' });
    out.status = 'Draw a card';
    return out;
  }
  if (tile.type === 'traffic') {
    out.rows.push({ label: 'Stuck here', value: stuck > 0 ? `${stuck} now` : 'Nobody' });
    out.status = 'You get stuck';
    out.tone = 'warn';
    return out;
  }
  if (tile.type === 'chai') {
    out.status = 'Collect a chai token';
    return out;
  }
  if (tile.type === 'municipal') {
    out.rows.push({ label: 'Pay', value: `${compactINR(B.municipalFor(0))} + ${compactINR(B.MUNICIPAL_PER_LEVEL)} per level` });
    out.status = 'Charges due';
    out.tone = 'warn';
    return out;
  }
  if (tile.type === 'auction') {
    out.status = 'A property is auctioned';
    return out;
  }
  return out;
}
