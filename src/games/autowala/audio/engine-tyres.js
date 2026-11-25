// OWNER: sound agent. Tyre squeal (drift / sliding), gravel-ish rumble on a pavement and the smooth hum on the road: three filtered
// branches of the one shared noise source, no oscillators.
import { filter, gain, param, safeDisconnect } from './engine-kit.js';

export function createTyres(ac, bus, noiseSrc) {
  const skidBp = filter(ac, 'bandpass', 1800, 7);
  const skidG = gain(ac, 0, bus);
  const paveLp = filter(ac, 'lowpass', 520, 0.8);
  const paveG = gain(ac, 0, bus);
  const roadLp = filter(ac, 'lowpass', 170, 0.7);
  const roadG = gain(ac, 0, bus);
  noiseSrc.connect(skidBp);
  skidBp.connect(skidG);
  noiseSrc.connect(paveLp);
  paveLp.connect(paveG);
  noiseSrc.connect(roadLp);
  roadLp.connect(roadG);

  const sSkid = param(skidG.gain, 0.05, 0.001);
  const fSkid = param(skidBp.frequency, 0.05, 8);
  const sPave = param(paveG.gain, 0.12, 0.001);
  const sRoad = param(roadG.gain, 0.15, 0.001);

  return {
    /** skid 0..1 and its centre frequency; pave / road 0..1 from surfaceMix(). */
    update(skid, skidFreq, pave, road, now) {
      sSkid(skid * 0.2, now);
      fSkid(skidFreq, now);
      sPave(pave * 0.34, now);
      sRoad(road * 0.2, now);
    },
    nodes: 0,
    dispose() {
      try {
        noiseSrc.disconnect(skidBp);
        noiseSrc.disconnect(paveLp);
        noiseSrc.disconnect(roadLp);
      } catch {
        /* gone */
      }
      safeDisconnect(skidBp, skidG, paveLp, paveG, roadLp, roadG);
    },
  };
}
