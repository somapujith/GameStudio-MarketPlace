import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { useNotify } from '@/platform/game/notify.js';
import './street-catalog.css';
import '@/styles/mappicker.css';

const ART = {
  'hyderabad-tycoon': 'hero',
  'ludo-lanes': 'ludo',
  'tambola-night': 'tambola',
  'word-rush': 'word',
  'carrom-club': 'carrom',
};

/**
 * A cinematic poster link with an independent, honest notification toggle. Shows the game's maps line
 * ("2 maps: ...") when the manifest has one, and the live open-table count when `tables` > 0.
 */
export default function GameCard({ game, selected = false, tables = 0 }) {
  const soon = game.status !== 'live';
  const [notify, toggleNotify] = useNotify(game.id);
  const words = game.name.split(' ');
  return (
    <article className={`film-card film-card--${game.id}${selected ? ' is-selected' : ''}${soon ? ' is-soon' : ''}`}>
      <img className="film-card__art" src={`/art/cinematic/${ART[game.id] || 'hero'}.webp`} alt="" width="720" height="480" loading="eager" decoding="async" />
      <span className="film-card__shade" aria-hidden="true" />
      <h3 className="film-card__title"><Link to={paths.game(game.id)} aria-label={`${soon ? 'Explore' : 'Play'} ${game.name}`}>{words.slice(0, -1).join(' ')}<br />{words.at(-1)}</Link></h3>
      {game.mapsLine && <p className="hh2-gcard__maps film-card__maps">{game.mapsLine}</p>}
      {!soon && tables > 0 && (
        <span className="film-card__live">
          <i className="st-live" aria-hidden="true" />
          {tables} table{tables === 1 ? '' : 's'} open
        </span>
      )}
      {soon ? <span className="film-card__soon"><svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="M3 6V4a3 3 0 0 1 6 0v2M1 6h10v7H1z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>COMING SOON</span> : <span className="film-card__play" aria-hidden="true">&#9654; &nbsp;PLAY</span>}
      {soon && <button type="button" className="film-card__notify" aria-label={`${notify ? 'Stop notifying me about' : 'Notify me about'} ${game.name}`} aria-pressed={notify} onClick={toggleNotify}>{notify ? '✓ Saved' : 'Notify me'}</button>}
    </article>
  );
}
