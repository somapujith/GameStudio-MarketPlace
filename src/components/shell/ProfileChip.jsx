import { Link, useLocation } from 'react-router-dom';
import { AvatarRing } from './ui.jsx';
import { useProfile } from './stores.js';
import { useAccount } from './hooks.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';

/**
 * Top-bar chip: avatar with a signed-in indicator (green = account, amber = guest, grey = signed out),
 * name and level. Signed-in players go to their profile; visitors go to the login screen and come back.
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

  if (loading && !signedIn) return <span className="hub-userchip hub-userchip--wait" aria-hidden="true" />; // auth still booting: no flash of "Sign in"

  // A visitor gets a clear call to action instead of a grey avatar: signing in is how coins, friends and rank start.
  if (!signedIn) {
    return (
      <Link to={to} className="hub-btn hub-btn--primary hub-btn--sm hub-signin" aria-label="Sign in to play: Google or guest">
        <HubIcon name="user" size={18} />
        <span>Sign in</span>
      </Link>
    );
  }

  return (
    <Link to={to} className="hub-userchip" aria-label={signedIn ? `Profile: ${name}. ${status}, level ${level}` : 'Sign in to play: Google or guest'}>
      <AvatarRing preset={avatar} size={32} dot={signedIn ? (guest ? 'guest' : 'on') : 'off'} />
      <span className="hub-userchip__meta">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
    </Link>
  );
}
