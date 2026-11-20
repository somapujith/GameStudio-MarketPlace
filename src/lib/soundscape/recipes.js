// The sounds of Nawabi Raj: every one is synthesised (no audio files) from a handful of oscillators and
// filtered noise. Each recipe is  (synth, t, opts) -> void  and carries mixer metadata:
//
//   priority  0 ticks / taps   1 ordinary events   2 notable moments   3 must-hear (turn, snatch, win, bankrupt)
//   cooldown  ms: a repeat of the same sound inside this window is dropped (coins coalesce, steps never machine-gun)
//   dur       rough length in seconds (the ambient bed ducks for this long)
//
// Options a recipe may read (all optional, all clamped): `amount` (cash), `values` (dice faces), `i`/`n` (pawn step
// index / path length), `deck` ('luck' | 'drama'), `level`, `mine`, `on`, `tock`, `urgency`, `use`, `bad`, `vol`.
// The names of the original sound set keep working: click dice step coin pay buy upgrade hotel mortgage trade lucky
// jail card win lose cheer error turn warn ride chai invite levelup friend.

const rand = (a, b) => a + Math.random() * (b - a);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568 };
const PENT = [0, 2, 4, 7, 9]; // major pentatonic degrees
/** The i-th note of a major pentatonic scale above MIDI `root` (i may be any integer). */
export const pentMidi = (root, i) => {
  const k = Math.floor(i);
  const oct = Math.floor(k / 5);
  return root + 12 * oct + PENT[((k % 5) + 5) % 5];
};

/** How many coin clinks an amount of rupees deserves: 1 (a small payment) .. 8 (a fortune). Unknown amount -> 2. */
export function clinksFor(amount) {
  if (amount === undefined || amount === null || !Number.isFinite(Number(amount))) return 2;
  const a = Math.abs(Number(amount));
  let n = 1;
  for (const edge of [15000, 30000, 60000, 120000, 250000, 500000, 1000000]) if (a > edge) n += 1;
  return n;
}

/** Pitch of a die's landing knock: a rising whole-tone ladder, 1 is low wood, 6 is bright wood. */
export const faceFreq = (value) => 150 * 2 ** ((clamp(Math.round(num(value, 3)), 1, 6) - 1) * (2 / 12));

const CLINKS = [1568, 1760, 2093, 2349, 2637, 3136];

/** A single metallic coin clink. */
function clink(s, t, { f = CLINKS[Math.floor(rand(0, CLINKS.length))], v = 0.2, d = 0.14 } = {}) {
  s.tone({ f, t, d, v });
  s.tone({ f: f * 2.76, t, d: d * 0.4, v: v * 0.3 });
  s.noise({ t, d: 0.012, v: v * 0.35, type: 'highpass', f: 5200 });
}

/** A shehnai-like reed note: detuned saws through a vocal band, a little vibrato, an optional slide up into it. */
function reed(s, { f, t, d = 0.2, hold = 0, v = 0.1, meend = false }) {
  const from = meend ? f * 0.89 : undefined;
  s.tone({ f, from, glide: 0.07, type: 'sawtooth', t, a: 0.012, hold, d, v, detune: -7, filter: { type: 'bandpass', f: Math.min(3200, f * 3), q: 1.4 }, vib: { rate: 5.6, depth: 22, delay: 0.1 } });
  s.tone({ f, from, glide: 0.07, type: 'square', t, a: 0.012, hold, d, v: v * 0.45, detune: 9, filter: { type: 'lowpass', f: 2400, q: 0.7 } });
}

/** A dholak-like hit: a low skin thump or a tight high "tin". */
function dhol(s, t, low = true, v = 0.3) {
  if (low) {
    s.tone({ f: 130, f2: 62, t, d: 0.2, v });
    s.noise({ t, d: 0.07, v: v * 0.55, type: 'lowpass', f: 420 });
  } else {
    s.tone({ f: 420, f2: 300, type: 'triangle', t, d: 0.08, v: v * 0.55 });
    s.noise({ t, d: 0.035, v: v * 0.4, f: 3200, q: 1.6 });
  }
}

const SOUNDS = {};
/** Register a sound with its mixer metadata. */
function def(name, priority, cooldown, dur, fn) {
  SOUNDS[name] = { name, priority, cooldown, dur, fn };
}

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------

def('click', 0, 30, 0.06, (s, t) => {
  s.tone({ f: 1150, f2: 720, type: 'triangle', t, d: 0.04, v: 0.22 });
});

// a feather-light tick for hover-ish / minor UI
def('tap', 0, 30, 0.04, (s, t) => {
  s.tone({ f: 1500, f2: 1000, type: 'sine', t, d: 0.025, v: 0.11 });
});

// a switch: up a step when turned on, down a step when turned off
def('toggle', 0, 60, 0.18, (s, t, o) => {
  const on = o.on !== false;
  const [a, b] = on ? [660, 990] : [880, 560];
  s.tone({ f: a, type: 'triangle', t, d: 0.05, v: 0.17 });
  s.tone({ f: b, type: 'triangle', t: t + 0.055, d: 0.09, v: 0.19 });
});

// ---------------------------------------------------------------------------------------------
// Dice and pawns
// ---------------------------------------------------------------------------------------------

