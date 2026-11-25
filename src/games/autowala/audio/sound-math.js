// OWNER: sound agent. The pure maths behind the engine, tyre, ambience and radio sounds. No Web Audio in here, so every mapping can be
// unit-tested (sound-math.test.js). All "out" objects are reused by the callers: nothing here allocates per call.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** 0 below `a`, 1 above `b`, smooth between. */
export const ramp = (v, a, b) => smooth((v - a) / (b - a));
/** semitone (MIDI number) -> Hz */
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---------------------------------------------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------------------------------------------
export const RPM_IDLE = 950;
export const RPM_MAX = 4600;
/** Speed (km/h) at which each gear of the (imaginary) four-speed box ends. Gear 1 is 0..13, gear 2 is 13..27, ... */
export const GEAR_KMH = [0, 13, 27, 44, 72];

/** Which gear (0-based) the auto is in at this speed. */
export function gearAt(kmh) {
  const k = Math.abs(num(kmh));
  for (let g = 0; g < GEAR_KMH.length - 2; g++) if (k < GEAR_KMH[g + 1]) return g;
  return GEAR_KMH.length - 2;
}

/**
 * Engine revs for a speed and throttle. Within a gear the revs climb with speed; shifting up drops them (the audible
 * "putt-putt-putt, putt-putt" of a rickshaw). Pulling away in first with the pedal down revs higher than coasting.
 * `boosting` adds a push, `airborne` lets the wheels go light so the engine races.
 */
export function engineRpm(kmh, throttle = 0, boosting = false, airborne = false) {
  const k = Math.abs(num(kmh));
  const th = clamp01(num(throttle));
  const g = gearAt(k);
  const lo = GEAR_KMH[g];
  const hi = GEAR_KMH[g + 1];
  const t = clamp01((k - lo) / (hi - lo));
  const base = g === 0 ? 0 : 0.36; // after an upshift the revs fall back to here
  const frac = base + (1 - base) * t * 0.92;
  let rpm = RPM_IDLE + (RPM_MAX - RPM_IDLE) * frac * 0.9 + th * 650 * (1 - frac);
  if (boosting) rpm += 380;
  if (airborne) rpm = Math.max(rpm, RPM_IDLE + (RPM_MAX - RPM_IDLE) * (0.28 + 0.6 * th));
  return clamp(rpm, RPM_IDLE, RPM_MAX + 450);
}

/** Firing rate (Hz). A single-cylinder two-stroke-ish putter fires once every other revolution: idle ~8 Hz, flat out ~39 Hz. */
export const pulseHz = (rpm) => num(rpm) / 120;
export const rpm01 = (rpm) => clamp01((num(rpm) - RPM_IDLE) / (RPM_MAX - RPM_IDLE));

/**
 * Everything the engine voice needs for one frame. `m`: { kmh, throttle, boosting, airborne, hold, fuel, rpm }. Writes into `out`:
 * { hz (pulse rate), gain (overall), lp (lowpass Hz), sub (body osc gain), rattle (noise gain), whineHz, whineGain, rpm }.
 * Silent when a menu holds the auto, when the tank is empty, and low (but not silent) at a standstill.
 */
export function engineMix(m, out) {
  const rpm = m.rpm ?? engineRpm(m.kmh, m.throttle, m.boosting, m.airborne);
  const r = rpm01(rpm);
  const th = clamp01(num(m.throttle));
  out.rpm = rpm;
  out.hz = pulseHz(rpm);
  const live = m.hold || !(num(m.fuel, 1) > 0) ? 0 : 1;
  out.gain = live * (0.1 + 0.07 * th + 0.05 * r + (m.boosting ? 0.03 : 0));
  out.lp = 240 + 1500 * r + 520 * th;
  out.sub = 0.7 + 0.3 * (1 - r);
  out.rattle = live * (0.015 + 0.05 * th * r);
  out.whineGain = live && m.boosting ? 0.035 : 0;
  out.whineHz = 1500 + 28 * Math.abs(num(m.kmh));
  return out;
}

