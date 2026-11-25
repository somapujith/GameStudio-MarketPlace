// Tiffin Centre audio: the sound RECIPES of the operations layer (plan section 3b): weather, power, gas, prep, tending, stock and the
// street events. Same contract as recipes.js: `(synth, t, opts)` on a createSynth(), absolute context time `t`, `opts.pan` -0.7..0.7.
// Every one-shot is short (<= 2.4 s) and gentle; the loops (rain, grinder, ...) live in opsAudio.js.
//
//   OPS_RECIPES      the event-driven one-shots, merged into RECIPES (and named in mapping.js)
//   OPS_AMBIENT      one-shots the ops scheduler fires by itself (a drip, a stadium roar, a firecracker, a festival bell)
//   dhol(s, t, kind, v, pan)   one stroke of the generic festive street drum ('dum' bass, 'ta' tasa rattle, 'ge' soft bass)

const hz = (base, semis = 0) => base * 2 ** (semis / 12);

/** One stroke of a dhol / tasa style street drum, all synthesis. */
export function dhol(s, t, kind, v = 0.1, pan = 0) {
  switch (kind) {
    case 'dum': // the big bass head
      s.tone({ f: 74, from: 150, glide: 0.06, t, a: 0.003, d: 0.3, v: v * 1.3, pan });
      s.noise({ t, d: 0.05, v: v * 0.5, type: 'lowpass', f: 500, pan });
      break;
    case 'ge': // a soft bass note
      s.tone({ f: 82, from: 120, glide: 0.05, t, a: 0.003, d: 0.2, v: v * 0.9, pan });
      break;
    default: // 'ta': the thin tasa stick on the treble skin
      s.noise({ t, d: 0.045, v: v * 0.75, type: 'bandpass', f: 3300, q: 2.5, a: 0.002, pan });
      s.tone({ f: 540, type: 'triangle', t, a: 0.002, d: 0.05, v: v * 0.3, pan });
  }
}

