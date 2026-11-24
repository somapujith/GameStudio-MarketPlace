// The Stations dock: every station of the shift with its slots as real buttons, so the whole game is playable without touching the
// canvas. Cooking / ready bars are driven per frame from the shared bus (CSS variables only).
import { useRef } from 'react';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { useFrame } from './hooks.js';
import { dishInfo, slotProgress, slotTarget, stationList } from './hudLogic.js';

function slotLabel(station, s) {
  const where = `${station.name}, slot ${s.idx + 1}`;
  if (s.st === 'cooking') return `${where}: cooking ${dishInfo(s.dish).name}`;
  if (s.st === 'ready') return `${where}: ${dishInfo(s.dish).name} ready. Press to take it`;
  if (s.st === 'burnt') return `${where}: burnt. Press to clear it`;
  return `${where}: empty. Press to choose a dish to cook`;
}

function Slot({ station, s, spotOn, walkOn, onSlot, onFocusTarget, register }) {
  const key = `${station.id}:${s.idx}`;
  return (
    <button
      type="button"
      ref={(el) => register(key, el)}
      className={`tc-hud-slot${spotOn ? ' is-spot' : ''}${walkOn ? ' is-walking' : ''}`}
      data-st={s.st}
      data-spot={`slot:${key}`}
      aria-label={slotLabel(station, s)}
      onClick={() => onSlot(station.id, s.idx)}
      onFocus={(e) => e.currentTarget.matches?.(':focus-visible') && onFocusTarget(slotTarget(station.id, s.idx))}
      onBlur={() => onFocusTarget(null)}
    >
      <span className="tc-hud-slot-ring" aria-hidden="true" />
      <span className="tc-hud-slot-face" aria-hidden="true">
        {s.st === 'empty' && <HudIcon name="plus" size={20} />}
        {(s.st === 'cooking' || s.st === 'ready') && <DishIcon dish={s.dish} size={30} />}
        {s.st === 'burnt' && <HudIcon name="smoke" size={24} />}
        {s.st === 'ready' && (
          <span className="tc-hud-slot-check">
            <HudIcon name="check" size={12} />
          </span>
        )}
      </span>
      <span className="tc-hud-slot-secs" data-secs="" aria-hidden="true" />
    </button>
  );
}

// `renderExtra(station)` is the room kept after a station's slots for a per-station control (e.g. a Tend button on the tawa and kadai).
export default function StationsDock({ state, spot, walking, onSlot, onFocusTarget, renderExtra }) {
  const els = useRef(new Map());
  const register = (key, el) => {
    if (el) els.current.set(key, { el, secs: el.querySelector('[data-secs]'), last: {} });
    else els.current.delete(key);
  };
  useFrame((_t, frac, st) => {
    if (!st) return;
    for (const [key, rec] of els.current) {
      const [id, idx] = key.split(':');
      const pr = slotProgress(st, id, Number(idx), frac);
      const { el, last } = rec;
      const p = pr.st === 'ready' ? 1 - pr.burn : pr.st === 'cooking' ? pr.progress : 0;
      const ps = p.toFixed(3);
      if (last.p !== ps) {
        el.style.setProperty('--p', ps);
        last.p = ps;
      }
      const tone = pr.st === 'ready' ? (pr.burn > 0.8 ? 'crit' : pr.burn > 0.5 ? 'warn' : 'ok') : 'ok';
      if (last.tone !== tone) {
        el.dataset.tone = tone;
        last.tone = tone;
      }
      const text = pr.st === 'cooking' || pr.st === 'ready' ? String(pr.secs) : '';
      if (rec.secs && last.text !== text) {
        rec.secs.textContent = text;
        last.text = text;
      }
    }
  });
  const stations = stationList(state);
  return (
    <nav className="tc-hud-dock" aria-label="Stations">
      {stations.map((st) => (
        <div key={st.id} className={`tc-hud-station${spot.has(`station:${st.id}`) ? ' is-spot' : ''}${walking.has(`station:${st.id}`) ? ' is-walking' : ''}`} data-spot={`station:${st.id}`} data-kind={st.kind} role="group" aria-label={st.name}>
          <span className="tc-hud-station-name">
            <b>{st.name}</b>
            <span className="tc-hud-te">{st.te}</span>
          </span>
          <span className="tc-hud-slots">
            {st.slots.map((s) => (
              <Slot
                key={s.idx}
                station={st}
                s={s}
                spotOn={spot.has(`slot:${st.id}:${s.idx}`)}
                walkOn={walking.has(`slot:${st.id}:${s.idx}`)}
                onSlot={onSlot}
                onFocusTarget={onFocusTarget}
                register={register}
              />
            ))}
            {renderExtra?.(st)}
          </span>
        </div>
      ))}
    </nav>
  );
}
