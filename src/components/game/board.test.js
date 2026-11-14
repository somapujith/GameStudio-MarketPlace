import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, GRID, GROUPS, TILES, tilePosition } from '@shared/board.js';
import { Board } from './Board.jsx';
import { pawnPlacement } from './Pawn.jsx';
import Pawn from './Pawn.jsx';
import { Tile, eventMark, softName, tileRent, transportKind } from './Tile.jsx';
import { TRACKS, cornerOf, isCorner, sideOf, tileCenter } from './fx/geometry.js';
import { arcPoints, coinCount } from './fx/coins.js';

const SHY = '­';
const CORNER = (1.5 / TRACKS) * 100; // a corner track, in % of the ring
const html = (tile, props = {}) => renderToString(createElement(Tile, { tile: TILES[tile], ...props }));
const tileHtml = (out, id) => out.split('<button').find((chunk) => chunk.includes(`data-tile="${id}"`));
const blank = () => ({ owners: Array(BOARD_SIZE).fill(null), levels: Array(BOARD_SIZE).fill(0), mortgaged: Array(BOARD_SIZE).fill(false) });
const players = [
  { id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 0, cash: 1500000 },
  { id: 'b', name: 'Bala', color: '#3ddc97', piece: 'pearl', pos: 0, cash: 1500000 },
];

describe('the Hustle circuit', () => {
  it('is 36 tiles on a 10x10 ring with the four specials in the corners', () => {
    expect(BOARD_SIZE).toBe(36);
    expect(GRID).toBe(10);
    expect(TILES.filter((t) => isCorner(t.id)).map((t) => [t.id, t.type])).toEqual([[0, 'start'], [9, 'traffic'], [18, 'chai'], [27, 'municipal']]);
    expect([0, 9, 18, 27].map(cornerOf)).toEqual(['bl', 'tl', 'tr', 'br']);
    const cells = new Set(TILES.map((t) => { const { col, row } = tilePosition(t.id); return `${col},${row}`; }));
    expect(cells.size).toBe(BOARD_SIZE);
  });

  it('runs clockwise: up the left, along the top, down the right, back along the bottom', () => {
    expect(sideOf(5)).toBe('left');
    expect(sideOf(14)).toBe('top');
    expect(sideOf(23)).toBe('right');
    expect(sideOf(32)).toBe('bottom');
    const c = (i) => tileCenter(i);
    for (let i = 0; i < 9; i++) expect(c(i + 1).y).toBeLessThan(c(i).y);
    for (let i = 9; i < 18; i++) expect(c(i + 1).x).toBeGreaterThan(c(i).x);
    for (let i = 18; i < 27; i++) expect(c(i + 1).y).toBeGreaterThan(c(i).y);
    for (let i = 27; i < BOARD_SIZE - 1; i++) expect(c(i + 1).x).toBeLessThan(c(i).x);
  });
});

describe('pawn placement', () => {
  it('keeps every pawn of every crowd size inside its own tile', () => {
    for (let pos = 0; pos < BOARD_SIZE; pos++) {
      const { col, row } = tilePosition(pos);
      const lo = (i) => (i === 0 ? 0 : 1.5 + (i - 1)) / TRACKS * 100;
      const hi = (i) => (i === 0 ? 1.5 : i === GRID - 1 ? TRACKS : 1.5 + i) / TRACKS * 100;
      for (let n = 1; n <= 6; n++) {
        for (let slot = 0; slot < n; slot++) {
          const { x, y, d } = pawnPlacement(pos, slot, n);
          expect(x).toBeGreaterThan(lo(col));
          expect(x).toBeLessThan(hi(col));
          expect(y).toBeGreaterThan(lo(row));
          expect(y).toBeLessThan(hi(row));
          expect(d).toBeGreaterThan(0.25);
        }
      }
    }
  });

  it('puts the corners in the corner tracks, START bottom-left', () => {
    const at = (pos) => pawnPlacement(pos, 0, 1);
    expect(at(0).x).toBeLessThan(CORNER);
    expect(at(0).y).toBeGreaterThan(100 - CORNER);
    expect(at(9).x).toBeLessThan(CORNER);
    expect(at(9).y).toBeLessThan(CORNER);
    expect(at(18).x).toBeGreaterThan(100 - CORNER);
    expect(at(18).y).toBeLessThan(CORNER);
    expect(at(27).x).toBeGreaterThan(100 - CORNER);
    expect(at(27).y).toBeGreaterThan(100 - CORNER);
  });

  it('gives each pawn of a crowd its own spot', () => {
    for (const pos of [0, 7, 18, 33]) {
      const spots = Array.from({ length: 6 }, (_, slot) => pawnPlacement(pos, slot, 6)).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      expect(new Set(spots).size).toBe(6);
    }
  });
});

