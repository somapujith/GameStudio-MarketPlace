import { describe, it, expect } from 'vitest';
import {
  BOARD_SIZE, GRID, START_TILE, TRAFFIC_TILE, CHAI_TILE, MUNICIPAL_TILE, AUCTION_TILE, TRANSPORT_TILES, CORNER_TILES,
  TILES, GROUPS, GROUP_TILES, TILE_TYPES, MAX_LEVEL, PIECES, isBuyable, rentTable, rentFor, upgradeCost, sellRefund,
  mortgageValue, unmortgageCost, levelName, nextTransport, tilePosition, tileSide, municipalFor, auctionMinBid,
  PRICE_UNIT, START_CASH, QUICK_START_CASH, MUNICIPAL_PER_LEVEL,
} from './board.js';
import { LUCK_CARDS, DRAMA_CARDS } from './cards.js';
import { CITY_EVENTS, RUSH_FLAVOUR, EVENT_EVERY } from './events.js';

describe('board integrity', () => {
  it('has 36 tiles with ids 0-35 in order, on a 10x10 ring', () => {
    expect(BOARD_SIZE).toBe(36);
    expect(GRID).toBe(10);
    expect(TILES).toHaveLength(36);
    TILES.forEach((t, i) => expect(t.id).toBe(i));
  });

  it('24 districts in 8 collections of 3, priced 60,000 - 4,00,000 in ascending order', () => {
    const districts = TILES.filter(isBuyable);
    expect(districts).toHaveLength(24);
    expect(Object.keys(GROUPS)).toHaveLength(8);
    for (const [g, tiles] of Object.entries(GROUP_TILES)) {
      expect(tiles, g).toHaveLength(3);
      expect(GROUPS[g].tiles).toEqual(tiles);
      expect(GROUPS[g].levelNames).toHaveLength(MAX_LEVEL + 1);
      expect(GROUPS[g].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['bazaar', 'food', 'transit', 'venue', 'tech']).toContain(GROUPS[g].theme);
    }
    const prices = districts.map((t) => t.price);
    expect(prices[0]).toBe(60000);
    expect(prices.at(-1)).toBe(400000);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('corners and specials sit where the contract says', () => {
    expect([START_TILE, TRAFFIC_TILE, CHAI_TILE, MUNICIPAL_TILE]).toEqual([0, 9, 18, 27]);
    expect(CORNER_TILES).toEqual([0, 9, 18, 27]);
    expect(TILES[0].type).toBe('start');
    expect(TILES[9].type).toBe('traffic');
    expect(TILES[18].type).toBe('chai');
    expect(TILES[27].type).toBe('municipal');
    expect(TILES[AUCTION_TILE]).toMatchObject({ id: 32, type: 'auction' });
    expect(TRANSPORT_TILES).toEqual([5, 14, 23]);
    expect(TRANSPORT_TILES.map((t) => TILES[t].fare)).toEqual([25000, 35000, 45000]);
    expect([2, 21].map((t) => TILES[t].deck)).toEqual(['luck', 'luck']);
    expect([12, 30].map((t) => TILES[t].deck)).toEqual(['drama', 'drama']);
    expect(TILES.filter((t) => t.corner).map((t) => t.id)).toEqual([0, 9, 18, 27]);
    for (const t of TILES) expect(TILE_TYPES).toContain(t.type);
  });

  it('matches the concept table (names, groups, prices)', () => {
    const want = {
      1: ['Sultan Bazaar', 'bazaar', 60000], 7: ['Charminar Precinct', 'oldcity', 110000], 13: ['Tolichowki', 'everyday', 160000],
      17: ['Paradise Circle', 'twin', 200000], 20: ['Tank Bund', 'lake', 230000], 26: ['Jubilee Hills', 'luxury', 280000],
      31: ['HITEC City', 'cyber', 340000], 35: ['Financial District', 'newcity', 400000],
    };
    for (const [id, [name, group, price]] of Object.entries(want)) expect(TILES[id]).toMatchObject({ name, group, price });
  });

  it('every tile has a name, short name and a one-line lore', () => {
    for (const t of TILES) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.short, t.id).toBeTruthy();
      expect(t.short.length, t.name).toBeLessThanOrEqual(14);
      expect(typeof t.lore).toBe('string');
      expect(t.lore.length, t.name).toBeGreaterThan(10);
      expect(t.lore).not.toMatch(/\n/);
    }
  });
});

