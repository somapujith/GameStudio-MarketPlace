// OWNER: sound agent. The auto-rickshaw engine: two slightly detuned narrow-pulse oscillators (the putt-putt), a body sine, a
// bandpassed noise rattle and a turbo whine. Four oscillators in all, driven every frame by engineMix() from sound-math.js.
import { filter, gain, param, pulseWave, safeDisconnect, safeStop } from './engine-kit.js';

export function createEngineVoice(ac, bus, noiseSrc) {
  const out = gain(ac, 0, bus);
  const wave = pulseWave(ac, 0.16);
  const lp = filter(ac, 'lowpass', 400, 0.9, out);

  const oA = ac.createOscillator();
  const oB = ac.createOscillator();
  const oS = ac.createOscillator();
  const oW = ac.createOscillator();
  oA.setPeriodicWave(wave);
  oB.setPeriodicWave(wave);
  oB.detune.value = 22; // beating against oA makes the idle irregular, like a real tired two-stroke
  oS.type = 'sine';
  oW.type = 'sine';
  const gA = gain(ac, 0.55, lp);
  const gB = gain(ac, 0.4, lp);
  const gS = gain(ac, 0.8, lp);
  oA.connect(gA);
  oB.connect(gB);
  oS.connect(gS);
  const rattleBp = filter(ac, 'bandpass', 1100, 1.1);
  const gR = gain(ac, 0, out);
  noiseSrc.connect(rattleBp);
  rattleBp.connect(gR);
  const gW = gain(ac, 0, out);
  oW.connect(gW);
  oA.start();
  oB.start();
  oS.start();
  oW.start();

  const sOut = param(out.gain, 0.06, 0.001);
  const sLp = param(lp.frequency, 0.07, 4);
  const sSub = param(gS.gain, 0.1, 0.01);
  const sRattle = param(gR.gain, 0.06, 0.001);
  const sWG = param(gW.gain, 0.08, 0.0008);
  const fA = param(oA.frequency, 0.045, 0.05);
  const fB = param(oB.frequency, 0.045, 0.05);
  const fS = param(oS.frequency, 0.045, 0.05);
  const fW = param(oW.frequency, 0.1, 5);
  const fRb = param(rattleBp.frequency, 0.1, 10);

  return {
    /** `mix` is what engineMix() wrote. */
    update(mix, now) {
      sOut(mix.gain, now);
      sLp(mix.lp, now);
      sSub(mix.sub, now);
      sRattle(mix.rattle, now);
      sWG(mix.whineGain, now);
      fA(mix.hz, now);
      fB(mix.hz, now);
      fS(Math.min(160, mix.hz * 2), now);
      fW(mix.whineHz, now);
      fRb(700 + mix.hz * 25, now);
    },
    nodes: 4,
    dispose() {
      safeStop(oA);
      safeStop(oB);
      safeStop(oS);
      safeStop(oW);
      safeDisconnect(oA, oB, oS, oW, gA, gB, gS, lp, rattleBp, gR, gW, out);
      try {
        noiseSrc.disconnect(rattleBp);
      } catch {
        /* gone */
      }
    },
  };
}

