import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIM_MS } from '@shared/timing.js';
import { POWER_MS_FALLBACK, createPresenterCore } from './usePresenter.js';
import { SFX_NAMES } from '../sfx.js';
import { PATTERNS } from '../haptics.js';

// The four power-card beats (docs/POWER_CARDS.md section 3.3): each commits a `power` moment, plays its sound, buzzes the
// local player, waits its ANIM_MS key and clears the moment. Never replays after reset, silent while catching up.
const N = 36;
const hand = (...ids) => ids.map((id, i) => ({ uid: `c${i}-${id}`, id, exp: 4 }));
const makeState = (myHand = []) => ({
  players: [
    { id: 'me', name: 'Asha', color: '#ff4d6d', piece: 'auto', cash: 1500000, pos: 3, stuck: false, chai: 0, bankrupt: false, laps: 0, hand: myHand },
    { id: 'other', name: 'Bala', color: '#3ddc97', piece: 'pearl', cash: 1500000, pos: 9, stuck: false, chai: 0, bankrupt: false, laps: 0, hand: [{ hidden: true }] },
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

function rig({ reduced = false, initial = makeState() } = {}) {
  vi.useFakeTimers();
  const sounds = [];
  const buzzes = [];
  const core = createPresenterCore({
    meId: 'me',
    initialState: initial,
    deps: {
      loadSettings: () => ({ reducedMotion: reduced }),
      sfx: { play: (n, o) => sounds.push([n, o]) },
      buzz: (k) => buzzes.push(k),
      describeEvent: (ev) => ({ text: ev.type, tone: 'info' }),
      playCardClip: () => true,
    },
  });
  return { core, sounds, buzzes, names: () => sounds.map((s) => s[0]) };
}

const power = (core) => core.getSnapshot().power;
const settle = async (core) => {
  while (core.isBusy()) await vi.advanceTimersByTimeAsync(10);
};

afterEach(() => vi.useRealTimers());

describe('power timing keys', () => {
  it('shared/timing.js carries the four keys (the server derives its decision timers from them)', () => {
    for (const k of Object.keys(POWER_MS_FALLBACK)) {
      expect(ANIM_MS[k], `ANIM_MS.${k} is missing: the engine work must add it`).toBe(POWER_MS_FALLBACK[k]);
    }
  });
  it('every sound and haptic the beats use exists', () => {
    for (const n of ['powerDraw', 'powerPlay', 'powerShield', 'powerDouble', 'powerSwap', 'powerSteal', 'powerExpire']) {
      expect(SFX_NAMES).toContain(n);
      expect(PATTERNS[n], n).toBeDefined();
    }
  });
});

const BEATS = [
  ['power_draw', { type: 'power_draw', player: 'other', source: 'turn' }, 'powerDraw', 'draw', 'powerDraw'],
  ['power_play', { type: 'power_play', player: 'other', card: 'shield' }, 'powerPlay', 'play', 'powerPlay'],
  ['power_trigger (shield)', { type: 'power_trigger', player: 'other', card: 'shield', amount: 42000, other: 'me' }, 'powerShield', 'shield', 'powerTrigger'],
  ['power_trigger (double)', { type: 'power_trigger', player: 'other', card: 'double', amount: 30000, other: 'me' }, 'powerDouble', 'double', 'powerTrigger'],
  ['power_expire', { type: 'power_expire', player: 'other', count: 2 }, 'powerExpire', 'expire', 'powerExpire'],
];

describe.each(BEATS)('%s', (_name, ev, sound, kind, key) => {
  it('commits the moment, plays the sound, waits its key, then clears it', async () => {
    const { core, names } = rig();
    const ms = ANIM_MS[key] ?? POWER_MS_FALLBACK[key];
    core.enqueue([ev], makeState());
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core)).toMatchObject({ kind, player: 'other' });
    expect(power(core).ms).toBe(ms);
    expect(names()).toContain(sound);
    await vi.advanceTimersByTimeAsync(ms - 50);
    expect(power(core)).not.toBeNull(); // still on screen just before its time
    await vi.advanceTimersByTimeAsync(100);
    expect(power(core)).toBeNull();
    await settle(core);
    expect(core.isBusy()).toBe(false);
    core.dispose();
  });

  it("another player's beat never vibrates my phone", async () => {
    const { core, buzzes } = rig();
    core.enqueue([ev], makeState());
    await settle(core);
    expect(buzzes).toEqual([]);
    core.dispose();
  });

  it('my own beat buzzes once with its pattern', async () => {
    const { core, buzzes } = rig();
    core.enqueue([{ ...ev, player: 'me', ...(ev.other ? { other: 'other' } : null) }], makeState());
    await settle(core);
    expect(buzzes).toEqual([sound]);
    core.dispose();
  });

  it('is gone after a reset and never comes back (resume replays nothing)', async () => {
    const { core, sounds } = rig();
    core.enqueue([ev], makeState());
    await vi.advanceTimersByTimeAsync(200);
    expect(power(core)).not.toBeNull();
    const before = sounds.length;
    core.reset(makeState());
    expect(power(core)).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(power(core)).toBeNull();
    expect(sounds.length).toBe(before);
    expect(core.isBusy()).toBe(false);
    core.dispose();
  });

  it('is silent and shows nothing while the presenter is catching up', async () => {
    const { core, sounds, buzzes } = rig();
    const seen = [];
    core.subscribe(() => seen.push(power(core)));
    for (let i = 0; i < 8; i += 1) core.enqueue([{ ...ev, player: 'me', ...(ev.other ? { other: 'other' } : null) }], makeState());
    await vi.advanceTimersByTimeAsync(20); // the first item plays with seven more queued behind it
    expect(sounds).toEqual([]);
    expect(buzzes).toEqual([]);
    expect(seen.filter(Boolean)).toEqual([]);
    await settle(core);
    core.dispose();
  });

  it('under reduced motion the moment is still shown, but shorter', async () => {
    const { core } = rig({ reduced: true });
    core.enqueue([ev], makeState());
    await vi.advanceTimersByTimeAsync(5);
    const ms = ANIM_MS[key] ?? POWER_MS_FALLBACK[key];
    expect(power(core).ms).toBeLessThan(ms);
    expect(power(core).ms).toBeGreaterThan(0);
    await settle(core);
    expect(power(core)).toBeNull();
    core.dispose();
  });
});

describe('moment payloads', () => {
  it('draw: a rival draw has no card, mine carries the card found by diffing my hand', async () => {
    const start = makeState(hand('shield'));
    const { core } = rig({ initial: start });
    const next = makeState([...hand('shield'), { uid: 'new1', id: 'swap', exp: 5 }]);
    core.enqueue([{ type: 'power_draw', player: 'me', source: 'tile', tile: 7 }], next);
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core)).toMatchObject({ kind: 'draw', source: 'tile', tile: 7, card: { uid: 'new1', id: 'swap', exp: 5 } });
    await settle(core);

    core.enqueue([{ type: 'power_draw', player: 'other', source: 'turn' }], next);
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core).card).toBeUndefined();
    expect(power(core)).toMatchObject({ kind: 'draw', source: 'turn' });
    await settle(core);
    core.dispose();
  });

  it('draw: two of my draws in one item reveal the two new cards in order', async () => {
    const { core } = rig({ initial: makeState([]) });
    const next = makeState([{ uid: 'a', id: 'shield', exp: 4 }, { uid: 'b', id: 'steal', exp: 4 }]);
    core.enqueue([{ type: 'power_draw', player: 'me', source: 'tile', tile: 2 }, { type: 'power_draw', player: 'me', source: 'turn' }], next);
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core).card.uid).toBe('a');
    await vi.advanceTimersByTimeAsync(ANIM_MS.powerDraw ?? 900);
    expect(power(core).card.uid).toBe('b');
    await settle(core);
    core.dispose();
  });

  it('draw: after a reset the cards already in the snapshot are not "new"', async () => {
    const { core } = rig({ initial: makeState([]) });
    const snap = makeState(hand('shield'));
    core.reset(snap);
    core.enqueue([{ type: 'power_draw', player: 'me', source: 'turn' }], snap); // e.g. the card is already known: no diff
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core).card).toBeUndefined();
    await settle(core);
    core.dispose();
  });

  it('play carries the card and the swap target; trigger carries the amount and the other side', async () => {
    const { core } = rig();
    core.enqueue([{ type: 'power_play', player: 'me', card: 'swap', target: 'other' }], makeState());
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core)).toMatchObject({ kind: 'play', card: 'swap', target: 'other' });
    await settle(core);
    core.enqueue([{ type: 'power_trigger', player: 'me', card: 'double', amount: 30000, other: 'other' }], makeState());
    await vi.advanceTimersByTimeAsync(5);
    expect(power(core)).toMatchObject({ kind: 'double', card: 'double', amount: 30000, other: 'other' });
    await settle(core);
    core.dispose();
  });

  it('every moment gets a fresh id (the view keys its animation on it)', async () => {
    const { core } = rig();
    const ids = [];
    core.subscribe(() => {
      const p = power(core);
      if (p && !ids.includes(p.id)) ids.push(p.id);
    });
    core.enqueue([{ type: 'power_play', player: 'other', card: 'shield' }, { type: 'power_expire', player: 'other', count: 1 }], makeState());
    await settle(core);
    expect(ids.length).toBe(2);
    core.dispose();
  });
});

