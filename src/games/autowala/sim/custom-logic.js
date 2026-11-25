// Pure helpers of the customisation system (no three.js, no DOM, so they are unit-tested): which parts of a loadout changed,
// how catalogue ids resolve to look parameters, plate / banner / mud-flap text fitting. OWNER: customisation agent.
import {
  BANNERS,
  BODY_COLORS,
  BUMPERS,
  ENGINE_COVERS,
  MUDFLAP_STYLES,
  WINDOW_FRAMES,
  CURTAINS,
  DASH_TOYS,
  DEFAULT_LOADOUT,
  FINISHES,
  HEADLIGHTS,
  MUDFLAPS,
  PLATE_STYLES,
  ROOF_COLORS,
  ROOF_STYLES,
  SEATS,
  STRIPES,
  TAILLIGHTS,
  TINTS,
  UNDERGLOW,
  WHEELS,
  find,
  getPath,
  normalizeLoadout,
} from '../gameplay/catalog.js';

/** Every loadout path that has a visible (or audible) effect. `diffLoadout` reports changes in these terms. */
export const FIELDS = [
  'paint.body', 'paint.roof', 'paint.finish', 'plate.text', 'plate.style', 'horn',
  'lights.head', 'lights.under', 'lights.tail', 'roofStyle', 'curtains',
  'decals.stripe', 'decals.banner', 'decals.mudflap', 'decals.dash', 'decals.rearWindow', 'decals.rearWindowFrame', 'decals.badge',
  'rear.cover', 'rear.bumper', 'rear.flaps', 'rear.ladder', 'rear.antenna', 'rear.sideGuards',
  'wheels', 'tint', 'interior.seats', 'interior.garland',
];

/** Which fields changed between two loadouts (a raw/null `prev` means "everything"). Both sides are normalised first. */
export function diffLoadout(prev, next) {
  const b = normalizeLoadout(next);
  if (!prev) return [...FIELDS];
  const a = normalizeLoadout(prev);
  return FIELDS.filter((f) => getPath(a, f) !== getPath(b, f));
}

const pick = (list, id, fallback = list[0]) => find(list, id) || fallback;

/** A loadout resolved to catalogue entries (unknown ids fall back to the stock entry, never throws). */
export function resolveLook(raw) {
  const l = normalizeLoadout(raw);
  return {
    loadout: l,
    body: pick(BODY_COLORS, l.paint.body),
    roof: pick(ROOF_COLORS, l.paint.roof),
    finish: pick(FINISHES, l.paint.finish),
    plateStyle: pick(PLATE_STYLES, l.plate.style),
    head: pick(HEADLIGHTS, l.lights.head),
    under: pick(UNDERGLOW, l.lights.under),
    tail: pick(TAILLIGHTS, l.lights.tail),
    roofStyle: pick(ROOF_STYLES, l.roofStyle),
    curtain: pick(CURTAINS, l.curtains),
    stripe: pick(STRIPES, l.decals.stripe),
    mudflap: pick(MUDFLAPS, l.decals.mudflap),
    toy: pick(DASH_TOYS, l.decals.dash),
    wheel: pick(WHEELS, l.wheels),
    seat: pick(SEATS, l.interior.seats),
    tint: pick(TINTS, l.tint),
    frame: pick(WINDOW_FRAMES, l.decals.rearWindowFrame),
    cover: pick(ENGINE_COVERS, l.rear.cover),
    bumper: pick(BUMPERS, l.rear.bumper),
    flaps: pick(MUDFLAP_STYLES, l.rear.flaps),
  };
}

// ---------------------------------------------------------------------------------------------------------------- paint

/**
 * Paint finish -> material numbers. `envK` is how strongly the (subtle) environment reflection shows on that finish, so a
 * chrome auto reads as chrome but a matte one stays matte. Unknown ids fall back to gloss.
 */
export function finishParams(id) {
  const f = pick(FINISHES, id);
  return {
    id: f.id,
    roughness: f.roughness,
    metalness: f.metalness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.id === 'chrome' ? 0.03 : 0.12,
    sheen: !!f.sheen,
    iridescence: f.sheen ? 0.7 : 0,
    envK: { gloss: 0.5, matte: 0.15, metallic: 1.7, pearl: 1.1, chrome: 3.6 }[f.id] ?? 0.5,
  };
}

