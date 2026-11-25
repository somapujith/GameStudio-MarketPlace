// The rules widgets of the HUD (snap.rules): a small speed-limit sign that sits on the speedometer's corner, and a strip of pills above it
// for the signal ahead (lamp + countdown), a speed camera ahead, a police check and the "wanted" badge. All of it comes from
// hudLogic.rulesView, so a missing `rules` just renders nothing.
import { memo } from 'react';
import { CameraIcon, ShieldIcon } from './icons.jsx';
import { formatDistance } from './hudLogic.js';

export const LimitSign = memo(function LimitSign({ sign }) {
  if (!sign) return null;
  return (
    <div className={`aw-limit is-${sign.zone}${sign.speeding ? ' is-over' : ''}`} role="img" aria-label={`Speed limit ${sign.limit} kilometres per hour, ${sign.zoneEn}${sign.speeding ? ', you are speeding' : ''}`} title={`${sign.zoneEn} ${sign.zoneTe}`}>
      <b>{sign.limit}</b>
    </div>
  );
});

function Signal({ s }) {
  return (
    <div className={`aw-rule aw-rule--signal is-${s.state}`} role="group" aria-label={`Signal ahead is ${s.state}${s.secs ? `, ${s.secs} seconds` : ''}, ${formatDistance(s.dist)}`}>
      <span className="aw-lamp" aria-hidden="true">
        <i className={s.state === 'red' ? 'on' : ''} />
        <i className={s.state === 'yellow' ? 'on' : ''} />
        <i className={s.state === 'green' ? 'on' : ''} />
      </span>
      <span className="aw-rule__txt">
        <b>{s.en}</b>
        <span className="aw-te aw-rule__te">{s.te}</span>
        {s.secs > 0 && <em>{s.secs}s</em>}
      </span>
      <small>{formatDistance(s.dist)}</small>
      {s.watched && <i className="aw-rule__eye" title="Police camera on this signal" aria-hidden="true" />}
    </div>
  );
}

function Camera({ c }) {
  return (
    <div className={`aw-rule aw-rule--camera${c.over ? ' is-over' : ''}`} role="group" aria-label={`Speed camera ahead, limit ${c.limit}, ${formatDistance(c.dist)}`}>
      <CameraIcon size={16} className="aw-rule__icon" />
      <span className="aw-rule__txt">
        <b>{c.over ? 'SLOW DOWN' : 'CAMERA'}</b>
        {c.limit > 0 && <em>{c.limit}</em>}
      </span>
      <small>{formatDistance(c.dist)}</small>
    </div>
  );
}

function Checkpoint({ c }) {
  return (
    <div className={`aw-rule aw-rule--check is-${c.phase}`} role="status">
      <ShieldIcon size={16} className="aw-rule__icon" />
      <span className="aw-rule__txt">
        <b>{c.en}</b>
        <span className="aw-te aw-rule__te">{c.te}</span>
      </span>
      {c.phase === 'near' && <small>{formatDistance(c.dist)}</small>}
    </div>
  );
}

function RulesStrip({ view }) {
  if (!view || !(view.signal || view.camera || view.checkpoint || view.wanted)) return null;
  return (
    <div className="aw-rules" aria-label="Road rules">
      {view.checkpoint && <Checkpoint c={view.checkpoint} />}
      {view.wanted && !view.checkpoint && (
        <div className="aw-rule aw-rule--wanted" role="status">
          <ShieldIcon size={16} className="aw-rule__icon" />
          <span className="aw-rule__txt"><b>WANTED</b></span>
        </div>
      )}
      {view.camera && <Camera c={view.camera} />}
      {view.signal && <Signal s={view.signal} />}
    </div>
  );
}

export default memo(RulesStrip);