/** Fractions of the tumble at which the die hits the floor: the same as diceMotion.BOUNCE_AT (a test keeps them equal). */
export const DICE_BOUNCES = Object.freeze([0.44, 0.72, 0.92]);

// The tumble, in step with the die on screen (opts.ms = the tumble length at the current playback speed, default 1.1 s):
// a shake in the cup and the throw, then a wood knock at each floor bounce (weaker every time) with a little rattle after it,
// and a short skid. (The landing knock, pitched by the faces, is `diceLand`, played when the roll resolves.)
def('dice', 1, 250, 1.15, (s, t, o) => {
  const D = clamp(num(o.ms, 1100), 250, 1600) / 1000;
  const bounces = Array.isArray(o.bounces) && o.bounces.length ? o.bounces.slice(0, 4) : DICE_BOUNCES;
  const first = bounces[0] * D;
  s.rattle({ t, d: Math.max(0.1, first - 0.02), hits: Math.max(4, Math.round(14 * D)), v: 0.17, decay: 0.3 }); // cup + flight
  s.noise({ t, a: D * 0.1, d: D * 0.9, v: 0.045, type: 'lowpass', f: 700, f2: 380 }); // the hiss of the throw
  bounces.forEach((b, i) => {
    const at = t + b * D;
    const k = [1, 0.62, 0.4, 0.3][i] ?? 0.3;
    const f = 175 - i * 22;
    s.tone({ f: f * 1.6, f2: f * 0.5, t: at, d: 0.1, v: 0.36 * k + 0.05 });
    s.noise({ t: at, d: 0.06, v: 0.2 * k + 0.03, type: 'lowpass', f: 950 });
    s.noise({ t: at, d: 0.014, v: 0.09 * k, f: 2800, q: 1.6 });
    if (i < bounces.length - 1) s.rattle({ t: at + 0.015, d: Math.min(0.14, (bounces[i + 1] - b) * D * 0.7), hits: 3, v: 0.11 * k, tickV: 0.02, decay: 0.2 });
  });
  const last = bounces[bounces.length - 1];
  if (last < 0.98) s.rattle({ t: t + last * D + 0.02, d: Math.max(0.05, (1 - last) * D - 0.03), hits: 3, v: 0.06, tickV: 0.012 }); // the skid
});

// the dice land on the table: one wood knock per die, pitched by its face; a six adds a little sparkle
def('diceLand', 1, 120, 0.7, (s, t, o) => {
  const values = (Array.isArray(o.values) ? o.values : [o.value ?? o.values]).slice(0, 3).map((x) => clamp(Math.round(num(x, 3)), 1, 6));
  if (!values.length) values.push(3);
  values.forEach((val, i) => {
    const ti = t + i * 0.075;
    const f = faceFreq(val);
    s.tone({ f: f * 1.7, f2: f * 0.55, t: ti, d: 0.13, v: 0.34 });
    s.noise({ t: ti, d: 0.07, v: 0.2, type: 'lowpass', f: 900 });
    s.noise({ t: ti, d: 0.016, v: 0.09, f: 2600, q: 1.6 });
    if (val === 6) {
      s.tone({ f: 2093, type: 'triangle', t: ti + 0.07, d: 0.3, v: 0.11 });
      s.tone({ f: 3136, t: ti + 0.13, d: 0.32, v: 0.07 });
    }
  });
});

// soft wooden tick for a pawn hop; the pitch climbs a pentatonic ladder along the move (opts i = step index)
def('step', 0, 45, 0.1, (s, t, o) => {
  const i = clamp(Math.floor(num(o.i, 0)), 0, 40);
  const f = hz(pentMidi(55, i % 14));
  const last = o.n !== undefined && i >= num(o.n, 0) - 1 && i > 0;
  s.tone({ f, f2: f * 0.62, type: 'triangle', t, d: 0.06, v: 0.2, pan: clamp(num(o.pan, 0), -0.6, 0.6) });
  s.tone({ f: f * 2, type: 'sine', t, d: 0.03, v: 0.07 });
  s.noise({ t, d: 0.02, v: 0.08, f: 2200, q: 1.5 });
  if (last) s.tone({ f: f * 0.5, f2: f * 0.3, t: t + 0.01, d: 0.1, v: 0.12 });
});

// a pawn settles on its square: a soft thud and a tiny tinkle
def('land', 1, 100, 0.3, (s, t) => {
  s.tone({ f: 150, f2: 62, t, d: 0.16, v: 0.26 });
  s.noise({ t, d: 0.08, v: 0.14, type: 'lowpass', f: 420 });
  s.tone({ f: 2093, t: t + 0.03, d: 0.1, v: 0.04 });
});

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

// cash in: one tick for a small sum, a cascade of clinks for a big one (1..8 by amount)
def('coin', 1, 80, 0.9, (s, t, o) => {
  const n = clinksFor(o.amount);
  if (o.amount === undefined) {
    // the original two-tone ping
    s.tone({ f: 1318.5, t, d: 0.09, v: 0.24 });
    s.tone({ f: 1760, t: t + 0.07, d: 0.3, v: 0.28 });
    s.tone({ f: 3520, type: 'triangle', t: t + 0.07, d: 0.16, v: 0.05 });
    return;
  }
  let at = t;
  let gap = 0.075;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    clink(s, at, { v: 0.2 * (1 - i * 0.04) + (n === 1 ? 0.06 : 0), d: last ? 0.34 : 0.14, f: i === 0 ? 1760 : undefined });
    at += gap + rand(0, 0.015);
    gap = Math.max(0.038, gap * 0.9);
  }
  if (n >= 6) s.noise({ t, a: 0.05, d: 0.3, v: 0.03, type: 'highpass', f: 6500 }); // a shimmer under a fortune
});

