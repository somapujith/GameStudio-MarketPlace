import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIM_MS, eventMs } from '@shared/timing.js';
import { clampSpeed, createPresenterCore, displayFromState } from './usePresenter.js';

afterEach(() => vi.useRealTimers());

describe('scene playback metadata', () => {
  it('marks ordinary walking and clears it when a fresh reconnect cancels playback', async () => {
    const { core, state } = setup();
    core.enqueue([{ type: 'move', player: 'me', path: [1, 2, 3], to: 3 }], state);
    await vi.advanceTimersByTimeAsync(1);
    expect(core.getSnapshot().display.moving).toBe('me');
    core.reset(state);
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().display.moving).toBeNull();
    expect(core.getSnapshot().display.players[0].pos).toBe(0);
    core.dispose();
  });

  it('preserves transaction reasons and card artwork identity in presentation bubbles', async () => {
    const { core, state } = setup({ describe: () => ({ text: 'A scene', tone: 'good' }) });
    core.enqueue([{ type: 'own', player: 'me', tile: 7, owner: 'me', reason: 'buy' }], state);
    await vi.advanceTimersByTimeAsync(1);
    expect(core.getSnapshot().bubble).toMatchObject({ type: 'own', reason: 'buy' });
    core.reset(state);
    core.enqueue([{ type: 'card', player: 'me', deck: 'luck', title: 'Chai', text: 'Take a chai', kind: 'good', cardId: 'free_chai' }], state);
    await vi.advanceTimersByTimeAsync(1);
    expect(core.getSnapshot().bubble.card.cardId).toBe('free_chai');
    core.dispose();
  });
});

describe('the win', () => {
  it.each(['last_standing', 'rounds', 'target'])('plays a %s win at full pace: game over, the winner and the reason on the display', async (reason) => {
    const { core, state } = setup({ describe: () => ({ text: 'Won', tone: 'cheer' }) });
    const final = structuredClone(state);
    final.phase = 'over';
    final.winner = 'other';
    final.winReason = reason;
    const ms = await timed(core, [{ type: 'win', player: 'other', reason, worth: 5100000 }], final);
    expect(ms).toBeGreaterThanOrEqual(ANIM_MS.win * 0.9);
    expect(core.getSnapshot().display).toMatchObject({ phase: 'over', winner: 'other', winReason: reason });
    expect(core.getSnapshot().bubble).toMatchObject({ type: 'win', reason });
    core.dispose();
  });

  it('carries the win reason from a state that is already over (reload)', () => {
    expect(displayFromState(makeState({ phase: 'over', winner: 'me', winReason: 'target' }))).toMatchObject({ phase: 'over', winReason: 'target' });
    expect(displayFromState(makeState()).winReason).toBeNull();
  });
});