describe('economy helpers', () => {
  it('rent table = base 10%, x2.7, x4.4 rounded to thousands (HITEC 34,000 / 92,000 / 1,50,000)', () => {
    expect(rentTable(TILES[31])).toEqual([34000, 92000, 150000]);
    expect(rentTable(TILES[1])).toEqual([6000, 16000, 26000]);
    expect(rentTable(TILES[35])).toEqual([40000, 108000, 176000]);
    expect(rentTable(TILES[5])).toEqual([]);
  });

  it('the full-set bonus is 1.5x on level 0 only', () => {
    expect(rentFor(TILES[31], 0, true)).toBe(51000);
    expect(rentFor(TILES[31], 0, false)).toBe(34000);
    expect(rentFor(TILES[31], 1, true)).toBe(92000);
    expect(rentFor(TILES[31], 2, true)).toBe(150000);
    expect(rentFor(TILES[31], 9)).toBe(150000); // clamped
    expect(rentFor(TILES[9], 0)).toBe(0);
  });

  it('upgrade = 40% of the price (24,000 - 1,60,000); selling refunds half; mortgage 50%, lifting +10%', () => {
    const costs = TILES.filter(isBuyable).map(upgradeCost);
    expect(Math.min(...costs)).toBe(24000);
    expect(Math.max(...costs)).toBe(160000);
    expect(upgradeCost(TILES[31])).toBe(136000);
    expect(sellRefund(TILES[31])).toBe(68000);
    expect(mortgageValue(TILES[31])).toBe(170000);
    expect(unmortgageCost(TILES[31])).toBe(187000);
    expect(upgradeCost(TILES[0])).toBe(0);
    expect(mortgageValue(TILES[5])).toBe(0);
  });

  // The price : upgrade : rent relationship, for every district (docs/GAME_RULES.md 5, "Economy of an upgrade"). Upgrades need
  // the whole collection, so the rent an upgrade REPLACES is the level-0 rent WITH the 1.5x set bonus.
  describe('upgrade economy (price : upgrade cost : rent)', () => {
    const districts = TILES.filter(isBuyable);
    const row = (t) => {
      const [r0, r1, r2] = rentTable(t);
      const set0 = rentFor(t, 0, true);
      const cost = upgradeCost(t);
      return { t, r0, r1, r2, set0, cost, pay1: cost / (r1 - set0), pay2: cost / (r2 - r1) };
    };

    it('rent strictly increases with every level, also on the cheapest district and with the set bonus', () => {
      for (const t of districts) {
        const { r0, r1, r2, set0 } = row(t);
        expect(r1, t.name).toBeGreaterThan(r0);
        expect(r2, t.name).toBeGreaterThan(r1);
        expect(r1, `${t.name}: level 1 must beat the set-bonus level 0`).toBeGreaterThan(set0);
        for (const r of [r0, r1, r2]) expect(r % PRICE_UNIT, `${t.name} rent ${r}`).toBe(0); // whole thousands
      }
    });

    it('every upgrade pays for itself in a few opponent landings: level 1 in 3-5, level 2 in 2-4', () => {
      for (const t of districts) {
        const { pay1, pay2 } = row(t);
        expect(pay1, `${t.name} level 1`).toBeGreaterThanOrEqual(3);
        expect(pay1, `${t.name} level 1`).toBeLessThanOrEqual(5);
        expect(pay2, `${t.name} level 2`).toBeGreaterThanOrEqual(2);
        expect(pay2, `${t.name} level 2`).toBeLessThanOrEqual(4);
      }
    });

    it('the payback is the same for the cheap and the dear districts (one ratio set for all 24)', () => {
      const p1 = districts.map((t) => row(t).pay1);
      const p2 = districts.map((t) => row(t).pay2);
      expect(Math.max(...p1) - Math.min(...p1)).toBeLessThan(0.6);
      expect(Math.max(...p2) - Math.min(...p2)).toBeLessThan(0.6);
    });

    it('a fully upgraded district clearly out-earns a bare one, without a runaway rent', () => {
      for (const t of districts) {
        const { r0, r2, set0 } = row(t);
        expect(r2, t.name).toBeGreaterThanOrEqual(4 * r0); // 4x a bare district (2.9x a bare full-set one)
        expect(r2, t.name).toBeGreaterThan(2.5 * set0);
        expect(r2, t.name).toBeLessThanOrEqual(0.5 * t.price); // never more than half its price in one landing
        expect(r2, t.name).toBeLessThanOrEqual(0.15 * Math.min(START_CASH, QUICK_START_CASH)); // one rent is at most 15% of a fresh player's cash
      }
    });

    it('an upgrade is a whole number of thousands, cheaper than the district itself, and the Municipal levy per level stays a minor slice of it', () => {
      for (const t of districts) {
        expect(upgradeCost(t), t.name).toBe(Math.round(t.price * 0.4));
        expect(upgradeCost(t) % PRICE_UNIT, t.name).toBe(0);
        expect(upgradeCost(t), t.name).toBeLessThan(t.price);
        expect(MUNICIPAL_PER_LEVEL / upgradeCost(t), t.name).toBeLessThanOrEqual(0.5);
      }
    });
  });

  it('level names come from the collection', () => {
    expect(levelName(TILES[31], 0)).toBe('Startup Office');
    expect(levelName(TILES[31], 2)).toBe('Tech Campus');
    expect(levelName(TILES[6], 1)).toBe('Biryani House');
    expect(levelName(TILES[1], 2)).toBe('Trading Hub');
    expect(levelName(TILES[0], 0)).toBe('Business');
  });

  it('nextTransport loops 5 -> 14 -> 23 -> 5', () => {
    expect(nextTransport(5)).toBe(14);
    expect(nextTransport(14)).toBe(23);
    expect(nextTransport(23)).toBe(5);
    expect(nextTransport(0)).toBe(5);
    expect(nextTransport(30)).toBe(5);
    expect(nextTransport(10)).toBe(14);
  });

  it('municipal charges and auction minimum bids', () => {
    expect(municipalFor(0)).toBe(40000);
    expect(municipalFor(3)).toBe(70000);
    expect(auctionMinBid(31, 'bazaar')).toBe(170000);
    expect(auctionMinBid(31, 'decline')).toBe(34000);
    expect(auctionMinBid(1, 'unaffordable')).toBe(6000);
  });

  it('pieces', () => {
    expect(PIECES.map((p) => p.id)).toEqual(['pearl', 'auto', 'handi', 'chai', 'bat', 'camera']);
    for (const p of PIECES) expect(p.name).toBeTruthy();
  });
});

