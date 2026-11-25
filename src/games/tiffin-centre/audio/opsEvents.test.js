// The operations layer through the public faces: event -> sounds (mapping), event -> vibration (haptics), and createTiffinAudio
// (loops follow the state, the hush, the mute, caps, junk events).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { createSynth } from '@/lib/soundscape/synth.js';
import { createTiffinAudio } from './index.js';
import { HAPTIC_PATTERNS, hapticFor } from './haptics.js';
import { COOLDOWN_MS, MAX_VOICES, PRIORITY, soundsForEvent } from './mapping.js';
import { RECIPES } from './recipes.js';

const names = (ev, ctx) => soundsForEvent(ev, ctx).map((s) => s.name);

describe('event -> sounds', () => {
  it.each([
    [{ type: 'event-start', id: 'rain' }, ['thunder']],
    [{ type: 'event-start', id: 'power' }, ['powerCut']],
    [{ type: 'event-start', id: 'festival' }, ['festivalStart']],
    [{ type: 'event-start', id: 'inspector' }, ['whistle']],
    [{ type: 'event-start', id: 'delivery' }, ['bikeHorn']],
    [{ type: 'event-start', id: 'cricket' }, []],
    [{ type: 'event-end', id: 'power' }, ['powerRestore']],
    [{ type: 'event-end', id: 'rain' }, []],
    [{ type: 'inspector', pass: true, bonus: 80 }, ['inspectorPass']],
    [{ type: 'inspector', pass: false, fine: 56, why: ['burnt'] }, ['inspectorFail']],
    [{ type: 'gas-low', units: 200 }, ['gasHiss']],
    [{ type: 'gas-out' }, ['flameOut']],
    [{ type: 'gas-swap', phase: 'start' }, ['gasClank']],
    [{ type: 'gas-swap', phase: 'done' }, ['gasClank', 'flameRelight']],
    [{ type: 'gas-swap' }, []],
    [{ type: 'prep-start', station: 'prep1', slot: 0, item: 'batter_dosa' }, ['prepStart']],
    [{ type: 'prep-done', station: 'prep1', slot: 0, item: 'batter_dosa' }, ['prepDone']],
    [{ type: 'prep-collect', station: 'prep1', slot: 1, item: 'sambar' }, ['prepCollect']],
    [{ type: 'tend', station: 'tawa1', kind: 'wipe' }, ['tend']],
    [{ type: 'heat-warning', station: 'tawa1', band: 'hot' }, ['heatHot']],
    [{ type: 'heat-warning', station: 'tawa1', band: 'cold' }, ['heatCold']],
    [{ type: 'heat-warning', station: 'steamer1', band: 'dry' }, ['heatDry']],
    [{ type: 'heat-warning', station: 'tawa1', band: 'lukewarm' }, []],
    [{ type: 'stock-low', item: 'sambar', n: 3 }, ['stockLow']],
    [{ type: 'stock-out', item: 'sambar' }, ['stockOut']],
    [{ type: 'stock-spoiled', item: 'batter_dosa', n: 4 }, ['stockSpoiled']],
    [{ type: 'batter-sour', item: 'batter_dosa' }, ['stockSpoiled']],
    [{ type: 'sold-out', customer: 'c1', dish: 'dosa' }, ['chalk']],
    [{ type: 'board', dish: 'dosa', on: false }, ['chalk']],
    [{ type: 'buy', item: 'oil', n: 2 }, ['buy']],
    [{ type: 'parcel-order', customer: 'c1', n: 3, big: true }, ['parcel']],
    [{ type: 'extra', customer: 'c1', item: 'sambar' }, ['extra']],
    [{ type: 'eating', customer: 'c1', parcel: true }, ['parcel']],
    [{ type: 'eating', customer: 'c1' }, ['eat']],
  ])('%j -> %j', (ev, expected) => {
    expect(names(ev)).toEqual(expected);
  });

  it('carries the right options', () => {
    expect(soundsForEvent({ type: 'prep-start', station: 'prep1', slot: 0, item: 'coconut_chutney' })[0].opts.kind).toBe('stone');
    expect(soundsForEvent({ type: 'prep-start', station: 'prep1', slot: 0, item: 'sambar' })[0].opts.kind).toBe('pot');
    expect(soundsForEvent({ type: 'prep-done', station: 'prep1', slot: 0, item: 'batter_idly' })[0].opts.kind).toBe('batter');
    expect(soundsForEvent({ type: 'gas-swap', phase: 'done' })[0].opts.phase).toBe('done');
    expect(soundsForEvent({ type: 'parcel-order', big: true })[0].opts.foil).toBe(true);
    expect(soundsForEvent({ type: 'parcel-order', delivery: true })[0].opts.foil).toBe(true);
    expect(soundsForEvent({ type: 'parcel-order' })[0].opts.foil).toBe(false);
    expect(soundsForEvent({ type: 'batter-sour', item: 'x' })[0].opts.sour).toBe(true);
    expect(soundsForEvent({ type: 'board', dish: 'dosa', on: false })[0].opts.on).toBe(false);
    expect(soundsForEvent({ type: 'board', dish: 'dosa', on: true })[0].opts.on).toBe(true);
    expect(soundsForEvent({ type: 'sold-out' })[0].opts.on).toBe(true);
  });

  it('tend falls back to the station kind when the event has no kind', () => {
    const kind = (station) => soundsForEvent({ type: 'tend', station })[0].opts.kind;
    expect(kind('tawa1')).toBe('wipe');
    expect(kind('kadai1')).toBe('skim');
    expect(kind('steamer1')).toBe('water');
    expect(kind(undefined)).toBe('wipe');
  });

  it('other players\' work is quieter than yours; stall-wide events are not', () => {
    const g = (ev) => soundsForEvent(ev, { meId: 'me' })[0].gain;
    expect(g({ type: 'tend', station: 'tawa1', kind: 'wipe', by: 'other' })).toBeLessThan(g({ type: 'tend', station: 'tawa1', kind: 'wipe', by: 'me' }));
    expect(g({ type: 'prep-start', station: 'prep1', slot: 0, item: 'sambar', by: 'other' })).toBeLessThan(1);
    expect(g({ type: 'gas-out', by: 'other' })).toBe(1);
    expect(g({ type: 'event-start', id: 'rain' })).toBe(1);
  });

  it('tolerates events with missing fields', () => {
    for (const type of ['event-start', 'event-end', 'inspector', 'gas-low', 'gas-out', 'gas-swap', 'prep-start', 'prep-done', 'prep-collect', 'tend', 'heat-warning', 'stock-low', 'stock-out', 'stock-spoiled', 'batter-sour', 'sold-out', 'board', 'buy', 'parcel-order', 'extra']) {
      expect(() => soundsForEvent({ type }), type).not.toThrow();
      expect(Array.isArray(soundsForEvent({ type })), type).toBe(true);
    }
    expect(soundsForEvent({ type: 'event-start' })).toEqual([]);
    expect(soundsForEvent({ type: 'something-new' })).toEqual([]);
  });

  it('every mapped sound has a recipe, a priority and a cooldown', () => {
    const evs = [
      { type: 'event-start', id: 'rain' }, { type: 'event-start', id: 'power' }, { type: 'event-start', id: 'festival' }, { type: 'event-start', id: 'inspector' },
      { type: 'event-start', id: 'delivery' }, { type: 'event-end', id: 'power' }, { type: 'inspector', pass: true }, { type: 'inspector', pass: false }, { type: 'gas-low' },
      { type: 'gas-out' }, { type: 'gas-swap', phase: 'start' }, { type: 'gas-swap', phase: 'done' }, { type: 'prep-start', item: 'oil' }, { type: 'prep-done', item: 'oil' },
      { type: 'prep-collect' }, { type: 'tend', kind: 'skim' }, { type: 'heat-warning', band: 'hot' }, { type: 'heat-warning', band: 'cold' }, { type: 'heat-warning', band: 'dry' },
      { type: 'stock-low' }, { type: 'stock-out' }, { type: 'stock-spoiled' }, { type: 'batter-sour' }, { type: 'sold-out' }, { type: 'board', on: true }, { type: 'buy' },
      { type: 'parcel-order' }, { type: 'extra' },
    ];
    for (const ev of evs) {
      for (const s of soundsForEvent(ev)) {
        expect(RECIPES[s.name], s.name).toBeTypeOf('function');
        expect(s.priority, s.name).toBeGreaterThan(0);
        expect(COOLDOWN_MS[s.name], s.name).toBeGreaterThan(0);
        expect(PRIORITY[s.name]).toBe(s.priority);
      }
    }
    expect(PRIORITY.flameOut).toBeGreaterThan(PRIORITY.sizzle);
  });
});

