import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeNode } from '@/lib/soundscape/fakeAudio.js';
import {
  createRecordedVoices,
  isMeteredConnection,
  voiceRate,
  voicePan,
  isWhisper,
  CACHE_MAX,
  POOL_SIZE,
  RETRY_MS,
  PAUSE_MAX_MS,
  RATE_RANGE,
  WHISPER_GAIN,
  WARM_MAX,
} from './recorded.js';
import { createTiffinSpeech, _resetVoicesMemory } from './speech.js';
import { createTiffinAudio } from './index.js';
import { speechParams } from './speechVoices.js';

// ---- fakes -------------------------------------------------------------------------------------------

class FakeAudio {
  constructor(reg) {
    this.reg = reg;
    this.src = '';
    this.preload = '';
    this.volume = 1;
    this.muted = false;
    this.playbackRate = 1;
    this.preservesPitch = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.listeners = {};
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.srcs = [];
    reg.elements.push(this);
  }
  addEventListener(n, f) {
    (this.listeners[n] ||= []).push(f);
  }
  fire(n) {
    (this.listeners[n] || []).forEach((f) => f());
  }
  play() {
    this.playCalls++;
    if (this.src) this.srcs.push(this.src);
    if (this.reg.playError) return Promise.reject(Object.assign(new Error('play() failed because the user did not interact'), { name: this.reg.playError }));
    this.paused = false;
    if (this.src && this.src !== this.reg.silent) this.duration = this.reg.durations[this.src] ?? 2.5;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
  removeAttribute(n) {
    if (n === 'src') this.src = '';
  }
  load() {}
  /** the clip plays to its end */
  end() {
    this.currentTime = this.duration;
    this.paused = true;
    this.fire('ended');
  }
  fail() {
    this.fire('error');
  }
}

class CtxWithElements extends FakeAudioContext {
  createMediaElementSource(el) {
    const n = new FakeNode(this, 'mediasrc');
    n.el = el;
    return n;
  }
}

const TE_MANIFEST = {
  v: 1,
  lang: 'te',
  lines: {
    'te-greet-01': { f: 'te/te-greet-01.mp3', ms: 2000, voice: 'Anu', g: 'f', tag: '[warm]', mood: 'happy', sit: 'greet' },
    'te-greet-02': { f: 'te/te-greet-02.mp3', ms: 1800, voice: 'Ravi', g: 'm', tag: '', mood: 'neutral', sit: 'greet' },
    'te-greet-03': { f: 'te/te-greet-03.mp3', ms: 1500, voice: 'Ravi', g: 'm', tag: '', mood: 'neutral', sit: 'greet' },
    'te-greet-04': { f: 'te/te-greet-04.mp3', ms: 1500, voice: 'Ravi', g: 'm', tag: '', mood: 'neutral', sit: 'greet' },
    'te-waiting-polite-01': { f: 'te/te-waiting-polite-01.mp3', ms: 2500, voice: 'Anu', g: 'f', tag: '[whispers]', mood: 'sheepish', sit: 'waiting-polite' },
    'te-waiting-angry-01': { f: 'te/te-waiting-angry-01.mp3', ms: 2200, voice: 'Ravi', g: 'm', tag: '[angry]', mood: 'angry', sit: 'waiting-angry' },
    'te-pay-01': { f: 'te/te-pay-01.mp3', ms: 1200, voice: 'Ravi', g: 'm', tag: '', mood: 'happy', sit: 'pay' },
  },
};

let reg;
let clock;
let timers;
let hub;
let calls;
let fetchLog;
let routes;
let revoked;
let seq;

function makeTimers(c) {
  let id = 0;
  const tasks = new Map();
  return {
    setTimeout: (fn, ms) => (tasks.set(++id, { fn, at: c.t + ms }), id),
    clearTimeout: (i) => tasks.delete(i),
    setInterval: () => 0,
    clearInterval: () => {},
    advance(ms) {
      const end = c.t + ms;
      for (;;) {
        let next = null;
        for (const [i, t] of tasks) if (t.at <= end && (!next || t.at < next.t.at)) next = { i, t };
        if (!next) break;
        c.t = Math.max(c.t, next.t.at);
        tasks.delete(next.i);
        next.t.fn();
      }
      c.t = end;
    },
    count: () => tasks.size,
  };
}

const urlApi = {
  createObjectURL: () => `blob:clip-${++seq}`,
  revokeObjectURL: (u) => revoked.push(u),
};

/** A fake fetch over `routes`: url -> { status, json, text, blob, throws } (default: the clip of any /te/ url is an mp3, others 404). */
function fakeFetch(url) {
  fetchLog.push(url);
  const r = routes[url];
  if (r?.throws) return Promise.reject(new TypeError('Failed to fetch'));
  if (!r) return Promise.resolve({ ok: false, status: 404 });
  return Promise.resolve({
    ok: (r.status ?? 200) < 400,
    status: r.status ?? 200,
    json: () => (r.badJson ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(r.json)),
    blob: () => Promise.resolve(r.blob || { size: 5000, type: 'audio/mpeg' }),
  });
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

function clipRoutes(manifest = TE_MANIFEST) {
  const out = { '/audio/tiffin-voices/manifest.te.json': { json: manifest } };
  for (const e of Object.values(manifest.lines)) out[`/audio/tiffin-voices/${e.f}`] = {};
  return out;
}

function make(extra = {}) {
  return createRecordedVoices({
    fetch: fakeFetch,
    createAudio: () => new FakeAudio(reg),
    urlApi,
    now: () => clock.t,
    timers,
    getSettings: () => hub,
    nav: {},
    onStart: (e) => calls.starts.push(e),
    onEnd: (e) => calls.ends.push(e),
    onDrop: (e) => calls.drops.push(e),
    ...extra,
  });
}

/** a loaded, unlocked player */
async function ready(extra = {}) {
  const rec = make(extra);
  await rec.ensure('te');
  rec.unlock();
  await flush();
  return rec;
}

const utt = (lineId, extra = {}) => ({ id: `u-${lineId}`, lineId, text: `text ${lineId}`, lang: 'te', mood: 'neutral', customer: `c-${lineId}`, ttlMs: 5000, ...extra });
const live = () => reg.elements.filter((e) => e.src && !e.paused);
const dropReasons = () => calls.drops.map((d) => `${d.id}:${d.reason}`);

beforeEach(() => {
  reg = { elements: [], playError: null, durations: {}, silent: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' };
  clock = { t: 1000 };
  timers = makeTimers(clock);
  hub = { sfx: true, volume: 0.8, voiceVolume: 1 };
  calls = { starts: [], ends: [], drops: [] };
  fetchLog = [];
  routes = clipRoutes();
  revoked = [];
  seq = 0;
  _resetVoicesMemory();
});

// ---- the manifest --------------------------------------------------------------------------------------

describe('manifest', () => {
  it('is fetched lazily, once, only when asked for', async () => {
    const rec = make();
    expect(fetchLog).toEqual([]);
    expect(rec.has('te-greet-01', 'te')).toBe(false);
    expect(rec.availability('te')).toBeNull(); // not looked for yet
    const [a, b] = await Promise.all([rec.ensure('te'), rec.ensure('te')]);
    expect(a && b).toBe(true);
    expect(fetchLog).toEqual(['/audio/tiffin-voices/manifest.te.json']);
    await rec.ensure('te');
    expect(fetchLog).toHaveLength(1);
    expect(rec.has('te-greet-01', 'te')).toBe(true);
    expect(rec.has('te-greet-01', 'hi')).toBe(false);
    expect(rec.has('nope', 'te')).toBe(false);
    expect(rec.hasLang('te')).toBe(true);
    expect(rec.availability('te')).toBe(true);
  });
  it('is not fetched while voices are off, nor for an unknown language', async () => {
    const rec = make({ enabled: false });
    expect(await rec.ensure('te')).toBe(false);
    expect(await rec.ensure('en')).toBe(false);
    expect(await rec.ensure(undefined)).toBe(false);
    expect(fetchLog).toEqual([]);
    rec.setEnabled(true);
    expect(await rec.ensure('te')).toBe(true);
  });
  it('a 404 (and an offline fetch, corrupt JSON, wrong shape, an HTML page) fail silently and are retried later', async () => {
    for (const bad of [undefined, { throws: true }, { badJson: true }, { json: { v: 1, nothing: 1 } }, { json: { v: 7, lines: {} } }, { json: null }]) {
      routes = bad ? { '/audio/tiffin-voices/manifest.hi.json': bad } : {};
      fetchLog = [];
      const rec = make();
      expect(await rec.ensure('hi')).toBe(false);
      expect(rec.has('hi-greet-01', 'hi')).toBe(false);
      expect(rec.availability('hi')).toBe(false);
      expect(await rec.ensure('hi')).toBe(false); // inside the retry window: no second request
      expect(fetchLog).toHaveLength(1);
      clock.t += RETRY_MS + 1;
      routes['/audio/tiffin-voices/manifest.hi.json'] = { json: { v: 1, lang: 'hi', lines: { 'hi-greet-01': { f: 'hi/hi-greet-01.mp3', ms: 1000 } } } };
      expect(await rec.ensure('hi')).toBe(true);
      expect(rec.has('hi-greet-01', 'hi')).toBe(true);
    }
  });
  it('an empty manifest means the language has no recordings yet', async () => {
    routes['/audio/tiffin-voices/manifest.dk.json'] = { json: { v: 1, lang: 'dk', lines: {} } };
    const rec = make();
    await rec.ensure('dk');
    expect(rec.hasLang('dk')).toBe(false);
    expect(rec.availability('dk')).toBe(false);
  });
  it('skips unsafe or broken entries and fills in missing fields', async () => {
    routes['/audio/tiffin-voices/manifest.te.json'] = {
      json: {
        v: 1,
        lines: {
          ok: { f: 'te/ok.mp3', ms: 'x' }, // bad ms: a default
          nofile: {}, // f derived from the id
          evil1: { f: '../../etc/passwd.mp3' },
          evil2: { f: 'https://example.com/a.mp3' },
          evil3: { f: '//example.com/a.mp3' },
          'bad id!': { f: 'te/x.mp3' },
          nul: null,
          wrongext: { f: 'te/x.wav' },
        },
      },
    };
    const rec = make();
    await rec.ensure('te');
    expect(rec.has('ok', 'te')).toBe(true);
    expect(rec.entry('ok', 'te').ms).toBe(2500);
    expect(rec.has('nofile', 'te')).toBe(true);
    expect(rec.entry('nofile', 'te').f).toBe('te/nofile.mp3');
    expect(rec.has('nul', 'te')).toBe(true);
    for (const id of ['evil1', 'evil2', 'evil3', 'bad id!', 'wrongext']) expect(rec.has(id, 'te')).toBe(false);
  });
  it('only fetches from this origin: an absolute or protocol-relative base URL is ignored', async () => {
    const rec = make({ baseUrl: 'https://cdn.example.com/x/' });
    await rec.ensure('te');
    expect(fetchLog[0]).toBe('/audio/tiffin-voices/manifest.te.json');
    fetchLog = [];
    const rec2 = make({ baseUrl: '//cdn.example.com/x/' });
    await rec2.ensure('te');
    expect(fetchLog[0]).toBe('/audio/tiffin-voices/manifest.te.json');
  });
  it('works without fetch or <audio> (nothing is available, nothing throws)', async () => {
    const noFetch = make({ fetch: null });
    expect(await noFetch.ensure('te')).toBe(false);
    expect(noFetch.availability('te')).toBe(false);
    const noAudio = createRecordedVoices({ createAudio: undefined, fetch: fakeFetch, urlApi });
    // (in node there is no global Audio: the player is unsupported)
    expect(noAudio.isSupported()).toBe(false);
    expect(await noAudio.ensure('te')).toBe(false);
    expect(noAudio.play(utt('te-greet-01'))).toBe(false);
    expect(noAudio.unlock()).toBe(false);
  });
});

// ---- playing ------------------------------------------------------------------------------------------

describe('play', () => {
  it('never plays before unlock(), and a refusal does not queue anything', async () => {
    const rec = make();
    await rec.ensure('te');
    expect(rec.play(utt('te-greet-01'))).toBe(false);
    await flush();
    expect(reg.elements.every((e) => e.playCalls === 0)).toBe(true);
    expect(rec.unlock()).toBe(true);
    expect(rec.play(utt('te-greet-01'))).toBe(true);
  });
  it('returns false for a line without a recording (the caller falls back)', async () => {
    const rec = await ready();
    expect(rec.play(utt('te-unknown-99'))).toBe(false);
    expect(rec.play(utt('te-greet-01', { lang: 'hi' }))).toBe(false);
    expect(rec.play(utt('te-greet-01', { lang: 'en' }))).toBe(false);
    expect(reg.elements.filter((e) => e.playCalls > 0 && e.src !== reg.silent && e.srcs.some((s) => s !== reg.silent))).toHaveLength(0);
  });
  it('finds the clip by lineId, falling back to the utterance id (the HUD passes the director utterance)', async () => {
    const rec = await ready();
    expect(rec.play({ id: 'te-greet-01', text: 'x', lang: 'te', customer: 'a' })).toBe(true);
    await flush();
    rec.cancel();
    expect(rec.play({ id: 'u9-c1-4', lineId: 'te-greet-02', text: 'x', lang: 'te', customer: 'b' })).toBe(true);
    expect(rec.play({ id: 'u9-c1-4', text: 'x', lang: 'te', customer: 'b' })).toBe(false); // neither id is a recorded line
  });
  it('fetches the clip on demand, plays it from a blob and tells the scene to move the mouth for its length', async () => {
    const rec = await ready();
    expect(fetchLog).toEqual(['/audio/tiffin-voices/manifest.te.json']);
    expect(rec.play(utt('te-greet-01', { mood: 'happy' }))).toBe(true);
    expect(calls.starts).toHaveLength(0); // still loading
    await flush();
    expect(fetchLog).toContain('/audio/tiffin-voices/te/te-greet-01.mp3');
    const el = live()[0];
    expect(el.src).toMatch(/^blob:clip-/);
    expect(el.preload).toBe('auto');
    expect(calls.starts).toHaveLength(1);
    const s = calls.starts[0];
    expect(s).toMatchObject({ id: 'u-te-greet-01', customer: 'c-te-greet-01', lang: 'te', mood: 'happy', text: 'text te-greet-01' });
    expect(s.intensity).toBeGreaterThan(0);
    expect(s.estMs).toBeGreaterThan(2500 / 1.06 - 5); // the real duration of the element (2.5 s at the customer's speed)
    expect(rec.isPlaying()).toBe(true);
    clock.t += 2300;
    el.end();
    expect(calls.ends).toHaveLength(1);
    expect(calls.ends[0]).toMatchObject({ id: 'u-te-greet-01', cancelled: false, reason: 'end' });
    expect(calls.ends[0].durationMs).toBeGreaterThan(2000);
    expect(rec.isPlaying()).toBe(false);
    expect(rec.stats().played).toBe(1);
  });
  it('uses the manifest length when the element does not know its duration', async () => {
    const rec = await ready();
    reg.durations = {};
    const orig = FakeAudio.prototype.play;
    FakeAudio.prototype.play = function p() {
      this.playCalls++;
      this.paused = false;
      return Promise.resolve(); // duration stays NaN
    };
    try {
      rec.play(utt('te-greet-02'));
      await flush();
    } finally {
      FakeAudio.prototype.play = orig;
    }
    expect(calls.starts[0].estMs).toBe(Math.round(1800 / voiceRate('c-te-greet-02')));
  });
  it('plays a clip a second time from the cache (one download)', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'a' }));
    await flush();
    live()[0].end();
    rec.play(utt('te-greet-01', { customer: 'a', id: 'again' }));
    await flush();
    expect(fetchLog.filter((u) => u.endsWith('te-greet-01.mp3'))).toHaveLength(1);
    expect(calls.starts).toHaveLength(2);
  });
  it('speeds each customer 0.94..1.06, always the same, with the pitch kept', async () => {
    expect(voiceRate('x')).toBe(voiceRate('x'));
    const rates = new Set();
    for (let i = 0; i < 40; i++) {
      const r = voiceRate(`c${i}`);
      expect(r).toBeGreaterThanOrEqual(RATE_RANGE[0]);
      expect(r).toBeLessThanOrEqual(RATE_RANGE[1]);
      rates.add(r.toFixed(3));
    }
    expect(rates.size).toBeGreaterThan(20);
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'alice' }));
    await flush();
    const el = live()[0];
    expect(el.playbackRate).toBeCloseTo(voiceRate('alice'), 10);
    expect(el.preservesPitch).toBe(true);
  });
  it('without an AudioContext the element volume is hub x voice x local x mood; angry is louder, a whisper quieter', async () => {
    hub = { sfx: true, volume: 0.8, voiceVolume: 0.5 };
    const rec = await ready();
    rec.setVolume(0.5);
    rec.play(utt('te-greet-02', { mood: 'neutral', customer: 'n' }));
    rec.play(utt('te-waiting-angry-01', { mood: 'angry', customer: 'a' }));
    await flush();
    const [n, a] = live();
    expect(n.volume).toBeCloseTo(0.8 * 0.5 * 0.5 * speechParams('n', 'neutral').volume, 10);
    expect(a.volume).toBeCloseTo(0.8 * 0.5 * 0.5 * speechParams('a', 'angry').volume, 10);
    expect(a.volume).toBeGreaterThan(n.volume);
    const normal = n.volume;
    a.end();
    n.end();
    rec.play(utt('te-waiting-polite-01', { mood: 'neutral', customer: 'n' })); // tag [whispers]
    await flush();
    expect(live()[0].volume).toBeCloseTo(normal * WHISPER_GAIN, 10);
    expect(isWhisper('[whispers]')).toBe(true);
    expect(isWhisper('[angry]', '')).toBe(false);
  });
  it('mood falls back to the manifest entry when the utterance has none', async () => {
    const rec = await ready();
    rec.play({ id: 'x', lineId: 'te-waiting-angry-01', text: 't', lang: 'te', customer: 'q' });
    await flush();
    expect(calls.starts[0].mood).toBe('angry');
  });
  it('does not play when the hub sound is off or the volume is zero', async () => {
    const rec = await ready();
    hub.sfx = false;
    expect(rec.play(utt('te-greet-01'))).toBe(false);
    hub = { sfx: true, volume: 0, voiceVolume: 1 };
    expect(rec.play(utt('te-greet-01'))).toBe(false);
  });
  it('a clip that never reports "ended" frees its slot by itself', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    expect(rec.isPlaying()).toBe(true);
    timers.advance(60000);
    expect(rec.isPlaying()).toBe(false);
    expect(calls.ends[0].reason).toBe('timeout');
  });
});

