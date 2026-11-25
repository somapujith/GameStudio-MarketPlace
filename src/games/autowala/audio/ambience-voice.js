// OWNER: sound agent. The city bed: a road hum that grows with the traffic around you, the soft rumble of a metro viaduct overhead,
// rain, and one little oscillator that chirps morning birds or night crickets (never both). Branches of the shared noise source
// plus a single oscillator: no other long-lived nodes. Deliberately NO bells and no call-to-prayer style cues.
import { filter, gain, param, safeDisconnect, safeStop } from './engine-kit.js';

export function createAmbience(ac, bus, noiseSrc) {
  const bedLp = filter(ac, 'lowpass', 700, 0.5);
  const bedG = gain(ac, 0, bus);
  const roadLp = filter(ac, 'lowpass', 300, 0.6);
  const roadG = gain(ac, 0, bus);
  const metroLp = filter(ac, 'lowpass', 105, 1.6);
  const metroG = gain(ac, 0, bus);
  const rainHp = filter(ac, 'highpass', 800, 0.5);
  const rainBp = filter(ac, 'bandpass', 3300, 0.45);
  const rainG = gain(ac, 0, bus);
  for (const [lp, g] of [[bedLp, bedG], [roadLp, roadG], [metroLp, metroG]]) {
    noiseSrc.connect(lp);
    lp.connect(g);
  }
  noiseSrc.connect(rainHp);
  rainHp.connect(rainBp);
  rainBp.connect(rainG);

  const critter = ac.createOscillator();
  critter.type = 'sine';
  critter.frequency.value = 3000;
  const critterG = gain(ac, 0, bus);
  critter.connect(critterG);
  critter.start();

  const sBed = param(bedG.gain, 0.4, 0.001);
  const sRoad = param(roadG.gain, 0.4, 0.001);
  const sMetro = param(metroG.gain, 0.3, 0.001);
  const sRain = param(rainG.gain, 0.5, 0.001);

  let nextAt = 0;
  let metroPhase = 0;

  function chirpBird(t, level) {
    const n = 2 + ((Math.random() * 3) | 0);
    let at = t;
    const base = 2500 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const f0 = base * (0.9 + Math.random() * 0.25);
      critter.frequency.setValueAtTime(f0, at);
      critter.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 0.78 : 1.35), at + 0.055);
      critterG.gain.setValueAtTime(0.0001, at);
      critterG.gain.linearRampToValueAtTime(0.03 * level, at + 0.012);
      critterG.gain.linearRampToValueAtTime(0.0001, at + 0.065);
      at += 0.085 + Math.random() * 0.03;
    }
    return at - t;
  }
  function chirpCricket(t, level) {
    const f = 4200 + Math.random() * 400;
    let at = t;
    critter.frequency.setValueAtTime(f, t);
    for (let i = 0; i < 3; i++) {
      critterG.gain.setValueAtTime(0.0001, at);
      critterG.gain.linearRampToValueAtTime(0.012 * level, at + 0.006);
      critterG.gain.linearRampToValueAtTime(0.0001, at + 0.024);
      at += 0.055;
    }
    return at - t;
  }

  return {
    nodes: 1,
    /** `mix` from ambienceMix(); `now` = ac.currentTime. Cheap: a few param writes, and at most one chirp scheduled. */
    update(mix, now, dt) {
      sBed(mix.bed * 0.05, now);
      sRoad(mix.road * 0.07, now);
      metroPhase += dt * 0.7;
      // a slow swell on the viaduct rumble: a train passing now and then
      sMetro(mix.metro * (0.045 + 0.05 * (0.5 + 0.5 * Math.sin(metroPhase))), now);
      sRain(mix.rain * 0.16, now);
      if (nextAt < now - 1) nextAt = now;
      if (now < nextAt - 0.3) return;
      if (mix.birds > 0.04 && mix.birds >= mix.crickets) {
        const len = chirpBird(Math.max(now, nextAt) + 0.02, mix.birds);
        nextAt = Math.max(now, nextAt) + len + (0.7 + Math.random() * 2.8) / (0.4 + mix.birds);
      } else if (mix.crickets > 0.04) {
        const len = chirpCricket(Math.max(now, nextAt) + 0.02, mix.crickets);
        nextAt = Math.max(now, nextAt) + len + 0.2 + Math.random() * 0.25;
      } else {
        nextAt = now + 0.5;
      }
    },
    dispose() {
      safeStop(critter);
      try {
        noiseSrc.disconnect(bedLp);
        noiseSrc.disconnect(roadLp);
        noiseSrc.disconnect(metroLp);
        noiseSrc.disconnect(rainHp);
      } catch {
        /* gone */
      }
      safeDisconnect(critter, critterG, bedLp, bedG, roadLp, roadG, metroLp, metroG, rainHp, rainBp, rainG);
    },
  };
}
