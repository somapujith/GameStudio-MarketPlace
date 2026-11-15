import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPresenterCore } from './usePresenter.js';
import { SFX_NAMES } from '../sfx.js';

// What the presenter asks the sound system (and the vibration motor) to do for each engine event.
const N = 36;
const makeState = () => ({
  players: [
    { id: 'me', name: 'Asha', color: '#ff4d6d', piece: 'auto', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, laps: 0 },
    { id: 'other', name: 'Bala', color: '#3ddc97', piece: 'pearl', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, laps: 0 },
  ],
  owners: Array(N).fill(null),
  levels: Array(N).fill(0),
  mortgaged: Array(N).fill(false),
  turn: 0,
  round: 1,
  dice: [0],
  phase: 'roll',
  cfg: { mode: 'standard', maxRounds: 20, passStart: 200000 },
  event: null,
  ride: null,
});

function rig(me = 'me') {
  vi.useFakeTimers();
  const sounds = [];
  const buzzes = [];
  const state = makeState();
  const core = createPresenterCore({
    meId: me,
    initialState: state,
    deps: {
      loadSettings: () => ({ reducedMotion: false }),
      sfx: { play: (n, o) => sounds.push([n, o]) },
      buzz: (k) => buzzes.push(k),
      describeEvent: () => ({ text: 'x', tone: 'info' }),
      playCardClip: () => true,
    },
  });
  return { core, state, sounds, buzzes, names: () => sounds.map((s) => s[0]) };
}

async function run(core, events, final) {
  core.enqueue(events, final);
  while (core.isBusy()) await vi.advanceTimersByTimeAsync(10);
}

afterEach(() => vi.useRealTimers());

