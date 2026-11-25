// "ROAD RAGE": shown above the speedometer only while the traffic agent says snap.rage.active. Heat bar (orange to red), an
// "escaping" bar that fills toward green (LOSE THEM) and a red CAUGHT ring that fills as caughtIn rises. No police imagery.
import { rageView } from './hudLogic.js';

export default function RageMeter({ rage }) {
  const r = rageView(rage);
  if (!r) return null;
  const C = 2 * Math.PI * 17;
  return (
    <div className={`aw-rage ${r.danger ? 'is-danger' : ''}`} role="status" aria-label="Road rage">
      <div className="aw-rage__ring" title="Caught">
        <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
          <circle cx="22" cy="22" r="17" className="aw-rage__track" />
          <circle cx="22" cy="22" r="17" className="aw-rage__caught" strokeDasharray={`${(C * r.caught).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 22 22)" />
        </svg>
        <b>{r.caught > 0.02 ? `${Math.round(r.caught * 100)}` : '!'}</b>
        <small>CAUGHT</small>
      </div>
      <div className="aw-rage__bars">
        <div className="aw-rage__head">
          <b>ROAD RAGE</b>
          {r.chasers > 0 && <em>{r.chasers} on you</em>}
        </div>
        <div className="aw-rage__bar is-heat" aria-label="Heat">
          <i style={{ transform: `scaleX(${r.heat.toFixed(3)})` }} />
        </div>
        <div className="aw-rage__row">
          <span>LOSE THEM</span>
          <div className="aw-rage__bar is-escape" aria-label="Escaping">
            <i style={{ transform: `scaleX(${r.escape.toFixed(3)})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
