// Money flights: gold coins arc from payer to payee ("string-light gold": money is always physical).
//
//   <FxLayer flights={session.flights} />
//
// `flights` = [{ id, from, to, amount, reason, ms? }] from the presenter; `from` / `to` = a player id or 'bank'.
// Endpoints are found in the DOM: `[data-fx-player="<id>"]` (scoreboard rows; a pawn's `[data-fx-pawn]` as a
// fallback), `[data-fx-bank]` (the board centre). Coins are plain nodes animated with WAAPI (transform /
// opacity only) inside a fixed, pointer-events-none overlay; nothing re-renders React while they fly.
// Each flight id plays once. Reduced motion: nothing flies (the counters still change).

import { useEffect, useRef } from 'react';
import { ANIM_MS } from '@shared/timing.js';
import { motionMs, motionToken, useReducedMotion } from '../ui/helpers.js';
import { arcPoints, coinCount } from './coins.js';
import '@/styles/fx.css';

const BANK = 'bank';
const DEFAULT_MS = ANIM_MS.rentOut + ANIM_MS.rentIn; // a rent payment's out + in, when the presenter gives no ms
const STAGGER = 55;

/** Durations / easing for the sparkle + landing ring, read from the motion tokens (tokens.css) once per flight. */
function motion() {
  const d3 = motionMs('--dur-3', 360);
  return { spark: d3, land: Math.round(d3 * 1.15), ease: motionToken('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)') };
}

const esc = (v) => {
  const s = String(v);
  try {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  } catch {
    return s;
  }
};

/** The first visible element for an endpoint, or null. */
function findEndpoint(who) {
  if (typeof document === 'undefined' || who === undefined || who === null) return null;
  const sels = who === BANK ? ['[data-fx-bank]'] : [`[data-fx-player="${esc(who)}"]`, `[data-fx-pawn="${esc(who)}"]`];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
  }
  return null;
}

const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function spawn(layer, cls, x, y) {
  const el = document.createElement('span');
  el.className = cls;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer.appendChild(el);
  return el;
}

/** Fly one flight; registers its animations in `live` so unmount can cancel them. */
function fly(layer, flight, live) {
  const fromR = findEndpoint(flight.from);
  const toR = findEndpoint(flight.to);
  if (!fromR || !toR) return;
  const a = centre(fromR);
  const b = centre(toR);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 8) return;
  const n = coinCount(flight.amount);
  const mo = motion();
  const ms = Math.max(280, Math.min(1400, Number(flight.ms) || DEFAULT_MS));
  const dur = Math.max(240, ms - STAGGER * (n - 1));
  const track = (anim, el) => {
    live.add(anim);
    const done = () => {
      live.delete(anim);
      el.remove();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  };

  for (let i = 0; i < n; i++) {
    const bias = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const pts = arcPoints(a, b, { steps: 10, lift: 0.32 + (i % 3) * 0.05, bias: bias * 0.6 });
    const coin = spawn(layer, 'fx-coin', a.x, a.y);
    const frames = pts.map((p, k) => {
      const t = k / (pts.length - 1);
      const s = 0.55 + Math.sin(t * Math.PI) * 0.6; // grows towards the apex, shrinks into the payee
      return {
        transform: `translate(${(p.x - a.x).toFixed(1)}px, ${(p.y - a.y).toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)}) rotate(${Math.round(t * 540)}deg)`,
        opacity: t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1,
      };
    });
    const anim = coin.animate(frames, { duration: dur, delay: i * STAGGER, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' });
    track(anim, coin);

    // a short gold sparkle trail behind the first coins
    if (i < 3) {
      for (const t of [0.35, 0.6]) {
        const p = pts[Math.round(t * (pts.length - 1))];
        const sp = spawn(layer, 'fx-spark', p.x, p.y);
        const sa = sp.animate(
          [
            { transform: 'translate(-50%, -50%) scale(.2)', opacity: 0 },
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
          ],
          { duration: mo.spark, delay: i * STAGGER + dur * t, easing: mo.ease, fill: 'both' },
        );
        track(sa, sp);
      }
    }
  }

  // the payee's ring flashes once as the coins land
  const ring = spawn(layer, 'fx-land', b.x, b.y);
  const ra = ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.9, offset: 0.35 },
      { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 },
    ],
    { duration: mo.land, delay: dur * 0.9 + STAGGER * (n - 1), easing: mo.ease, fill: 'both' },
  );
  track(ra, ring);
}

export default function FxLayer({ flights }) {
  const reduced = useReducedMotion();
  const layer = useRef(null);
  const started = useRef(new Set());
  const live = useRef(new Set());

  useEffect(() => {
    const el = layer.current;
    if (!el || !Array.isArray(flights)) return;
    for (const f of flights) {
      if (!f || f.id === undefined || started.current.has(f.id)) continue;
      started.current.add(f.id);
      if (reduced || typeof el.animate !== 'function') continue;
      try {
        fly(el, f, live.current);
      } catch {
        /* an effect must never take the table down */
      }
    }
    // forget ids the presenter has already expired (keeps the set small)
    if (started.current.size > 64) {
      const keep = new Set(flights.map((f) => f && f.id));
      for (const id of started.current) if (!keep.has(id)) started.current.delete(id);
    }
  }, [flights, reduced]);

  useEffect(() => {
    const anims = live.current;
    return () => {
      for (const a of [...anims]) {
        try {
          a.cancel();
        } catch {
          /* ignore */
        }
      }
      anims.clear();
    };
  }, []);

  return <div className="fx-layer" ref={layer} aria-hidden="true" />;
}
