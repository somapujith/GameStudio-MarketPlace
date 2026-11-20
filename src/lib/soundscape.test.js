import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from './soundscape/fakeAudio.js';
import { RECIPES, SOUND_NAMES, clinksFor, faceFreq, hz, pentMidi } from './soundscape/recipes.js';
import { createMixer, effectsLevel, masterLevel, softClipCurve } from './soundscape/mixer.js';
import { SFX_NAMES, snatchTickTimes } from './sfx.js';
import { BOUNCE_AT } from '../components/game/diceMotion.js';
import { DICE_BOUNCES } from './soundscape/recipes.js';

const ORIGINAL_NAMES = ['click', 'dice', 'step', 'coin', 'pay', 'buy', 'upgrade', 'hotel', 'mortgage', 'trade', 'lucky', 'jail', 'card', 'win', 'lose', 'cheer', 'error', 'turn', 'warn', 'ride', 'chai', 'invite', 'levelup', 'friend'];
const NEW_NAMES = ['tap', 'toggle', 'diceLand', 'land', 'rent', 'sold', 'auction', 'announce', 'traffic', 'turnOther', 'tick', 'snatchAlarm', 'snatchTick', 'snatchPress', 'snatchWin', 'snatchLost', 'bankrupt'];
const POWER_NAMES = ['powerDraw', 'powerPlay', 'powerShield', 'powerDouble', 'powerSwap', 'powerSteal', 'powerExpire'];

// a few option sets per sound, to exercise every branch
const OPTS = {
  coin: [undefined, { amount: 5000 }, { amount: 200000 }, { amount: 5000000 }],
  pay: [undefined, { amount: 5000 }, { amount: 900000 }],
  diceLand: [{ values: [1] }, { values: [6] }, { values: [3, 6] }, { values: [] }, {}],
  step: [{ i: 0, n: 5 }, { i: 4, n: 5 }, { i: 30, n: 40 }],
  card: [{ deck: 'luck' }, { deck: 'drama' }, {}],
  announce: [{ bad: true }, { bad: false }],
  upgrade: [{ level: 1 }, { level: 4 }],
  chai: [{ use: true }, {}],
  tick: [{ urgency: 0 }, { urgency: 1, tock: true }],
  snatchTick: [{ urgency: 0.5, tock: true }],
  bankrupt: [{ mine: true }, { mine: false }],
  toggle: [{ on: true }, { on: false }],
  ...Object.fromEntries(POWER_NAMES.map((n) => [n, [undefined, { vol: 0.6 }, { vol: 5 }]])),
};

function rig(extra = {}) {
  const clock = { ms: 1000 };
  const timers = [];
  const ctxs = [];
  const mixer = createMixer({
    createContext: () => {
      const c = new FakeAudioContext(extra.ctxOpts);
      ctxs.push(c);
      return c;
    },
    now: () => clock.ms,
    hidden: () => !!extra.hidden?.(),
    canStart: () => (extra.canStart ? extra.canStart() : true),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    recipes: RECIPES,
    ...(extra.env || {}),
  });
  return { mixer, clock, timers, ctx: () => ctxs[0], ctxs };
}

describe('sound registry', () => {
  it('keeps every original name and adds the new soundscape', () => {
    for (const n of [...ORIGINAL_NAMES, ...NEW_NAMES, ...POWER_NAMES]) expect(SFX_NAMES).toContain(n);
    expect(SFX_NAMES).toEqual(SOUND_NAMES);
  });

  it('gives every sound sane mixer metadata', () => {
    for (const m of Object.values(RECIPES)) {
      expect([0, 1, 2, 3]).toContain(m.priority);
      expect(m.cooldown).toBeGreaterThanOrEqual(0);
      expect(m.dur).toBeGreaterThan(0);
      expect(m.dur).toBeLessThan(5);
    }
  });

  it('puts the must-hear moments above ticks and clinks', () => {
    for (const n of ['turn', 'snatchAlarm', 'snatchWin', 'win', 'bankrupt']) expect(RECIPES[n].priority).toBe(3);
    for (const n of ['step', 'click', 'tap', 'turnOther']) expect(RECIPES[n].priority).toBe(0);
    expect(RECIPES.coin.priority).toBeLessThan(RECIPES.turn.priority);
  });
});

