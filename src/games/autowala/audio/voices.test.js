// installVoices end to end with a fake ctx (no browser: no audio files, no Web Audio => every line degrades to a silent subtitle).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installVoices, destKey, firstPos } from './voices.js';
import { getLine } from './voiceLines.js';

function fakeCtx(over = {}) {
  const listeners = new Set();
  const systems = [];
  allSystems = systems;
  const emitted = [];
  const ctx = {
    game: { on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    emit: (type, data = {}) => {
      const e = { type, ...data };
      emitted.push(e);
      [...listeners].forEach((l) => l(e));
    },
    profile: { data: { settings: {}, totalEarned: 0, rides: 0 } },
    v: { x: 0, z: 0, heading: 0, fuel: 12, kmh: 0, jolt: 0 },
    camera: null,
    clock: { hour: 12, time: 100 },
    state: { weather: 0 },
    fares: { trip: null, waiting: [] },
    world: { city: { poiById: {} } },
    hooks: {},
    addSystem: (s) => { systems.push(s); return s; },
    ...over,
  };
  return { ctx, emitted, systems, lines: () => emitted.filter((e) => e.type === 'voice:line') };
}
let allSystems = [];
/** advance the fake clock in 100 ms steps, running every installed system's update like the game loop does */
async function tick(ms) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
    allSystems.forEach((sys) => sys.update?.(0.1));
  }
}

