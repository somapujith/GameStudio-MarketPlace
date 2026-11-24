import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/lib/soundscape/fakeAudio.js';
import {
  createTiffinSpeech,
  getVoicesEnabled,
  setVoicesEnabled,
  subscribeVoices,
  VOICES_KEY,
  MAX_QUEUE,
  KEEPALIVE_MS,
  START_WATCHDOG_MS,
  DEFAULT_TTL_MS,
  _resetVoicesMemory,
} from './speech.js';
import { createTiffinAudio } from './index.js';
import { speechParams } from './speechVoices.js';

// ---- fakes -------------------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.voice = null;
    this.lang = '';
    this.pitch = 1;
    this.rate = 1;
    this.volume = 1;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

function makeSynth(voices = []) {
  const listeners = {};
  const s = {
    voices,
    spoken: [],
    cancelCalls: 0,
    resumeCalls: 0,
    speaking: false,
    pending: false,
    cur: null,
    getVoices: () => s.voices,
    speak(u) {
      s.spoken.push(u);
      s.cur = u;
      s.speaking = true;
    },
    cancel() {
      s.cancelCalls++;
      s.speaking = false;
      s.cur = null;
    },
    resume() {
      s.resumeCalls++;
    },
    addEventListener: (e, f) => (listeners[e] = f),
    removeEventListener: (e) => delete listeners[e],
    fire: (e) => listeners[e]?.(),
    listeners,
    /** the engine starts / finishes the line it was given last */
    start: () => s.cur?.onstart?.(),
    end() {
      const u = s.cur;
      s.speaking = false;
      s.cur = null;
      u?.onend?.();
    },
    fail(error = 'synthesis-failed') {
      const u = s.cur;
      s.speaking = false;
      s.cur = null;
      u?.onerror?.({ error });
    },
  };
  return s;
}

function makeTimers(clock) {
  let id = 0;
  const tasks = new Map();
  return {
    setTimeout: (fn, ms) => (tasks.set(++id, { fn, at: clock.t + ms, every: 0 }), id),
    clearTimeout: (i) => tasks.delete(i),
    setInterval: (fn, ms) => (tasks.set(++id, { fn, at: clock.t + ms, every: ms }), id),
    clearInterval: (i) => tasks.delete(i),
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        let next = null;
        for (const [i, t] of tasks) if (t.at <= end && (!next || t.at < next.t.at)) next = { i, t };
        if (!next) break;
        clock.t = Math.max(clock.t, next.t.at);
        if (next.t.every) next.t.at += next.t.every;
        else tasks.delete(next.i);
        next.t.fn();
      }
      clock.t = end;
    },
    count: () => tasks.size,
  };
}

const TE = { name: 'Telugu', lang: 'te-IN', localService: true, default: false };
const HI = { name: 'Hindi', lang: 'hi-IN', localService: true, default: false };
const EN = { name: 'English', lang: 'en-IN', localService: true, default: true };

let synth;
let clock;
let timers;
let hub;
let calls;
let docHandlers;
let doc;

function make(extra = {}) {
  return createTiffinSpeech({
    synth,
    SpeechUtterance: FakeUtterance,
    getSettings: () => hub,
    now: () => clock.t,
    timers,
    doc,
    isActivated: () => true,
    android: false,
    enabled: true,
    onStart: (e) => calls.starts.push(e),
    onEnd: (e) => calls.ends.push(e),
    onDrop: (e) => calls.drops.push(e),
    ...extra,
  });
}
const line = (id, extra = {}) => ({ id, text: `text ${id}`, lang: 'te', mood: 'neutral', customer: `c${id}`, ...extra });
const spoken = () => synth.spoken.filter((u) => u.text !== ' ');
const dropped = () => calls.drops.map((d) => `${d.id}:${d.reason}`);

beforeEach(() => {
  synth = makeSynth([TE, HI, EN]);
  clock = { t: 1000 };
  timers = makeTimers(clock);
  hub = { sfx: true, volume: 0.8, voiceVolume: 1 };
  calls = { starts: [], ends: [], drops: [] };
  docHandlers = {};
  doc = { visibilityState: 'visible', addEventListener: (e, f) => (docHandlers[e] = f), removeEventListener: (e) => delete docHandlers[e] };
  _resetVoicesMemory();
});

