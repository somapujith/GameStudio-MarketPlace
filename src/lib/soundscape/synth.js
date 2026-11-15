// Synthesis helpers for the soundscape recipes. A "synth" is bound to one audio context, one destination node
// (the voice's own gain) and one voice record, and every source it creates is tracked so the mixer knows when the
// voice is over (all sources ended) and can disconnect every node again (no leaks).
//
//   const s = createSynth(ctx, destination, voice);
//   s.tone({ f, f2, type, t, a, d, v, filter, vib, pan })     one note with an attack / decay envelope and a glide
//   s.noise({ t, d, v, type, f, f2, q, a, pan })              a burst of filtered noise
//   s.rattle({ t, d, hits, v, f1, f2 })                       many tiny ticks from ONE noise source (dice in a cup)
//   s.bell({ f, t, d, v, ratios })                            a struck bell: inharmonic partials with a long ring
//
// `t` is an absolute AudioContext time in seconds. `voice` is { sources, loud, end, onIdle } (see mixer.js).

const noiseCache = new WeakMap();

/** One shared second and a half of white noise per context (looped by every noise source). */
export function noiseBuffer(c) {
  let buf = noiseCache.get(c);
  if (buf && buf.sampleRate === c.sampleRate) return buf;
  const len = Math.max(1, Math.floor(c.sampleRate * 1.5));
  buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(c, buf);
  return buf;
}

const clampV = (v) => Math.max(0.0002, Number.isFinite(v) ? v : 0.0002);
const rand = (a, b) => a + Math.random() * (b - a);

export function createSynth(c, dest, voice) {
  const reg = voice || { sources: 0, loud: 0, end: 0, onIdle: null };

  /** Registers a started source: when it ends every node of its little chain is disconnected. */
  function track(src, nodes, endAt) {
    reg.sources += 1;
    if (Array.isArray(reg.srcs)) reg.srcs.push(src);
    if (endAt > reg.end) reg.end = endAt;
    let done = false;
    src.onended = () => {
      if (done) return;
      done = true;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
      reg.sources -= 1;
      if (reg.sources <= 0 && typeof reg.onIdle === 'function') reg.onIdle();
    };
  }

  /** Optional stereo placement; silently skipped where StereoPanner is missing (old Safari). */
  function panner(pan, chain) {
    if (!pan || typeof c.createStereoPanner !== 'function') return null;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    chain.push(p);
    return p;
  }

  function tone({ f, f2, from, glide = 0.06, type = 'sine', t, a = 0.004, hold = 0, d = 0.15, v = 0.3, detune = 0, filter = null, vib = null, pan = 0 }) {
    const o = c.createOscillator();
    const g = c.createGain();
    const chain = [o, g];
    o.type = type;
    o.frequency.setValueAtTime(from || f, t);
    if (from) o.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + glide); // a "meend": slide into the note
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + a + hold + d);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(clampV(v), t + a);
    if (hold > 0) g.gain.setValueAtTime(clampV(v), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    let node = o;
    if (filter) {
      const bf = c.createBiquadFilter();
      bf.type = filter.type || 'lowpass';
      bf.frequency.setValueAtTime(filter.f, t);
      if (filter.f2) bf.frequency.exponentialRampToValueAtTime(Math.max(20, filter.f2), t + a + hold + d);
      bf.Q.value = filter.q ?? 1;
      node.connect(bf);
      node = bf;
      chain.push(bf);
    }
    node.connect(g);
    const p = panner(pan, chain);
    if (p) {
      g.connect(p);
      p.connect(dest);
    } else {
      g.connect(dest);
    }
    const end = t + a + hold + d + 0.05;
    if (vib) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = vib.rate ?? 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(vib.depth ?? 20, t + (vib.delay ?? 0.08)); // cents
      lfo.connect(lg);
      lg.connect(o.detune);
      lfo.start(t);
      lfo.stop(end);
      track(lfo, [lfo, lg], end);
    }
    o.start(t);
    o.stop(end);
    track(o, chain, end);
    reg.loud += v;
  }

  function noise({ t, d = 0.05, v = 0.2, type = 'bandpass', f = 2000, f2, q = 1, a = 0.003, pan = 0 }) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filt = c.createBiquadFilter();
    const g = c.createGain();
    const chain = [src, filt, g];
    filt.type = type;
    filt.frequency.setValueAtTime(f, t);
    if (f2) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + a + d);
    filt.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(clampV(v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(filt);
    filt.connect(g);
    const p = panner(pan, chain);
    if (p) {
      g.connect(p);
      p.connect(dest);
    } else {
      g.connect(dest);
    }
    const end = t + a + d + 0.05;
    src.start(t, Math.random() * 0.4);
    src.stop(end);
    track(src, chain, end);
    reg.loud += v;
  }

  /**
   * `hits` tiny filtered-noise ticks over `d` seconds from a single looping noise source plus a single square-wave
   * oscillator whose pitch jumps at each hit (the "tock" of a die on wood). Two sources instead of dozens.
   */
  function rattle({ t, d = 1, hits = 18, v = 0.2, f1 = 2200, f2 = 4800, tickV = 0.035, decay = 0.55 }) {
    const n = Math.max(1, Math.min(40, Math.floor(hits)));
    const step = d / n;
    const hit = Math.min(0.024, step * 0.5);
    // noise ticks
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    const g = c.createGain();
    // square "tock" ticks
    const o = c.createOscillator();
    o.type = 'square';
    const og = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    og.gain.setValueAtTime(0.0001, t);
    bp.frequency.setValueAtTime(f1, t);
    o.frequency.setValueAtTime(900, t);
    for (let i = 0; i < n; i++) {
      const ti = t + i * step + rand(0, step * 0.3);
      const fade = 1 - (i / n) * decay;
      bp.frequency.setValueAtTime(rand(f1, f2), ti);
      o.frequency.setValueAtTime(rand(650, 1500), ti);
      g.gain.setValueAtTime(0.0001, ti);
      g.gain.exponentialRampToValueAtTime(clampV(v * fade), ti + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, ti + hit);
      og.gain.setValueAtTime(0.0001, ti);
      og.gain.exponentialRampToValueAtTime(clampV(tickV * fade), ti + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0001, ti + hit * 0.8);
    }
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    o.connect(og);
    og.connect(dest);
    const end = t + d + 0.1;
    src.start(t, Math.random() * 0.4);
    src.stop(end);
    o.start(t);
    o.stop(end);
    track(src, [src, bp, g], end);
    track(o, [o, og], end);
    reg.loud += v;
  }

  /** A struck bell: partials at inharmonic ratios, the higher ones dying sooner. */
  function bell({ f, t, d = 1, v = 0.2, ratios = [1, 2.0, 2.76, 5.4], type = 'sine' }) {
    ratios.forEach((r, i) => {
      tone({ f: f * r, type, t, a: 0.003, d: Math.max(0.06, d - i * d * 0.18), v: v / (i + 1) });
    });
  }

  return { tone, noise, rattle, bell, rand, ctx: c };
}