// ---- the audio graph --------------------------------------------------------------------------------------

describe('routing through the shared graph', () => {
  it('goes MediaElementSource -> gain -> StereoPanner -> dest, and only the voice fader x mood sets the gain (the master carries hub volume)', async () => {
    const ctx = new CtxWithElements();
    const dest = ctx.createGain();
    hub = { sfx: true, volume: 0.4, voiceVolume: 0.5 };
    const rec = await ready({ getContext: () => ctx, getDest: () => dest });
    rec.play(utt('te-greet-01', { customer: 'alice' }));
    await flush();
    const src = ctx.nodes.find((n) => n.kind === 'mediasrc');
    expect(src).toBeTruthy();
    const gain = [...src.outs][0];
    expect(gain.kind).toBe('gain');
    const pan = [...gain.outs][0];
    expect(pan.kind).toBe('panner');
    expect([...pan.outs][0]).toBe(dest);
    expect(gain.gain.value).toBeCloseTo(0.5 * speechParams('alice', 'neutral').volume, 10);
    expect(pan.pan.value).toBeCloseTo(voicePan('alice'), 10);
    expect(Math.abs(pan.pan.value)).toBeLessThanOrEqual(0.7);
    expect(live()[0].volume).toBe(1); // the element itself is left alone
    live()[0].end();
    rec.play(utt('te-greet-02', { customer: 'alice', pan: -1 }));
    await flush();
    expect(pan.pan.value).toBe(-1); // an explicit pan wins; the same element (and its source node) is reused
    expect(ctx.nodes.filter((n) => n.kind === 'mediasrc')).toHaveLength(POOL_SIZE);
  });
  it('different customers sit at different places', () => {
    const pans = new Set(Array.from({ length: 20 }, (_, i) => voicePan(`c${i}`).toFixed(2)));
    expect(pans.size).toBeGreaterThan(10);
  });
  it('a context that cannot do MediaElementSource falls back to the element volume without throwing', async () => {
    const ctx = new FakeAudioContext(); // no createMediaElementSource
    const rec = await ready({ getContext: () => ctx, getDest: () => ctx.createGain() });
    rec.play(utt('te-greet-01'));
    await flush();
    expect(live()[0].volume).toBeGreaterThan(0);
    expect(live()[0].volume).toBeLessThan(1);
  });
  it('updateVolume follows the hub faders and cuts the clips when sound goes off', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'n' }));
    await flush();
    const v0 = live()[0].volume;
    hub.volume = 0.4;
    rec.updateVolume();
    expect(live()[0].volume).toBeCloseTo(v0 / 2, 10);
    hub.sfx = false;
    rec.updateVolume();
    expect(rec.isPlaying()).toBe(false);
    expect(calls.ends[0].cancelled).toBe(true);
  });
});

