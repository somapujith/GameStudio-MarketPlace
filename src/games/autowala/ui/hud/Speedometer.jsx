// Gauge cluster: an arc speedometer (big italic km/h), the CNG fuel gauge and the drift / boost charge bar. `pod` (landscape phones and
// tablets) is the slim bottom-centre version: a small dial with the speed inside, the fuel cells and the charge bar beside it.
//
// The SPEED changes at 10 Hz while driving, so it never goes through React: the component renders once with the current speed and then writes the number, the
// needle and the arc straight into the DOM when the store has a new speed (three tiny writes, no render, no diff). Everything else (fuel, charge, boost, the
// limit sign) is a view that changes rarely (hud/views.js selGauge), so React renders it only then.
import { memo, useEffect, useRef } from 'react';
import { BoltIcon, FuelIcon } from './icons.jsx';
import { GAUGE_MAX_KMH, fuelSegments, fuelTone, speedFraction } from './hudLogic.js';
import { LimitSign } from './RulesStrip.jsx';
import { shallowEqual, useSnapStore, useView } from './snapStore.js';
import { selGauge } from './views.js';

// 270-degree dial from 135deg (bottom-left) clockwise to 45deg (bottom-right), radius 82 in a 200x200 box.
const R = 82;
const pt = (deg, r = R) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
};
const [X1, Y1] = pt(135);
const [X2, Y2] = pt(405);
const ARC = `M ${X1.toFixed(2)} ${Y1.toFixed(2)} A ${R} ${R} 0 1 1 ${X2.toFixed(2)} ${Y2.toFixed(2)}`;
const TICKS = Array.from({ length: 13 }, (_, i) => {
  const deg = 135 + (270 * i) / 12;
  const major = i % 2 === 0;
  const [a, b] = [pt(deg, R - 11), pt(deg, R - (major ? 19 : 15))];
  const [lx, ly] = pt(deg, R - 31);
  return { i, major, x1: a[0], y1: a[1], x2: b[0], y2: b[1], lx, ly, label: i * 10 };
});

/** The two things the speed moves on the dial, as the strings the DOM gets (shared by the first render and the live writes, so they can never disagree). */
export const dialValues = (kmh) => {
  const frac = speedFraction(kmh);
  return { rotate: `rotate(${(135 + 270 * frac).toFixed(1)}deg)`, dash: `${(frac * 100).toFixed(2)} 100`, num: String(Math.max(0, Math.round(kmh || 0))) };
};

/** Writes a speed into the gauge DOM under `root`; returns false when the gauge is not there (nothing to do). Pure DOM, unit-tested with fakes. */
export function writeSpeed(root, kmh) {
  if (!root || !root.querySelector) return false;
  const num = root.querySelector('.aw-sp-num');
  const needle = root.querySelector('.aw-sp-needle');
  const fill = root.querySelector('.aw-sp-fill');
  if (!num || !needle || !fill) return false;
  const v = dialValues(kmh);
  // the text node React owns is updated in place (replacing it would orphan React's reference, and its next write would go nowhere)
  if (num.firstChild) {
    if (num.firstChild.data !== v.num) num.firstChild.data = v.num;
  } else num.textContent = v.num;
  needle.style.transform = v.rotate;
  fill.setAttribute('stroke-dasharray', v.dash);
  return true;
}

const Ticks = memo(function Ticks() {
  return TICKS.map((t) => (
    <g key={t.i}>
      <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'aw-sp-tick is-major' : 'aw-sp-tick'} />
      {t.major && (
        <text x={t.lx} y={t.ly} className="aw-sp-lbl" textAnchor="middle" dominantBaseline="central">
          {t.label}
        </text>
      )}
    </g>
  ));
});