describe('recipes of the operations layer', () => {
  const run = (name, opts) => {
    const c = new FakeAudioContext();
    const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
    RECIPES[name](createSynth(c, c.createGain(), voice), 1, opts);
    return { c, voice };
  };
  it('each option set produces sound within 2.6 s', () => {
    const sets = {
      prepStart: ['batter', 'stone', 'dough', 'tin', 'pot', undefined].map((kind) => ({ kind })),
      prepDone: [{ kind: 'batter' }, {}],
      tend: ['wipe', 'skim', 'water', undefined].map((kind) => ({ kind })),
      gasClank: [{ phase: 'start' }, { phase: 'done' }],
      flameRelight: [{ delay: 0.5 }, {}],
      parcel: [{ foil: true }, {}],
      chalk: [{ on: true }, { on: false }],
      stockSpoiled: [{ sour: true }, {}],
      thunder: [{ long: false }, {}],
    };
    for (const [name, list] of Object.entries(sets)) {
      for (const opts of list) {
        const { c } = run(name, { pan: 0.2, ...opts });
        expect(c.sources.length, name).toBeGreaterThan(0);
        for (const s of c.sources) expect(s.stopAt - 1, `${name} ${JSON.stringify(opts)}`).toBeLessThan(2.6);
      }
    }
  });
  it('the grinder winding down and the batter pour are only for batter', () => {
    expect(run('prepDone', { kind: 'batter' }).c.sources.length).toBeGreaterThan(run('prepDone', {}).c.sources.length);
    expect(run('parcel', { foil: true }).c.sources.length).toBeGreaterThan(run('parcel', {}).c.sources.length);
    expect(run('stockSpoiled', {}).c.sources.length).toBeGreaterThan(run('stockSpoiled', { sour: true }).c.sources.length);
  });
});

