// Players around the board: who sits where, and what each pod shows (the engine is not under test).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import PlayerPods, { POD_LAYOUTS, cellFor, fitCompact, fitFor, podSlots, podsFor, usesMiddleEdges } from './PlayerPods.jsx';

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

describe('fitCompact', () => {
  it('keeps the phone cash at full size up to ₹1,11,50,000 and only then shrinks', () => {
    expect(fitCompact(1115000)).toBe(1);
    expect(fitCompact(11150000)).toBe(1);
    expect(fitCompact(111500000)).toBe(0.9);
    expect(fitCompact(1115000000)).toBe(0.8);
  });
});

describe('phone pods: cellFor / podsFor', () => {
  it('shapes the opponent cards so every row fills the width', () => {
    expect([0, 1].map((i) => cellFor(2, i))).toEqual(['wide', 'wide']);
    expect(cellFor(1, 0)).toBe('wide');
    expect([0, 1, 2].map((i) => cellFor(3, i))).toEqual(['narrow', 'narrow', 'narrow']);
    expect([0, 1, 2, 3].map((i) => cellFor(4, i))).toEqual(['wide', 'wide', 'wide', 'wide']);
    expect([0, 1, 2, 3, 4].map((i) => cellFor(5, i))).toEqual(['narrow', 'narrow', 'narrow', 'wide', 'wide']);
  });

  it('splits the table into your wallet bar and the opponents', () => {
    const slots = podSlots(seats(4), 'p1');
    expect(podsFor(slots, 'p1', 'me').map((x) => x.player.id)).toEqual(['p1']);
    expect(podsFor(slots, 'p1', 'others').map((x) => x.player.id)).toEqual(['p2', 'p3', 'p0']);
    expect(podsFor(slots, 'p1', 'all')).toHaveLength(4);
    // a spectator has no wallet bar and sees everyone as an opponent
    expect(podsFor(podSlots(seats(3), 'nobody'), 'nobody', 'me')).toEqual([]);
    expect(podsFor(podSlots(seats(3), 'nobody'), 'nobody', 'others')).toHaveLength(3);
  });
});

describe('<PlayerPods layout="phone">', () => {
  const players = [P('me', 'Nithin', { chai: 1, cash: 11150000 }), P('rav', 'Ravi', { stuck: true }), P('sana', 'Sana'), P('arj', 'Arjun')];
  const phone = (mode, extra = {}) => html(createElement(PlayerPods, { session: mkSession(players, { me: 'me', turn: 1, ...extra }), layout: 'phone', mode }));

  it('renders only the opponents as cards in "others" mode, each avatar still an fx anchor', () => {
    const out = phone('others');
    expect(out.match(/class="hg-pod[ "]/g)).toHaveLength(3);
    expect(out).not.toContain('hg-pod is-me');
    expect(out.match(/data-cell="narrow"/g)).toHaveLength(3);
    for (const id of ['rav', 'sana', 'arj']) expect(out).toContain(`data-fx-player="${id}"`);
    expect(out).not.toContain('data-fx-player="me"');
  });

  it('renders only your wallet bar in "me" mode, with the big cash label', () => {
    const out = phone('me');
    expect(out.match(/class="hg-pod[ "]/g)).toHaveLength(1);
    expect(out).toContain('data-cell="wallet"');
    expect(out).toContain('Your cash');
    expect(out).toContain('aria-label="Your wallet"');
    expect(out).toContain('data-fx-player="me"');
    expect(out).toContain('₹1,11,50,000');
  });

  it('shows chai / traffic as avatar badges (aria-hidden: the button label already says it) and keeps the turn mark', () => {
    const out = phone('others');
    expect(out).toContain('hg-pod__badges');
    const ravi = out.split('<li ').slice(1).find((x) => x.includes('data-fx-player="rav"'));
    expect(ravi).toContain('hg-pod is-turn');
    expect(ravi).toContain('hg-traffic');
    expect(ravi).toContain('>Turn<');
    expect(ravi).toContain('current turn');
    expect(ravi).toContain('stuck in traffic');
  });

  it('uses the side-column card shape on a phone on its side', () => {
    const out = html(createElement(PlayerPods, { session: mkSession(players, { me: 'me' }), layout: 'land', mode: 'others' }));
    expect(out.match(/data-cell="side"/g)).toHaveLength(3);
  });

  it('lists everybody, without cell shapes, on tablets and desktops', () => {
    const out = html(createElement(PlayerPods, { session: mkSession(players, { me: 'me' }), layout: 'wide', mode: 'others' }));
    expect(out.match(/class="hg-pod[ "]/g)).toHaveLength(4);
    expect(out).not.toContain('data-cell');
    expect(out).not.toContain('hg-pod__badges');
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