// A minimal Hustle-shaped state (independent of the engine build, the presenter only reads these fields).
const N = 36;
function makeState(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function setup({ me = 'me', speed, reduced = false, describe = () => null, state = makeState() } = {}) {
  vi.useFakeTimers();
  const played = [];
  const core = createPresenterCore({
    meId: me,
    initialState: state,
    speed,
    deps: {
      loadSettings: () => ({ reducedMotion: reduced }),
      sfx: { play: (n) => played.push(n) },
      describeEvent: describe,
      playCardClip: () => true,
    },
  });
  return { core, state, played };
}

/** Run one item and return how long it took (fake ms). */
async function timed(core, events, final) {
  const t0 = Date.now();
  core.enqueue(events, final);
  // the playback chain only: flights expire on their own timers, which runAllTimers would also count
  while (core.isBusy()) await vi.advanceTimersByTimeAsync(10);
  return Date.now() - t0;
}

describe('display from a Hustle state', () => {
  it('carries piece, stuck, chai and the open ride offer', () => {
    const s = makeState({ ride: { player: 'me', from: 5, to: 14, fare: 25000 } });
    s.players[0].stuck = true;
    s.players[0].chai = 1;
    const d = displayFromState(s);
    expect(d.players[0]).toMatchObject({ piece: 'auto', stuck: true, chai: 1, motion: null });
    expect(d.ride).toEqual({ player: 'me', from: 5, to: 14, fare: 25000 });
    expect(d.landing).toBe(null);
    expect(displayFromState(null).players).toEqual([]);
  });

  it('starts with the new outputs empty', () => {
    const { core } = setup();
    const s = core.getSnapshot();
    expect(s.card).toBe(null);
    expect(s.handoff).toBe(null);
    expect(s.flights).toEqual([]);
    expect(s.lastCash).toBe(null);
    core.dispose();
  });
});

describe('playback speed', () => {
  it('clamps to 0.75..2', () => {
    expect(clampSpeed(1.5)).toBe(1.5);
    expect(clampSpeed(5)).toBe(2);
    expect(clampSpeed(0.1)).toBe(0.75);
    expect(clampSpeed('x')).toBe(1);
    expect(clampSpeed(undefined)).toBe(1);
  });

  it('a faster rate plays the same events in less time', async () => {
    const ev = [{ type: 'city_event', id: 'festival', title: 'Bonalu', text: 'Festive bonus', kind: 'good', round: 3 }];
    const a = setup({ speed: 1 });
    const t1 = await timed(a.core, ev, a.state);
    a.core.dispose();
    const b = setup({ speed: 2 });
    const t2 = await timed(b.core, ev, b.state);
    b.core.dispose();
    expect(t1).toBeGreaterThanOrEqual(eventMs(ev[0]));
    expect(t2).toBeLessThan(t1 * 0.6);
    expect(t2).toBeGreaterThanOrEqual(eventMs(ev[0]) / 2 - 10);
  });
});

describe('dice landing before pawn movement', () => {
  it.each([
    { name: 'normal play', speed: 1 },
    { name: 'fast play', speed: 2 },
    { name: 'fast background play', speed: 2, background: true },
    { name: 'queue catch-up', speed: 2, queued: 10 },
    { name: 'reduced motion', speed: 1, reduced: true },
  ])('$name', async ({ speed, background = false, queued = 1, reduced = false }) => {
    const { core, state } = setup({ speed, reduced });
    const actor = background ? 'other' : 'me';
    const actorIndex = background ? 1 : 0;
    const final = structuredClone(state);
    final.players[actorIndex].pos = 1;
    final.dice = [1];
    let previousRolling = false;
    let landedAt;
    let movedAt;
    let settleMs;
    core.subscribe(() => {
      const snapshot = core.getSnapshot();
      if (previousRolling && !snapshot.rolling && landedAt === undefined) {
        landedAt = Date.now();
        settleMs = snapshot.display.diceSettleMs;
      }
      previousRolling = snapshot.rolling;
      if (snapshot.display.players[actorIndex].pos === 1 && movedAt === undefined) movedAt = Date.now();
    });
    core.enqueue([
      { type: 'dice', player: actor, values: [1] },
      { type: 'move', player: actor, from: 0, to: 1, path: [1], passedStart: false },
    ], final);
    for (let i = 1; i < queued; i++) core.enqueue([], final);
    await vi.runAllTimersAsync();
    expect(landedAt).toBeDefined();
    expect(movedAt).toBeDefined();
    expect(movedAt - landedAt).toBeGreaterThanOrEqual(settleMs - 1);
    expect(settleMs).toBeGreaterThanOrEqual(0);
    expect(settleMs).toBeLessThanOrEqual(560);
    if (reduced) expect(settleMs).toBe(0);
    expect(core.getSnapshot().busy).toBe(false);
    expect(core.getSnapshot().display.dice).toEqual([1]);
    core.dispose();
  });
});

describe('moves', () => {
  it('keeps a 35-square trip short and ends on the right square', async () => {
    const { core, state } = setup();
    const final = structuredClone(state);
    final.players[0].pos = 35;
    const path = Array.from({ length: 35 }, (_, i) => i + 1);
    const seen = [];
    core.subscribe(() => seen.push(core.getSnapshot().display.players[0].pos));
    const ms = await timed(core, [{ type: 'move', player: 'me', from: 0, to: 35, path, passedStart: false }], final);
    expect(core.getSnapshot().display.players[0].pos).toBe(35);
    expect(seen).toContain(18);
    expect(ms).toBeLessThan(5000);
    core.dispose();
  });

  it('a ride flags the pawn and skims faster than a walk of the same length', async () => {
    const { core, state } = setup();
    const motions = [];
    core.subscribe(() => motions.push(core.getSnapshot().display.players[0].motion));
    const final = structuredClone(state);
    final.players[0].pos = 14;
    const path = [6, 7, 8, 9, 10, 11, 12, 13, 14];
    const t0 = Date.now();
    core.enqueue([
      { type: 'ride', player: 'me', from: 5, to: 14, fare: 25000 },
      { type: 'move', player: 'me', from: 5, to: 14, path, passedStart: false, ride: true },
    ], final);
    await vi.advanceTimersByTimeAsync(ANIM_MS.ride - 50);
    expect(core.getSnapshot().stageTile).toBe(5);
    expect(core.getSnapshot().display.players[0].motion).toBe('ride');
    while (core.isBusy()) await vi.advanceTimersByTimeAsync(10);
    const rideMs = Date.now() - t0 - ANIM_MS.ride;
    expect(rideMs).toBeLessThan(path.length * ANIM_MS.step * 0.7);
    expect(motions).toContain('ride');
    expect(core.getSnapshot().display.players[0]).toMatchObject({ pos: 14, motion: null });
    core.dispose();
  });

  it('a card move arcs straight to the target with the flight time as stepMs', async () => {
    const { core, state } = setup();
    let teleportStep;
    core.subscribe(() => {
      const d = core.getSnapshot().display;
      if (d.players[0].motion === 'teleport') teleportStep = d.stepMs;
    });
    const final = structuredClone(state);
    final.players[0].pos = 31;
    await timed(core, [{ type: 'move', player: 'me', from: 3, to: 31, path: [], passedStart: false, teleport: true }], final);
    expect(teleportStep).toBe(ANIM_MS.teleportPre + ANIM_MS.teleport);
    expect(core.getSnapshot().display.players[0]).toMatchObject({ pos: 31, motion: null });
    core.dispose();
  });

  it('marks the landing tile for the camera until the item is over', async () => {
    const { core, state } = setup();
    const landings = [];
    core.subscribe(() => landings.push(core.getSnapshot().display.landing));
    const final = structuredClone(state);
    final.players[0].pos = 3;
    core.enqueue([
      { type: 'move', player: 'me', from: 0, to: 3, path: [1, 2, 3], passedStart: false },
      { type: 'land', player: 'me', tile: 3 },
    ], final);
    await vi.advanceTimersByTimeAsync(3 * ANIM_MS.step + 50);
    expect(core.getSnapshot().display.landing).toBe(3);
    expect(core.getSnapshot().stageTile).toBe(3);
    await vi.runAllTimersAsync();
    expect(landings).toContain(3);
    expect(core.getSnapshot().display.landing).toBe(null);
    core.dispose();
  });
});

describe('money flights', () => {
  const rentPair = [
    { type: 'cash', player: 'me', delta: -34000, reason: 'rent', other: 'other' },
    { type: 'cash', player: 'other', delta: 34000, reason: 'rent', other: 'me' },
  ];

  it('a rent pair flies once, payer to payee, then expires', async () => {
    const { core, state } = setup();
    core.enqueue(rentPair, state);
    await vi.advanceTimersByTimeAsync(0);
    const f = core.getSnapshot().flights;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ from: 'me', to: 'other', amount: 34000, reason: 'rent' });
    expect(typeof f[0].id).toBe('string');
    expect(f[0].ms).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(ANIM_MS.rentOut + 100);
    expect(core.getSnapshot().flights).toHaveLength(1); // still in the air while the payee leg plays
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().flights).toEqual([]);
    expect(core.getSnapshot().display.players.map((p) => p.cash)).toEqual([1500000, 1500000]); // snapped to the state
    core.dispose();
  });

  it('salary and card gains come from the bank, payments go to it', async () => {
    const { core, state } = setup();
    const seen = [];
    core.subscribe(() => {
      for (const f of core.getSnapshot().flights) if (!seen.some((s) => s.id === f.id)) seen.push(f);
    });
    core.enqueue([
      { type: 'cash', player: 'me', delta: 200000, reason: 'salary' },
      { type: 'cash', player: 'me', delta: 80000, reason: 'card' },
      { type: 'cash', player: 'me', delta: -60000, reason: 'buy' },
      { type: 'cash', player: 'me', delta: -40000, reason: 'tax' },
      { type: 'cash', player: 'other', delta: -25000, reason: 'fare' },
      { type: 'cash', player: 'me', delta: -30000, reason: 'upgrade' },
      { type: 'cash', player: 'me', delta: 0, reason: 'card' },
    ], state);
    await vi.runAllTimersAsync();
    expect(seen.map((f) => [f.from, f.to, f.amount, f.reason])).toEqual([
      ['bank', 'me', 200000, 'salary'],
      ['bank', 'me', 80000, 'card'],
      ['me', 'bank', 60000, 'buy'],
      ['me', 'bank', 40000, 'tax'],
      ['other', 'bank', 25000, 'fare'],
      ['me', 'bank', 30000, 'upgrade'],
    ]);
    expect(new Set(seen.map((f) => f.id)).size).toBe(seen.length);
    core.dispose();
  });

  it('a "collect from every player" card flies from each payer', async () => {
    const s = makeState();
    s.players.push({ id: 'c', name: 'Chitra', color: '#4f7cff', cash: 1500000, pos: 0 });
    const { core } = setup({ state: s });
    const seen = [];
    core.subscribe(() => {
      for (const f of core.getSnapshot().flights) if (!seen.some((x) => x.id === f.id)) seen.push(f);
    });
    core.enqueue([
      { type: 'cash', player: 'other', delta: -10000, reason: 'card', other: 'me' },
      { type: 'cash', player: 'me', delta: 10000, reason: 'card', other: 'other' },
      { type: 'cash', player: 'c', delta: -10000, reason: 'card', other: 'me' },
      { type: 'cash', player: 'me', delta: 10000, reason: 'card', other: 'c' },
    ], s);
    await vi.runAllTimersAsync();
    expect(seen.map((f) => `${f.from}>${f.to}`)).toEqual(['other>me', 'c>me']);
    core.dispose();
  });

  it('exposes lastCash at the top level too', async () => {
    const { core, state } = setup();
    core.enqueue([{ type: 'cash', player: 'me', delta: 200000, reason: 'salary' }], state);
    await vi.advanceTimersByTimeAsync(0);
    expect(core.getSnapshot().lastCash).toMatchObject({ player: 'me', delta: 200000, reason: 'salary' });
    expect(core.getSnapshot().display.lastCash).toMatchObject({ player: 'me', delta: 200000 });
    core.dispose();
  });

  it('reset() drops flights in the air', async () => {
    const { core, state } = setup();
    core.enqueue(rentPair, state);
    await vi.advanceTimersByTimeAsync(0);
    expect(core.getSnapshot().flights).toHaveLength(1);
    core.reset(state);
    expect(core.getSnapshot().flights).toEqual([]);
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().flights).toEqual([]);
    core.dispose();
  });
});

