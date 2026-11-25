import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { createSynth } from '@/lib/soundscape/synth.js';
import { GENERATOR_DELAY_MS } from './opsMix.js';
import { GAPS, LOOP_SPECS, MAX_ONE_SHOTS, OPS_TICK_MS, createOpsAudio } from './opsAudio.js';
import { OPS_AMBIENT, OPS_RECIPES, dhol } from './opsRecipes.js';

let ctx;
let dest;
let clock;
let intervals;
let ops;
const timers = {
  setInterval: (fn, ms) => (intervals.push({ fn, ms }), intervals.length),
  clearInterval: (id) => {
    intervals[id - 1] = null;
  },
};
const make = () => createOpsAudio({ ctx, dest, now: () => clock, timers, rng: () => 0.3 });
const prep = (...items) => ({ stations: { prep1: { slots: items.map((item) => (item ? { st: 'cooking', item } : { st: 'empty' })) } } });
const lastTarget = (L) => [...L.gain.events].reverse().find((e) => e[0] === 'target')?.[1];

beforeEach(() => {
  ctx = new FakeAudioContext();
  dest = ctx.createGain();
  clock = 1000;
  intervals = [];
  ops = make();
});

describe('loops follow the state', () => {
  it('builds nothing until started, then builds the rain from state.events (also on a resume)', () => {
    ops.setState({ events: [{ id: 'rain', until: 99 }] });
    expect(ctx.sources.length).toBe(0); // not started
    ops.start();
    expect(intervals[0].ms).toBe(OPS_TICK_MS);
    expect(ops.activeLoops()).toEqual(['rain']);
    expect(ctx.sources.filter((s) => s.kind === 'buffer').length).toBe(2); // patter + street
    expect(ops.flags()).toEqual({ rain: true, power: false });
  });

  it('fades the rain out when the event ends and frees the loop a few seconds later', () => {
    ops.start();
    ops.setState({ events: [{ id: 'rain' }] });
    const L = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].includes(dest));
    expect(lastTarget(L)).toBe(LOOP_SPECS.rain.mix);
    ops.setState({ events: [] });
    expect(lastTarget(L)).toBe(0);
    expect(ops.activeLoops()).toEqual([]);
    expect(ops.loopIds()).toEqual(['rain']); // still fading
    clock += 10000;
    ops.tick();
    expect(ops.loopIds()).toEqual([]);
    expect(ctx.sources.every((s) => s.stopAt !== null)).toBe(true);
    expect(ctx.connectedNodes().filter((n) => n !== dest && n.kind !== 'destination')).toEqual([]);
  });

  it('event-start / event-end notes work without a state, and state.events then takes over', () => {
    ops.start();
    expect(ops.noteEvent({ type: 'event-start', id: 'rain' })).toBe(true);
    expect(ops.activeLoops()).toEqual(['rain']);
    expect(ops.noteEvent({ type: 'event-start', id: 'cricket' })).toBe(false); // not a flag
    expect(ops.activeLoops()).toContain('cricket');
    expect(ops.noteEvent({ type: 'event-end', id: 'rain' })).toBe(true);
    expect(ops.activeLoops()).not.toContain('rain');
    expect(ops.setState({ stations: {} })).toBe(false); // no events field: keeps what the events said
    expect(ops.activeLoops()).toContain('cricket');
    ops.setState({ events: [] });
    expect(ops.activeLoops()).toEqual([]);
  });

  it('grinder: a batter job runs it, collecting / power cut / a chutney job do not', () => {
    ops.start();
    ops.setState(prep('batter_dosa'));
    expect(ops.activeLoops()).toEqual(['grinder']);
    ops.setState({ ...prep('batter_dosa'), events: [{ id: 'power' }] });
    expect(ops.activeLoops()).toEqual([]);
    expect(ops.flags().power).toBe(true);
    ops.setState(prep('coconut_chutney'));
    expect(ops.activeLoops()).toEqual([]);
    ops.setState({ stations: { prep1: { slots: [{ st: 'ready', item: 'batter_dosa' }] } } });
    expect(ops.activeLoops()).toEqual([]);
  });

  it('simmer and the regulator hiss follow the cylinder', () => {
    ops.start();
    const cfg = { gas: 400 };
    ops.setState({ ...prep('sambar'), cfg, gas: { u: 300, sw: 0 } });
    expect(ops.activeLoops()).toEqual(['simmer']);
    ops.setState({ ...prep('sambar'), cfg, gas: { u: 120, sw: 0 } });
    expect(ops.activeLoops().sort()).toEqual(['gasHiss', 'simmer']);
    ops.setState({ ...prep('sambar'), cfg, gas: { u: 0, sw: 0 } });
    expect(ops.activeLoops()).toEqual([]);
  });

  it('the generator comes on a few seconds into a power cut, only on a level that has one, and goes with the power', () => {
    ops.start();
    ops.setState({ events: [{ id: 'power' }], cfg: { generator: true } });
    expect(ops.activeLoops()).toEqual([]);
    clock += GENERATOR_DELAY_MS - 500;
    ops.tick();
    expect(ops.activeLoops()).toEqual([]);
    clock += 600;
    ops.tick();
    expect(ops.activeLoops()).toEqual(['generator']);
    ops.noteEvent({ type: 'event-end', id: 'power' });
    expect(ops.activeLoops()).toEqual([]);
    // a level without a generator stays silent
    const o2 = make();
    o2.start();
    o2.setState({ events: [{ id: 'power' }] });
    clock += 9000;
    o2.tick();
    expect(o2.activeLoops()).toEqual([]);
  });

  it('delivery idles and honks now and then', () => {
    ops.start();
    ops.setState({ events: [{ id: 'delivery' }] });
    expect(ops.activeLoops()).toEqual(['delivery']);
    ops.tick(); // schedules the first horn
    const n = ctx.sources.length;
    clock += GAPS.horn[1];
    ops.tick();
    expect(ctx.sources.length).toBeGreaterThan(n);
  });
});

