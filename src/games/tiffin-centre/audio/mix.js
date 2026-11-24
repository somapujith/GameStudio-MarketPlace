// Tiffin Centre audio: the ambience MIX, pure. The continuous hour of the shift (6.0 .. 29.0, 24h clock) decides how loud every
// ambience layer is. Dayparts are anchors on a circular 24h clock and the levels glide between neighbouring anchors with a
// smoothstep, so the soundscape crossfades with the sky instead of switching at 11:00 sharp.
//
//   daypartWeights(hour) -> { dawn, morning, noon, evening, night }   (sums to 1; at most two are non-zero)
//   layerLevels(hour, busy?) -> { traffic, crowd, ..., birds, ... }   0..1 per layer
//   nextDelayMs(def, level, rnd) -> ms until the next one-shot of a sporadic layer (Infinity when it is too quiet)

export const ANCHORS = Object.freeze([
  { id: 'dawn', hour: 5.5 },
  { id: 'morning', hour: 9 },
  { id: 'noon', hour: 13.5 },
  { id: 'evening', hour: 17.75 },
  { id: 'night', hour: 22.5 },
]);

/** Layer level per daypart (0..1). `continuous` layers are loops; `sporadic` ones are one-shots at random gaps. */
export const LAYER_TABLE = Object.freeze({
  // continuous beds
  traffic: { dawn: 0.1, morning: 0.8, noon: 0.5, evening: 0.7, night: 0.22 },
  crowd: { dawn: 0, morning: 0.35, noon: 0.45, evening: 0.85, night: 0.3 },
  heat: { dawn: 0, morning: 0.1, noon: 0.85, evening: 0.12, night: 0 },
  cicadas: { dawn: 0, morning: 0.15, noon: 0.85, evening: 0.2, night: 0 },
  crickets: { dawn: 0.3, morning: 0, noon: 0, evening: 0.2, night: 0.85 },
  radio: { dawn: 0, morning: 0, noon: 0, evening: 0.1, night: 0.45 },
  tabla: { dawn: 0, morning: 0, noon: 0, evening: 0.85, night: 0.15 },
  // sporadic one-shots
  birds: { dawn: 1, morning: 0.3, noon: 0, evening: 0.1, night: 0 },
  temple: { dawn: 0.8, morning: 0.1, noon: 0, evening: 0, night: 0 },
  cooker: { dawn: 0, morning: 0.8, noon: 0.15, evening: 0, night: 0 },
  autos: { dawn: 0, morning: 0.3, noon: 0.2, evening: 0.9, night: 0.2 },
  scooter: { dawn: 0.05, morning: 0.8, noon: 0.4, evening: 0.9, night: 0.35 },
  hawkers: { dawn: 0.2, morning: 0.6, noon: 0.2, evening: 0.8, night: 0.1 },
  plates: { dawn: 0, morning: 0.6, noon: 0.5, evening: 0.7, night: 0.1 },
  dogs: { dawn: 0.2, morning: 0, noon: 0, evening: 0.5, night: 0.8 },
});
export const CONTINUOUS_LAYERS = Object.freeze(['traffic', 'crowd', 'heat', 'cicadas', 'crickets', 'radio']);
export const SPORADIC_LAYERS = Object.freeze(['birds', 'temple', 'cooker', 'autos', 'scooter', 'hawkers', 'plates', 'dogs']);

/** How often a sporadic layer fires when its level is 1: gap range in seconds (the gap grows as the level drops). */
export const SPORADIC = Object.freeze({
  birds: { minGap: 1.4, maxGap: 4.5 },
  temple: { minGap: 14, maxGap: 28 },
  cooker: { minGap: 16, maxGap: 32 },
  autos: { minGap: 6, maxGap: 14 },
  scooter: { minGap: 8, maxGap: 18 },
  hawkers: { minGap: 9, maxGap: 20 },
  plates: { minGap: 10, maxGap: 24 },
  dogs: { minGap: 11, maxGap: 24 },
});
/** Below this level a layer is treated as off (nothing built, nothing scheduled). */
export const LAYER_FLOOR = 0.03;

const smooth = (u) => u * u * (3 - 2 * u);

/** Wraps any hour (including 24..29 for after midnight) onto 0..24. */
export const wrapHour = (h) => (((Number(h) || 0) % 24) + 24) % 24;

export function daypartWeights(hour) {
  const h = wrapHour(hour);
  const n = ANCHORS.length;
  // find the anchor pair [a, b] with a.hour <= h < b.hour on the circle (dawn 5.5 follows night 22.5 + 7 h)
  let idx = -1;
  for (let i = 0; i < n; i++) {
    const a = ANCHORS[i].hour;
    const b = i === n - 1 ? ANCHORS[0].hour + 24 : ANCHORS[i + 1].hour;
    const x = i === n - 1 && h < a ? h + 24 : h;
    if (x >= a && x < b) {
      idx = i;
      const u = smooth((x - a) / (b - a));
      const w = Object.fromEntries(ANCHORS.map((p) => [p.id, 0]));
      w[ANCHORS[i].id] = 1 - u;
      w[ANCHORS[(i + 1) % n].id] = u;
      return w;
    }
  }
  const w = Object.fromEntries(ANCHORS.map((p) => [p.id, 0]));
  w[ANCHORS[idx < 0 ? 0 : idx].id] = 1;
  return w;
}

/**
 * Level 0..1 of every layer at `hour`. `busy` (0..1, how full the counter is) lifts the people layers a little so a full
 * stall sounds busier than an empty one without ever overwhelming the effects.
 */
export function layerLevels(hour, busy = 0.5) {
  const w = daypartWeights(hour);
  const b = Math.min(1, Math.max(0, Number.isFinite(busy) ? busy : 0.5));
  const out = {};
  for (const [layer, row] of Object.entries(LAYER_TABLE)) {
    let v = 0;
    for (const id of Object.keys(w)) v += w[id] * (row[id] || 0);
    if (layer === 'crowd' || layer === 'traffic' || layer === 'autos' || layer === 'scooter' || layer === 'hawkers') v *= 0.75 + 0.5 * b;
    out[layer] = Math.min(1, Math.max(0, v));
  }
  return out;
}

/** ms until the next one-shot of a sporadic layer. `rnd` is a 0..1 number. Infinity when the layer is effectively off. */
export function nextDelayMs(def, level, rnd = 0.5) {
  if (!def || !(level >= LAYER_FLOOR)) return Infinity;
  const gap = def.minGap + (def.maxGap - def.minGap) * Math.min(1, Math.max(0, rnd));
  return Math.round((gap / Math.max(0.35, level)) * 1000);
}

/** Hour of a game state (24h clock, decimal): the level's [a, b] hours across its shift ticks. Never throws. */
export function hourOfState(state) {
  try {
    const hr = state?.cfg?.hour;
    const total = Number(state?.shiftTicks) || 0;
    if (Array.isArray(hr) && hr.length === 2 && total > 0) {
      const u = Math.min(1, Math.max(0, (Number(state.tick) || 0) / total));
      return hr[0] + (hr[1] - hr[0]) * u;
    }
    if (Array.isArray(hr) && Number.isFinite(hr[0])) return hr[0];
  } catch {
    /* fall through */
  }
  return 9;
}

/** How full the counter is, 0..1: customers present over the level's places. */
export function busyOfState(state) {
  try {
    const spots = Number(state?.cfg?.spots) || 0;
    if (!spots) return 0.5;
    const n = (state.customers || []).filter((c) => c && c.st !== 'left').length;
    return Math.min(1, n / spots);
  } catch {
    return 0.5;
  }
}
