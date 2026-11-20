import { useMemo } from 'react';
import { useInvites } from '@/components/online/InviteBanner.jsx';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import { useAccount } from '../hooks.js';

/** Pure: the nav badges from raw `/api/friends` data and the number of waiting game invites. */
export function badgesFrom(friendsData, inviteCount = 0) {
  const friends = Array.isArray(friendsData?.friends) ? friendsData.friends : [];
  const incoming = Array.isArray(friendsData?.incoming) ? friendsData.incoming.length : 0;
  const invites = Math.max(0, Number(inviteCount) || 0);
  return {
    friends: {
      count: incoming + invites, // things waiting for an answer
      online: friends.filter((f) => f && f.online).length, // the "live" dot
    },
  };
}

/**
 * Badges for the nav items, from data the app already loads: friend requests (`incoming`), waiting game invites
 * and friends online. Only for full accounts (guests have no friends list); quiet when the API is unreachable.
 * Call once (AppShell) and pass the result to the tab bar and the rail.
 */
export function useNavBadges() {
  const { account } = useAccount();
  const { ready } = useApiGate();
  const remote = useApi('/api/friends', { enabled: ready && account });
  const { invites } = useInvites();
  const data = remote.status === 'ok' ? remote.data : null;
  const inviteCount = account && Array.isArray(invites) ? invites.length : 0;
  return useMemo(() => badgesFrom(data, inviteCount), [data, inviteCount]);
}