describe('one-shots, the festival drum and the caps', () => {
  it('thunder and drips come by themselves while it rains', () => {
    ops.start();
    ops.setState({ events: [{ id: 'rain' }] });
    ops.tick();
    const n = ctx.sources.length;
    clock += GAPS.thunder[1] + 1;
    ops.tick();
    expect(ctx.sources.length).toBeGreaterThan(n + 3);
    expect(ops.stats().shots).toBeGreaterThan(0);
  });

  it('cricket: the TV murmur drifts, firecrackers and a roar come now and then', () => {
    ops.start();
    ops.setState({ events: [{ id: 'cricket' }] });
    expect(ops.activeLoops()).toEqual(['cricket']);
    for (let i = 0; i < 3; i++) ops.tick();
    const bq = ctx.nodes.find((n) => n.kind === 'biquad' && n.type === 'bandpass' && n.frequency.events.some((e) => e[0] === 'target'));
    expect(bq).toBeTruthy();
    const n = ctx.sources.length;
    clock += GAPS.firecracker[1];
    ops.tick();
    expect(ctx.sources.length).toBeGreaterThan(n);
  });

  it('festival: schedules a quiet drum loop ahead of the clock and keeps going; stops when the event ends', () => {
    ops.start();
    ops.setState({ events: [{ id: 'festival' }] });
    ops.tick();
    const n0 = ctx.sources.length;
    expect(n0).toBeGreaterThan(0);
    ctx.advance(0.5);
    ops.tick();
    expect(ctx.sources.length).toBeGreaterThan(n0);
    ops.setState({ events: [] });
    const n1 = ctx.sources.length;
    ctx.advance(1);
    ops.tick();
    expect(ctx.sources.length).toBe(n1);
  });

  it('never keeps more than the noise-loop cap or more than MAX_ONE_SHOTS one-shots', () => {
    ops.start();
    ops.setState({ ...prep('batter_dosa', 'sambar'), cfg: { gas: 400 }, gas: { u: 100, sw: 0 }, events: [{ id: 'rain' }, { id: 'cricket' }, { id: 'delivery' }, { id: 'festival' }] });
    expect(ops.stats().noiseLoops).toBeLessThanOrEqual(4);
    expect(ops.activeLoops()).toEqual(expect.arrayContaining(['rain', 'grinder', 'gasHiss', 'delivery']));
    expect(ops.activeLoops()).not.toContain('cricket');
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      clock += 7000; // the audio clock does not move: nothing ever ends, every gap is due
      ops.tick();
      worst = Math.max(worst, ops.stats().shots);
    }
    expect(worst).toBeLessThanOrEqual(MAX_ONE_SHOTS);
    expect(worst).toBeGreaterThan(0);
  });

  it('shots are released when their sources end', () => {
    ops.start();
    ops.setState({ events: [{ id: 'rain' }] });
    ops.tick();
    clock += GAPS.thunder[1] + 1;
    ops.tick();
    expect(ops.stats().shots).toBeGreaterThan(0);
    ctx.advance(30);
    expect(ops.stats().shots).toBe(0);
  });
});