describe('power card sounds', () => {
  it('are registered with the priorities of the spec: the play is notable, the rest are ordinary events', () => {
    expect(RECIPES.powerPlay.priority).toBeGreaterThanOrEqual(2);
    expect(RECIPES.powerPlay.priority).toBeLessThanOrEqual(3);
    for (const n of POWER_NAMES) {
      expect(RECIPES[n].priority, n).toBeGreaterThanOrEqual(1);
      expect(RECIPES[n].priority, n).toBeLessThanOrEqual(3);
      expect(RECIPES[n].dur, n).toBeLessThanOrEqual(1.5); // short one-shots: the ambient bed ducks for this long
      expect(RECIPES[n].cooldown, n).toBeGreaterThan(0);
    }
  });
  it('stay below the turn / win fanfares so a power card never drowns them', () => {
    for (const n of POWER_NAMES) expect(RECIPES[n].priority, n).toBeLessThan(RECIPES.turn.priority);
  });
});

describe('every sound builds a well-formed, bounded, self-cleaning graph', () => {
  for (const name of SOUND_NAMES) {
    for (const [i, opts] of (OPTS[name] || [undefined]).entries()) {
      it(`${name} #${i}`, () => {
        const { mixer, ctx } = rig();
        expect(mixer.play(name, opts)).toBe(true);
        const c = ctx();
        const srcs = c.sources;
        expect(srcs.length).toBeGreaterThan(0);
        expect(srcs.length).toBeLessThanOrEqual(90); // CPU: no recipe may build an unbounded graph
        let last = 0;
        for (const s of srcs) {
          expect(Number.isFinite(s.startAt)).toBe(true);
          expect(Number.isFinite(s.stopAt)).toBe(true);
          expect(s.startAt).toBeGreaterThanOrEqual(0);
          expect(s.stopAt).toBeGreaterThan(s.startAt);
          last = Math.max(last, s.stopAt);
          for (const p of [s.frequency, s.detune]) for (const e of p.events) expect(Number.isFinite(e[2])).toBe(true);
        }
        for (const n of c.nodes) {
          for (const k of ['gain', 'frequency', 'Q']) {
            if (n[k] && n[k].events) for (const e of n[k].events) {
              expect(Number.isFinite(e[1])).toBe(true);
              expect(e[2] ?? 0).toBeGreaterThanOrEqual(0);
            }
          }
        }
        // the sound is no longer than its declared length plus an envelope tail
        expect(last).toBeLessThanOrEqual(RECIPES[name].dur + 1.2);
        expect(mixer.activeVoices()).toBe(1);
        // after everything ended the voice and every one of its nodes is gone
        c.advance(10);
        expect(mixer.activeVoices()).toBe(0);
        expect(mixer.activeSources()).toBe(0);
        expect(c.live().length).toBe(0);
        const leaked = c.connectedNodes().filter((n) => n.kind === 'osc' || n.kind === 'buffer' || n.kind === 'panner');
        expect(leaked.length).toBe(0);
        // only the permanent master chain may still be connected
        const kinds = new Set(c.connectedNodes().map((n) => n.kind));
        for (const k of kinds) expect(['gain', 'compressor', 'shaper', 'convolver', 'biquad']).toContain(k);
        expect(c.connectedNodes().filter((n) => n.kind === 'gain').length).toBeLessThanOrEqual(8); // effects, ambient, duck, mix, master, send (+ the bare voice gain is freed)
      });
    }
  }
});

