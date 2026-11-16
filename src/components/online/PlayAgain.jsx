// "Play again with the same group", the screens' side of it (the logic is usePlayAgain.js + playAgainModel.js):
//   <PlayAgain>         one primary button + (optionally) who it will invite; mounted by the finished-room lobby and by the
//                       game plugin's game-over screen. `renderButton` lets a game draw the button in its own style.
//   <PostGameFriends>   the other humans of the match, each with a compact "Add friend" button (it hides itself for friends,
//                       guests and yourself).
//   <RematchBanner>     the calm line in the new lobby: "Waiting for the last table to join..."
// Nothing here knows a game; it only reads the room (players, settings) the host screen already has.
import AddFriendButton from '@/platform/social/AddFriendButton.jsx';
import { Avatar } from '@/components/art/index.js';
import { usePlayAgain } from './usePlayAgain.js';
import { otherHumans, planSummary, rematchProgress } from './playAgainModel.js';
import '@/styles/playagain.css';

/** The label of the primary button: short when there is nobody to bring back. */
export function againLabel({ busy, total }) {
  if (busy) return 'Setting up the table...';
  return total > 0 ? 'Play again with everyone' : 'Play again';
}

/**
 * Presentational part (the SSR tests render it in every state).
 * Props: { status: 'idle'|'working'|'error', error, summary, label, onStart, renderButton?, variant? }
 * `renderButton({ onClick, busy, label, disabled })` replaces the default hub button.
 */
export function PlayAgainView({ status = 'idle', error = '', summary = '', label = 'Play again with everyone', onStart, renderButton, variant = 'lobby' }) {
  const busy = status === 'working';
  const props = { onClick: onStart, busy, label, disabled: busy };
  return (
    <div className={`pa-again pa-again--${variant}`} data-status={status}>
      {renderButton ? (
        renderButton(props)
      ) : (
        <button type="button" className="ho-btn ho-btn--primary ho-btn--lg pa-btn" onClick={onStart} disabled={busy} aria-busy={busy || undefined}>
          {busy && <span className="pa-spin" aria-hidden="true" />}
          <span>{label}</span>
        </button>
      )}
      {summary && !error && <p className="pa-summary">{summary}</p>}
      <p className="pa-sr" role="status" aria-live="polite">
        {busy ? 'Setting up your new table' : ''}
      </p>
      {error && (
        <p className="pa-error" role="alert">
          {error}. Tap the button to try again.
        </p>
      )}
    </div>
  );
}

/**
 * The "Play again" block. Props: { room, gameId, game, gameLabel, renderButton?, showSummary?, variant? }
 * `room` is the finished room (`{ code, players, settings, maxPlayers }`). Double taps are ignored while it works.
 */
export default function PlayAgain({ room, gameId, game, gameLabel, renderButton, showSummary = true, variant = 'lobby' }) {
  const { plan, status, error, start } = usePlayAgain({ room, gameId, game, gameLabel });
  return (
    <PlayAgainView
      status={status}
      error={error}
      summary={showSummary ? planSummary(plan) : ''}
      label={againLabel({ busy: status === 'working', total: plan.total })}
      onStart={start}
      renderButton={renderButton}
      variant={variant}
    />
  );
}

/** Other humans of the match with an "Add friend" button each. Renders nothing when there is nobody to add. */
export function PostGameFriends({ players, meId, title = 'Add as friends', className = '' }) {
  const people = otherHumans(players, meId);
  if (!people.length) return null;
  return (
    <section className={`pa-people ${className}`.trim()} aria-label={title}>
      <h3 className="pa-people__h">{title}</h3>
      <ul className="pa-people__list">
        {people.map((p) => (
          <li key={p.id} className="pa-person">
            <span className="pa-person__ava" aria-hidden="true">
              <Avatar preset={Number.isInteger(p.avatar) ? p.avatar : 0} size={32} />
            </span>
            <span className="pa-person__name">{p.name}</span>
            <AddFriendButton userId={p.id} name={p.name} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The new lobby's banner while the people from the last table are still on their way. `from` = readRematchFrom(location.state.rematchFrom). */
export function RematchBanner({ from, players, meId }) {
  if (!from) return null;
  const { total, here, waiting } = rematchProgress(from, players, meId);
  if (total === 0 || waiting === 0) return null;
  return (
    <div className="pa-banner" role="status" aria-live="polite">
      <span className="pa-banner__dot" aria-hidden="true" />
      <span className="pa-banner__text">Waiting for the last table to join...</span>
      <span className="pa-banner__count">
        {here} of {total} back
      </span>
    </div>
  );
}