// ---- the persisted Voices switch ---------------------------------------------------------------

describe('Voices setting (jalebi.tiffin.voices.v1)', () => {
  const store = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
  };
  it('uses the documented key and is OFF by default', () => {
    expect(VOICES_KEY).toBe('jalebi.tiffin.voices.v1');
    expect(getVoicesEnabled(store())).toBe(false);
  });
  it('persists on and off', () => {
    const st = store();
    expect(setVoicesEnabled(true, st)).toBe(true);
    expect(st.m.get(VOICES_KEY)).toBe('1');
    expect(getVoicesEnabled(st)).toBe(true);
    setVoicesEnabled(false, st);
    expect(getVoicesEnabled(st)).toBe(false);
  });
  it('survives a storage that throws (falls back to memory) and never throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(getVoicesEnabled(bad)).toBe(false);
    setVoicesEnabled(true, bad);
    expect(getVoicesEnabled(bad)).toBe(true);
    expect(getVoicesEnabled(null)).toBe(true); // memory wins
  });
  it('a speech object starts from the stored value and follows setVoicesEnabled by itself', () => {
    const st = store();
    const sp = createTiffinSpeech({ synth, SpeechUtterance: FakeUtterance, getSettings: () => hub, now: () => clock.t, timers, doc: null, isActivated: () => true, storage: st });
    expect(sp.isEnabled()).toBe(false);
    expect(sp.speak(line(1))).toBe(false);
    setVoicesEnabled(true, st);
    expect(sp.isEnabled()).toBe(true);
    expect(sp.speak(line(1))).toBe(true);
    setVoicesEnabled(false, st);
    expect(sp.isEnabled()).toBe(false);
    expect(sp.isSpeaking()).toBe(false);
    sp.dispose();
    const cb = vi.fn();
    const off = subscribeVoices(cb);
    setVoicesEnabled(true, st);
    expect(cb).toHaveBeenCalledWith(true);
    off();
    setVoicesEnabled(false, st);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ---- voice choice and availability --------------------------------------------------------------

describe('voice choice and availability', () => {
  it('speaks Telugu with te-IN, Hindi and Dakhni with hi-IN, and sets the utterance language', () => {
    const sp = make();
    expect(sp.speak(line(1, { lang: 'te' }))).toBe(true);
    expect(spoken()[0].voice).toBe(TE);
    expect(spoken()[0].lang).toBe('te-IN');
    synth.end();
    expect(sp.speak(line(2, { lang: 'hi' }))).toBe(true);
    expect(spoken()[1].voice).toBe(HI);
    synth.end();
    expect(sp.speak(line(3, { lang: 'dk' }))).toBe(true);
    expect(spoken()[2].voice).toBe(HI);
  });
  it('returns false and never speaks when the language has no voice (never uses a voice of another language)', () => {
    synth.voices = [EN, HI];
    const sp = make();
    expect(sp.isAvailable('te')).toBe(false);
    expect(sp.isAvailable('hi')).toBe(true);
    expect(sp.isAvailable('dk')).toBe(true);
    expect(sp.isAvailable('en')).toBe(false);
    expect(sp.speak(line(1, { lang: 'te' }))).toBe(false);
    expect(spoken()).toHaveLength(0);
  });
  it('rejects bad input', () => {
    const sp = make();
    expect(sp.speak(null)).toBe(false);
    expect(sp.speak({ text: 5, lang: 'te' })).toBe(false);
    expect(sp.speak({ text: '   ', lang: 'te' })).toBe(false);
    expect(sp.speak({ text: 'x', lang: 'en' })).toBe(false);
    expect(sp.speak({ text: 'x' })).toBe(false);
  });
  it('waits for voiceschanged: lines are held while the list is empty, then spoken', () => {
    synth.voices = [];
    const sp = make();
    expect(sp.isAvailable('te')).toBe(false);
    expect(sp.speak(line(1))).toBe(true); // accepted optimistically
    expect(spoken()).toHaveLength(0);
    synth.voices = [TE];
    synth.fire('voiceschanged');
    expect(sp.isAvailable('te')).toBe(true);
    expect(spoken()).toHaveLength(1);
  });
  it('if voices never arrive: the line is dropped (no-voice) and later speak() returns false', () => {
    synth.voices = [];
    const sp = make();
    expect(sp.speak(line(1, { ttlMs: 60000 }))).toBe(true);
    timers.advance(2300); // the wait for voices is over
    expect(spoken()).toHaveLength(0);
    expect(dropped()).toContain('1:no-voice');
    expect(sp.speak(line(2))).toBe(false);
  });
  it('without speechSynthesis or the utterance class everything is false and nothing throws', () => {
    const a = make({ synth: null });
    expect(a.speak(line(1))).toBe(false);
    expect(a.isAvailable('te')).toBe(false);
    expect(a.unlock()).toBe(false);
    a.cancel();
    a.dispose();
    const b = make({ SpeechUtterance: undefined });
    expect(b.speak(line(1))).toBe(false);
  });
  it('works with an engine that only has onvoiceschanged', () => {
    const old = makeSynth([]);
    delete old.addEventListener;
    synth = old;
    const sp = make();
    old.voices = [TE];
    old.onvoiceschanged();
    expect(sp.isAvailable('te')).toBe(true);
    sp.dispose();
    expect(old.onvoiceschanged).toBeNull();
  });
  it('voiceFor exposes the chosen voice', () => {
    const sp = make();
    expect(sp.voiceFor('te')).toBe(TE);
    expect(sp.voiceFor('xx')).toBeNull();
  });
});

// ---- delivery ------------------------------------------------------------------------------------

describe('delivery', () => {
  it('each customer gets their own deterministic pitch and rate', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'alice' }));
    const a = spoken()[0];
    synth.end();
    sp.speak(line(2, { customer: 'bob' }));
    const b = spoken()[1];
    synth.end();
    sp.speak(line(3, { customer: 'alice' }));
    const a2 = spoken()[2];
    expect([a.pitch, a.rate]).toEqual([a2.pitch, a2.rate]);
    expect([a.pitch, a.rate]).not.toEqual([b.pitch, b.rate]);
    expect(a.pitch).toBeCloseTo(speechParams('alice', 'neutral').pitch, 10);
  });
  it('mood changes the delivery (angry faster, higher, louder)', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'z', mood: 'neutral' }));
    synth.end();
    sp.speak(line(2, { customer: 'z', mood: 'angry' }));
    const [n, a] = spoken();
    expect(a.rate).toBeGreaterThan(n.rate);
    expect(a.pitch).toBeGreaterThan(n.pitch);
    expect(a.volume).toBeGreaterThan(n.volume);
  });
  it('a customer object with a kind is honoured (kid higher than uncle)', () => {
    const sp = make();
    sp.speak(line(1, { customer: { id: 'q', kind: 'kid' } }));
    synth.end();
    sp.speak(line(2, { customer: { id: 'q', kind: 'uncle' } }));
    expect(spoken()[0].pitch).toBeGreaterThan(spoken()[1].pitch);
  });
  it('onStart / onEnd carry the utterance id for the mouth animation', () => {
    const sp = make();
    sp.speak(line('L1', { customer: 'c9' }));
    expect(calls.starts).toHaveLength(0);
    synth.start();
    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0]).toMatchObject({ id: 'L1', customer: 'c9', lang: 'te' });
    expect(calls.starts[0].estMs).toBeGreaterThan(0);
    expect(calls.starts[0].intensity).toBeGreaterThan(0);
    synth.start(); // a second 'start' is ignored
    expect(calls.starts).toHaveLength(1);
    synth.end();
    expect(calls.ends).toEqual([expect.objectContaining({ id: 'L1', cancelled: false })]);
    expect(sp.isSpeaking()).toBe(false);
  });
  it('a throwing callback does not break the queue', () => {
    const sp = make({
      onStart: () => {
        throw new Error('ui');
      },
      onEnd: () => {
        throw new Error('ui');
      },
    });
    sp.speak(line(1));
    sp.speak(line(2, { customer: 'other' }));
    synth.start();
    synth.end();
    expect(spoken()).toHaveLength(2);
  });
  it('an auto id is given when none is passed', () => {
    const sp = make();
    expect(sp.speak({ text: 'hello', lang: 'hi' })).toBe(true);
    synth.start();
    expect(calls.starts[0].id).toMatch(/^line-/);
  });
});