describe('pitch and amount rules', () => {
  it('maps cash to a number of clinks: one tick for small, a cascade for big, at most eight', () => {
    expect(clinksFor(5000)).toBe(1);
    expect(clinksFor(25000)).toBe(2);
    expect(clinksFor(-25000)).toBe(2);
    expect(clinksFor(200000)).toBe(5);
    expect(clinksFor(100000000)).toBe(8);
    expect(clinksFor(undefined)).toBe(2);
    expect(clinksFor('x')).toBe(2);
    let prev = 0;
    for (const a of [1000, 20000, 50000, 100000, 200000, 400000, 800000, 2000000]) {
      const n = clinksFor(a);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('a bigger payment builds a bigger cascade (more voices of tone)', () => {
    const count = (amount) => {
      const { mixer, ctx } = rig();
      mixer.play('coin', { amount });
      return ctx().sources.length;
    };
    expect(count(5000)).toBeLessThan(count(60000));
    expect(count(60000)).toBeLessThan(count(2000000));
  });

  it('dice face pitch rises with the face value', () => {
    const f = [1, 2, 3, 4, 5, 6].map(faceFreq);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    expect(faceFreq(99)).toBe(faceFreq(6));
    expect(faceFreq(-4)).toBe(faceFreq(1));
  });

  it('pawn step pitch climbs a pentatonic ladder along the move', () => {
    const freqOf = (i) => {
      const { mixer, ctx } = rig();
      mixer.play('step', { i, n: 8 });
      return ctx().sources[0].frequency.events[0][1];
    };
    const f = [0, 1, 2, 3, 4, 5].map(freqOf);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    // major pentatonic: 0 2 4 7 9 12
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => pentMidi(60, i))).toEqual([60, 62, 64, 67, 69, 72, 74]);
    expect(hz(69)).toBeCloseTo(440, 6);
  });

  it('the snatch tick-tock speeds up and climbs over the window', () => {
    const ticks = snatchTickTimes(5000);
    expect(ticks.length).toBeGreaterThan(8);
    expect(ticks[0].at).toBeGreaterThanOrEqual(800);
    expect(ticks[ticks.length - 1].at).toBeLessThan(5000);
    const gaps = ticks.slice(1).map((t, i) => t.at - ticks[i].at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1]);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0] / 2);
    expect(ticks[ticks.length - 1].urgency).toBeGreaterThan(ticks[0].urgency);
    expect(ticks.map((t) => t.tock)).toEqual(ticks.map((_, i) => i % 2 === 1)); // tick, tock, tick...
    expect(snatchTickTimes(200).length).toBeLessThan(5); // absurdly short window: no flood
  });
});

describe('dice rattle follows the die', () => {
  it('uses the same bounce times as the die animation', () => {
    expect([...DICE_BOUNCES]).toEqual([...BOUNCE_AT]);
  });

  it('knocks at each bounce, scaled to the tumble length, and stays inside it', () => {
    const knockTimes = (ms) => {
      const { mixer, ctx } = rig();
      mixer.play('dice', { ms });
      const c = ctx();
      // the low "knock" oscillators: sine sources that start at a bounce
      const starts = c.sources.filter((s) => s.kind === 'osc' && s.type === 'sine').map((s) => s.startAt);
      const end = Math.max(...c.sources.map((s) => s.stopAt));
      return { starts: starts.sort((a, b) => a - b), end };
    };
    const slow = knockTimes(1100);
    const fast = knockTimes(550);
    expect(slow.starts.length).toBeGreaterThanOrEqual(3);
    const rel = (k) => k.starts.slice(0, 3).map((t) => (t - 0.012) / (k === slow ? 1.1 : 0.55));
    rel(slow).forEach((r, i) => expect(r).toBeCloseTo(BOUNCE_AT[i], 1));
    rel(fast).forEach((r, i) => expect(r).toBeCloseTo(BOUNCE_AT[i], 1));
    expect(fast.end).toBeLessThan(slow.end); // twice the playback speed = a shorter rattle
    expect(fast.end).toBeLessThan(0.55 + 0.45);
  });
});

