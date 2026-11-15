// "The live bazaar": one place that gathers the real, public numbers the Home page shows as pulse chips
// (open tables, friends online, your running table) so the spotlight, the live strip and the rails share
// ONE set of requests. Nothing here is invented: an unknown number stays unknown (null) and its chip hides.
import { createContext, createElement, useCallback, useContext, useMemo } from 'react';
import { getGamesLive, getMyRooms, getOpenRooms } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { useAccount } from '@/components/shell/hooks.js';
import { useLoad } from '@/components/shell/home/useLoad.js';
import { summarizeLive } from './liveModel.js';
import { useApi, useApiGate } from '../useApi.js';

const fetchLive = (opts) => getGamesLive(opts);
const fetchOpen = (opts) => getOpenRooms({ limit: 10 }, opts);
const fetchMine = (opts) => getMyRooms(opts);

export { summarizeLive };

const LiveContext = createContext(null);

/** Call once (Home) and pass the result to <LiveProvider>. */
export function useHomeLive() {
  const { signedIn, account, loading } = useAccount();
  const auth = useAuth() || {};
  const gate = useApiGate();
  const gamesLive = useLoad('games-live', fetchLive, { pollMs: 30_000 });
  const open = useLoad('rooms-open', fetchOpen, { pollMs: 30_000 });
  const mine = useLoad('rooms-mine', fetchMine, { enabled: signedIn, pollMs: 45_000 });
  const friends = useApi('/api/friends', { enabled: gate.ready && account });

  const sums = useMemo(() => summarizeLive({ gamesLive, open, mine, friends, account }), [gamesLive, open, mine, friends, account]);

  const reloadGames = gamesLive.reload;
  const reloadOpen = open.reload;
  const reloadMine = mine.reload;
  const reloadFriends = friends.reload;
  const retry = useCallback(() => {
    // a dead Worker has to be probed again before the loads are allowed to run
    gate.retry();
    reloadGames();
    reloadOpen();
    reloadMine();
    reloadFriends();
  }, [gate, reloadGames, reloadOpen, reloadMine, reloadFriends]);

  const booting = loading || !!auth.loading;
  // Offline = the public loads could not complete (never while auth is still booting).
  const down = (s) => s === 'offline' || s === 'error';
  const offline = !booting && down(gamesLive.status) && down(open.status);

  return { ...sums, gamesLive, open, mine, friends, booting, offline, retry };
}

export function LiveProvider({ value, children }) {
  return createElement(LiveContext.Provider, { value }, children);
}

/** The shared live numbers, or null outside Home (components then fall back to their own request). */
export const useLive = () => useContext(LiveContext);