export const OPS_RECIPES = {
  // ---------------------------------------------------------------- events (weather, power, street)
  /** A distant thunder roll: low rumble that swells and rolls away. `o.long` is the longer one the rain layer uses by itself. */
  thunder(s, t, o = {}) {
    const k = o.long ? 1.7 : 1;
    const v = o.v ?? 1;
    s.noise({ t: t + 0.02, d: 1.6 * k, v: 0.15 * v, type: 'bandpass', f: 1000, q: 0.6, a: 0.05 }); // the far crack
    s.noise({ t, d: 2.0 * k, v: 0.3 * v, type: 'lowpass', f: 300, f2: 80, q: 0.7, a: 0.35 });
    s.noise({ t: t + 0.55 * k, d: 1.3 * k, v: 0.22 * v, type: 'lowpass', f: 200, f2: 70, q: 0.7, a: 0.3 }); // the roll
    s.tone({ f: 55, f2: 36, t: t + 0.05, a: 0.3, d: 1.9 * k, v: 0.18 * v });
  },

  /** The power goes: a relay "thunk", the motors winding down. */
  powerCut(s, t) {
    s.noise({ t, d: 0.02, v: 0.12, type: 'bandpass', f: 3500, q: 2 });
    s.tone({ f: 70, from: 230, glide: 0.1, t, a: 0.003, d: 0.3, v: 0.24 });
    s.noise({ t, d: 0.2, v: 0.1, type: 'lowpass', f: 450 });
    s.tone({ f: 110, f2: 38, type: 'sawtooth', t: t + 0.05, a: 0.01, d: 1.1, v: 0.08, filter: { type: 'lowpass', f: 380, f2: 90 } }); // the fan runs down
    s.noise({ t: t + 0.1, d: 0.9, v: 0.05, type: 'bandpass', f: 700, f2: 150, q: 0.8, a: 0.05 });
  },

  /** The power is back: the relay clicks, the tube light ticks, the fan spins up. */
  powerRestore(s, t) {
    s.noise({ t, d: 0.02, v: 0.12, type: 'bandpass', f: 4000, q: 2 });
    s.tone({ f: 130, from: 270, glide: 0.04, t: t + 0.01, a: 0.002, d: 0.09, v: 0.14 });
    s.rattle({ t: t + 0.18, d: 0.4, hits: 5, v: 0.035, f1: 2500, f2: 3500, tickV: 0.02 }); // the tube light flickers on
    s.tone({ f: 100, from: 28, glide: 1.1, type: 'sawtooth', t: t + 0.12, a: 0.35, d: 1.0, v: 0.07, filter: { type: 'lowpass', f: 420 } });
    s.noise({ t: t + 0.12, d: 1.2, v: 0.05, type: 'bandpass', f: 250, f2: 900, q: 0.8, a: 0.55 }); // the fan's air picks up
  },

  /** A festive street day begins: a few bells and a short drum roll (generic, no more than a bright street party). */
  festivalStart(s, t) {
    [[0, 784, 0.1], [0.14, 1175, 0.08], [0.3, 988, 0.08]].forEach(([dt, f, v]) => s.bell({ f, t: t + dt, d: 1.1, v, ratios: [1, 2.4, 4.1] }));
    for (let i = 0; i < 6; i++) dhol(s, t + 0.2 + i * 0.07, 'ta', 0.07 + i * 0.008);
    dhol(s, t + 0.7, 'dum', 0.11);
  },

  /** The inspector arrives: an official whistle, "pheeet-pheet" (a trilling pea whistle). */
  whistle(s, t) {
    [[0, 0.32, 2600], [0.46, 0.18, 2750]].forEach(([dt, hold, f]) => {
      s.tone({ f, f2: f * 0.99, t: t + dt, a: 0.01, hold, d: 0.08, v: 0.1, vib: { rate: 34, depth: 110, delay: 0.01 } });
      s.noise({ t: t + dt, d: hold + 0.08, v: 0.04, type: 'highpass', f: 3800, q: 0.7, a: 0.01 });
    });
  },

  /** The inspector is happy: a clean rising three-note chime. */
  inspectorPass(s, t) {
    [[0, 1047], [0.13, 1319], [0.26, 1568]].forEach(([dt, f], i) => s.bell({ f, t: t + dt, d: i === 2 ? 1.2 : 0.55, v: 0.13, ratios: [1, 2.0, 3.0] }));
  },

  /** The inspector is not: a flat two-tone buzzer. */
  inspectorFail(s, t) {
    [[0, 175], [0.3, 131]].forEach(([dt, f]) => {
      s.tone({ f, f2: f * 0.96, type: 'square', t: t + dt, a: 0.01, d: 0.28, v: 0.09, filter: { type: 'lowpass', f: 900 } });
      s.tone({ f: f * 1.5, f2: f * 1.44, type: 'sawtooth', t: t + dt, a: 0.01, d: 0.26, v: 0.05, filter: { type: 'lowpass', f: 1200 } });
    });
  },

  /** The delivery boy's bike: a quick double "pip-pip". */
  bikeHorn(s, t, o = {}) {
    const pan = o.pan ?? 0.35;
    [0, 0.26].forEach((dt) => {
      s.tone({ f: 880, f2: 860, type: 'square', t: t + dt, a: 0.006, d: 0.14, v: 0.06, filter: { type: 'bandpass', f: 1500, q: 1.5 }, pan });
      s.tone({ f: 1040, f2: 1010, type: 'square', t: t + dt, a: 0.006, d: 0.14, v: 0.045, filter: { type: 'bandpass', f: 1900, q: 1.5 }, pan });
    });
  },

  // ---------------------------------------------------------------- gas
  /** The regulator hisses: the cylinder is nearly empty. */
  gasHiss(s, t) {
    s.tone({ f: 200, f2: 150, type: 'triangle', t, a: 0.002, d: 0.05, v: 0.06 }); // the knob
    s.noise({ t: t + 0.04, d: 1.4, v: 0.09, type: 'highpass', f: 4200, f2: 5200, q: 0.6, a: 0.2 });
    s.noise({ t: t + 0.1, d: 1.1, v: 0.04, type: 'bandpass', f: 7500, q: 0.8, a: 0.2 });
  },

  /** The burners die: a whoosh and a couple of weak pops. */
  flameOut(s, t) {
    s.noise({ t, d: 0.7, v: 0.16, type: 'bandpass', f: 1500, f2: 280, q: 0.7, a: 0.02 });
    s.tone({ f: 68, from: 160, glide: 0.07, t, a: 0.004, d: 0.22, v: 0.14 });
    s.noise({ t: t + 0.1, d: 0.5, v: 0.07, type: 'lowpass', f: 520, f2: 120, a: 0.02 });
    s.tone({ f: 95, f2: 60, t: t + 0.42, a: 0.003, d: 0.08, v: 0.06 });
  },

  /** Changing the cylinder: a steel clank and the hiss of the valve (`o.phase` 'start' = unscrew, 'done' = screwed on). */
  gasClank(s, t, o = {}) {
    const done = o.phase === 'done';
    s.bell({ f: done ? 380 : 330, t, d: 0.7, v: 0.12, ratios: [1, 2.76, 5.4] });
    s.tone({ f: 170, f2: 120, type: 'triangle', t, a: 0.002, d: 0.16, v: 0.13 });
    s.noise({ t, d: 0.05, v: 0.1, type: 'bandpass', f: 2200, q: 3 });
    s.noise({ t: t + 0.18, d: 0.8, v: done ? 0.05 : 0.09, type: 'highpass', f: 3600, f2: done ? 5000 : 2800, q: 0.7, a: done ? 0.4 : 0.03 });
    s.tone({ f: 260, f2: 200, type: 'triangle', t: t + 0.55, a: 0.002, d: 0.08, v: 0.07 }); // the second knock
  },

  /** A burner relights: a soft "whoomph". `o.delay` seconds after the clank. */
  flameRelight(s, t, o = {}) {
    t += Number.isFinite(o.delay) ? o.delay : 0;
    s.tone({ f: 58, from: 125, glide: 0.1, t, a: 0.01, d: 0.34, v: 0.16 });
    s.noise({ t, d: 0.5, v: 0.12, type: 'lowpass', f: 320, f2: 1000, q: 0.7, a: 0.06 });
    s.noise({ t: t + 0.05, d: 0.6, v: 0.05, type: 'bandpass', f: 1700, q: 0.7, a: 0.12 });
  },

  // ---------------------------------------------------------------- prep (`o.kind`: batter | stone | dough | pot | tin)
  /** A prep job starts at the back counter. */
  prepStart(s, t, o = {}) {
    const pan = o.pan || 0;
    switch (o.kind) {
      case 'batter': // the soaked dal ladled into the wet grinder, the stone drum starts to turn
        s.noise({ t, d: 0.5, v: 0.08, type: 'bandpass', f: 800, f2: 1500, q: 1, a: 0.04, pan });
        for (let i = 0; i < 4; i++) s.tone({ f: 260 + i * 35, f2: 380 + i * 40, t: t + 0.05 + i * 0.12, a: 0.01, d: 0.1, v: 0.05, pan });
        s.tone({ f: 80, from: 130, glide: 0.08, t: t + 0.6, a: 0.01, d: 0.3, v: 0.1, pan });
        break;
      case 'stone': // the chutney stone: heavy thumps and a grind
        for (let i = 0; i < 3; i++) {
          s.tone({ f: 105, from: 175, glide: 0.04, t: t + i * 0.22, a: 0.002, d: 0.12, v: 0.15, pan });
          s.noise({ t: t + i * 0.22, d: 0.07, v: 0.1, type: 'lowpass', f: 800, pan });
        }
        s.noise({ t: t + 0.7, d: 0.4, v: 0.06, type: 'bandpass', f: 600, f2: 900, q: 1.2, a: 0.05, pan });
        break;
      case 'dough': // dough slapped and kneaded
        for (let i = 0; i < 3; i++) s.noise({ t: t + i * 0.2, d: 0.12, v: 0.12, type: 'lowpass', f: 480, q: 0.8, a: 0.006, pan });
        s.tone({ f: 120, f2: 90, t, a: 0.004, d: 0.15, v: 0.06, pan });
        break;
      case 'tin': // a carton torn open, a tin set down
        s.noise({ t, d: 0.3, v: 0.07, type: 'bandpass', f: 3000, f2: 1800, q: 1, a: 0.01, pan });
        s.tone({ f: 380, f2: 330, type: 'triangle', t: t + 0.3, a: 0.002, d: 0.12, v: 0.09, pan });
        break;
      default: // pot: a ladle of water into the vessel, the steel ring of a lid
        s.noise({ t, d: 0.55, v: 0.07, type: 'bandpass', f: 900, f2: 1700, q: 1.1, a: 0.05, pan });
        for (let i = 0; i < 3; i++) s.tone({ f: 300 + i * 40, f2: 440 + i * 40, t: t + 0.08 + i * 0.13, a: 0.01, d: 0.1, v: 0.045, pan });
        s.bell({ f: 520, t: t + 0.6, d: 0.5, v: 0.1, ratios: [1, 2.76, 5.4] });
    }
  },

  /** A prep job is finished: two soft dings (and the grinder winds down when it was one). */
  prepDone(s, t, o = {}) {
    const pan = o.pan || 0;
    s.bell({ f: 1397, t, d: 0.55, v: 0.12, ratios: [1, 2.0, 3.0] });
    s.bell({ f: 1865, t: t + 0.18, d: 0.8, v: 0.13, ratios: [1, 2.0, 3.0] });
    if (o.kind === 'batter') s.tone({ f: 72, f2: 24, type: 'sawtooth', t, a: 0.01, d: 0.7, v: 0.05, filter: { type: 'lowpass', f: 300, f2: 80 }, pan });
  },

  /** Scooping the finished portions onto the shelf: a ladle on steel and a plop. */
  prepCollect(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.14, v: 0.08, type: 'bandpass', f: 2700, f2: 1700, q: 1.6, a: 0.01, pan });
    s.tone({ f: 3300, t: t + 0.12, a: 0.001, d: 0.08, v: 0.06, pan });
    s.tone({ f: 150, f2: 100, t: t + 0.2, a: 0.003, d: 0.12, v: 0.1, pan });
  },

  /** A spoonful of extra chutney / sambar: a tiny spoon tink and a plop. */
  extra(s, t, o = {}) {
    const pan = o.pan || 0;
    s.tone({ f: 3400, t, a: 0.001, d: 0.06, v: 0.05, pan });
    s.tone({ f: 250, f2: 170, t: t + 0.05, a: 0.003, d: 0.07, v: 0.06, pan });
  },

  // ---------------------------------------------------------------- tending (`o.kind`: wipe | skim | water)
  tend(s, t, o = {}) {
    const pan = o.pan || 0;
    switch (o.kind) {
      case 'skim': // the kadai: a skimming ladle drawn through the oil, two clinks on the rim
        s.noise({ t, d: 0.3, v: 0.08, type: 'bandpass', f: 1900, f2: 1100, q: 1.4, a: 0.03, pan });
        s.noise({ t: t + 0.08, d: 0.5, v: 0.06, type: 'bandpass', f: 1500, f2: 900, q: 0.8, a: 0.05, pan });
        s.tone({ f: 2900, t: t + 0.34, a: 0.001, d: 0.07, v: 0.07, pan });
        s.tone({ f: 3500, t: t + 0.4, a: 0.001, d: 0.06, v: 0.05, pan });
        break;
      case 'water': // the steamer topped up: a pour, then the hiss of the hot pan
        s.noise({ t, d: 0.75, v: 0.07, type: 'bandpass', f: 800, f2: 1800, q: 1.1, a: 0.06, pan });
        for (let i = 0; i < 4; i++) s.tone({ f: 330 + i * 45, f2: 480 + i * 45, t: t + 0.06 + i * 0.15, a: 0.01, d: 0.1, v: 0.04, pan });
        s.noise({ t: t + 0.4, d: 0.6, v: 0.11, type: 'highpass', f: 4300, f2: 3300, q: 0.7, a: 0.01, pan });
        break;
      default: // wipe: the onion half dipped in oil rubbed over the tawa, a sizzle and a water sprinkle
        s.noise({ t, d: 0.35, v: 0.09, type: 'bandpass', f: 3600, f2: 1800, q: 1.2, a: 0.02, pan });
        s.noise({ t: t + 0.05, d: 0.55, v: 0.1, type: 'highpass', f: 5000, q: 0.7, a: 0.02, pan });
        s.rattle({ t: t + 0.4, d: 0.6, hits: 14, v: 0.05, f1: 4000, f2: 8000, tickV: 0.01 }); // the sprinkled drops
        s.noise({ t: t + 0.4, d: 0.35, v: 0.09, type: 'highpass', f: 6000, q: 0.7, a: 0.005, pan });
    }
  },

  // ---------------------------------------------------------------- heat warnings
  heatHot(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.7, v: 0.16, type: 'highpass', f: 5000, f2: 4000, q: 0.7, a: 0.004, pan });
    s.noise({ t, d: 0.45, v: 0.08, type: 'bandpass', f: 8200, q: 0.8, a: 0.004, pan });
    s.rattle({ t: t + 0.02, d: 0.5, hits: 16, v: 0.05, f1: 3500, f2: 7500, tickV: 0.012 });
  },
  heatCold(s, t, o = {}) {
    const pan = o.pan || 0;
    s.tone({ f: 70, from: 115, glide: 0.05, t, a: 0.004, d: 0.24, v: 0.2, pan });
    s.noise({ t, d: 0.1, v: 0.1, type: 'lowpass', f: 260, pan });
    s.tone({ f: 165, f2: 110, type: 'triangle', t: t + 0.04, a: 0.01, d: 0.3, v: 0.05, pan });
  },
  /** The steamer is dry: a hollow rattle and a sputter of steam. */
  heatDry(s, t, o = {}) {
    const pan = o.pan || 0;
    s.tone({ f: 340, f2: 300, type: 'triangle', t, a: 0.003, d: 0.3, v: 0.07, filter: { type: 'bandpass', f: 600, q: 3 }, pan });
    s.rattle({ t: t + 0.04, d: 0.4, hits: 6, v: 0.05, f1: 1200, f2: 2400, tickV: 0.02 });
    s.noise({ t: t + 0.1, d: 0.3, v: 0.05, type: 'highpass', f: 3200, q: 0.7, a: 0.03, pan });
  },

  // ---------------------------------------------------------------- stock
  /** Running low: a soft double tick. */
  stockLow(s, t) {
    [0, 0.15].forEach((dt, i) => s.tone({ f: 1250 + i * 120, type: 'triangle', t: t + dt, a: 0.001, d: 0.045, v: 0.07, filter: { type: 'lowpass', f: 3000 } }));
  },
  /** Gone: the bucket scraped empty and a hollow clang. */
  stockOut(s, t) {
    s.noise({ t, d: 0.4, v: 0.1, type: 'bandpass', f: 1700, f2: 700, q: 1.3, a: 0.03 });
    s.tone({ f: 180, f2: 130, type: 'triangle', t: t + 0.32, a: 0.002, d: 0.2, v: 0.1 });
    s.bell({ f: 290, t: t + 0.38, d: 1.1, v: 0.13, ratios: [1, 2.3, 3.7] });
  },
  /** Spoiled / sour batter: a dull "blub" (or two). `o.sour` is the lighter single one. */
  stockSpoiled(s, t, o = {}) {
    s.tone({ f: 155, from: 85, glide: 0.07, t, a: 0.005, d: 0.14, v: 0.14 });
    s.noise({ t, d: 0.15, v: 0.05, type: 'lowpass', f: 420 });
    if (!o.sour) s.tone({ f: 195, from: 105, glide: 0.07, t: t + 0.2, a: 0.005, d: 0.14, v: 0.1 });
  },

  // ---------------------------------------------------------------- the board, the till, parcels
  /** Chalk on the board: two taps and a scratch (`o.on === false`: a wipe with the cloth). */
  chalk(s, t, o = {}) {
    if (o.on === false) {
      s.noise({ t, d: 0.3, v: 0.07, type: 'bandpass', f: 2400, f2: 1500, q: 0.9, a: 0.03 });
      return;
    }
    [0, 0.1].forEach((dt, i) => {
      s.noise({ t: t + dt, d: 0.025, v: 0.12, type: 'bandpass', f: 4300 - i * 300, q: 6, a: 0.001 });
      s.tone({ f: 1700 - i * 120, t: t + dt, a: 0.001, d: 0.03, v: 0.04 });
    });
    s.noise({ t: t + 0.18, d: 0.16, v: 0.04, type: 'highpass', f: 5200, q: 0.7, a: 0.01 });
  },

  /** A runner to the market: coins counted out and the stall's hand bell shaken. */
  buy(s, t) {
    for (let i = 0; i < 5; i++) {
      const ti = t + i * 0.055;
      s.tone({ f: hz(2093, (i % 2) * 7 + Math.floor(i / 2)), type: 'square', t: ti, a: 0.001, d: 0.07, v: 0.035, filter: { type: 'bandpass', f: 4200, q: 2 } });
      s.tone({ f: hz(3136, (i % 2) * 7), t: ti, a: 0.001, d: 0.1, v: 0.06 });
    }
    s.tone({ f: 165, f2: 120, t: t + 0.3, a: 0.002, d: 0.08, v: 0.07 }); // into the money box
    [0.38, 0.45, 0.52, 0.6].forEach((dt, i) => s.bell({ f: 1760, t: t + dt, d: 0.45 + i * 0.08, v: 0.08, ratios: [1, 2.76, 5.4] }));
  },

  /** A parcel is packed: a paper bag rustles and (a big order, the delivery) foil crinkles. */
  parcel(s, t, o = {}) {
    const pan = o.pan || 0;
    [0, 0.07, 0.15, 0.22].forEach((dt, i) => s.noise({ t: t + dt, d: 0.07, v: 0.06 - i * 0.005, type: 'bandpass', f: 3800 + i * 500, q: 0.9, a: 0.004, pan }));
    s.rattle({ t: t + 0.05, d: 0.45, hits: 14, v: 0.05, f1: 3500, f2: 7000, tickV: 0.008 });
    s.noise({ t: t + 0.4, d: 0.1, v: 0.05, type: 'bandpass', f: 1500, q: 1, pan }); // the fold
    if (o.foil) {
      s.rattle({ t: t + 0.35, d: 0.6, hits: 22, v: 0.06, f1: 5500, f2: 9500, tickV: 0.015 });
      s.tone({ f: 6200, f2: 5600, type: 'triangle', t: t + 0.35, a: 0.01, d: 0.3, v: 0.012, pan });
    }
  },
};