function Dial({ kmh, boosting }) {
  const v = dialValues(kmh);
  return (
    <svg className="aw-sp-dial" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="aw-sp-grad" gradientUnits="userSpaceOnUse" x1="30" y1="170" x2="170" y2="170">
          <stop offset="0" stopColor="#37e6ff" />
          <stop offset="0.55" stopColor="#8f6bff" />
          <stop offset="1" stopColor="#ff3d9a" />
        </linearGradient>
      </defs>
      <path d={ARC} className="aw-sp-track" pathLength="100" />
      <Ticks />
      <path d={ARC} className={`aw-sp-fill ${boosting ? 'is-boost' : ''}`} pathLength="100" stroke="url(#aw-sp-grad)" strokeDasharray={v.dash} />
      <g className="aw-sp-needle" style={{ transform: v.rotate }}>
        <circle cx={100 + R} cy="100" r="5.2" className="aw-sp-dot" />
      </g>
    </svg>
  );
}

function FuelBar({ fuel, litres }) {
  const f = fuelTone(fuel);
  const lit = fuelSegments(fuel, 10);
  return (
    <div className={`aw-fuel is-${f.tone}`} role="meter" aria-label="CNG fuel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((fuel || 0) * 100)}>
      <FuelIcon size={15} className="aw-fuel__icon" />
      <div className="aw-fuel__cells">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : ''} />
        ))}
      </div>
      <span className="aw-fuel__txt">{f.label || (Number.isFinite(litres) ? `${litres.toFixed(1)} L` : `${Math.round((fuel || 0) * 100)}%`)}</span>
    </div>
  );
}

/** The gauge, from `snap` (props: a unit test, or any caller that has a snapshot) or from the store's gauge view. `kmh` is the speed to draw FIRST; after that the store drives it. */
function Gauge({ g, kmh, compact, pod, live }) {
  const root = useRef(null);
  const charge = Math.max(0, Math.min(1, g.charge || 0));
  const f = fuelTone(g.fuel);
  // live speed: subscribe once per store and write the DOM directly
  useEffect(() => {
    if (!live) return undefined;
    let last = NaN;
    const apply = () => {
      const s = live.get();
      if (!s) return;
      const k = Math.max(0, Math.round(s.kmh || 0));
      if (k === last) return;
      last = k;
      writeSpeed(root.current, k);
    };
    apply();
    return live.subscribe(apply);
  }, [live]);
  return (
    <div ref={root} className={`aw-sp ${compact ? 'aw-sp--compact' : ''} ${pod ? 'aw-sp--pod' : ''} ${g.boosting ? 'is-boosting' : ''} ${g.drifting ? 'is-drifting' : ''}`} data-max={GAUGE_MAX_KMH}>
      {f.pulse && <div className="aw-sp-warn" role="alert">{f.label}</div>}
      <LimitSign sign={g.sign} />
      <div className="aw-sp-wrap">
        <Dial kmh={kmh} boosting={g.boosting} />
        <div className="aw-sp-read">
          <b className="aw-sp-num">{dialValues(kmh).num}</b>
          <small>km/h</small>
        </div>
      </div>
      <FuelBar fuel={g.fuel} litres={g.fuelLitres} />
      <div className={`aw-charge ${charge >= 0.99 ? 'is-full' : ''}`}>
        <BoltIcon size={14} className="aw-charge__icon" />
        <div className="aw-charge__bar">
          <i style={{ transform: `scaleX(${charge.toFixed(3)})` }} />
        </div>
        <span>{g.boosting ? 'BOOST' : g.drifting ? 'DRIFT' : 'CHARGE'}</span>
      </div>
    </div>
  );
}

/** The gauge cluster of the HUD: reads the store (the speed is live, the rest is a rarely-changing view). `sign` is not a prop any more: it comes with the view. */
function Speedometer({ compact, pod }) {
  const store = useSnapStore();
  const g = useView(selGauge, shallowEqualGauge);
  if (!g) return null;
  const now = store ? store.get() : null;
  return <Gauge g={g} kmh={now ? now.kmh : 0} compact={compact} pod={pod} live={store} />;
}

// the gauge view holds a nested `sign` object: compare it deeply, the rest shallowly
function shallowEqualGauge(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const { sign: sa, ...ra } = a;
  const { sign: sb, ...rb } = b;
  if (!shallowEqual(ra, rb)) return false;
  if (sa === sb) return true;
  if (!sa || !sb) return false;
  return shallowEqual(sa, sb);
}

export default memo(Speedometer);
