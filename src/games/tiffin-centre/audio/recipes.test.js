import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import { createSynth } from '@/lib/soundscape/synth.js';
import { AMBIENT_RECIPES, RECIPES, tabla } from './recipes.js';
import { SOUND_NAMES } from './mapping.js';
import { SPORADIC_LAYERS } from './mix.js';

function run(fn, opts) {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();
  const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
  const s = createSynth(ctx, dest, voice);
  fn(s, 1, opts); // the fake throws on invalid automation (non-positive exponential ramps) and on double start
  return { ctx, voice, dest };
}

describe('recipes', () => {
  it('has a recipe for every sound name and vice versa', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...SOUND_NAMES].sort());
    expect(Object.keys(AMBIENT_RECIPES).sort()).toEqual([...SPORADIC_LAYERS].sort());
  });

  it('every recipe schedules sources that start and stop in order, and stays short', () => {
    const optSets = {
      sizzle: [{ kind: 'tawa' }, { kind: 'kadai' }, { kind: 'steamer' }, { kind: 'chai' }, {}],
      collect: [{ tier: 0 }, { tier: 1, steps: 4 }, { tier: 2, steps: 21 }],
      fanfare: [{ stars: 1 }, { stars: 2 }, { stars: 3 }],
      emote: [{ e: 'thumbs' }, { e: 'fire' }, { e: 'help' }, { e: 'thanks' }],
      steps: [{ times: [0, 0.26, 0.52], pan: -0.3 }, {}],
      ding: [{ kind: 'tawa' }, { kind: 'chai' }],
    };
    for (const [name, fn] of Object.entries(RECIPES)) {
      for (const opts of optSets[name] || [{}]) {
        const { ctx, voice } = run(fn, { pan: 0.2, ...opts });
        expect(ctx.sources.length, name).toBeGreaterThan(0);
        expect(voice.sources, name).toBe(ctx.sources.length);
        for (const src of ctx.sources) {
          expect(src.startAt, name).not.toBeNull();
          expect(src.stopAt, name).toBeGreaterThanOrEqual(src.startAt);
          expect(src.stopAt - 1, `${name} too long`).toBeLessThan(name === 'fanfare' || name === 'closed' ? 3.6 : 2.6);
        }
      }
    }
  });

  it('every sound is gentle: the summed note volumes of one voice stay modest (the limiter does the rest)', () => {
    for (const [name, fn] of Object.entries(RECIPES)) {
      const { voice } = run(fn, { kind: 'kadai', tier: 2, stars: 3 });
      expect(voice.loud, name).toBeLessThan(name === 'fanfare' || name === 'closed' ? 4 : 2.2);
    }
  });

  it('cleans every node up when the sources end (no leaks)', () => {
    for (const [name, fn] of Object.entries({ ...RECIPES, ...AMBIENT_RECIPES })) {
      const { ctx, dest } = run(fn, { kind: 'chai', tier: 2, stars: 3 });
      ctx.advance(10);
      expect(ctx.live().length, name).toBe(0);
      // everything but the destination-facing gain we made ourselves is disconnected again
      expect(ctx.connectedNodes().filter((n) => n !== dest), name).toEqual([]);
    }
  });

  it('plays all tabla strokes', () => {
    for (const kind of ['dha', 'ge', 'na', 'tin', 'ti', 'unknown']) {
      const { ctx } = run((s, t) => tabla(s, t, kind, 0.1, 0.1));
      expect(ctx.sources.length, kind).toBeGreaterThan(0);
    }
  });

  it('collect scales with the tier: more coins and a closing bell for big amounts', () => {
    const n = (tier) => run(RECIPES.collect, { tier }).ctx.sources.length;
    expect(n(1)).toBeGreaterThan(n(0));
    expect(n(2)).toBeGreaterThan(n(1));
  });

  it('collect climbs in pitch with the combo steps', () => {
    const f = (steps) => run(RECIPES.collect, { tier: 0, steps }).ctx.sources.filter((x) => x.kind === 'osc').map((x) => x.frequency.events[0][1]);
    const low = Math.max(...f(0));
    const high = Math.max(...f(12));
    expect(high).toBeGreaterThan(low * 1.9);
  });

  it('footsteps put one tap (a noise burst and a thud) at every time', () => {
    const { ctx } = run(RECIPES.steps, { times: [0, 0.2, 0.4, 0.6] });
    expect(ctx.sources.length).toBe(8);
  });
});