// ---- queue, ttl, cancel, concurrency --------------------------------------------------------------------

describe('queue discipline', () => {
  it('plays at most 3 clips at once (pool of 3 reused elements) and the rest wait', async () => {
    const rec = await ready();
    for (const id of ['te-greet-01', 'te-greet-02', 'te-greet-03']) rec.play(utt(id, { customer: null })); // anonymous: the speaker cap does not apply
    rec.play(utt('te-greet-04', { customer: null }));
    await flush();
    expect(live()).toHaveLength(3);
    expect(reg.elements).toHaveLength(POOL_SIZE);
    expect(rec.stats().queued).toEqual(['u-te-greet-04']);
    live()[0].end();
    await flush();
    expect(live()).toHaveLength(3);
    expect(reg.elements).toHaveLength(POOL_SIZE); // reused
    expect(rec.stats().queued).toEqual([]);
  });
  it('at most 2 different customers in the pipeline: a third is refused unless it outranks a waiting one', async () => {
    const rec = await ready();
    expect(rec.play(utt('te-greet-01', { customer: 'a' }))).toBe(true);
    expect(rec.play(utt('te-greet-02', { customer: 'b' }))).toBe(true);
    expect(rec.play(utt('te-greet-03', { customer: 'c' }))).toBe(false);
    await flush();
    expect(live()).toHaveLength(2);
  });
  it('an angry customer pushes out a waiting calmer one', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'a' }));
    await flush(); // a is playing: b and c would be waiting, but the speaker cap counts playing ones
    rec.play(utt('te-greet-02', { customer: 'b', mood: 'neutral' }));
    // b plays too (a pool slot is free); a third customer waits for nobody: refused
    expect(rec.play(utt('te-greet-03', { customer: 'c', mood: 'neutral' }))).toBe(false);
    expect(rec.play(utt('te-waiting-angry-01', { customer: 'd', mood: 'angry' }))).toBe(false); // nobody is waiting to be replaced
  });
  it('a customer\'s newer line replaces their waiting older one; the waiting line is capped at 3', async () => {
    const rec = await ready();
    for (const id of ['te-greet-01', 'te-greet-02', 'te-greet-03']) rec.play(utt(id, { customer: null }));
    await flush(); // the pool is full
    rec.play(utt('te-greet-04', { customer: 'w', id: 'first' }));
    rec.play(utt('te-pay-01', { customer: 'w', id: 'second' }));
    expect(dropReasons()).toContain('first:replaced');
    expect(rec.stats().queued).toEqual(['second']);
    rec.play(utt('te-greet-04', { customer: null, id: 'q2' }));
    rec.play(utt('te-greet-04', { customer: null, id: 'q3' }));
    expect(rec.stats().queued).toHaveLength(3);
    // a fourth anonymous line of the same priority is the weakest: refused
    expect(rec.play(utt('te-greet-04', { customer: null, id: 'q4' }))).toBe(false);
    // an angry one pushes the oldest calm one out
    expect(rec.play(utt('te-waiting-angry-01', { customer: null, id: 'ang', mood: 'angry' }))).toBe(true);
    expect(dropReasons()).toContain('second:overflow');
    live()[0].end();
    await flush();
    expect(calls.starts.at(-1).id).toBe('ang'); // the angry one is heard first
  });
  it('drops a line that waited longer than its ttl instead of playing it late', async () => {
    const rec = await ready();
    for (const id of ['te-greet-01', 'te-greet-02', 'te-greet-03']) rec.play(utt(id, { customer: null }));
    await flush();
    rec.play(utt('te-greet-04', { customer: null, id: 'late', ttlMs: 1500 }));
    clock.t += 2000;
    live()[0].end();
    await flush();
    expect(dropReasons()).toContain('late:stale');
    expect(calls.starts.map((s) => s.id)).not.toContain('late');
  });
  it('drops a line whose download took longer than its ttl', async () => {
    const rec = await ready();
    let release;
    const slow = new Promise((r) => (release = r));
    const orig = fakeFetch;
    const rec2 = make({
      fetch: (u) => (u.endsWith('te-greet-03.mp3') ? slow.then(() => orig(u)) : orig(u)),
    });
    await rec2.ensure('te');
    rec2.unlock();
    rec2.play(utt('te-greet-03', { ttlMs: 1500, id: 'slowline' }));
    clock.t += 2000;
    release();
    await flush();
    expect(dropReasons()).toContain('slowline:stale');
    expect(calls.starts).toHaveLength(0);
    void rec;
  });
  it('cancel(customer) cuts that customer\'s clip and waiting line; cancel() cuts everyone', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'a' }));
    rec.play(utt('te-greet-02', { customer: 'b' }));
    await flush();
    rec.cancel('a');
    expect(calls.ends).toHaveLength(1);
    expect(calls.ends[0]).toMatchObject({ id: 'u-te-greet-01', cancelled: true, reason: 'cancel' });
    expect(live()).toHaveLength(1);
    rec.cancel();
    expect(live()).toHaveLength(0);
    expect(calls.ends).toHaveLength(2);
    rec.cancel('nobody'); // no throw
  });
  it('cancelling a clip that is still downloading means it never starts', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'a' }));
    rec.cancel('a');
    await flush();
    expect(calls.starts).toHaveLength(0);
    expect(dropReasons()).toContain('u-te-greet-01:cancel');
    expect(live()).toHaveLength(0);
  });
  it('one voice per customer at a time: their next line waits for the first to end', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01', { customer: 'a', id: 'one' }));
    await flush();
    rec.play(utt('te-greet-02', { customer: 'a', id: 'two' }));
    await flush();
    expect(live()).toHaveLength(1);
    live()[0].end();
    await flush();
    expect(calls.starts.map((s) => s.id)).toEqual(['one', 'two']);
  });
});