/** True once when the pedal is lifted at speed (the exhaust crackles). `prev` and `now` are throttle 0..1. */
export const liftOff = (prev, now, kmh) => prev > 0.5 && now < 0.15 && Math.abs(num(kmh)) > 14;

// ---------------------------------------------------------------------------------------------------------------------------------
// Tyres and surface
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * How much the tyres squeal, 0..1. `s`: { drifting, side (m/s sideways), speed (m/s), braking, airborne, onPave }.
 * Sliding sideways or a drift is loud; hard braking at speed is a light chirp; pavement/gravel is quieter.
 */
export function skidAmount(s) {
  if (s.airborne) return 0;
  const side = Math.abs(num(s.side));
  const spd = Math.abs(num(s.speed));
  let a = clamp01((side - 2.2) / 5) * clamp01(spd / 6);
  if (s.drifting) a = Math.max(a, 0.55 + 0.35 * clamp01(side / 6));
  if (s.braking && spd > 16) a = Math.max(a, 0.22 * clamp01((spd - 16) / 8));
  return a * (s.onPave ? 0.55 : 1);
}
export const skidHz = (speed) => 1500 + 900 * clamp01(Math.abs(num(speed)) / 24);

/** Rolling noise: { pave (gravelly rumble), road (smooth tyre hum) } both 0..1, written into `out`. */
export function surfaceMix(kmh, onPave, airborne, out) {
  const sp = airborne ? 0 : clamp01(Math.abs(num(kmh)) / 55);
  out.pave = onPave ? sp : 0;
  out.road = onPave ? 0 : clamp01(Math.abs(num(kmh)) / 80) * 0.6;
  if (airborne) out.road = 0;
  return out;
}

