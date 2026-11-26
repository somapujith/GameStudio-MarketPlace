// The steering wheel (and the two arrow buttons of the "Arrows" mode). The thumb drags AROUND the wheel's centre; the wheel turns with
// it (+-135 degrees) and springs back on release. The wheel's behaviour lives in wheelMath.js; this file is pointers + drawing.
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronIcon } from './icons.jsx';
import { createPointerSlot } from './pointerGuard.js';
import { place } from './layout.js';
import { WHEEL_LOCK, angleAround, createWheel } from './wheelMath.js';

/** The drawn wheel: rim with a pink 12 o'clock marker, three spokes and a centre cap carrying the auto badge. */
export function WheelArt() {
  return (
    <svg viewBox="0 0 200 200" className="aw-ct-wheel__art" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="awctRim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="200">
          <stop offset="0" stopColor="#7a52d6" />
          <stop offset="1" stopColor="#2a1258" />
        </linearGradient>
        <radialGradient id="awctCap" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#ff8cc6" />
          <stop offset="0.55" stopColor="#ff3d9a" />
          <stop offset="1" stopColor="#6a1a66" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="90" fill="rgba(18,8,36,0.5)" />
      <g stroke="url(#awctRim)" strokeLinecap="round">
        <path d="M100 100 L14 100" strokeWidth="15" />
        <path d="M100 100 L186 100" strokeWidth="15" />
        <path d="M100 100 L100 186" strokeWidth="15" />
      </g>
      <g stroke="rgba(255,255,255,0.22)" strokeLinecap="round" strokeWidth="2">
        <path d="M100 94 L22 94M100 94 L178 94M94 100 L94 178" />
      </g>
      <circle cx="100" cy="100" r="85" fill="none" stroke="url(#awctRim)" strokeWidth="17" />
      <circle cx="100" cy="100" r="85" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.6" strokeDasharray="2 5.2" transform="rotate(0 100 100)" />
      <circle cx="100" cy="100" r="93.5" fill="none" stroke="rgba(55,230,255,0.4)" strokeWidth="1.6" />
      <circle cx="100" cy="100" r="76.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.4" />
      <rect x="93" y="8" width="14" height="25" rx="5" fill="#ff3d9a" />
      <rect x="96.6" y="11" width="6.8" height="12" rx="3" fill="#ffd1ea" opacity="0.8" />
      <circle cx="100" cy="100" r="31" fill="url(#awctCap)" stroke="#ffc857" strokeWidth="3" />
      <g transform="translate(100 101)" fill="#2a0f3f">
        <path d="M-17 7.5 -15 -6.5Q-7 -15 8 -13L17 -4 17 7.5Z" fill="#ffc857" />
        <path d="M-13 -5.5Q-6 -11 6 -10L12 -4-13 -4Z" fill="#2a0f3f" />
        <circle cx="-9.5" cy="8.5" r="4.4" />
        <circle cx="11" cy="8.5" r="4.4" />
        <circle cx="-9.5" cy="8.5" r="1.5" fill="#ffc857" />
        <circle cx="11" cy="8.5" r="1.5" fill="#ffc857" />
      </g>
    </svg>
  );
}

