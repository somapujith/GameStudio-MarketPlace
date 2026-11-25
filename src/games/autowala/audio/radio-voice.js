// OWNER: sound agent. The procedural radio: a look-ahead sequencer (sound-math.js genStep decides the notes) driving four sources:
// a lead oscillator, a bass oscillator, a kick oscillator and one noise source shared by hats, snares and the tuning static.
// Built when the radio goes on and torn down when it goes off, so a closed radio costs nothing. Everything feeds the music bus.
import { genStep, midiHz, newSlot, stepSeconds, swingDelay } from './sound-math.js';
import { filter, gain, param, safeDisconnect, safeStop } from './engine-kit.js';

const LOOKAHEAD = 0.22; // s of notes scheduled in advance
const VOICES = [
  { leadType: 'sawtooth', leadLp: 2600, leadPk: 0.075, leadRel: 0.88, bassType: 'triangle', bassLp: 420, bassPk: 0.2, kickPk: 0.34, hatPk: 0.05, snarePk: 0.07 },
  { leadType: 'triangle', leadLp: 1800, leadPk: 0.11, leadRel: 0.72, bassType: 'sine', bassLp: 300, bassPk: 0.2, kickPk: 0.22, hatPk: 0.03, snarePk: 0.045 },
  { leadType: 'square', leadLp: 3400, leadPk: 0.036, leadRel: 0.6, bassType: 'sawtooth', bassLp: 600, bassPk: 0.15, kickPk: 0.4, hatPk: 0.06, snarePk: 0.09 },
];

