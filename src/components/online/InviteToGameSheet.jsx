import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, errorMessage, sendInvite } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { themeVars } from '@/platform/game/color.js';
import { inviteGames, warmOnlineGame } from './games.js';
import { inviteFeedback } from './friendsModel.js';
import GameIcon from './GameIcon.jsx';
import Sheet from './Sheet.jsx';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/store-social.css';

/**
 * "Invite to game": pick one of the live games, we open a private room for it, invite the friend
 * (POST /api/invites) and land in the lobby. `friend` = { id, name, online? }. Works for offline friends too: the
 * server keeps the invite and the lobby toast says so honestly ("Invite saved — they'll see it when they're back").
 */
export default function InviteToGameSheet({ friend, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const games = inviteGames(user || null); // games still locked behind their solo tutorial are not offered
  const [busy, setBusy] = useState(null); // gameId being created
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pick = async (game) => {
    if (busy) return;
    setBusy(game.id);
    setError('');
    let room;
    try {
      room = await createRoom({ gameId: game.id, visibility: 'private' });
      if (!room || !room.code) throw new Error('The room could not be created. Try again.');
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e, 'Could not create the room'));
      setBusy(null);
      return;
    }
    let toast;
    try {
      const fb = inviteFeedback(await sendInvite(room.code, friend.id), friend.name);
      toast = { text: fb.text, tone: fb.tone };
    } catch (e) {
      toast = { text: `Room ready, but ${friend.name} could not be invited: ${errorMessage(e, 'try again from the lobby')}`, tone: 'bad' };
    }
    navigate(paths.lobby(room.code), { state: { toast } });
  };

  return (
    <Sheet
      open
      title={`Invite ${friend.name}`}
      subtitle={
        friend.online === false
          ? `Pick a game. We open a private room and save the invite: ${friend.name} sees it when they are back.`
          : 'Pick a game. We open a private room and send the invite.'
      }
      onClose={busy ? undefined : onClose}
    >
      {games.length === 0 ? (
        <p className="sc-sheet-empty">No games are open for friends yet. Check back soon.</p>
      ) : (
        <ul className="sc-games" aria-label="Games">
          {games.map((g, i) => (
            <li key={g.id} className="sc-enter" style={{ '--i': i }}>
              <button
                type="button"
                className="sc-game"
                style={themeVars(g.theme)}
                onClick={() => pick(g)}
                onPointerEnter={() => warmOnlineGame(g)}
                onFocus={() => warmOnlineGame(g)}
                disabled={!!busy}
                aria-busy={busy === g.id || undefined}
              >
                <GameIcon game={g} size={54} />
                <span className="sc-game__main">
                  <span className="sc-game__name">{g.name}</span>
                  <span className="sc-game__sub">
                    {g.tagline}
                    {g.players ? ` · ${g.players.min}-${g.players.max} players` : ''}
                  </span>
                </span>
                <span className="sc-game__go">{busy === g.id ? 'Opening...' : 'Invite'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="sc-add__error" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
