// "Play again with everyone": create a private table with the same game and settings, invite the people from the
// finished match who are my friends (one batch call), then open the new lobby. The server stays authoritative: this is
// plain composition of createRoom + POST /api/invites/batch, and the new room exists even if every invite fails.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, errorMessage, sendInvites } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { loadFriends, useFriendStore } from '@/platform/social/friendStore.js';
import { copyText } from './clipboard.js';
import { resolveSettings } from './settings.js';
import { composeToast, inviteOutcome, planRematch, rematchFrom, rematchLinkText, wantsLinkCopy } from './playAgainModel.js';

const DEFAULT_DEPS = { createRoom, sendInvites, copyText, loadFriends };

/**
 * The whole flow without React (unit-tested with fakes).
 *   room      the finished room { code, players, settings, maxPlayers }
 *   friends   my friend data when already loaded (the friend store's `data`), or null
 *   member    false for a guest: no friend list, no batch call, just the link
 * -> { ok: false, error }                       nothing was created (the caller keeps the button ready for a retry)
 *    { ok: true, code, toast, state }           the table exists: navigate to it with `state` (toast + who we wait for)
 */
export async function rematchFlow({ room, gameId, game, gameLabel, meId, member, friends }, deps = DEFAULT_DEPS) {
  const players = room && Array.isArray(room.players) ? room.players : [];
  let list = member ? friends : null;
  // the friend list may still be on its way (or have failed): ask once more, and carry on without it if it never comes
  if (member && !list) list = await Promise.resolve(deps.loadFriends()).catch(() => null);
  const plan = planRematch({ players, meId, friends: list });

  let created;
  try {
    const settings = game && game.settings ? resolveSettings(game.settings, room.settings) : undefined; // only keys the schema knows
    created = await deps.createRoom({ gameId, settings, maxPlayers: room.maxPlayers, visibility: 'private' });
  } catch (e) {
    return { ok: false, error: errorMessage(e, 'Could not create a new table') };
  }
  const code = created && created.code;
  if (!code) return { ok: false, error: 'Could not create a new table' };

  // from here on the table exists: whatever goes wrong with the invites, we still open it
  let results = null;
  if (plan.friends.length) {
    try {
      const res = await deps.sendInvites(code, plan.friends.map((f) => f.id));
      results = res && Array.isArray(res.results) ? res.results : null;
    } catch {
      results = null;
    }
  }
  const outcome = inviteOutcome(plan, results);
  let copied = false;
  if (wantsLinkCopy(plan, outcome)) copied = await Promise.resolve(deps.copyText(rematchLinkText(code, gameLabel))).catch(() => false);
  return { ok: true, code, toast: composeToast({ plan, outcome, copied, code }), state: { rematchFrom: rematchFrom(room.code || '', plan) } };
}

/**
 * Props: { room, gameId, game, gameLabel }
 *   room   the finished room: { code, players, settings, maxPlayers } (the lobby's room, or the game session's `room`)
 *   game   the game's manifest (for the settings schema); null still works (the server fills in the defaults)
 * Returns { plan, status, busy, error, start }
 *   status  'idle' | 'working' | 'error'  (it never reports success: it navigates away)
 *   start() is safe to tap twice: the second tap is ignored until the first finished.
 */
export function usePlayAgain({ room, gameId, game, gameLabel }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const meId = user ? String(user.id) : '';
  const member = !!user && !user.isGuest;
  const { data } = useFriendStore({ enabled: member });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const roomPlayers = room && Array.isArray(room.players) ? room.players : null;
  const plan = useMemo(() => planRematch({ players: roomPlayers, meId, friends: member ? data : null }), [roomPlayers, meId, member, data]);

  const start = useCallback(async () => {
    if (busy.current || !room) return;
    busy.current = true;
    setStatus('working');
    setError('');
    let res;
    try {
      res = await rematchFlow({ room, gameId, game, gameLabel, meId, member, friends: data });
    } catch (e) {
      res = { ok: false, error: errorMessage(e, 'Could not create a new table') };
    }
    busy.current = false;
    if (res.ok) {
      // stay "working" until the route change unmounts us: no second tap can slip in
      navigate(paths.lobby(res.code), { replace: true, state: { toast: res.toast, ...res.state } });
    } else if (alive.current) {
      setError(res.error);
      setStatus('error');
    }
  }, [room, gameId, game, gameLabel, meId, member, data, navigate]);

  return { plan, status, busy: status === 'working', error, start };
}

export default usePlayAgain;