describe('sounds', () => {
  it('a swap and a steal add their own sound after the slam', async () => {
    for (const [card, extra] of [['swap', 'powerSwap'], ['steal', 'powerSteal']]) {
      const { core, names } = rig();
      core.enqueue([{ type: 'power_play', player: 'other', card, ...(card === 'swap' ? { target: 'me' } : null) }], makeState());
      await settle(core);
      expect(names()).toEqual(['powerPlay', extra]);
      core.dispose();
      vi.useRealTimers();
    }
  });

  it('a shield and a double play only the slam on the play (the trigger has its own sound)', async () => {
    const { core, names } = rig();
    core.enqueue([{ type: 'power_play', player: 'other', card: 'double' }], makeState());
    await settle(core);
    expect(names()).toEqual(['powerPlay']);
    core.dispose();
  });

  it("falls back to an existing sound when the table lacks one (an older sound set)", async () => {
    vi.useFakeTimers();
    const sounds = [];
    const core = createPresenterCore({
      meId: 'me',
      initialState: makeState(),
      deps: { loadSettings: () => ({}), sfx: { play: (n) => sounds.push(n) }, sfxNames: ['card', 'click', 'coin'], buzz: () => {}, describeEvent: () => null, playCardClip: () => true },
    });
    core.enqueue([{ type: 'power_draw', player: 'other', source: 'turn' }, { type: 'power_expire', player: 'other', count: 1 }, { type: 'power_trigger', player: 'other', card: 'shield', amount: 1 }], makeState());
    await settle(core);
    expect(sounds).toEqual(['card', 'click', 'coin']);
    core.dispose();
  });
});