describe('cards', () => {
  const card = (player, extra = {}) => ({ type: 'card', player, cardId: 'shaadi', kind: 'bad', deck: 'drama', title: 'Shaadi ka season!', text: 'Pay 50,000.', ...extra });

  it('shows the card for the length of the card event, then clears it', async () => {
    const { core, state } = setup();
    core.enqueue([card('me')], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().card).toEqual({ player: 'me', deck: 'drama', title: 'Shaadi ka season!', text: 'Pay 50,000.', kind: 'bad', cardId: 'shaadi' });
    await vi.advanceTimersByTimeAsync(ANIM_MS.card - 100);
    expect(core.getSnapshot().card).not.toBe(null);
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().card).toBe(null);
    core.dispose();
  });

  it('defaults an unknown deck to luck', async () => {
    const { core, state } = setup();
    core.enqueue([card('other', { deck: undefined })], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().card.deck).toBe('luck');
    core.dispose();
  });
});

describe('turn hand-off', () => {
  it('sets handoff during the turn event and clears it after', async () => {
    const { core, state } = setup();
    const final = structuredClone(state);
    final.turn = 1;
    core.enqueue([{ type: 'turn', player: 'other', round: 4 }], final);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().handoff).toEqual({ player: 'other', round: 4, isFinal: false });
    expect(core.getSnapshot().display.turn).toBe(1);
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().handoff).toBe(null);
    core.dispose();
  });

  it('flags the last round as final', async () => {
    const { core, state } = setup({ describe: (ev) => (ev.type === 'turn' ? { text: `Round ${ev.round}` } : null) });
    core.enqueue([{ type: 'turn', player: 'me', round: 20 }], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().handoff).toEqual({ player: 'me', round: 20, isFinal: true });
    await vi.advanceTimersByTimeAsync(ANIM_MS.turn);
    expect(core.getSnapshot().handoff).not.toBe(null); // the final round banner holds longer than a plain hand-off
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().handoff).toBe(null);
    core.dispose();
  });

  it('never final in classic mode (no round limit)', async () => {
    const { core } = setup({ state: makeState({ cfg: { mode: 'classic', maxRounds: null } }) });
    core.enqueue([{ type: 'turn', player: 'me', round: 20 }], makeState());
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().handoff.isFinal).toBe(false);
    core.dispose();
  });

  it('waits the ANIM_MS turn time for a plain hand-off', async () => {
    const { core, state } = setup();
    const ms = await timed(core, [{ type: 'turn', player: 'me', round: 1 }], state);
    expect(ms).toBeGreaterThanOrEqual(ANIM_MS.turn);
    expect(ms).toBeLessThan(ANIM_MS.turn + 100);
    core.dispose();
  });
});