// ---- pause ------------------------------------------------------------------------------------------------

describe('pause and resume', () => {
  it('the game pausing (or the tab hiding) pauses the clip and resumes it after', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    const el = live()[0];
    rec.setPaused(true);
    expect(el.paused).toBe(true);
    expect(calls.ends).toHaveLength(0); // not ended, only held
    expect(rec.play(utt('te-greet-02'))).toBe(false); // nothing new while paused
    clock.t += 1000;
    rec.setPaused(false);
    await flush();
    expect(el.paused).toBe(false);
    expect(calls.ends).toHaveLength(0);
    el.end();
    expect(calls.ends[0].cancelled).toBe(false);
  });
  it('a pause that lasted too long cuts the clip instead (the moment has passed)', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    rec.setPaused(true);
    clock.t += PAUSE_MAX_MS + 1;
    rec.setPaused(false);
    expect(rec.isPlaying()).toBe(false);
    expect(calls.ends[0].cancelled).toBe(true);
  });
  it('a clip that finished downloading during the pause is dropped, not played', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    rec.setPaused(true);
    await flush();
    expect(calls.starts).toHaveLength(0);
    expect(dropReasons()).toContain('u-te-greet-01:paused');
  });
  it('switching voices off cuts everything; switching on again allows new clips', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    rec.setEnabled(false);
    expect(rec.isPlaying()).toBe(false);
    expect(rec.play(utt('te-greet-02'))).toBe(false);
    rec.setEnabled(true);
    expect(rec.play(utt('te-greet-02'))).toBe(true);
  });
});