describe('pawns', () => {
  const pawn = (props) => renderToString(createElement(Pawn, { id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 5, ...props }));

  it('moves with a transform (fractions of the ring), never left/top', () => {
    const out = pawn();
    const { x, y } = pawnPlacement(5, 0, 1);
    expect(out).toContain(`--x:${x / 100}`);
    expect(out).toContain(`--y:${y / 100}`);
    expect(out).not.toMatch(/style="[^"]*\b(left|top):/);
    expect(out).toContain('data-fx-pawn="a"');
    expect(out).toContain('is-walk');
  });

  it('draws the piece art tinted by the player colour', () => {
    const out = pawn();
    expect(out).toContain('hb-pawn__piece');
    expect(out).toContain('<svg');
  });

  it('flags rides, card moves, traffic and the current turn', () => {
    expect(pawn({ motion: 'ride' })).toContain('is-ride');
    expect(pawn({ motion: 'teleport' })).toContain('is-teleport');
    const stuck = pawn({ stuck: true });
    expect(stuck).toContain('hb-pawn__stuck');
    expect(stuck).toContain('stuck in traffic');
    expect(pawn({ isTurn: true })).toContain('hb-pawn__marker');
    expect(pawn()).not.toContain('hb-pawn__stuck');
  });

  it('is not drawn when the player was already bankrupt at mount', () => {
    expect(pawn({ bankrupt: true })).toBe('');
  });
});

describe('tiles', () => {
  it('draws a jewel band on the inner edge and the price of an unowned district', () => {
    const out = html(1);
    expect(out).toContain('hb-side--left'); // tile 1 sits on the left column, right after START
    expect(out).toContain('hb-tile__band');
    expect(out).toContain('hb-g--bazaar');
    expect(out).toContain('--g:#c98b4a');
    expect(out).toContain('₹60,000');
    expect(out).toContain('for sale');
    expect(out).toContain('data-fx-tile="1"');
    expect(out).not.toContain('hb-tile__own');
  });

  it('shows the owner band, the owner piece chip, the business and its rent once owned', () => {
    const out = html(31, { ownerColor: '#ff4d6d', ownerName: 'Asha', ownerId: 'a', ownerPiece: 'auto', level: 1 });
    expect(out).toContain('hb-tile__own');
    expect(out).toContain('hb-tile__chip');
    expect(out).toContain('owned by Asha');
    expect(out).toContain('Business Centre');
    expect(out).toContain('hb-tile__bldg');
    expect(out).toContain(`rent ₹65,000`);
    expect(out.match(/<i class="is-on"><\/i>/g)).toHaveLength(1); // one of two level pips lit
    expect(out.match(/<i><\/i>|<i class="is-on"><\/i>/g)).toHaveLength(2);
    expect(html(31, { ownerColor: '#ff4d6d', level: 2 })).toContain('is-max');
  });

  it('rents follow rentTable: HITEC City 34,000 / 65,000 / 1,19,000', () => {
    expect([0, 1, 2].map((l) => tileRent(TILES[31], l))).toEqual([34000, 65000, 119000]);
  });

  it('rings a full collection, never while mortgaged', () => {
    expect(html(10, { ownerColor: '#fff', setState: 'full' })).toContain('is-set');
    expect(html(10, { ownerColor: '#fff', setState: 'none' })).not.toContain('is-set');
    const m = html(10, { ownerColor: '#fff', setState: 'full', mortgaged: true });
    expect(m).not.toContain('is-set');
    expect(m).toContain('is-mortgaged');
    expect(m).toContain('hb-tile__m');
    expect(m).toContain('mortgaged, no rent');
  });

  it('gives transit stops a route band in their mode and the fare', () => {
    expect([5, 14, 23].map((id) => transportKind(TILES[id]))).toEqual(['auto', 'metro', 'mmts']);
    const auto = html(5);
    expect(auto).toContain('hb-mode--auto');
    expect(auto).toContain('hb-route');
    expect(auto).toContain('₹25,000');
    expect(auto).toContain('ride to the next stop');
    expect(html(14)).toContain('hb-mode--metro');
    expect(html(23)).toContain('hb-mode--mmts');
  });

  it('draws the two card decks in their own colours and shimmers while drawing', () => {
    expect(html(2)).toContain('hb-deck--luck');
    expect(html(2)).toContain('Nawabi Luck');
    expect(html(12)).toContain('hb-deck--drama');
    expect(html(12)).toContain('City Drama');
    expect(html(12, { drawing: true })).toContain('fx-shimmer');
    expect(html(12)).not.toContain('fx-shimmer');
  });

  it('gives the corners their own illustrated tiles', () => {
    expect(html(0)).toContain('hb-tile--bl');
    expect(html(0)).toContain('Collect ₹2L');
    expect(html(0)).toContain('collect ₹2,00,000');
    expect(html(0)).toContain('hb-tile__go');
    expect(html(9)).toContain('hb-tile--traffic');
    expect(html(9)).toContain('hb-tile--tl');
    expect(html(18)).toContain('hb-tile--chai');
    expect(html(27)).toContain('hb-tile--municipal');
    for (const id of [0, 9, 18, 27]) expect(html(id)).toContain('hb-tile--corner');
    expect(html(32)).toContain('hb-tile--auction');
  });

  it('shows how many are stuck on the Traffic Jam', () => {
    const out = html(9, { stuck: 2 });
    expect(out).toContain('hb-tile__stuck');
    expect(out).toContain('<b>2</b>');
    expect(out).toContain('2 stuck in traffic');
    expect(html(9)).not.toContain('hb-tile__stuck');
  });

  it('adds soft hyphens only to long names', () => {
    expect(softName('Kokapet')).toBe('Kokapet');
    expect(softName('Chowmahalla')).toBe(`Chow${SHY}mahalla`);
    expect(softName('Fin. District')).toBe(`Fin. Dis${SHY}trict`);
    expect(softName('Tank Bund')).toBe('Tank Bund');
  });
});

