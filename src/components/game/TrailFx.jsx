import { useState } from 'react';
import { cosmeticById } from '@shared/cosmetics.js';
import '@/styles/trails.css';

/**
 * The effect a pawn trail leaves behind (kind 'trail' in the catalogue: `colors` [a, b] + `finish`).
 * Rendered by the Pawn inside `.hb-pawn__body`, behind the piece, whenever the pawn has taken a step.
 *
 * One hop = one GROUP of 4-10 absolutely positioned CSS-only particles. A group is anchored on the tile the pawn left
 * (the same counter-move the footprint ghost uses, so particles stay put in the world while the pawn walks away) and
 * its particles are strung along the vector to the new tile (`--gx/--gy`, fractions of the ring). Each one is
 * delayed until the pawn passes its spot, then lives about 2.2 x `--hb-step`. That outlasts one hop, so the last
 * few groups stay mounted (keyed by the step number: a running animation is never restarted by the next hop) and
 * each remembers the vector of its own hop. All offsets come from the step number, never Math.random.
 *
 * Particle looks per finish live in trails.css; this file only decides how many there are and where.
 */

/** Particles per hop. Legendary finishes get more, nothing goes past 10. */
export const TRAIL_COUNTS = Object.freeze({
  dust: 6,
  steam: 5,
  petals: 6,
  sparks: 8,
  streak: 4, // main line, glow edge, two echo lines
  coins: 6,
  comet: 5, // tail, glow, head, two specks
  flame: 10, // 9 tongues in three layers + a hot core
  stardust: 10,
});

/** How many hops stay mounted: a particle lives ~2.2 steps and starts up to ~0.8 step into its hop. */
const KEEP = 4;

/** The trail item for an equipped id, or null (unknown id, none, or an item of another kind). */
export function trailItem(id) {
  const item = id ? cosmeticById(id) : null;
  return item && item.kind === 'trail' && TRAIL_COUNTS[item.finish] ? item : null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Inverse of smoothstep: how far into the glide (0..1) the pawn has got when it is `f` of the way along. */
const timeAt = (f) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.min(1, Math.max(0, f))) / 3);

/**
 * The particles of one hop: `{ f, t, ox, oy, s, r, k }`
 *  f  where along the path it is dropped (0 = the tile left, 1 = the tile entered; 0 for a teleport burst)
 *  t  when it starts, in hop lengths (the pawn glides over 0.22-0.78 of a walk step, all of a ride step)
 *  ox/oy  sideways / vertical scatter, -1..1 (ox never near 0 so wobbling things do wobble)
 *  s  size factor, r  rotation in degrees, k  colour / layer index
 */
export function trailParticles(finish, steps, motion) {
  const n = TRAIL_COUNTS[finish] || 0;
  const rnd = mulberry32(steps * 7919 + hash(finish || ''));
  const burst = motion === 'teleport';
  return Array.from({ length: n }, (_, i) => {
    const f = burst ? 0 : Math.min(0.97, (i + rnd()) / n);
    const t = burst ? 0.72 + rnd() * 0.12 : motion === 'ride' ? f : 0.22 + 0.56 * timeAt(f);
    const ox = (rnd() < 0.5 ? -1 : 1) * (0.35 + 0.65 * rnd());
    const oy = rnd() * 2 - 1;
    const s = 0.7 + 0.6 * rnd();
    const r = finish === 'sparks' ? -170 + rnd() * 160 : rnd() * 360; // sparks fan upward
    const k = finish === 'flame' ? (i === n - 1 ? 3 : i % 3) : i % 2;
    return { f: r3(f), t: r3(t), ox: r3(ox), oy: r3(oy), s: r3(s), r: Math.round(r), k };
  });
}

/** One hop's group: its particles, the path it was dropped along and how the pawn moved. */
function makeGroup(n, finish, motion, gx, gy) {
  const kind = motion === 'ride' || motion === 'teleport' ? motion : 'walk';
  const vx = Number.isFinite(gx) ? gx : 0;
  const vy = Number.isFinite(gy) ? gy : 0;
  const burst = kind === 'teleport';
  return {
    n,
    finish,
    kind,
    gx: Number.isFinite(gx) ? vx : null,
    gy: Number.isFinite(gy) ? vy : null,
    // the line / tail points from the tile left to the tile entered; a teleport has no path, only a short tail behind the arrival
    ang: Math.round((Math.atan2(burst ? vy : -vy, burst ? vx : -vx) * 180) / Math.PI),
    len: burst ? 0.28 : r3(Math.hypot(vx, vy)),
    hx: burst ? 0 : r3(-vx),
    hy: burst ? 0 : r3(-vy),
    // when the line / head starts moving and how long it takes, in hop lengths
    g0: kind === 'walk' ? 0.22 : kind === 'ride' ? 0 : 0.7,
    gd: kind === 'walk' ? 0.56 : kind === 'ride' ? 1 : 0.22,
    parts: trailParticles(finish, n, kind),
  };
}

function Group({ g, colors, compact }) {
  const style = { '--ca': colors[0], '--cb': colors[1], '--ang': `${g.ang}deg`, '--len': g.len, '--hx': g.hx, '--hy': g.hy, '--g0': g.g0, '--gd': g.gd };
  if (g.gx != null) {
    style['--gx'] = g.gx;
    style['--gy'] = g.gy;
  }
  return (
    <span className={`tr-fx is-${g.kind}${compact ? ' is-disc' : ''}`} data-finish={g.finish} style={style} aria-hidden="true">
      {g.parts.map((p, i) => (
        <span
          key={i}
          className="tr-p"
          data-k={p.k}
          style={{ '--i': i, '--f': p.f, '--t': p.t, '--ox': p.ox, '--oy': p.oy, '--s': p.s, '--r': `${p.r}deg` }}
        />
      ))}
    </span>
  );
}

/**
 * @param finish   dust | steam | petals | sparks | streak | coins | comet | flame | stardust (anything else draws nothing)
 * @param colors   the item's [a, b] particle colours
 * @param steps    the pawn's step counter: a new value = a new hop = a new group of particles
 * @param motion   'walk' (default) | 'ride' (streams along the skim) | 'teleport' (a short burst at arrival)
 * @param gx,gy    the vector from the previous tile, fractions of the ring (the pawn's `--gx/--gy`); a group keeps its own
 * @param compact  the simple phone disc board: three particles per hop
 */
export default function TrailFx({ finish, colors, steps = 0, motion = null, gx, gy, compact = false }) {
  const [hist, setHist] = useState(() => (steps > 0 && TRAIL_COUNTS[finish] ? [makeGroup(steps, finish, motion, gx, gy)] : []));
  if (!TRAIL_COUNTS[finish] || !(steps > 0) || !Array.isArray(colors)) return null;
  let groups = hist;
  if (!hist.length || steps > hist[hist.length - 1].n) {
    groups = [...hist, makeGroup(steps, finish, motion, gx, gy)].slice(-KEEP);
    setHist(groups); // adjust-state-during-render, like the Pawn's own step counter
  }
  return groups.map((g) => <Group key={g.n} g={g} colors={colors} compact={compact} />);
}
