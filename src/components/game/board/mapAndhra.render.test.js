import { createElement, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { applyMap, DEFAULT_MAP } from '@shared/maps.js';
import { ArtMapContext } from '@/components/art/andhra/artMap.js';
import { Board } from '../Board.jsx';
import { Tile } from '../Tile.jsx';
import GameView from '../GameView.jsx';

// The Andhra map is a skin: the game root and the board carry data-map, the board paints its own centrepiece, and the
// Hyderabad map renders exactly as before (no centrepiece, same tiles).
afterAll(() => applyMap(DEFAULT_MAP));

const players = [{ id: 'a', name: 'Asha', color: '#ff4d6d', pos: 0, piece: 'pearl', cash: 1500000 }];
const session = { display: { players, owners: [], levels: [], mortgaged: [], turn: 0, phase: 'roll' } };
const board = (map) => renderToString(h(ArtMapContext.Provider, { value: map }, createElement(Board, { session })));

describe('Board on the Andhra map', () => {
  it('carries data-map and paints the centrepiece behind the middle', () => {
    const out = board('andhra');
    expect(out).toContain('class="hb-board"');
    expect(out).toContain('data-map="andhra"');
    expect(out).toContain('class="ah-centre"');
    expect(out.indexOf('ah-centre')).toBeGreaterThan(out.indexOf('class="hb-center"'));
    expect(out.indexOf('ah-centre')).toBeLessThan(out.indexOf('class="hb-pawns"'));
  });

  it('Hyderabad keeps its board: data-map="hyderabad", no Andhra art', () => {
    const out = board('hyderabad');
    expect(out).toContain('data-map="hyderabad"');
    expect(out).not.toContain('ah-centre');
    expect(out).not.toContain('data-andhra-icon');
  });

  it('draws the Andhra icons on special squares and the Andhra tokens on pawns', () => {
    applyMap('andhra');
    const out = board('andhra');
    expect(out).toContain('data-andhra-icon="0"'); // Andhra Yatra
    expect(out).toContain('data-andhra-icon="18"'); // Sankranti Fair
    expect(out).toContain('data-andhra-icon="luck"');
    expect(out).toContain('data-andhra-icon="drama"');
    applyMap(DEFAULT_MAP);
    expect(board('hyderabad')).not.toContain('data-andhra-icon');
  });

  it('an owned Andhra district shows the folk-art business, a Hyderabad one the isometric model', () => {
    applyMap('andhra');
    const tile = TILES[20];
    const owned = (map) => renderToString(h(ArtMapContext.Provider, { value: map }, createElement(Tile, { tile, ownerColor: '#ff4d6d', ownerName: 'Asha', ownerId: 'a', level: 1 })));
    expect(owned('andhra')).toContain('data-map="andhra"');
    expect(owned('hyderabad')).not.toContain('data-map="andhra"');
    applyMap(DEFAULT_MAP);
  });
});

describe('GameView root', () => {
  const N = TILES.length;
  const seats = [{ id: 'me', name: 'Asha', color: '#f00', cash: 1500000, pos: 0, piece: 'pearl' }, { id: 'b', name: 'Ravi', color: '#0f0', cash: 1500000, pos: 3, piece: 'auto' }];
  const game = (cfg) => {
    const view = { phase: 'roll', turn: 0, round: 1, turnCount: 1, players: seats, owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false), dice: [], cfg, pending: null, trade: null, debt: null, event: null };
    const session = { mode: 'online', me: 'me', view, display: view, busy: false, options: { roll: true }, log: [], dispatch() {}, chat: [], sendChat() {}, connection: 'open', restart() {}, quit() {}, clock: null, roomPlayers: [], card: null, flights: [] };
    return renderToString(createElement(GameView, { session, onExit() {} }));
  };
  const root = (html) => /<div class="hg-game[^>]*>/.exec(html)?.[0] || '';

  it('puts data-map on the game root from the game cfg, and the Andhra art inside', () => {
    const out = game({ map: 'andhra', startCash: 1500000, passStart: 200000 });
    expect(root(out)).toContain('data-map="andhra"');
    expect(out).toContain('class="ah-centre"');
    expect(out).toContain('data-andhra-icon');
  });

  it('a default-map game (no cfg.map) says hyderabad and draws none of it', () => {
    applyMap(DEFAULT_MAP);
    const out = game({ startCash: 1500000, passStart: 200000 });
    expect(root(out)).toContain('data-map="hyderabad"');
    expect(out).not.toContain('ah-centre');
    expect(out).not.toContain('data-andhra-icon');
  });

  it('the loading shell renders without a cfg', () => {
    expect(renderToString(createElement(GameView, { session: { view: null, display: null }, onExit() {} }))).toContain('hg-game');
  });
});
