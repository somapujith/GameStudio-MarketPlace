// The ten horns as PURE DATA (note tables and envelopes), so they can be unit-tested; audio/horns.js turns them into sound with
// Web Audio. Every horn id of catalog.js HORNS must have an entry here. OWNER: customisation agent.
//
// A horn = { name, gain, layers: [layer] }. A layer is one voice type with a list of notes:
//   tone   { wave, lp?, bp?, vib?, am?, detune?, notes: [{ t, d, m|f, to?, g?, a?, r? }] }       sustained oscillator(s)
//   bell   { partials: [[ratio, gain]], notes: [{ t, f, g?, decay }] }                            struck metal, exponential decay
//   pluck  { notes: [{ t, m|f, to?, g?, decay, bright? }] }                                       sawtooth through a falling band-pass
//   thump  { notes: [{ t, f, to, g?, decay }] }                                                  drum body: sine with a pitch drop
//   noise  { bp: { f, q }, notes: [{ t, d, g?, a?, r?, f? }] }                                     filtered noise (breath, slaps, snares)
// Times are seconds from the start of the horn. `m` is a MIDI note (69 = A4 = 440 Hz), `f` Hz; `to` is the glide target in the same unit.

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** Pitch of a note in Hz (m wins over f). */
export const noteHz = (n) => (n.m != null ? midiToHz(n.m) : n.f);
export const noteToHz = (n) => (n.to == null ? null : n.m != null ? midiToHz(n.to) : n.to);

const RELEASE = 0.06;

