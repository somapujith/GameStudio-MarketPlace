// Tiffin Centre audio: the musical material, as pure data. The shift-end fanfare (a short Hyderabadi-flavoured phrase on a
// pentatonic scale with tabla-style hits) and the ambient tabla loop are PLANS (note lists); recipes.js turns them into sound.

export const ROOT_HZ = 587.33; // D5: Sa
export const PENTA_MAJOR = Object.freeze([0, 2, 4, 7, 9]); // Sa Re Ga Pa Dha (Bhoopali / Mohanam family): bright, happy
export const PENTA_MINOR = Object.freeze([0, 3, 5, 7, 10]); // the sad cousin

/** Semitones above Sa of scale degree `deg` (0..4 = first octave, 5 = Sa one octave up, negative = below). */
export function degreeSemis(deg, scale = PENTA_MAJOR) {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  return oct * 12 + scale[((deg % n) + n) % n];
}
export const semisToHz = (semis, root = ROOT_HZ) => root * 2 ** (semis / 12);

const STEP = 0.15; // seconds per phrase step

/**
 * The shift-end music. `win` true = major motif (more notes and a bigger finish for more stars); false = a minor sigh.
 * Returns { notes:[{t, semis, d, v, type, bend}], hits:[{t, kind, v}], length } with times in seconds from the start.
 */
export function fanfarePlan({ win = true, stars = 1 } = {}) {
  const notes = [];
  const hits = [];
  if (!win) {
    // a sigh: five falling minor-pentatonic notes, the last one sagging, one soft bayan thud
    const degs = [4, 3, 2, 1, 0];
    degs.forEach((deg, i) => {
      const last = i === degs.length - 1;
      notes.push({ t: i * 0.26, semis: degreeSemis(deg - 5, PENTA_MINOR), d: last ? 1.1 : 0.42, v: 0.13, type: 'triangle', bend: last ? -1.5 : 0 });
    });
    hits.push({ t: 4 * 0.26, kind: 'ge', v: 0.1 });
    return { notes, hits, length: 4 * 0.26 + 1.2 };
  }
  const s = Math.max(1, Math.min(3, Math.trunc(stars) || 1));
  const motif = s === 1 ? [0, 1, 2, 3] : s === 2 ? [0, 1, 2, 3, 2, 3, 4] : [0, 1, 2, 3, 2, 3, 4, 5, 4];
  motif.forEach((deg, i) => notes.push({ t: i * STEP, semis: degreeSemis(deg), d: 0.22, v: 0.15, type: 'triangle', bend: 0 }));
  const endT = motif.length * STEP + 0.04;
  // the held finish: Sa' on top, with the Pa below it (stars 2+) and the Ga above it (3 stars)
  notes.push({ t: endT, semis: degreeSemis(5), d: 0.9 + 0.2 * s, v: 0.17, type: 'triangle', bend: 0 });
  if (s >= 2) notes.push({ t: endT, semis: degreeSemis(3), d: 0.8 + 0.2 * s, v: 0.1, type: 'sine', bend: 0 });
  if (s >= 3) {
    notes.push({ t: endT, semis: degreeSemis(7), d: 1.2, v: 0.09, type: 'sine', bend: 0 });
    [9, 8, 7, 9, 10].forEach((deg, i) => notes.push({ t: endT + 0.12 + i * 0.07, semis: degreeSemis(deg), d: 0.3, v: 0.06, type: 'sine', bend: 0 }));
  }
  // tabla under it: dha on the one, na / ge on the off steps, a dha + tin on the landing
  motif.forEach((_, i) => {
    if (i === 0) hits.push({ t: 0, kind: 'dha', v: 0.13 });
    else if (i % 2 === 0) hits.push({ t: i * STEP, kind: i % 4 === 0 ? 'ge' : 'na', v: 0.09 });
  });
  hits.push({ t: endT, kind: 'dha', v: 0.15 });
  hits.push({ t: endT + 0.02, kind: 'tin', v: 0.1 });
  if (s >= 3) for (let i = 1; i <= 3; i++) hits.push({ t: endT + 0.2 + i * 0.1, kind: i % 2 ? 'na' : 'ti', v: 0.07 });
  return { notes, hits, length: endT + 0.9 + 0.2 * s };
}

/** Keherwa-style 8-step tabla pattern for the quiet evening loop (null = rest). */
export const TABLA_PATTERN = Object.freeze(['dha', 'ge', 'na', 'ti', 'na', 'ge', 'tin', 'na']);
export const TABLA_BPM = 84; // beats per minute; one pattern step = one beat
export const tablaStepSeconds = (bpm = TABLA_BPM) => 60 / bpm / 2; // eighth-note steps
