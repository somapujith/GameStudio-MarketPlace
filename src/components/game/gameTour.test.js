import { describe, expect, it } from 'vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { _resetAutoSession, markAutoToursDone, resetAllTours } from '../tour/tourState.js';
import { buildGameSteps, firstGameEligible, owesDecision, pauseState, tableBusy, winLine } from './gameTour.js';

const ids = (cfg) => buildGameSteps({ cfg, me: 'me' }).map((s) => s.id);
const body = (cfg, id) => buildGameSteps({ cfg, me: 'me' }).find((s) => s.id === id)?.body;

describe('buildGameSteps', () => {
  it('has unique ids, a title and a body for every step', () => {
    const steps = buildGameSteps({ cfg: {}, me: 'me' });
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    steps.forEach((s) => { expect(s.title).toBeTruthy(); expect(s.body).toBeTruthy(); });
    expect(steps[0].id).toBe('welcome');
    expect(steps.at(-1).id).toBe('finish');
  });

  it('covers every feature of the table', () => {
    const all = ids({ snatches: 1, eventEvery: 3, passStart: 200000 });
    ['board', 'districts', 'pawn', 'players', 'wifi', 'goal', 'dice', 'action', 'buy', 'snatch', 'upgrade', 'mortgage', 'trade', 'chai',
      'transport', 'traffic', 'cards', 'events', 'municipal', 'start', 'bazaar', 'feed', 'chat', 'camera', 'menu', 'finish']
      .forEach((id) => expect(all).toContain(id));
  });

  it('drops the steps of rules that are switched off', () => {
    expect(ids({ snatches: 0 })).not.toContain('snatch');
    expect(ids({ eventEvery: 0 })).not.toContain('events');
    expect(ids({ passStart: 0 })).not.toContain('start');
  });

  it('reads its numbers from the table rules', () => {
    expect(body({ snatches: 2, snatchMs: 7000 }, 'snatch')).toMatch(/7 seconds/);
    expect(body({ snatches: 2, snatchMs: 7000 }, 'snatch')).toMatch(/2 buttons/);
    expect(body({ snatches: 1, snatchMs: 5000 }, 'snatch')).toMatch(/5 seconds.*1 button,/);
    expect(body({ turnSeconds: 45 }, 'action')).toMatch(/45 second/);
    expect(body({ trafficFine: 30000 }, 'traffic')).toMatch(/30,000/);
    expect(body({ passStart: 300000 }, 'start')).toMatch(/3,00,000/);
    expect(body({ chaiCap: 2 }, 'chai')).toMatch(/hold 2/);
    expect(body({ eventEvery: 4 }, 'events')).toMatch(/Every 4 rounds/);
  });

  it('rupee amounts in the copy come only from the table rules (fine and salary)', () => {
    const text = buildGameSteps({ cfg: { trafficFine: 0, passStart: 0 }, me: 'me' }).map((s) => `${s.title} ${s.body}`).join(' ');
    expect(text).not.toMatch(/₹\s?[0-9]/);
  });

  it('Pass never mentions an auction (a passed district stays free); Snatch is mentioned when on', () => {
    const all = buildGameSteps({ cfg: { snatches: 1 }, me: 'me' }).filter((x) => x.id !== 'bazaar').map((x) => `${x.title} ${x.body}`).join(' ');
    expect(body({ snatches: 1 }, 'buy')).toMatch(/stays free/);
    expect(body({ snatches: 1 }, 'buy')).toMatch(/Snatch window/);
    expect(body({ snatches: 0 }, 'buy')).toMatch(/stays free/);
    expect(all).not.toMatch(/send it to auction|goes to auction|put up for auction/i);
    expect(ids({})).not.toContain('auction');
  });

  it('phone overrides point at the phone table', () => {
    const steps = buildGameSteps({ cfg: {}, me: 'me' });
    expect(steps.find((s) => s.id === 'action').phone.target).toBe('.pa');
    expect(steps.find((s) => s.id === 'players').phone.target).toBe('.pp-list');
  });
});

describe('winLine', () => {
  it('describes target, rounds, both or neither', () => {
    expect(winLine({ targetWorth: 5000000 })).toMatch(/First to ₹50L net worth wins/);
    expect(winLine({ maxRounds: 20 })).toMatch(/after round 20/);
    expect(winLine({ targetWorth: 3000000, maxRounds: 12 })).toMatch(/or the richest after round 12/);
    expect(winLine({})).toMatch(/last player standing/);
  });
});

const sess = (o = {}, view = {}, extra = {}) => ({
  me: 'me', options: o, clock: null,
  view: { phase: 'roll', turn: 1, players: [{ id: 'a' }, { id: 'me' }], ...view }, ...extra,
});