describe('event -> vibration', () => {
  it('gas-out is heavy, the inspector is a double, neither depends on who did it', () => {
    expect(hapticFor({ type: 'gas-out' })).toBe(HAPTIC_PATTERNS.gasOut);
    expect(HAPTIC_PATTERNS.gasOut.reduce((a, b) => a + b, 0)).toBeGreaterThan(150);
    expect(hapticFor({ type: 'inspector', pass: true })).toBe(HAPTIC_PATTERNS.inspector);
    expect(hapticFor({ type: 'inspector', pass: false })).toBe(HAPTIC_PATTERNS.inspector);
    expect(HAPTIC_PATTERNS.inspector.length).toBe(3); // buzz, rest, buzz
    expect(hapticFor({ type: 'gas-low' })).toBeNull();
    expect(hapticFor({ type: 'tend' })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ createTiffinAudio

let ctx;
let clock;
let intervals;
let hubSettings;
let listeners;
let buzz;
const timers = {
  setInterval: (fn, ms) => (intervals.push({ fn, ms }), intervals.length),
  clearInterval: (id) => {
    intervals[id - 1] = null;
  },
};
const settings = { load: () => hubSettings, subscribe: (cb) => (listeners.push(cb), () => listeners.splice(listeners.indexOf(cb), 1)) };
const make = (extra = {}) => createTiffinAudio({ getAudioContext: () => ctx, settings, now: () => clock, timers, rng: () => 0.3, buzz, doc: null, ...extra });
const st = (extra = {}) => ({ cfg: { hour: [13.5, 13.5], spots: 4 }, shiftTicks: 100, tick: 1, customers: [], players: {}, ...extra });
const prep = (...items) => ({ stations: { prep1: { slots: items.map((item) => (item ? { st: 'cooking', item } : { st: 'empty' })) } } });
const started = () => {
  const a = make();
  a.unlock();
  a.startAmbience();
  return a;
};

beforeEach(() => {
  ctx = new FakeAudioContext();
  hubSettings = { sfx: true, volume: 0.8, sfxVolume: 1, haptics: true };
  listeners = [];
  clock = 10000;
  intervals = [];
  buzz = vi.fn();
});

describe('createTiffinAudio: the operations layer', () => {
  it('plays a sound for each new event, one at a time (cooldowns, the voice cap)', () => {
    const a = make();
    a.unlock();
    const evs = [
      { type: 'event-start', id: 'rain' }, { type: 'gas-low', units: 200 }, { type: 'gas-out' }, { type: 'gas-swap', phase: 'start' }, { type: 'prep-start', station: 'prep1', slot: 0, item: 'sambar' },
      { type: 'tend', station: 'tawa1', kind: 'wipe' }, { type: 'heat-warning', station: 'tawa1', band: 'hot' }, { type: 'stock-out', item: 'sambar' }, { type: 'buy', item: 'oil', n: 1 },
    ];
    for (const ev of evs) {
      clock += 5000;
      expect(a.handleEvents([ev], null), ev.type).toBe(1);
    }
    clock += 5000;
    expect(a.handleEvents([{ type: 'gas-swap', phase: 'done' }])).toBe(2); // the clank and the relight
    expect(a.voiceCount()).toBeLessThanOrEqual(MAX_VOICES);
    ctx.advance(10);
    expect(ctx.live().length).toBe(0);
  });

  it('a flood of operations events never exceeds the voice cap', () => {
    const a = make();
    a.unlock();
    const flood = Array.from({ length: 24 }, (_, i) => ({ type: ['tend', 'prep-start', 'stock-low', 'heat-warning', 'buy'][i % 5], station: 'tawa1', slot: i % 2, item: `i${i}`, band: 'hot', kind: 'wipe' }));
    a.handleEvents(flood, null);
    expect(a.voiceCount()).toBeLessThanOrEqual(MAX_VOICES);
  });

  it('does nothing and never throws before unlock, or on junk', () => {
    const a = make();
    expect(a.handleEvents([{ type: 'gas-out' }])).toBe(0);
    expect(() => a.setState(st({ events: [{ id: 'rain' }] }), 0)).not.toThrow();
    a.unlock();
    for (const ev of [null, undefined, {}, { type: 'event-start' }, { type: 'prep-start' }, { type: 'tend' }, { type: 'gas-swap' }, { type: 'heat-warning' }, 7, 'x']) {
      clock += 5000;
      expect(() => a.handleEvents([ev], st()), String(JSON.stringify(ev))).not.toThrow();
    }
    expect(() => a.setState({ events: 3, stations: 4, gas: 'x', cfg: 5 }, 0)).not.toThrow();
  });

  it('rain: the loop starts from state.events (also on a resume before unlock) and fades out with the event', () => {
    const a = make();
    a.startAmbience();
    a.setState(st({ events: [{ id: 'rain', until: 80 }] }), 0); // a resume mid-rain, before the gesture
    expect(ctx.sources.length).toBe(0);
    a.unlock();
    const withRain = ctx.sources.length;
    const b = new FakeAudioContext();
    const c = createTiffinAudio({ getAudioContext: () => b, settings, now: () => clock, timers, rng: () => 0.3, buzz, doc: null });
    c.startAmbience();
    c.setState(st(), 0);
    c.unlock();
    expect(withRain).toBeGreaterThan(b.sources.length); // the rain's two noise beds and their modulators
    const nBefore = ctx.sources.length;
    a.setState(st({ events: [] }), 1);
    expect(ctx.sources.length).toBeLessThanOrEqual(nBefore + 2); // nothing new is built when it stops raining
  });

  it('event-start / event-end of rain and power reach the loops and the ambience without a state', () => {
    const a = started();
    a.setHour(22.5);
    const n0 = ctx.sources.length;
    clock += 5000;
    a.handleEvents([{ type: 'event-start', id: 'rain' }], null);
    expect(ctx.sources.length).toBeGreaterThan(n0); // the thunder and the rain loop
    clock += 5000;
    expect(a.handleEvents([{ type: 'event-start', id: 'power' }], null)).toBe(1);
    clock += 5000;
    expect(a.handleEvents([{ type: 'event-end', id: 'power' }], null)).toBe(1); // restore click and fan
    expect(a.handleEvents([{ type: 'event-end', id: 'rain' }], null)).toBe(0);
  });

  it('a power cut silences the radio hum of the night ambience and restores it', () => {
    const a = started();
    a.setHour(22.5);
    const radioHum = () => ctx.sources.find((s) => s.kind === 'osc' && s.frequency.value === 100);
    const hum = radioHum();
    expect(hum).toBeTruthy();
    const gainOf = (src) => [...src.outs][0]; // osc -> its g
    const layerOut = (src) => {
      const g = gainOf(src);
      const head = [...g.outs][0];
      const mod = [...head.outs][0];
      return [...mod.outs][0];
    };
    const lastT = (g) => [...g.gain.events].reverse().find((e) => e[0] === 'target')?.[1];
    expect(lastT(layerOut(hum))).toBeGreaterThan(0);
    clock += 5000;
    a.handleEvents([{ type: 'event-start', id: 'power' }], null);
    expect(lastT(layerOut(hum))).toBe(0);
    clock += 5000;
    a.handleEvents([{ type: 'event-end', id: 'power' }], null);
    expect(lastT(layerOut(hum))).toBeGreaterThan(0);
  });

  it('grinder and simmer follow the prep counter in setState; stop with the job', () => {
    const a = started();
    a.setState(st(), 0);
    const base = ctx.sources.length;
    a.setState(st(prep('batter_dosa')), 1);
    const grinding = ctx.sources.length;
    expect(grinding).toBeGreaterThan(base);
    a.setState(st(prep(null, null)), 2);
    a.setState(st(prep('batter_dosa')), 3); // reuses the loop that is still fading: nothing new
    expect(ctx.sources.length).toBe(grinding);
  });

  it('a power cut stops the grinder and the generator hum comes in later', () => {
    const a = started();
    const state = st({ ...prep('batter_dosa'), cfg: { hour: [13.5, 13.5], spots: 4, generator: true }, events: [{ id: 'power' }] });
    a.setState(state, 0);
    const n = ctx.sources.length;
    clock += 4500;
    intervals.filter(Boolean).forEach((i) => i.fn());
    expect(ctx.sources.length).toBeGreaterThan(n); // the generator joined
  });

  it('the inspector hushes the crowd murmur for a few seconds, then it comes back', () => {
    const a = started();
    clock += 5000;
    a.handleEvents([{ type: 'event-start', id: 'inspector' }], null);
    const bus = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.filter((e) => e[0] === 'target').length === 2);
    expect(bus).toBeTruthy();
    const [down, up] = bus.gain.events.filter((e) => e[0] === 'target');
    expect(down[1]).toBeLessThan(0.5);
    expect(up[1]).toBe(1);
    expect(up[2]).toBeGreaterThan(down[2] + 2);
  });

  it('inspector verdict and gas-out vibrate; the quiet new events do not', () => {
    const a = make({ meId: 'me' });
    a.unlock();
    clock += 1000;
    a.handleEvents([{ type: 'gas-out' }], null);
    expect(buzz).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.gasOut);
    clock += 1000;
    a.handleEvents([{ type: 'inspector', pass: false }], null);
    expect(buzz).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.inspector);
    buzz.mockClear();
    clock += 1000;
    a.handleEvents([{ type: 'tend', station: 'tawa1' }, { type: 'stock-low', item: 'oil' }, { type: 'prep-start', item: 'oil' }], null);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('muted: no loops are built; unmuting brings them back; stopAmbience stops them', () => {
    const run = (events) => {
      const c = new FakeAudioContext();
      const x = createTiffinAudio({ getAudioContext: () => c, settings, now: () => clock, timers, rng: () => 0.3, buzz, doc: null });
      x.unlock();
      x.startAmbience();
      x.setMuted(true);
      const n = c.sources.length;
      x.setState(st({ events }), 0);
      return { x, c, built: c.sources.length - n };
    };
    const dry = run([]);
    const wet = run([{ id: 'cricket' }]); // (rain would also thin the dry beds: compare with an event that does not)
    expect(wet.built).toBe(dry.built); // muted builds no loops
    const before = wet.c.sources.length;
    wet.x.setMuted(false);
    expect(wet.c.sources.length).toBeGreaterThan(before); // the TV murmur comes back
    const m = wet.c.sources.length;
    wet.x.stopAmbience();
    wet.x.setState(st({ events: [{ id: 'cricket' }, { id: 'festival' }] }), 1);
    expect(wet.c.sources.length).toBe(m);
  });

  it('the hub sound switch also silences the loops', () => {
    const a = make();
    a.unlock();
    a.startAmbience();
    hubSettings = { ...hubSettings, sfx: false };
    listeners.forEach((f) => f());
    const n = ctx.sources.length;
    a.setState(st({ events: [{ id: 'rain' }] }), 0);
    const delta = ctx.sources.length - n;
    hubSettings = { ...hubSettings, sfx: true };
    listeners.forEach((f) => f());
    expect(ctx.sources.length).toBeGreaterThan(n + delta);
  });

  it('keeps every loop under the caps with everything on at once', () => {
    const a = started();
    a.setState(st({ ...prep('batter_dosa', 'sambar'), cfg: { hour: [22.5, 22.5], spots: 4, gas: 400 }, gas: { u: 100, sw: 0 }, events: ['rain', 'cricket', 'festival', 'delivery', 'inspector'].map((id) => ({ id })) }), 0);
    for (let i = 0; i < 40; i++) {
      clock += 6000;
      intervals.filter(Boolean).forEach((x) => x.fn());
    }
    expect(a.voiceCount()).toBeLessThanOrEqual(MAX_VOICES);
    a.dispose();
    expect(() => a.setState(st(), 1)).not.toThrow();
  });

  it('dispose frees the operations loops', () => {
    const a = started();
    a.setState(st({ events: [{ id: 'rain' }], ...prep('batter_dosa') }), 0);
    a.dispose();
    expect(ctx.sources.every((s) => s.stopAt !== null)).toBe(true);
    expect(() => a.handleEvents([{ type: 'gas-out' }])).not.toThrow();
  });
});