// cash out: a muted purse: dull taps and a cloth thump, never a happy ring
def('pay', 1, 80, 0.5, (s, t, o) => {
  const n = o.amount === undefined ? 3 : clamp(Math.ceil(clinksFor(o.amount) / 3), 1, 3);
  s.noise({ t, d: 0.09, v: 0.2, type: 'lowpass', f: 520 });
  for (let i = 0; i < n; i++) {
    const ti = t + 0.02 + i * 0.075;
    s.tone({ f: 520 - i * 70, f2: 330 - i * 40, type: 'triangle', t: ti, d: 0.11, v: 0.22, filter: { type: 'lowpass', f: 1100, q: 0.6 } });
  }
  if (o.amount === undefined) s.tone({ f: 392, f2: 330, type: 'triangle', t: t + 0.2, d: 0.2, v: 0.14 });
});

// rent paid: a heavy soft thud and two dull coin taps
def('rent', 1, 200, 0.55, (s, t) => {
  s.tone({ f: 130, f2: 46, t, d: 0.24, v: 0.4 });
  s.noise({ t, d: 0.11, v: 0.28, type: 'lowpass', f: 360 });
  [0.12, 0.2].forEach((dt, i) => {
    s.tone({ f: 480 - i * 60, f2: 300, type: 'triangle', t: t + dt, d: 0.1, v: 0.18, filter: { type: 'lowpass', f: 1000 } });
  });
});

// cash register "cha-ching": drawer ratchet, then a double bell strike
def('buy', 2, 250, 1.2, (s, t) => {
  [0, 0.035, 0.07].forEach((dt, i) => s.noise({ t: t + dt, d: 0.022, v: 0.13 - i * 0.02, f: 3300 + i * 500, q: 3 })); // ratchet
  s.noise({ t: t + 0.1, d: 0.08, v: 0.2, type: 'highpass', f: 3200 }); // drawer
  s.noise({ t: t + 0.11, d: 0.09, v: 0.14, f: 1800, q: 1.2 });
  s.bell({ f: 2093, t: t + 0.13, d: 0.7, v: 0.17, ratios: [1, 1.26, 1.5, 2.76] });
  s.tone({ f: 3136, t: t + 0.18, d: 0.5, v: 0.08 });
  s.tone({ f: 4186, type: 'triangle', t: t + 0.18, d: 0.3, v: 0.04 });
});

// auction hammer (two raps) and a bright "SOLD"
def('sold', 2, 400, 1.2, (s, t) => {
  [0, 0.24].forEach((dt, i) => {
    s.tone({ f: 640, f2: 250, t: t + dt, d: 0.07, v: 0.36 - i * 0.04 });
    s.noise({ t: t + dt, d: 0.04, v: 0.28, type: 'lowpass', f: 1400 });
    s.noise({ t: t + dt, d: 0.012, v: 0.12, f: 3000, q: 1.5 });
  });
  s.bell({ f: NOTE.G5, t: t + 0.5, d: 0.45, v: 0.15, ratios: [1, 2, 2.76] });
  s.bell({ f: NOTE.C6, t: t + 0.62, d: 0.7, v: 0.17, ratios: [1, 2, 2.76, 5.4] });
  s.tone({ f: NOTE.E6, type: 'triangle', t: t + 0.62, d: 0.5, v: 0.08 });
});

// the auction opens: one gavel tap and a small attention bell
def('auction', 1, 300, 0.6, (s, t) => {
  s.tone({ f: 600, f2: 280, t, d: 0.06, v: 0.28 });
  s.noise({ t, d: 0.035, v: 0.2, type: 'lowpass', f: 1300 });
  s.bell({ f: 1568, t: t + 0.12, d: 0.4, v: 0.1, ratios: [1, 2.76, 5.4] });
});

// construction: knock, knock, ding (the ding climbs with the new level)
def('upgrade', 2, 250, 1.0, (s, t, o) => {
  [0, 0.17].forEach((dt, i) => {
    s.tone({ f: 230 - i * 20, f2: 105, t: t + dt, d: 0.08, v: 0.36 });
    s.noise({ t: t + dt, d: 0.045, v: 0.26, type: 'lowpass', f: 780 });
    s.noise({ t: t + dt, d: 0.012, v: 0.1, f: 2400, q: 1.4 });
  });
  const f = hz(pentMidi(76, clamp(Math.floor(num(o.level, 1)) - 1, 0, 8)));
  s.bell({ f, t: t + 0.36, d: 0.75, v: 0.2, ratios: [1, 2.0, 2.76], type: 'sine' });
  s.tone({ f: f * 2, type: 'triangle', t: t + 0.36, d: 0.3, v: 0.07 });
});

