import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { createAmbience, LAYER_SPECS, TICK_MS } from './ambience.js';
import { CONTINUOUS_LAYERS, layerLevels } from './mix.js';

let ctx;
let dest;
let t;
let timers;
let intervals;
const rng = () => 0; // the soonest possible sporadic sounds

function make() {
  return createAmbience({ ctx, dest, now: () => t, timers, rng });
}
const lastTarget = (layerGainParam) => [...layerGainParam.events].reverse().find((e) => e[0] === 'target')?.[1];

beforeEach(() => {
  ctx = new FakeAudioContext();
  dest = ctx.createGain();
  t = 0;
  intervals = [];
  timers = {
    setInterval: (fn, ms) => (intervals.push({ fn, ms }), intervals.length),
    clearInterval: (id) => {
      intervals[id - 1] = null;
    },
  };
});

describe('createAmbience', () => {
  it('builds nothing until started, then only the layers the hour needs (lazy: low CPU)', () => {
    const a = make();
    a.setLevels(layerLevels(13.5));
    expect(a.layerIds()).toEqual([]);
    expect(ctx.sources.length).toBe(0);
    a.start();
    const ids = a.layerIds();
    expect(ids).toEqual(expect.arrayContaining(['heat', 'cicadas', 'traffic', 'crowd']));
    expect(ids).not.toContain('crickets');
    expect(ids).not.toContain('radio');
    expect(intervals[0].ms).toBe(TICK_MS);
    expect(ctx.sources.every((s) => s.startAt !== null)).toBe(true);
  });

  it('crossfades with the hour: a daypart change glides layers up and down instead of cutting', () => {
    const a = make();
    a.start();
    a.setLevels(layerLevels(13.5));
    a.setLevels(layerLevels(22.5));
    expect(a.layerIds()).toContain('crickets');
    const out = (id) => ctx.nodes.filter((n) => n.kind === 'gain' && n.gain.events.some((e) => e[0] === 'target'));
    expect(out().length).toBeGreaterThan(0);
    // heat was loud at noon, is silent at night: its last target is 0, reached through setTargetAtTime (a glide), never a jump
    const heatOut = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.filter((e) => e[0] === 'target').length === 2 && lastTarget(n.gain) === 0);
    expect(heatOut).toBeTruthy();
    const targets = heatOut.gain.events.filter((e) => e[0] === 'target');
    expect(targets[0][1]).toBeGreaterThan(0);
    expect(targets[0][3]).toBeGreaterThan(0.5); // time constant: seconds, a slow fade
  });

  it('keeps layers mixed low', () => {
    for (const id of CONTINUOUS_LAYERS) expect(LAYER_SPECS[id].gain, id).toBeLessThanOrEqual(0.6);
    const a = make();
    a.start();
    a.setLevels(layerLevels(17.75, 1));
    const targets = ctx.nodes.filter((n) => n.kind === 'gain').flatMap((n) => n.gain.events.filter((e) => e[0] === 'target').map((e) => e[1]));
    expect(Math.max(...targets)).toBeLessThanOrEqual(0.6);
  });

  it('fires sporadic one-shots from the timer, spaced apart, and only for layers that are on', () => {
    const a = make();
    a.setLevels(layerLevels(5.5)); // dawn: birds, temple bell, a few crickets
    a.start();
    a.tick();
    expect(a.stats().sporadic).toBe(0); // the first one is not instant
    t = 800;
    const before = ctx.sources.length;
    a.tick();
    expect(a.stats().sporadic).toBe(1);
    expect(ctx.sources.length).toBeGreaterThan(before);
    // two due layers at the same moment do not both start: one-shots keep a minimum gap
    t = 20000;
    a.tick();
    expect(a.stats().sporadic).toBe(2);
    a.tick();
    expect(a.stats().sporadic).toBe(2);
  });

  it('plays the quiet tabla loop ahead of the audio clock in the evening only', () => {
    const a = make();
    a.setLevels(layerLevels(13.5));
    a.start();
    const base = ctx.sources.length;
    a.tick();
    expect(ctx.sources.length - base).toBeLessThan(40); // noon: no tabla (only maybe a one-shot)
    a.setLevels(layerLevels(17.75));
    const n0 = ctx.sources.length;
    a.tick();
    const scheduled = ctx.sources.slice(n0).filter((s) => s.startAt >= ctx.currentTime && s.startAt < ctx.currentTime + 0.5);
    expect(scheduled.length).toBeGreaterThan(0);
    ctx.advance(0.4);
    const n1 = ctx.sources.length;
    a.tick();
    expect(ctx.sources.length).toBeGreaterThan(n1); // keeps scheduling the next steps
  });

  it('does nothing while the context is suspended (hidden tab)', () => {
    const a = make();
    a.setLevels(layerLevels(17.75));
    a.start();
    ctx.state = 'suspended';
    const n = ctx.sources.length;
    t = 60000;
    a.tick();
    expect(ctx.sources.length).toBe(n);
  });

  it('stop() fades everything out and stops the timer; dispose() frees every node', () => {
    const a = make();
    a.setLevels(layerLevels(13.5));
    a.start();
    const ids = a.layerIds();
    a.stop();
    expect(a.isRunning()).toBe(false);
    expect(intervals[0]).toBeNull();
    const outs = ctx.nodes.filter((n) => n.kind === 'gain' && lastTarget(n.gain) === 0);
    expect(outs.length).toBeGreaterThanOrEqual(ids.length);
    a.start(); // can restart
    expect(a.isRunning()).toBe(true);
    a.dispose();
    ctx.advance(5);
    expect(ctx.live().length).toBe(0);
    expect(ctx.connectedNodes().filter((n) => n !== dest)).toEqual([]);
    a.start(); // no-op after dispose
    expect(a.isRunning()).toBe(false);
  });
});