describe('mixer chain', () => {
  it('limits and soft-clips: a master compressor, a shaper that never exceeds 1', () => {
    const { mixer, ctx } = rig();
    mixer.play('click');
    const c = ctx();
    const kinds = c.nodes.map((n) => n.kind);
    expect(kinds).toContain('compressor');
    expect(kinds).toContain('shaper');
    const shaper = c.nodes.find((n) => n.kind === 'shaper');
    const curve = softClipCurve();
    expect(Math.max(...curve)).toBeCloseTo(1, 3);
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(-1);
    expect(shaper.curve.length).toBeGreaterThan(256);
    // transparent below 0.7, monotonic overall
    const mid = curve[Math.round((0.5 + 1) / 2 * (curve.length - 1))];
    expect(mid).toBeCloseTo(0.5, 2);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    // the chain ends at the destination
    expect(shaper.outs.has(c.destination)).toBe(true);
  });

  it('has a perceptual master curve that keeps the old default level', () => {
    expect(masterLevel(0.8)).toBeCloseTo(0.56, 2);
    expect(masterLevel(0)).toBe(0);
    expect(masterLevel(1)).toBeLessThanOrEqual(0.8);
    expect(masterLevel(0.4)).toBeLessThan(masterLevel(0.8));
    expect(effectsLevel(1)).toBe(1);
    expect(effectsLevel(0)).toBe(0);
  });

  it('applies master and effects volume to the graph, live', () => {
    const { mixer, ctx } = rig();
    mixer.play('click');
    mixer.applySettings({ volume: 0.5, sfxVolume: 0.5 });
    const c = ctx();
    const master = mixer.getNodes().master.gain;
    const eff = mixer.getNodes().effects.gain;
    expect(master.events.at(-1)[1]).toBeCloseTo(masterLevel(0.5), 4);
    expect(eff.events.at(-1)[1]).toBeCloseTo(effectsLevel(0.5), 4);
    expect(c).toBeTruthy();
  });

  it('is silent when sound is off, volume 0 or effects 0', () => {
    for (const s of [{ sfx: false }, { volume: 0 }, { sfxVolume: 0 }]) {
      const { mixer, ctx } = rig();
      mixer.applySettings(s);
      expect(mixer.play('click')).toBe(false);
      expect(ctx()?.sources.length || 0).toBe(0);
    }
  });

  it('rate-limits a sound inside its cooldown, and lets it through after', () => {
    const { mixer, clock } = rig();
    expect(mixer.play('coin', { amount: 5000 })).toBe(true);
    clock.ms += 20;
    expect(mixer.play('coin', { amount: 5000 })).toBe(false); // coalesced
    clock.ms += 200;
    expect(mixer.play('coin', { amount: 5000 })).toBe(true);
    expect(mixer.stats().cooled).toBe(1);
  });

  it('caps simultaneous voices at 8 and steals the weakest', () => {
    const { mixer, clock, ctx } = rig();
    for (let i = 0; i < 20; i++) {
      clock.ms += 200;
      mixer.play('step', { i });
    }
    expect(mixer.activeVoices()).toBeLessThanOrEqual(8);
    expect(mixer.stats().stolen).toBeGreaterThan(0);
    // a must-hear sound always gets in, even with the table full of ticks
    clock.ms += 200;
    expect(mixer.play('turn')).toBe(true);
    expect(mixer.activeVoices()).toBeLessThanOrEqual(8);
    const turnLive = ctx().live().length;
    expect(turnLive).toBeGreaterThan(0);
  });

  it('drops a low-priority sound when every voice playing matters more', () => {
    const { mixer, clock } = rig({ env: { maxVoices: 2 } });
    clock.ms += 1000;
    expect(mixer.play('win')).toBe(true);
    clock.ms += 1000;
    expect(mixer.play('bankrupt')).toBe(true);
    clock.ms += 1000;
    expect(mixer.play('step', { i: 1 })).toBe(false);
    expect(mixer.activeVoices()).toBe(2);
    expect(mixer.stats().dropped).toBeGreaterThan(0);
    clock.ms += 1000;
    expect(mixer.play('snatchAlarm')).toBe(true); // an equal-priority newcomer steals the weakest
    expect(mixer.activeVoices()).toBe(2);
  });

  it('stops stolen voices quickly and frees their nodes', () => {
    const { mixer, clock, ctx, timers } = rig({ env: { maxVoices: 1 } });
    mixer.play('click');
    clock.ms += 500;
    mixer.play('coin', { amount: 5000 });
    const c = ctx();
    expect(mixer.activeVoices()).toBe(1);
    const stopped = c.sources.filter((s) => s.stopAt !== null && s.stopAt < 0.2);
    expect(stopped.length).toBeGreaterThan(0);
    timers.forEach((t) => t.fn()); // the deferred disconnect
    c.advance(5);
    expect(c.live().length).toBe(0);
  });

  it('does not leak: many plays and a long advance leave only the master chain connected', () => {
    const { mixer, clock, ctx } = rig();
    const names = ['click', 'coin', 'pay', 'step', 'card', 'diceLand', 'tick', 'toggle', 'land'];
    for (let i = 0; i < 300; i++) {
      clock.ms += 250;
      mixer.play(names[i % names.length], { amount: 20000 * (1 + (i % 5)), i, values: [1 + (i % 6)], deck: i % 2 ? 'luck' : 'drama' });
      ctx().advance(0.3);
    }
    ctx().advance(20);
    expect(mixer.activeVoices()).toBe(0);
    expect(mixer.activeSources()).toBe(0);
    const c = ctx();
    expect(c.connectedNodes().filter((n) => n.kind === 'osc' || n.kind === 'buffer').length).toBe(0);
    expect(c.connectedNodes().length).toBeLessThan(15);
  });

  it('sweeps a voice whose "ended" event never arrives', () => {
    const { mixer, clock, ctx } = rig();
    mixer.play('click');
    expect(mixer.activeVoices()).toBe(1);
    const c = ctx();
    c.currentTime = 100; // time passed, but no onended was ever delivered
    clock.ms += 1000;
    mixer.play('tap');
    expect(mixer.activeVoices()).toBe(1); // the stale click was swept, the new tap counts
  });

  it('survives a recipe that throws', () => {
    const bad = { boom: { name: 'boom', priority: 1, cooldown: 0, dur: 0.1, fn: (s, t) => { s.tone({ f: 440, t, d: 0.1 }); throw new Error('x'); } } };
    const { mixer, ctx } = rig({ env: { recipes: bad } });
    expect(mixer.play('boom')).toBe(false);
    expect(mixer.activeVoices()).toBe(0);
    expect(ctx().sources[0].stopAt).not.toBeNull(); // the half-built voice was stopped
    expect(mixer.play('nope')).toBe(false);
  });

  it('adds optional pan and reverb only where the platform has them', () => {
    const { mixer, ctx } = rig();
    mixer.play('step', { i: 2, pan: 0.4 });
    expect(ctx().nodes.some((n) => n.kind === 'panner')).toBe(true);
    expect(ctx().nodes.some((n) => n.kind === 'convolver')).toBe(true);
  });
});