// a Hotel is built: grand chime with a big bell
def('hotel', 2, 400, 2.0, (s, t) => {
  s.noise({ t, d: 0.05, v: 0.2, type: 'lowpass', f: 800 });
  s.tone({ f: 130, f2: 70, t, d: 0.12, v: 0.28 });
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => {
    s.tone({ f, type: 'triangle', t: t + 0.16 + i * 0.075, d: 0.28, v: 0.17 });
  });
  s.bell({ f: 523.25, t: t + 0.56, d: 1.3, v: 0.2 });
  [NOTE.G6, NOTE.C6].forEach((f, i) => {
    s.tone({ f, t: t + 0.7 + i * 0.12, d: 0.4, v: 0.07 });
  });
});

// a rubber stamp on the deed: a paper slide, a thump and a second settling thud
def('mortgage', 2, 300, 0.6, (s, t) => {
  s.noise({ t, a: 0.05, d: 0.09, v: 0.07, type: 'highpass', f: 2200, f2: 1200 });
  const at = t + 0.08;
  s.tone({ f: 150, f2: 48, t: at, d: 0.2, v: 0.4 });
  s.noise({ t: at, d: 0.09, v: 0.3, type: 'lowpass', f: 600 });
  s.noise({ t: at + 0.02, d: 0.03, v: 0.14, f: 2400, q: 1.5 });
  s.tone({ f: 90, f2: 55, type: 'triangle', t: at + 0.12, d: 0.16, v: 0.2 });
});

// two coins swapping places
def('trade', 1, 300, 0.6, (s, t) => {
  s.tone({ f: 1480, t, d: 0.07, v: 0.2 });
  s.tone({ f: 1976, t: t + 0.05, d: 0.2, v: 0.2 });
  s.tone({ f: 1976, t: t + 0.22, d: 0.07, v: 0.2 });
  s.tone({ f: 1480, t: t + 0.27, d: 0.24, v: 0.22 });
  s.noise({ t: t + 0.16, d: 0.05, v: 0.06, f: 3500, q: 1.2 });
});

// chai: tea poured into a glass (a rising stream and bubbles), then a clink; `use` = a sip instead of a clink
def('chai', 1, 250, 1.0, (s, t, o) => {
  s.noise({ t, a: 0.06, d: 0.42, v: 0.085, f: 520, f2: 1500, q: 2.4 });
  for (let i = 0; i < 5; i++) {
    const ti = t + 0.04 + i * 0.075 + rand(0, 0.03);
    const f = rand(700, 1300);
    s.tone({ f, f2: f * 1.5, t: ti, d: 0.05, v: 0.05 });
  }
  if (o.use) {
    s.noise({ t: t + 0.5, a: 0.06, d: 0.22, v: 0.05, type: 'lowpass', f: 900, f2: 300 });
    s.tone({ f: 520, f2: 760, t: t + 0.52, d: 0.16, v: 0.08 });
  } else {
    s.bell({ f: 1320, t: t + 0.48, d: 0.45, v: 0.12, ratios: [1, 2.4, 4.1] });
  }
});

// ---------------------------------------------------------------------------------------------
// Cards, events, rides
// ---------------------------------------------------------------------------------------------

// a card flips with a whoosh; each deck adds its own sting (Nawabi Luck = bright bells, City Drama = low drum)
def('card', 1, 250, 1.1, (s, t, o) => {
  s.noise({ t, d: 0.17, v: 0.22, f: 1200, f2: 5200, q: 0.8, a: 0.02 });
  s.tone({ f: 900, f2: 1300, type: 'triangle', t: t + 0.13, d: 0.04, v: 0.08 });
  const at = t + 0.17;
  if (o.deck === 'luck') {
    [NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => {
      s.tone({ f, type: 'triangle', t: at + i * 0.055, d: 0.4, v: 0.13 });
      s.tone({ f: f * 2.01, t: at + i * 0.055, d: 0.2, v: 0.04 });
    });
    s.bell({ f: NOTE.C6, t: at + 0.22, d: 0.6, v: 0.08, ratios: [1, 2.76, 5.4] });
    s.noise({ t: at, a: 0.05, d: 0.35, v: 0.03, type: 'highpass', f: 6500 });
  } else if (o.deck === 'drama') {
    s.tone({ f: 130, f2: 55, t: at, d: 0.32, v: 0.46 });
    s.noise({ t: at, d: 0.09, v: 0.3, type: 'lowpass', f: 320 });
    s.noise({ t: at, d: 0.03, v: 0.08, f: 1800, q: 1.2 });
    s.tone({ f: 98, f2: 44, t: at + 0.3, d: 0.42, v: 0.52 });
    s.noise({ t: at + 0.3, d: 0.1, v: 0.3, type: 'lowpass', f: 260 });
    s.noise({ t: at + 0.3, a: 0.25, d: 0.45, v: 0.035, f: 4000, q: 0.8 });
  }
});

// a city event: a rising chime (good news) or a low gong (bad news)
def('announce', 2, 500, 1.8, (s, t, o) => {
  if (o.bad) {
    s.bell({ f: 110, t, d: 1.6, v: 0.28, ratios: [1, 1.5, 2.4, 3.3] });
    s.noise({ t, a: 0.2, d: 0.7, v: 0.1, type: 'lowpass', f: 300 });
    s.tone({ f: 73, f2: 55, t, d: 0.6, v: 0.25 });
  } else {
    [NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
      s.tone({ f, type: 'triangle', t: t + i * 0.1, d: 0.34, v: 0.17 });
      s.bell({ f: f * 2, t: t + i * 0.1, d: 0.5, v: 0.05, ratios: [1, 2.76] });
    });
    s.noise({ t: t + 0.2, a: 0.05, d: 0.4, v: 0.03, type: 'highpass', f: 6000 });
  }
});