describe('traffic, chai and city events', () => {
  it('a traffic jam marks the player stuck and stages the traffic tile', async () => {
    const { core, state, played } = setup();
    core.enqueue([{ type: 'traffic', player: 'me', stuck: true, reason: 'tile' }], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().display.players[0].stuck).toBe(true);
    expect(core.getSnapshot().stageTile).toBe(9);
    expect(played.length).toBe(1);
    core.enqueue([{ type: 'traffic', player: 'me', stuck: false, reason: 'chai' }], state);
    await vi.runAllTimersAsync();
    core.dispose();
  });

  it('chai updates the token count', async () => {
    const { core, state } = setup();
    core.enqueue([{ type: 'chai', player: 'other', chai: 1, change: 1, reason: 'adda' }], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().display.players[1].chai).toBe(1);
    await vi.runAllTimersAsync();
    core.dispose();
  });

  it('a city event pauses the queue long enough to read it and shows in the display', async () => {
    const { core, state } = setup({ describe: (ev) => (ev.type === 'city_event' ? { text: `${ev.title} ${ev.text}` } : null) });
    const ev = { type: 'city_event', id: 'rush_hour', title: 'Rush Hour!', text: 'Cyberabad rents x1.5.', kind: 'rent', group: 'cyber', mult: 1.5, round: 3 };
    const t0 = Date.now();
    core.enqueue([ev], state);
    await vi.advanceTimersByTimeAsync(1000);
    expect(core.getSnapshot().busy).toBe(true);
    expect(core.getSnapshot().display.event).toMatchObject({ id: 'rush_hour', group: 'cyber', mult: 1.5 });
    await vi.runAllTimersAsync();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(eventMs(ev) - 100);
    expect(core.getSnapshot().log[0].text).toBe('Rush Hour! Cyberabad rents x1.5.');
    core.dispose();
  });

  it('a later round drops the city event', async () => {
    const { core } = setup({ state: makeState({ event: { id: 'festival', title: 'Bonalu', round: 3 } }) });
    expect(core.getSnapshot().display.event).toMatchObject({ id: 'festival' });
    core.enqueue([{ type: 'turn', player: 'me', round: 4 }], makeState());
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().display.event).toBe(null);
    core.dispose();
  });

  it('a top-level upgrade waits longer than a first one', async () => {
    const { core, state } = setup();
    const one = await timed(core, [{ type: 'level', tile: 31, level: 1, reason: 'upgrade' }], state);
    const two = await timed(core, [{ type: 'level', tile: 31, level: 2, reason: 'upgrade' }], state);
    expect(two).toBeGreaterThan(one);
    expect(core.getSnapshot().stageTile).toBe(31);
    core.dispose();
  });
});