export const HORN_DEFS = {
  // the classic auto "peep-peep": two short, nasal, high squawks, each sagging a little in pitch
  stock: {
    name: 'Peep-Peep',
    gain: 0.5,
    layers: [
      {
        kind: 'tone', wave: 'square', bp: { f: 1700, q: 1.6 }, lp: { f: 3200, q: 0.7 }, detune: 6,
        notes: [
          { t: 0, d: 0.1, f: 1240, to: 1110, g: 0.7, a: 0.008, r: 0.04 },
          { t: 0.17, d: 0.15, f: 1240, to: 1020, g: 0.75, a: 0.008, r: 0.06 },
        ],
      },
      { kind: 'tone', wave: 'sine', notes: [{ t: 0, d: 0.1, f: 620, to: 555, g: 0.35, a: 0.01, r: 0.04 }, { t: 0.17, d: 0.15, f: 620, to: 510, g: 0.35, a: 0.01, r: 0.06 }] },
    ],
  },

  // a double bell ding: inharmonic partials, long ring
  cycle: {
    name: 'Cycle Bell',
    gain: 0.55,
    layers: [
      {
        kind: 'bell',
        partials: [[1, 1], [2.76, 0.5], [4.1, 0.22], [5.4, 0.16]],
        notes: [
          { t: 0, f: 2250, g: 0.6, decay: 0.55 },
          { t: 0.2, f: 2250, g: 0.6, decay: 0.7 },
        ],
      },
    ],
  },

  // two-note cuckoo, repeated: a falling major third
  cuckoo: {
    name: 'Cuckoo Clock',
    gain: 0.6,
    layers: [
      {
        kind: 'tone', wave: 'sine', lp: { f: 2600, q: 0.5 },
        notes: [
          { t: 0, d: 0.17, m: 79, to: 78.6, g: 0.8, a: 0.02, r: 0.05 },
          { t: 0.26, d: 0.3, m: 75, to: 74.8, g: 0.8, a: 0.02, r: 0.07 },
          { t: 0.8, d: 0.17, m: 79, to: 78.6, g: 0.55, a: 0.02, r: 0.05 },
          { t: 1.06, d: 0.26, m: 75, to: 74.8, g: 0.55, a: 0.02, r: 0.08 },
        ],
      },
      {
        kind: 'tone', wave: 'triangle',
        notes: [
          { t: 0, d: 0.17, m: 91, g: 0.12, a: 0.02, r: 0.05 },
          { t: 0.26, d: 0.3, m: 87, g: 0.12, a: 0.02, r: 0.07 },
          { t: 0.8, d: 0.17, m: 91, g: 0.08, a: 0.02, r: 0.05 },
          { t: 1.06, d: 0.26, m: 87, g: 0.08, a: 0.02, r: 0.08 },
        ],
      },
    ],
  },

  // a traffic-police whistle: a short pip, then a long trill (the pea rattling) with breath
  whistle: {
    name: 'Traffic Whistle',
    gain: 0.45,
    layers: [
      {
        kind: 'tone', wave: 'sine', am: { rate: 30, depth: 0.55 }, vib: { rate: 6, cents: 35, delay: 0.1 },
        notes: [
          { t: 0, d: 0.1, f: 2850, g: 0.7, a: 0.012, r: 0.04 },
          { t: 0.16, d: 0.5, f: 2780, to: 2980, g: 0.75, a: 0.02, r: 0.08 },
        ],
      },
      {
        kind: 'noise', bp: { f: 3100, q: 3 },
        notes: [{ t: 0, d: 0.1, g: 0.1, a: 0.01, r: 0.04 }, { t: 0.16, d: 0.5, g: 0.12, a: 0.02, r: 0.08 }],
      },
    ],
  },

  // an ORIGINAL short filmy hook in a minor, raga-flavoured scale (D E-flat F G A B-flat C): fast climb, ornamented fall
  filmy: {
    name: 'Filmy Tune',
    gain: 0.5,
    layers: [
      {
        kind: 'tone', wave: 'sawtooth', lp: { f: 3400, q: 0.9, from: 900, tc: 0.03 }, detune: 9, vib: { rate: 5.5, cents: 14, delay: 0.1 },
        notes: [
          { t: 0, d: 0.09, m: 74, g: 0.6, a: 0.008, r: 0.04 },
          { t: 0.12, d: 0.09, m: 77, g: 0.6, a: 0.008, r: 0.04 },
          { t: 0.24, d: 0.09, m: 79, g: 0.62, a: 0.008, r: 0.04 },
          { t: 0.36, d: 0.2, m: 81, g: 0.7, a: 0.008, r: 0.06 },
          { t: 0.6, d: 0.09, m: 79, g: 0.6, a: 0.008, r: 0.04 },
          { t: 0.72, d: 0.09, m: 77, g: 0.6, a: 0.008, r: 0.04 },
          { t: 0.84, d: 0.1, m: 75, g: 0.6, a: 0.008, r: 0.04 },
          { t: 0.96, d: 0.36, m: 75, to: 74, g: 0.7, a: 0.008, r: 0.1 },
        ],
      },
      {
        kind: 'tone', wave: 'triangle',
        notes: [
          { t: 0, d: 0.09, m: 62, g: 0.35, a: 0.008, r: 0.04 },
          { t: 0.36, d: 0.2, m: 69, g: 0.3, a: 0.008, r: 0.06 },
          { t: 0.96, d: 0.36, m: 62, g: 0.4, a: 0.01, r: 0.1 },
        ],
      },
      { kind: 'thump', notes: [{ t: 0, f: 140, to: 60, g: 0.5, decay: 0.16 }, { t: 0.96, f: 130, to: 55, g: 0.55, decay: 0.2 }] },
    ],
  },

  // a truck air horn: two brassy tones a major third apart, a hard start with a small pitch sag, then steady
  airhorn: {
    name: 'Truck Air Horn',
    gain: 0.5,
    layers: [
      {
        kind: 'tone', wave: 'sawtooth', lp: { f: 1700, q: 0.8, from: 3200, tc: 0.08 }, detune: 5,
        notes: [
          { t: 0, d: 0.85, f: 372, to: 360, g: 0.55, a: 0.012, r: 0.12 },
          { t: 0, d: 0.85, f: 468, to: 453, g: 0.5, a: 0.012, r: 0.12 },
        ],
      },
      { kind: 'tone', wave: 'square', lp: { f: 900, q: 0.6 }, notes: [{ t: 0, d: 0.85, f: 186, g: 0.25, a: 0.02, r: 0.12 }] },
      { kind: 'noise', bp: { f: 1400, q: 0.8 }, notes: [{ t: 0, d: 0.1, g: 0.08, a: 0.005, r: 0.08 }] },
    ],
  },

  // a shehnai: a nasal double reed gliding between notes over a sa-pa drone
  shehnai: {
    name: 'Shehnai',
    gain: 0.5,
    layers: [
      {
        kind: 'tone', wave: 'sawtooth', bp: { f: 1500, q: 2.6 }, lp: { f: 3600, q: 0.7 }, detune: 11, vib: { rate: 5.4, cents: 22, delay: 0.25 },
        notes: [
          { t: 0, d: 0.5, m: 67, to: 70, g: 0.7, a: 0.07, r: 0.08 },
          { t: 0.56, d: 0.7, m: 72, to: 70, g: 0.75, a: 0.05, r: 0.2 },
        ],
      },
      {
        kind: 'tone', wave: 'sawtooth', lp: { f: 520, q: 0.5 },
        notes: [{ t: 0, d: 1.2, m: 43, g: 0.22, a: 0.1, r: 0.2 }, { t: 0, d: 1.2, m: 50, g: 0.14, a: 0.1, r: 0.2 }],
      },
      { kind: 'noise', bp: { f: 2200, q: 1.2 }, notes: [{ t: 0, d: 0.5, g: 0.04, a: 0.06, r: 0.1 }, { t: 0.56, d: 0.7, g: 0.04, a: 0.05, r: 0.2 }] },
    ],
  },

  // a plucked sitar: bright attack, a falling band-pass twang, a meend (slide), and sympathetic strings ringing
  sitar: {
    name: 'Sitar Twang',
    gain: 0.6,
    layers: [
      {
        kind: 'pluck',
        notes: [
          { t: 0, m: 62, g: 0.8, decay: 0.8, bright: 1 },
          { t: 0.22, m: 67, g: 0.7, decay: 0.7, bright: 0.9 },
          { t: 0.42, m: 69, to: 71, g: 0.8, decay: 0.95, bright: 1 },
        ],
      },
      {
        kind: 'tone', wave: 'sine',
        notes: [
          { t: 0.05, d: 1.0, m: 74, g: 0.07, a: 0.2, r: 0.2 },
          { t: 0.05, d: 1.0, m: 81, g: 0.05, a: 0.25, r: 0.2 },
        ],
      },
    ],
  },

  // a two-hand dholak pattern: bass (bayan) and treble (dayan) strokes with slaps
  dholak: {
    name: 'Dholak Beat',
    gain: 0.75,
    layers: [
      {
        kind: 'thump',
        notes: [
          { t: 0, f: 190, to: 68, g: 0.9, decay: 0.28 },
          { t: 0.3, f: 170, to: 66, g: 0.75, decay: 0.24 },
          { t: 0.5, f: 170, to: 66, g: 0.85, decay: 0.26 },
          { t: 0.9, f: 200, to: 64, g: 0.95, decay: 0.34 },
          { t: 1.0, f: 600, to: 330, g: 0.5, decay: 0.1 },
        ],
      },
      {
        kind: 'thump',
        notes: [
          { t: 0.15, f: 520, to: 340, g: 0.5, decay: 0.09 },
          { t: 0.62, f: 540, to: 350, g: 0.5, decay: 0.09 },
          { t: 0.74, f: 520, to: 330, g: 0.5, decay: 0.09 },
        ],
      },
      {
        kind: 'noise', bp: { f: 2600, q: 1.3 },
        notes: [
          { t: 0, d: 0.03, g: 0.3, a: 0.002, r: 0.03 },
          { t: 0.15, d: 0.03, g: 0.28, a: 0.002, r: 0.03 },
          { t: 0.3, d: 0.03, g: 0.25, a: 0.002, r: 0.03 },
          { t: 0.5, d: 0.03, g: 0.3, a: 0.002, r: 0.03 },
          { t: 0.62, d: 0.03, g: 0.22, a: 0.002, r: 0.03 },
          { t: 0.74, d: 0.03, g: 0.22, a: 0.002, r: 0.03 },
          { t: 0.9, d: 0.04, g: 0.34, a: 0.002, r: 0.04 },
        ],
      },
    ],
  },

  // a baraat band fanfare: three brass chord hits (short, short, long) over a bass drum and a snare
  baraat: {
    name: 'Baraat Brass',
    gain: 0.5,
    layers: [
      {
        kind: 'tone', wave: 'sawtooth', lp: { f: 2600, q: 0.8, from: 500, tc: 0.05 }, detune: 8, vib: { rate: 5.2, cents: 10, delay: 0.3 },
        notes: [
          { t: 0, d: 0.12, m: 62, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0, d: 0.12, m: 67, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0, d: 0.12, m: 71, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0.18, d: 0.12, m: 62, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0.18, d: 0.12, m: 67, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0.18, d: 0.12, m: 71, g: 0.38, a: 0.01, r: 0.05 },
          { t: 0.38, d: 0.6, m: 64, g: 0.42, a: 0.012, r: 0.14 },
          { t: 0.38, d: 0.6, m: 69, g: 0.42, a: 0.012, r: 0.14 },
          { t: 0.38, d: 0.6, m: 72, g: 0.42, a: 0.012, r: 0.14 },
        ],
      },
      { kind: 'tone', wave: 'triangle', notes: [{ t: 0, d: 0.12, m: 50, g: 0.4, a: 0.01, r: 0.05 }, { t: 0.18, d: 0.12, m: 50, g: 0.4, a: 0.01, r: 0.05 }, { t: 0.38, d: 0.6, m: 52, g: 0.4, a: 0.012, r: 0.14 }] },
      { kind: 'thump', notes: [{ t: 0, f: 120, to: 50, g: 0.8, decay: 0.2 }, { t: 0.38, f: 120, to: 48, g: 0.9, decay: 0.3 }] },
      { kind: 'noise', bp: { f: 1900, q: 0.9 }, notes: [{ t: 0.18, d: 0.05, g: 0.25, a: 0.002, r: 0.06 }, { t: 0.38, d: 0.06, g: 0.3, a: 0.002, r: 0.08 }] },
    ],
  },
};

