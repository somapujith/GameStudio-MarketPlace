import { Link, useLocation } from 'react-router-dom';
import { AvatarRing } from './ui.jsx';
import { useProfile } from './stores.js';
import { useAccount } from './hooks.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';

/**
 * The profile button at the end of the nav pill: a round avatar with a signed-in indicator (green = account,
 * amber = guest). Signed-in players go to their profile; visitors go to the login screen and come back.
 */
export default function ProfileChip() {
  const [profile] = useProfile();
  const { signedIn, guest, user, loading } = useAccount();
  const { pathname, search } = useLocation();

  const name = signedIn ? user?.name || profile.name || 'Guest' : 'Sign in';
  const avatar = signedIn && Number.isInteger(user?.avatar) ? user.avatar : profile.avatar;
  const level = signedIn && Number.isFinite(Number(user?.level)) ? Number(user.level) : profile.level;
  const status = signedIn ? (guest ? 'Guest account' : 'Signed in') : 'Not signed in';
  const sub = !signedIn ? 'to play' : guest ? 'Guest' : `Lv ${level}`;
  const to = signedIn ? paths.profile() : paths.login(`${pathname}${search}`);

  if (loading && !signedIn) return <span className="cj-nav__me cj-nav__me--wait" aria-hidden="true" />; // auth still booting: no flash of "Sign in"

  // A visitor gets a clear call to action instead of a grey avatar: signing in is how coins, friends and rank start.
  if (!signedIn) {
    return (
      <Link to={to} data-tour="nav-profile" className="cj-btn cj-btn--primary cj-btn--sm cj-nav__signin" aria-label="Sign in to play: Google or guest">
        <HubIcon name="user" size={16} />
        <span>Sign in</span>
      </Link>
    );
  }

  // Signed in: a round avatar (the name and level live in the label; the status dot tells account from guest).
  return (
    <Link to={to} data-tour="nav-profile" className="cj-nav__me" title={`${name} · ${sub}`} aria-label={`Profile: ${name}. ${status}, level ${level}`}>
      <AvatarRing preset={avatar} size={32} dot={guest ? 'guest' : 'on'} />
    </Link>
  );
}
