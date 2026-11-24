import { describe, expect, it } from 'vitest';
import {
  COMBO_LADDER, COOLDOWN_MS, MAX_STEPS, MAX_STEPS_OTHERS, OTHERS_GAIN, PRIORITY, collectTier, comboSteps, createVoiceLimiter, panOfX,
  soundsForEvent, soundsForMove,
} from './mapping.js';

const one = (ev, ctx) => {
  const r = soundsForEvent(ev, ctx);
  expect(r.length, JSON.stringify(ev)).toBe(1);
  return r[0];
};

describe('soundsForEvent: engine event -> sound', () => {
  it('maps every event of the plan to its sound', () => {
    const table = [
      [{ type: 'cook-start', station: 'tawa1', slot: 0, dish: 'dosa', by: 'a' }, 'sizzle'],
      [{ type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa' }, 'ding'],
      [{ type: 'burnt', station: 'tawa1', slot: 0, dish: 'dosa' }, 'burnt'],
      [{ type: 'burnt-cleared', station: 'tawa1', slot: 0, by: 'a' }, 'scrape'],
      [{ type: 'take', station: 'tawa1', slot: 0, dish: 'dosa', q: 'good', by: 'a' }, 'take'],
      [{ type: 'serve', customer: 'c1', dish: 'dosa', by: 'a' }, 'serve'],
      [{ type: 'customer-arrive', customer: 'c1', spot: 2 }, 'kring'],
      [{ type: 'customer-turned-away', customer: 'c1' }, 'turnaway'],
      [{ type: 'eating', customer: 'c1' }, 'eat'],
      [{ type: 'pay-ready', customer: 'c1' }, 'payReady'],
      [{ type: 'pay-warning', customer: 'c1' }, 'payWarning'],
      [{ type: 'collect', customer: 'c1', amount: 90, tip: 5, by: 'a', combo: 2 }, 'collect'],
      [{ type: 'customer-angry', customer: 'c1' }, 'angry'],
      [{ type: 'customer-unpaid', customer: 'c1', owed: 90 }, 'unpaid'],
      [{ type: 'discard', dish: 'dosa', by: 'a' }, 'discard'],
      [{ type: 'life-lost', lives: 4 }, 'lifeLost'],
      [{ type: 'combo', combo: 3 }, 'combo'],
      [{ type: 'emote', by: 'a', e: 'fire' }, 'emote'],
      [{ type: 'shift-end', status: 'done', stars: 2 }, 'fanfare'],
      [{ type: 'shift-end', status: 'closed', stars: 0 }, 'closed'],
    ];
    for (const [ev, name] of table) {
      const s = one(ev);
      expect(s.name, ev.type).toBe(name);
      expect(s.priority, name).toBe(PRIORITY[name]);
    }
  });

  it('is silent for tick, tutorial-spawn, unknown and malformed events', () => {
    for (const ev of [{ type: 'tick', tick: 3 }, { type: 'tutorial-spawn', customer: 'c1' }, { type: 'nope' }, {}, null, undefined, 'x', { type: 'combo', combo: 1 }]) {
      expect(soundsForEvent(ev)).toEqual([]);
    }
  });

  it('picks the cooking voice by station kind (and falls back to the dish)', () => {
    const kind = (ev) => one({ type: 'cook-start', slot: 0, by: 'a', ...ev }).opts.kind;
    expect(kind({ station: 'tawa2', dish: 'dosa' })).toBe('tawa');
    expect(kind({ station: 'kadai1', dish: 'vada' })).toBe('kadai');
    expect(kind({ station: 'steamer1', dish: 'idly' })).toBe('steamer');
    expect(kind({ station: 'chai1', dish: 'irani_chai' })).toBe('chai');
    expect(kind({ station: 'unknown', dish: 'poori' })).toBe('kadai');
    expect(one({ type: 'ready', station: 'chai1', dish: 'osmania' }).opts.kind).toBe('chai');
  });

  it('makes other players quieter than you', () => {
    const me = soundsForEvent({ type: 'serve', customer: 'c', by: 'a' }, { meId: 'a' })[0];
    const other = soundsForEvent({ type: 'serve', customer: 'c', by: 'b' }, { meId: 'a' })[0];
    expect(me.gain).toBe(1);
    expect(other.gain).toBe(OTHERS_GAIN);
    expect(soundsForEvent({ type: 'serve', customer: 'c', by: 'b' })[0].gain).toBe(1); // meId unknown
    expect(one({ type: 'burnt', station: 'tawa1' }, { meId: 'a' }).gain).toBe(1); // stall-wide events are never reduced
  });

  it('places sounds in the stereo field by station and customer spot, gently', () => {
    const left = one({ type: 'customer-arrive', customer: 'c', spot: 0 }).opts.pan;
    const right = one({ type: 'customer-arrive', customer: 'c', spot: 5 }).opts.pan;
    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(left)).toBeLessThanOrEqual(0.7);
    expect(one({ type: 'ready', station: 'chai1', dish: 'x' }).opts.pan).toBeGreaterThan(0);
    expect(one({ type: 'ready', station: 'tawa1', dish: 'x' }).opts.pan).toBeLessThan(0);
    const state = { customers: [{ id: 'c9', spot: 5 }] };
    expect(one({ type: 'eating', customer: 'c9' }, { state }).opts.pan).toBeGreaterThan(0);
    expect(one({ type: 'eating', customer: 'ghost' }, { state }).opts.pan).toBe(0);
    expect(panOfX(100)).toBeLessThanOrEqual(0.7);
    expect(panOfX(NaN)).toBe(0);
  });

  it('scales the collect jingle by amount and climbs with the combo', () => {
    expect([collectTier(0), collectTier(30), collectTier(69), collectTier(70), collectTier(159), collectTier(160), collectTier(900)]).toEqual([0, 0, 0, 1, 1, 2, 2]);
    const steps = [0, 1, 2, 3, 4, 5, 8, 12, 99].map(comboSteps);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[0]).toBe(0);
    expect(comboSteps(99)).toBe(COMBO_LADDER.at(-1));
    expect(comboSteps(2)).toBeGreaterThan(comboSteps(1));
    const big = one({ type: 'collect', customer: 'c', amount: 240, tip: 20, combo: 4, by: 'a' });
    expect(big.opts).toMatchObject({ amount: 240, tier: 2, steps: comboSteps(4) });
  });

  it('plays the fanfare with 1..3 stars and a sigh for a closed centre', () => {
    expect(one({ type: 'shift-end', status: 'done', stars: 3 }).opts.stars).toBe(3);
    expect(one({ type: 'shift-end', status: 'done', stars: 0 }).opts.stars).toBe(1); // the tutorial finishes with no stars
    expect(one({ type: 'shift-end', status: 'done', stars: 9 }).opts.stars).toBe(3);
    expect(one({ type: 'shift-end', status: 'closed', stars: 0 }).name).toBe('closed');
  });

  it('has a cooldown and a priority for every sound', () => {
    for (const name of Object.keys(PRIORITY)) {
      expect(COOLDOWN_MS[name], name).toBeGreaterThan(0);
      expect(PRIORITY[name], name).toBeGreaterThan(0);
    }
    expect(PRIORITY.fanfare).toBeGreaterThan(PRIORITY.collect);
    expect(PRIORITY.lifeLost).toBeGreaterThan(PRIORITY.sizzle);
  });
});