describe('presenter sounds', () => {
  it('only asks for sounds that exist', () => {
    for (const n of ['diceLand', 'land', 'rent', 'sold', 'auction', 'announce', 'turnOther', 'bankrupt', 'snatchWin', 'snatchLost', 'traffic', 'tick']) {
      expect(SFX_NAMES).toContain(n);
    }
  });

  it('dice: rattle at the start, then the landing knock carries the faces; my roll buzzes twice (roll, then land or six)', async () => {
    const { core, state, sounds, buzzes } = rig();
    await run(core, [{ type: 'dice', player: 'me', values: [3, 4] }], state);
    expect(sounds[0][0]).toBe('dice');
    const land = sounds.find((s) => s[0] === 'diceLand');
    expect(land[1].values).toEqual([3, 4]);
    expect(buzzes).toEqual(['roll', 'bounce', 'bounce', 'bounce', 'land']); // a tap at each floor bounce, then the landing
    expect(sounds[0][1].ms).toBeGreaterThan(300); // the rattle is timed to the die's tumble
    core.dispose();
    const six = rig();
    await run(six.core, [{ type: 'dice', player: 'me', values: [6] }], six.state);
    expect(six.buzzes).toEqual(['roll', 'bounce', 'bounce', 'bounce', 'six']);
    six.core.dispose();
  });

  it("another player's roll never vibrates my phone, and its landing knock is a little quieter", async () => {
    const { core, state, sounds, buzzes } = rig();
    await run(core, [{ type: 'dice', player: 'other', values: [2] }], state);
    expect(buzzes).toEqual([]);
    expect(sounds.find((s) => s[0] === 'diceLand')[1].vol).toBeLessThan(1);
    core.dispose();
  });

  it('pawn steps carry their index so the pitch climbs along the move', async () => {
    const { core, state, sounds } = rig();
    await run(core, [{ type: 'move', player: 'me', from: 0, to: 4, path: [1, 2, 3, 4], passedStart: false }], state);
    const steps = sounds.filter((s) => s[0] === 'step').map((s) => s[1]);
    expect(steps.map((o) => o.i)).toEqual([0, 1, 2, 3]);
    expect(steps.every((o) => o.n === 4)).toBe(true);
    core.dispose();
  });

  it('landing makes a soft thud', async () => {
    const { core, state, names } = rig();
    await run(core, [{ type: 'land', player: 'me', tile: 4 }], state);
    expect(names()).toContain('land');
    core.dispose();
  });

  it('money: the amount shapes the sound; rent paid is a thud; the player feels their own payments and gains only', async () => {
    const { core, state, sounds, buzzes } = rig();
    await run(core, [
      { type: 'cash', player: 'me', delta: -25000, reason: 'rent', other: 'other' },
      { type: 'cash', player: 'other', delta: 25000, reason: 'rent', other: 'me' },
      { type: 'cash', player: 'me', delta: 200000, reason: 'salary' },
      { type: 'cash', player: 'me', delta: -25000, reason: 'traffic' },
    ], state);
    const byName = (n) => sounds.filter((s) => s[0] === n).map((s) => s[1]);
    expect(byName('rent')).toEqual([{ amount: 25000, vol: 1 }]);
    expect(byName('coin').map((o) => o.amount)).toEqual([25000, 200000]);
    expect(byName('coin')[0].vol).toBeLessThan(1); // the other player's gain is quieter
    expect(byName('pay')).toEqual([{ amount: 25000, vol: 1 }]);
    expect(buzzes).toEqual(['pay', 'earn', 'pay']);
    core.dispose();
  });

  it('purchase, upgrade, card deck, chai, city event, auction, bankrupt, turn', async () => {
    const { core, state, sounds, buzzes } = rig();
    await run(core, [
      { type: 'own', player: 'me', tile: 6, owner: 'me', reason: 'buy' },
      { type: 'level', tile: 6, level: 1, reason: 'upgrade' },
      { type: 'card', player: 'me', deck: 'drama', title: 'Rain', text: 'It rains', kind: 'bad' },
      { type: 'card', player: 'me', deck: 'luck', title: 'Tip', text: 'A tip', kind: 'good' },
      { type: 'chai', player: 'me', chai: 1, change: 1 },
      { type: 'chai', player: 'me', chai: 0, change: -1 },
      { type: 'city_event', id: 'e', title: 'Metro strike', text: 'No metro', mult: 0.5 },
      { type: 'auction_start', tile: 7 },
      { type: 'auction_end', tile: 7, winner: 'me', price: 90000 },
      { type: 'turn', player: 'other', round: 2 },
      { type: 'bankrupt', player: 'other' },
    ], state);
    const get = (n) => sounds.filter((s) => s[0] === n).map((s) => s[1]);
    expect(get('buy')).toHaveLength(1);
    expect(get('upgrade')[0]).toMatchObject({ level: 1 });
    expect(get('card').map((o) => o.deck)).toEqual(['drama', 'luck']);
    expect(get('chai').map((o) => o.use)).toEqual([false, true]);
    expect(get('announce')[0]).toMatchObject({ bad: true });
    expect(get('auction')).toHaveLength(1);
    expect(get('sold')).toHaveLength(1);
    expect(get('turnOther').length).toBeGreaterThan(0);
    expect(get('bankrupt')[0]).toMatchObject({ mine: false });
    expect(buzzes).toEqual(['buy', 'card', 'card', 'sold']);
    core.dispose();
  });

  it('the Snatch moments: a winner sting, a sad one for the buyer who lost, no presenter sound for a player who may press', async () => {
    const { core, state, names, buzzes } = rig();
    await run(core, [{ type: 'snatch_open', tile: 6, buyer: 'other', price: 70000, eligible: ['me'], ms: 5000 }], state);
    expect(names()).toEqual([]);
    await run(core, [{ type: 'snatch_end', tile: 6, buyer: 'other', outcome: 'snatched', winner: 'me' }], state);
    expect(names()).toContain('snatchWin');
    expect(buzzes).toContain('snatchWin');
    core.dispose();
  });

  it('a failing sound or vibration never stops playback', async () => {
    vi.useFakeTimers();
    const core = createPresenterCore({
      meId: 'me',
      initialState: makeState(),
      deps: {
        loadSettings: () => ({ reducedMotion: false }),
        sfx: { play: () => { throw new Error('audio'); } },
        buzz: () => { throw new Error('vibrate'); },
        describeEvent: () => null,
        playCardClip: () => true,
      },
    });
    const state = makeState();
    state.players[0].pos = 3;
    await run(core, [{ type: 'dice', player: 'me', values: [3] }, { type: 'move', player: 'me', from: 0, to: 3, path: [1, 2, 3] }], state);
    expect(core.getSnapshot().display.players[0].pos).toBe(3);
    core.dispose();
  });
});
