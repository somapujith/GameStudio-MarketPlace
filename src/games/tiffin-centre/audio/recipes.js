// Tiffin Centre audio: the sound RECIPES. Each one is `(synth, t, opts)`: it schedules a few oscillators / filtered-noise bursts
// on a createSynth() (src/lib/soundscape/synth.js) starting at the absolute context time `t`. No files, no samples.
// `opts.pan` places a sound in the stall (-0.7 left .. 0.7 right). Every sound is short (the fanfare is the longest, ~2.5 s).

import { fanfarePlan, semisToHz } from './score.js';

const hz = (base, semis = 0) => base * 2 ** (semis / 12);

/** One tabla-style stroke made from synthesis: a pitched skin tone plus a short noise "slap". */
export function tabla(s, t, kind, v = 0.1, pan = 0) {
  switch (kind) {
    case 'dha': // both drums: the bayan boom with a bright na on top
      s.tone({ f: 92, from: 150, glide: 0.05, t, a: 0.003, d: 0.3, v: v * 1.3, pan });
      s.tone({ f: 420, type: 'triangle', t, a: 0.002, d: 0.08, v: v * 0.45, pan });
      s.noise({ t, d: 0.05, v: v * 0.55, type: 'bandpass', f: 1900, q: 3, pan });
      break;
    case 'ge': // the bayan alone
      s.tone({ f: 88, from: 140, glide: 0.06, t, a: 0.003, d: 0.24, v: v * 1.15, pan });
      break;
    case 'na': // the rim of the dayan: a clean ring
      s.tone({ f: 780, t, a: 0.002, d: 0.1, v: v * 0.7, pan });
      s.noise({ t, d: 0.035, v: v * 0.5, type: 'bandpass', f: 3400, q: 5, pan });
      break;
    case 'tin': // an open, ringing dayan stroke
      s.tone({ f: 1010, f2: 960, t, a: 0.002, d: 0.2, v: v * 0.6, pan });
      s.noise({ t, d: 0.03, v: v * 0.4, type: 'bandpass', f: 4000, q: 4, pan });
      break;
    default: // 'ti': a closed little tap
      s.noise({ t, d: 0.03, v: v * 0.5, type: 'bandpass', f: 4300, q: 6, pan });
      s.tone({ f: 1300, t, a: 0.002, d: 0.04, v: v * 0.3, pan });
  }
}