// ---- iOS and errors ----------------------------------------------------------------------------------------

describe('iOS rejections and errors', () => {
  it('unlock() plays an empty clip on every pooled element from the gesture', async () => {
    const rec = make();
    rec.unlock();
    await flush();
    expect(reg.elements).toHaveLength(POOL_SIZE);
    for (const el of reg.elements) {
      expect(el.srcs).toEqual([reg.silent]);
      expect(el.paused).toBe(true); // paused again right after
    }
  });
  it('play() rejected with NotAllowedError: no throw, onFail runs, nothing plays until the next unlock()', async () => {
    const rec = await ready();
    const onFail = vi.fn();
    reg.playError = 'NotAllowedError';
    expect(rec.play(utt('te-greet-01'), { onFail })).toBe(true);
    await flush();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(calls.starts).toHaveLength(0);
    expect(rec.stats().errors).toBe(1);
    expect(dropReasons()).toContain('u-te-greet-01:blocked');
    expect(rec.isUnlocked()).toBe(false);
    expect(rec.play(utt('te-greet-02'))).toBe(false);
    reg.playError = null;
    rec.unlock();
    await flush();
    expect(rec.play(utt('te-greet-02'))).toBe(true);
    await flush();
    expect(calls.starts).toHaveLength(1);
  });
  it('an element that throws in play() is an error, not an exception', async () => {
    const rec = await ready();
    const onFail = vi.fn();
    const orig = FakeAudio.prototype.play;
    FakeAudio.prototype.play = () => {
      throw new Error('boom');
    };
    try {
      rec.play(utt('te-greet-01'), { onFail });
      await flush();
    } finally {
      FakeAudio.prototype.play = orig;
    }
    expect(onFail).toHaveBeenCalled();
    expect(rec.isPlaying()).toBe(false);
  });
  it('an <audio> error event ends the clip as cancelled and frees the slot', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    live()[0].fail();
    expect(calls.ends[0]).toMatchObject({ cancelled: true, reason: 'error' });
    expect(rec.stats().errors).toBe(1);
    expect(rec.isPlaying()).toBe(false);
  });
  it('a clip that 404s, is HTML, or throws offline calls onFail and drops the line', async () => {
    for (const bad of [undefined, { throws: true }, { blob: { size: 300, type: 'text/html' } }, { blob: { size: 0, type: 'audio/mpeg' } }, { status: 500 }]) {
      if (bad) routes['/audio/tiffin-voices/te/te-greet-01.mp3'] = bad;
      else delete routes['/audio/tiffin-voices/te/te-greet-01.mp3'];
      const rec = await ready();
      const onFail = vi.fn();
      expect(rec.play(utt('te-greet-01', { id: `x${seq}` }), { onFail })).toBe(true);
      await flush();
      expect(onFail).toHaveBeenCalledTimes(1);
      expect(calls.starts).toHaveLength(0);
      expect(rec.isPlaying()).toBe(false);
      rec.dispose();
    }
  });
  it('never throws on missing or odd fields', async () => {
    const rec = await ready();
    expect(() => {
      expect(rec.play(null)).toBe(false);
      expect(rec.play(undefined)).toBe(false);
      expect(rec.play({})).toBe(false);
      expect(rec.play({ lang: 'te' })).toBe(false);
      expect(rec.play({ id: 5, lang: 'te' })).toBe(false);
      expect(rec.play('te-greet-01')).toBe(false);
      expect(rec.has(null, 'te')).toBe(false);
      expect(rec.has('te-greet-01', null)).toBe(false);
      rec.cancel(undefined);
      rec.cancel(null);
      rec.setVolume('loud'); // not a number: treated as silent
      rec.setVolume(1);
      rec.setPaused(undefined);
      rec.updateVolume();
    }).not.toThrow();
    // a minimal utterance: just the line id and the language
    expect(rec.play({ id: 'te-greet-01', lang: 'te' })).toBe(true);
    await flush();
    expect(calls.starts[0]).toMatchObject({ id: 'te-greet-01', customer: null, text: '' });
  });
  it('callbacks that throw do not break playback', async () => {
    const rec = await ready({
      onStart: () => {
        throw new Error('x');
      },
      onEnd: () => {
        throw new Error('y');
      },
    });
    rec.play(utt('te-greet-01'));
    await flush();
    expect(() => live()[0].end()).not.toThrow();
    expect(rec.isPlaying()).toBe(false);
  });
  it('dispose cuts everything, revokes the blobs and refuses new lines', async () => {
    const rec = await ready();
    rec.play(utt('te-greet-01'));
    await flush();
    rec.dispose();
    expect(rec.isPlaying()).toBe(false);
    expect(revoked.length).toBeGreaterThan(0);
    expect(rec.play(utt('te-greet-02'))).toBe(false);
    expect(await rec.ensure('te')).toBe(false);
    rec.dispose();
  });
});

