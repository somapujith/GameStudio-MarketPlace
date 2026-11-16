import TransitionLink from '@/components/shell/nav/TransitionLink.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Badge from './Badge.jsx';
import { socialLabel, socialTarget, useSocialCounts } from './useSocialCounts.js';
import '@/styles/badge.css';

/**
 * Top-bar shortcut shown only while something waits for an answer (friend requests, game invites): a people icon
 * with the count, leading to the Requests card (or the invites inbox). Renders nothing otherwise, so the bar does
 * not change for people with nothing pending.
 */
export default function SocialBell() {
  const counts = useSocialCounts();
  if (counts.total <= 0) return null;
  const label = socialLabel(counts);
  return (
    <TransitionLink to={socialTarget(counts)} className="bd-bell" data-tour="nav-social" aria-label={`Friends: ${label}`}>
      <HubIcon name="users" size={20} />
      <Badge count={counts.total} label={label} className="bd-badge--bell" />
    </TransitionLink>
  );
}