describe('city event marks', () => {
  const ev = (id, extra = {}) => ({ id, title: id, text: '', kind: 'rent', round: 3, ...extra });
  const marked = (event) => TILES.filter((t) => eventMark(event, t)).map((t) => t.id);

  it('rush hour and monsoon mark one collection', () => {
    expect(marked(ev('rush_hour', { group: 'cyber', mult: 1.5 }))).toEqual(GROUPS.cyber.tiles);
    expect(eventMark(ev('rush_hour', { group: 'cyber' }), TILES[31]).text).toBe('x1.5');
    expect(marked(ev('monsoon', { group: 'lake', mult: 0.5 }))).toEqual(GROUPS.lake.tiles);
    expect(eventMark(ev('monsoon', { group: 'lake' }), TILES[20]).tone).toBe('rain');
  });

  it('biryani boom marks the food collections, wedding season the venues', () => {
    expect(marked(ev('biryani_boom'))).toEqual([...GROUPS.oldcity.tiles, ...GROUPS.everyday.tiles]);
    expect(marked(ev('wedding_season'))).toEqual([...GROUPS.lake.tiles, ...GROUPS.luxury.tiles]);
    expect(marked(ev('biryani_boom', { groups: ['oldcity'] }))).toEqual(GROUPS.oldcity.tiles);
  });

  it('marks nothing for the festival, no event, or a group event without its group', () => {
    expect(marked(ev('festival', { amount: 50000 }))).toEqual([]);
    expect(marked(null)).toEqual([]);
    expect(marked(ev('rush_hour'))).toEqual([]);
  });

  it('the board reads the event from the live view and glows with opacity, not box-shadow loops', () => {
    const view = { ...blank(), players, turn: 0, phase: 'roll', event: ev('rush_hour', { group: 'newcity' }) };
    const out = renderToString(createElement(Board, { session: { view, display: { ...view, event: null } } }));
    expect(out.match(/is-event/g)).toHaveLength(3);
    expect(tileHtml(out, 35)).toContain('hb-tile__glow');
    expect(tileHtml(out, 35)).toContain('rush hour');
    expect(renderToString(createElement(Board, { session: { display: view } }))).not.toContain('is-event');
  });
});