describe('enable, stop, dispose, junk', () => {
  it('setEnabled(false) fades every loop out and schedules nothing; true brings them back', () => {
    ops.start();
    ops.setState({ events: [{ id: 'rain' }], ...prep('batter_dosa') });
    expect(ops.activeLoops().length).toBe(2);
    ops.setEnabled(false);
    expect(ops.activeLoops()).toEqual([]);
    const n = ctx.sources.length;
    clock += 60000;
    ops.tick();
    expect(ctx.sources.length).toBe(n);
    ops.setEnabled(true);
    expect(ops.activeLoops().length).toBe(2);
  });

  it('stop() fades the loops, dispose() frees everything and is idempotent', () => {
    ops.start();
    ops.setState({ events: [{ id: 'rain' }] });
    ops.stop();
    expect(ops.activeLoops()).toEqual([]);
    ops.start();
    expect(ops.activeLoops()).toEqual(['rain']);
    ops.dispose();
    expect(ops.loopIds()).toEqual([]);
    expect(ctx.sources.every((s) => s.stopAt !== null)).toBe(true);
    expect(() => ops.dispose()).not.toThrow();
    expect(ops.setState({ events: [{ id: 'rain' }] })).toBe(false);
  });

  it('does not throw on missing fields, junk states or junk events', () => {
    ops.start();
    for (const s of [null, undefined, {}, [], 'x', 7, { events: null }, { stations: { prep1: null } }, { stations: { prep1: { slots: [null, 3, {}] } } }, { cfg: { gas: 1 } }, { cfg: { gas: 1 }, gas: null }]) {
      expect(() => ops.setState(s), JSON.stringify(s)).not.toThrow();
      expect(() => ops.tick()).not.toThrow();
    }
    for (const e of [null, undefined, {}, { type: 'event-start' }, { type: 'event-start', id: 7 }, { type: 'nope' }, 'x']) expect(() => ops.noteEvent(e)).not.toThrow();
    expect(ops.activeLoops()).toEqual([]);
  });

  it('a suspended context schedules nothing', () => {
    ops.start();
    ops.setState({ events: [{ id: 'festival' }] });
    ctx.state = 'suspended';
    const n = ctx.sources.length;
    clock += 60000;
    ops.tick();
    expect(ctx.sources.length).toBe(n);
  });
});

describe('the recipes of the scheduler', () => {
  it('every one-shot builds sources that start and stop, within 4.5 s, with valid automation', () => {
    const all = { ...OPS_AMBIENT, thunderLong: (s, t) => OPS_RECIPES.thunder(s, t, { long: true }) };
    for (const [name, fn] of Object.entries(all)) {
      const c = new FakeAudioContext();
      const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
      fn(createSynth(c, c.createGain(), voice), 1, { v: 1, pitch: 0.5, pan: 0.2 });
      expect(c.sources.length, name).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.stopAt - 1, name).toBeLessThan(4.5);
    }
    for (const kind of ['dum', 'ge', 'ta', 'x']) {
      const c = new FakeAudioContext();
      dhol(createSynth(c, c.createGain(), {}), 1, kind, 0.06, 0.1);
      expect(c.sources.length, kind).toBeGreaterThan(0);
    }
  });
});
