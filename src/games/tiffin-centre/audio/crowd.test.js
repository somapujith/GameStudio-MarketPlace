import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { LAYOUT } from '@shared/tiffin-centre/catalog.js';
import { createTiffinAudio } from './index.js';
import { createCrowd, crowdHandle, murmurPlan, VOCALS, VOCAL_NAMES, LANES, DRIFT_MS } from './crowd.js';

const cust = (id, spot, extra = {}) => ({ id, spot, st: 'waiting', patience: 20, patienceMax: 20, kind: 'office', ...extra });
const stateOf = (...customers) => ({ customers });

let ctx;
let clock;
let intervals;
const timers = {
  setInterval: (fn, ms) => (intervals.push({ fn, ms }), intervals.length),
  clearInterval: (id) => {
    intervals[id - 1] = null;
  },
};
const lastTarget = (param) => [...param.events].reverse().find((e) => e[0] === 'target')?.[1];
let dest;
let vdest;

function make(extra = {}) {
  dest = ctx.createGain();
  vdest = ctx.createGain();
  return createCrowd({ ctx, dest, vocalDest: vdest, now: () => clock, timers, rng: () => 0.3, ...extra });
}

beforeEach(() => {
  ctx = new FakeAudioContext();
  clock = 1000;
  intervals = [];
});

describe('murmurPlan (pure)', () => {
  it('is silent with nobody waiting; only waiting customers count', () => {
    expect(murmurPlan(null).level).toBe(0);
    expect(murmurPlan(stateOf()).lanes).toEqual([]);
    expect(murmurPlan(stateOf(cust('a', 0, { st: 'eating' }), cust('b', 1, { st: 'paying' }))).level).toBe(0);
  });
  it('the level grows with the number of customers waiting and stays within 0..1', () => {
    const levels = [1, 2, 3, 4, 5, 6].map((n) => murmurPlan(stateOf(...Array.from({ length: n }, (_, i) => cust(`c${i}`, i)))).level);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    expect(levels.at(-1)).toBeLessThanOrEqual(1);
    expect(levels[0]).toBeGreaterThan(0);
  });
  it('impatient customers make it louder and quicker', () => {
    const calm = murmurPlan(stateOf(cust('a', 0), cust('b', 1)));
    const upset = murmurPlan(stateOf(cust('a', 0, { patience: 2 }), cust('b', 1, { patience: 1 })));
    expect(upset.agitation).toBeGreaterThan(calm.agitation);
    expect(upset.level).toBeGreaterThan(calm.level);
  });
  it('places up to 3 voices at the customers x positions (left to right)', () => {
    const p = murmurPlan(stateOf(cust('r', 5), cust('l', 0)));
    expect(p.lanes).toHaveLength(2);
    expect(p.lanes[0].pan).toBeLessThan(0);
    expect(p.lanes[1].pan).toBeGreaterThan(0);
    const many = murmurPlan(stateOf(...[0, 1, 2, 3, 4, 5].map((i) => cust(`c${i}`, i))));
    expect(many.lanes).toHaveLength(LANES);
    expect(many.lanes[0].pan).toBeLessThan(many.lanes[2].pan);
    expect(LAYOUT.spotX(0)).toBeLessThan(0);
  });
  it('ignores junk customers', () => {
    expect(murmurPlan({ customers: [null, {}, cust('a', 'x')] }).level).toBeGreaterThan(0);
    expect(murmurPlan({ customers: 5 }).level).toBe(0);
  });
});

describe('crowdHandle (pure): events -> vocalisations', () => {
  const st = stateOf(cust('a', 0), cust('b', 5));
  const names = (evs) => crowdHandle(evs, st).vocals.map((v) => v.name);
  it('maps the moods: tsk (impatient), hmph (angry), mmm (pleased), laugh (big moment)', () => {
    expect(names([{ type: 'pay-warning', customer: 'a' }])).toEqual(['tsk']);
    expect(names([{ type: 'customer-turned-away', customer: 'a' }])).toEqual(['tsk']);
    expect(names([{ type: 'customer-angry', customer: 'a' }])).toEqual(['hmph']);
    expect(names([{ type: 'customer-unpaid', customer: 'a' }])).toEqual(['hmph']);
    expect(names([{ type: 'collect', customer: 'a', amount: 50, combo: 1 }])).toEqual(['mmm']);
    expect(names([{ type: 'collect', customer: 'a', amount: 200, combo: 1 }])).toEqual(['laugh']);
    expect(names([{ type: 'collect', customer: 'a', amount: 50, combo: 5 }])).toEqual(['laugh']);
    expect(names([{ type: 'eating', customer: 'a' }])).toEqual(['mmm']);
    expect(names([{ type: 'shift-end', status: 'done', stars: 3 }])).toEqual(['laugh']);
  });
  it('stays silent for other events, a failed shift, or one star', () => {
    expect(names([{ type: 'tick' }, { type: 'serve', customer: 'a' }, null, { foo: 1 }, { type: 'shift-end', status: 'closed' }, { type: 'shift-end', status: 'done', stars: 1 }])).toEqual([]);
    expect(crowdHandle(null, null).vocals).toEqual([]);
  });
  it('pans each vocal to the customer, and the customer has their own voice height', () => {
    const [l] = crowdHandle([{ type: 'customer-angry', customer: 'a' }], st).vocals;
    const [r] = crowdHandle([{ type: 'customer-angry', customer: 'b' }], st).vocals;
    expect(l.opts.pan).toBeLessThan(0);
    expect(r.opts.pan).toBeGreaterThan(0);
    expect(l.opts.pitch).not.toBe(r.opts.pitch);
    expect(l.opts.pitch).toBeGreaterThanOrEqual(0.8);
    const [none] = crowdHandle([{ type: 'customer-angry', customer: 'gone' }], st).vocals;
    expect(none.opts.pan).toBe(0);
    expect(crowdHandle([{ type: 'customer-angry', customer: 'x', spot: 5 }], null).vocals[0].opts.pan).toBeGreaterThan(0);
  });
  it('quieter for eating, with a per-customer cooldown key', () => {
    const [e] = crowdHandle([{ type: 'eating', customer: 'a' }], st).vocals;
    expect(e.gain).toBeLessThan(1);
    expect(e.key).toBe('mmm:a');
  });
});