// ---- queueing ------------------------------------------------------------------------------------

describe('queue discipline', () => {
  it('lines are spoken one after the other, in order', () => {
    const sp = make();
    sp.speak(line(1));
    sp.speak(line(2));
    expect(spoken()).toHaveLength(1);
    synth.start();
    synth.end();
    expect(spoken()).toHaveLength(2);
    expect(spoken()[1].text).toBe('text 2');
  });
  it('a higher priority line waiting jumps the queue (angry before polite)', () => {
    const sp = make();
    sp.speak(line(1));
    sp.speak(line(2, { customer: 'p', mood: 'neutral' }));
    sp.speak(line(3, { customer: 'a', mood: 'angry' }));
    synth.end(); // line 1 done
    expect(spoken()[1].text).toBe('text 3');
  });
  it('at most 2 different customers are in the pipeline; a third is refused unless it outranks a waiting one', () => {
    const sp = make();
    expect(sp.speak(line(1, { customer: 'A' }))).toBe(true); // speaking
    expect(sp.speak(line(2, { customer: 'B' }))).toBe(true); // waiting
    expect(sp.speak(line(3, { customer: 'C' }))).toBe(false); // same priority: refused
    expect(sp.speak(line(4, { customer: 'D', mood: 'angry' }))).toBe(true); // outranks B
    expect(dropped()).toContain('2:speakers');
    expect(sp.stats().queued).toEqual([4]);
  });
  it('a customer replaces their own waiting line', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B' }));
    sp.speak(line(3, { customer: 'B' }));
    expect(dropped()).toContain('2:replaced');
    expect(sp.stats().queued).toEqual([3]);
  });
  it(`never holds more than ${MAX_QUEUE} waiting lines: the lowest priority (then oldest) is dropped`, () => {
    const sp = make({ enabled: true });
    sp.speak(line(0, { customer: null, persona: undefined }));
    // anonymous lines are not subject to the speaker cap, only to the queue cap
    for (let i = 1; i <= MAX_QUEUE; i++) {
      clock.t += 10;
      expect(sp.speak({ id: `q${i}`, text: `t${i}`, lang: 'te' })).toBe(true);
    }
    expect(sp.stats().queued).toHaveLength(MAX_QUEUE);
    clock.t += 10;
    expect(sp.speak({ id: 'q4', text: 't4', lang: 'te' })).toBe(true); // same priority: the oldest waiting one goes
    expect(dropped()).toContain('q1:overflow');
    expect(sp.stats().queued).toEqual(['q2', 'q3', 'q4']);
    clock.t += 10;
    expect(sp.speak({ id: 'q5', text: 't5', lang: 'te', priority: 9 })).toBe(true); // outranks everyone
    expect(sp.stats().queued).toEqual(['q3', 'q4', 'q5']);
    expect(sp.speak({ id: 'q6', text: 't6', lang: 'te', priority: 0 })).toBe(false); // lowest of all: refused
    expect(sp.stats().queued).toHaveLength(MAX_QUEUE);
  });
  it('drops stale lines older than their ttl instead of speaking them late', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B', ttlMs: 1500 }));
    sp.speak(line(3, { customer: 'A' })); // A's newer line replaces nothing waiting; it queues behind B
    clock.t += 2000;
    synth.end();
    expect(dropped()).toContain('2:stale');
    expect(spoken().map((u) => u.text)).toEqual(['text 1', 'text 3']);
  });
  it('the default ttl applies when ttlMs is missing or bad', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B', ttlMs: -5 }));
    clock.t += DEFAULT_TTL_MS - 100;
    synth.end();
    expect(spoken()).toHaveLength(2);
    synth.end();
    sp.speak(line(3, { customer: 'B' }));
    sp.speak(line(4, { customer: 'A' }));
    clock.t += DEFAULT_TTL_MS + 1;
    synth.end();
    expect(dropped()).toContain('4:stale');
  });
  it('keeps going after an engine error and after a swallowed speak() (no start event)', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B' }));
    synth.fail('synthesis-failed');
    expect(spoken()).toHaveLength(2);
    expect(dropped()).toContain('1:synthesis-failed');
    // line 2 never starts (iOS before a gesture, Chrome after cancel): the watchdog gives it up
    timers.advance(START_WATCHDOG_MS + 10);
    expect(dropped()).toContain('2:no-start');
    expect(sp.isSpeaking()).toBe(false);
    expect(calls.ends).toHaveLength(0); // it never started, so there is no mouth to stop
  });
  it('a stuck line that started but never ends is cut by the watchdog and onEnd is reported as cancelled', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    synth.start();
    timers.advance(60000);
    expect(calls.ends).toEqual([expect.objectContaining({ id: 1, cancelled: true, reason: 'timeout' })]);
    expect(sp.isSpeaking()).toBe(false);
  });
  it('a speak() that throws is handled', () => {
    synth.speak = () => {
      throw new Error('nope');
    };
    const sp = make();
    expect(sp.speak(line(1))).toBe(true);
    expect(sp.isSpeaking()).toBe(false);
    expect(dropped()).toContain('1:error');
  });
});

