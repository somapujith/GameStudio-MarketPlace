import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { effectsLevel, masterLevel } from '@/lib/soundscape/mixer.js';
import { createTiffinAudio } from './index.js';

let ctx;
let factory;
let hubSettings;
let listeners;
let clock;
let intervals;
let buzz;
let doc;
let docHandlers;

const timers = {
  setInterval: (fn, ms) => (intervals.push({ fn, ms }), intervals.length),
  clearInterval: (id) => {
    intervals[id - 1] = null;
  },
};
const settings = { load: () => hubSettings, subscribe: (cb) => (listeners.push(cb), () => listeners.splice(listeners.indexOf(cb), 1)) };

function make(extra = {}) {
  return createTiffinAudio({ getAudioContext: factory, settings, now: () => clock, timers, rng: () => 0.3, buzz, doc, ...extra });
}
const masterTarget = () => {
  const m = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].some((o) => o.kind === 'compressor'));
  return [...m.gain.events].reverse().find((e) => e[0] === 'target')?.[1];
};
const READY = { type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa' };
const BURNT = { type: 'burnt', station: 'tawa1', slot: 0, dish: 'dosa' };

beforeEach(() => {
  ctx = new FakeAudioContext();
  factory = vi.fn(() => ctx);
  hubSettings = { sfx: true, volume: 0.8, sfxVolume: 1, haptics: true };
  listeners = [];
  clock = 10000;
  intervals = [];
  buzz = vi.fn();
  docHandlers = {};
  doc = {
    visibilityState: 'visible',
    addEventListener: (e, f) => (docHandlers[e] = f),
    removeEventListener: (e) => delete docHandlers[e],
  };
});

describe('autoplay and unlock', () => {
  it('creates no context and plays nothing before unlock()', () => {
    const a = make();
    expect(factory).not.toHaveBeenCalled();
    expect(a.handleEvents([READY])).toBe(0);
    a.startAmbience();
    a.setState({ cfg: { hour: [6, 9] }, shiftTicks: 10, tick: 0 }, 0);
    expect(ctx.sources.length).toBe(0);
    expect(buzz).not.toHaveBeenCalled();
    expect(a.isUnlocked()).toBe(false);
  });

  it('unlock() is idempotent, builds the graph once and resumes a suspended context', () => {
    ctx.state = 'suspended';
    const a = make();
    expect(a.unlock()).toBe(true);
    expect(a.unlock()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resumeCalls).toBe(1); // the second call finds it running
    expect(ctx.state).toBe('running');
    const kinds = ctx.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'compressor').length).toBe(1);
    expect(kinds.filter((k) => k === 'shaper').length).toBe(1);
  });

  it('survives an unsupported browser', () => {
    const a = make({ getAudioContext: () => null });
    expect(a.unlock()).toBe(false);
    expect(a.handleEvents([READY])).toBe(0);
    const b = make({ getAudioContext: () => { throw new Error('no audio'); } });
    expect(b.unlock()).toBe(false);
    expect(() => b.dispose()).not.toThrow();
  });

  it('routes through master -> compressor -> destination', () => {
    make().unlock();
    const comp = ctx.nodes.find((n) => n.kind === 'compressor');
    const shaper = ctx.nodes.find((n) => n.kind === 'shaper');
    expect([...comp.outs]).toContain(shaper);
    expect([...shaper.outs]).toContain(ctx.destination);
  });
});