// soft sparkle: the lucky dice helped / a Snatch button was earned
def('lucky', 1, 300, 0.5, (s, t) => {
  [2093, 2637, 3136, 2637, 3520].forEach((f, i) => {
    s.tone({ f, t: t + i * 0.055, d: 0.22, v: 0.07 });
  });
  s.noise({ t, d: 0.3, v: 0.03, type: 'highpass', f: 6000, a: 0.05 });
});

// iron cell door clang
def('jail', 2, 500, 1.2, (s, t) => {
  s.noise({ t, d: 0.07, v: 0.3, f: 3000, q: 0.8 });
  [1, 2.76, 5.4, 8.93].forEach((r, i) => {
    s.tone({ f: 196 * r, t, d: 1.0 - i * 0.15, v: 0.22 / (i + 1) });
  });
  s.noise({ t: t + 0.24, d: 0.05, v: 0.15, f: 2600, q: 0.8 });
  [1, 2.76, 5.4].forEach((r, i) => {
    s.tone({ f: 196 * r * 1.04, t: t + 0.24, d: 0.6 - i * 0.12, v: 0.12 / (i + 1) });
  });
});

// Traffic Jam: two honking horns (a dissonant dyad), then a far-off third
def('traffic', 2, 500, 1.2, (s, t) => {
  const honk = (at, f, d, v) => {
    const filter = { type: 'bandpass', f: 1000, q: 0.9 };
    s.tone({ f, from: f * 0.93, glide: 0.03, type: 'sawtooth', t: at, a: 0.012, hold: d * 0.55, d: d * 0.45, v, filter });
    s.tone({ f: f * 1.26, from: f * 1.17, glide: 0.03, type: 'square', t: at, a: 0.012, hold: d * 0.55, d: d * 0.45, v: v * 0.55, filter });
  };
  honk(t, 349, 0.34, 0.15);
  honk(t + 0.42, 349, 0.22, 0.13);
  honk(t + 0.8, 294, 0.3, 0.06);
  s.noise({ t, a: 0.1, d: 0.9, v: 0.025, type: 'lowpass', f: 400 }); // engine murmur
});

// Auto horn "pom-pom" and an engine whoosh: taking the Auto / Metro / MMTS
def('ride', 1, 400, 0.9, (s, t) => {
  [0, 0.17].forEach((dt) => {
    s.tone({ f: 415, type: 'square', t: t + dt, d: 0.1, v: 0.05 });
    s.tone({ f: 415, type: 'triangle', t: t + dt, d: 0.12, v: 0.18 });
    s.tone({ f: 523, type: 'triangle', t: t + dt, d: 0.12, v: 0.1 });
  });
  s.noise({ t: t + 0.3, a: 0.12, d: 0.45, v: 0.12, f: 400, f2: 1800, q: 0.7 });
});

// ---------------------------------------------------------------------------------------------
// Turn, timers, Snatch
// ---------------------------------------------------------------------------------------------

// your turn: two bright bells and a lift
def('turn', 3, 600, 0.8, (s, t) => {
  s.tone({ f: NOTE.G5, type: 'triangle', t, d: 0.16, v: 0.2 });
  s.tone({ f: NOTE.C6, type: 'triangle', t: t + 0.11, d: 0.3, v: 0.22 });
  s.tone({ f: NOTE.E6, type: 'triangle', t: t + 0.22, d: 0.4, v: 0.16 });
  s.bell({ f: NOTE.C6, t: t + 0.24, d: 0.6, v: 0.07, ratios: [1, 2.76, 5.4] });
  s.noise({ t: t + 0.1, d: 0.25, v: 0.025, type: 'highpass', f: 6500, a: 0.03 });
});

// somebody else's turn begins: one soft wood-bell tick
def('turnOther', 0, 250, 0.2, (s, t) => {
  s.tone({ f: 784, type: 'sine', t, d: 0.12, v: 0.07 });
  s.tone({ f: 1568, type: 'sine', t, d: 0.06, v: 0.025 });
});

// the decision timer's last seconds: a soft tick-tock that climbs as time runs out (urgency 0..1)
def('tick', 1, 120, 0.1, (s, t, o) => {
  const u = clamp(num(o.urgency, 0), 0, 1);
  const f = (o.tock ? 760 : 1010) * (1 + u * 0.28);
  s.tone({ f, f2: f * 0.7, type: 'triangle', t, d: 0.05, v: 0.1 + u * 0.08 });
  s.noise({ t, d: 0.018, v: 0.045 + u * 0.03, f: 2600, q: 2 });
});

// soft wooden double tick: the decision timer is running out (never harsh)
def('warn', 2, 600, 0.4, (s, t) => {
  [0, 0.22].forEach((dt) => {
    s.tone({ f: 880, f2: 700, type: 'sine', t: t + dt, d: 0.09, v: 0.16 });
    s.noise({ t: t + dt, d: 0.025, v: 0.06, f: 2600, q: 2 });
  });
});

