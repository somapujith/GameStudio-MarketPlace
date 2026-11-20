// The desktop HUD's pure helpers: empire strip, standings, net-worth race, the centre's plain-words hint.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { RACE_FAN_PX, empireOf, empireWords, hintLine, leaderFraction, raceModel, ranksOf, spreadRunners } from './hudModel.js';
import NetRace, { LeaderChip } from './NetRace.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const N = TILES.length;
const GROUPS = [
  { id: 'a', name: 'Alpha', color: '#111111', tiles: [1, 2, 3] },
  { id: 'b', name: 'Beta', color: '#222222', tiles: [5, 6] },
];

describe('empireOf', () => {
  it('counts a player\'s districts per collection and marks a complete one', () => {
    const owners = Array(N).fill(null);
    [1, 2, 3, 5].forEach((i) => { owners[i] = 'me'; });
    owners[6] = 'rav';
    const rows = empireOf(owners, [], 'me', GROUPS);
    expect(rows.map((r) => [r.id, r.owned, r.total, r.full])).toEqual([['a', 3, 3, true], ['b', 1, 2, false]]);
  });

  it('counts mortgaged districts separately and says the empire in words', () => {
    const owners = Array(N).fill(null);
    [1, 2].forEach((i) => { owners[i] = 'me'; });
    const mortgaged = Array(N).fill(false);
    mortgaged[2] = true;
    const rows = empireOf(owners, mortgaged, 'me', GROUPS);
    expect(rows[0]).toMatchObject({ owned: 2, mortgaged: 1, full: false });
    expect(empireWords(rows)).toBe('2 districts');
    expect(empireWords(empireOf(Array(N).fill(null), [], 'me', GROUPS))).toBe('');
    owners[3] = 'me';
    expect(empireWords(empireOf(owners, [], 'me', GROUPS))).toBe('3 districts, 1 complete collection');
  });

  it('uses the real board collections by default', () => {
    const rows = empireOf(Array(N).fill(null), [], 'me');
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.every((r) => r.owned === 0 && !r.full)).toBe(true);
  });
});

describe('ranksOf', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', bankrupt: true }];
  it('ranks by net worth, ties share a rank, players who are out are skipped', () => {
    expect(ranksOf(players, { a: 10, b: 30, c: 10, d: 99 })).toEqual({ b: 1, a: 2, c: 2 });
    expect(ranksOf([], {})).toEqual({});
  });
});

describe('raceModel', () => {
  const players = [
    { id: 'me', name: 'Nithin', color: '#f00' },
    { id: 'rav', name: 'Ravi', color: '#0f0' },
    { id: 'out', name: 'Gone', color: '#00f', bankrupt: true },
  ];
  it('places everybody still in on a track to the target, leader last (on top)', () => {
    const r = raceModel({ players, worths: { me: 1000000, rav: 2500000, out: 0 }, target: 5000000, me: 'me', leaderId: 'rav' });
    expect(r.hasTarget).toBe(true);
    expect(r.label).toBe('₹50L');
    expect(r.runners.map((x) => x.id)).toEqual(['me', 'rav']);
    expect(r.runners.map((x) => x.frac)).toEqual([0.2, 0.5]);
    expect(r.runners[1]).toMatchObject({ lead: true, rank: 1 });
    expect(r.runners[0]).toMatchObject({ isMe: true, rank: 2 });
    expect(r.sr).toBe('Net worth race to ₹50L: Ravi ₹25L, You ₹10L');
  });

  it('caps at the finish line and nudges dots that would overlap', () => {
    const r = raceModel({ players, worths: { me: 6000000, rav: 5990000 }, target: 5000000, me: 'me' });
    expect(r.runners.map((x) => x.frac)).toEqual([1, 1]);
    expect(r.runners[0].lane).toBe(0);
    expect(r.runners[1].lane).toBe(1);
  });

  it('fans out dots with equal net worth so none hides another (a game that has just started)', () => {
    const three = [
      { id: 'a', name: 'A', color: '#f00' }, { id: 'b', name: 'B', color: '#0f0' }, { id: 'c', name: 'C', color: '#00f' },
    ];
    const r = raceModel({ players: three, worths: { a: 1500000, b: 1500000, c: 1500000 }, target: 5000000, me: 'a' });
    expect(r.runners.map((x) => x.frac)).toEqual([0.3, 0.3, 0.3]);
    expect(r.runners.map((x) => x.lane)).toEqual([0, 1, 2]);
    expect(r.runners.map((x) => x.dx)).toEqual([-RACE_FAN_PX, 0, RACE_FAN_PX]); // centred on the true spot
    const xs = r.runners.map((x) => x.frac * 400 + x.dx);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(RACE_FAN_PX);
  });

  it('leaves well-spaced dots alone and fans a cluster at the finish line inwards (the leader keeps the true spot)', () => {
    const r = raceModel({ players, worths: { me: 500000, rav: 2500000 }, target: 5000000, me: 'me' });
    expect(r.runners.map((x) => [x.lane, x.dx])).toEqual([[0, 0], [0, 0]]);
    const done = raceModel({ players, worths: { me: 6000000, rav: 5990000 }, target: 5000000, me: 'me' });
    expect(done.runners.map((x) => x.dx)).toEqual([-RACE_FAN_PX, 0]);
    const start = [{ frac: 0, lane: 0, dx: 0 }, { frac: 0.01, lane: 0, dx: 0 }, { frac: 0.5, lane: 0, dx: 0 }];
    expect(spreadRunners(start).map((x) => x.dx)).toEqual([0, RACE_FAN_PX, 0]); // at the start line it fans out forwards
  });

  it('chains neighbours: a-b close and b-c close is one cluster, but a far dot is not pulled in', () => {
    const rs = [0.3, 0.33, 0.36, 0.7].map((frac) => ({ frac, lane: 0, dx: 0 }));
    spreadRunners(rs);
    expect(rs.map((x) => x.lane)).toEqual([0, 1, 2, 0]);
    expect(rs[3].dx).toBe(0);
  });

  it('works without a target (scaled to a little past the leader, no flag) and is null for an empty table', () => {
    const r = raceModel({ players, worths: { me: 1000000, rav: 2000000 }, target: null, me: 'me' });
    expect(r.hasTarget).toBe(false);
    expect(r.flag).toBe('');
    expect(r.runners[1].frac).toBeCloseTo(1 / 1.15, 5);
    expect(raceModel({ players: [], worths: {} })).toBeNull();
  });
});

