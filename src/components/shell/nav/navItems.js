// The hub destinations (bottom bar on phones, left rail >= 900 px). Each item lists the path prefixes that light
// it up: /games/:id and /lobby/:code keep "Arcade" active, /games and /search light "Browse", /login and /shop
// keep "Profile" active. Footer pages (/about, /help, /privacy, /terms) belong to no tab on purpose.
import { paths } from '@/platform/paths.js';
import { useLocation } from 'react-router-dom';

export const NAV_ITEMS = [
  // `only`: exact paths that are NOT this item's (they belong to a more specific item)
  { id: 'games', to: paths.hub(), label: 'Arcade', icon: 'gamepad', exact: true, match: ['/games', '/lobby', '/join'], only: ['/games'] },
  { id: 'browse', to: paths.games(), label: 'Browse', icon: 'compass', match: ['/search'], exactMatch: ['/games'] },
  { id: 'friends', to: paths.friends(), label: 'The Adda', icon: 'users', match: ['/friends', '/f'] },
  { id: 'rank', to: paths.leaderboard(), label: 'Leaderboard', icon: 'podium', match: ['/leaderboard'] },
  { id: 'profile', to: paths.profile(), label: 'Profile', icon: 'user', match: ['/profile', '/login', '/shop'] },
];

/** Paths where no tab is active (footer / legal pages). Exported for the tests and the shell's titles. */
export const NO_TAB = ['/about', '/help', '/privacy', '/terms'];

export function isActive(item, pathname) {
  const p = String(pathname || '/').replace(/(.)\/+$/, '$1');
  if (item.exact && p === '/') return true;
  if (item.exactMatch?.includes(p)) return true;
  if (item.only?.includes(p)) return false;
  return item.match.some((m) => p === m || p.startsWith(`${m}/`));
}

/** `(item) => boolean` for the current location. */
export function useIsActive() {
  const { pathname } = useLocation();
  return (item) => isActive(item, pathname);
}
