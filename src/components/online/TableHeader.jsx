import { themeVars } from '@/platform/game/color.js';
import GameIcon from './GameIcon.jsx';
import { useCopied } from './clipboard.js';
import { spacedCode } from './codes.js';
import '@/styles/store-rooms.css';

/**
 * The lit table at the top of the lobby: the game's colours glowing behind its icon, and the room code in signage
 * letters (tap to copy). `chip` is the connection chip, `hostName` comes from the room's own player list.
 */
export default function TableHeader({ game, gName, code, hostName, chip, onNotify }) {
  const [copied, copy] = useCopied();
  const spoken = String(code).split('').join(' ');
  return (
    <header className="sr-table" style={themeVars(game && game.theme)}>
      <span className="sr-table__glow" aria-hidden="true" />
      <div className="sr-table__who">
        <GameIcon game={game} name={gName} size={56} className="sr-table__icon" />
        <div className="sr-table__names">
          <span className="st-eyebrow sr-table__eyebrow">{gName}</span>
          <h1 className="sr-table__h1">{hostName ? `${hostName}'s table` : 'Your table'}</h1>
        </div>
      </div>
      <button
        type="button"
        className={`sr-table__code${copied ? ' is-copied' : ''}`}
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
      {chip && <div className="sr-table__chip">{chip}</div>}
    </header>
  );
}
