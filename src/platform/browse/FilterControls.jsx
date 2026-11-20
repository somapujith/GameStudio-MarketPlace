// The three filter groups (players, time, status) as ticket-style segmented pills. Used inline on wide screens
// (changes apply at once) and inside the phone filter sheet (changes are a draft until Apply).
import { DURATION_OPTIONS, PLAYER_OPTIONS, STATUS_OPTIONS } from './filters.js';

function Segmented({ label, value, options, onPick, idPrefix, showHint = false, minCol = 44 }) {
  return (
    <div className="bw-group" role="group" aria-labelledby={`${idPrefix}-lbl`}>
      <span id={`${idPrefix}-lbl`} className="bw-group__label">
        {label}
      </span>
      <div className="bw-seg" style={{ '--bw-col': `${minCol}px` }}>
        {options.map((o) => (
          <button key={o.id} type="button" className="bw-seg__btn" aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
            {o.label}
            {showHint && (o.tiny || o.hint) ? <small>{o.tiny || o.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FilterControls({ state, onChange, idPrefix = 'bf', showHints = false }) {
  return (
    <>
      <Segmented idPrefix={`${idPrefix}-p`} label="Players" value={state.players} options={PLAYER_OPTIONS} onPick={(players) => onChange({ players })} />
      <Segmented idPrefix={`${idPrefix}-d`} label="Time" value={state.dur} options={DURATION_OPTIONS} onPick={(dur) => onChange({ dur })} showHint={showHints} minCol={66} />
      <Segmented idPrefix={`${idPrefix}-s`} label="Status" value={state.status} options={STATUS_OPTIONS} onPick={(status) => onChange({ status })} minCol={88} />
    </>
  );
}
