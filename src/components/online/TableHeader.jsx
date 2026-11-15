import { themeVars } from '@/platform/game/color.js';
import GameIcon from './GameIcon.jsx';
import { useCopied } from './clipboard.js';
import { spacedCode } from './codes.js';
import MapTag from './MapTag.jsx';
import '@/styles/store-rooms.css';

/**
 * The lit table at the top of the lobby: the game's colours glowing behind its icon, and the room code in signage
 * letters (tap to copy). `chip` is the connection chip, `hostName` comes from the room's own player list, `map` (a map id
 * or the room's settings) puts the chosen map under the title for games that have maps.
 */
export default function TableHeader({ game, gName, code, hostName, chip, onNotify, map = null }) {
  const [copied, copy] = useCopied();
  const spoken = String(code).split('').join(' ');
  return (
    <header className="sr-table" data-tour="lobby-header" style={themeVars(game && game.theme)}>
      <span className="sr-table__glow" aria-hidden="true" />
      <div className="sr-table__who">
        <GameIcon game={game} name={gName} size={56} className="sr-table__icon" />
        <div className="sr-table__names">
          <span className="st-eyebrow sr-table__eyebrow">{gName}</span>
          <h1 className="sr-table__h1">{hostName ? `${hostName}'s table` : 'Your table'}</h1>
          {map != null && <MapTag value={map} className="sr-table__map" />}
        </div>
      </div>
      <button
        type="button"
        className={`sr-table__code${copied ? ' is-copied' : ''}`}
        data-tour="lobby-code"
        aria-label={`Room code ${spoken}. Tap to copy.`}
        onClick={async () => {
          if (!(await copy(code)) && onNotify) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
        }}
      >
        <span className="sr-table__label">Room code</span>
        <span className="sr-table__codetext" aria-hidden="true">
          {spacedCode(code)}
        </span>
        <span className="sr-table__copy" aria-hidden="true">
          {copied ? 'Copied' : 'Tap to copy'}
        </span>
      </button>
      {chip && (
        <div className="sr-table__chip" data-tour="lobby-connection">
          {chip}
        </div>
      )}
    </header>
  );
}