describe('installVoices (fake ctx)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 })); // no files generated yet: the normal state
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tolerates a missing index.json and exposes a debug handle', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    await tick(50);
    expect(f.ctx.voices.stats().files).toBe(0);
    f.systems[0].dispose();
    expect(f.ctx.voices).toBeUndefined();
  });

  it('a hail from the customer\'s side shows a subtitle in that persona (no audio file needed)', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.emit('fare:hail', { customer: { id: 'a', x: 20, z: 5, kind: 'elder', name: 'Lakshmi Amma' } });
    await tick(100);
    const [l] = f.lines();
    expect(l).toMatchObject({ persona: 'elder_woman', speaker: 'Lakshmi Amma', hero: false, mode: 'silent' });
    expect(l.text).toBe(l.te);
    expect(getLine(l.id).kind).toBe('elder');
    expect(l.en).toBeTruthy();
    expect(l.ms).toBeGreaterThan(500);
  });

  it('ignores a customer out of earshot (> 90 m) and bad payloads', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.emit('fare:hail', { customer: { id: 'far', x: 400, z: 0, kind: 'regular' } });
    f.ctx.emit('fare:hail', { customer: { id: 'bad', kind: 'regular' } });
    f.ctx.emit('fare:hail', {});
    f.ctx.emit('fare:dropoff', {});
    f.ctx.emit('wallet', {});
    await tick(100);
    expect(f.lines().length).toBeLessThanOrEqual(1); // only the (dropoff-without-trip) thanks, never a hail
    expect(f.lines().every((l) => !l.id.startsWith('hail_'))).toBe(true);
  });

  it('mentions the place when the customer has one, and never otherwise', async () => {
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      const f = fakeCtx();
      installVoices(f.ctx);
      f.ctx.emit('fare:hail', { customer: { id: `p${i}`, x: 10, z: 0, kind: 'regular', name: 'Ravi Anna', place: { name: 'Bawarchi', brand: 'Bawarchi' } } });
      await tick(50);
      const l = f.lines()[0];
      if (l) seen.add(getLine(l.id).place || 'none');
      f.systems[0].dispose();
    }
    expect(seen.has('bawarchi')).toBe(true);
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.emit('fare:hail', { customer: { id: 'np', x: 10, z: 0, kind: 'regular', name: 'Ravi Anna' } });
    await tick(50);
    expect(getLine(f.lines()[0].id).place).toBeUndefined();
  });

  it('a trip: boarding line with the destination, a crash reaction, thanks, then the hero on the first fare', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.profile.data.rides = 1;
    f.ctx.fares.trip = { status: 'riding' };
    f.ctx.emit('fare:pickup', { trip: { id: 't', kind: 'rusher', name: 'Ravi', dest: { poiId: 'airport' } } });
    await tick(100);
    expect(f.lines()[0]).toMatchObject({ persona: 'man_rusher' });
    expect(getLine(f.lines()[0].id).category).toBe('boarding');

    await tick(3000);
    f.ctx.emit('crash', { strength: 0.8 });
    await tick(100);
    expect(f.lines().at(-1).id).toBe('crash_m');

    await tick(3000);
    f.ctx.fares.trip = null;
    f.ctx.emit('fare:dropoff', { trip: { id: 't' }, fare: 120, tip: 0, rating: 5 });
    await tick(6000);
    const ids = f.lines().map((l) => l.id);
    expect(ids.some((id) => id.startsWith('thx_'))).toBe(true);
    expect(f.lines().at(-1).hero).toBe(true); // the hero waited for the passenger, then spoke
    expect(f.lines().at(-1).id.startsWith('hero_first_')).toBe(true);
    expect(f.ctx.voices.stats().heard.first_fare).toBe(1);
  });

  it('never lets the hero overlap a passenger line', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.voices.say('thx_w1');
    f.ctx.voices.say('hero_first_1');
    await tick(100);
    expect(f.lines().map((l) => l.id)).toEqual(['thx_w1']); // the hero is queued behind it
    await tick(4000);
    expect(f.lines().map((l) => l.id)).toEqual(['thx_w1', 'hero_first_1']);
  });

  it('reacts to the road-rage events with the angry driver and the hero', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.emit('rage:start', { chasers: [{ x: 15, z: 10 }, { x: 30, z: 4 }] });
    await tick(100);
    expect(f.lines()[0]).toMatchObject({ persona: 'driver_angry' });
    expect(getLine(f.lines()[0].id).category).toBe('rage_start');
    await tick(4000);
    f.ctx.emit('rage:shout', { kind: 'horn' });
    await tick(100);
    expect(getLine(f.lines().at(-1).id).category).toBe('rage_shout');
    await tick(4000);
    f.ctx.emit('traffic:hit', { kind: 'car', severity: 0.7 });
    f.ctx.emit('traffic:hit', { kind: 'car', severity: 0.1 }); // too light: no shout
    await tick(100);
    expect(getLine(f.lines().at(-1).id).category).toBe('traffic_hit');
    await tick(4000);
    f.ctx.emit('rage:escaped', {});
    await tick(100);
    expect(f.lines().at(-1).id).toMatch(/^hero_escape_/);
    await tick(4000);
    f.ctx.emit('rage:caught', { fine: 300, chasers: [{ x: 5, z: 5 }] });
    await tick(6000);
    const cats = f.lines().map((l) => getLine(l.id).category);
    expect(cats.slice(-2)).toEqual(['rage_caught', 'hero_caught']);
  });

  it('plays the Rs 1000 and 5000 hero milestones once, big air and a long drift', async () => {
    const f = fakeCtx();
    installVoices(f.ctx);
    f.ctx.profile.data.totalEarned = 1100;
    f.ctx.emit('wallet', { wallet: 700, delta: 500 });
    await tick(100);
    expect(f.lines().at(-1).id).toMatch(/^hero_1k_/);
    await tick(10000);
    f.ctx.profile.data.totalEarned = 1300;
    f.ctx.emit('wallet', { wallet: 800, delta: 200 });
    await tick(100);
    expect(f.lines().length).toBe(1); // the 1000 milestone does not repeat
    f.ctx.emit('land', { air: 0.3, impact: 2 }); // a small hop: nothing
    f.ctx.emit('drift-end', { time: 1 }); // a short drift: nothing
    await tick(100);
    expect(f.lines().length).toBe(1);
    f.ctx.emit('land', { air: 1.6, impact: 5 });
    await tick(4000);
    expect(f.lines().at(-1).id).toMatch(/^hero_jump_/);
    await tick(10000);
    f.ctx.emit('drift-end', { time: 4 });
    await tick(100);
    expect(f.lines().at(-1).id).toMatch(/^hero_drift_/);
  });

  it('is silent for the speaker settings but keeps the subtitles when voice is off', async () => {
    const f = fakeCtx();
    f.ctx.profile.data.settings.voice = false;
    installVoices(f.ctx);
    f.ctx.emit('fare:hail', { customer: { id: 'a', x: 5, z: 5, kind: 'student', name: 'Kiran' } });
    await tick(100);
    expect(f.lines()[0]).toMatchObject({ persona: 'student', mode: 'silent' });
  });

  it('helpers: destination keys and positions', () => {
    expect(destKey({ poiId: 'charminar' })).toBe('charminar');
    expect(destKey({ name: 'Secunderabad Railway Station' })).toBe('station');
    expect(destKey({ name: 'RGIA Airport' })).toBe('airport');
    expect(destKey(null)).toBe(null);
    expect(firstPos([{ x: 1, z: 2 }, { x: 3, z: 4 }])).toEqual({ x: 1, z: 2 });
    expect(firstPos({ x: 1, z: 2 })).toEqual({ x: 1, z: 2 });
    expect(firstPos({})).toBe(null);
    expect(firstPos(undefined)).toBe(null);
    expect(firstPos(3)).toBe(null);
  });
});