describe('audio lifecycle', () => {
  it('creates no AudioContext before a user gesture (so no autoplay warning)', () => {
    let allowed = false;
    const { mixer, ctxs } = rig({ canStart: () => allowed });
    expect(mixer.play('click')).toBe(false);
    mixer.unlock();
    expect(ctxs.length).toBe(0);
    allowed = true;
    expect(mixer.play('click')).toBe(true);
    expect(ctxs.length).toBe(1);
  });

  it('queues a sound that arrives while the context is still resuming and replays it when fresh', async () => {
    const { mixer, clock, ctx } = rig({ ctxOpts: { state: 'suspended', asyncResume: true } });
    const play = mixer.play('click');
    expect(play).toBe(true); // queued
    expect(mixer.pendingCount()).toBe(1);
    expect(ctx().sources.length).toBe(0);
    await Promise.resolve();
    await Promise.resolve(); // resume() resolves -> state 'running' -> replay
    expect(ctx().resumeCalls).toBeGreaterThan(0);
    expect(ctx().state).toBe('running');
    expect(mixer.pendingCount()).toBe(0);
    expect(ctx().sources.length).toBeGreaterThan(0);
    expect(mixer.stats().replayed).toBe(1);
    expect(clock.ms).toBe(1000);
  });

  it('drops a queued sound that went stale before the context started', () => {
    const { mixer, clock, ctx } = rig({ ctxOpts: { state: 'suspended', asyncResume: true } });
    mixer.play('click');
    clock.ms += 2000;
    const c = ctx();
    c._set('running'); // the context finally runs, two seconds later
    expect(c.sources.length).toBe(0);
    expect(mixer.pendingCount()).toBe(0);
  });

  it('stops everything and suspends when the tab is hidden, resumes when it returns', async () => {
    let hid = false;
    const { mixer, ctx } = rig({ hidden: () => hid });
    mixer.play('win');
    expect(mixer.activeVoices()).toBe(1);
    hid = true;
    mixer.onHidden();
    expect(mixer.activeVoices()).toBe(0);
    expect(ctx().suspendCalls).toBe(1);
    expect(mixer.play('click')).toBe(false); // nothing plays while hidden
    hid = false;
    mixer.onVisible();
    await Promise.resolve();
    expect(ctx().state).toBe('running');
    expect(mixer.play('click')).toBe(true);
  });

  it('reports an interrupted / suspended context as needing a gesture', () => {
    const { mixer, ctx } = rig({ ctxOpts: { state: 'interrupted' } });
    expect(mixer.needsGesture()).toBe(true); // not even created
    mixer.unlock();
    expect(ctx().resumeCalls).toBe(1);
    expect(mixer.needsGesture()).toBe(false);
  });
});