/** Hit sounds. guard = a soft guardrail contact (building, tree, pillar), otherwise a real crash. Writes into `out`. */
export function crashParams(strength, guard, out) {
  const s = clamp(num(strength, 0.3), 0, 1.4) / 1.4;
  if (guard) {
    out.gain = 0.1 + 0.28 * s;
    out.lp = 260 + 240 * s;
    out.thumpHz = 62;
    out.dur = 0.14 + 0.1 * s;
    out.metal = 0;
  } else {
    out.gain = 0.28 + 0.5 * s;
    out.lp = 1100 + 2200 * s;
    out.thumpHz = 80;
    out.dur = 0.3 + 0.35 * s;
    out.metal = 0.35 + 0.5 * s;
  }
  return out;
}
/** A landing thump. `impact` is the downward speed (m/s) when the wheels touch. */
export function landParams(impact, out) {
  const k = clamp01(num(impact) / 14);
  out.gain = 0.08 + 0.4 * k;
  out.hz = 95 - 30 * k;
  out.dur = 0.16 + 0.18 * k;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * What the city sounds like here and now. `i`: { hour, traffic (vehicles within ~60 m), pillars (metro pillars within ~16 m),
 * rain 0..1, menu (bool) }. Writes { road, birds, crickets, metro, rain, bed } (each 0..1) into `out`.
 * No bell / call-to-prayer style cues, on purpose.
 */
export function ambienceMix(i, out) {
  const h = ((num(i.hour, 12) % 24) + 24) % 24;
  const rain = clamp01(num(i.rain));
  const traffic = clamp01(num(i.traffic) / 14);
  const day = ramp(h, 5, 7) * (1 - ramp(h, 20, 22.5)); // the city is awake
  out.bed = 0.3 + 0.35 * day;
  out.road = 0.15 + 0.85 * traffic;
  out.birds = ramp(h, 5, 6.3) * (1 - ramp(h, 8.8, 10.5)) * (1 - rain);
  out.crickets = Math.max(ramp(h, 18.6, 20.4), 1 - ramp(h, 4.4, 5.4)) * (h >= 18.6 || h < 5.4 ? 1 : 0) * (1 - 0.85 * rain);
  out.metro = clamp01(num(i.pillars) / 5);
  out.rain = rain;
  return out;
}

/** The quiet level the music should sit at: while a voice speaks, or while a menu is open. `voiceUntil` is on the same clock as `now`. */
export function radioDuck(now, voiceUntil, menu) {
  let d = 1;
  if (now < voiceUntil) d = 0.28;
  if (menu === 'pause') d = Math.min(d, 0.2);
  else if (menu) d = Math.min(d, 0.6);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Radio: three tiny generative stations. A step is a sixteenth note; everything is a pure function of (station, step).
// ---------------------------------------------------------------------------------------------------------------------------------
const HIJAZ = [0, 1, 4, 5, 7, 8, 10]; // the "filmi" scale (phrygian dominant with a flat seventh)
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/** Degree (may exceed 6 or be negative) in a 7-note scale -> semitones above the root. */
export function scaleSemis(scale, degree) {
  const d = Math.round(degree);
  const oct = Math.floor(d / 7);
  return scale[((d % 7) + 7) % 7] + 12 * oct;
}

// Mama FM: a 4-bar phrase, [step, degree, lengthInSteps]
const MAMA_PHRASE = [
  [[0, 4, 3], [3, 5, 1], [4, 4, 2], [6, 2, 2], [8, 3, 3], [11, 2, 1], [12, 1, 4]],
  [[0, 2, 3], [3, 3, 1], [4, 4, 2], [6, 5, 2], [8, 6, 4], [12, 5, 2], [14, 4, 2]],
  [[0, 4, 3], [3, 5, 1], [4, 4, 2], [6, 2, 2], [8, 3, 3], [11, 2, 1], [12, 4, 2], [14, 5, 2]],
  [[0, 6, 2], [2, 5, 2], [4, 4, 2], [6, 3, 2], [8, 2, 2], [10, 1, 2], [12, 0, 4]],
];
const MAMA_BASS = [0, 0, -2, 0]; // per bar offsets (semitones) of the drone
const LOFI_CHORDS = [
  { root: 45, tones: [0, 3, 7, 10] }, // Am7
  { root: 41, tones: [0, 4, 7, 11] }, // Fmaj7
  { root: 48, tones: [0, 4, 7, 11] }, // Cmaj7
  { root: 43, tones: [0, 4, 7, 9] }, // G6
];
const LOFI_ARP = [0, -1, 2, -1, 3, -1, 2, 1, -1, 3, -1, 2, -1, 1, 0, -1]; // chord-tone index per step, -1 = rest
const DISCO_ROOTS = [0, -2, -4, -2]; // i, VII, VI, VII in D
const DISCO_ARP = [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 2];

export const STATIONS = [
  { id: 'mama', name: 'Mama FM', te: 'మామ FM', tempo: 100, swing: 0, color: '#ffc857', tracks: ['Charminar Chinnadi', 'Biryani Beats', 'Kothi Se Dil Tak', 'Nizam Nights Medley'] },
  { id: 'lofi', name: 'Lo-fi Charminar', te: 'లో-ఫై చార్మినార్', tempo: 74, swing: 0.16, color: '#8f6bff', tracks: ['Chai at 3 AM', 'Laad Bazaar Rain', 'Pearl Market Dreams', 'Rooftop, Old City'] },
  { id: 'disco', name: 'Disco Dakhni', te: 'డిస్కో దఖ్నీ', tempo: 118, swing: 0, color: '#ff3d9a', tracks: ['Dakhni Disco Fever', 'Haleem Hustle', 'Hyderabad Jigari', 'Auto Raja Boogie'] },
];

/** Seconds per sixteenth note. */
export const stepSeconds = (st) => 60 / (STATIONS[st]?.tempo || 100) / 4;
/** Extra delay (s) that swings the odd sixteenths of the lo-fi station. */
export const swingDelay = (st, step) => (step & 1 ? (STATIONS[st]?.swing || 0) * stepSeconds(st) : 0);
/** Name of the "track" playing at `step` (a new one every 16 bars). */
export const trackTitle = (st, step) => {
  const t = STATIONS[st]?.tracks;
  return t ? t[Math.floor(step / 256) % t.length] : '';
};

/** Fresh note slot to hand to `genStep` over and over. */
export const newSlot = () => ({ lead: 0, leadLen: 1, bass: 0, bassLen: 1, kick: 0, snare: 0, hat: 0, bend: 0 });

/**
 * The notes to play on sixteenth `step` (0-based, counted from the start of the station) of station `st`.
 * Writes into `out`: lead / bass are MIDI numbers (0 = nothing), *Len are in steps, kick / snare / hat are 0..1 strengths,
 * `bend` is a pitch-bend start in cents for the filmi lead.
 */
export function genStep(st, step, out) {
  out.lead = out.bass = out.kick = out.snare = out.hat = out.bend = 0;
  out.leadLen = out.bassLen = 1;
  const s = Math.max(0, Math.floor(num(step)));
  const bar = Math.floor(s / 16);
  const p = s % 16;
  const b4 = bar % 4;
  if (st === 0) {
    // Mama FM: filmi melody on a Hijaz scale over a dholak keherwa
    for (const n of MAMA_PHRASE[b4]) {
      if (n[0] === p) {
        out.lead = 62 + 12 + scaleSemis(HIJAZ, n[1]);
        out.leadLen = n[2];
        out.bend = n[2] >= 2 ? -35 : 0;
      }
    }
    if (p === 0 || p === 8) {
      out.bass = 38 + MAMA_BASS[b4];
      out.bassLen = 6;
    } else if (p === 4 || p === 12) {
      out.bass = 38 + MAMA_BASS[b4] + 7;
      out.bassLen = 3;
    }
    if (p === 0 || p === 3 || p === 8 || p === 10) out.kick = p === 0 ? 1 : 0.7;
    if (p === 4 || p === 12) out.snare = 0.6;
    if (p % 2 === 0) out.hat = p % 4 === 0 ? 0.55 : 0.35;
  } else if (st === 1) {
    // Lo-fi Charminar: Am7 - Fmaj7 - Cmaj7 - G6 arpeggios, a soft kick, a brushed snare
    const ch = LOFI_CHORDS[b4];
    const idx = LOFI_ARP[p];
    if (idx >= 0) {
      out.lead = ch.root + 24 + ch.tones[idx % 4] + (idx === 3 && p > 8 ? 12 : 0);
      out.leadLen = 2;
    }
    if (p === 0) {
      out.bass = ch.root;
      out.bassLen = 12;
    } else if (p === 10) {
      out.bass = ch.root + 7;
      out.bassLen = 5;
    }
    if (p === 0 || p === 10) out.kick = p === 0 ? 0.9 : 0.55;
    if (p === 8) out.snare = 0.4;
    if (p % 4 === 2) out.hat = 0.3;
  } else {
    // Disco Dakhni: four on the floor, offbeat hats, octave-bouncing bass, a square arpeggio and a Hijaz run every 4th bar
    const root = 38 + DISCO_ROOTS[b4];
    if (p % 4 === 0) out.kick = 1;
    if (p % 8 === 4) out.snare = 0.7;
    if (p % 4 === 2) out.hat = 0.7;
    else if (p % 2 === 1) out.hat = 0.18;
    if (p % 2 === 0) {
      out.bass = root + (p % 4 === 2 ? 12 : 0);
      out.bassLen = 2;
    }
    if (b4 === 3 && p >= 8) {
      out.lead = 62 + 12 + scaleSemis(HIJAZ, (p - 8) * 0.8 + (p === 15 ? 0.4 : 0));
      out.leadLen = 1;
    } else {
      out.lead = 74 + scaleSemis(DORIAN, [0, 2, 4, 6][DISCO_ARP[p]] + [0, 0, 2, -1][b4]);
      out.leadLen = 1;
    }
  }
  return out;
}

/** The scale (pitch classes relative to the station key) the station's lead should stay inside, for tests. */
export const STATION_SCALES = [
  { root: 2, scale: HIJAZ }, // D
  { root: 9, scale: [0, 3, 7, 10, 8, 2, 5] }, // A: A C E G F B D = the chord tones of Am7 / Fmaj7 / Cmaj7 / G6
  { root: 2, scale: [...DORIAN, ...HIJAZ] }, // D
];
