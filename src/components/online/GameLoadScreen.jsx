import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { themeVars } from '@/platform/game/color.js';
import { paths } from '@/platform/paths.js';
import GameIcon from './GameIcon.jsx';
import { useOnline } from './ConnectionChip.jsx';
import { spacedCode } from './codes.js';
import '@/styles/store-rooms.css';

const SLOW_MS = 7000; // after this the wait gets an honest "taking longer" line and a retry

/** One quiet step: done (check), active (spinner) or waiting (empty ring). */
function Step({ state, children }) {
  return (
    <li className={`sr-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <span className="sr-step__mark" aria-hidden="true">
        {state === 'done' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : state === 'active' ? (
          <span className="ho-spinner" />
        ) : null}
      </span>
      {children}
    </li>
  );
}

/** A grey stand-in for the game screen (top bar, board, action dock) so the wait has the shape of what is coming. */
function GameSkeleton() {
  return (
    <div className="sr-gskel" aria-hidden="true">
      <div className="sr-gskel__top">
        <i className="st-skel" />
        <i className="st-skel" />
        <i className="st-skel" />
      </div>
      <div className="sr-gskel__main">
        <div className="sr-gskel__board st-skel" />
        <div className="sr-gskel__side">
          <i className="st-skel" />
          <i className="st-skel" />
          <i className="st-skel" />
        </div>
      </div>
      <div className="sr-gskel__dock">
        <i className="st-skel" />
        <i className="st-skel" />
      </div>
    </div>
  );
}

/**
 * The wait between the link and the first game screen: the game's art and colours, what is happening in plain steps
 * (find the table, load the game, take the seat) and what to do when it takes long or the network is gone.
 * `game` may be null (the room's game is not known yet). `roomChecked` / `pageReady` drive the steps.
 */
export default function GameLoadScreen({ game, code, title, body, roomChecked = false, pageReady = false, onRetry }) {
  const online = useOnline();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  const Cover = game && game.art && game.art.cover;
  const name = (game && game.name) || '';
  const step = (done, active) => (done ? 'done' : active ? 'active' : 'wait');
  const s1 = step(roomChecked, true);
  const s2 = step(pageReady, roomChecked || !pageReady);
  const s3 = step(false, roomChecked && pageReady);
  return (
    <div className="ho-screen sr-load" style={game ? themeVars(game.theme) : undefined} role="status" aria-busy="true" aria-live="polite">
      <GameSkeleton />
      <div className="sr-load__card">
        {Cover && (
          <div className="sr-load__cover" aria-hidden="true">
            <Cover />
          </div>
        )}
        <GameIcon game={game} name={name || '?'} size={64} className="sr-load__icon" />
        {code && <span className="st-eyebrow sr-load__eyebrow">Room {spacedCode(code)}</span>}
        <h1 className="sr-load__title">{title}</h1>
        {body && <p className="sr-load__body">{body}</p>}
        <ol className="sr-steps" aria-label="Progress">
          <Step state={s1}>Finding the table</Step>
          <Step state={s2}>Loading {name || 'the game'}</Step>
          <Step state={s3}>Taking your seat</Step>
        </ol>
        {!online && (
          <p className="sr-load__note sr-load__note--bad" role="alert">
            You are offline. We carry on the moment your network is back.
          </p>
        )}
        {online && slow && <p className="sr-load__note">This is taking longer than usual. Your seat is safe.</p>}
        <div className="sr-load__actions">
          {onRetry && (online ? slow : true) && (
            <button type="button" className="ho-btn ho-btn--primary ho-btn--sm" onClick={onRetry}>
              Try again
            </button>
          )}
          <Link to={paths.hub()} className="ho-btn ho-btn--ghost ho-btn--sm">
            Leave
          </Link>
        </div>
      </div>
    </div>
  );
}