/** The definition for an id; unknown / missing ids give the stock horn (never throws). */
export function getHornDef(id) {
  return Object.prototype.hasOwnProperty.call(HORN_DEFS, id) ? HORN_DEFS[id] : HORN_DEFS.stock;
}

/** The id that would really play for `id` (stock for unknown ids). */
export const resolveHornId = (id) => (Object.prototype.hasOwnProperty.call(HORN_DEFS, id) ? id : 'stock');

/** When a note stops sounding (end of release / decay), in seconds from the horn start. */
export function noteEnd(layer, n) {
  switch (layer.kind) {
    case 'bell':
    case 'pluck':
    case 'thump':
      return n.t + (n.decay ?? 0.3);
    case 'noise':
    case 'tone':
    default:
      return n.t + (n.d ?? 0.1) + (n.r ?? RELEASE);
  }
}

/** Total length of a horn in seconds. */
export function hornDuration(def) {
  let end = 0;
  for (const l of def.layers) for (const n of l.notes) end = Math.max(end, noteEnd(l, n));
  return end;
}

/** Every pitch (Hz) a horn uses, for range checks. */
export function hornFrequencies(def) {
  const out = [];
  for (const l of def.layers) {
    if (l.bp) out.push(l.bp.f);
    for (const n of l.notes) {
      if (n.m != null || n.f != null) out.push(noteHz(n));
      if (n.to != null) out.push(noteToHz(n));
    }
    if (l.kind === 'bell') for (const n of l.notes) for (const [r] of l.partials) out.push(n.f * r);
  }
  return out;
}
