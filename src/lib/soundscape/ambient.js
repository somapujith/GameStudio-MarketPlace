// The optional night-market bed: a very quiet loop of filtered noise (a far-off crowd murmur and a shimmer of
// frying / wind) that slowly breathes, plus an occasional distant chime. OFF by default; the mixer ducks it under
// effects (see mixer.js). Cheap by construction: three sources and a handful of filters, no audio files.
//
//   const a = createAmbient(ctx, bus, { setTimer, clearTimer });
//   a.start();   // fades in
//   a.stop();    // fades out, then every node is stopped and disconnected, and the chime timer is cleared

import { createSynth } from './synth.js';
import { hz, pentMidi } from './recipes.js';

const FADE_IN = 1.6;
const FADE_OUT = 0.7;

export function createAmbient(c, bus, { setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random } = {}) {
  let run = null; // { nodes, fade, timer }

  function loopBuffer() {
    // 4 s of softly low-passed noise: smoother than white noise, so the loop point is not noticeable
    const len = Math.max(1, Math.floor(c.sampleRate * 4));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.86 + (random() * 2 - 1) * 0.14;
      d[i] = last * 3;
    }
    // cross-fade the seam
    const n = Math.min(2000, len >> 2);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      d[len - n + i] = d[len - n + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  function chime() {
    if (!run) return;
    const t = c.currentTime + 0.05;
    const voice = { sources: 0, loud: 0, end: 0, onIdle: null };
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200; // distance: no sparkle, just a soft ring
    const g = c.createGain();
    g.gain.value = 1;
    lp.connect(g);
    g.connect(bus);
    voice.onIdle = () => {
      try {
        lp.disconnect();
        g.disconnect();
      } catch {
        /* gone */
      }
    };
    const s = createSynth(c, lp, voice);
    const root = hz(pentMidi(72, Math.floor(random() * 7)));
    s.bell({ f: root, t, d: 2.6, v: 0.05, ratios: [1, 2.0, 2.76] });
    if (random() < 0.35) s.bell({ f: root * 1.5, t: t + 0.32, d: 2.2, v: 0.035, ratios: [1, 2.0] });
    if (voice.sources === 0) voice.onIdle();
  }

  function schedule() {
    if (!run) return;
    const wait = 6000 + random() * 9000;
    run.timer = setTimer(() => {
      if (!run) return;
      try {
        chime();
      } catch {
        /* never crash on ambience */
      }
      schedule();
    }, wait);
  }

  function start() {
    if (run) return;
    const t = c.currentTime;
    const fade = c.createGain();
    fade.gain.setValueAtTime(0.0001, t);
    fade.gain.linearRampToValueAtTime(1, t + FADE_IN);
    fade.connect(bus);
    const nodes = [fade];

    const buf = loopBuffer();
    const murmurSrc = c.createBufferSource();
    murmurSrc.buffer = buf;
    murmurSrc.loop = true;
    const murmurLp = c.createBiquadFilter();
    murmurLp.type = 'lowpass';
    murmurLp.frequency.value = 520;
    const murmurBp = c.createBiquadFilter();
    murmurBp.type = 'bandpass';
    murmurBp.frequency.value = 360;
    murmurBp.Q.value = 0.5;
    const murmurG = c.createGain();
    murmurG.gain.value = 0.55;
    murmurSrc.connect(murmurLp);
    murmurLp.connect(murmurBp);
    murmurBp.connect(murmurG);
    murmurG.connect(fade);
    nodes.push(murmurSrc, murmurLp, murmurBp, murmurG);

    // a slow swell of the murmur, like a crowd drifting by
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.22;
    lfo.connect(lfoG);
    lfoG.connect(murmurG.gain);
    nodes.push(lfo, lfoG);

    // a thin shimmer high up (sizzle, fabric, far-away bangles)
    const shimSrc = c.createBufferSource();
    shimSrc.buffer = buf;
    shimSrc.loop = true;
    shimSrc.playbackRate.value = 1.7;
    const shimBp = c.createBiquadFilter();
    shimBp.type = 'bandpass';
    shimBp.frequency.value = 2600;
    shimBp.Q.value = 0.8;
    const shimG = c.createGain();
    shimG.gain.value = 0.05;
    shimSrc.connect(shimBp);
    shimBp.connect(shimG);
    shimG.connect(fade);
    nodes.push(shimSrc, shimBp, shimG);

    murmurSrc.start(t);
    shimSrc.start(t, 0.5);
    lfo.start(t);
    run = { nodes, fade, sources: [murmurSrc, shimSrc, lfo], timer: null };
    schedule();
  }

  function stop() {
    if (!run) return;
    const r = run;
    run = null;
    if (r.timer !== null) clearTimer(r.timer);
    try {
      const t = c.currentTime;
      r.fade.gain.cancelScheduledValues(t);
      r.fade.gain.setValueAtTime(Math.max(0.0001, r.fade.gain.value || 1), t);
      r.fade.gain.linearRampToValueAtTime(0.0001, t + FADE_OUT);
      r.sources.forEach((s) => {
        try {
          s.stop(t + FADE_OUT + 0.05);
        } catch {
          /* already stopped */
        }
      });
      let left = r.sources.length;
      r.sources.forEach((s) => {
        s.onended = () => {
          left -= 1;
          if (left <= 0) {
            r.nodes.forEach((n) => {
              try {
                n.disconnect();
              } catch {
                /* ignore */
              }
            });
          }
        };
      });
    } catch {
      r.nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      });
    }
  }

  return { start, stop, isRunning: () => !!run };
}
