// Players around the board: who sits where, and what each pod shows (the engine is not under test).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import PlayerPods, { POD_LAYOUTS, fitFor, podSlots, usesMiddleEdges } from './PlayerPods.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const N = TILES.length;
const P = (id, name, extra = {}) => ({ id, name, avatar: 0, color: '#3ddc97', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });

function mkSession(players, { me = players[0].id, turn = 0, roomPlayers = [] } = {}) {
  const view = {
    phase: 'roll', turn, round: 3, turnCount: 5, extraRoll: false, players,
    owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false),
    cfg: { mode: 'standard', maxRounds: 20 }, pending: null, trade: null, debt: null, event: null, dice: [],
  };
  const display = { players, owners: view.owners, levels: view.levels, mortgaged: view.mortgaged, turn, round: 3, dice: [], phase: 'roll', cfg: view.cfg };
  return { mode: 'online', me, view, display, options: {}, log: [], dispatch: () => {}, clock: null, roomPlayers };
}

const seats = (n) => Array.from({ length: n }, (_, i) => P(`p${i}`, `Player ${i}`));

describe('podSlots', () => {
  it('puts the viewer bottom-left and the others clockwise in turn order', () => {
    const got = podSlots(seats(4), 'p2');
    expect(got.map((x) => x.player.id)).toEqual(['p2', 'p3', 'p0', 'p1']);
    expect(got.map((x) => x.slot)).toEqual(['bl', 'tl', 'tr', 'br']);
  });

  it('uses opposite corners for two players and the four corners for four', () => {
    expect(podSlots(seats(2), 'p0').map((x) => x.slot)).toEqual(['bl', 'tr']);
    expect(new Set(podSlots(seats(4), 'p0').map((x) => x.slot))).toEqual(new Set(['bl', 'tl', 'tr', 'br']));
  });

  it('adds the left and right middle edges for 5 and 6 players, one slot per player', () => {
    for (const n of [5, 6]) {
      const slots = podSlots(seats(n), 'p0').map((x) => x.slot);
      expect(new Set(slots).size).toBe(n);
      expect(slots).toContain('ml');
    }
    expect(podSlots(seats(6), 'p0').map((x) => x.slot)).toContain('mr');
    expect(usesMiddleEdges(4)).toBe(false);
    expect(usesMiddleEdges(5)).toBe(true);
  });

  it('keeps the seat order for a spectator and handles an empty table', () => {
    expect(podSlots(seats(3), 'nobody').map((x) => x.player.id)).toEqual(['p0', 'p1', 'p2']);
    expect(podSlots([], 'p0')).toEqual([]);
    for (const [n, list] of Object.entries(POD_LAYOUTS)) expect(list).toHaveLength(Number(n));
  });
});

describe('fitFor', () => {
  it('shrinks long amounts so they stay inside the pod', () => {
    expect(fitFor(1115000)).toBe(1);
    expect(fitFor(11150000)).toBe(0.8);
    expect(fitFor(100000000)).toBeLessThan(1);
  });
});

describe('<PlayerPods>', () => {
  it('renders one pod per player, mine marked with the "Your cash" label, each avatar anchored for fx', () => {
    const out = html(createElement(PlayerPods, { session: mkSession([P('me', 'Nithin'), P('rav', 'Ravi')], { me: 'me' }) }));
    expect(out.match(/class="hg-pod[ "]/g)).toHaveLength(2);
    expect(out).toContain('data-slot="bl"');
    expect(out).toContain('data-slot="tr"');
    expect(out).toContain('hg-pod is-me');
    expect(out).toContain('Your cash');
    expect(out.match(/Your cash/g)).toHaveLength(1);
    expect(out).toContain('data-fx-player="me"');
    expect(out).toContain('data-fx-player="rav"');
  });

  it('marks whose turn it is, chai, traffic and a dropped connection', () => {
    const players = [P('me', 'Nithin', { chai: 1 }), P('rav', 'Ravi', { stuck: true }), P('sana', 'Sana')];
    const roomPlayers = [{ id: 'me', connected: true }, { id: 'rav', connected: true }, { id: 'sana', connected: false }];
    const out = html(createElement(PlayerPods, { session: mkSession(players, { me: 'me', turn: 1, roomPlayers }) }));
    const pods = out.split('<li ').slice(1);
    expect(pods.find((x) => x.includes('data-slot="tl"'))).toContain('Stuck in traffic');
    expect(out).toContain('hg-pod is-turn');
    expect(out).toContain('hg-chai is-on');
    expect(out).toContain('Reconnecting');
  });

  it('shows a bankrupt player as out, without cash', () => {
    const out = html(createElement(PlayerPods, { session: mkSession([P('me', 'Nithin'), P('rav', 'Ravi', { bankrupt: true, cash: 0 })], { me: 'me' }) }));
    expect(out).toContain('is-out');
    expect(out).toContain('Bankrupt');
  });
});
