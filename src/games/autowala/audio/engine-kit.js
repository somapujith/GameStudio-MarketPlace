// OWNER: sound agent. Small Web Audio helpers shared by the engine, ambience and radio voices. Nothing here runs per frame
// except `param()`'s setter, which only touches the AudioParam when the value really changed.

/** Two seconds of white noise, built once per AudioContext. */
export function createNoiseBuffer(ac, seconds = 2) {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  // a cheap one-pole "brown-ish" tilt mixed into white noise: less hiss, more body, so it sounds like air and road rather than static
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.06 * w) / 1.06;
    d[i] = w * 0.55 + last * 3.2;
  }
  return buf;
}

/** A looping noise source (started). The returned node can fan out to many filter branches. */
export function createNoiseSource(ac, buffer) {
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

/** PeriodicWave of a narrow pulse (duty 0..1): the "putt" of a small two-stroke engine. */
export function pulseWave(ac, duty = 0.18, harmonics = 40) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty) * (1 / (1 + n * 0.03));
  return ac.createPeriodicWave(real, imag);
}

/**
 * A setter for an AudioParam that skips writes when nothing changed (`eps` absolute) and smooths the rest with a
 * time constant `tc` seconds. Returns `set(value, now)`.
 */
export function param(p, tc = 0.05, eps = 0.0005) {
  let last = p.value;
  return (v, now) => {
    if (v === last || Math.abs(v - last) < eps) return;
    last = v;
    try {
      p.setTargetAtTime(v, now, tc);
    } catch {
      p.value = v;
    }
  };
}

export function gain(ac, v = 0, to = null) {
  const g = ac.createGain();
  g.gain.value = v;
  if (to) g.connect(to);
  return g;
}

export function filter(ac, type, freq, q = 0.7, to = null) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (to) f.connect(to);
  return f;
}

export function safeStop(node, when = 0) {
  try {
    node.stop(when);
  } catch {
    /* never started or already stopped */
  }
}
export function safeDisconnect(...nodes) {
  for (const n of nodes) {
    try {
      n?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