/** Windscreen tint level 0..3 -> glass colour and opacity (clamped; junk becomes 0). */
export function tintSpec(level) {
  const n = Math.max(0, Math.min(3, Math.floor(Number(level) || 0)));
  return [
    { level: 0, color: '#bfe6f4', opacity: 0.38 },
    { level: 1, color: '#8fb6c4', opacity: 0.55 },
    { level: 2, color: '#34505c', opacity: 0.75 },
    { level: 3, color: '#0a0d14', opacity: 0.93 },
  ][n];
}

/** HSL (all 0..1) written into `out` ([r,g,b], 0..1): no allocation, for per-frame colour cycling. */
export function hslInto(out, h, s = 1, l = 0.5) {
  const hh = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  for (let i = 0; i < 3; i++) {
    const n = i === 0 ? 0 : i === 1 ? 8 : 4;
    const k = (n + hh * 12) % 12;
    out[i] = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  }
  return out;
}

/** HSL (all 0..1) -> [r,g,b] 0..1. */
export const hsl = (h, s = 1, l = 0.5) => hslInto([0, 0, 0], h, s, l);

/** Underglow brightness multiplier cap (keeps the neon gentle, never blows the bloom out). */
export const GLOW_MAX = 1.3;

/** Colour of the underglow at time t: [r,g,b] 0..1, or null when it is off. Rainbow cycles hue every 8 s. */
export function underglowRgb(entry, t = 0) {
  if (!entry || entry.id === 'off') return null;
  if (entry.cycle) return hsl(t / 8, 0.95, 0.55);
  if (!entry.hex) return null;
  const n = parseInt(entry.hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------------------------------------------------------------------------------------------------------------- text

const TELUGU = /[ఀ-౿]/;
export const isTelugu = (s) => TELUGU.test(String(s ?? ''));

export const FONT_TELUGU = '"Noto Sans Telugu Variable", "Bricolage Grotesque Variable", sans-serif';
export const FONT_LATIN = '"Bricolage Grotesque Variable", Impact, "Arial Black", sans-serif';

/** CSS font stack for a string: the Telugu family when any Telugu letter is present. */
export const fontFamilyFor = (s) => (isTelugu(s) ? FONT_TELUGU : FONT_LATIN);

/**
 * Rough advance width (in em) of a string, used before / without a canvas. Telugu glyph clusters are wide; Latin capitals in a
 * heavy grotesque average ~0.64 em; narrow glyphs (I, 1, punctuation, space) are narrower. Only an estimate: the canvas
 * measure (when present) is the authority, see fitText.
 */
export function estimateWidthEm(text) {
  let em = 0;
  for (const ch of String(text ?? '')) {
    if (TELUGU.test(ch)) em += /[ా-్ౕౖౢౣ]/.test(ch) ? 0.18 : 0.95; // vowel signs and virama add little
    else if (ch === ' ') em += 0.3;
    else if ('Il1i.,:;!\''.includes(ch)) em += 0.32;
    else if ('MWmw@'.includes(ch)) em += 0.95;
    else if (ch >= 'a' && ch <= 'z') em += 0.56;
    else em += 0.66;
  }
  return em;
}

/** Split text into at most `maxLines` lines of similar length, breaking only at spaces (a single long word stays whole). */
export function splitLines(text, maxLines = 2) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const words = t.split(' ');
  if (maxLines <= 1 || words.length === 1) return [t];
  let best = [t];
  let bestScore = Infinity;
  if (maxLines === 2 || words.length === 2) {
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const score = Math.max(estimateWidthEm(a), estimateWidthEm(b));
      if (score < bestScore) { bestScore = score; best = [a, b]; }
    }
    return best;
  }
  // three lines: greedy fill to the ideal width
  const total = estimateWidthEm(t);
  const target = total / maxLines;
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && estimateWidthEm(next) > target * 1.08 && lines.length < maxLines - 1) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit text into a box: returns { lines, fontPx }. `measure(text, fontPx) -> widthPx` defaults to the em estimate; pass the
 * canvas measure for the exact answer. The font is the largest that fits `maxW` x `maxH` (line height 1.12), within [minPx, maxPx].
 * More lines are only used when a single line would be smaller than `minSingle` (so short texts stay on one line).
 */