/** props: bus, layout (computeLayout result), side ('left'|'right'), fx(kind), getSpeed(), interactive, handleRef (set(deg) to draw an angle) */
export function Wheel({ bus, layout, side, fx, getSpeed, interactive = true, handleRef, children }) {
  const el = useRef(null);
  const rot = useRef(null);
  const ctl = useRef(null);
  const slot = useRef(null);
  const raf = useRef(0);
  const center = useRef({ x: 0, y: 0, r: 1 });
  const [on, setOn] = useState(false);
  if (!ctl.current) ctl.current = createWheel({ lock: WHEEL_LOCK });
  if (!slot.current) slot.current = createPointerSlot();

  const draw = (deg) => {
    if (rot.current) rot.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  };
  useImperativeHandle(handleRef, () => ({ set: draw }), []);

  const lastT = useRef(0);
  const loop = useRef(null);
  loop.current = (t) => {
    const c = ctl.current;
    const last = lastT.current || t;
    lastT.current = t;
    const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
    const out = c.tick(dt, getSpeed?.() || 0);
    draw(out.rot);
    bus.setSteer(out.steer);
    for (const e of out.events) fx(e === 'lock' ? 'bounce' : 'tick');
    if (c.held || out.rot !== 0 || out.steer !== 0) raf.current = requestAnimationFrame(loop.current);
    else {
      raf.current = 0;
      lastT.current = 0;
    }
  };
  const kick = () => {
    if (!raf.current) {
      lastT.current = 0;
      raf.current = requestAnimationFrame(loop.current);
    }
  };

  const release = () => {
    if (!ctl.current.held) return;
    ctl.current.up();
    setOn(false);
    kick();
  };

  const down = (e) => {
    if (!interactive || !slot.current.claim(e)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    const r = el.current.getBoundingClientRect();
    center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    ctl.current.down(angleAround(e.clientX, e.clientY, center.current.x, center.current.y));
    setOn(true);
    fx('tap');
    kick();
  };
  const move = (e) => {
    if (!slot.current.owns(e)) return;
    const c = center.current;
    const dist = Math.hypot(e.clientX - c.x, e.clientY - c.y) / (c.r || 1);
    ctl.current.move(angleAround(e.clientX, e.clientY, c.x, c.y), dist);
    kick();
  };
  const up = (e) => {
    if (slot.current.release(e)) release();
  };

  // everything must let go when the controls hide, the page is backgrounded or the component unmounts
  useEffect(() => {
    const let_go = () => {
      slot.current.release();
      ctl.current.reset();
      draw(0);
      setOn(false);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') let_go();
    };
    window.addEventListener('blur', let_go);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', let_go);
      document.removeEventListener('visibilitychange', onHide);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      ctl.current.reset();
      bus.setSteer(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus]);

  const s = layout.wheel.size;
  return (
    <div
      ref={el}
      className={`aw-ct-wheel ${on ? 'is-on' : ''} ${interactive ? '' : 'is-passive'}`}
      style={{ width: s, height: s, ...place(side, layout.wheel.x, layout.wheel.y) }}
      data-ctl-zone="wheel"
      role="slider"
      aria-label="Steering wheel"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      <span className="aw-ct-wheel__lock" aria-hidden="true" />
      <div className="aw-ct-wheel__rot" ref={rot}>
        <WheelArt />
      </div>
      {children}
    </div>
  );
}

/** The "Arrows" mode: two big buttons, left and right. */
export function ArrowPad({ bus, layout, side, fx }) {
  const state = useRef({ l: false, r: false });
  const slotL = useRef(createPointerSlot());
  const slotR = useRef(createPointerSlot());
  const [lit, setLit] = useState({ l: false, r: false });
  const apply = () => {
    bus.setSteer((state.current.r ? 1 : 0) - (state.current.l ? 1 : 0));
    setLit({ ...state.current });
  };
  useEffect(() => {
    const let_go = () => {
      slotL.current.release();
      slotR.current.release();
      state.current = { l: false, r: false };
      bus.setSteer(0);
      setLit({ l: false, r: false });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') let_go();
    };
    window.addEventListener('blur', let_go);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', let_go);
      document.removeEventListener('visibilitychange', onHide);
      bus.setSteer(0);
    };
  }, [bus]);
  const bind = (key, slot) => ({
    onPointerDown: (e) => {
      if (!slot.current.claim(e)) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* gone */
      }
      state.current[key] = true;
      fx('tap');
      apply();
    },
    onPointerUp: (e) => {
      if (slot.current.release(e)) {
        state.current[key] = false;
        apply();
      }
    },
    onPointerCancel: (e) => {
      if (slot.current.release(e)) {
        state.current[key] = false;
        apply();
      }
    },
    onLostPointerCapture: (e) => {
      if (slot.current.release(e)) {
        state.current[key] = false;
        apply();
      }
    },
  });
  const a = layout.arrows;
  const box = { width: a.w, height: a.h };
  return (
    <div className="aw-ct-arrows" style={{ ...place(side, a.x, a.y), gap: a.gap }} data-ctl-zone="wheel">
      <button type="button" className={`aw-ct-arrow ${lit.l ? 'is-on' : ''}`} style={box} aria-label="Steer left" {...bind('l', slotL)}>
        <ChevronIcon dir="left" size={Math.round(a.w * 0.56)} />
      </button>
      <button type="button" className={`aw-ct-arrow ${lit.r ? 'is-on' : ''}`} style={box} aria-label="Steer right" {...bind('r', slotR)}>
        <ChevronIcon dir="right" size={Math.round(a.w * 0.56)} />
      </button>
    </div>
  );
}