describe('tilePosition (10x10 ring, START bottom-left, clockwise)', () => {
  it('puts every tile on a unique edge cell', () => {
    const seen = new Set();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const { col, row } = tilePosition(i);
      expect(col >= 0 && col < GRID && row >= 0 && row < GRID).toBe(true);
      expect(col === 0 || row === 0 || col === GRID - 1 || row === GRID - 1, `tile ${i}`).toBe(true);
      const key = `${col},${row}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(36);
  });

  it('corners: START bottom-left, Traffic top-left, Chai top-right, Municipal bottom-right', () => {
    expect(tilePosition(0)).toEqual({ col: 0, row: 9 });
    expect(tilePosition(9)).toEqual({ col: 0, row: 0 });
    expect(tilePosition(18)).toEqual({ col: 9, row: 0 });
    expect(tilePosition(27)).toEqual({ col: 9, row: 9 });
    expect(tilePosition(1)).toEqual({ col: 0, row: 8 }); // up the left side
    expect(tilePosition(10)).toEqual({ col: 1, row: 0 }); // right along the top
    expect(tilePosition(19)).toEqual({ col: 9, row: 1 }); // down the right
    expect(tilePosition(35)).toEqual({ col: 1, row: 9 }); // left along the bottom, next to START
  });

  it('neighbouring tiles are adjacent cells (a closed loop)', () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const a = tilePosition(i);
      const b = tilePosition((i + 1) % BOARD_SIZE);
      expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row), `${i}->${i + 1}`).toBe(1);
    }
  });

  it('tileSide', () => {
    expect([0, 5, 9].map(tileSide)).toEqual(['left', 'left', 'left']);
    expect([10, 18].map(tileSide)).toEqual(['top', 'top']);
    expect([19, 27].map(tileSide)).toEqual(['right', 'right']);
    expect([28, 35].map(tileSide)).toEqual(['bottom', 'bottom']);
  });
});

describe('card decks and city events', () => {
  const both = [...LUCK_CARDS, ...DRAMA_CARDS];
  it('two decks of at least 16 cards with unique ids, a hook, one sentence and one effect', () => {
    expect(LUCK_CARDS.length).toBeGreaterThanOrEqual(16);
    expect(DRAMA_CARDS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(both.map((c) => c.id)).size).toBe(both.length);
    for (const c of both) {
      expect(['good', 'bad', 'neutral']).toContain(c.kind);
      expect(c.title.length).toBeLessThanOrEqual(40);
      expect(c.text.length).toBeLessThanOrEqual(110);
      expect(typeof c.effect.type).toBe('string');
      if (c.effect.type === 'moveTo') expect(TILES[c.effect.tile].type).not.toBe('card');
    }
  });

  it('includes the six concept-doc examples', () => {
    const find = (title) => both.find((c) => c.title === title);
    expect(find('Shaadi ka season!').effect).toEqual({ type: 'cash', amount: -50000 });
    expect(find('Biryani franchise goes viral').effect).toEqual({ type: 'cash', amount: 80000 });
    expect(find('Ameerpet traffic. Baigan!').effect).toEqual({ type: 'stuck' });
    expect(find('Cricket night at Uppal!').effect).toEqual({ type: 'rentBoost', mult: 2 });
    expect(find('The landlord wants an advance').effect).toEqual({ type: 'cash', amount: -35000 });
    expect(find('An investor is impressed!').effect).toEqual({ type: 'cash', amount: 100000 });
    expect(both.some((c) => c.effect.type === 'collectFromAll' && c.effect.amount === 10000)).toBe(true);
    expect(both.some((c) => c.effect.type === 'perLevel' && c.effect.amount === 15000)).toBe(true);
    expect(both.some((c) => c.effect.type === 'chai')).toBe(true);
    expect(both.some((c) => c.effect.type === 'moveTo' && c.effect.tile === 31)).toBe(true);
  });

  it('city events every 3 rounds; rush hour has a flavour for every collection', () => {
    expect(EVENT_EVERY).toBe(3);
    expect(CITY_EVENTS.map((e) => e.id).sort()).toEqual(['biryani_boom', 'festival', 'monsoon', 'rush_hour', 'wedding_season']);
    for (const g of Object.keys(GROUPS)) expect(RUSH_FLAVOUR[g].title).toBeTruthy();
  });
});