// ---- cancel, pause, hide --------------------------------------------------------------------------

describe('cancel, pause and hide', () => {
  it('cancel(customer) cuts only that customer: the line in the air and their waiting lines', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B' }));
    synth.start();
    sp.cancel('A');
    expect(calls.ends).toEqual([expect.objectContaining({ id: 1, cancelled: true })]);
    expect(synth.cancelCalls).toBeGreaterThan(0);
    expect(spoken().map((u) => u.text)).toEqual(['text 1', 'text 2']); // B carries on
    synth.start();
    sp.cancel('B');
    expect(dropped()).not.toContain('2:cancel'); // B was speaking (not waiting): it ends, it is not "dropped"
    expect(calls.ends).toHaveLength(2);
    sp.speak(line(3, { customer: 'C' })); // speaks at once
    sp.speak(line(4, { customer: 'D' })); // waits
    sp.cancel('D');
    expect(dropped()).toContain('4:cancel');
    expect(sp.stats()).toMatchObject({ speaking: 3, queued: [] });
    sp.cancel('C'); // C never reported a start: its line is dropped, not "ended"
    expect(dropped()).toContain('3:cancel');
    expect(calls.ends).toHaveLength(2);
  });
  it('cancel() with no id cuts everything and drops the waiting lines', () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B' }));
    synth.start();
    sp.cancel();
    expect(sp.stats()).toMatchObject({ speaking: null, queued: [] });
    expect(dropped()).toContain('2:cancel');
    expect(calls.ends).toHaveLength(1);
  });
  it("the browser's own 'canceled' error for a cut line does not double-finish it", () => {
    const sp = make();
    sp.speak(line(1, { customer: 'A' }));
    sp.speak(line(2, { customer: 'B' }));
    synth.start();
    const first = synth.cur;
    sp.cancel('A');
    first.onerror({ error: 'canceled' });
    first.onend?.();
    expect(calls.ends).toHaveLength(1);
    expect(spoken()).toHaveLength(2);
  });
  it('setPaused(true) cuts everything and refuses lines until resumed', () => {
    const sp = make();
    sp.speak(line(1));
    synth.start();
    sp.setPaused(true);
    expect(sp.isSpeaking()).toBe(false);
    expect(calls.ends[0].cancelled).toBe(true);
    expect(sp.speak(line(2))).toBe(false);
    sp.setPaused(false);
    expect(sp.speak(line(3))).toBe(true);
  });
  it('hiding the tab cancels, showing it allows speech again', () => {
    const sp = make();
    sp.speak(line(1));
    synth.start();
    doc.visibilityState = 'hidden';
    docHandlers.visibilitychange();
    expect(sp.isSpeaking()).toBe(false);
    expect(sp.speak(line(2))).toBe(false);
    doc.visibilityState = 'visible';
    docHandlers.visibilitychange();
    expect(sp.speak(line(3))).toBe(true);
  });
  it('dispose cancels, removes its listeners and refuses new lines', () => {
    const sp = make();
    sp.speak(line(1));
    sp.dispose();
    expect(docHandlers.visibilitychange).toBeUndefined();
    expect(synth.listeners.voiceschanged).toBeUndefined();
    expect(sp.speak(line(2))).toBe(false);
    sp.dispose();
  });
});