// ---- cache and warm-up --------------------------------------------------------------------------------------

describe('LRU of clips', () => {
  it('keeps at most CACHE_MAX clips and revokes the oldest, never one that is playing', async () => {
    const lines = {};
    for (let i = 0; i < 40; i++) lines[`te-x-${i}`] = { f: `te/te-x-${i}.mp3`, ms: 1000, sit: 'greet' };
    routes = clipRoutes({ v: 1, lang: 'te', lines });
    const rec = await ready();
    rec.play(utt('te-x-0', { customer: 'a' }));
    await flush(); // te-x-0 is playing: it is referenced
    for (let i = 1; i < 40; i++) {
      rec.play(utt(`te-x-${i}`, { customer: null, id: `l${i}` }));
      await flush();
      for (const el of live()) if (el.src !== reg.elements[0].src) el.end();
    }
    expect(rec.stats().cached).toBeLessThanOrEqual(CACHE_MAX);
    expect(revoked.length).toBeGreaterThanOrEqual(40 - CACHE_MAX - 1);
    const playingSrc = reg.elements.find((e) => e.src && !e.paused && e.srcs.length && e.src === reg.elements[0].src)?.src;
    if (playingSrc) expect(revoked).not.toContain(playingSrc);
  });
});

describe('warm', () => {
  it('fetches the greetings and waiting clips of a language, at most WARM_MAX, then plays them with no new download', async () => {
    const lines = {};
    for (let i = 0; i < 20; i++) lines[`te-greet-${i}`] = { f: `te/te-greet-${i}.mp3`, ms: 1000, sit: 'greet' };
    lines['te-pay-1'] = { f: 'te/te-pay-1.mp3', ms: 1000, sit: 'pay' };
    routes = clipRoutes({ v: 1, lang: 'te', lines });
    const rec = make();
    const n = await rec.warm('te');
    expect(n).toBe(WARM_MAX);
    const clips = fetchLog.filter((u) => u.endsWith('.mp3'));
    expect(clips).toHaveLength(WARM_MAX);
    expect(clips.some((u) => u.includes('te-pay-1'))).toBe(false); // only greeting / waiting situations
    rec.unlock();
    rec.play(utt('te-greet-0'));
    await flush();
    expect(fetchLog.filter((u) => u.endsWith('.mp3'))).toHaveLength(WARM_MAX);
    expect(calls.starts).toHaveLength(1);
  });
  it('warms exactly the ids it is given (and ignores unknown ones)', async () => {
    const rec = make();
    expect(await rec.warm('te', ['te-pay-01', 'te-nope-1'])).toBe(1);
    expect(fetchLog.filter((u) => u.endsWith('.mp3'))).toEqual(['/audio/tiffin-voices/te/te-pay-01.mp3']);
  });
  it('without a language it loads every language manifest and a share of clips from each', async () => {
    const rec = make();
    await rec.warm();
    expect(fetchLog.filter((u) => u.includes('manifest.'))).toHaveLength(3);
    expect(fetchLog.filter((u) => u.endsWith('.mp3')).length).toBeLessThanOrEqual(WARM_MAX);
  });
  it('does nothing on a metered connection (data saver, 2g, 3g) or with voices off', async () => {
    for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }, { effectiveType: '3g' }]) {
      fetchLog = [];
      const rec = make({ nav: { connection } });
      expect(await rec.warm('te')).toBe(0);
      expect(fetchLog).toEqual([]);
    }
    expect(isMeteredConnection({ connection: { effectiveType: '4g', saveData: false } })).toBe(false);
    expect(isMeteredConnection({})).toBe(false);
    expect(isMeteredConnection(null)).toBe(false);
    const off = make({ enabled: false });
    expect(await off.warm('te')).toBe(0);
  });
  it('a clip that fails to download during warm-up is skipped silently', async () => {
    delete routes['/audio/tiffin-voices/te/te-greet-01.mp3'];
    const rec = make();
    expect(await rec.warm('te', ['te-greet-01', 'te-greet-02'])).toBe(1);
  });
});