describe('leaderFraction', () => {
  it('is the best live player\'s share of the target', () => {
    const players = [{ id: 'a' }, { id: 'b', bankrupt: true }];
    expect(leaderFraction(players, { a: 2500000, b: 9000000 }, 5000000)).toBe(0.5);
    expect(leaderFraction(players, { a: 1 }, null)).toBe(0);
  });
});

describe('hintLine', () => {
  const sess = (phase = 'roll', extra = {}) => ({ view: { phase, ...extra }, display: { phase }, me: 'me' });
  it('tells you what to do on your own turn, in plain words', () => {
    expect(hintLine(sess(), { kind: 'roll', primary: { label: 'Roll' } })).toBe('Roll the die to move around the city');
    expect(hintLine(sess(), { kind: 'roll', primary: { label: 'Roll again' } })).toMatch(/six/);
    expect(hintLine(sess('buy'), { kind: 'buy', primary: { label: 'Buy Madhapur', amount: '₹3,20,000' }, secondaries: [{ key: 'skip', label: 'Pass' }] }))
      .toBe('Buy Madhapur for ₹3,20,000, or pass (it stays free, no auction)');
    expect(hintLine(sess('buy'), { kind: 'buy', primary: { label: 'Buy Madhapur', amount: '₹3,20,000' }, secondaries: [{ key: 'skip', label: 'Skip' }] }))
      .toBe('Buy Madhapur for ₹3,20,000, or pass (it stays free, no auction)');
    expect(hintLine(sess(), { kind: 'end', upgrades: 2 })).toBe('Upgrade a district in Manage, or end your turn');
    expect(hintLine(sess(), { kind: 'end', upgrades: 0 })).toMatch(/End your turn/);
    expect(hintLine(sess(), { kind: 'traffic' })).toBe('');
  });

  it('says who the table is waiting for', () => {
    expect(hintLine(sess('roll'), { kind: 'status', waitFor: { id: 'rav' }, secondaries: [] }, 'Ravi')).toBe('Waiting for Ravi to roll');
    expect(hintLine(sess('buy', { pending: { type: 'buy' } }), { kind: 'status', waitFor: { id: 'rav' }, secondaries: [] }, 'Ravi')).toBe('Waiting for Ravi to decide');
    expect(hintLine(sess('auction'), { kind: 'status', secondaries: [] }, 'Ravi')).toMatch(/bid/);
  });

  it('says the game is over once it is', () => {
    expect(hintLine(sess('over'), { kind: 'status' })).toMatch(/over/);
  });
});

describe('<NetRace> / <LeaderChip>', () => {
  const players = [
    { id: 'me', name: 'Nithin', color: '#ff4d6d', cash: 4000000, pos: 0, bankrupt: false },
    { id: 'rav', name: 'Ravi', color: '#3ddc97', cash: 1000000, pos: 0, bankrupt: false },
  ];
  const mk = (cfg = { targetWorth: 5000000 }) => {
    const owners = Array(N).fill(null);
    const view = { phase: 'roll', turn: 0, round: 3, players, owners, levels: Array(N).fill(0), mortgaged: Array(N).fill(false), cfg };
    return { me: 'me', view, display: { ...view } };
  };

  it('draws a dot per player, the finish flag and one sentence for screen readers', () => {
    const out = html(createElement(NetRace, { session: mk() }));
    expect((out.match(/nr__dot/g) || []).length).toBe(2);
    expect(out).toContain('nr__goal');
    expect(out).toContain('aria-label="Net worth race to ₹50L');
    expect(out).toContain('is-hot'); // the leader is at 80% of the target
  });

  it('has no flag without a target and shows nothing for a solo table', () => {
    expect(html(createElement(NetRace, { session: mk({}) }))).not.toContain('nr__goal');
    const solo = mk();
    solo.view.players = [players[0]];
    solo.display = { ...solo.view };
    expect(html(createElement(NetRace, { session: solo }))).toBe('');
  });

  it('names the leader (and says "You" when it is you)', () => {
    const out = html(createElement(LeaderChip, { session: mk() }));
    expect(out).toContain('tb-leader');
    expect(out).toContain('You are leading');
  });
});