describe('handleEvents', () => {
  it('plays a sound per event and cleans up when it ends', () => {
    const a = make();
    a.unlock();
    const base = ctx.connectedNodes().length;
    expect(a.handleEvents([READY], null)).toBe(1);
    expect(ctx.live().length).toBeGreaterThan(0);
    ctx.advance(5);
    expect(ctx.live().length).toBe(0);
    expect(ctx.connectedNodes().length).toBe(base); // no leaked nodes
  });

  it('plays the sounds of a whole batch, ignores silent events, and caps a huge backlog', () => {
    const a = make();
    a.unlock();
    expect(a.handleEvents([{ type: 'tick', tick: 1 }, { type: 'tutorial-spawn' }])).toBe(0);
    clock += 1000;
    expect(a.handleEvents([READY, BURNT, { type: 'customer-arrive', customer: 'c', spot: 1 }, { type: 'eating', customer: 'c' }])).toBe(4);
    clock += 5000;
    const flood = Array.from({ length: 200 }, (_, i) => ({ type: i % 2 ? 'ready' : 'take', station: 'tawa1', dish: 'dosa', by: 'b' }));
    const started = a.handleEvents(flood);
    expect(started).toBeLessThanOrEqual(2); // cooldowns: one ding and one take at most per instant
  });

  it('cooldowns let four players\' events through at a sane rate', () => {
    const a = make();
    a.unlock();
    expect(a.handleEvents([READY, READY, READY])).toBe(1);
    clock += 50;
    expect(a.handleEvents([READY])).toBe(0);
    clock += 100;
    expect(a.handleEvents([READY])).toBe(1);
  });

  it('never exceeds the polyphony cap with everything at once', () => {
    const a = make();
    a.unlock();
    const kinds = ['cook-start', 'ready', 'burnt', 'burnt-cleared', 'take', 'serve', 'customer-arrive', 'eating', 'pay-ready', 'pay-warning', 'collect', 'customer-angry', 'customer-unpaid', 'discard', 'life-lost', 'combo', 'emote', 'customer-turned-away'];
    const evs = kinds.map((type) => ({ type, station: 'kadai1', dish: 'vada', customer: 'c', spot: 3, amount: 200, combo: 4, by: 'b', e: 'fire' }));
    a.handleEvents(evs);
    expect(ctx.live().length).toBeGreaterThan(0);
    expect(a.voiceCount()).toBeLessThanOrEqual(12);
    expect(a.voiceCount()).toBeGreaterThan(0);
    ctx.advance(10);
    expect(a.voiceCount()).toBe(0);
  });

  it('does not play while muted, and plays again after unmuting', () => {
    const a = make();
    a.unlock();
    a.setMuted(true);
    expect(a.isMuted()).toBe(true);
    expect(masterTarget()).toBe(0);
    expect(a.handleEvents([READY])).toBe(0);
    a.setMuted(false);
    expect(a.isMuted()).toBe(false);
    expect(masterTarget()).toBeCloseTo(masterLevel(0.8), 9);
    clock += 1000;
    expect(a.handleEvents([READY])).toBe(1);
  });

  it('follows the hub sound settings live (sound off, volumes)', () => {
    const a = make();
    a.unlock();
    hubSettings = { ...hubSettings, volume: 0.4 };
    listeners.forEach((f) => f());
    expect(masterTarget()).toBeCloseTo(masterLevel(0.4), 9);
    a.setVolume(0.5);
    expect(masterTarget()).toBeCloseTo(masterLevel(0.2), 9);
    hubSettings = { ...hubSettings, sfx: false };
    listeners.forEach((f) => f());
    expect(masterTarget()).toBe(0);
    expect(a.isMuted()).toBe(true);
    expect(a.handleEvents([READY])).toBe(0);
    hubSettings = { ...hubSettings, sfx: true, sfxVolume: 0.5 };
    listeners.forEach((f) => f());
    const group = ctx.nodes.find((n) => n.kind === 'gain' && [...n.outs].some((o) => o.kind === 'gain' && [...o.outs].some((x) => x.kind === 'compressor')));
    expect([...group.gain.events].reverse().find((e) => e[0] === 'target')[1]).toBeCloseTo(effectsLevel(0.5), 9);
  });

  it('plays a work sound per station kind (different sound graphs)', () => {
    const counts = {};
    for (const [station, dish] of [['tawa1', 'dosa'], ['steamer1', 'idly'], ['kadai1', 'vada'], ['chai1', 'irani_chai']]) {
      ctx = new FakeAudioContext();
      const a = make();
      a.unlock();
      a.handleEvents([{ type: 'cook-start', station, slot: 0, dish, by: 'me' }]);
      counts[station] = ctx.sources.length;
    }
    expect(new Set(Object.values(counts)).size).toBeGreaterThan(2);
  });

  it('shift-end ducks the ambience and plays the fanfare', () => {
    const a = make();
    a.unlock();
    a.startAmbience();
    expect(a.handleEvents([{ type: 'shift-end', status: 'done', stars: 3 }])).toBe(1);
    const amb = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.filter((e) => e[0] === 'target').length === 2);
    expect(amb).toBeTruthy();
    expect(amb.gain.events.find((e) => e[0] === 'target')[1]).toBeLessThan(amb.gain.value);
  });

  it('vibrates through the haptics map, only for your own collects, and not before unlock or when disabled', () => {
    const a = make({ meId: 'me' });
    a.handleEvents([BURNT]);
    expect(buzz).not.toHaveBeenCalled();
    a.unlock();
    a.handleEvents([BURNT]);
    expect(buzz).toHaveBeenCalledTimes(1);
    clock += 1000;
    a.handleEvents([{ type: 'collect', customer: 'c', amount: 50, by: 'other', combo: 1 }]);
    expect(buzz).toHaveBeenCalledTimes(1);
    const b = make({ haptics: false });
    b.unlock();
    b.handleEvents([{ type: 'life-lost', lives: 3 }]);
    expect(buzz).toHaveBeenCalledTimes(1);
  });
});