export function createRadio(ac, bus, noiseBuf) {
  let n = null; // the live nodes
  let duckSet = null;
  let station = 0;
  let step = 0;
  let nextTime = 0;
  let killTimer = 0;
  const slot = newSlot();

  function build() {
    const out = gain(ac, 0);
    const tone = filter(ac, 'highpass', 150, 0.6);
    const tone2 = filter(ac, 'lowpass', 7000, 0.6);
    const duck = gain(ac, 1);
    out.connect(tone);
    tone.connect(tone2);
    tone2.connect(duck);
    duck.connect(bus);
    duckSet = param(duck.gain, 0.18, 0.01);
    const lead = ac.createOscillator();
    const leadLp = filter(ac, 'lowpass', 2400, 0.8, out);
    const leadG = gain(ac, 0, leadLp);
    lead.connect(leadG);
    const bass = ac.createOscillator();
    const bassLp = filter(ac, 'lowpass', 420, 0.7, out);
    const bassG = gain(ac, 0, bassLp);
    bass.connect(bassG);
    const kick = ac.createOscillator();
    kick.type = 'sine';
    const kickG = gain(ac, 0, out);
    kick.connect(kickG);
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseBp = filter(ac, 'bandpass', 6000, 1);
    const noiseG = gain(ac, 0, out);
    noise.connect(noiseBp);
    noiseBp.connect(noiseG);
    lead.start();
    bass.start();
    kick.start();
    noise.start(0, Math.random());
    n = { out, tone, tone2, duck, lead, leadLp, leadG, bass, bassLp, bassG, kick, kickG, noise, noiseBp, noiseG };
  }

  function teardown() {
    if (!n) return;
    for (const s of [n.lead, n.bass, n.kick, n.noise]) safeStop(s);
    safeDisconnect(...Object.values(n));
    n = null;
  }

  function voiceFor(st) {
    const v = VOICES[st] || VOICES[0];
    n.lead.type = v.leadType;
    n.bass.type = v.bassType;
    n.leadLp.frequency.value = v.leadLp;
    n.bassLp.frequency.value = v.bassLp;
    return v;
  }

  /** A short burst of tuning static. */
  function staticBurst(t) {
    const g = n.noiseG.gain;
    n.noiseBp.frequency.setValueAtTime(2600, t);
    n.noiseBp.Q.setValueAtTime(0.3, t);
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(0.07, t + 0.03);
    g.linearRampToValueAtTime(0.03, t + 0.12);
    g.linearRampToValueAtTime(0.0001, t + 0.22);
  }

  function playStep(t0) {
    const v = VOICES[station] || VOICES[0];
    const sd = stepSeconds(station);
    const t = t0 + swingDelay(station, step);
    genStep(station, step, slot);
    if (slot.lead) {
      const dur = slot.leadLen * sd;
      n.lead.frequency.setValueAtTime(midiHz(slot.lead), t);
      if (slot.bend) {
        n.lead.detune.cancelScheduledValues(t);
        n.lead.detune.setValueAtTime(slot.bend, t);
        n.lead.detune.linearRampToValueAtTime(0, t + 0.09);
      }
      const g = n.leadG.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(v.leadPk, t, 0.006);
      g.setTargetAtTime(0.0001, t + dur * v.leadRel, 0.05);
    }
    if (slot.bass) {
      const dur = slot.bassLen * sd;
      n.bass.frequency.setValueAtTime(midiHz(slot.bass), t);
      const g = n.bassG.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(v.bassPk, t, 0.01);
      g.setTargetAtTime(0.0001, t + dur * 0.85, 0.06);
    }
    if (slot.kick) {
      n.kick.frequency.cancelScheduledValues(t);
      n.kick.frequency.setValueAtTime(150, t);
      n.kick.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      const g = n.kickG.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(v.kickPk * slot.kick, t);
      g.exponentialRampToValueAtTime(0.0001, t + 0.22);
    }
    if (slot.snare || slot.hat) {
      const g = n.noiseG.gain;
      g.cancelScheduledValues(t);
      if (slot.snare) {
        n.noiseBp.frequency.setValueAtTime(1900, t);
        n.noiseBp.Q.setValueAtTime(0.8, t);
        g.setValueAtTime(v.snarePk * slot.snare, t);
        g.exponentialRampToValueAtTime(0.0001, t + 0.14);
      } else {
        n.noiseBp.frequency.setValueAtTime(7500, t);
        n.noiseBp.Q.setValueAtTime(1.2, t);
        g.setValueAtTime(v.hatPk * slot.hat, t);
        g.exponentialRampToValueAtTime(0.0001, t + 0.045);
      }
    }
  }

  return {
    get on() {
      return !!n;
    },
    get station() {
      return station;
    },
    get step() {
      return step;
    },
    /** Switch the radio on at station `st` (rebuilds if it was off). */
    start(st, now) {
      clearTimeout(killTimer);
      if (!n) build();
      station = st;
      step = 0;
      voiceFor(st);
      const t = now + 0.02;
      n.out.gain.cancelScheduledValues(t);
      n.out.gain.setTargetAtTime(1, t, 0.08);
      staticBurst(t);
      nextTime = t + 0.24;
    },
    /** Retune while on. */
    tune(st, now) {
      if (!n) return;
      station = st;
      step = 0;
      voiceFor(st);
      for (const g of [n.leadG.gain, n.bassG.gain, n.kickG.gain]) {
        g.cancelScheduledValues(now);
        g.setTargetAtTime(0.0001, now, 0.02);
      }
      staticBurst(now + 0.02);
      nextTime = now + 0.26;
    },
    /** Fade out and release every node shortly after. */
    stop(now) {
      if (!n) return;
      n.out.gain.cancelScheduledValues(now);
      n.out.gain.setTargetAtTime(0, now, 0.05);
      clearTimeout(killTimer);
      killTimer = setTimeout(teardown, 400);
    },
    /** Per frame: duck level 0..1 and the sequencer. */
    update(now, duck) {
      if (!n) return;
      duckSet(duck, now);
      if (nextTime < now - 0.15) nextTime = now + 0.03; // woke up late (tab was away): do not replay the backlog
      let guard = 0;
      while (nextTime < now + LOOKAHEAD && guard++ < 8) {
        playStep(nextTime);
        nextTime += stepSeconds(station);
        step++;
      }
    },
    nodes: 4,
    dispose() {
      clearTimeout(killTimer);
      teardown();
    },
  };
}
