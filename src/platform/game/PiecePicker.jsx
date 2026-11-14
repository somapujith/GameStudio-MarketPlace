import { Avatar } from '@/components/art/index.js';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import { PieceArt } from './art.jsx';

/**
 * Lobby piece picker: one tile per `choices` entry (from lobbyModel.pieceChoices). Free pieces are drawn in my
 * seat `color`; a taken one shows its owner's avatar and is disabled; mine is highlighted.
 * `onPick(pieceId)`; `disabled` while the socket is down.
 */
export default function PiecePicker({ choices, color, onPick, disabled = false, pending = false }) {
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const mine = choices.find((c) => c.mine);
  return (
    <section className="ho-card xl-pieces" aria-labelledby="xl-pieces-h" aria-busy={pending || undefined}>
      <div className="ho-card__head">
        <h2 id="xl-pieces-h" className="ho-h2">
          Your piece
        </h2>
        <span className="ho-muted xl-pieces__now" aria-live="polite">
          {mine ? mine.name : 'Pick one'}
        </span>
      </div>
      <div className="xl-pieces__grid" role="radiogroup" aria-labelledby="xl-pieces-h" onKeyDown={radioKeyNav}>
        {choices.map((c) => {
          const taken = !!c.takenBy;
          const label = taken ? `${c.name}, taken by ${c.takenBy.name || 'another player'}` : c.name;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.mine}
              aria-label={label}
              tabIndex={c.mine || (!mine && c === choices.find((x) => !x.takenBy)) ? 0 : -1}
              className={`xl-piece${c.mine ? ' is-mine' : ''}${taken ? ' is-taken' : ''}`}
              disabled={disabled || taken}
              onClick={() => !c.mine && onPick && onPick(c.id)}
            >
              <span className="xl-piece__art" aria-hidden="true">
                <PieceArt piece={c.id} color={taken ? '#8190ba' : color} size={44} />
              </span>
              <span className="xl-piece__name">{c.name}</span>
              {taken && (
                <span className="xl-piece__owner" aria-hidden="true">
                  <Avatar preset={Number.isInteger(c.takenBy.avatar) ? c.takenBy.avatar : 0} size={22} />
                </span>
              )}
              {c.mine && (
                <span className="xl-piece__check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5 10 17.5 19 7" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
