// Shared bits of rich friend presence: the status text ("Online", "In a lobby", "Playing Kingpin") and the
// "Join their table" button. Used by the Friends page rows, the home friends strip / sheet and the lobby invite list.
import { useNavigate } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { gameName } from '@/components/online/games.js';
import { statusLine } from '@/components/online/friendsModel.js';
import '@/styles/presence.css';

/** Text of a friend's status, e.g. "Playing Kingpin". */
export const statusText = (friend) => statusLine(friend, (id) => gameName(id)).text;

/** True when the friend sits in an open lobby you can join (the server only sends a code for those). */
export const canJoin = (friend) => !!statusLine(friend).code;

/** A small coloured status line (`pr-status--on | lobby | play | off`); `className` adds layout classes. */
export function StatusText({ friend, className = '' }) {
  const s = statusLine(friend, (id) => gameName(id));
  return <span className={`pr-status pr-status--${s.tone}${className ? ` ${className}` : ''}`}>{s.text}</span>;
}

/** "Join" for a friend in an open lobby: goes to the join screen of their room (which re-checks everything). */
export function JoinButton({ friend, className = 'hub-btn hub-btn--primary hub-btn--sm', onBefore, disabled }) {
  const navigate = useNavigate();
  const { code } = statusLine(friend);
  if (!code) return null;
  return (
    <button
      type="button"
      className={`pr-join ${className}`}
      disabled={disabled}
      aria-label={`Join ${friend.name}'s table`}
      onClick={() => {
        if (onBefore) onBefore();
        navigate(paths.join(code));
      }}
    >
      Join
    </button>
  );
}
