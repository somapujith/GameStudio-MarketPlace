// A pool of K point lights for the stall's many short-range lights (the station flames, the candles, the prep counter's lamp).
//
// three.js bakes the NUMBER of point lights into every lit shader and re-sends all their uniforms on every program change of every frame, so each light costs
// the whole frame (measured: docs/perf/tf-int.md), not only the pixels it reaches. The stall carries 11: the two bulbs, the tube, the street lamp (the
// structural lights, always the same) and eight small ones that are mostly dark: four station flames (only while a dish cooks), two candles (only in a power cut),
// the prep counter's lamp (some levels). Nothing ever needs more than a few of those at once, and the player only sees the one or two nearest.
//
// The small lights are taken out of what the camera draws (they move to POOL_LAYER, which no camera renders: three.js neither counts them in the shader nor
// uploads them) and K proxy lights on layer 0 stand in for the K strongest of them, nearest to the eye first. A proxy takes its colour, range, decay, intensity and
// world position from the source it currently serves, and a handover fades the old source out and the new one in (FADE seconds) so a flame that starts or a
// candle that dies never pops. No game file is touched: the sources keep animating their own intensity; this reads it after the frame's update.
import { PointLight, Vector3 } from 'three';

/** The layer the pooled sources live on: no camera ever renders it, so three.js does not see those lights. */
export const POOL_LAYER = 7;
/** Seconds a proxy takes to fade a source out (and the next one in). */
export const FADE = 0.18;
/** Point lights with a range up to this many metres are pooled; the bulbs (7.5 m), the tube (8 m) and the street lamp (30 m) are structural and stay real. */
export const POOL_MAX_RANGE = 6;

/**
 * How much a source matters now: its intensity, damped by how far it is from the eye (a flame under the cook's nose counts, one at the far end of the counter much
 * less). 0 for a dark source, so a dead flame never holds a slot.
 */
export const sourceScore = (intensity, distToEye) => (intensity > 0.02 ? intensity / (1 + (distToEye * distToEye) / 6) : 0);

/**
 * Which source each slot serves. `scores[i]` is source i's score, `prev[s]` the source slot s served last frame (-1 = none). The k best live sources are chosen; a
 * slot keeps its source while it is still among them (so nothing swaps without cause), free slots take the best of the rest. Returns a new array of length k.
 */
export function assignSlots(scores, k, prev = []) {
  const order = [];
  for (let i = 0; i < scores.length; i++) if (scores[i] > 0) order.push(i);
  order.sort((a, b) => scores[b] - scores[a] || a - b);
  const keep = new Set(order.slice(0, k));
  const out = new Array(k).fill(-1);
  const used = new Set();
  for (let s = 0; s < k; s++) {
    const p = prev[s] ?? -1;
    if (p >= 0 && keep.has(p) && !used.has(p)) {
      out[s] = p;
      used.add(p);
    }
  }
  let next = 0;
  for (let s = 0; s < k; s++) {
    if (out[s] >= 0) continue;
    while (next < order.length && (used.has(order[next]) || !keep.has(order[next]))) next++;
    if (next < order.length) {
      out[s] = order[next];
      used.add(order[next]);
    }
  }
  return out;
}

/** One step of a slot's fade: `w` in 0..1 moves up while the slot serves its wanted source, down while it must hand over. */
export const stepWeight = (w, up, dt, fade = FADE) => Math.min(1, Math.max(0, w + (up ? dt : -dt) / fade));

/**
 * createLightPool({ scene, k }) -> { refresh(), update(dt, eye), setK(k), dispose(), stats }
 * refresh() collects the scene's small point lights (call it when stations / spots are rebuilt and once a second); update(dt, eye) moves the proxies (call it once per
 * frame after everything that animates a light, before the render); setK(0) puts everything back as it was.
 */
export function createLightPool({ scene, k = 3 }) {
  let K = Math.max(0, k | 0);
  const sources = []; // { l: PointLight, layerMask }
  const slots = []; // { light: PointLight, src: -1, want: -1, w: 0 }
  const scores = [];
  const tmp = new Vector3();
  const stats = { pooled: 0, active: 0 };

  const ensureSlots = () => {
    while (slots.length < K) {
      const light = new PointLight(0xffffff, 0, POOL_MAX_RANGE, 2);
      light.userData.tcPool = true;
      light.name = 'light-pool';
      scene.add(light);
      slots.push({ light, src: -1, want: -1, w: 0 });
    }
    while (slots.length > K) scene.remove(slots.pop().light);
  };

  const restore = () => {
    for (const s of sources) s.l.layers.mask = s.mask;
    sources.length = 0;
  };

  const api = {
    stats,
    get k() {
      return K;
    },
    /** Takes every not-yet-pooled small point light off the camera's layers. Returns how many were added. */
    refresh() {
      if (K <= 0) return 0;
      ensureSlots();
      let added = 0;
      scene.traverse((o) => {
        if (!o.isPointLight || o.userData.tcPool) return;
        if (!(o.distance > 0 && o.distance <= POOL_MAX_RANGE)) return;
        if (sources.some((s) => s.l === o)) return;
        sources.push({ l: o, mask: o.layers.mask });
        o.layers.set(POOL_LAYER);
        added++;
      });
      // a source that left the scene (a rebuilt station) is forgotten
      for (let i = sources.length - 1; i >= 0; i--) {
        let alive = false;
        for (let p = sources[i].l; p; p = p.parent) if (p === scene) alive = true;
        if (!alive) {
          for (const s of slots) if (s.src === i || s.want === i) s.src = s.want = -1;
          sources.splice(i, 1);
        }
      }
      stats.pooled = sources.length;
      return added;
    },
    update(dt, eye) {
      if (K <= 0) return;
      const n = sources.length;
      scores.length = n;
      for (let i = 0; i < n; i++) {
        const l = sources[i].l;
        l.getWorldPosition(tmp);
        scores[i] = sourceScore(l.intensity, tmp.distanceTo(eye));
      }
      const prev = slots.map((s) => s.want);
      const want = assignSlots(scores, K, prev);
      let active = 0;
      for (let s = 0; s < K; s++) {
        const slot = slots[s];
        slot.want = want[s];
        // hand over only once the old source has faded out
        if (slot.src !== slot.want) {
          slot.w = stepWeight(slot.w, false, dt);
          if (slot.w <= 0 || slot.src < 0) {
            slot.src = slot.want;
            if (slot.src < 0) slot.w = 0;
          }
        } else if (slot.src >= 0) slot.w = stepWeight(slot.w, true, dt);
        const src = slot.src >= 0 ? sources[slot.src] : null;
        if (!src) {
          slot.light.intensity = 0;
          continue;
        }
        const l = src.l;
        l.getWorldPosition(slot.light.position);
        slot.light.color.copy(l.color);
        slot.light.distance = l.distance;
        slot.light.decay = l.decay;
        slot.light.intensity = l.intensity * slot.w;
        if (slot.light.intensity > 0) active++;
      }
      stats.active = active;
    },
    setK(next) {
      const nk = Math.max(0, next | 0);
      if (nk === K) return;
      K = nk;
      if (K === 0) {
        restore();
        ensureSlots();
        stats.pooled = 0;
      } else {
        ensureSlots();
        api.refresh();
      }
    },
    dispose() {
      K = 0;
      restore();
      ensureSlots();
    },
  };
  return api;
}
