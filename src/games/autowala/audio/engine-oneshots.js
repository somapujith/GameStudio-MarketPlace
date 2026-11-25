// OWNER: sound agent. Short effects made on demand: the soft thud of a guardrail, the crunch of a real crash, a landing thump and
// the exhaust pops of a lifted throttle. Each one is a handful of nodes that clean themselves up; at most MAX play at once.
import { gain, filter, safeDisconnect } from './engine-kit.js';

const MAX = 5;

export function createOneShots(ac, bus, noiseBuf) {
  let live = 0;
  let lastAt = -1;

  const track = (stopAt, nodes, srcs) => {
    live++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      live--;
      safeDisconnect(...nodes);
    };
    srcs[0].onended = end;
    for (const s of srcs) {
      try {
        s.stop(stopAt);
      } catch {
        end();
      }
    }
  };

  const noiseBurst = (t, dur, type, freq, q, peak) => {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = filter(ac, type, freq, q);
    const g = gain(ac, 0, bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    s.start(t, Math.random() * 1.5);
    return { s, nodes: [s, f, g] };
  };

  const thump = (t, hz, dur, peak, sweep = 0.55) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, hz * sweep), t + dur);
    const g = gain(ac, 0, bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    return { o, nodes: [o, g] };
  };

  return {
    /** `p` from crashParams(): { gain, lp, thumpHz, dur, metal }. */
    crash(p) {
      if (live > MAX - 2) return false;
      const t = ac.currentTime;
      const n = noiseBurst(t, p.dur, 'lowpass', p.lp, 0.7, p.gain);
      const th = thump(t, p.thumpHz, p.dur, p.gain * 1.1);
      track(t + p.dur + 0.05, n.nodes, [n.s]);
      track(t + p.dur + 0.05, th.nodes, [th.o]);
      if (p.metal > 0) {
        // a tinny clank: two detuned squares, short
        const o1 = ac.createOscillator();
        const o2 = ac.createOscillator();
        o1.type = o2.type = 'square';
        o1.frequency.value = 410;
        o2.frequency.value = 587;
        const f = filter(ac, 'bandpass', 900, 1.5);
        const g = gain(ac, 0, bus);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(p.metal * p.gain * 0.35, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o1.connect(f);
        o2.connect(f);
        f.connect(g);
        o1.start(t);
        o2.start(t);
        track(t + 0.32, [o1, o2, f, g], [o1, o2]);
      }
      return true;
    },
    /** `p` from landParams(): { gain, hz, dur } */
    land(p) {
      if (live > MAX - 1) return false;
      const t = ac.currentTime;
      const th = thump(t, p.hz, p.dur, p.gain, 0.45);
      const n = noiseBurst(t, p.dur * 0.7, 'lowpass', 300, 0.7, p.gain * 0.6);
      track(t + p.dur + 0.05, th.nodes, [th.o]);
      track(t + p.dur + 0.05, n.nodes, [n.s]);
      return true;
    },
    /** `count` quick exhaust pops starting now. */
    pops(count = 3, level = 1) {
      if (live > MAX - 1) return false;
      const t0 = ac.currentTime;
      let at = t0;
      for (let i = 0; i < count; i++) {
        at += 0.045 + Math.random() * 0.1;
        const n = noiseBurst(at, 0.06, 'bandpass', 520 + Math.random() * 500, 1.6, (0.22 + Math.random() * 0.1) * level);
        track(at + 0.1, n.nodes, [n.s]);
      }
      return true;
    },
    get live() {
      return live;
    },
    stamp(now) {
      // global cooldown helper for callers: true when enough time passed since the last effect
      const ok = now - lastAt > 0.06;
      if (ok) lastAt = now;
      return ok;
    },
    dispose() {},
  };
}
