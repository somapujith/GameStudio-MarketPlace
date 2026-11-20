// A tiny fake of the WebAudio API for node tests (no browser, no sound): it records the graph, the parameter automation and
// the scheduled source times, and lets a test move the clock (`ctx.advance(seconds)`) so sources "end" and fire `onended`.
// Test helper only: nothing in the app imports it.

export class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError('exponentialRamp needs a positive value');
    this.events.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, k) { this.events.push(['target', v, t, k]); return this; }
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e[2] < t); return this; }
}

export class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.outs = new Set();
    this.connected = false;
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (dest === undefined || dest === null) throw new TypeError('connect needs a destination');
    this.outs.add(dest);
    this.connected = true;
    return dest;
  }
  disconnect() {
    this.outs.clear();
    this.connected = false;
  }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startAt = null;
    this.stopAt = null;
    this.onended = null;
    this.ended = false;
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.playbackRate = new FakeParam(1);
    ctx.sources.push(this);
  }
  start(t = 0) {
    if (this.startAt !== null) throw new Error('start called twice');
    this.startAt = t;
  }
  stop(t = 0) {
    if (this.startAt === null) throw new Error('stop before start');
    this.stopAt = this.stopAt === null ? t : Math.min(this.stopAt, t);
  }
}

export class FakeAudioContext {
  constructor(opts = {}) {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = opts.state || 'running';
    this.asyncResume = !!opts.asyncResume; // resume() settles in a microtask, like a real browser
    this.nodes = [];
    this.sources = [];
    this.onstatechange = null;
    this.destination = new FakeNode(this, 'destination');
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.closed = false;
  }
  _set(state) {
    this.state = state;
    if (typeof this.onstatechange === 'function') this.onstatechange();
  }
  resume() {
    this.resumeCalls += 1;
    if (this.state === 'closed') return Promise.resolve();
    if (this.asyncResume) return Promise.resolve().then(() => { if (this.state !== 'closed') this._set('running'); });
    this._set('running');
    return Promise.resolve();
  }
  suspend() { this.suspendCalls += 1; this._set('suspended'); return Promise.resolve(); }
  close() { this.closed = true; this._set('closed'); return Promise.resolve(); }
  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(1); return n; }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach((k) => { n[k] = new FakeParam(0); });
    return n;
  }
  createWaveShaper() { const n = new FakeNode(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createConvolver() { const n = new FakeNode(this, 'convolver'); n.buffer = null; return n; }
  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = new FakeParam(350);
    n.Q = new FakeParam(1);
    return n;
  }
  createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(0); return n; }
  createOscillator() { const n = new FakeSource(this, 'osc'); n.type = 'sine'; return n; }
  createBufferSource() { const n = new FakeSource(this, 'buffer'); n.buffer = null; n.loop = false; return n; }
  createBuffer(ch, len, rate) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (i) => data[i] };
  }
  /** Move the clock; every started source whose stop time has passed fires `onended` once. */
  advance(seconds) {
    this.currentTime += seconds;
    for (const s of this.sources) {
      if (!s.ended && s.startAt !== null && s.stopAt !== null && s.stopAt <= this.currentTime) {
        s.ended = true;
        if (typeof s.onended === 'function') s.onended();
      }
    }
  }
  /** Sources that are started and not yet ended. */
  live() { return this.sources.filter((s) => s.startAt !== null && !s.ended); }
  /** Nodes that still have outgoing connections (a leak check: after everything ended this should only be the master chain). */
  connectedNodes() { return this.nodes.filter((n) => n.connected); }
}