describe('vocalisation recipes', () => {
  for (const name of VOCAL_NAMES) {
    it(`${name} makes sound and cleans up after itself`, () => {
      const crowd = make();
      expect(crowd.vocal(name, { pan: -0.3, pitch: 1.1 })).toBe(true);
      expect(ctx.live().length).toBeGreaterThan(0);
      ctx.advance(3);
      expect(ctx.live()).toHaveLength(0);
      expect(typeof VOCALS[name]).toBe('function');
    });
  }
  it('unknown names are ignored', () => {
    expect(make().vocal('yodel')).toBe(false);
  });
  it('vocalisations go to the vocal bus', () => {
    const crowd = make();
    crowd.vocal('tsk');
    const g = ctx.nodes.filter((n) => n.kind === 'gain' && [...n.outs].includes(vdest));
    expect(g.length).toBe(1);
  });
  it('same sound for the same customer is rate limited; different customers are heard; the total is capped', () => {
    const crowd = make({ maxVocals: 3 });
    expect(crowd.vocal('hmph', { key: 'hmph:a' })).toBe(true);
    expect(crowd.vocal('hmph', { key: 'hmph:a' })).toBe(false); // cooldown
    expect(crowd.vocal('hmph', { key: 'hmph:b' })).toBe(true);
    expect(crowd.vocal('tsk', { key: 'tsk:c' })).toBe(true);
    expect(crowd.vocal('mmm', { key: 'mmm:d' })).toBe(false); // 3 voices already and this one is the least important
    clock += 600;
    ctx.advance(3);
    expect(crowd.vocal('hmph', { key: 'hmph:a' })).toBe(true);
  });
  it('handle() plays the vocals of events and returns how many started', () => {
    const crowd = make();
    const st = stateOf(cust('a', 0));
    expect(crowd.handle([{ type: 'customer-angry', customer: 'a' }, { type: 'tick' }], st)).toBe(1);
    expect(crowd.handle([{ type: 'customer-angry', customer: 'a' }], st)).toBe(0); // cooldown
    expect(crowd.stats().vocals).toBe(1);
  });
  it('a broken context never throws', () => {
    const crowd = make();
    ctx.createOscillator = () => {
      throw new Error('boom');
    };
    expect(crowd.vocal('mmm')).toBe(false);
  });
});

