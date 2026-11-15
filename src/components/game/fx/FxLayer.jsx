// The board effects overlay: money you can see moving, and the little events of the board made visible.
//
//   <FxLayer flights={session.flights} session={session} />
//
// `flights` = [{ id, from, to, amount, reason, ms?, tile? }] from the presenter; `from` / `to` = a player id or 'bank'.
//   * coins arc from payer to payee (gold, spinning, with a sparkle trail; more coins for bigger sums), the payee's
//     avatar gets a 'ting' (ring + pop), and a signed amount with the reason in small caps rises from each side:
//     '-₹34,000 RENT' over the payer, '+₹34,000 RENT' over the payee. Rent also sweeps a light along its tile.
// `session` (optional) = the table's session: its activity log drives the tile effects (a landing ripple + dust, the
//   owner-colour shockwave when a district is bought, a SOLD stamp for an auction, an upgrade sparkle burst, a mortgage
//   padlock, the set-complete ribbon) and `pulseTile(id)` (fx/pulse.js) draws a "look here" ring on any tile.
//
// Endpoints are found in the DOM: `[data-fx-player="<id>"]` (pods / phone strip; a pawn's `[data-fx-pawn]` as a
// fallback), `[data-fx-bank]` (the board centre), `[data-fx-tile="<id>"]`. Everything is a plain pooled node animated
// with WAAPI (transform / opacity only) inside one fixed, pointer-events-none overlay: nothing re-renders React while it
// plays. Effects that sit on the zoomed board are clipped to the camera's view. Each id plays once. The overlay stays
// quiet while the tab is hidden and when the presenter is catching up (a burst of events), and caps what is alive.
// Reduced motion: no flights and no tile effects; the signed amounts still appear (a plain fade, no travel).

import { useEffect, useRef } from 'react';
import { ANIM_MS } from '@shared/timing.js';
import { motionMs, motionToken, useReducedMotion } from '../ui/helpers.js';
import { arcPoints, coinTier, spinTurns } from './coins.js';
import { findEndpoint, clampX, BANK, visibleRect } from './fxDom.js';
import { createRuntime } from './fxRuntime.js';
import { amountSpot, createGovernor, flightPlan, freshEntries, signedAmount, tileEffectsFor, tollTile } from './fxModel.js';
import { motionSet, playTileEffect } from './tileEffects.js';
import { onPulse } from './pulse.js';
import '@/styles/fx.css';

export { visibleRect };

const DEFAULT_MS = ANIM_MS.rentOut + ANIM_MS.rentIn; // a rent payment's out + in, when the presenter gives no ms
const STAGGER = 55;
const MAX_FLIGHTS = 3; // flights in the air at once; more fly as a single coin without the trail
const AMT_MS = 1500;

const motion = () => motionSet({ ms: motionMs, token: motionToken });
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const hidden = () => typeof document !== 'undefined' && document.hidden;

