import { themeVars } from '@/platform/game/color.js';
import { GameCover } from '@/platform/home/GameArt.jsx';
import GameIcon from './GameIcon.jsx';
import { useCopied } from './clipboard.js';
import { spacedCode } from './codes.js';
import MapTag from './MapTag.jsx';
import '@/styles/lobby-shell.css';

/**
 * The lit table at the top of the lobby, built like the hub's spotlight hero: the game's cover glows in from the right,
 * its icon sits on the accent light, then "<Host>'s table" (the page's one h1), the connection chip and a small code chip
 * ("Code ABC 234" + copy icon, tap to copy). The code is shown big in one place only, the invite ticket in the invite panel.
 * `chip` is the connection chip, `hostName` comes from the room's own player list, `map` (a map id or the room's settings)
 * puts the chosen map under the title for games that have maps.
 * Hooks kept for the tours: lobby-header, lobby-code, lobby-connection.
 */
export default function TableHeader({ game, gName, code, hostName, chip, onNotify, map = null }) {
  const [copied, copy] = useCopied();
  const spoken = String(code).split('').join(' ');
  return (
    <header className="ls-hero" data-tour="lobby-header" style={themeVars(game && game.theme)}>
      {game && (
        <div className="ls-hero__art" aria-hidden="true">
          <GameCover game={game} className="ls-hero__cover" />
        </div>
      )}
      <span className="ls-hero__glow" aria-hidden="true" />
      <div className="ls-hero__who">
        <GameIcon game={game} name={gName} size={56} className="ls-hero__icon" />
        <div className="ls-hero__names sr-table__names">
          <span className="st-eyebrow ls-hero__eyebrow">{gName}</span>
          <h1 className="ls-hero__h1">{hostName ? `${hostName}'s table` : 'Your table'}</h1>
          {map != null && <MapTag value={map} className="ls-hero__map sr-table__map" />}
          <div className="ls-hero__meta">
            {chip && (
              <div className="ls-hero__chip" data-tour="lobby-connection">
                {chip}
              </div>
            )}
            <button
              type="button"
              className={`ls-code${copied ? ' is-copied' : ''}`}
              data-tour="lobby-code"
              aria-label={`Room code ${spoken}. Tap to copy.`}
              onClick={async () => {
                if (!(await copy(code)) && onNotify) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
              }}
            >
              <span className="ls-code__label" aria-hidden="true">
                Code
              </span>
              <span className="ls-code__text" aria-hidden="true">
                {spacedCode(code)}
              </span>
              <span className="ls-code__icon" aria-hidden="true">
                <svg key={copied ? 'done' : 'idle'} className="ls-code__svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  {copied ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : (<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></>)}
                </svg>
              </span>
              {copied && (
                <span className="ls-code__done" aria-hidden="true">
                  Copied
                </span>
              )}
            </button>
            <span className="ls-sr" role="status" aria-live="polite">
              {copied ? 'Room code copied' : ''}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
