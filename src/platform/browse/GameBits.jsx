// Small pieces shared by the browse cards and rows: the status badge and the fact line.
import HubIcon from '@/platform/game/HubIcon.jsx';
import { playersLabel } from '@/platform/home/gameTheme.js';

export const isSoon = (game) => game?.status === 'coming_soon';

export function StatusBadge({ game }) {
  return isSoon(game) ? (
    <span className="cj-browse-badge">Soon</span>
  ) : (
    <span className="cj-browse-badge cj-browse-badge--live">
      <i className="cj-live-dot" aria-hidden="true" />
      Live
    </span>
  );
}

/** Players, duration and (when the manifest has them) up to `tags` tags, as a dotted meta line. Reads every optional field defensively. */
export function Facts({ game, tags = 0 }) {
  const players = playersLabel(game?.players);
  const duration = typeof game?.duration === 'string' ? game.duration.trim() : '';
  const extra = Array.isArray(game?.tags) ? game.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, tags) : [];
  if (!players && !duration && !extra.length) return null;
  return (
    <ul className="cj-meta cj-browse-facts" role="list">
      {players && (
        <li>
          <HubIcon name="users" size={14} />
          {players}
        </li>
      )}
      {duration && (
        <li>
          <HubIcon name="clock" size={14} />
          {duration}
        </li>
      )}
      {extra.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}
