// Facial expression model: pure math (no three, node-safe). Action units (AUs) are the morph-target channels of the head mesh
// (face.js builds one morph target per AU); eyelids, gaze, flush and head posture are separate channels.
//
//   const e = new ExpressionState(seed);
//   e.setExpression('angry', 1, 250);   // blend to a named expression (weight 0..1 scales it from neutral) over blendMs
//   e.setSpeaking(1800, 0.8);           // mouth + nods for 1.8 s
//   e.update(dt, t);                    // then read e.au (Float32Array, AU_NAMES order), e.lidOpen, e.lidSquint, e.flush, ...

export const AU_NAMES = [
  'jawOpen', // 0  the jaw hinges down
  'smileL', // 1  mouth corner up and out, cheek lifts
  'smileR', // 2
  'frownL', // 3  mouth corner down
  'frownR', // 4
  'pucker', // 5  lips forward and together ("oo")
  'stretch', // 6  corners drawn back ("ee", grin, cry)
  'lipsPress', // 7  lips thin and pressed
  'upperLipUp', // 8  snarl, shows the upper teeth
  'browDownL', // 9  lowered and drawn together
  'browDownR', // 10
  'browInnerUp', // 11 inner ends raised (worry, sad)
  'browUpL', // 12 raised (surprise)
  'browUpR', // 13
  'noseWrinkle', // 14 sneer, nostrils flare
  'chinUp', // 15 chin boss pushed up (sad, doubtful)
];
export const AU = Object.fromEntries(AU_NAMES.map((n, i) => [n, i]));

export const EXPRESSION_NAMES = ['neutral', 'bored', 'impatient', 'angry', 'happy', 'delighted', 'eating', 'paying', 'sheepish', 'surprised', 'laughing', 'sad'];

// lid: upper-lid opening 0 (shut) .. 1 (wide); neutral 0.55. squint: lower lid raised 0..1. flush: red cheeks 0..1.
// head: posture offsets in radians (pitch + = down, roll + = tilt to the character's left, yaw). gaze: eye bias (radians, x + = left, y + = up).
const E = (au, lid = 0.55, squint = 0, flush = 0, head = [0, 0, 0], gaze = [0, 0], sweat = 0) => ({ au, lid, squint, flush, head, gaze, sweat });

export const EXPRESSIONS = {
  neutral: E({}),
  bored: E({ frownL: 0.18, frownR: 0.18, jawOpen: 0.05, browInnerUp: 0.08, lipsPress: 0.1 }, 0.36, 0, 0, [0.05, 0.12, 0], [0, -0.08]),
  impatient: E({ lipsPress: 0.65, browDownL: 0.35, browDownR: 0.35, frownL: 0.3, frownR: 0.3, noseWrinkle: 0.12, chinUp: 0.2 }, 0.6, 0.12, 0.08, [-0.02, -0.06, 0.05], [0.05, 0.02]),
  angry: E({ browDownL: 1, browDownR: 1, noseWrinkle: 0.55, upperLipUp: 0.4, stretch: 0.25, frownL: 0.55, frownR: 0.55, jawOpen: 0.16, chinUp: 0.2 }, 0.52, 0.45, 0.85, [0.08, 0, 0], [0, 0.0], 0.15),
  happy: E({ smileL: 0.75, smileR: 0.75, browUpL: 0.12, browUpR: 0.12, stretch: 0.1 }, 0.55, 0.35, 0.12, [-0.03, 0, 0]),
  delighted: E({ smileL: 1, smileR: 1, jawOpen: 0.3, browUpL: 0.5, browUpR: 0.5, stretch: 0.35 }, 0.78, 0.5, 0.25, [-0.1, 0, 0]),
  eating: E({ lipsPress: 0.35, smileL: 0.15, smileR: 0.15, chinUp: 0.1 }, 0.46, 0.1, 0.05, [0.12, 0, 0], [0, -0.22]),
  paying: E({ smileL: 0.38, smileR: 0.38, browUpL: 0.2, browUpR: 0.2 }, 0.6, 0.1, 0.05, [0, 0, -0.04], [0, 0.05]),
  sheepish: E({ smileL: 0.45, smileR: 0.1, browInnerUp: 0.75, browDownL: 0.1, lipsPress: 0.2, chinUp: 0.2 }, 0.5, 0.1, 0.4, [0.14, -0.2, 0.1], [0.28, -0.18]),
  surprised: E({ jawOpen: 0.55, browUpL: 1, browUpR: 1, browInnerUp: 0.5, pucker: 0.15 }, 1, 0, 0.05, [-0.08, 0, 0], [0, 0.05]),
  laughing: E({ jawOpen: 0.62, smileL: 1, smileR: 1, stretch: 0.5, browUpL: 0.35, browUpR: 0.35 }, 0.3, 0.85, 0.35, [-0.16, 0.05, 0.1]),
  sad: E({ frownL: 1, frownR: 1, browInnerUp: 1, chinUp: 0.65, lipsPress: 0.2, browDownL: 0.1, browDownR: 0.1 }, 0.42, 0.15, 0.1, [0.14, 0, 0.07], [0, -0.22]),
};