describe('murmur', () => {
  it('builds nothing until somebody waits; then 3 voices of formant-filtered noise with syllable LFOs', () => {
    const crowd = make();
    crowd.start();
    expect(ctx.sources).toHaveLength(0);
    crowd.update(stateOf(cust('a', 0)));
    expect(crowd.stats().lanes).toBe(LANES);
    expect(ctx.sources.filter((s) => s.kind === 'buffer')).toHaveLength(LANES);
    expect(ctx.sources.filter((s) => s.kind === 'osc')).toHaveLength(LANES * 2); // syllable + phrase LFO per voice
    expect(ctx.nodes.filter((n) => n.kind === 'biquad' && n.type === 'bandpass')).toHaveLength(LANES * 2); // two formants each
    expect(ctx.nodes.filter((n) => n.kind === 'panner')).toHaveLength(LANES);
    expect(ctx.sources.every((s) => s.startAt !== null)).toBe(true);
  });
  it('its level follows the customers: louder with more, silent with none', () => {
    const crowd = make();
    crowd.start();
    crowd.update(stateOf(cust('a', 0)));
    const master = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].includes(dest));
    const one = lastTarget(master.gain);
    crowd.update(stateOf(cust('a', 0), cust('b', 2), cust('c', 4), cust('d', 5)));
    const four = lastTarget(master.gain);
    expect(four).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(0);
    crowd.update(stateOf());
    expect(lastTarget(master.gain)).toBe(0);
  });
  it('voices pan to where the customers stand; unused voices fall silent', () => {
    const crowd = make();
    crowd.start();
    crowd.update(stateOf(cust('l', 0), cust('r', 5)));
    const panners = ctx.nodes.filter((n) => n.kind === 'panner');
    expect(lastTarget(panners[0].pan)).toBeLessThan(0);
    expect(lastTarget(panners[1].pan)).toBeGreaterThan(0);
    const master = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].includes(dest));
    const lanesOut = ctx.nodes.filter((n) => n.kind === 'gain' && [...n.outs].includes(master));
    expect(lanesOut).toHaveLength(LANES);
    const levels = lanesOut.map((n) => lastTarget(n.gain));
    expect(levels.filter((l) => l > 0)).toHaveLength(2);
    expect(levels.filter((l) => l === 0)).toHaveLength(1);
  });
  it('is silent while stopped, and resumes on start', () => {
    const crowd = make();
    crowd.update(stateOf(cust('a', 0)));
    expect(ctx.sources).toHaveLength(0); // stopped: nothing built
    crowd.start();
    expect(crowd.isRunning()).toBe(true);
    const master = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].includes(dest));
    expect(lastTarget(master.gain)).toBeGreaterThan(0);
    crowd.stop();
    expect(lastTarget(master.gain)).toBe(0);
    expect(intervals.filter(Boolean)).toHaveLength(0);
  });
  it('the vowels drift on a timer and the syllable rate quickens with impatience', () => {
    const crowd = make();
    crowd.start();
    crowd.update(stateOf(cust('a', 0)));
    expect(intervals[0].ms).toBe(DRIFT_MS);
    const f1 = ctx.nodes.filter((n) => n.kind === 'biquad')[0];
    const before = f1.frequency.events.length;
    intervals[0].fn();
    expect(f1.frequency.events.length).toBe(before + 1);
    const lfo = ctx.sources.filter((s) => s.kind === 'osc')[0];
    const calmRate = lfo.frequency.value;
    crowd.update(stateOf(cust('a', 0, { patience: 1 })));
    expect(lfo.frequency.value).toBeGreaterThan(calmRate);
  });
  it('drift pauses while the context is suspended', () => {
    const crowd = make();
    crowd.start();
    crowd.update(stateOf(cust('a', 0)));
    const f1 = ctx.nodes.filter((n) => n.kind === 'biquad')[0];
    const before = f1.frequency.events.length;
    ctx.state = 'suspended';
    intervals[0].fn();
    expect(f1.frequency.events.length).toBe(before);
  });
  it('handle() with a state drives the murmur too', () => {
    const crowd = make();
    crowd.start();
    crowd.handle([], stateOf(cust('a', 0), cust('b', 1)));
    expect(crowd.stats().lanes).toBe(LANES);
    expect(crowd.plan().level).toBeGreaterThan(0);
  });
  it('dispose stops sources, disconnects and ignores later calls', () => {
    const crowd = make();
    crowd.start();
    crowd.update(stateOf(cust('a', 0)));
    crowd.dispose();
    expect(ctx.sources.every((s) => s.stopAt !== null)).toBe(true);
    expect(crowd.vocal('tsk')).toBe(false);
    crowd.update(stateOf(cust('a', 0)));
    expect(crowd.handle([{ type: 'customer-angry', customer: 'a' }])).toBe(0);
    crowd.dispose();
  });
});

describe('wired into createTiffinAudio', () => {
  let hub;
  function audio(extra = {}) {
    hub = { sfx: true, volume: 0.8, sfxVolume: 1 };
    return createTiffinAudio({ getAudioContext: () => ctx, settings: () => hub, now: () => clock, timers, rng: () => 0.3, doc: null, haptics: false, ...extra });
  }
  const state = () => ({ cfg: { hour: [6, 9] }, shiftTicks: 10, tick: 0, customers: [cust('a', 0), cust('b', 3)], players: {} });

  it('angry customer: the normal sound still counts as before and an extra hmph is heard', () => {
    const a = audio();
    a.unlock();
    const before = ctx.sources.length;
    const n = a.handleEvents([{ type: 'customer-angry', customer: 'a' }], state());
    expect(n).toBe(1); // the vocalisation is not counted in the sounds started
    expect(ctx.sources.length).toBeGreaterThan(before);
  });
  it('the murmur starts with the ambience and follows setState', () => {
    const a = audio();
    a.startAmbience();
    a.unlock();
    a.setState(state(), 0);
    expect(ctx.sources.filter((s) => s.kind === 'buffer').length).toBeGreaterThanOrEqual(LANES);
    a.stopAmbience();
    a.dispose();
  });
  it('no vocal while muted or with the hub sound off, and crowd:false removes the whole layer', () => {
    const a = audio();
    a.unlock();
    a.setMuted(true);
    const n = ctx.sources.length;
    a.handleEvents([{ type: 'customer-angry', customer: 'a' }], state());
    expect(ctx.sources.length).toBe(n);
    const count = (extra) => {
      ctx = new FakeAudioContext();
      const x = audio(extra);
      x.unlock();
      x.setState(state(), 0);
      const m = ctx.sources.length;
      x.handleEvents([{ type: 'customer-angry', customer: 'a' }], state());
      return ctx.sources.length - m;
    };
    expect(count({ crowd: false })).toBeLessThan(count({}));
  });
});
