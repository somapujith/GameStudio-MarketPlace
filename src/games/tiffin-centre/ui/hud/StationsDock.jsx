// The Stations dock: every station of the shift with its slots as real buttons, so the whole game is playable without touching the
// canvas. Cooking / ready bars are driven per frame from the shared bus (CSS variables only). Levels with stock also get the PREP COUNTER group
// at the end (two job slots + a button that opens the prep sheet), and `renderExtra(station)` puts a Tend button on each pan.
import { useRef } from 'react';
import DishIcon from './DishIcon.jsx';
import HudIcon from './HudIcon.jsx';
import { useFrame } from './hooks.js';
import { dishInfo, slotProgress, slotTarget, stationList } from './hudLogic.js';
import { FLAW_TEXT } from './opsLogic.js';

function slotLabel(station, s) {
  const where = `${station.name}, slot ${s.idx + 1}`;
  const flaw = s.flaw && FLAW_TEXT[s.flaw] ? `, ${FLAW_TEXT[s.flaw].warn}` : '';
  if (s.st === 'cooking') return `${where}: cooking ${dishInfo(s.dish).name}${flaw}`;
  if (s.st === 'ready') return `${where}: ${dishInfo(s.dish).name} ready${flaw}. Press to take it`;
  if (s.st === 'burnt') return `${where}: burnt. Press to clear it`;
  return `${where}: empty. Press to choose a dish to cook`;
}

function Slot({ station, s, spotOn, walkOn, onSlot, onFocusTarget, register }) {
  const key = `${station.id}:${s.idx}`;
  const flaw = s.flaw && (s.st === 'ready' || s.st === 'cooking') ? s.flaw : null;
  return (
    <button
      type="button"
      ref={(el) => register(key, el)}
      className={`tc-hud-slot${spotOn ? ' is-spot' : ''}${walkOn ? ' is-walking' : ''}`}
      data-st={s.st}
      data-flaw={flaw || undefined}
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
      {flaw && (
        <span className="tc-hud-slot-flaw" aria-hidden="true" title={FLAW_TEXT[flaw]?.label}>
          {FLAW_TEXT[flaw]?.label}
        </span>
      )}
      <span className="tc-hud-slot-secs" data-secs="" aria-hidden="true" />
    </button>
  );
}

function prepSlotLabel(s) {
  if (s.st === 'ready') return `Prep job ${s.idx + 1}: ${s.name} ready. Press to collect it`;
  if (s.st === 'cooking') return `Prep job ${s.idx + 1}: ${s.name}, ${s.secs} seconds left${s.paused ? `, paused: ${s.paused.toLowerCase()}` : ''}`;
  return `Prep job ${s.idx + 1}: free. Press to prepare something`;
}

/** The back counter's group: two job slots (tap = collect when ready, else open the sheet) and the Prep button. */
function PrepGroup({ prep, spot, walking, onPrep, register }) {
  return (
    <div
      className={`tc-hud-station${spot.has('station:prep1') ? ' is-spot' : ''}${walking.has('station:prep1') ? ' is-walking' : ''}`}
      data-spot="station:prep1"
      data-kind="prep"
      role="group"
      aria-label="Prep counter"
    >
      <span className="tc-hud-station-name">
        <b>Prep counter</b>
        <span className="tc-hud-te">వెనుక కౌంటర్</span>
      </span>
      <span className="tc-hud-slots">
        {prep.slots.map((s) => (
          <button
            key={s.idx}
            type="button"
            ref={(el) => register(`prep1:${s.idx}`, el)}
            className={`tc-hud-slot is-prep${spot.has(`slot:prep1:${s.idx}`) ? ' is-spot' : ''}`}
            data-st={s.st}
            data-paused={s.paused ? '1' : undefined}
            data-spot={`slot:prep1:${s.idx}`}
            aria-label={prepSlotLabel(s)}
            onClick={() => onPrep({ slot: s.idx, ready: s.ready })}
          >
            <span className="tc-hud-slot-ring" aria-hidden="true" />
            <span className="tc-hud-slot-face" aria-hidden="true">
              {s.st === 'empty' ? <HudIcon name="plus" size={20} /> : <span className="tc-hud-prep-short">{s.short}</span>}
              {s.ready && (
                <span className="tc-hud-slot-check">
                  <HudIcon name="check" size={12} />
                </span>
              )}
            </span>
            <span className="tc-hud-slot-secs" data-secs="" aria-hidden="true" />
          </button>
        ))}
        <button type="button" className="tc-hud-tendbtn is-prep" data-alert={prep.ready ? '1' : undefined} aria-keyshortcuts="P" aria-label="Open the prep counter (P)" onClick={() => onPrep({})}>
          <HudIcon name="prep" size={20} />
          <span>Prep</span>
        </button>
      </span>
    </div>
  );
}

// `renderExtra(station)` is the room kept after a station's slots for a per-station control (a Tend button on the tawa, kadai and steamer).
// `prep` is prepView(state) (or null) and `onPrep({ slot?, ready? })` opens the prep sheet / collects a ready job.
export default function StationsDock({ state, spot, walking, onSlot, onFocusTarget, renderExtra, prep = null, onPrep }) {
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
      const isPrep = st.stations?.[id]?.kind === 'prep';
      const paused = isPrep && rec.el.dataset.paused === '1';
      const { el, last } = rec;
      const p = isPrep ? (pr.st === 'ready' ? 1 : pr.progress) : pr.st === 'ready' ? 1 - pr.burn : pr.st === 'cooking' ? pr.progress : 0;
      const ps = p.toFixed(3);
      if (last.p !== ps) {
        el.style.setProperty('--p', ps);
        last.p = ps;
      }
      const tone = isPrep ? 'ok' : pr.st === 'ready' ? (pr.burn > 0.8 ? 'crit' : pr.burn > 0.5 ? 'warn' : 'ok') : 'ok';
      if (last.tone !== tone) {
        el.dataset.tone = tone;
        last.tone = tone;
      }
      const text = isPrep ? (pr.st === 'cooking' ? (paused ? '||' : String(pr.secs)) : '') : pr.st === 'cooking' || pr.st === 'ready' ? String(pr.secs) : '';
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
      {prep && onPrep && <PrepGroup prep={prep} spot={spot} walking={walking} onPrep={onPrep} register={register} />}
    </nav>
  );
}
