// OWNER: metro agent. Where the viaduct stands: portal bents (two slender pillars on the road verges joined by a cross-beam that
// carries the deck) every ~28 m along the straight parts of every line. Pillars stand just outside the carriageway
// (road half width + 1.0), never on any road, never in a building, and never in a junction mouth. Pure.
import { sampleIndex } from './metro-track.js';

export const BENT = {
  spacing: 28,
  offset: 1.0, // pillar centre beyond the carriageway edge (m)
  radius: 0.72,
  roadPad: 0.9, // a pillar needs this much clearance from any carriageway
  deckDepth: 2.0, // deck underside below rail level
  beamDepth: 1.5,
  edgeMargin: 3, // no bent this close to the end of a straight piece (the corner fillet)
  jitter: [0, 2.5, -2.5, 5, -5, 7.5, -7.5],
};

/** Consecutive samples of a track that form one straight piece: [{ i0, i1 }] (sample indices, inclusive). */
export function straightPieces(track) {
  const sm = track.samples;
  const out = [];
  let i = 0;
  while (i < sm.length) {
    if (sm[i].arc) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < sm.length && !sm[j + 1].arc && sm[j + 1].run === sm[i].run) j++;
    // a straight piece also continues into the neighbouring arc's tangent point (the sample before / after an arc)
    out.push({ i0: i, i1: j });
    i = j + 1;
  }
  return out;
}

/**
 * Plan the bents of all lines.
 * @param city generated city (for road widths we use graph.roads)
 * @param graph from makeGraph (has roads.roadAt)
 * @param lines [{ id, track }]
 * @param isBlocked (x, z, r) => boolean   (buildings / landmarks / shops)
 * @returns {{ bents: Array<{line, x, z, tx, tz, w, half, y}>, pillars: Array<{x, z, h}> }}
 *   bent.y = rail level there; bent.half = lateral distance from the centre line to each pillar centre.
 */
export function planBents(city, graph, lines, isBlocked = () => false) {
  const bents = [];
  const pillarMap = new Map();
  const key = (x, z) => `${Math.round(x / 1.6)},${Math.round(z / 1.6)}`;
  for (const line of lines) {
    const track = line.track;
    const sm = track.samples;
    for (const piece of straightPieces(track)) {
      const a = sm[piece.i0];
      const b = sm[piece.i1];
      const len = b.s - a.s;
      if (len < 6) continue;
      const tx = a.tx;
      const tz = a.tz;
      const axisX = Math.abs(tx) > 0.999;
      const axisZ = Math.abs(tz) > 0.999;
      // candidate positions as distances along the piece
      const cand = [];
      if (axisX || axisZ) {
        const c0 = axisX ? a.x : a.z;
        const dir = axisX ? Math.sign(tx) : Math.sign(tz);
        // lattice coordinate multiples of the spacing, in travel order
        const lo = Math.min(c0, c0 + dir * len);
        const hi = Math.max(c0, c0 + dir * len);
        for (let k = Math.ceil(lo / BENT.spacing); k * BENT.spacing <= hi; k++) {
          const d = (k * BENT.spacing - c0) * dir;
          if (d >= BENT.edgeMargin && d <= len - BENT.edgeMargin) cand.push(d);
        }
        cand.sort((p, q) => p - q);
      } else if (len > 14) {
        for (let d = len > 40 ? 6 : len / 2; d <= len - 3; d += BENT.spacing) cand.push(d);
      }
      for (const d0 of cand) {
        for (const jit of BENT.jitter) {
          const d = d0 + jit;
          if (d < BENT.edgeMargin || d > len - BENT.edgeMargin) continue;
          const s = a.s + d;
          const i = sampleIndex(sm, s);
          const f = (s - sm[i].s) / ((sm[i + 1].s - sm[i].s) || 1);
          const x = a.x + tx * d;
          const z = a.z + tz * d;
          const w = sm[i].w;
          const half = w / 2 + BENT.offset;
          const lx = tz; // left normal of the forward tangent
          const lz = -tx;
          const p1 = [x + lx * half, z + lz * half];
          const p2 = [x - lx * half, z - lz * half];
          if (graph.roads.roadAt(p1[0], p1[1], BENT.roadPad) || graph.roads.roadAt(p2[0], p2[1], BENT.roadPad)) continue;
          if (isBlocked(p1[0], p1[1], BENT.radius + 0.2) || isBlocked(p2[0], p2[1], BENT.radius + 0.2)) continue;
          const y = sm[i].y + (sm[i + 1].y - sm[i].y) * f;
          bents.push({ line: line.id, x, z, tx, tz, w, half, y });
          const h = y - BENT.deckDepth - BENT.beamDepth;
          for (const p of [p1, p2]) {
            const k = key(p[0], p[1]);
            const ex = pillarMap.get(k);
            if (!ex) pillarMap.set(k, { x: p[0], z: p[1], h });
            else if (h > ex.h) ex.h = h;
          }
          break;
        }
      }
    }
  }
  return { bents, pillars: [...pillarMap.values()] };
}
