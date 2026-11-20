import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, TILES } from '@shared/board.js';
import { Board } from '../Board.jsx';
import Pawn from '../Pawn.jsx';
import { Tile } from '../Tile.jsx';
import BuildSite from './BuildSite.jsx';
import { TileTipLayer } from './TileTip.jsx';
import { siteCaption, siteEvent, tipAnchor, tipModel, tipPlacement } from './tipModel.js';

const owner = { name: 'Asha', color: '#ff4d6d', piece: 'auto' };
const row = (m, label) => m.rows.find((r) => r.label === label)?.value;

describe('siteEvent / siteCaption', () => {
  it('tells a level added from a level sold, and nothing from no change', () => {
    expect(siteEvent(0, 1)).toBe('up');
    expect(siteEvent(1, 2)).toBe('up');
    expect(siteEvent(2, 1)).toBe('down');
    expect(siteEvent(1, 1)).toBeNull();
    expect(siteEvent(undefined, undefined)).toBeNull();
  });

  it('captions in plain words', () => {
    expect(siteCaption('up', 1)).toBe('Level up');
    expect(siteCaption('up', 2)).toBe('Maxed out');
    expect(siteCaption('down', 0)).toBe('Sold back');
    expect(siteCaption('new', 0)).toBe('Opened');
    expect(siteCaption(null, 0)).toBe('');
  });
});