/** The 6 gameplay moods mapped to a default expression (patience can tint 'waiting'). */
export function expressionForMood(mood, patience = 1) {
  switch (mood) {
    case 'eating':
      return 'eating';
    case 'paying':
      return 'paying';
    case 'happy':
      return 'delighted';
    case 'angry':
      return 'angry';
    case 'walkaway':
      return 'sheepish';
    default:
      return patience > 0.66 ? 'neutral' : patience > 0.4 ? 'bored' : patience > 0.2 ? 'impatient' : 'angry';
  }
}

const NAUS = AU_NAMES.length;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
function hash1(n) {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const vec = (name) => {
  const e = EXPRESSIONS[name] || EXPRESSIONS.neutral;
  const au = new Float32Array(NAUS);
  for (const k of Object.keys(e.au)) if (AU[k] !== undefined) au[AU[k]] = e.au[k];
  return au;
};
const VECS = Object.fromEntries(EXPRESSION_NAMES.map((n) => [n, vec(n)]));

export class ExpressionState {
  constructor(seed = 0) {
    this.seed = (seed | 0) >>> 0;
    this.name = 'neutral';
    this.weight = 1;
    this.blendMs = 250;
    this.au = new Float32Array(NAUS); // current (after blending + speech + chew)
    this.base = new Float32Array(NAUS); // blended expression only
    this.lidOpen = 0.55;
    this.lidSquint = 0;
    this.flush = 0;
    this.sweat = 0;
    this.headPitch = 0;
    this.headRoll = 0;
    this.headYaw = 0;
    this.gazeX = 0;
    this.gazeY = 0;
    this.blink = 0; // 0 open .. 1 closed
    this.speakAmt = 0; // smoothed mouth activity 0..1 (read by head nods)
    this.nodPitch = 0;
    this.nodYaw = 0;
    this.chew = 0;
    this.speakUntil = -1;
    this.speakStart = 0;
    this.speakIntensity = 0;
    this._pendingSpeak = null;
    this.nextBlink = 1 + hash1(this.seed) * 3;
    this.blinkIdx = 0;
    this.blinkT0 = -10;
    this.blinkLen = 0.17;
    this._t = 0;
    this._first = true;
  }

  /** Blend towards a named expression (weight scales it from neutral) over `blendMs`. Unknown names fall back to neutral. */
  setExpression(name, weight = 1, blendMs = 250) {
    this.name = EXPRESSIONS[name] ? name : 'neutral';
    this.weight = clamp(fin(weight, 1));
    this.blendMs = Math.max(0, fin(blendMs, 250));
    if (this.blendMs === 0) this._snap = true;
  }

  /** The mouth moves (and the head nods a little) for `ms` milliseconds at 0..1 intensity, measured from the next update's `t`. */
  setSpeaking(ms, intensity = 0.7) {
    const d = Math.max(0, fin(ms, 0)) / 1000;
    this._pendingSpeak = { d, i: clamp(fin(intensity, 0.7)) };
  }
  get speaking() {
    return this._t < this.speakUntil;
  }

  /** Force a blink now (gaze shifts, surprise). */
  blinkNow() {
    this.blinkT0 = this._t;
  }

  update(dt, t) {
    const d = clamp(fin(dt, 0.016), 0, 0.1);
    const tt = fin(t, this._t + d);
    this._t = tt;
    if (this._pendingSpeak) {
      this.speakStart = tt;
      this.speakUntil = tt + this._pendingSpeak.d;
      this.speakIntensity = this._pendingSpeak.i;
      this._pendingSpeak = null;
    }
    const E0 = EXPRESSIONS[this.name];
    const tv = VECS[this.name];
    const w = this.weight;
    const k = this._snap || this._first ? 1 : this.blendMs <= 0 ? 1 : 1 - Math.exp((-3 * d) / (this.blendMs / 1000));
    this._snap = false;
    this._first = false;
    for (let i = 0; i < NAUS; i++) this.base[i] += (tv[i] * w - this.base[i]) * k;
    const lt = 0.55 + (E0.lid - 0.55) * w;
    this.lidOpen += (lt - this.lidOpen) * k;
    this.lidSquint += (E0.squint * w - this.lidSquint) * k;
    this.flush += (E0.flush * w - this.flush) * k;
    this.sweat += (E0.sweat * w - this.sweat) * k;
    this.headPitch += (E0.head[0] * w - this.headPitch) * k;
    this.headYaw += (E0.head[1] * w - this.headYaw) * k;
    this.headRoll += (E0.head[2] * w - this.headRoll) * k;
    this.gazeX += (E0.gaze[0] * w - this.gazeX) * k;
    this.gazeY += (E0.gaze[1] * w - this.gazeY) * k;

    const au = this.au;
    au.set(this.base);

    // speech: syllables at ~6 Hz with a random open amount, now and then rounded ("oo") or wide ("ee")
    const speaking = tt < this.speakUntil;
    const target = speaking ? this.speakIntensity : 0;
    this.speakAmt += (target - this.speakAmt) * (1 - Math.exp(-14 * d));
    if (this.speakAmt > 0.01) {
      const ph = (tt - this.speakStart) * (5.2 + 2.2 * hash1(this.seed + 7));
      const idx = Math.floor(ph);
      const f = ph - idx;
      const amp = 0.25 + 0.75 * hash1(this.seed * 13 + idx);
      const env = Math.sin(Math.PI * Math.min(1, f * 1.15)); // open and close inside each syllable
      const vis = hash1(this.seed * 7 + idx * 3 + 1);
      const sa = this.speakAmt;
      au[AU.jawOpen] += sa * amp * env * 0.62;
      if (vis > 0.72) au[AU.pucker] += sa * env * 0.7;
      else if (vis < 0.3) au[AU.stretch] += sa * env * 0.5;
      au[AU.browUpL] += sa * 0.14 * hash1(this.seed + idx * 5 + 2) * env;
      au[AU.browUpR] += sa * 0.14 * hash1(this.seed + idx * 5 + 3) * env;
      au[AU.lipsPress] *= 1 - sa * 0.7;
      this.nodPitch = sa * (0.035 * Math.sin(ph * Math.PI * 0.6) + 0.02 * (amp - 0.5));
      this.nodYaw = sa * 0.025 * Math.sin(ph * 0.9 + 1.3);
    } else {
      this.nodPitch *= 0.85;
      this.nodYaw *= 0.85;
    }

    // chewing: the jaw works while eating, mouth mostly shut
    const eatW = this.name === 'eating' ? this.weight : 0;
    this.chew += (eatW - this.chew) * (1 - Math.exp(-6 * d));
    if (this.chew > 0.01) {
      const c = 0.5 + 0.5 * Math.sin(tt * 2 * Math.PI * 2.3);
      au[AU.jawOpen] += this.chew * (0.03 + 0.17 * c);
      au[AU.lipsPress] *= 1 - this.chew * 0.55 * c;
      au[AU.chinUp] += this.chew * 0.15 * (1 - c);
    }

    for (let i = 0; i < NAUS; i++) au[i] = clamp(au[i]);

    // blinks every 2..6 s (an eating or surprised face blinks less); a blink closes fast and opens a bit slower
    if (tt >= this.nextBlink) {
      this.blinkT0 = tt;
      this.blinkIdx += 1;
      const dbl = hash1(this.seed * 31 + this.blinkIdx * 17) < 0.14;
      this.nextBlink = tt + (dbl ? 0.32 : 2 + 4 * hash1(this.seed * 5 + this.blinkIdx * 11));
    }
    const bt = tt - this.blinkT0;
    if (bt >= 0 && bt < this.blinkLen) {
      const u = bt / this.blinkLen;
      this.blink = u < 0.38 ? u / 0.38 : Math.max(0, 1 - (u - 0.38) / 0.62);
    } else this.blink = 0;
    if (this.name === 'surprised' && this.weight > 0.5) this.blink *= 0.4;
  }
}