// the Snatch window opens: an urgent rising two-tone, twice
def('snatchAlarm', 3, 500, 0.85, (s, t) => {
  [0, 0.4].forEach((dt) => {
    s.tone({ f: 880, t: t + dt, type: 'triangle', a: 0.008, hold: 0.06, d: 0.07, v: 0.2 });
    s.tone({ f: 880, t: t + dt, type: 'square', a: 0.008, hold: 0.06, d: 0.07, v: 0.04, filter: { type: 'lowpass', f: 2600 } });
    s.tone({ f: 1175, f2: 1245, t: t + dt + 0.17, type: 'triangle', a: 0.008, hold: 0.09, d: 0.1, v: 0.22 });
    s.tone({ f: 1175, t: t + dt + 0.17, type: 'square', a: 0.008, hold: 0.09, d: 0.1, v: 0.04, filter: { type: 'lowpass', f: 2800 } });
  });
  s.noise({ t, a: 0.02, d: 0.06, v: 0.06, type: 'highpass', f: 4000 });
});

// the Snatch clock: tick-tock that gets higher and louder as the window closes (urgency 0..1)
def('snatchTick', 3, 60, 0.08, (s, t, o) => {
  const u = clamp(num(o.urgency, 0), 0, 1);
  const f = (o.tock ? 1250 : 1650) * (1 + u * 0.3);
  s.tone({ f, f2: f * 0.8, type: 'triangle', t, d: 0.04, v: 0.12 + u * 0.12 });
  s.noise({ t, d: 0.012, v: 0.06 + u * 0.05, f: 3300, q: 2.2 });
});

// pressing Snatch: a snap and a coin
def('snatchPress', 3, 100, 0.4, (s, t) => {
  s.noise({ t, d: 0.05, v: 0.24, type: 'highpass', f: 2500 });
  s.tone({ f: 300, f2: 1100, type: 'triangle', t, d: 0.09, v: 0.28 });
  s.tone({ f: 2093, t: t + 0.06, d: 0.26, v: 0.15 });
  s.tone({ f: 3136, t: t + 0.08, d: 0.18, v: 0.07 });
});

// a successful Snatch: a quick rising run, a cash-register bell and a sparkle
def('snatchWin', 3, 500, 1.3, (s, t) => {
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => {
    s.tone({ f, type: 'triangle', t: t + i * 0.05, d: 0.2, v: 0.17 });
    s.tone({ f, type: 'square', t: t + i * 0.05, d: 0.1, v: 0.025 });
  });
  s.noise({ t: t + 0.22, d: 0.07, v: 0.16, type: 'highpass', f: 3200 });
  s.bell({ f: 2093, t: t + 0.26, d: 0.8, v: 0.17, ratios: [1, 1.26, 1.5, 2.76] });
  s.tone({ f: NOTE.G6, t: t + 0.32, d: 0.5, v: 0.08 });
  s.noise({ t: t + 0.3, a: 0.05, d: 0.45, v: 0.035, type: 'highpass', f: 6500 });
});

// somebody snatched your district: two soft falling notes and a dull thud (sad, not harsh)
def('snatchLost', 2, 500, 0.7, (s, t) => {
  s.tone({ f: 392, type: 'triangle', t, d: 0.2, v: 0.17, filter: { type: 'lowpass', f: 1400 } });
  s.tone({ f: 294, f2: 262, type: 'triangle', t: t + 0.17, d: 0.34, v: 0.17, filter: { type: 'lowpass', f: 1100 } });
  s.tone({ f: 100, f2: 50, t: t + 0.17, d: 0.2, v: 0.2 });
});

// ---------------------------------------------------------------------------------------------
// Big moments
// ---------------------------------------------------------------------------------------------

// victory: dholak roll, a shehnai-flavoured major-pentatonic phrase with a slide into the first note, a held chord
def('win', 3, 1500, 3.6, (s, t) => {
  // rhythm: dha . tin dha | ge tin dha .
  [[0, 1], [0.2, 0], [0.4, 1], [0.6, 0], [0.8, 1], [1.0, 0], [1.2, 1], [1.4, 0], [1.6, 1], [1.8, 1], [2.0, 0]].forEach(([dt, low], i) => dhol(s, t + dt, !!low, low ? 0.26 : 0.2 - (i % 2) * 0.02));
  // phrase in C major pentatonic: E G A . G E D C . E G A C(held)
  const m = [[76, 0.0, 0.17, 0, true], [79, 0.2, 0.17, 0, false], [81, 0.4, 0.3, 0.08, false], [79, 0.8, 0.17, 0, false], [76, 1.0, 0.17, 0, false], [74, 1.2, 0.17, 0, false], [72, 1.4, 0.3, 0.1, false], [76, 1.8, 0.17, 0, false], [79, 2.0, 0.17, 0, false], [81, 2.2, 0.17, 0, false], [84, 2.4, 0.9, 0.5, true]];
  m.forEach(([n, dt, d, hold, meend]) => reed(s, { f: hz(n), t: t + dt, d, hold, v: 0.1, meend }));
  // the held chord and a sparkle on the last note
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f) => s.tone({ f, type: 'triangle', t: t + 2.4, a: 0.01, hold: 0.6, d: 0.9, v: 0.09 }));
  s.bell({ f: NOTE.C6, t: t + 2.4, d: 1.4, v: 0.1, ratios: [1, 2.76, 5.4] });
  [NOTE.G6, NOTE.E6, NOTE.G6, NOTE.C6 * 2].forEach((f, i) => s.tone({ f, t: t + 2.55 + i * 0.09, d: 0.3, v: 0.05 }));
});