export const RECIPES = {
  /**
   * A dish goes on: the work sound of the station, then its cooking voice.
   * tawa = ladle scrape + hiss, steamer = lid clank + steam, kadai = batter splash + oil crackle, chai = the long Irani pour (glug glug).
   */
  sizzle(s, t, o = {}) {
    const pan = o.pan || 0;
    switch (o.kind) {
      case 'kadai':
        s.noise({ t, d: 0.16, v: 0.13, type: 'bandpass', f: 600, f2: 2600, q: 0.8, a: 0.006, pan }); // the splash
        s.tone({ f: 90, from: 180, glide: 0.06, t, a: 0.004, d: 0.14, v: 0.09, pan });
        s.noise({ t: t + 0.1, d: 1.0, v: 0.1, type: 'bandpass', f: 1900, f2: 1100, q: 0.6, a: 0.04, pan });
        s.rattle({ t: t + 0.1, d: 0.9, hits: 22, v: 0.08, f1: 1500, f2: 4200, tickV: 0.012 });
        break;
      case 'steamer':
        s.tone({ f: 1250, f2: 1180, type: 'triangle', t, a: 0.001, d: 0.12, v: 0.07, pan }); // the lid clank
        s.tone({ f: 523, f2: 500, type: 'square', t, a: 0.001, d: 0.06, v: 0.04, filter: { type: 'bandpass', f: 900, q: 3 }, pan });
        s.noise({ t: t + 0.08, d: 0.7, v: 0.08, type: 'bandpass', f: 1300, f2: 2800, q: 0.8, a: 0.12, pan }); // steam
        break;
      case 'chai': {
        // the long high pour between two vessels: a stream of noise with a run of rising glugs
        s.noise({ t, d: 1.15, v: 0.06, type: 'bandpass', f: 900, f2: 1700, q: 1.2, a: 0.08, pan });
        for (let i = 0; i < 6; i++) {
          const f = 300 + i * 40;
          s.tone({ f, f2: f * 1.5, t: t + 0.08 + i * 0.17, a: 0.01, d: 0.12, v: 0.05, pan });
        }
        break;
      }
      default: // tawa
        s.noise({ t, d: 0.2, v: 0.08, type: 'bandpass', f: 2600, f2: 1100, q: 1.5, a: 0.01, pan }); // the ladle scrape
        s.noise({ t: t + 0.12, d: 0.85, v: 0.13, type: 'highpass', f: 3600, f2: 2800, q: 0.7, a: 0.015, pan });
        s.noise({ t: t + 0.12, d: 0.55, v: 0.07, type: 'bandpass', f: 7000, q: 0.7, a: 0.02, pan });
        s.rattle({ t: t + 0.12, d: 0.6, hits: 9, v: 0.05, f1: 3000, f2: 6000, tickV: 0.008 });
    }
  },

  /** A dish is ready: a soft bell, a touch different per station. */
  ding(s, t, o = {}) {
    const f = { tawa: 1175, kadai: 988, steamer: 1319, chai: 1480 }[o.kind] || 1175;
    s.bell({ f, t, d: 1.0, v: 0.2, ratios: [1, 2.0, 3.0] });
  },

  /** Burnt: a low buzz and a hiss of smoke. */
  burnt(s, t, o = {}) {
    const pan = o.pan || 0;
    s.tone({ f: 96, f2: 80, type: 'sawtooth', t, a: 0.01, d: 0.4, v: 0.13, filter: { type: 'lowpass', f: 520 }, pan });
    s.tone({ f: 92, f2: 74, type: 'sawtooth', t: t + 0.2, a: 0.01, d: 0.4, v: 0.1, filter: { type: 'lowpass', f: 480 }, pan });
    s.noise({ t, d: 0.85, v: 0.08, type: 'highpass', f: 2600, q: 0.7, a: 0.03, pan });
  },

  /** Clearing a burnt dish: a scrape and a thunk into the bin. */
  scrape(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.18, v: 0.09, type: 'bandpass', f: 2300, f2: 1400, q: 2, a: 0.01, pan });
    s.tone({ f: 160, f2: 100, t: t + 0.15, a: 0.003, d: 0.1, v: 0.1, pan });
  },

  /** Picking a plate up: a slide on steel, then a ceramic clink. */
  take(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.13, v: 0.05, type: 'bandpass', f: 3200, f2: 1900, q: 1.5, a: 0.02, pan }); // the plate slides on the steel
    t += 0.1;
    s.noise({ t, d: 0.04, v: 0.12, type: 'bandpass', f: 5200, q: 8, pan });
    s.tone({ f: 3100, t, a: 0.001, d: 0.1, v: 0.09, pan });
    s.tone({ f: 4200, t: t + 0.035, a: 0.001, d: 0.07, v: 0.055, pan });
  },

  /** Putting a plate in front of a customer: a set-down thunk and a small clink. */
  serve(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.16, v: 0.06, type: 'bandpass', f: 2600, f2: 1500, q: 1.5, a: 0.02, pan }); // slid across the steel counter
    t += 0.14;
    s.tone({ f: 120, from: 210, glide: 0.05, t, a: 0.003, d: 0.11, v: 0.16, pan });
    s.noise({ t, d: 0.05, v: 0.1, type: 'lowpass', f: 900, pan });
    s.tone({ f: 2800, t: t + 0.03, a: 0.001, d: 0.08, v: 0.07, pan });
  },

  /** A customer walks up: the counter bell, "kring": two quick strikes, bright and clearly not the ready ding. */
  kring(s, t, o = {}) {
    const pan = o.pan || 0;
    s.bell({ f: 2349, t, d: 0.5, v: 0.17, ratios: [1, 2.76, 5.4] });
    s.bell({ f: 2349, t: t + 0.085, d: 0.65, v: 0.2, ratios: [1, 2.76, 5.4] });
    s.noise({ t, d: 0.03, v: 0.06, type: 'bandpass', f: 5000, q: 4, pan });
  },

  /** Turned away: a quiet, small "mm". */
  turnaway(s, t, o = {}) {
    s.tone({ f: 220, from: 300, glide: 0.12, type: 'triangle', t, a: 0.02, d: 0.2, v: 0.05, pan: o.pan || 0 });
  },

  /** Eating: a brief murmur, three soft formant bursts. */
  eat(s, t, o = {}) {
    const pan = o.pan || 0;
    [520, 610, 470].forEach((f, i) => {
      s.noise({ t: t + i * 0.17, d: 0.1, v: 0.06, type: 'bandpass', f, q: 4, a: 0.015, pan });
      s.tone({ f: 150 + i * 12, type: 'triangle', t: t + i * 0.17, a: 0.02, d: 0.09, v: 0.025, pan });
    });
  },

  /** Money is out: the till drawer and a rising two-note "ka-ching". */
  payReady(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.04, v: 0.1, type: 'bandpass', f: 3500, q: 2, pan });
    s.bell({ f: 1568, t: t + 0.03, d: 0.35, v: 0.16, ratios: [1, 2.0, 2.76] });
    s.bell({ f: 2349, t: t + 0.13, d: 0.6, v: 0.18, ratios: [1, 2.0, 2.76] });
  },

  /** The money is about to be lost: urgent ticking beeps. */
  payWarning(s, t, o = {}) {
    const pan = o.pan || 0;
    [[0, 1568], [0.12, 1568], [0.24, 1976]].forEach(([dt, f]) => {
      s.tone({ f, type: 'square', t: t + dt, a: 0.002, d: 0.06, v: 0.065, filter: { type: 'lowpass', f: 3600 }, pan });
    });
  },

  /**
   * Collecting money: a coin jingle. `tier` (0 small, 1 middle, 2 big) sets how many coins and whether a till bell closes it;
   * `steps` is the combo ladder, in semitones, so a streak climbs.
   */
  collect(s, t, o = {}) {
    const pan = o.pan || 0;
    const tier = Math.max(0, Math.min(2, o.tier | 0));
    const steps = o.steps || 0;
    const coins = [3, 5, 8][tier];
    const gap = [0.06, 0.055, 0.05][tier];
    // the note rustles as it is taken
    for (let i = 0; i < 3; i++) s.noise({ t: t + i * 0.035, d: 0.03, v: 0.05, type: 'highpass', f: 5500 + i * 700, q: 0.7, a: 0.004, pan });
    t += 0.1;
    for (let i = 0; i < coins; i++) {
      const ti = t + i * gap;
      const f = hz(2093, steps + (i % 2) * 7 + Math.floor(i / 2));
      const v = 0.07 + 0.012 * tier;
      s.tone({ f, type: 'square', t: ti, a: 0.001, d: 0.08, v: v * 0.5, filter: { type: 'bandpass', f: 4200, q: 2 }, pan });
      s.tone({ f: f * 1.5, t: ti, a: 0.001, d: 0.12, v, pan });
    }
    // ...and the coin goes into the money box (gallaa): a tink and a dull drop
    const tm = t + coins * gap + 0.04;
    s.tone({ f: hz(2637, steps), t: tm, a: 0.001, d: 0.12, v: 0.06, pan });
    s.tone({ f: 170, f2: 120, t: tm + 0.02, a: 0.002, d: 0.08, v: 0.07, pan });
    if (tier >= 1) s.noise({ t, d: 0.2 + 0.1 * tier, v: 0.04 + 0.02 * tier, type: 'highpass', f: 5500, q: 0.6, a: 0.01, pan });
    if (tier >= 2) {
      const tb = t + coins * gap + 0.12;
      s.bell({ f: hz(1319, steps), t: tb, d: 0.9, v: 0.2, ratios: [1, 2.0, 3.0] });
      s.tone({ f: hz(659, steps), type: 'triangle', t: tb, a: 0.004, d: 0.5, v: 0.1, pan });
    }
  },

  /** An angry customer: a "hmph", a breath out and a short low formant sweep. */
  angry(s, t, o = {}) {
    const pan = o.pan || 0;
    s.noise({ t, d: 0.09, v: 0.08, type: 'bandpass', f: 1500, q: 1, pan });
    s.tone({ f: 118, f2: 82, type: 'sawtooth', t: t + 0.04, a: 0.02, d: 0.36, v: 0.15, filter: { type: 'bandpass', f: 900, f2: 380, q: 3 }, pan });
    s.tone({ f: 108, f2: 90, type: 'sawtooth', t: t + 0.44, a: 0.01, d: 0.14, v: 0.08, filter: { type: 'bandpass', f: 600, f2: 400, q: 3 }, pan });
  },

  /** Left without paying: a sad falling phrase, then shuffling feet. */
  unpaid(s, t, o = {}) {
    const pan = o.pan || 0;
    [[0, 330], [0.2, 294], [0.4, 247]].forEach(([dt, f], i) => {
      s.tone({ f, f2: f * 0.97, type: 'triangle', t: t + dt, a: 0.01, d: i === 2 ? 0.5 : 0.22, v: 0.12, pan });
    });
    s.rattle({ t: t + 0.55, d: 0.6, hits: 8, v: 0.05, f1: 900, f2: 1700, tickV: 0.01 });
  },

  /** Slippers on the footpath: soft taps at `o.times` (seconds from the start), alternating a little in tone. */
  steps(s, t, o = {}) {
    const pan = o.pan || 0;
    (o.times || [0]).forEach((dt, i) => {
      const alt = i % 2 ? 1.12 : 1;
      s.noise({ t: t + dt, d: 0.04, v: 0.05, type: 'bandpass', f: 1300 * alt, q: 1.4, a: 0.002, pan });
      s.tone({ f: 170 * alt, from: 230 * alt, glide: 0.03, t: t + dt, a: 0.002, d: 0.045, v: 0.04, pan });
    });
  },

  /** Throwing a dish away: a swoosh into the bin. */
  discard(s, t) {
    s.noise({ t, d: 0.2, v: 0.08, type: 'bandpass', f: 1800, f2: 420, q: 1.2, a: 0.01 });
    s.tone({ f: 130, f2: 90, t: t + 0.17, a: 0.003, d: 0.1, v: 0.1 });
  },

  /** A heart lost: a low thud. */
  lifeLost(s, t) {
    s.tone({ f: 48, from: 125, glide: 0.07, t, a: 0.004, d: 0.4, v: 0.32 });
    s.noise({ t, d: 0.12, v: 0.15, type: 'lowpass', f: 320 });
    s.tone({ f: 70, f2: 55, type: 'triangle', t: t + 0.12, a: 0.02, d: 0.45, v: 0.07 });
  },

  /** A combo: a quick pentatonic sparkle that climbs with the streak. */
  combo(s, t, o = {}) {
    const steps = o.steps || 0;
    [0, 2, 4, 7, 9].forEach((semi, i) => {
      s.tone({ f: hz(1568, steps + semi), t: t + i * 0.045, a: 0.002, d: 0.22, v: 0.06 });
    });
  },

  /** A teammate's emote: a pop, shaped a little per emote. */
  emote(s, t, o = {}) {
    const base = { thumbs: 560, fire: 700, help: 420, thanks: 620 }[o.e] || 560;
    s.tone({ f: base * 1.8, from: base * 0.8, glide: 0.05, t, a: 0.002, d: 0.09, v: 0.14 });
    s.noise({ t, d: 0.02, v: 0.05, type: 'bandpass', f: 3000, q: 2 });
    if (o.e === 'thanks') s.bell({ f: 1319, t: t + 0.08, d: 0.4, v: 0.08, ratios: [1, 2.0] });
    if (o.e === 'help') s.tone({ f: base * 1.4, t: t + 0.12, a: 0.002, d: 0.08, v: 0.12 });
    if (o.e === 'fire') s.rattle({ t: t + 0.06, d: 0.2, hits: 6, v: 0.04, tickV: 0.005 });
  },

  /** The shift is over and the stall did well: a Hyderabadi-flavoured pentatonic phrase over tabla. 1..3 stars = a longer finish. */
  fanfare(s, t, o = {}) {
    const plan = fanfarePlan({ win: true, stars: o.stars || 1 });
    playPlan(s, t, plan);
  },

  /** The centre closed: a minor sigh. */
  closed(s, t) {
    playPlan(s, t, fanfarePlan({ win: false }));
  },
};

