// Things waiting for an answer, derived read-only from two stores the app already keeps live: the shared friends
// store (incoming friend requests) and the invites store (game invites waiting). Members only; guests and
// signed-out visitors get zeros. Nothing here fetches or writes: it only subscribes (useFriendStore loads the
// friends list once for everybody, the invites store is kept in sync by <AuthProvider>).
import { useMemo } from 'react';
import { useInvites } from '@/components/online/InviteBanner.jsx';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { useFriendStore } from './friendStore.js';

export const NO_COUNTS = Object.freeze({ requests: 0, invites: 0, total: 0 });

const count = (list) => (Array.isArray(list) ? list.length : 0);

/** Pure: `{ requests, invites, total }` from the friends data, the waiting invites and whether this is a member. */
export function socialCounts({ member, friends, invites } = {}) {
  if (!member) return NO_COUNTS;
  const requests = count(friends?.incoming);
  const waiting = count(invites);
  if (!requests && !waiting) return NO_COUNTS;
  return { requests, invites: waiting, total: requests + waiting };
}

/** Pure: the screen-reader text for a count, e.g. "3 pending requests" or "1 pending request, 2 game invites waiting". */
export function socialLabel({ requests = 0, invites = 0 } = {}) {
  const parts = [];
  if (requests > 0) parts.push(`${requests} pending ${requests === 1 ? 'request' : 'requests'}`);
  if (invites > 0) parts.push(`${invites} game ${invites === 1 ? 'invite' : 'invites'} waiting`);
  return parts.join(', ');
}

/** Pure: where a badge leads (the Requests card when there are requests, else the invites inbox). */
export function socialTarget({ requests = 0 } = {}) {
  return `${paths.friends()}${requests > 0 ? '#requests' : '#invites'}`;
}

/** Pure: the nav badges with the Friends count / label taken from the social counts (online dot is kept). */
export function withSocialBadge(badges, counts) {
  const base = badges && typeof badges === 'object' ? badges : {};
  const friends = base.friends || {};
  return { ...base, friends: { ...friends, count: counts?.total || 0, label: socialLabel(counts || {}) } };
}

/** `{ requests, invites, total }` for the signed-in member (zeros for guests / signed out). */
export function useSocialCounts() {
  const { user } = useAuth() || {};
  const member = !!user && !user.isGuest;
  const { data } = useFriendStore({ enabled: member });
  const { invites } = useInvites();
  return useMemo(() => socialCounts({ member, friends: data, invites }), [member, data, invites]);
}

export default useSocialCounts;