// ---- enabled / settings ---------------------------------------------------------------------------

describe('enabled and hub settings', () => {
  it('setEnabled(false) cancels and refuses; setEnabled(true) speaks again', () => {
    const sp = make();
    sp.speak(line(1));
    synth.start();
    sp.setEnabled(false);
    expect(sp.isSpeaking()).toBe(false);
    expect(sp.speak(line(2))).toBe(false);
    sp.setEnabled(true);
    expect(sp.speak(line(3))).toBe(true);
  });
  it('switching on primes the synth with a silent utterance (iOS wants a gesture)', () => {
    const sp = make({ enabled: false });
    sp.setEnabled(true);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].volume).toBe(0);
  });
  it("is silent when the hub's sound setting is off, or its volume is 0", () => {
    const sp = make();
    hub.sfx = false;
    expect(sp.speak(line(1))).toBe(false);
    hub.sfx = true;
    hub.volume = 0;
    expect(sp.speak(line(1))).toBe(false);
    hub.volume = 0.8;
    expect(sp.speak(line(1))).toBe(true);
  });
  it('utterance volume follows hub volume x voiceVolume x local volume x mood', () => {
    const sp = make();
    hub.volume = 0.5;
    hub.voiceVolume = 0.5;
    sp.setVolume(0.8);
    sp.speak(line(1, { mood: 'angry' }));
    expect(spoken()[0].volume).toBeCloseTo(0.5 * 0.5 * 0.8 * 1, 10);
    synth.end();
    sp.speak(line(2, { mood: 'neutral' }));
    expect(spoken()[1].volume).toBeCloseTo(0.5 * 0.5 * 0.8 * 0.85, 10);
  });
  it('setVolume(0) silences and cuts; missing or broken settings fall back to defaults', () => {
    const sp = make();
    sp.speak(line(1));
    synth.start();
    sp.setVolume(0);
    expect(sp.isSpeaking()).toBe(false);
    expect(sp.speak(line(2))).toBe(false);
    sp.setVolume(1);
    const broken = make({
      getSettings: () => {
        throw new Error('storage');
      },
    });
    expect(broken.speak(line(3))).toBe(true);
  });
  it('turning the hub sound off mid-line cuts it (settings subscription)', () => {
    let notify = null;
    const sp = make({ getSettings: { load: () => hub, subscribe: (cb) => ((notify = cb), () => {}) } });
    sp.speak(line(1));
    synth.start();
    hub.sfx = false;
    notify();
    expect(sp.isSpeaking()).toBe(false);
  });
});

