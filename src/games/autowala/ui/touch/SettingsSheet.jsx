// The small settings sheet opened from the gear: steering mode, hand, size, opacity, auto-throttle, haptics, tilt calibration.
import { CloseIcon, FullscreenIcon } from './icons.jsx';
import { SIZES } from './touchSettings.js';

function Seg({ label, value, options, onChange }) {
  return (
    <div className="aw-ct-row">
      <span className="aw-ct-row__lbl">{label}</span>
      <div className="aw-ct-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className={value === o.value ? 'is-on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, value, onChange }) {
  return (
    <div className="aw-ct-row">
      <span className="aw-ct-row__lbl">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" className={`aw-ct-switch ${value ? 'is-on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}>
        <i />
      </button>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="aw-ct-row">
      <span className="aw-ct-row__lbl">{label}</span>
      <div className="aw-ct-slide">
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{format ? format(value) : value}</output>
      </div>
    </div>
  );
}

const TILT_TEXT = {
  off: '',
  'needs-permission': 'Tap Enable tilt to allow motion sensors.',
  waiting: 'Looking for the motion sensor...',
  live: 'Tilt is live. Hold the phone level and press Calibrate.',
  none: 'No motion sensor found on this device (or the page is not secure). The wheel is used instead.',
  denied: 'Motion access was refused. Allow it in the browser settings, or use the wheel.',
};

/** props: settings, onChange(patch), onReset, onClose, tilt {status, request, calibrate}, fullscreen {supported, active, toggle} */
export default function SettingsSheet({ settings, onChange, onReset, onClose, tilt, fullscreen }) {
  const tiltOn = settings.steering === 'tilt';
  return (
    <div className="aw-ct-sheetwrap" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-ct-sheet" role="dialog" aria-modal="true" aria-label="Touch control settings">
        <header>
          <b>Controls</b>
          <button type="button" className="aw-ct-x" aria-label="Close settings" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>
        <div className="aw-ct-sheet__body">
          <Seg
            label="Steering"
            value={settings.steering}
            onChange={(v) => {
              onChange({ steering: v });
              if (v === 'tilt' && tilt.status === 'needs-permission') tilt.request();
            }}
            options={[{ value: 'wheel', label: 'Wheel' }, { value: 'tilt', label: 'Tilt' }, { value: 'arrows', label: 'Arrows' }]}
          />
          {tiltOn && (
            <div className="aw-ct-tilt">
              <p>{TILT_TEXT[tilt.status] || ''}</p>
              <div className="aw-ct-tilt__btns">
                {tilt.status === 'needs-permission' && (
                  <button type="button" className="aw-ct-pill is-hot" onClick={() => tilt.request()}>Enable tilt</button>
                )}
                <button type="button" className="aw-ct-pill" disabled={tilt.status !== 'live'} onClick={() => tilt.calibrate()}>Calibrate</button>
                <button type="button" className={`aw-ct-pill ${settings.tiltInvert ? 'is-on' : ''}`} aria-pressed={settings.tiltInvert} onClick={() => onChange({ tiltInvert: !settings.tiltInvert })}>Flip direction</button>
              </div>
              <Slider label="Sensitivity" min={0} max={1} step={0.05} value={settings.tiltSens} onChange={(v) => onChange({ tiltSens: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </div>
          )}
          <Seg
            label="Layout"
            value={settings.hand}
            onChange={(v) => onChange({ hand: v })}
            options={[{ value: 'right', label: 'Right-handed' }, { value: 'left', label: 'Left-handed' }]}
          />
          <Seg label="Size" value={settings.size} onChange={(v) => onChange({ size: v })} options={SIZES.map((s) => ({ value: s, label: s }))} />
          <Slider label="Opacity" min={0.35} max={1} step={0.05} value={settings.opacity} onChange={(v) => onChange({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle label="Auto-throttle" hint="Gas stays on until you brake" value={settings.autoThrottle} onChange={(v) => onChange({ autoThrottle: v })} />
          <Toggle label="Vibration" value={settings.haptics} onChange={(v) => onChange({ haptics: v })} />
          <Toggle label="Always show controls" hint="Even with a mouse" value={settings.force} onChange={(v) => onChange({ force: v })} />
          {fullscreen.supported && (
            <div className="aw-ct-row">
              <span className="aw-ct-row__lbl">Full screen</span>
              <button type="button" className="aw-ct-pill" onClick={fullscreen.toggle}>
                <FullscreenIcon size={16} /> {fullscreen.active ? 'Exit' : 'Enter'}
              </button>
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="aw-ct-pill" onClick={onReset} aria-label="Reset to defaults">Reset</button>
          <button type="button" className="aw-ct-pill is-hot" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