describe('swap tiles', () => {
  it('the two teleport moves are told by the swap line: no extra log lines, no flip sound', async () => {
    const { core, names } = rig();
    core.enqueue([
      { type: 'power_play', player: 'other', card: 'swap', target: 'me' },
      { type: 'move', player: 'other', from: 9, to: 3, path: [3], passedStart: false, teleport: true },
      { type: 'move', player: 'me', from: 3, to: 9, path: [9], passedStart: false, teleport: true },
    ], makeState());
    await settle(core);
    expect(core.getSnapshot().log.map((l) => l.text)).toEqual(['power_play']);
    expect(names()).not.toContain('card');
    core.dispose();
  });

  it('a later teleport (a card sending a pawn) is logged as before', async () => {
    const { core } = rig();
    core.enqueue([{ type: 'move', player: 'other', from: 9, to: 3, path: [3], passedStart: false, teleport: true }], makeState());
    await settle(core);
    expect(core.getSnapshot().log.map((l) => l.text)).toEqual(['move']);
    core.dispose();
  });
});

describe('log', () => {
  it('each power event reaches the log once and none of them raises the centre bubble', async () => {
    const { core } = rig();
    core.enqueue([
      { type: 'power_draw', player: 'other', source: 'turn' },
      { type: 'power_play', player: 'other', card: 'shield' },
      { type: 'power_trigger', player: 'other', card: 'shield', amount: 5 },
      { type: 'power_expire', player: 'other', count: 1 },
    ], makeState());
    await settle(core);
    const snap = core.getSnapshot();
    expect(snap.log.map((l) => l.text)).toEqual(['power_draw', 'power_play', 'power_trigger', 'power_expire']);
    expect(snap.bubble).toBeNull();
    core.dispose();
  });
});