// ---- the speech object: fallback order, settings -------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}
function makeSynth(voices) {
  const s = {
    spoken: [],
    speaking: false,
    pending: false,
    cur: null,
    getVoices: () => voices,
    speak(u) {
      s.spoken.push(u);
      s.cur = u;
      s.speaking = true;
    },
    cancel() {
      s.speaking = false;
      s.cur = null;
    },
    addEventListener() {},
    removeEventListener() {},
    start: () => s.cur?.onstart?.(),
    end() {
      const u = s.cur;
      s.speaking = false;
      s.cur = null;
      u?.onend?.();
    },
  };
  return s;
}
const TE_VOICE = { name: 'Telugu', lang: 'te-IN', localService: true };

describe('speech.js: recorded first, synthetic second (if enabled), nothing last', () => {
  let synth;
  let doc;
  let docHandlers;
  function makeSpeech(extra = {}) {
    const sp = createTiffinSpeech({
      synth,
      SpeechUtterance: FakeUtterance,
      recorded: { fetch: fakeFetch, createAudio: () => new FakeAudio(reg), urlApi, nav: {} },
      getSettings: () => hub,
      now: () => clock.t,
      timers,
      doc,
      isActivated: () => true,
      android: false,
      enabled: true,
      synthEnabled: false,
      onStart: (e) => calls.starts.push(e),
      onEnd: (e) => calls.ends.push(e),
      onDrop: (e) => calls.drops.push(e),
      ...extra,
    });
    return sp;
  }
  const spoken = () => synth.spoken.filter((u) => u.text !== ' ');
  beforeEach(() => {
    synth = makeSynth([TE_VOICE]);
    docHandlers = {};
    doc = { visibilityState: 'visible', addEventListener: (e, f) => (docHandlers[e] = f), removeEventListener: (e) => delete docHandlers[e] };
  });

  it('uses the recording when the line has one (even with synthetic voices on) and never the synthetic voice for it', async () => {
    const sp = makeSpeech({ synthEnabled: true });
    expect(sp.speak(utt('te-greet-01'))).toBe(true); // the first line of a language: the manifest is not there yet -> the synthetic voice
    // ... counted as a synthetic line; once the manifest has loaded the recording is used
    await flush();
    sp.unlock();
    await flush();
    synth.end();
    expect(sp.speak(utt('te-greet-02'))).toBe(true);
    await flush();
    expect(calls.starts.map((s) => s.id)).toEqual(['u-te-greet-02']);
    expect(spoken().map((u) => u.text)).toEqual(['text te-greet-01']);
    const st = sp.getVoiceStats();
    expect(st).toMatchObject({ played: 1, synth: 1, missing: 0, errors: 0 });
  });
  it('a line without a recording: synthetic voice when it is on', async () => {
    const sp = makeSpeech({ synthEnabled: true });
    await sp.recorded().ensure('te');
    sp.unlock();
    expect(sp.speak(utt('te-unrecorded-1', { text: 'dish {n}' }))).toBe(true);
    expect(spoken()).toHaveLength(1);
    expect(sp.getVoiceStats().synth).toBe(1);
  });
  it('a line without a recording and synthetic voices off (the default): nothing, subtitles only, counted as missing', async () => {
    const sp = makeSpeech();
    await sp.recorded().ensure('te');
    sp.unlock();
    expect(sp.isSynthEnabled()).toBe(false);
    expect(sp.speak(utt('te-unrecorded-1'))).toBe(false);
    expect(spoken()).toHaveLength(0);
    expect(sp.getVoiceStats().missing).toBe(1);
  });
  it('plays a recording with synthetic voices off, and the Voices switch off silences both', async () => {
    const sp = makeSpeech({ synthEnabled: true });
    await sp.recorded().ensure('te');
    sp.unlock();
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
    await flush();
    expect(calls.starts).toHaveLength(1);
    sp.setEnabled(false);
    expect(sp.isSpeaking()).toBe(false);
    expect(sp.speak(utt('te-greet-02'))).toBe(false);
    expect(sp.speak(utt('te-unrecorded-1'))).toBe(false);
    sp.setEnabled(true);
    expect(sp.speak(utt('te-greet-02'))).toBe(true);
  });
  it('a recording that fails to download falls back to the synthetic voice (when on) while the line is fresh', async () => {
    delete routes['/audio/tiffin-voices/te/te-greet-01.mp3'];
    const sp = makeSpeech({ synthEnabled: true });
    await sp.recorded().ensure('te');
    sp.unlock();
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
    await flush();
    expect(calls.starts).toHaveLength(0);
    expect(spoken().map((u) => u.text)).toEqual(['text te-greet-01']);
    expect(sp.getVoiceStats()).toMatchObject({ played: 0, synth: 1, errors: 1 });
  });
  it('...and with synthetic voices off the failed recording is just subtitles', async () => {
    delete routes['/audio/tiffin-voices/te/te-greet-01.mp3'];
    const sp = makeSpeech();
    await sp.recorded().ensure('te');
    sp.unlock();
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
    await flush();
    expect(spoken()).toHaveLength(0);
    expect(sp.getVoiceStats()).toMatchObject({ synth: 0, missing: 1, errors: 1 });
  });
  it('iOS refusing play() falls back to the synthetic voice too', async () => {
    const sp = makeSpeech({ synthEnabled: true });
    await sp.recorded().ensure('te');
    sp.unlock();
    await flush();
    reg.playError = 'NotAllowedError';
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
    await flush();
    expect(spoken().map((u) => u.text)).toEqual(['text te-greet-01']);
  });
  it('before unlock() a recording is not played; the synthetic fallback needs the gesture too', async () => {
    const sp = makeSpeech({ synthEnabled: true, isActivated: () => false });
    await sp.recorded().ensure('te');
    expect(sp.speak(utt('te-greet-01'))).toBe(false);
    expect(spoken()).toHaveLength(0);
    sp.unlock();
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
  });
  it('isAvailable: recordings OR (synthetic on AND a system voice); null while the manifest is being looked for', async () => {
    const sp = makeSpeech();
    expect(sp.isAvailable('te')).toBeNull(); // starts the lookup
    await flush();
    expect(sp.isAvailable('te')).toBe(true); // te has recordings
    expect(sp.isAvailable('hi')).toBeNull();
    await flush();
    expect(sp.isAvailable('hi')).toBe(false); // 404 and synthetic off
    expect(sp.isAvailable('en')).toBe(false);
    sp.setSynthEnabled(true);
    expect(sp.isAvailable('hi')).toBe(false); // synthetic on but no hi system voice
    synth.getVoices = () => [TE_VOICE, { name: 'Hindi', lang: 'hi-IN', localService: true }];
    const sp2 = makeSpeech({ synthEnabled: true });
    await flush();
    expect(sp2.isAvailable('hi')).toBe(true);
    expect(sp2.isAvailable('dk')).toBe(true); // Dakhni is spoken with the Hindi system voice
  });
  it('pausing the game / hiding the tab pauses the clip and resumes it', async () => {
    const sp = makeSpeech();
    await sp.recorded().ensure('te');
    sp.unlock();
    sp.speak(utt('te-greet-01'));
    await flush();
    const el = live()[0];
    sp.setPaused(true);
    expect(el.paused).toBe(true);
    sp.setPaused(false);
    await flush();
    expect(el.paused).toBe(false);
    doc.visibilityState = 'hidden';
    docHandlers.visibilitychange();
    expect(el.paused).toBe(true);
    doc.visibilityState = 'visible';
    docHandlers.visibilitychange();
    await flush();
    expect(el.paused).toBe(false);
    expect(calls.ends).toHaveLength(0);
    expect(sp.isSpeaking()).toBe(true);
  });
  it('cancel(customer) and dispose reach the recorded player', async () => {
    const sp = makeSpeech();
    await sp.recorded().ensure('te');
    sp.unlock();
    sp.speak(utt('te-greet-01', { customer: 'a' }));
    await flush();
    sp.cancel('a');
    expect(sp.isSpeaking()).toBe(false);
    sp.speak(utt('te-greet-01', { customer: 'a' }));
    await flush();
    sp.dispose();
    expect(sp.isSpeaking()).toBe(false);
  });
  it('speech.warm preloads through the recorded player and is a no-op when Voices is off', async () => {
    const sp = makeSpeech();
    expect(await sp.warm('te', ['te-greet-01'])).toBe(1);
    sp.setEnabled(false);
    expect(await sp.warm('te', ['te-greet-02'])).toBe(0);
  });
  it('without any <audio> support everything falls back exactly as before', () => {
    const sp = createTiffinSpeech({ synth, SpeechUtterance: FakeUtterance, recorded: false, getSettings: () => hub, now: () => clock.t, timers, doc: null, isActivated: () => true, enabled: true, synthEnabled: true });
    expect(sp.recorded()).toBeNull();
    expect(sp.speak(utt('te-greet-01'))).toBe(true);
    expect(spoken()).toHaveLength(1);
    expect(sp.getVoiceStats()).toMatchObject({ played: 0, synth: 1 });
  });
});