describe('footsteps', () => {
  const st = (p) => ({ cfg: { hour: [6, 9], spots: 4 }, shiftTicks: 100, tick: 5, customers: [], players: p });

  it('taps when a player\'s position changes: clearly for you, faintly for others', () => {
    const a = make({ meId: 'me' });
    a.unlock();
    a.setState(st({ me: { at: null }, you: { at: null } }), 0);
    expect(ctx.sources.length).toBe(0); // the first sight of a player is not a walk
    a.setState(st({ me: { at: 'chai1' }, you: { at: 'tawa1' } }), 0);
    const live = ctx.live().length;
    expect(live).toBeGreaterThan(0);
    clock += 50;
    a.setState(st({ me: { at: 'chai1' }, you: { at: 'tawa1' } }), 0);
    expect(ctx.live().length).toBe(live); // no new walk
    const voiceGains = ctx.nodes.filter((n) => n.kind === 'gain' && n.gain.value > 0 && n.gain.value < 1 && n.gain.events.length === 0);
    const values = voiceGains.map((n) => n.gain.value);
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values)); // yours louder than theirs
  });

  it('rate-limits a walker who is re-tapping', () => {
    const a = make({ meId: 'me' });
    a.unlock();
    a.setState(st({ me: { at: null } }), 0);
    a.setState(st({ me: { at: 'tawa1' } }), 0);
    const n = ctx.sources.length;
    clock += 50;
    a.setState(st({ me: { at: 'chai1' } }), 0);
    expect(ctx.sources.length).toBe(n);
    clock += 400;
    a.setState(st({ me: { at: 'tawa1' } }), 0);
    expect(ctx.sources.length).toBeGreaterThan(n);
  });
});

describe('ambience control', () => {
  const state = (hour, extra = {}) => ({ cfg: { hour: [hour, hour], spots: 4 }, shiftTicks: 100, tick: 1, customers: [], players: {}, ...extra });

  it('starts after unlock, follows the hour through setState and setHour, and stops', () => {
    const a = make();
    a.startAmbience(); // before the gesture: remembered
    expect(ctx.sources.length).toBe(0);
    a.unlock();
    expect(a.isAmbienceOn()).toBe(true);
    a.setState(state(13.5), 0);
    const noonSources = ctx.sources.length;
    expect(noonSources).toBeGreaterThan(0);
    a.setHour(22.5);
    expect(ctx.sources.length).toBeGreaterThan(noonSources); // crickets joined
    a.stopAmbience();
    expect(a.isAmbienceOn()).toBe(false);
    expect(intervals[0]).toBeNull();
    a.startAmbience();
    expect(a.isAmbienceOn()).toBe(true);
  });

  it('is quiet by default for the effects mix: the ambience bus is below the effects', () => {
    const a = make();
    a.unlock();
    const ambBus = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.value > 0 && n.gain.value < 1 && n.gain.events.length === 0);
    expect(ambBus.gain.value).toBeLessThan(1);
    void a;
  });

  it('ignores junk hours', () => {
    const a = make();
    a.unlock();
    a.startAmbience();
    expect(() => a.setHour(NaN)).not.toThrow();
    expect(() => a.setState(null, 0)).not.toThrow();
    expect(() => a.setState({}, 0)).not.toThrow();
  });
});

describe('lifecycle', () => {
  it('suspends when the tab is hidden and resumes when it is back', () => {
    const a = make();
    a.unlock();
    doc.visibilityState = 'hidden';
    docHandlers.visibilitychange();
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');
    doc.visibilityState = 'visible';
    const resumes = ctx.resumeCalls;
    docHandlers.visibilitychange();
    expect(ctx.resumeCalls).toBe(resumes + 1);
    expect(ctx.state).toBe('running');
  });

  it('does not resume on visibilitychange before unlock', () => {
    const a = make();
    expect(docHandlers.visibilitychange).toBeUndefined();
    a.unlock();
    expect(docHandlers.visibilitychange).toBeTypeOf('function');
  });

  it('dispose() stops everything, removes listeners and makes the instance inert', () => {
    const a = make();
    a.unlock();
    a.startAmbience();
    a.setHour(13.5);
    a.handleEvents([READY]);
    a.dispose();
    ctx.advance(10);
    expect(ctx.live().length).toBe(0);
    expect(docHandlers.visibilitychange).toBeUndefined();
    expect(listeners.length).toBe(0);
    expect(a.handleEvents([BURNT])).toBe(0);
    expect(a.unlock()).toBe(false);
    expect(ctx.closed).toBe(false); // an injected context belongs to the caller
    expect(() => a.dispose()).not.toThrow();
  });
});