describe('reset and removed events', () => {
  it('reset() cancels playback and loads the new state at once', async () => {
    const { core, state } = setup();
    core.enqueue([{ type: 'card', player: 'me', deck: 'luck', title: 'x', text: 'y', kind: 'good', cardId: 'z' }], state);
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().busy).toBe(true);
    const next = makeState();
    next.players[0].pos = 7;
    core.reset(next);
    const s = core.getSnapshot();
    expect(s.busy).toBe(false);
    expect(s.card).toBe(null);
    expect(s.display.players[0].pos).toBe(7);
    expect(s.stageTile).toBe(7);
    await vi.runAllTimersAsync();
    expect(core.getSnapshot().display.players[0].pos).toBe(7); // the cancelled item never snaps over it
    core.dispose();
  });

  it('ignores the removed snatch / shield / trap / jail events without delay', async () => {
    const { core, state } = setup();
    const ms = await timed(core, [
      { type: 'snatch_open', tile: 6 },
      { type: 'shield', player: 'me', tile: 6 },
      { type: 'trap_sprung', tile: 6 },
      { type: 'jail', player: 'me', jailed: true },
      { type: 'token_earned', player: 'me' },
    ], state);
    expect(ms).toBeLessThanOrEqual(10);
    core.dispose();
  });
});

describe('Card clip: the players who get paid hear it', () => {
  const play = async (cardEvent) => {
    vi.useFakeTimers();
    const played = [];
    const core = createPresenterCore({
      meId: 'me', initialState: makeState(),
      deps: {
        loadSettings: () => ({}),
        sfx: { play() {} },
        playCardClip: (cardId) => { played.push(cardId); return true; },
        describeEvent: () => null,
      },
    });
    core.enqueue([cardEvent], makeState());
    await vi.runAllTimersAsync();
    core.dispose();
    return played;
  };
  const card = (player, cardId) => ({ type: 'card', player, cardId, kind: 'bad', deck: 'luck', title: 'Paytm Karo!', text: 't' });

  it('plays the Paytm clip when somebody else draws the card', async () => {
    expect(await play(card('other', 'paytm_100'))).toEqual(['paytm_100']);
  });

  it('does not play it for the player who has to pay', async () => {
    expect(await play(card('me', 'paytm_100'))).toEqual([]);
  });

  it('does not play it for other cards', async () => {
    expect(await play(card('other', 'biryani_promise'))).toEqual([]);
  });
});
