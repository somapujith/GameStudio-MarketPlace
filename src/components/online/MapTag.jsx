import { MapRing, TeText } from './MapPicker.jsx';
import { mapChoice, mapIdOf } from './mapModel.js';
import '@/styles/mappicker.css';

/**
 * "Map: Andhra Aatalu · ఆంధ్ర ఆటలు": a small chip with the map's mini ring, for the lobby header, the join preview,
 * the game menu and the scoreboard. `value` is a map id, room settings or a game cfg (anything else = the default map).
 * `variant="line"` is the quiet in-game version. The Telugu title carries lang="te".
 */
export default function MapTag({ value, variant = 'chip', label = 'Map', ring = true, showTe = true, className = '' }) {
  const id = mapIdOf(value);
  const c = mapChoice(id);
  return (
    <span className={`mp-chip${variant === 'line' ? ' mp-chip--line' : ''}${className ? ` ${className}` : ''}`} style={{ '--mp-accent': c.accent }} data-map={id} data-testid="map-tag">
      {ring && (
        <span className="mp-chip__ring">
          <MapRing cells={c.cells} size={c.size} accent={c.accent} />
        </span>
      )}
      {label ? <span className="mp-chip__k">{label}:</span> : null}
      <span className="mp-chip__name">{c.name}</span>
      {showTe && c.te ? <TeText text={c.te} className="mp-chip__te" /> : null}
    </span>
  );
}