describe('ambient bed', () => {
  function ambientRig(over = {}) {
    const r = rig(over);
    return r;
  }

  it('is off by default and only plays in a game scene, with sound on, when asked', () => {
    const { mixer, ctx } = ambientRig();
    mixer.setScene(true);
    expect(mixer.isAmbientRunning()).toBe(false);
    mixer.applySettings({ ambient: true });
    expect(mixer.isAmbientRunning()).toBe(true);
    expect(ctx().live().length).toBeGreaterThan(0);
    mixer.setScene(false);
    expect(mixer.isAmbientRunning()).toBe(false);
    mixer.setScene(true);
    expect(mixer.isAmbientRunning()).toBe(true);
    mixer.applySettings({ sfx: false });
    expect(mixer.isAmbientRunning()).toBe(false);
  });

  it('fades out, ends its sources, frees its nodes and clears its chime timer on stop', () => {
    const { mixer, ctx, timers } = ambientRig();
    mixer.applySettings({ ambient: true });
    mixer.setScene(true);
    const before = ctx().live().length;
    expect(before).toBe(3);
    expect(timers.length).toBeGreaterThan(0); // the chime timer is armed
    mixer.setScene(false);
    ctx().advance(2);
    expect(ctx().live().length).toBe(0);
    expect(ctx().connectedNodes().filter((n) => n.kind === 'osc' || n.kind === 'buffer').length).toBe(0);
  });

  it('plays a chime when its timer fires, ducks under effects, and stops with the tab hidden', () => {
    let hid = false;
    const { mixer, ctx, timers, clock } = ambientRig({ hidden: () => hid });
    mixer.applySettings({ ambient: true });
    mixer.setScene(true);
    const n0 = ctx().sources.length;
    timers[0].fn(); // distant chime
    expect(ctx().sources.length).toBeGreaterThan(n0);
    // ducking: an effect lowers the ambient duck gain and schedules its recovery
    clock.ms += 500;
    mixer.play('buy');
    const duck = mixer.getNodes().duck.gain.events;
    expect(duck.some((e) => e[0] === 'target' && e[1] < 1)).toBe(true);
    expect(duck.some((e) => e[0] === 'target' && e[1] === 1)).toBe(true);
    hid = true;
    mixer.onHidden();
    expect(mixer.isAmbientRunning()).toBe(false);
  });

  it('never starts the bed without a context-start gesture', () => {
    let ok = false;
    const { mixer, ctxs } = ambientRig({ canStart: () => ok });
    mixer.applySettings({ ambient: true });
    mixer.setScene(true);
    expect(ctxs.length).toBe(0);
    ok = true;
    mixer.unlock();
    mixer.applySettings({ ambient: true }); // a settings change re-syncs
    expect(mixer.isAmbientRunning()).toBe(true);
  });
});

describe('public sfx module in a non-browser environment', () => {
  it('never throws and stays silent', async () => {
    const { sfx } = await import('./sfx.js');
    expect(() => sfx.play('click')).not.toThrow();
    expect(sfx.play('click')).toBe(false);
    expect(() => sfx.unlock()).not.toThrow();
    expect(() => sfx.setScene(true)).not.toThrow();
    const stop = sfx.snatchWindow({ ms: 5000 });
    expect(typeof stop).toBe('function');
    stop();
  });
});