function playPlan(s, t, plan) {
  for (const n of plan.notes) {
    const f = semisToHz(n.semis);
    s.tone({ f, f2: n.bend ? semisToHz(n.semis + n.bend) : undefined, type: n.type, t: t + n.t, a: 0.008, d: n.d, v: n.v });
  }
  for (const h of plan.hits) tabla(s, t + h.t, h.kind, h.v);
}

/** Sporadic one-shots of the ambience (birds, a temple bell, a pressure cooker, auto horns, dogs). `o.v` scales the level (0..1). */
export const AMBIENT_RECIPES = {
  birds(s, t, o = {}) {
    const pan = o.pan || 0;
    const v = 0.03 + 0.03 * (o.v ?? 1);
    const base = 2800 + (o.pitch ?? 0) * 1400; // a few different birds
    const n = 2 + ((o.pitch ?? 0) > 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      s.tone({ f: base * (1 + 0.18 * i), from: base * (0.85 + 0.1 * i), glide: 0.05, t: t + i * 0.11, a: 0.005, d: 0.09, v, pan });
    }
  },
  temple(s, t, o = {}) {
    s.bell({ f: 622, t, d: 2.6, v: 0.04 + 0.03 * (o.v ?? 1), ratios: [1, 2.4, 4.1] });
  },
  cooker(s, t, o = {}) {
    // the pressure-cooker whistle: a thin, wobbly high tone with a puff of steam
    const v = 0.03 + 0.03 * (o.v ?? 1);
    s.tone({ f: 2500, f2: 2380, type: 'sine', t, a: 0.08, hold: 0.9, d: 0.3, v, vib: { rate: 7, depth: 35, delay: 0.1 }, pan: o.pan || 0 });
    s.noise({ t, d: 1.3, v: v * 0.6, type: 'highpass', f: 3500, q: 0.6, a: 0.1, pan: o.pan || 0 });
  },
  autos(s, t, o = {}) {
    // the cartoon-ish two-tone auto horn: "pee-pooo", a short high note then a longer low one, with a little wobble
    const v = 0.025 + 0.03 * (o.v ?? 1);
    const pan = o.pan || 0;
    [[0, 520, 0.14], [0.17, 390, 0.28]].forEach(([dt, f, d]) => {
      s.tone({ f, f2: f * 0.97, type: 'square', t: t + dt, a: 0.008, d, v, filter: { type: 'bandpass', f: f * 2, q: 1.5 }, vib: { rate: 9, depth: 20, delay: 0.02 }, pan });
      s.tone({ f: f * 1.5, type: 'square', t: t + dt, a: 0.008, d, v: v * 0.45, filter: { type: 'bandpass', f: f * 3, q: 1.5 }, pan });
    });
  },
  scooter(s, t, o = {}) {
    // a scooter passing: the engine buzz rises as it comes and falls as it goes, and it crosses from one side to the other
    const v = 0.03 + 0.03 * (o.v ?? 1);
    const side = (o.pan || 0) >= 0 ? 1 : -1;
    const f = { type: 'lowpass', f: 650, q: 1 };
    s.tone({ f: 175, from: 105, glide: 0.8, type: 'sawtooth', t, a: 0.5, d: 0.35, v, filter: f, pan: -0.6 * side });
    s.tone({ f: 88, from: 170, glide: 0.9, type: 'sawtooth', t: t + 0.85, a: 0.02, d: 0.85, v: v * 0.9, filter: f, pan: 0.6 * side });
    s.noise({ t, d: 1.7, v: v * 0.5, type: 'bandpass', f: 500, q: 0.7, a: 0.6, pan: 0 });
  },
  hawkers(s, t, o = {}) {
    // a distant hawker's call: formant babble, no words. A voiced saw through two formants per syllable, far away so dull and low.
    const v = 0.022 + 0.02 * (o.v ?? 1);
    const pan = o.pan || 0;
    const pitch = 120 + (o.pitch ?? 0) * 60;
    const n = 4 + Math.round((o.pitch ?? 0) * 2);
    const F = [[700, 1200], [500, 1800], [420, 900], [650, 1500]]; // /a/ /e/ /o/ /ae/-ish
    for (let i = 0; i < n; i++) {
      const [f1, f2] = F[(i * 3 + Math.round((o.pitch ?? 0) * 10)) % F.length];
      const ti = t + i * 0.2;
      const last = i === n - 1;
      const d = last ? 0.38 : 0.13;
      const p = pitch * (last ? 0.85 : 1 + 0.06 * (i % 3));
      s.tone({ f: p, f2: p * (last ? 0.8 : 1), type: 'sawtooth', t: ti, a: 0.02, d, v, filter: { type: 'bandpass', f: f1, q: 5 }, pan });
      s.tone({ f: p, f2: p * (last ? 0.8 : 1), type: 'sawtooth', t: ti, a: 0.02, d, v: v * 0.5, filter: { type: 'bandpass', f: f2, q: 6 }, pan });
    }
  },
  plates(s, t, o = {}) {
    // steel plates clattering somewhere down the street: a quick scatter of metallic clinks
    const v = 0.02 + 0.02 * (o.v ?? 1);
    const pan = o.pan || 0;
    [0, 0.07, 0.12, 0.2, 0.27, 0.4].forEach((dt, i) => {
      const f = 2300 + ((i * 937) % 2400);
      s.tone({ f, f2: f * 0.99, type: 'triangle', t: t + dt, a: 0.001, d: 0.09, v: v * (1 - i * 0.1), pan });
      s.noise({ t: t + dt, d: 0.03, v: v * 0.8, type: 'bandpass', f: f * 1.5, q: 5, pan });
    });
  },
  dogs(s, t, o = {}) {
    // a dog barking at dusk, far away: one or two bark-ish blips
    const v = 0.03 + 0.03 * (o.v ?? 1);
    const pan = o.pan || 0;
    const n = (o.pitch ?? 0) > 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      s.tone({ f: 230, from: 420, glide: 0.07, type: 'sawtooth', t: t + i * 0.28, a: 0.01, d: 0.1, v, filter: { type: 'lowpass', f: 900 }, pan });
    }
  },
};