describe('owesDecision / tableBusy / pauseState', () => {
  it('is true for anything I must answer', () => {
    expect(owesDecision(sess({ roll: true }))).toBe(true);
    expect(owesDecision(sess({ buy: true }))).toBe(true);
    expect(owesDecision(sess({ endTurn: true }))).toBe(true);
    expect(owesDecision(sess({ bid: { tile: 1 } }))).toBe(true);
    expect(owesDecision(sess({ snatch: { tile: 1, ms: 5000 } }))).toBe(true);
    expect(owesDecision(sess({ debt: { amount: 5 } }))).toBe(true);
    expect(owesDecision(sess({ tradeOffer: { id: 1 } }))).toBe(true);
    expect(owesDecision(sess({}, {}, { clock: { deadline: Date.now() + 5000, waitingFor: ['me'] } }))).toBe(true);
  });
  it('is false while I just watch', () => {
    expect(owesDecision(sess({}))).toBe(false);
    expect(owesDecision(sess({}, {}, { clock: { deadline: Date.now() + 5000, waitingFor: ['a'] } }))).toBe(false);
    expect(owesDecision(sess({ roll: true }, { phase: 'over' }))).toBe(false);
    expect(owesDecision(sess({ roll: true }, {}, { resigned: true }))).toBe(false);
    expect(owesDecision(sess({ roll: true }, { players: [{ id: 'a' }, { id: 'me', bankrupt: true }] }))).toBe(false);
    expect(owesDecision(null)).toBe(false);
  });
  it('tableBusy for auction / debt / snatch / trade', () => {
    expect(tableBusy(sess({}, { phase: 'auction' }))).toBe(true);
    expect(tableBusy(sess({}, { phase: 'debt' }))).toBe(true);
    expect(tableBusy(sess({}, { phase: 'snatch' }))).toBe(true);
    expect(tableBusy(sess({}, { trade: { id: 1 } }))).toBe(true);
    expect(tableBusy(sess({}, { phase: 'roll' }))).toBe(false);
  });
  it('pause rules: my move pauses with no resume; busy resumes by itself; a minimised tour resumes by button', () => {
    expect(pauseState({ open: true, owes: true, busy: false, minimised: true })).toMatchObject({ paused: true, canResume: false, text: 'Your move first' });
    expect(pauseState({ open: true, owes: false, busy: true, minimised: false })).toMatchObject({ paused: true, canResume: false });
    expect(pauseState({ open: true, owes: false, busy: false, minimised: true })).toMatchObject({ paused: true, canResume: true });
    expect(pauseState({ open: true, owes: false, busy: false, minimised: false }).paused).toBe(false);
    expect(pauseState({ open: false, owes: true, busy: true, minimised: true }).paused).toBe(false);
  });
});

describe('firstGameEligible (the table tour is for the first game ever)', () => {
  const NOW = Date.UTC(2026, 5, 1);
  const DAY = 86400000;
  const mem = () => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
  let ls;
  beforeEach(() => { ls = mem(); vi.stubGlobal('localStorage', ls); resetAllTours(); _resetAutoSession(); });
  afterEach(() => { vi.unstubAllGlobals(); resetAllTours(); _resetAutoSession(); });

  it('offers it in the first game of a new account', () => {
    const user = { stats: { games: 0 }, createdAt: NOW - DAY };
    expect(firstGameEligible(user, { now: NOW, storage: ls })).toBe(true);
  });
  it('never in a later game, even with cleared storage', () => {
    expect(firstGameEligible({ stats: { games: 1 }, createdAt: NOW - DAY }, { now: NOW, storage: ls })).toBe(false);
    expect(firstGameEligible({ stats: { games: 0 }, createdAt: NOW - 90 * DAY }, { now: NOW, storage: ls })).toBe(false);
    expect(firstGameEligible({ id: 'x' }, { now: NOW, storage: ls })).toBe(false); // games unknown
  });
  it('not when the invite or the tour was seen, or once the first game marked auto tours done', () => {
    const user = { stats: { games: 0 }, createdAt: NOW - DAY };
    expect(firstGameEligible(user, { inviteSeen: true, now: NOW, storage: ls })).toBe(false);
    expect(firstGameEligible(user, { tourSeen: true, now: NOW, storage: ls })).toBe(false);
    markAutoToursDone(ls);
    expect(firstGameEligible(user, { now: NOW, storage: ls })).toBe(false);
  });
  it('a guest or signed-out first-timer on a fresh browser gets it once', () => {
    expect(firstGameEligible({ isGuest: true, stats: { games: 0 } }, { now: NOW, storage: ls })).toBe(true);
    expect(firstGameEligible(null, { now: NOW, storage: mem() })).toBe(true);
  });
});
