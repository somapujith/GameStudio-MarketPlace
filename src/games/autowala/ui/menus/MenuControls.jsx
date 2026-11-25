// Reusable menu rows. Every interactive row carries `data-nav`, so useMenuInput can move DOM focus between them.
import { useRef } from 'react';
import { ADJUST } from './useMenuInput.js';
import { sliderFromPointer, stepSlider } from './menuNav.js';
import { blip } from './settings.js';

const hover = (e) => {
  if (document.activeElement !== e.currentTarget) {
    e.currentTarget.focus({ preventScroll: true });
    blip('move');
  }
};
const clickBlip = (e) => {
  if (e.detail > 0) blip('ok'); // a real pointer click (keyboard / gamepad activations make their own sound)
};
const register = (el, fn) => {
  if (!el) return;
  if (fn) ADJUST.set(el, fn);
  else ADJUST.delete(el);
};

/** A list row: big label, optional Telugu label beneath, optional value on the right. */
export function NavRow({ label, te, value, onActivate, onAdjust, index = 0, tone = '', hint, children, autoFocus }) {
  return (
    <button
      type="button"
      data-nav
      data-autofocus={autoFocus ? '' : undefined}
      className={`aw-mrow ${tone ? `is-${tone}` : ''}`}
      style={{ '--i': index }}
      onMouseEnter={hover}
      onClick={(e) => {
        clickBlip(e);
        onActivate?.(e);
      }}
      ref={(el) => register(el, onAdjust)}
    >
      <span className="aw-mrow__txt">
        <b>{label}</b>
        {te && <span className="aw-te">{te}</span>}
      </span>
      {hint && <span className="aw-mrow__hint">{hint}</span>}
      {value != null && <span className="aw-mrow__val">{value}</span>}
      {children}
    </button>
  );
}

/** ON / OFF row. Left / Right or Enter flips it. */
export function ToggleRow({ label, te, on, onChange, index }) {
  const flip = () => onChange(!on);
  return (
    <NavRow label={label} te={te} index={index} onActivate={flip} onAdjust={(d) => onChange(d > 0)}>
      <span className={`aw-switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} aria-label={label}>
        <i />
        <em>{on ? 'ON' : 'OFF'}</em>
      </span>
    </NavRow>
  );
}

/** A 0..1 slider row: drag / tap the track, or Left / Right (10 % steps). */
export function SliderRow({ label, te, value, onChange, index = 0, disabled }) {
  const track = useRef(null);
  const setFrom = (e) => onChange(sliderFromPointer(e.clientX, track.current.getBoundingClientRect()));
  return (
    <div
      className={`aw-mrow aw-mrow--slider ${disabled ? 'is-muted' : ''}`}
      style={{ '--i': index }}
      role="slider"
      tabIndex={-1}
      data-nav
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onMouseEnter={hover}
      ref={(el) => register(el, (d) => onChange(stepSlider(value, d)))}
    >
      <span className="aw-mrow__txt">
        <b>{label}</b>
        {te && <span className="aw-te">{te}</span>}
      </span>
      <div
        className="aw-slider"
        ref={track}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setFrom(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType === 'touch') setFrom(e);
        }}
      >
        <i style={{ transform: `scaleX(${value})` }} />
        <u style={{ left: `${value * 100}%` }} />
      </div>
      <span className="aw-mrow__val">{Math.round(value * 100)}</span>
    </div>
  );
}

/** A value you cycle through with Enter / Left / Right (quality). */
export function CycleRow({ label, te, value, onCycle, index }) {
  return (
    <NavRow label={label} te={te} index={index} onActivate={() => onCycle(1)} onAdjust={onCycle}>
      <span className="aw-cycle">
        <i aria-hidden="true">&lsaquo;</i>
        <b>{value}</b>
        <i aria-hidden="true">&rsaquo;</i>
      </span>
    </NavRow>
  );
}