/** One floating amount (+₹34,000 / -₹34,000 + the reason in small caps) rising from an avatar. */
function floatAmount(rt, ep, plan, leg, ctx) {
  if (!ep) return;
  const { rect } = ep;
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const x = clampX(rect.left + rect.width / 2, vw, 64);
  const stack = ctx.stack.get(leg.who) || 0;
  ctx.stack.set(leg.who, stack + 1);
  const { y, dir } = amountSpot(rect, stack);
  const root = rt.pool.acquire(`fx-amt ${leg.sign < 0 ? 'is-loss' : 'is-gain'}${leg.mine ? ' is-me' : ''}`);
  rt.layer.appendChild(root);
  const S = rt.scope(root, () => ctx.stack.set(leg.who, Math.max(0, (ctx.stack.get(leg.who) || 1) - 1)));
  root.style.left = `${x.toFixed(1)}px`;
  root.style.top = `${y.toFixed(1)}px`;
  const n = S.node('fx-amt__n');
  n.textContent = signedAmount(ctx.amount, leg.sign);
  if (plan.label) {
    const r = S.node('fx-amt__r');
    r.textContent = plan.label;
  }
  const delay = leg.when === 'end' ? Math.round(ctx.dur * 0.86 + STAGGER * (ctx.n - 1)) : 0;
  if (ctx.reduced) {
    S.anim(root, [{ opacity: 0, transform: 'translate(-50%, -50%)' }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.15 }, { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -50%)' }], { duration: AMT_MS, delay: 0, easing: 'linear' });
  } else {
    S.anim(
      root,
      [
        { transform: `translate(-50%, -50%) translateY(${-10 * dir}px) scale(0.55)`, opacity: 0 },
        { transform: `translate(-50%, -50%) translateY(${6 * dir}px) scale(1.14)`, opacity: 1, offset: 0.16 },
        { transform: `translate(-50%, -50%) translateY(${12 * dir}px) scale(1)`, opacity: 1, offset: 0.28 },
        { transform: `translate(-50%, -50%) translateY(${40 * dir}px) scale(1)`, opacity: 1, offset: 0.78 },
        { transform: `translate(-50%, -50%) translateY(${58 * dir}px) scale(0.96)`, opacity: 0 },
      ],
      { duration: AMT_MS, delay, easing: ctx.mo.out },
    );
  }
  S.settle();
}

/** The 'ting' on the receiving avatar (it pops) or the flinch on the paying one. Adds to the avatar's own transform. */
function reactAvatar(rt, ep, sign, delay, mo) {
  const el = ep && ep.el;
  if (!el || typeof el.animate !== 'function') return;
  try {
    const frames = sign > 0
      ? [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(0.97)', offset: 0.7 }, { transform: 'scale(1)' }]
      : [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)', offset: 0.2 }, { transform: 'translateX(3px)', offset: 0.45 }, { transform: 'translateX(-2px)', offset: 0.7 }, { transform: 'translateX(0)' }];
    const a = el.animate(frames, { duration: mo.d3 + 80, delay, easing: sign > 0 ? mo.spring : mo.std, composite: 'add' });
    rt.trackExternal(a);
  } catch {
    /* an avatar that cannot animate just does not */
  }
}

/** Fly one flight. */
function fly(rt, flight, ctx) {
  const plan = flightPlan(flight, ctx.me);
  const fromEp = findEndpoint(flight.from);
  const toEp = findEndpoint(flight.to);
  const amount = Math.abs(Number(flight.amount) || 0);
  if (!amount) return;
  const mo = ctx.mo;
  const ms = Math.max(280, Math.min(1400, Number(flight.ms) || DEFAULT_MS));
  const tier = coinTier(amount);
  const busy = ctx.flying() >= MAX_FLIGHTS;
  const n = busy ? 1 : tier.count;
  const dur = Math.max(240, ms - STAGGER * (n - 1));
  const base = { amount, dur, n, mo, reduced: ctx.reduced, stack: ctx.stack };

  // signed amounts: they say how much and why, even when a coin has nowhere to fly (one side is off screen)
  for (const leg of plan.legs) floatAmount(rt, leg.who === flight.from ? fromEp : toEp, plan, leg, base);
  if (ctx.reduced || !fromEp || !toEp) return;

  const a = centre(fromEp.rect);
  const b = centre(toEp.rect);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 8) return;

  const done = ctx.flightStart();
  let open = 0;
  const end = () => {
    open -= 1;
    if (open <= 0) done();
  };
  const arcDelay = (i) => i * STAGGER;

  for (let i = 0; i < n; i += 1) {
    const lead = i === 0;
    const bias = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const pts = arcPoints(a, b, { steps: 14, lift: 0.32 + (i % 3) * 0.05, bias: bias * 0.6 });
    const root = rt.pool.acquire('fx-coin');
    rt.layer.appendChild(root);
    open += 1;
    const S = rt.scope(root, end);
    root.style.left = `${a.x}px`;
    root.style.top = `${a.y}px`;
    const big = lead ? tier.scale : 1;
    const turns = spinTurns(i, n);
    const frames = pts.map((p, k) => {
      const t = k / (pts.length - 1);
      const s = (0.55 + Math.sin(t * Math.PI) * 0.62) * big; // grows towards the apex, shrinks into the payee
      return {
        transform: `translate(${(p.x - a.x).toFixed(1)}px, ${(p.y - a.y).toFixed(1)}px) translate(-50%, -50%) perspective(240px) rotateY(${Math.round(t * turns * 360)}deg) scale(${s.toFixed(3)})`,
        opacity: t < 0.07 ? t / 0.07 : t > 0.93 ? (1 - t) / 0.07 : 1,
      };
    });
    S.anim(root, frames, { duration: dur, delay: arcDelay(i), easing: 'cubic-bezier(.45,.05,.35,1)' });
    S.settle();

    // a sparkle trail behind the lead coin (longer for big sums), a short one behind the second
    if (!busy && (lead || (i === 1 && tier.tier >= 2))) {
      const marks = lead ? [0.22, 0.38, 0.54, 0.7].slice(0, 2 + tier.tier) : [0.3, 0.55];
      marks.forEach((t, m) => {
        const p = pts[Math.round(t * (pts.length - 1))];
        const sp = rt.pool.acquire('fx-spark');
        rt.layer.appendChild(sp);
        open += 1;
        const SS = rt.scope(sp, end);
        sp.style.left = `${p.x}px`;
        sp.style.top = `${p.y}px`;
        const size = 0.7 + (m % 2) * 0.4;
        SS.anim(
          sp,
          [
            { transform: 'translate(-50%, -50%) scale(0.1) rotate(0deg)', opacity: 0 },
            { transform: `translate(-50%, -50%) scale(${size}) rotate(40deg)`, opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%, -50%) scale(0.2) rotate(90deg)', opacity: 0 },
          ],
          { duration: mo.d3 + 80, delay: arcDelay(i) + dur * t, easing: mo.out },
        );
        SS.settle();
      });
    }
  }

  // landing: the payee's avatar 'tings' (ring + pop + four sparkles)
  const landAt = Math.round(dur * 0.9 + STAGGER * (n - 1));
  const ringEl = rt.pool.acquire('fx-land');
  rt.layer.appendChild(ringEl);
  open += 1;
  const RS = rt.scope(ringEl, end);
  ringEl.style.left = `${b.x}px`;
  ringEl.style.top = `${b.y}px`;
  const size = Math.max(40, Math.min(96, Math.max(toEp.rect.width, toEp.rect.height) * 1.25));
  ringEl.style.width = `${size}px`;
  ringEl.style.height = `${size}px`;
  RS.anim(
    ringEl,
    [
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95, offset: 0.3 },
      { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
    ],
    { duration: Math.round(mo.d3 * 1.3), delay: landAt, easing: mo.out },
  );
  RS.settle();
  if (!busy) {
    for (let k = 0; k < 4; k += 1) {
      const ang = (k * 90 + 45) * (Math.PI / 180);
      const sp = rt.pool.acquire('fx-spark is-tiny');
      rt.layer.appendChild(sp);
      open += 1;
      const SS = rt.scope(sp, end);
      sp.style.left = `${b.x}px`;
      sp.style.top = `${b.y}px`;
      const r = size * 0.5;
      SS.anim(
        sp,
        [
          { transform: 'translate(-50%, -50%) translate(0px, 0px) scale(0.2)', opacity: 0 },
          { transform: `translate(-50%, -50%) translate(${(Math.cos(ang) * r * 0.7).toFixed(1)}px, ${(Math.sin(ang) * r * 0.7).toFixed(1)}px) scale(1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(-50%, -50%) translate(${(Math.cos(ang) * r * 1.2).toFixed(1)}px, ${(Math.sin(ang) * r * 1.2).toFixed(1)}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: mo.d3 + 120, delay: landAt + 30, easing: mo.out },
      );
      SS.settle();
    }
  }
  if (plan.legs.some((l) => l.sign > 0 && l.who === flight.to)) reactAvatar(rt, toEp, 1, landAt, mo);
  if (plan.legs.some((l) => l.sign < 0 && l.who === flight.from)) reactAvatar(rt, fromEp, -1, 0, mo);

  // rent: a light sweeps along the tile it is owed on (the board effect belongs with the payment)
  const toll = tollTile(flight);
  if (toll !== null && !busy) ctx.tile({ kind: 'toll', tile: toll, color: flight.to === ctx.me ? '#ffca7a' : '#ff5d73', prio: 2 }, 0);
}

export default function FxLayer({ flights, session }) {
  const reduced = useReducedMotion();
  const layer = useRef(null);
  const rtRef = useRef(null);
  const started = useRef(new Set());
  const ctxRef = useRef({ me: null, stack: new Map(), air: 0, gov: createGovernor() });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // the runtime lives as long as the layer
  useEffect(() => {
    const el = layer.current;
    if (!el) return undefined;
    const rt = createRuntime(el);
    rtRef.current = rt;
    return () => {
      rt.destroy();
      rtRef.current = null;
    };
  }, []);

  /** Draw a tile effect through the governor (skipped while hidden / reduced / catching up). */
  const tileFx = useRef(null);
  tileFx.current = (spec, delayMs = 0) => {
    const rt = rtRef.current;
    if (!rt || reducedRef.current || hidden()) return;
    const token = ctxRef.current.gov.admit({ prio: spec.prio || 1 });
    if (!token) return;
    const run = () => {
      let ok = false;
      try {
        ok = playTileEffect(rt, spec, motion(), () => token.done());
      } catch {
        ok = false;
      }
      if (!ok) token.done();
    };
    if (delayMs > 0) setTimeout(() => rtRef.current && run(), delayMs);
    else run();
  };

  // ---- money flights
  useEffect(() => {
    const rt = rtRef.current;
    if (!rt || !Array.isArray(flights)) return;
    const c = ctxRef.current;
    c.me = sessionRef.current?.me ?? null;
    for (const f of flights) {
      if (!f || f.id === undefined || started.current.has(f.id)) continue;
      started.current.add(f.id);
      if (hidden() || typeof layer.current?.animate !== 'function') continue;
      try {
        fly(rt, f, {
          me: c.me,
          mo: motion(),
          reduced: reducedRef.current,
          stack: c.stack,
          flying: () => c.air,
          flightStart: () => {
            c.air += 1;
            let open = true;
            return () => {
              if (open) c.air = Math.max(0, c.air - 1);
              open = false;
            };
          },
          tile: (spec, delay) => tileFx.current(spec, delay),
        });
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

  // ---- tile effects from the activity log
  const lastLog = useRef(null);
  const log = session?.log;
  useEffect(() => {
    if (!Array.isArray(log)) return;
    // what was already there when the table opened is not replayed (the first look only takes the baseline)
    const { fresh, newest } = freshEntries(log, lastLog.current);
    lastLog.current = newest ?? 0;
    if (!fresh.length) return;
    const s = sessionRef.current;
    const players = s?.display?.players || s?.view?.players || [];
    const colorOf = (id) => players.find((p) => p.id === id)?.color || null;
    const owners = s?.display?.owners || s?.view?.owners || null;
    for (const entry of fresh) {
      for (const spec of tileEffectsFor(entry, { colorOf, owners })) tileFx.current(spec, 0);
    }
  }, [log]);

  // ---- landing ripple + dust
  const landing = session?.display?.landing;
  const lastLanding = useRef(landing);
  useEffect(() => {
    if (lastLanding.current === landing) return;
    lastLanding.current = landing;
    if (!Number.isInteger(landing)) return;
    const s = sessionRef.current;
    const players = s?.display?.players || [];
    const mover = players[s?.display?.turn];
    tileFx.current({ kind: 'land', tile: landing, color: mover?.color || null, prio: 0 }, 0);
  }, [landing]);

  // ---- "look here" pulses (activity feed taps)
  useEffect(
    () =>
      onPulse(({ tile }) => {
        const rt = rtRef.current;
        if (!rt || reducedRef.current || hidden()) return;
        try {
          playTileEffect(rt, { kind: 'pulse', tile }, motion(), null);
        } catch {
          /* ignore */
        }
      }),
    [],
  );

  return <div className="fx-layer" ref={layer} aria-hidden="true" />;
}
