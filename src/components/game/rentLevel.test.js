// The host rule "rent level" (cfg.rentPercent): every rent the UI prints is round(base x percent / 100), exactly like the engine.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGame, previewRent } from '@shared/index.js';
import { TILES } from '@shared/board.js';
import Tile from './Tile.jsx';
import { previewRentSafe, rentLadder, rentPercentOf, scaleRent } from './ui/helpers.js';

const PLAYERS = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Ravi' }];
const game = (rentPercent) => createGame({ players: PLAYERS, seed: 2, settings: rentPercent === undefined ? {} : { rentPercent } });
const districts = TILES.filter((t) => t.type === 'property');

describe('rent level helpers', () => {
  it('rentPercentOf: the table setting, 100 for a game without it', () => {
    expect(rentPercentOf({ rentPercent: 150 })).toBe(150);
    expect(rentPercentOf({})).toBe(100);
    expect(rentPercentOf(null)).toBe(100);
    expect(rentPercentOf({ rentPercent: 'x' })).toBe(100);
    expect(rentPercentOf({ rentPercent: 0 })).toBe(100);
  });

  it('scaleRent rounds like the engine', () => {
    expect(scaleRent(6000, { rentPercent: 100 })).toBe(6000);
    expect(scaleRent(6000, {})).toBe(6000);
    expect(scaleRent(6000, { rentPercent: 150 })).toBe(9000);
    expect(scaleRent(6000, { rentPercent: 37 })).toBe(2220);
    expect(scaleRent(1001, { rentPercent: 50 })).toBe(501); // 500.5 rounds up, as Math.round does in the engine
  });

  it('rentLadder(tile, cfg) scales every level; without a cfg it is the printed ladder', () => {
    const tile = districts[0];
    const base = rentLadder(tile);
    expect(rentLadder(tile, {})).toEqual(base);
    expect(rentLadder(tile, { rentPercent: 100 })).toEqual(base);
    expect(rentLadder(tile, { rentPercent: 200 })).toEqual(base.map((r) => r * 2));
    expect(rentLadder(tile, { rentPercent: 37 })).toEqual(base.map((r) => Math.round((r * 37) / 100)));
  });

  it('every district at every level and several rent levels matches the engine\'s own preview', () => {
    for (const pct of [10, 37, 75, 100, 150, 200, 500]) {
      const s = game(pct);
      for (const tile of districts.slice(0, 12)) {
        s.owners[tile.id] = 'a';
        const ladder = rentLadder(tile, s.cfg);
        for (let level = 0; level < ladder.length; level++) {
          s.levels[tile.id] = level;
          expect(previewRent(s, tile.id), `${tile.name} L${level} @${pct}%`).toBe(ladder[level]);
          expect(previewRentSafe(s, tile.id), `${tile.name} L${level} @${pct}% (safe)`).toBe(ladder[level]);
        }
        s.owners[tile.id] = null;
        s.levels[tile.id] = 0;
      }
    }
  });
});

describe('the board prints the rent at the table\'s rent level', () => {
  const tile = districts[0];
  const price = (pct) => renderToStaticMarkup(h(Tile, {
    tile, ownerColor: '#ff4d6d', ownerName: 'Ravi', ownerId: 'b', level: 1, rentPct: pct, onSelect() {},
  }));

  it('a district owned at level 2 shows (and announces) the scaled rent', () => {
    const base = rentLadder(tile)[1];
    expect(price(100)).toContain(`rent ₹${base.toLocaleString('en-IN')}`);
    expect(price(200)).toContain(`rent ₹${(base * 2).toLocaleString('en-IN')}`);
    expect(price(undefined)).toContain(`rent ₹${base.toLocaleString('en-IN')}`); // the default is the printed rent
  });
});
