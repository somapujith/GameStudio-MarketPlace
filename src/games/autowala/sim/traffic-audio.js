// Horns and bumps of the traffic: short procedural sounds through the shared Web Audio context. Distance-attenuated, panned
// against the camera, never loud: a small pool of voices (polyphony cap), a global cooldown, and nothing at all while the
// browser has not unlocked audio yet.
import { getAudio } from '../audio/ctx.js';

const MAX_VOICES = 4;
const COOLDOWN = 0.07; // s between two horns
const REACH = 130; // m: further than this is silent

/** Horn voice per kind: two detuned oscillators and how long a beep lasts. */
const HORNS = {
  car: { f: [415, 523], wave: 'square', gain: 1.0, dur: 0.22, lp: 1700 },
  auto: { f: [560, 690], wave: 'square', gain: 0.9, dur: 0.16, lp: 2200 },
  bike: { f: [780, 940], wave: 'square', gain: 0.7, dur: 0.12, lp: 2600 },
  bus: { f: [175, 224], wave: 'sawtooth', gain: 1.15, dur: 0.5, lp: 1100 },
  truck: { f: [148, 188], wave: 'sawtooth', gain: 1.2, dur: 0.6, lp: 900 },
};

export function createTrafficAudio(camera) {
  const voices = [];
  let lastAt = -1;
  let noise = null;
  let ac0 = null;

  const makeVoice = (ac, master) => {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    const g = ac.createGain();
    g.gain.value = 0;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    lp.connect(g);
    if (pan) {
      g.connect(pan);
      pan.connect(master);
    } else g.connect(master);
    return { lp, g, pan, busy: false, o: null };
  };

  const listen = (x, z) => {
    const cam = camera.position;
    const m = camera.matrixWorld.elements;
    const dx = x - cam.x;
    const dz = z - cam.z;
    const d = Math.hypot(dx, dz);
    const side = d > 0.5 ? (dx * m[0] + dz * m[2]) / d : 0; // camera right vector (x, z)
    return { d, pan: Math.max(-0.85, Math.min(0.85, side * 0.85)) };
  };

  /** A horn at (x, z). `beeps` > 1 repeats it (peep-peep). Returns false when it was skipped. */
  function honk(x, z, kind = 'car', beeps = 1) {
    const a = getAudio();
    if (!a || a.ac.state !== 'running') return false;
    const { ac, master } = a;
    if (ac0 !== ac) {
      ac0 = ac;
      voices.length = 0;
      noise = null;
    }
    const now = ac.currentTime;
    if (now - lastAt < COOLDOWN) return false;
    const { d, pan } = listen(x, z);
    if (d > REACH) return false;
    const def = HORNS[kind] || HORNS.car;
    const vol = (0.085 * def.gain) / (1 + (d / 16) ** 2);
    if (vol < 0.004) return false;
    let v = voices.find((q) => !q.busy);
    if (!v) {
      if (voices.length >= MAX_VOICES) return false;
      v = makeVoice(ac, master);
      voices.push(v);
    }
    lastAt = now;
    v.busy = true;
    v.lp.frequency.value = def.lp;
    if (v.pan) v.pan.pan.value = pan;
    const detune = 0.97 + Math.random() * 0.06;
    const oscs = def.f.map((f) => {
      const o = ac.createOscillator();
      o.type = def.wave;
      o.frequency.value = f * detune;
      o.connect(v.lp);
      return o;
    });
    const g = v.g.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    let t = now;
    for (let i = 0; i < beeps; i++) {
      g.linearRampToValueAtTime(vol, t + 0.012);
      g.setValueAtTime(vol, t + def.dur);
      g.linearRampToValueAtTime(0, t + def.dur + 0.03);
      t += def.dur + 0.12;
    }
    const end = t - 0.09 + 0.03;
    for (const o of oscs) {
      o.start(now);
      o.stop(end + 0.02);
    }
    oscs[0].onended = () => {
      v.busy = false;
      for (const o of oscs) {
        try {
          o.disconnect();
        } catch {
          /* gone */
        }
      }
    };
    return true;
  }

  /** A dull bump (two bodies meeting). `strength` 0..1. */
  function thud(x, z, strength = 0.5) {
    const a = getAudio();
    if (!a || a.ac.state !== 'running') return;
    const { ac, master } = a;
    const { d, pan } = listen(x, z);
    if (d > REACH) return;
    const vol = Math.min(0.28, 0.07 + 0.22 * strength) / (1 + (d / 25) ** 2);
    if (!noise || noise.ac !== ac) {
      const len = Math.floor(ac.sampleRate * 0.35);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = buf.getChannelData(0);
      let s = 4321;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        ch[i] = (s / 4294967296) * 2 - 1;
      }
      noise = { ac, buf };
    }
    const src = ac.createBufferSource();
    src.buffer = noise.buf;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500 + 900 * strength, ac.currentTime);
    lp.frequency.exponentialRampToValueAtTime(90, ac.currentTime + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(vol, ac.currentTime + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, ac.currentTime + 0.32);
    src.connect(lp);
    lp.connect(g);
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(master);
    } else g.connect(master);
    src.start();
    src.stop(ac.currentTime + 0.35);
    src.onended = () => {
      try {
        src.disconnect();
        lp.disconnect();
        g.disconnect();
      } catch {
        /* gone */
      }
    };
  }

  function dispose() {
    for (const v of voices) {
      try {
        v.lp.disconnect();
        v.g.disconnect();
        v.pan?.disconnect();
      } catch {
        /* gone */
      }
    }
    voices.length = 0;
  }

  return { honk, thud, dispose };
}