describe('tipPlacement / tipAnchor', () => {
  it('opens toward the middle of the board and never on its own tile', () => {
    expect(tipPlacement(34)).toBe('above'); // bottom row
    expect(tipPlacement(14)).toBe('below'); // top row
    expect(tipPlacement(3)).toBe('right'); // left column
    expect(tipPlacement(22)).toBe('left'); // right column
    expect(tipPlacement(0)).toBe('above'); // START, bottom-left
    expect(tipPlacement(27)).toBe('above'); // Municipal, bottom-right
    expect(tipPlacement(9)).toBe('below'); // Traffic Jam, top-left
    expect(tipPlacement(18)).toBe('below'); // Chai Adda, top-right
  });

  it('anchors every tile inside the ring', () => {
    for (let id = 0; id < BOARD_SIZE; id++) {
      const { x, y } = tipAnchor(id);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });
});

describe('tipModel', () => {
  it('a district for sale: price, nobody, the whole rent ladder', () => {
    const m = tipModel(TILES[31], {});
    expect(m.title).toBe('HITEC City');
    expect(m.kicker).toBe('Cyberabad');
    expect(m.status).toBe('For sale');
    expect(m.tone).toBe('sale');
    expect(row(m, 'Price')).toBe('₹3,40,000');
    expect(row(m, 'Owner')).toBe('Nobody yet');
    expect(m.ladder.map((l) => l.name)).toEqual(['Startup Office', 'Business Centre', 'Tech Campus']);
    expect(m.ladder.map((l) => l.rent)).toEqual([34000, 92000, 150000]);
    expect(m.ladder.some((l) => l.current)).toBe(false);
    expect(m.foot).toBeTruthy();
  });

  it('an owned district: the owner, the level now and the rent it pays', () => {
    const m = tipModel(TILES[31], { owner, level: 1 });
    expect(row(m, 'Owner')).toBe('Asha');
    expect(row(m, 'Rent')).toBe('₹92,000');
    expect(m.status).toBe('Business Centre');
    expect(m.ladder.map((l) => l.current)).toEqual([false, true, false]);
  });

  it('follows the table rent level', () => {
    expect(row(tipModel(TILES[31], { owner, level: 1, rentPct: 150 }), 'Rent')).toBe('₹1,38,000');
    expect(tipModel(TILES[31], { owner, level: 0, rentPct: 50 }).ladder[0].rent).toBe(17000);
  });

  it('a full collection and a mortgage say so', () => {
    const full = tipModel(TILES[31], { owner, level: 0, setFull: true });
    expect(full.status).toBe('Full collection');
    expect(full.tone).toBe('gold');
    expect(row(full, 'Set bonus')).toBe('Rent x1.5');
    const mort = tipModel(TILES[31], { owner, level: 1, mortgaged: true, setFull: true });
    expect(mort.status).toBe('Mortgaged');
    expect(row(mort, 'Rent')).toBe('None, mortgaged');
  });

  it('adds a live city event as its own row', () => {
    const m = tipModel(TILES[31], { owner, event: { tone: 'rush', text: 'x1.5', note: 'rush hour' } });
    expect(row(m, 'This round')).toBe('x1.5');
  });

  it('describes transit stops, cards, START and the corners', () => {
    expect(row(tipModel(TILES[5], {}), 'Ride fare')).toBe('₹25,000');
    expect(tipModel(TILES[2], {}).rows[0].value).toBe('Nawabi Luck');
    expect(tipModel(TILES[12], {}).rows[0].value).toBe('City Drama');
    expect(row(tipModel(TILES[0], { salary: 200000 }), 'Pass or land')).toBe('Collect ₹2,00,000');
    expect(row(tipModel(TILES[9], { stuck: 2 }), 'Stuck here')).toBe('2 now');
    expect(row(tipModel(TILES[9], {}), 'Stuck here')).toBe('Nobody');
    expect(tipModel(TILES[18], {}).status).toBe('Collect a chai token');
    expect(tipModel(TILES[27], {}).status).toBe('Charges due');
    expect(tipModel(TILES[32], {}).status).toBe('A property is auctioned');
    expect(tipModel(null)).toBeNull();
  });

  it('every tile has a title, a colour and a status or rows', () => {
    for (const t of TILES) {
      const m = tipModel(t, {});
      expect(m.title).toBe(t.name);
      expect(m.color).toMatch(/^#/);
      expect(m.status || m.rows.length).toBeTruthy();
    }
  });
});

describe('BuildSite', () => {
  const site = (props) => renderToString(createElement(BuildSite, { className: 'hb-tile__bldg', ...props }, createElement('svg')));

  it('draws a quiet building on first paint: no scaffold, dust or caption', () => {
    const out = site({ level: 1 });
    expect(out).toContain('hb-site hb-tile__bldg');
    expect(out).toContain('data-lv="1"');
    expect(out).toContain('hb-site__art');
    expect(out).not.toContain('is-rise');
    expect(out).not.toContain('hb-site__fx');
    expect(out).not.toContain('hb-site__tag');
  });

  it('a fresh purchase builds the plot: scaffold, dust and an "Opened" tag', () => {
    const out = site({ level: 0, claim: 1 });
    expect(out).toContain('is-rise');
    expect(out).toContain('hb-site__scaffold');
    expect(out.match(/hb-site__puff /g)).toHaveLength(3);
    expect(out).toContain('Opened');
  });
});

describe('Tile faces', () => {
  const html = (id, props = {}) => renderToString(createElement(Tile, { tile: TILES[id], ...props }));

  it('an owned district prints its rent as a pill and keeps the business and the owner band', () => {
    const out = html(31, { ownerColor: '#ff4d6d', ownerName: 'Asha', ownerId: 'a', ownerPiece: 'auto', level: 2 });
    expect(out).toContain('hb-tile__price is-rent');
    expect(out).toContain('hb-site hb-tile__bldg');
    expect(out).toContain('hb-tile__own');
    expect(html(31)).not.toContain('is-rent');
  });

  it('has no native title (the board card replaces it) and keeps the full aria-label', () => {
    const out = html(31, { ownerColor: '#ff4d6d', ownerName: 'Asha', ownerId: 'a', level: 1 });
    expect(out).not.toContain(' title="');
    expect(out).toContain('aria-label="HITEC City');
  });

  it('plays nothing for a collection that is already complete on first paint', () => {
    const out = html(10, { ownerColor: '#fff', ownerId: 'a', setState: 'full' });
    expect(out).toContain('is-set');
    expect(out).not.toContain('is-set-new');
    expect(out).not.toContain('hb-tile__shine');
  });
});

describe('Pawn extras', () => {
  const pawn = (props) => renderToString(createElement(Pawn, { id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 5, ...props }));

  it('stands the piece on a puck above a contact shadow', () => {
    const out = pawn();
    expect(out).toContain('hb-pawn__puck');
    expect(out).toContain('hb-pawn__shadow');
    expect(out).not.toContain('hb-pawn__ghost'); // nothing moved yet
    expect(out).not.toContain('hb-pawn__dust');
    expect(out).toContain('--gx:0');
  });

  it('gives only the pawn whose turn it is a beacon', () => {
    expect(pawn({ isTurn: true })).toContain('hb-pawn__beacon');
    expect(pawn()).not.toContain('hb-pawn__beacon');
  });
});

describe('Board extras', () => {
  const players = [{ id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 0 }];
  const blank = () => ({ owners: Array(BOARD_SIZE).fill(null), levels: Array(BOARD_SIZE).fill(0), mortgaged: Array(BOARD_SIZE).fill(false) });

  it('mounts the (empty) tile card layer inside the grid and hides it from assistive tech', () => {
    const out = renderToString(createElement(Board, { session: { display: { ...blank(), players, turn: 0, phase: 'roll' } } }));
    expect(out).toContain('class="hb-tipwrap" aria-hidden="true"');
    expect(out).not.toContain('hb-tip__card');
    expect(out.indexOf('hb-tipwrap')).toBeGreaterThan(out.indexOf('class="hb-pawns"'));
  });

  it('renders no card until a tile is hovered', () => {
    expect(renderToString(createElement(TileTipLayer, { players }))).not.toContain('hb-tip__title');
  });

  it('keeps one lantern string node (the twinkle layers are CSS pseudo-elements)', () => {
    const out = renderToString(createElement(Board, { session: { display: { ...blank(), players, turn: 0, phase: 'roll' } } }));
    expect(out.match(/hb-frame__lights/g)).toHaveLength(1);
  });
});
