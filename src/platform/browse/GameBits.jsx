// Small pieces shared by BrowseCard and BrowseRow: status badge and the fact chips.
import HubIcon from '@/platform/game/HubIcon.jsx';
import { playersLabel } from '@/platform/home/gameTheme.js';

export const isSoon = (game) => game?.status === 'coming_soon';

export function StatusBadge({ game }) {
  return isSoon(game) ? (
    <span className="hub-badge hub-badge--soon bw-badge">Soon</span>
  ) : (
    <span className="hub-badge bw-badge bw-badge--live">
      <i className="st-live" aria-hidden="true" />
      Live
    </span>
  );
}

/** Players, duration and (when the manifest has them) up to `tags` tags. Reads every optional field defensively. */
export function Facts({ game, tags = 0 }) {
  const players = playersLabel(game?.players);
  const duration = typeof game?.duration === 'string' ? game.duration.trim() : '';
  const extra = Array.isArray(game?.tags) ? game.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, tags) : [];
  if (!players && !duration && !extra.length) return null;
  return (
    <ul className="bw-facts" role="list">
      {players && (
        <li className="st-chip">
          <HubIcon name="users" size={14} />
          {players}
        </li>
      )}
      {duration && (
        <li className="st-chip">
          <HubIcon name="clock" size={14} />
          {duration}
        </li>
      )}
      {extra.map((t) => (
        <li key={t} className="st-chip bw-facts__tag">
          {t}
        </li>
      ))}
    </ul>
  );
}
