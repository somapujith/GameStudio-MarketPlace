import { Avatar } from '@/components/art/index.js';
import { radioKeyNav } from '@/components/shell/ui.jsx';
import { pieceStatus } from '@/components/online/lobbyModel.js';
import { PieceArt } from './art.jsx';

/**
 * "Choose your piece": the lobby's first card. One big tile per `choices` entry (from lobbyModel.pieceChoices): free
 * pieces are drawn in my seat `color`, mine is ringed and ticked, a taken one is greyed out, disabled and says who has it.
 * `me` = { name, avatar } shows who is choosing (the character picked at sign in). `onPick(pieceId)`; `disabled` while
 * the socket is down; `pending` while the server has not confirmed my pick yet.
 */
export default function PiecePicker({ choices, color, onPick, disabled = false, pending = false, me = null }) {
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const { mine, free, status } = pieceStatus(choices);
  const firstFree = choices.find((x) => !x.takenBy);
  return (
    <section className="ho-card xl-pieces xl-pieces--top" aria-labelledby="xl-pieces-h" aria-describedby="xl-pieces-lede" aria-busy={pending || undefined}>
      <header className="xl-pieces__head">
        <div className="xl-pieces__titles">
          <h2 id="xl-pieces-h" className="xl-pieces__title">
            Choose your piece
          </h2>
          <p id="xl-pieces-lede" className="xl-pieces__lede">
            Tap an icon to pick it &mdash; it is your piece on the board
          </p>
        </div>
        <div className={`xl-pieces__me${mine ? ' has-pick' : ''}`}>
          {me && (
            <span className="xl-pieces__avatar" aria-hidden="true">
              <Avatar preset={Number.isInteger(me.avatar) ? me.avatar : 0} size={40} />
            </span>
          )}
          <span className="xl-pieces__now" aria-live="polite">
            {me && me.name ? <b>{me.name}</b> : null}
            <span>{status}</span>
          </span>
        </div>
      </header>
      <div className="xl-pieces__grid" role="radiogroup" aria-labelledby="xl-pieces-h" onKeyDown={radioKeyNav}>
        {choices.map((c) => {
          const taken = !!c.takenBy;
          const owner = taken ? c.takenBy.name || 'another player' : '';
          const label = taken ? `${c.name}, taken by ${owner}` : c.name;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.mine}
              aria-label={label}
              tabIndex={c.mine || (!mine && c === firstFree) ? 0 : -1}
              className={`xl-piece${c.mine ? ' is-mine' : ''}${taken ? ' is-taken' : ''}`}
              disabled={disabled || taken}
              onClick={() => !c.mine && onPick && onPick(c.id)}
            >
              <span className="xl-piece__art" aria-hidden="true">
                <PieceArt piece={c.id} color={taken ? '#8190ba' : color} size={60} />
              </span>
              <span className="xl-piece__name">{c.name}</span>
              {taken && (
                <span className="xl-piece__owner" aria-hidden="true">
                  <span className="xl-piece__ownerav">
                    <Avatar preset={Number.isInteger(c.takenBy.avatar) ? c.takenBy.avatar : 0} size={22} />
                  </span>
                  <span className="xl-piece__ownername">{owner}</span>
                </span>
              )}
              {c.mine && (
                <>
                  <span className="xl-piece__yours" aria-hidden="true">
                    Yours
                  </span>
                  <span className="xl-piece__check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5 10 17.5 19 7" />
                    </svg>
                  </span>
                </>
              )}
              {!taken && !c.mine && (
                <span className="xl-piece__hint" aria-hidden="true">
                  Tap to pick
                </span>
              )}
            </button>
          );
        })}
      </div>
      {free < choices.length && <p className="xl-pieces__foot">Greyed-out pieces are taken by other players.</p>}
    </section>
  );
}