export function fitText(text, { maxW, maxH, maxLines = 1, minPx = 8, maxPx = 200, minSingle = 0, measure = null, lineHeight = 1.12 } = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const m = measure || ((s, px) => estimateWidthEm(s) * px);
  const solve = (lines) => {
    // widest line at 1px, the font is limited by width and by height
    const w1 = Math.max(...lines.map((s) => m(s, 100) / 100), 0.0001);
    const byW = maxW / w1;
    const byH = maxH / (lines.length * lineHeight);
    return Math.max(minPx, Math.min(maxPx, byW, byH));
  };
  if (!raw) return { lines: [], fontPx: minPx };
  let lines = [raw];
  let fontPx = solve(lines);
  if (maxLines > 1 && fontPx < minSingle) {
    for (let n = 2; n <= maxLines; n++) {
      const l2 = splitLines(raw, n);
      const f2 = solve(l2);
      if (f2 > fontPx) { lines = l2; fontPx = f2; }
    }
  }
  return { lines, fontPx: Math.round(fontPx * 10) / 10 };
}

export const DEFAULT_PLATE = DEFAULT_LOADOUT.plate.text;

/**
 * Plate text as drawn: upper case, A-Z 0-9 space hyphen, whitespace collapsed. Empty falls back to the default plate.
 * Allows up to 12 characters so the stock plate (11 characters) is never truncated.
 */
export function formatPlate(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return clean || DEFAULT_PLATE;
}

/** Font size (px) for a plate of `w` x `h` px: one line, fills the width with `pad` px margins, never taller than 62% of the plate. */
export function plateFontPx(text, w, h, pad = 10, measure = null) {
  return fitText(formatPlate(text), { maxW: w - pad * 2, maxH: h * 0.62, maxLines: 1, minPx: 8, maxPx: h, measure }).fontPx;
}

/** Rear banner: one line, auto-fit to the board. Returns { text, font, fontPx }. */
export function fitBanner(text, w, h, { pad = 16, measure = null } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim() || BANNERS[0].id;
  const r = fitText(t, { maxW: w - pad * 2, maxH: h - pad * 0.9, maxLines: 1, minPx: 10, maxPx: h * 0.78, measure });
  return { text: t, font: fontFamilyFor(t), fontPx: r.fontPx };
}

/** Mud-flap message: up to 2 lines. Returns { lines, font, fontPx } (lines empty for 'none'). */
export function fitMudflap(text, w, h, { pad = 14, measure = null } = {}) {
  const t = String(text ?? '').toUpperCase();
  if (!t.trim()) return { lines: [], font: FONT_LATIN, fontPx: 10 };
  const r = fitText(t, { maxW: w - pad * 2, maxH: h - pad * 1.2, maxLines: 2, minPx: 10, maxPx: h * 0.5, minSingle: h * 0.3, measure });
  return { lines: r.lines, font: fontFamilyFor(t), fontPx: r.fontPx };
}

/** The mud-flap text for a catalogue id ('' for none / unknown). */
export const mudflapText = (id) => find(MUDFLAPS, id)?.text || '';

/** Rear-window sticker lettering (up to 2 lines, big and heavy). Returns { lines, font, fontPx }. */
export function fitRearWindow(text, w, h, { pad = 22, measure = null } = {}) {
  const t = String(text ?? '').toUpperCase().replace(/\s+/g, ' ').trim() || 'AUTO';
  const r = fitText(t, { maxW: w - pad * 2, maxH: h - pad * 1.1, maxLines: 2, minPx: 10, maxPx: h * 0.62, minSingle: h * 0.34, measure });
  return { lines: r.lines, font: fontFamilyFor(t), fontPx: r.fontPx };
}

/** The roof badge: 2-4 letters/digits (& and + allowed), one line. Returns { text, fontPx }. */
export function fitBadge(text, w, h, { pad = 10, measure = null } = {}) {
  const t = String(text ?? '').toUpperCase().replace(/[^A-Z0-9&+]/g, '').slice(0, 4) || 'HA';
  const r = fitText(t, { maxW: w - pad * 2, maxH: h - pad, maxLines: 1, minPx: 8, maxPx: h * 0.8, measure });
  return { text: t, fontPx: r.fontPx };
}

/** Letter colours for the rear-window sticker: white frame -> hot-pink letters, any other frame -> white letters (frame colour outlines them). */
export function windowLetterColors(frameId, frameHex) {
  return frameId === 'white' ? { fill: '#ff3d9a', stroke: '#ffffff' } : { fill: '#ffffff', stroke: frameHex || '#ffffff' };
}