// ---- browser quirks -------------------------------------------------------------------------------

describe('browser quirks', () => {
  it('Chrome: calls resume() periodically while a line is speaking, and stops when it ends', () => {
    const sp = make();
    sp.speak(line(1, { text: 'a very long line '.repeat(12) })); // a long speech: the watchdog allows plenty of time
    synth.start();
    timers.advance(KEEPALIVE_MS * 3 + 10);
    expect(synth.resumeCalls).toBe(3);
    synth.end();
    timers.advance(KEEPALIVE_MS * 3);
    expect(synth.resumeCalls).toBe(3);
    expect(sp).toBeTruthy();
  });
  it('Android: cancels the synth before every speak()', () => {
    const sp = make({ android: true });
    sp.speak(line(1, { customer: 'A' }));
    synth.end();
    sp.speak(line(2, { customer: 'B' }));
    expect(synth.cancelCalls).toBe(2);
  });
  it('other browsers only cancel a busy synth before speaking', () => {
    const sp = make();
    sp.speak(line(1));
    expect(synth.cancelCalls).toBe(0);
    synth.end();
    synth.speaking = true; // a leftover utterance from elsewhere
    sp.speak(line(2, { customer: 'B' }));
    expect(synth.cancelCalls).toBe(1);
  });
  it('iOS / no user activation yet: speak() returns false until unlock() from a gesture', () => {
    const sp = make({ isActivated: () => false });
    expect(sp.speak(line(1))).toBe(false);
    expect(sp.unlock()).toBe(true);
    expect(synth.spoken.filter((u) => u.text === ' ')).toHaveLength(1); // the silent priming utterance
    synth.end();
    expect(sp.speak(line(2))).toBe(true);
  });
  it('unlock() while Voices is off does not touch the synth', () => {
    const sp = make({ enabled: false });
    expect(sp.unlock()).toBe(true);
    expect(synth.spoken).toHaveLength(0);
  });
});