// ---- createTiffinAudio ------------------------------------------------------------------------------------------

describe('createTiffinAudio', () => {
  function audioWith(extra = {}) {
    const ctx = new CtxWithElements();
    const synth = makeSynth([TE_VOICE]);
    const a = createTiffinAudio({
      getAudioContext: () => ctx,
      settings: () => hub,
      now: () => clock.t,
      timers,
      doc: null,
      speech: {
        synth,
        SpeechUtterance: FakeUtterance,
        now: () => clock.t,
        timers,
        doc: null,
        isActivated: () => true,
        android: false,
        enabled: true,
        synthEnabled: false,
        recorded: { fetch: fakeFetch, createAudio: () => new FakeAudio(reg), urlApi, nav: {} },
        onStart: (e) => calls.starts.push(e),
        onEnd: (e) => calls.ends.push(e),
        ...extra,
      },
    });
    return { a, ctx, synth };
  }
  it('plays recorded lines through the master chain, after unlock()', async () => {
    const { a, ctx } = audioWith();
    await a.getSpeech().recorded().ensure('te');
    expect(a.speak(utt('te-greet-01'))).toBe(false); // nothing before the gesture
    a.unlock();
    await flush();
    expect(a.speak(utt('te-greet-01'))).toBe(true);
    await flush();
    expect(calls.starts).toHaveLength(1);
    // media source -> gain -> panner -> voiceBus -> master
    const src = ctx.nodes.find((n) => n.kind === 'mediasrc');
    const gain = [...src.outs][0];
    const pan = [...gain.outs][0];
    const voiceBus = [...pan.outs][0];
    const master = [...voiceBus.outs][0];
    expect([...master.outs].some((n) => n.kind === 'compressor')).toBe(true);
    expect(a.getVoiceStats().played).toBe(1);
    a.dispose();
  });
  it('setSynthEnabled switches the robotic voices; setSpeechEnabled(false) silences everything; getVoiceStats is always there', async () => {
    const { a, synth } = audioWith();
    await a.getSpeech().recorded().ensure('te');
    a.unlock();
    await flush();
    expect(a.speak(utt('te-unrecorded', { text: 'x' }))).toBe(false);
    a.setSynthEnabled(true);
    expect(a.speak(utt('te-unrecorded', { text: 'x' }))).toBe(true);
    expect(synth.spoken.filter((u) => u.text === 'x')).toHaveLength(1);
    expect(a.getVoiceStats()).toMatchObject({ synth: 1, missing: 1 });
    a.setSpeechEnabled(false);
    expect(a.speak(utt('te-greet-01'))).toBe(false);
    a.setSynthEnabled(false);
    a.dispose();
  });
  it('warmVoices is a safe no-op on a ready speech object that has no warm()', async () => {
    const fake = { speak: vi.fn(() => true), setEnabled: vi.fn(), setVolume: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), isAvailable: () => true };
    const a = createTiffinAudio({ getAudioContext: () => new CtxWithElements(), settings: () => hub, speech: fake, doc: null });
    expect(await a.warmVoices('te')).toBe(0);
    expect(a.getVoiceStats()).toMatchObject({ played: 0 });
    a.setSynthEnabled(true);
    a.dispose();
  });
  it('the start of a shift (startAmbience) warms the voices once', async () => {
    const { a } = audioWith();
    a.unlock();
    a.startAmbience();
    await flush();
    await flush();
    expect(fetchLog.filter((u) => u.includes('manifest.'))).toHaveLength(3);
    const n = fetchLog.length;
    a.startAmbience();
    await flush();
    expect(fetchLog.length).toBe(n);
    a.dispose();
  });
});
