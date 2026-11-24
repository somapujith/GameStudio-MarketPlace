import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isStaff } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import { featured, rankedList } from '@/platform/home/catalog.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import ProfileHeader from '@/platform/home/ProfileHeader.jsx';
import GameStatCards, { RecentMatches } from '@/platform/home/GameStatCards.jsx';
import BadgeGrid from '@/platform/home/BadgeGrid.jsx';
import AchievementsGrid from '@/platform/engagement/AchievementsGrid.jsx';
import ReferralCard from '@/platform/engagement/ReferralCard.jsx';
import SettingsSection from '@/platform/home/SettingsSection.jsx';
import AccountSection from '@/platform/home/AccountSection.jsx';
import AboutSection from '@/platform/home/AboutSection.jsx';
import HandleField from '@/platform/social/HandleField.jsx';
import ProfileTour from '@/components/tour/ProfileTour.jsx';
import { useAccountProgress } from '@/platform/home/accountProgress.js';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/cine/profile.css';

const JUMPS = [
  { id: 'games', label: 'Games' },
  { id: 'matches', label: 'Matches' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'invite', label: 'Invite' },
  { id: 'badges', label: 'Badges' },
  { id: 'settings', label: 'Settings' },
  { id: 'account', label: 'Account' },
];

/** Skeleton shaped like the identity hero while the session loads (no flash of a wrong name or level). */
function ProfileSkeleton() {
  return (
    <div className="cj-pro-hero cj-pro-hero--skel" role="status" aria-busy="true">
      <span className="sr-only">Loading your profile...</span>
      <span className="cj-pro-skel cj-pro-skel--ring" />
      <span className="cj-pro-hero__skel-lines">
        <span className="cj-pro-skel" style={{ height: 36, width: '46%' }} />
        <span className="cj-pro-skel" style={{ height: 14, width: '28%' }} />
        <span className="cj-pro-skel" style={{ height: 6, width: '60%' }} />
        <span className="cj-pro-skel" style={{ height: 40, width: '40%', borderRadius: 999 }} />
      </span>
    </div>
  );
}

/**
 * `/profile`: a calm hero (avatar and frame, name and @username, level and XP, coins, streak, daily reward) over the
 * ambient backdrop, jump chips, then rows and glass panels: per-game stats, recent matches, achievements, the invite
 * card, badges, settings, username, account and about.
 */
export default function Profile() {
  const { hash } = useLocation();
  const { user, signedIn, loading } = useAccount();
  const { level } = useAccountProgress();
  const reduced = useReducedMotion();
  const games = useMemo(rankedList, []); // games that keep stats (solo games do not)
  const lead = useMemo(featured, []);

  // `/profile#settings` (the old /settings link target) scrolls to the settings block.
  useEffect(() => {
    if (!hash) return undefined;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(t);
  }, [hash]);

  const jump = (e, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {
      /* sandboxed frame: scrolling is enough */
    }
  };

  return (
    <div className="hub-page cj-pro">
      <div className="cj-ambient cj-pro-ambient" aria-hidden="true" />
      <h1 className="sr-only">Your profile</h1>
      <ProfileTour />
      {loading ? <ProfileSkeleton /> : <ProfileHeader />}
      <div className="cj-pro-jumpbar">
        <nav className="cj-pro-jump" aria-label="Profile sections">
          {JUMPS.map((j) => (
            <a key={j.id} href={`#${j.id}`} className="cj-chip cj-pro-jump__chip" onClick={(e) => jump(e, j.id)}>
              {j.label}
            </a>
          ))}
        </nav>
        {isStaff(user) ? (
          <Link to={paths.admin()} className="cj-btn cj-btn--sm cj-pro-staff">
            <HubIcon name="key" size={16} /> Admin console
          </Link>
        ) : null}
      </div>
      <div className="cj-pro-cols">
        <GameStatCards games={games} user={user} />
        <RecentMatches signedIn={signedIn} lead={lead} />
      </div>
      <AchievementsGrid />
      <ReferralCard />
      <BadgeGrid games={games} user={user} level={level} />
      <SettingsSection />
      <div className="cj-pro-duo">
        <HandleField />
        <AccountSection />
      </div>
      <AboutSection />
    </div>
  );
}