// ---- the createTiffinAudio pass-throughs -------------------------------------------------------------

describe('createTiffinAudio speech pass-throughs', () => {
  function audioWith(extra = {}) {
    const ctx = new FakeAudioContext();
    return createTiffinAudio({
      getAudioContext: () => ctx,
      settings: () => hub,
      now: () => clock.t,
      timers,
      doc: null,
      speech: { synth, SpeechUtterance: FakeUtterance, now: () => clock.t, timers, doc: null, isActivated: () => true, android: false, enabled: true, ...extra },
    });
  }
  it('speak() and setSpeechEnabled() reach the speech object; unlock() primes it', () => {
    const a = audioWith();
    expect(a.isSpeechAvailable('te')).toBe(true);
    expect(a.speak(line(1))).toBe(true);
    expect(spoken()[0].text).toBe('text 1');
    a.setSpeechEnabled(false);
    expect(a.speak(line(2))).toBe(false);
    a.setSpeechEnabled(true);
    a.unlock();
    expect(synth.spoken.some((u) => u.text === ' ')).toBe(true);
    a.dispose();
  });
  it('mute and the hub sound setting stop speech; setVolume follows', () => {
    const a = audioWith();
    expect(a.speak(line(1))).toBe(true);
    synth.start();
    a.setMuted(true);
    expect(a.getSpeech().isSpeaking()).toBe(false);
    expect(a.speak(line(2))).toBe(false);
    a.setMuted(false);
    hub.sfx = false;
    expect(a.speak(line(3))).toBe(false);
    hub.sfx = true;
    a.setVolume(0.5);
    a.cancelSpeech();
    a.speak(line(4));
    expect(spoken().at(-1).volume).toBeCloseTo(0.8 * 0.5 * 0.85, 10);
  });
  it('accepts a ready speech object and survives a missing browser API', () => {
    const fake = { speak: vi.fn(() => true), setEnabled: vi.fn(), setVolume: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), isAvailable: () => true };
    const a = createTiffinAudio({ getAudioContext: () => new FakeAudioContext(), settings: () => hub, speech: fake, doc: null });
    expect(a.speak(line(1))).toBe(true);
    expect(fake.speak).toHaveBeenCalledTimes(1);
    a.setSpeechEnabled(true);
    expect(fake.setEnabled).toHaveBeenCalledWith(true);
    a.dispose();
    expect(fake.dispose).toHaveBeenCalled();
    expect(a.speak(line(2))).toBe(false); // disposed
    const none = createTiffinAudio({ getAudioContext: () => new FakeAudioContext(), settings: () => hub, speech: { synth: null }, doc: null });
    expect(none.speak(line(1))).toBe(false);
  });
});