// the game is over and it is not you: a trombone "wah wah wah waaah"
def('lose', 3, 1500, 1.8, (s, t) => {
  [[392, 0, 0.24], [370, 0.28, 0.24], [349, 0.56, 0.24]].forEach(([f, dt, d]) => {
    s.tone({ f, type: 'sawtooth', t: t + dt, a: 0.02, d, v: 0.09, filter: { type: 'lowpass', f: 380, f2: 1100, q: 2 } });
    s.tone({ f, type: 'triangle', t: t + dt, a: 0.02, d: d + 0.02, v: 0.16 });
  });
  s.tone({ f: 330, f2: 130, type: 'sawtooth', t: t + 0.86, a: 0.03, hold: 0.25, d: 0.6, v: 0.1, filter: { type: 'lowpass', f: 1200, f2: 260, q: 2 }, vib: { rate: 5, depth: 35, delay: 0.3 } });
  s.tone({ f: 330, f2: 130, type: 'triangle', t: t + 0.86, a: 0.03, hold: 0.25, d: 0.6, v: 0.2 });
});

// bankrupt: a single falling glide with a widening wobble and a thud at the bottom
def('bankrupt', 3, 800, 1.7, (s, t, o) => {
  const v = o.mine === false ? 0.7 : 1;
  s.tone({ f: 440, f2: 92, type: 'sawtooth', t, a: 0.03, hold: 0.45, d: 0.9, v: 0.1 * v, filter: { type: 'lowpass', f: 1300, f2: 240, q: 2.2 }, vib: { rate: 5.2, depth: 45, delay: 0.5 } });
  s.tone({ f: 440, f2: 92, type: 'triangle', t, a: 0.03, hold: 0.45, d: 0.9, v: 0.22 * v });
  s.tone({ f: 90, f2: 42, t: t + 1.3, d: 0.3, v: 0.35 * v });
  s.noise({ t: t + 1.3, d: 0.12, v: 0.2 * v, type: 'lowpass', f: 300 });
});

// crowd swell with claps
def('cheer', 2, 800, 1.8, (s, t) => {
  s.noise({ t, a: 0.5, d: 1.1, v: 0.28, f: 900, f2: 2100, q: 0.7 });
  s.noise({ t: t + 0.1, a: 0.45, d: 1.0, v: 0.12, type: 'highpass', f: 1800 });
  for (let i = 0; i < 14; i++) {
    s.noise({ t: t + rand(0.2, 1.5), d: 0.03, v: rand(0.08, 0.16), f: rand(1400, 2400), q: 1.4 });
  }
  s.tone({ f: 480, f2: 880, t: t + 0.1, a: 0.1, d: 0.6, v: 0.04 });
});

// quick rising run with a sparkle: level up
def('levelup', 2, 500, 0.9, (s, t) => {
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => {
    s.tone({ f, type: 'triangle', t: t + i * 0.06, d: 0.16, v: 0.17 });
  });
  s.tone({ f: NOTE.G6, t: t + 0.32, d: 0.5, v: 0.1 });
  s.noise({ t: t + 0.3, a: 0.05, d: 0.35, v: 0.04, type: 'highpass', f: 6000 });
});

// friendly doorbell: someone invited you to a table
def('invite', 1, 600, 0.9, (s, t) => {
  s.tone({ f: NOTE.E6, t, d: 0.4, v: 0.18 });
  s.tone({ f: NOTE.C6, t: t + 0.24, d: 0.6, v: 0.2 });
  s.tone({ f: NOTE.C5, type: 'triangle', t: t + 0.24, d: 0.5, v: 0.07 });
});

// two warm notes: a friend came online or accepted you
def('friend', 1, 400, 0.5, (s, t) => {
  s.tone({ f: NOTE.E5, type: 'triangle', t, d: 0.18, v: 0.18 });
  s.tone({ f: NOTE.G5, type: 'triangle', t: t + 0.12, d: 0.3, v: 0.18 });
  s.tone({ f: NOTE.G6, t: t + 0.12, d: 0.2, v: 0.04 });
});

// ---------------------------------------------------------------------------------------------
// Power cards (docs/POWER_CARDS.md 3.3): one short, distinct sound per moment, all one-shots.
// `vol` (0..1) is how loud: the presenter passes less for a rival's card.
// ---------------------------------------------------------------------------------------------

// a card is drawn: a soft paper flick and a small gold sparkle
def('powerDraw', 1, 220, 0.6, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.2, 1);
  s.noise({ t, a: 0.04, d: 0.1, v: 0.09 * v, type: 'highpass', f: 2400, f2: 1300 }); // the flick
  s.tone({ f: 620, f2: 900, type: 'triangle', t: t + 0.03, d: 0.07, v: 0.1 * v });
  [NOTE.E6, NOTE.G6, 2093].forEach((f, i) => s.tone({ f, t: t + 0.13 + i * 0.07, d: 0.22, v: (0.075 - i * 0.012) * v })); // sparkle
  s.noise({ t: t + 0.14, a: 0.04, d: 0.3, v: 0.025 * v, type: 'highpass', f: 6500 });
});