/** One-shots the ops scheduler plays by itself. `o.v` (0..1) scales them, `o.pitch` (0..1) varies them. */
export const OPS_AMBIENT = {
  /** A raindrop dripping off the edge of the tin roof into a puddle. */
  drip(s, t, o = {}) {
    const v = 0.025 + 0.03 * (o.v ?? 1);
    const f = 1500 + (o.pitch ?? 0.5) * 1800;
    s.tone({ f, from: f * 1.5, glide: 0.025, t, a: 0.002, d: 0.06, v, pan: o.pan || 0 });
    s.noise({ t, d: 0.02, v: v * 0.5, type: 'bandpass', f: 4000, q: 3, a: 0.001, pan: o.pan || 0 });
  },
  /** The stadium on the TV or the neighbour's radio: a crowd roar that swells (a six, a wicket), a sigh after it. */
  roar(s, t, o = {}) {
    const v = 0.05 + 0.06 * (o.v ?? 1);
    s.noise({ t, d: 2.2, v, type: 'bandpass', f: 650, f2: 1050, q: 0.7, a: 1.2 });
    s.noise({ t: t + 0.3, d: 1.7, v: v * 0.55, type: 'bandpass', f: 1700, f2: 2400, q: 0.8, a: 1.0 });
    s.tone({ f: 190, f2: 230, type: 'sawtooth', t: t + 0.6, a: 0.7, d: 1.4, v: v * 0.3, filter: { type: 'bandpass', f: 800, q: 2 } }); // a few voices lifted
  },
  /** A firecracker string somewhere down the lane. */
  firecracker(s, t, o = {}) {
    const v = 0.03 + 0.03 * (o.v ?? 1);
    const pan = o.pan || 0;
    s.rattle({ t, d: 0.9, hits: 12, v: v * 1.6, f1: 1800, f2: 5200, tickV: v * 0.4, decay: 0.2 });
    s.noise({ t: t + 0.9, d: 0.1, v: v * 2, type: 'lowpass', f: 700, a: 0.002, pan }); // the big one at the end
  },
  /** A bell of a festive street: a few bright strikes. */
  bell(s, t, o = {}) {
    const v = 0.03 + 0.03 * (o.v ?? 1);
    const f = 880 + (o.pitch ?? 0.5) * 300;
    [0, 0.18, 0.33].forEach((dt, i) => s.bell({ f: f * (1 + i * 0.12), t: t + dt, d: 1.0, v, ratios: [1, 2.4, 4.1] }));
  },
};
