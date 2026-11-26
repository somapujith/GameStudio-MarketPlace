// The gas and brake pedals. Analogue: the higher the thumb sits inside the pedal, the harder it is pressed (a fill shows it). The brake
// stops the auto first; a NEW press at a standstill reverses (pedalMath.createBrakeGate).
import { useEffect, useRef, useState } from 'react';
import { createPointerSlot } from './pointerGuard.js';
import { place } from './layout.js';
import { createBrakeGate, pedalValue, stepIndex } from './pedalMath.js';

/** props: kind 'gas' | 'brake', box {w,h,x,y}, side, bus, fx(kind), getFwd() (signed forward speed, m/s) */
export function Pedal({ kind, box, side, bus, fx, getFwd }) {
  const el = useRef(null);
  const fill = useRef(null);
  const label = useRef(null);
  const slot = useRef(null);
  const gate = useRef(null);
  const val = useRef(0);
  const steps = useRef(0);
  const raf = useRef(0);
  const [on, setOn] = useState(false);
  if (!slot.current) slot.current = createPointerSlot();
  if (!gate.current) gate.current = createBrakeGate();
  const isBrake = kind === 'brake';

  const paint = (v, mode) => {
    if (fill.current) fill.current.style.height = `${Math.round(v * 100)}%`;
    if (el.current) {
      el.current.style.setProperty('--ct-press', v.toFixed(2));
      if (mode) el.current.dataset.mode = mode;
    }
    if (isBrake && label.current) label.current.textContent = mode === 'reverse' ? 'REVERSE' : mode === 'hold' ? 'HOLD' : 'BRAKE';
  };

  const pushBrake = () => {
    const fwd = getFwd?.() || 0;
    const out = gate.current.output(val.current, fwd);
    bus.setBrake(out, gate.current.down);
    const mode = !gate.current.down ? 'idle' : gate.current.mode === 'stop' && fwd <= 0.8 ? 'hold' : fwd < 0.8 ? 'reverse' : 'brake';
    paint(val.current, mode);
  };
  const loop = () => {
    pushBrake();
    raf.current = gate.current.down ? requestAnimationFrame(loop) : 0;
  };

  const apply = (v) => {
    val.current = v;
    const n = stepIndex(v);
    if (n !== steps.current) {
      fx(n === 3 && n > steps.current ? 'tap' : 'step');
      steps.current = n;
    }
    if (isBrake) pushBrake();
    else {
      bus.setGas(v);
      paint(v, 'on');
    }
  };

  const letGo = () => {
    val.current = 0;
    steps.current = 0;
    if (isBrake) {
      gate.current.release();
      bus.setBrake(0);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    } else bus.setGas(0);
    paint(0, 'idle');
    setOn(false);
  };

  const rectOf = () => {
    const r = el.current.getBoundingClientRect();
    return { top: r.top, height: r.height };
  };
  const down = (e) => {
    if (!slot.current.claim(e)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    setOn(true);
    fx('tap');
    if (isBrake) {
      gate.current.press(getFwd?.() || 0);
      if (!raf.current) raf.current = requestAnimationFrame(loop);
    }
    apply(pedalValue(e.clientY, rectOf()));
  };
  const move = (e) => {
    if (slot.current.owns(e)) apply(pedalValue(e.clientY, rectOf()));
  };
  const up = (e) => {
    if (slot.current.release(e)) letGo();
  };

  useEffect(() => {
    const let_go = () => {
      if (slot.current.release()) letGo();
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
      gate.current.release();
      if (isBrake) bus.setBrake(0);
      else bus.setGas(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus]);

  return (
    <div
      ref={el}
      className={`aw-ct-pedal is-${kind} ${on ? 'is-on' : ''}`}
      style={{ width: box.w, height: box.h, ...place(side, box.x, box.y) }}
      data-ctl-zone="pedal"
      role="button"
      aria-label={isBrake ? 'Brake, hold again at a standstill to reverse' : 'Gas'}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      <span className="aw-ct-pedal__fill" ref={fill} />
      <span className="aw-ct-pedal__grip" aria-hidden="true" />
      <span className="aw-ct-pedal__label" ref={label}>
        {isBrake ? 'BRAKE' : 'GAS'}
      </span>
      {isBrake && <small className="aw-ct-pedal__sub">hold again to reverse</small>}
    </div>
  );
}