// a card is played: a decisive slam on the table with a bright ring after it
def('powerPlay', 2, 400, 0.9, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.3, 1);
  s.noise({ t, d: 0.05, v: 0.12 * v, type: 'highpass', f: 2600 }); // the snap of the card
  s.tone({ f: 190, f2: 55, t: t + 0.02, d: 0.2, v: 0.4 * v });
  s.noise({ t: t + 0.02, d: 0.09, v: 0.26 * v, type: 'lowpass', f: 520 });
  s.bell({ f: 784, t: t + 0.07, d: 0.55, v: 0.13 * v, ratios: [1, 2.0, 2.76] });
  s.tone({ f: 1568, type: 'triangle', t: t + 0.09, d: 0.3, v: 0.05 * v });
});

// a Shield blocks a payment: a metallic hit and a bright shimmering chime
def('powerShield', 2, 400, 1.3, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.3, 1);
  s.tone({ f: 320, f2: 150, type: 'triangle', t, d: 0.1, v: 0.3 * v });
  s.noise({ t, d: 0.03, v: 0.2 * v, f: 3400, q: 1.8 }); // the clang
  s.bell({ f: 1046.5, t: t + 0.02, d: 0.8, v: 0.18 * v, ratios: [1, 2.76, 5.4, 8.9] });
  [NOTE.C6, NOTE.E6, NOTE.G6, 2093].forEach((f, i) => s.tone({ f, t: t + 0.16 + i * 0.075, d: 0.4, v: 0.1 * v })); // the shimmer
  s.noise({ t: t + 0.18, a: 0.08, d: 0.6, v: 0.03 * v, type: 'highpass', f: 7000 });
});

// Double Rent pays out: a coin cascade under a rising tone
def('powerDouble', 2, 400, 1.2, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.3, 1);
  let at = t;
  let gap = 0.07;
  for (let i = 0; i < 6; i++) {
    clink(s, at, { v: (0.19 - i * 0.012) * v, d: i === 5 ? 0.3 : 0.13 });
    at += gap + rand(0, 0.012);
    gap = Math.max(0.04, gap * 0.9);
  }
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => s.tone({ f, type: 'triangle', t: t + 0.04 + i * 0.1, d: 0.22, v: 0.1 * v })); // rising
  s.tone({ f: NOTE.E6, t: t + 0.46, d: 0.5, v: 0.09 * v });
});

// Swap Tiles: two tones sliding past each other, a whoosh under them, a little tick where they cross
def('powerSwap', 2, 400, 0.8, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.3, 1);
  s.tone({ f: 420, f2: 960, type: 'triangle', t, a: 0.03, d: 0.5, v: 0.16 * v, pan: -0.5 });
  s.tone({ f: 960, f2: 420, type: 'triangle', t, a: 0.03, d: 0.5, v: 0.16 * v, pan: 0.5 });
  s.noise({ t, a: 0.12, d: 0.45, v: 0.07 * v, f: 700, f2: 2600, q: 0.8 });
  s.tone({ f: 1318.5, t: t + 0.24, d: 0.16, v: 0.08 * v });
});

// Steal a Roll: a quick whoosh-snatch, then a die rattle
def('powerSteal', 2, 400, 0.9, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.3, 1);
  s.noise({ t, a: 0.05, d: 0.18, v: 0.16 * v, f: 500, f2: 3200, q: 0.9 }); // the grab
  s.tone({ f: 260, f2: 520, type: 'triangle', t: t + 0.12, d: 0.07, v: 0.16 * v }); // the snatch
  s.noise({ t: t + 0.17, d: 0.03, v: 0.14 * v, f: 3000, q: 1.6 });
  s.rattle({ t: t + 0.22, d: 0.4, hits: 9, v: 0.15 * v, decay: 0.35 });
  s.tone({ f: 175, f2: 100, t: t + 0.55, d: 0.1, v: 0.22 * v }); // it lands
});

// a card expires: a short dry crumble and a low blip
def('powerExpire', 1, 300, 0.5, (s, t, o) => {
  const v = clamp(num(o.vol, 1), 0.2, 1);
  s.rattle({ t, d: 0.22, hits: 8, v: 0.1 * v, f1: 1200, f2: 3200, tickV: 0.03, decay: 0.5 });
  s.noise({ t, d: 0.2, v: 0.05 * v, type: 'lowpass', f: 900 });
  s.tone({ f: 196, f2: 130, type: 'triangle', t: t + 0.2, d: 0.14, v: 0.16 * v });
});

// double buzz
def('error', 2, 200, 0.4, (s, t) => {
  [0, 0.16].forEach((dt) => {
    s.tone({ f: 140, type: 'square', t: t + dt, d: 0.12, v: 0.13 });
    s.tone({ f: 147, type: 'sawtooth', t: t + dt, d: 0.12, v: 0.09 });
  });
});

export const RECIPES = Object.freeze(SOUNDS);
export const SOUND_NAMES = Object.keys(SOUNDS);
