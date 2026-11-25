// Bottom-right gauge cluster: an arc speedometer (big italic km/h), the CNG fuel gauge and the drift / boost charge bar.
import { memo } from 'react';
import { BoltIcon, FuelIcon } from './icons.jsx';
import { GAUGE_MAX_KMH, fuelSegments, fuelTone, speedFraction } from './hudLogic.js';
import { LimitSign } from './RulesStrip.jsx';

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

function Dial({ kmh, boosting }) {
  const frac = speedFraction(kmh);
  const deg = 135 + 270 * frac;
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
      {TICKS.map((t) => (
        <g key={t.i}>
          <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'aw-sp-tick is-major' : 'aw-sp-tick'} />
          {t.major && (
            <text x={t.lx} y={t.ly} className="aw-sp-lbl" textAnchor="middle" dominantBaseline="central">
              {t.label}
            </text>
          )}
        </g>
      ))}
      <path d={ARC} className={`aw-sp-fill ${boosting ? 'is-boost' : ''}`} pathLength="100" stroke="url(#aw-sp-grad)" strokeDasharray={`${(frac * 100).toFixed(2)} 100`} />
      <g className="aw-sp-needle" style={{ transform: `rotate(${deg.toFixed(1)}deg)` }}>
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

function Speedometer({ snap, compact, sign }) {
  const kmh = Math.max(0, Math.round(snap.kmh || 0));
  const charge = Math.max(0, Math.min(1, snap.driftCharge || 0));
  const f = fuelTone(snap.fuel);
  return (
    <div className={`aw-sp ${compact ? 'aw-sp--compact' : ''} ${snap.boosting ? 'is-boosting' : ''} ${snap.drifting ? 'is-drifting' : ''}`} data-max={GAUGE_MAX_KMH}>
      {f.pulse && <div className="aw-sp-warn" role="alert">{f.label}</div>}
      <LimitSign sign={sign} />
      <div className="aw-sp-wrap">
        <Dial kmh={kmh} boosting={snap.boosting} />
        <div className="aw-sp-read">
          <b className="aw-sp-num">{kmh}</b>
          <small>km/h</small>
        </div>
      </div>
      <FuelBar fuel={snap.fuel} litres={snap.fuelLitres} />
      <div className={`aw-charge ${charge >= 0.99 ? 'is-full' : ''}`}>
        <BoltIcon size={14} className="aw-charge__icon" />
        <div className="aw-charge__bar">
          <i style={{ transform: `scaleX(${charge.toFixed(3)})` }} />
        </div>
        <span>{snap.boosting ? 'BOOST' : snap.drifting ? 'DRIFT' : 'CHARGE'}</span>
      </div>
    </div>
  );
}

export default memo(Speedometer);