describe('board', () => {
  const owners = Object.assign(Array(BOARD_SIZE).fill(null), { 1: 'a', 3: 'a', 4: 'a', 6: 'b' });
  const session = {
    display: { ...blank(), owners, players, turn: 0, phase: 'roll', cfg: { passStart: 200000 } },
  };

  it('renders 36 tiles, two pawns and the children in the centre, which is the bank for money flights', () => {
    const out = renderToString(createElement(Board, { session, highlightTile: 7 }, createElement('i', { id: 'panel' })));
    expect(out.match(/data-tile="/g)).toHaveLength(BOARD_SIZE);
    expect(out.match(/data-fx-tile="/g)).toHaveLength(BOARD_SIZE);
    expect(out.match(/data-fx-pawn="/g)).toHaveLength(2);
    expect(out).toMatch(/<div class="hb-center" data-fx-bank=""><i id="panel"><\/i><\/div>/);
    expect(out).toContain('--hb-n:8');
  });

  it('still accepts the centre as the `center` prop', () => {
    const out = renderToString(createElement(Board, { session, center: createElement('i', { id: 'cp' }) }));
    expect(out).toContain('<i id="cp"></i>');
  });

  it('marks the whole bazaar collection as a set for its owner and highlights the asked tile', () => {
    const out = renderToString(createElement(Board, { session, highlightTile: 7 }));
    expect(out.match(/is-set/g)).toHaveLength(3); // tiles 1, 3, 4
    expect(out.match(/is-hl/g)).toHaveLength(1);
    expect(tileHtml(out, 6)).toContain('owned by Bala');
  });

  it('counts stuck players on the Traffic Jam and steams the Chai Adda only when chai goes up', () => {
    const p = [{ ...players[0], pos: 9, stuck: true }, { ...players[1], chai: 1 }];
    const out = renderToString(createElement(Board, { session: { display: { ...blank(), players: p, turn: 1, phase: 'roll' } } }));
    expect(tileHtml(out, 9)).toContain('hb-tile__stuck');
    expect(out).toContain('hb-pawn__stuck');
    expect(tileHtml(out, 18)).not.toContain('fx-steam'); // first paint never plays an effect
  });

  it('shimmers the card tile while the presenter shows its card', () => {
    const card = { player: 'a', deck: 'drama', title: 't', text: 'x', kind: 'bad', cardId: 'c' };
    const out = renderToString(createElement(Board, { session: { ...session, card, stageTile: 12 } }));
    expect(tileHtml(out, 12)).toContain('fx-shimmer');
    expect(out.match(/fx-shimmer/g)).toHaveLength(1);
  });

  it('leans the camera towards the landing tile only while busy', () => {
    const landing = { ...session, busy: true, display: { ...session.display, landing: 22 } };
    const out = renderToString(createElement(Board, { session: landing }));
    expect(out).toContain('fx-cam is-focus');
    expect(out).toContain(`--cam-x:${(tileCenter(22).x * 100).toFixed(2)}%`);
    expect(renderToString(createElement(Board, { session: { ...landing, busy: false } }))).not.toContain('is-focus');
    expect(renderToString(createElement(Board, { session }))).not.toContain('is-focus');
  });

  it('falls back to the brand without a control panel', () => {
    expect(renderToString(createElement(Board, { session }))).toContain('hb-center__banner');
  });
});

describe('money flight helpers', () => {
  it('scales the coin count with the amount, 1 to 8', () => {
    expect(coinCount(0)).toBe(0);
    expect(coinCount(5000)).toBe(1);
    expect(coinCount(25000)).toBeGreaterThanOrEqual(2);
    expect(coinCount(200000)).toBeGreaterThan(coinCount(25000));
    expect(coinCount(5000000)).toBe(8);
    expect(coinCount(-80000)).toBe(coinCount(80000));
  });

  it('arcs upwards between the two endpoints', () => {
    const pts = arcPoints({ x: 0, y: 300 }, { x: 400, y: 300 }, { steps: 10 });
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual({ x: 0, y: 300 });
    expect(pts[10].x).toBeCloseTo(400);
    expect(pts[10].y).toBeCloseTo(300);
    expect(pts[5].y).toBeLessThan(300 - 40);
  });
});