describe('soundsForMove: footsteps', () => {
  it('taps along the walk, soft, with more steps for a longer walk', () => {
    const short = soundsForMove('tawa1', 'steamer1')[0];
    const long = soundsForMove('tawa1', 'chai1')[0];
    expect(short.name).toBe('steps');
    expect(long.opts.times.length).toBeGreaterThanOrEqual(short.opts.times.length);
    expect(long.opts.times.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(long.opts.times).toEqual([...long.opts.times].sort((a, b) => a - b));
    expect(long.gain).toBeLessThan(1);
  });
  it('is faint and short for other people, and silent when nobody moved', () => {
    const mine = soundsForMove('tawa1', 'chai1', { mine: true })[0];
    const theirs = soundsForMove('tawa1', 'chai1', { mine: false, key: 'b' })[0];
    expect(theirs.gain).toBeLessThan(mine.gain);
    expect(theirs.opts.times.length).toBeLessThanOrEqual(MAX_STEPS_OTHERS);
    expect(theirs.key).toBe('steps:b');
    expect(soundsForMove('tawa1', 'tawa1')).toEqual([]);
    expect(soundsForMove(null, null)).toEqual([]);
  });
  it('understands spots and the bin', () => {
    expect(soundsForMove('spot:0', 'bin').length).toBe(1);
    expect(soundsForMove('spot:0', 'spot:5')[0].opts.times.length).toBeGreaterThan(1);
  });
});

describe('createVoiceLimiter', () => {
  it('enforces the per-sound cooldown (and a separate one per key)', () => {
    const l = createVoiceLimiter({ cooldowns: { a: 100 } });
    expect(l.request('a', 1, 1000).ok).toBe(true);
    expect(l.request('a', 1, 1050)).toEqual({ ok: false, reason: 'cooldown' });
    expect(l.request('a', 1, 1100).ok).toBe(true);
    expect(l.request('b', 1, 1100).ok).toBe(true); // no cooldown configured
    expect(l.request('a', 1, 1150, 'k2').ok).toBe(true); // another key
    expect(l.request('a', 1, 1160, 'k2').ok).toBe(false);
  });

  it('caps the polyphony: steals the weakest for a more important sound, drops a less important one', () => {
    const l = createVoiceLimiter({ maxVoices: 3, cooldowns: {} });
    const a = l.request('low', 1, 0);
    l.request('mid', 5, 1);
    l.request('mid2', 5, 2);
    expect(l.count()).toBe(3);
    expect(l.request('lower', 0, 3)).toEqual({ ok: false, reason: 'cap' });
    const big = l.request('big', 9, 4);
    expect(big.ok).toBe(true);
    expect(big.steal).toBe(a.id); // the weakest went
    expect(l.count()).toBe(3);
    // same priority steals the oldest of the weakest
    l.request('mid3', 5, 5);
    expect(l.count()).toBe(3);
  });

  it('frees a voice on end() and forgets stuck voices after maxLife', () => {
    const l = createVoiceLimiter({ maxVoices: 1, cooldowns: {}, maxLife: 1000 });
    const a = l.request('x', 9, 0);
    expect(l.request('y', 1, 10).ok).toBe(false);
    l.end(a.id);
    expect(l.request('y', 1, 20).ok).toBe(true);
    expect(l.request('z', 1, 5000).ok).toBe(true); // y was stuck for > maxLife, so it is gone: no steal needed
    expect(l.count()).toBe(1);
  });

  it('keeps four players from overloading: a burst of identical events plays once per cooldown', () => {
    const l = createVoiceLimiter();
    let played = 0;
    for (let i = 0; i < 40; i++) if (l.request('take', PRIORITY.take, 5000 + i).ok) played++;
    expect(played).toBe(1);
    expect(l.count()).toBeLessThanOrEqual(12);
  });
});
